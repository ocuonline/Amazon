//storage.js

if (typeof browser === "undefined") {
  var browser = chrome;
}

export const STORAGE_CONFIG = {MAX_ITEMS: 100};
const PRODUCT_KEY_REGEX = /^[A-Z0-9]{10}$|^HB[A-Z0-9]{10,13}$/;

const DB_NAME = "AFT";
const STORE_NAME = "aft";
const DB_VERSION = 1;

export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {keyPath: "id"});
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveToDB(dataArray) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  for (const item of dataArray) {
    const existing = await new Promise((resolve, reject) => {
      const request = store.get(item.id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (existing) {
      store.put({...existing, ...item});
    } else {
      store.put(item);
    }
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function removeFromDB(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function removeFromSync(id) {
  try {
    await browser.storage.sync.remove(id);
    await removeFromDB(id);
    await browser.storage.local.remove(id);
    return true;
  } catch (error) {
    throw new Error(`Ürün silinirken hata oluştu: ${error.message}`);
  }
}

export async function saveToSync(items) {
  try {
    if (!Array.isArray(items)) {
      throw new Error("'items' bir dizi olmalıdır.");
    }
    if (items.length === 0) {
      await clearAllStorage();
      return {success: true, message: "Depolama temizlendi."};
    }

    let itemsToSave = items;
    if (items.length > STORAGE_CONFIG.MAX_ITEMS) {
      itemsToSave = items.slice(0, STORAGE_CONFIG.MAX_ITEMS);
    }

    const groupedData = {};
    for (const item of itemsToSave) {
      groupedData[item.id] = item;
    }
    await browser.storage.sync.set(groupedData);

    return {success: true, message: "Ürünler kaydedildi."};
  } catch (error) {
    return {success: false, message: `İçe aktarma hatası: ${error.message}`};
  }
}

export async function getAllFromSync(key) {
  try {
    if (key) {
      const data = await browser.storage.sync.get(key);
      return data[key];
    }
    const keys = await browser.storage.sync.get(null);
    const productKeys = Object.keys(keys)
      .filter((k) => PRODUCT_KEY_REGEX.test(k))
      .sort();
    return productKeys.map((k) => keys[k]);
  } catch (error) {
    throw new Error(`Veri alınamadı: ${error.message}`);
  }
}

function cleanPrice(price) {
  return String(price)
    .replace(/\s*TL/gi, "")
    .trim()
    .replace(/,(\d*?)0+$/, (_, d) => (d ? `,${d}` : ""));
}

export async function fixProductData() {
  const allProducts = await getAllFromSync();
  const updatedProducts = allProducts.map((p) => ({
    ...(p.date != null && {date: p.date}),
    ...(p.group != null && {group: p.group}),
    id: p.id,
    name: p.name,
    firstPrice: p.firstPrice ?? (p.oldPrice ? cleanPrice(p.oldPrice) : null),
    newPrice: p.newPrice ? cleanPrice(p.newPrice) : null,
    outOfStock: p.outOfStock === true ? true : false,
    ...(p.newPriceDate != null && {newPriceDate: p.newPriceDate}),
    ...(p.targetPrice != null && {targetPrice: p.targetPrice}),
    url: p.url ?? `https://www.amazon.com.tr/dp/${p.id}?th=1&psc=1`,
  }));
  await saveToSync(updatedProducts);
}

export async function clearAllStorage() {
  try {
    const allSync = await browser.storage.sync.get(null);
    const productKeys = Object.keys(allSync).filter((key) => PRODUCT_KEY_REGEX.test(key));
    const localKeys = productKeys.map((k) => `lastPriceChange_${k}`);

    const allLocal = await browser.storage.local.get(null);
    const oldCheckKeys = Object.keys(allLocal).filter((k) => k.startsWith("lastCheck_"));

    await Promise.all([
      ...productKeys.map((key) => browser.storage.sync.remove(key)),
      browser.storage.sync.remove("lastUpdateTime"),
      browser.storage.local.remove([...localKeys, ...oldCheckKeys, "lastSort"]),
    ]);

    const db = await openDB();
    const tx = db.transaction([STORE_NAME], "readwrite");
    tx.objectStore(STORE_NAME).clear();
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    return true;
  } catch (error) {
    throw new Error(`Depolama temizlenemedi: ${error.message}`);
  }
}

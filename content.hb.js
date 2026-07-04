// content.hb.js
const {saveToSync, removeFromSync} = window.storage.sync;

if (typeof browser === "undefined") {
  var browser = chrome;
}

function sendRuntimeMessage(payload) {
  return new Promise((resolve) => {
    browser.runtime.sendMessage(payload, (response) => resolve(response));
  });
}

const saveToDB = (order) => sendRuntimeMessage({action: "saveToDB", order});
const removeFromDB = (id) => sendRuntimeMessage({action: "removeFromDB", id});

browser.runtime.onMessage.addListener((message) => {
  if (message.action === "updateImage" && message.id) {
    const hbid = getHBID();
    if (hbid !== message.id) return;
    getProductImage().then(async ({base64, url}) => {
      if (base64 || url) {
        await saveToDB([{id: hbid, pic: base64, picUrl: url}]);
      }
    });
  }
});

let currentPriceInfo = {price: null, status: "Yükleniyor..."};

function formatDateTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getHBID() {
  const stokDiv = [...document.querySelectorAll("div")].find((el) => el.textContent.trim() === "Stok Kodu");
  const stokId = stokDiv?.nextElementSibling?.querySelector("span")?.textContent.trim();
  if (stokId) return stokId;
  const meta = document.querySelector('meta[name="page_value"]');
  return meta?.content ?? null;
}

function getHBURL() {
  const match = window.location.href.match(/(pm?)-([A-Z0-9]+)(?:[/?]|$)/i);
  if (!match) return window.location.href;
  return `https://www.hepsiburada.com/-${match[1]}-${match[2]}`;
}

function getPrice() {
  return currentPriceInfo.price;
}

function startPriceObserver() {
  currentPriceInfo = {price: null, status: "Yükleniyor..."};

  let attempts = 0;
  const maxAttempts = 3;
  const interval = setInterval(async () => {
    attempts++;
    const price = await resolvePrice();
    if (price || attempts >= maxAttempts) {
      clearInterval(interval);
      currentPriceInfo = {price, status: price ? "✅" : "❌"};
      addFollowButton();
    }
  }, 300);
}

function tryAddButtonWhenReady() {
  const selector = 'h1[data-test-id="title"]';
  const init = () => {
    startPriceObserver();
    addFollowButton();
  };

  if (document.querySelector(selector)) {
    init();
  } else {
    const observer = new MutationObserver((_, obs) => {
      if (document.querySelector(selector)) {
        obs.disconnect();
        init();
      }
    });
    observer.observe(document.body, {childList: true, subtree: true});
  }
}

tryAddButtonWhenReady();

let lastHref = window.location.href;
new MutationObserver(() => {
  if (window.location.href !== lastHref) {
    lastHref = window.location.href;
    setTimeout(() => {
      startPriceObserver();
      addFollowButton();
    }, 300);
  }
}).observe(document.body, {childList: true, subtree: true});

function getProductName() {
  return document.querySelector('h1[data-test-id="title"]')?.innerText?.trim() || "";
}

function getBlocks(data) {
  return Object.keys(data)
    .filter((key) => window.PRODUCT_KEY_REGEX.test(key))
    .map((key) => data[key]);
}

function cleanPrice(price) {
  if (price === null || price === undefined) return price;
  let num;
  if (typeof price === "number") {
    num = price;
  } else {
    const str = String(price).replace(/[^0-9,.]/g, "");
    num = parseFloat(str.replace(/\./g, "").replace(",", "."));
  }
  if (isNaN(num)) return price;
  return num.toLocaleString("tr-TR");
}

function parseLocalizedPrice(str) {
  return parseFloat(
    String(str)
      .replace(/[^0-9,]/g, "")
      .replace(/\./g, "")
      .replace(",", "."),
  );
}

function updateButton(isFollowed, hasPrice, button) {
  if (!button) return;
  const config = hasPrice
    ? {
        className: isFollowed ? "unfollow-btn" : "follow-btn",
        text: isFollowed ? "⭐ Takipten Çık" : "⭐ Takip Et",
      }
    : {
        className: isFollowed ? "unfollow-btn" : "notify-btn",
        text: isFollowed ? "⭐ Takipten Çık" : "⭐ Stoğa Gelince Bildir",
      };

  button.textContent = config.text;
  button.className = config.className;
}

function addFollowButton() {
  const existing = document.querySelector("#followButton");
  if (existing) existing.remove();
  const existingAlarm = document.querySelector("#alarmButton");
  if (existingAlarm) existingAlarm.remove();

  const title = document.querySelector('h1[data-test-id="title"]');
  if (!title) return;

  const hbid = getHBID();
  const product = getProduct(hbid);
  if (!product) return;

  browser.storage.sync.get(null).then((data) => {
    const blocks = getBlocks(data);
    const isFollowed = blocks.some((item) => item.id === hbid);
    const followedProduct = blocks.find((item) => item.id === hbid);

    const button = document.createElement("button");
    button.id = "followButton";
    updateButton(isFollowed, !!product.firstPrice, button);

    const alarmButton = document.createElement("button");
    alarmButton.id = "alarmButton";
    alarmButton.className = "alarm-btn";
    const hasAlarm = followedProduct?.targetPrice != null && followedProduct.targetPrice !== "";
    alarmButton.textContent = `🔔 ${hasAlarm ? "Alarm Güncelle" : "Alarm Kur"}`;

    const wrapper = document.createElement("div");
    wrapper.id = "followButtonWrapper";
    wrapper.appendChild(button);
    wrapper.appendChild(alarmButton);

    const targetElement = title.parentElement || title;
    targetElement.insertAdjacentElement("afterend", wrapper);
    button.addEventListener("click", toggleFollow);
    alarmButton.addEventListener("click", () => openAlarmModal(hbid, product, alarmButton));

    checkCheaperSeller();
    window.getPriceHistory(hbid);
  });
}

async function checkCheaperSeller() {
  const bestSeller = await findBestSeller();
  insertCheaperSellerBox(bestSeller);
}

function insertCheaperSellerBox(bestSeller) {
  document.querySelector(".cheaper-seller-box")?.remove();

  if (!bestSeller?.price || !bestSeller?.currentPrice) return;
  if (bestSeller.price >= bestSeller.currentPrice) return;

  const wrapper = document.querySelector("#followButtonWrapper");
  if (!wrapper) return;

  const box = document.createElement("div");
  box.className = "cheaper-seller-box";
  box.innerHTML = `💰 Bu ürünü <strong>${bestSeller.price.toLocaleString("tr-TR")} TL</strong> fiyatına satan farklı bir satıcı var. <a href="${bestSeller.merchantUrl}">Satıcıya git</a>`;

  wrapper.insertAdjacentElement("afterend", box);
}

async function getProductImage() {
  const scripts = [...document.querySelectorAll("script")];
  const target = scripts.find((s) => s.textContent.includes('"formattedPrice"'));
  const urlMatch = target?.textContent.match(/"url"\s*:\s*"(https:\/\/productimages\.hepsiburada\.net[^"]+)"/);
  const picUrl = urlMatch?.[1]?.replace("{size}", "200") || null;

  if (!picUrl) return {base64: null, url: null};

  try {
    const res = await fetch(picUrl);
    if (!res.ok) return {base64: null, url: picUrl};
    const blob = await res.blob();
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
    return {base64: base64 || null, url: picUrl};
  } catch {
    return {base64: null, url: picUrl};
  }
}

async function findBestSeller() {
  const hbid = getHBID();
  if (!hbid) return null;
  try {
    const res = await fetch(`https://www.hepsiburada.com/api/v1/product/listings/${hbid}`, {
      headers: {accept: "application/json"},
    });
    if (!res.ok) return null;
    const json = await res.json();
    const listings = json?.data?.listings;
    if (!listings?.length) return null;
    const base = hbid ? `https://www.hepsiburada.com/-p-${hbid}` : window.location.href.split("?")[0];
    const currentMerchant = new URLSearchParams(window.location.search).get("magaza");
    let best = null;
    let currentPrice = null;
    for (const listing of listings) {
      if (!listing.isSalable) continue;
      const price = listing.minimumPrices?.find((p) => p.name === "non-segmented-price")?.value ?? listing.price?.value;
      const urlPostfix = listing.merchantInfo?.urlPostfix;
      if (!price || !urlPostfix) continue;
      if (!best || price < best.price) {
        best = {price, url: base, merchantUrl: `${base}?magaza=${encodeURIComponent(listing.merchantName)}&`};
      }
      if (currentMerchant && listing.merchantName === currentMerchant) {
        currentPrice = price;
      }
    }
    if (best) best.currentPrice = currentPrice ?? best.price;
    return best;
  } catch {
    return null;
  }
}

async function resolvePrice(bestSeller) {
  bestSeller = bestSeller || (await findBestSeller());
  return bestSeller?.price ? `${bestSeller.price.toLocaleString("tr-TR")} TL` : null;
}

function buildFollowEntry(product, extras = {}) {
  const {id, name, url, firstPrice} = product;
  return {
    id,
    date: formatDateTime(),
    name,
    url,
    firstPrice: cleanPrice(firstPrice),
    ...(firstPrice === null && {outOfStock: true}),
    ...extras,
  };
}

async function toggleFollow() {
  const hbid = getHBID();
  if (!hbid) return;

  try {
    const product = getProduct(hbid);
    const data = await browser.storage.sync.get(null);
    let followList = getBlocks(data);
    const index = followList.findIndex((item) => item.id === hbid);
    const date = formatDateTime();

    if (index === -1) {
      const {id, name, url} = product;
      const bestSeller = await findBestSeller();
      const bestPrice = await resolvePrice(bestSeller);
      const bestUrl = bestSeller?.url ?? url;
      followList.push(buildFollowEntry({...product, firstPrice: bestPrice, url: bestUrl}));

      const result = await saveToSync(followList);
      if (!result.success) {
        if (result.message.includes("doldu")) {
          toast(result.message, "error");
        }
        return;
      }

      const {base64: pic, url: picUrl} = await getProductImage();
      await saveToDB([{id, date, pic, picUrl}]);

      toast("Takip listesine eklendi", "success");
      const barcode = getBarcode();
      await saveToMysl(id, bestPrice, bestUrl, name, barcode);
      addFollowButton();
    } else {
      followList.splice(index, 1);
      await removeFromSync(hbid);
      await removeFromDB(hbid);
      await saveToSync(followList);

      toast("Takip listesinden silindi", "warning");
      addFollowButton();
    }
  } catch (error) {
    console.error("toggleFollow hata:", error);
  }
}

async function openAlarmModal(hbid, product, alarmButton) {
  const currentPrice = product.firstPrice || "";

  const overlay = document.createElement("div");
  overlay.id = "alarmModalOverlay";
  overlay.className = "alarm-modal-overlay";

  const box = document.createElement("div");
  box.className = "alarm-modal-box";

  const title = document.createElement("div");
  title.className = "alarm-modal-title";
  title.textContent = "🔔 Hedef Fiyat Belirle";

  const productName = document.createElement("div");
  productName.className = "alarm-modal-product-name";
  productName.textContent = product.name;

  const input = document.createElement("input");
  input.type = "text";
  input.value = currentPrice ? cleanPrice(currentPrice.replace(/[^0-9,]/g, "")) : "";
  input.placeholder = "Hedef fiyat girin...";
  input.className = "alarm-modal-input";

  input.addEventListener("input", function (e) {
    let raw = e.target.value.replace(/[^0-9,]/g, "");
    let num = parseLocalizedPrice(raw);
    if (!isNaN(num)) {
      e.target.value = num.toLocaleString("tr-TR");
    }
  });

  const errorDiv = document.createElement("div");
  errorDiv.className = "alarm-modal-error";

  const actions = document.createElement("div");
  actions.className = "alarm-modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "İptal";
  cancelBtn.className = "alarm-modal-cancel";

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Kaydet";
  saveBtn.className = "alarm-modal-save";

  const pctRow = document.createElement("div");
  pctRow.id = "modal-pct-row";
  [5, 10, 20, 30, 40, 50].forEach((pct) => {
    const btn = document.createElement("button");
    btn.textContent = `%${pct}`;
    btn.type = "button";
    btn.addEventListener("click", () => {
      const currentPriceVal = parseLocalizedPrice(currentPrice || "0");
      const target = currentPriceVal * (1 - pct / 100);
      input.value = target.toLocaleString("tr-TR", {minimumFractionDigits: 0, maximumFractionDigits: 2});
    });
    pctRow.appendChild(btn);
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Hedefi Sil";
  deleteBtn.className = "alarm-modal-delete";
  deleteBtn.addEventListener("click", async () => {
    const data = await browser.storage.sync.get(null);
    let followList = getBlocks(data);
    const index = followList.findIndex((item) => item.id === hbid);
    if (index !== -1) {
      followList[index].targetPrice = null;
      await saveToSync(followList);
    }
    close();
    toast("Alarm silindi.", "success");
    addFollowButton();
  });

  actions.appendChild(deleteBtn);
  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  box.append(title, productName, input, pctRow, errorDiv, actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  setTimeout(() => input.focus(), 50);

  const close = () => overlay.remove();
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  saveBtn.addEventListener("click", async () => {
    const val = parseLocalizedPrice(input.value.trim());
    const currentPriceVal = parseLocalizedPrice(currentPrice || "0");

    if (isNaN(val) || val <= 0) {
      errorDiv.textContent = "Geçerli bir fiyat girin.";
      return;
    }
    if (currentPriceVal > 0 && val >= currentPriceVal) {
      errorDiv.textContent = `Hedef fiyat mevcut fiyattan (${currentPrice}) düşük olmalı.`;
      return;
    }

    const data = await browser.storage.sync.get(null);
    let followList = getBlocks(data);
    const index = followList.findIndex((item) => item.id === hbid);

    if (index === -1) {
      const {id, name, url} = product;
      const bestSeller = await findBestSeller();
      const bestPrice = await resolvePrice(bestSeller);
      const bestUrl = bestSeller?.url ?? url;
      followList.push(buildFollowEntry({...product, firstPrice: bestPrice, url: bestUrl}, {targetPrice: cleanPrice(val)}));
      const result = await saveToSync(followList);
      if (!result.success) {
        errorDiv.textContent = result.message;
        return;
      }
      const {base64: pic, url: picUrl} = await getProductImage();
      await saveToDB([{id, date: formatDateTime(), pic, picUrl}]);
      const barcode = getBarcode();
      await saveToMysl(id, bestPrice, bestUrl, name, barcode);
    } else {
      followList[index].targetPrice = cleanPrice(val);
      await saveToSync(followList);
    }

    close();
    toast("Alarm kuruldu!", "success");
    addFollowButton();
  });
}

function getProduct(hbid) {
  if (!hbid) return null;
  const name = getProductName();
  const url = getHBURL();
  const price = getPrice();

  const variantValues = [...document.querySelectorAll('[data-test-id="variant-value"]')].map((el) => el.textContent.trim()).filter(Boolean);
  const fullName = variantValues.length ? `${name} (${variantValues.join(", ")})` : name;

  return {
    id: hbid,
    name: fullName,
    url,
    firstPrice: price,
  };
}

function getBarcode() {
  const match = document.documentElement.innerHTML.match(/"product_barcode"\s*:\s*"(\d+)"/);
  return match?.[1] ?? null;
}

async function saveToMysl(id, price, url, name, barcode = null) {
  const cleanedPrice = (price || "").replace(/\s*TL/gi, "").trim();
  if (parseLocalizedPrice(cleanedPrice) === 0) return;
  price = cleanedPrice;
  try {
    const data = new URLSearchParams();
    data.append("productId", id);
    data.append("price", price);
    data.append("url", url);
    data.append("productName", name);
    if (barcode) data.append("barcode", barcode);
    data.append("platform", "hb");
    const auth = await window.getAuthHeaders();
    const res = await fetch("https://aft.web.tr/extension/SavePrice.php", {
      method: "POST",
      headers: {"Content-Type": "application/x-www-form-urlencoded", ...auth},
      body: data,
    });
    if (!res.ok) throw new Error("Veri gönderme sırasında hata oluştu.");
  } catch (error) {
    console.error("Veri gönderilirken hata oluştu:", error.message);
  }
}

function toast(message, type) {
  const box = document.createElement("div");
  box.className = `toast ${type}`;
  box.innerText = message;
  document.body.querySelector(".toast")?.remove();
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 3000);
}

window.getLivePrice = getPrice;
window.toast = toast;
window.findBestSeller = findBestSeller;

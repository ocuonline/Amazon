//background > update.js (bu açıklamayı silme)
import {LastUpdateTime, parsePrice, buildPrice, formatTL} from "./utils.js";
import {fetchProductAmazon, domProductAmazon} from "./price.amazon.js";
import {sendPriceChange, sendDeletedProduct} from "./sendUrl.js";
import {fetchProductHB, domProductHB} from "./price.hb.js";
import {getAllFromSync, saveToSync} from "./storage.js";
import {sendNotification} from "./notifications.js";

if (typeof browser === "undefined") {
  var browser = chrome;
}

let isCancelled = false;
let writeQueue = Promise.resolve();

function queueWrite(fn) {
  writeQueue = writeQueue.then(fn);
  return writeQueue;
}

export function cancelPriceCheck() {
  isCancelled = true;
}

export async function checkPrices(productId = null, onProductChecked = null) {
  isCancelled = false;
  if (!productId) await browser.storage.local.set({checkedIds: []});
  const initialList = await getAllFromSync();
  const idsToCheck = productId ? [productId] : initialList.map((p) => p.id);

  const {settings: s = {}} = await browser.storage.sync.get("settings");
  const concurrentLimit = Math.max(1, parseInt(s.concurrentLimit, 10) || 3);
  const fetchMode = s.fetchMode ?? "fetch";

  async function checkSingle(id, current, total) {
    if (isCancelled) return;

    const freshList = await getAllFromSync();
    const product = freshList.find((p) => p.id === id);
    if (!product) {
      return;
    }

    await browser.storage.local.set({
      checkProgress: {current, total, currentId: id, currentName: product.name},
    });

    const prevPrice = product.newPrice ?? product.firstPrice ?? null;
    const oldPrice = parsePrice(product.firstPrice);
    const fetchedPrice = prevPrice !== null ? parsePrice(prevPrice) : 0;
    const targetPrice = parsePrice(product.targetPrice);

    const isHB = product.url.includes("hepsiburada.com");
    const prevOutOfStock = product.outOfStock;
    let updateResult;
    try {
      updateResult = await updateProductPrice(product, fetchMode);
    } catch (_) {
      updateResult = {newPrice: product.newPrice, outOfStock: product.outOfStock};
    }
    const {newPrice: updatedPrice, outOfStock, deleted} = updateResult;
    if (deleted) {
      console.log(`Ürün silinmiş -> ${product.id}`);
      await sendDeletedProduct(product.id);
      const updatedList = await getAllFromSync();
      const idx = updatedList.findIndex((p) => p.id === id);
      if (idx >= 0) {
        updatedList[idx].deleted = true;
        await saveToSync(updatedList);
      }
      if (onProductChecked) onProductChecked(id);
      return;
    }

    const newPrice = parsePrice(updatedPrice);
    const resolvedPrev = prevPrice !== null ? parsePrice(prevPrice) : null;
    if (resolvedPrev !== null && parsePrice(updatedPrice) !== resolvedPrev) {
      const data = (await browser.storage.local.get(product.id))[product.id] || {};
      await browser.storage.local.set({[product.id]: {...data, oldPrice: prevPrice}});
    }
    product.newPrice = updatedPrice;
    product.outOfStock = outOfStock ?? false;
    let priceChanged = false;

    if (product.outOfStock) {
      const stockOutData = (await browser.storage.local.get(product.id))[product.id] || {};
      if (!stockOutData.stockOutDate) {
        stockOutData.stockOutDate = Date.now();
        delete stockOutData.stockIn;
        delete stockOutData.stockInDate;
        await browser.storage.local.set({[product.id]: stockOutData});
      }
    }

    if (prevOutOfStock === true && outOfStock === false && parsePrice(updatedPrice) > 0) {
      console.log(`Stoğa girdi -> ${product.id}: ${newPrice}`);
      if (!product.firstPrice) {
        product.firstPrice = updatedPrice;
      }
      const stockInData = (await browser.storage.local.get(product.id))[product.id] || {};
      stockInData.stockIn = true;
      stockInData.stockInDate = Date.now();
      delete stockInData.stockOutDate;
      await browser.storage.local.set({[product.id]: stockInData});
      try {
        await sendNotification(product, product.firstPrice, product.newPrice, "stock");
      } catch (e) {
        console.error("sendNotification hatası", e);
      }
      try {
        await sendPriceChange(product.id, product.newPrice, isHB ? "hb" : "amazon");
      } catch (e) {
        console.error("sendPriceChange hatası", e);
      }
      priceChanged = true;
    } else if (targetPrice > 0 && newPrice > 0 && newPrice <= targetPrice && updatedPrice !== prevPrice) {
      console.log(`Hedef fiyata ulaştı -> ${product.id}: ${newPrice} <= ${targetPrice}`);
      await sendNotification(product, prevPrice, product.newPrice, "targetPrice");
      await sendPriceChange(product.id, product.newPrice, isHB ? "hb" : "amazon");
      priceChanged = true;
    } else if (!isNaN(newPrice) && newPrice > 0 && product.firstPrice !== null) {
      const comparePrice = fetchedPrice > 0 ? fetchedPrice : oldPrice;
      const comparePriceRaw = fetchedPrice > 0 ? prevPrice : product.firstPrice;

      if (comparePrice > 0 && newPrice < comparePrice) {
        console.log(`Fiyat düştü -> ${product.id}: ${comparePrice} -> ${newPrice}`);
        await sendNotification(product, comparePriceRaw, product.newPrice, "discount");
        await sendPriceChange(product.id, product.newPrice, isHB ? "hb" : "amazon");
        priceChanged = true;
      } else if (comparePrice > 0 && newPrice > comparePrice) {
        console.log(`Fiyat arttı -> ${product.id}: ${comparePrice} -> ${newPrice}`);
        await sendNotification(product, comparePriceRaw, product.newPrice, "priceIncrease");
        await sendPriceChange(product.id, product.newPrice, isHB ? "hb" : "amazon");
        priceChanged = true;
      }
    }

    try {
      await queueWrite(() => saveToSync([product]));
    } catch (e) {
      console.error("saveToSync hatası", e);
    }

    if (priceChanged) {
      updateBadgeCount([{...product, prevPrice, outOfStock: product.outOfStock, _prevOutOfStock: prevOutOfStock}]);
      const {badgeProducts = []} = await browser.storage.local.get("badgeProducts");
      if (!badgeProducts.includes(product.id)) {
        badgeProducts.push(product.id);
        await browser.storage.local.set({badgeProducts});
      }
    }

    const {checkedIds: prevChecked = []} = await browser.storage.local.get("checkedIds");
    await browser.storage.local.set({checkedIds: [...prevChecked, id]});
    const delay = Math.floor(Math.random() * 1000) + 1000;
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (onProductChecked) onProductChecked(id);
  }

  for (let i = 0; i < idsToCheck.length; i += concurrentLimit) {
    if (isCancelled) {
      console.log("Fiyat kontrolü iptal edildi.");
      break;
    }
    const group = idsToCheck.slice(i, i + concurrentLimit);
    await Promise.all(group.map((id, j) => checkSingle(id, i + j + 1, idsToCheck.length)));
  }
  if (!productId) {
    await LastUpdateTime();
  }

  await browser.storage.local.remove("checkProgress");
}

export async function updateProductPrice(product, fetchMode) {
  try {
    if (!fetchMode) {
      const {settings: s = {}} = await browser.storage.sync.get("settings");
      fetchMode = s.fetchMode ?? "fetch";
    }
    const isHB = product.url.includes("hepsiburada.com");
    const {
      price: currentPrice,
      stockCount,
      promoText,
      installment,
      condition,
      deleted,
      bestSeller,
      campaigns,
    } = isHB
      ? fetchMode === "dom"
        ? await domProductHB(product.url)
        : await fetchProductHB(product.url)
      : fetchMode === "dom"
        ? await domProductAmazon(product.url)
        : await fetchProductAmazon(product.url);

    if (deleted) {
      return {newPrice: product.newPrice, outOfStock: product.outOfStock, deleted: true};
    }
    if (isHB && bestSeller && bestSeller.price > 0) {
      const bestPriceStr = formatTL(bestSeller.price);
      product.url = bestSeller.url;
      const prevPrice = product.newPrice ?? product.firstPrice;
      if (bestPriceStr !== prevPrice) {
        product.newPriceDate = Date.now();
      }
      product.newPrice = bestPriceStr;
      const productData = (await browser.storage.local.get(product.id))[product.id] || {};
      if (installment != null) {
        productData.installment = installment;
      } else {
        delete productData.installment;
      }
      if (campaigns?.length) {
        productData.campaigns = campaigns;
      } else {
        delete productData.campaigns;
      }
      await browser.storage.local.set({[product.id]: productData});
      return {newPrice: bestPriceStr, newPriceDate: product.newPriceDate, outOfStock: false};
    }

    const productData = (await browser.storage.local.get(product.id))[product.id] || {};
    if (stockCount !== null) {
      productData.stockCount = stockCount;
    } else {
      delete productData.stockCount;
    }
    if (!isHB) {
      if (promoText) {
        productData.promoText = promoText;
      } else {
        delete productData.promoText;
      }
    } else if (promoText) {
      productData.promoText = promoText;
    } else {
      delete productData.promoText;
    }
    if (installment != null) {
      productData.installment = installment;
    } else {
      delete productData.installment;
    }
    if (condition) {
      productData.condition = condition;
    } else {
      delete productData.condition;
    }
    await browser.storage.local.set({[product.id]: productData});

    if (currentPrice && parsePrice(currentPrice) > 0) {
      const prevPrice = product.newPrice ?? product.firstPrice;
      if (currentPrice !== prevPrice) {
        product.newPriceDate = Date.now();
      }
      product.newPrice = currentPrice;
      product.outOfStock = false;
    } else {
      product.outOfStock = true;
      return {newPrice: product.newPrice, newPriceDate: product.newPriceDate, outOfStock: true};
    }
    return {newPrice: product.newPrice, newPriceDate: product.newPriceDate, outOfStock: product.outOfStock};
  } catch (error) {
    return {newPrice: product.newPrice, outOfStock: product.outOfStock};
  }
}

export async function updateBadgeCount(products) {
  if (!Array.isArray(products)) return;

  const counts = products.reduce(
    (acc, p) => {
      const old = parsePrice(p.prevPrice);
      const cur = parsePrice(p.newPrice);
      if (cur <= 0) return acc;
      if (old > 0 && cur < old) acc.discount++;
      else if (p._prevOutOfStock === true && p.outOfStock === false && parsePrice(p.newPrice) > 0) acc.stock++;
      else if (old > 0 && cur > old) acc.increase++;
      return acc;
    },
    {discount: 0, stock: 0, increase: 0},
  );

  let stored;
  try {
    stored = await browser.storage.local.get("badgeCounts");
  } catch (e) {
    stored = {};
  }
  const prev = stored.badgeCounts || {discount: 0, stock: 0, increase: 0};

  const merged = {
    discount: prev.discount + counts.discount,
    stock: prev.stock + counts.stock,
    increase: prev.increase + counts.increase,
  };

  await browser.storage.local.set({badgeCounts: merged});

  const [count, color] =
    merged.discount > 0
      ? [merged.discount + merged.stock, "#2ECC71"]
      : merged.stock > 0
        ? [merged.stock, "#3498DB"]
        : merged.increase > 0
          ? [merged.increase, "#E74C3C"]
          : [0, ""];

  if (browser.action?.setBadgeText) {
    browser.action.setBadgeText({text: count > 0 ? count.toString() : ""});
    if (count > 0) browser.action.setBadgeBackgroundColor({color});
  }
}

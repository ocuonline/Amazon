// background > update.js (bu açıklamayı silme)
import {LastUpdateTime, parsePrice, formatTL} from "./utils.js";
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

async function fetchWithRetry(fn, retries = 3, delay = 10000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      const wait = delay * Math.pow(2, i);
      console.warn(`Fetch hata (deneme ${i + 1}/${retries}), ${wait}ms sonra tekrar: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
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
    try {
      if (isCancelled) return;

      const freshList = await getAllFromSync();
      if (isCancelled) return;
      const product = freshList.find((p) => p.id === id);
      if (!product) return;

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
      if (isCancelled) return;
      try {
        updateResult = await fetchWithRetry(() => updateProductPrice(product, fetchMode));
      } catch (_) {
        updateResult = {newPrice: product.newPrice, outOfStock: product.outOfStock};
      }
      const {newPrice: updatedPrice, outOfStock = undefined, deleted} = updateResult;

      if (deleted) {
        console.log(`Ürün silinmiş -> ${product.id}`);
        try {
          await sendDeletedProduct(product.id);
        } catch (e) {
          console.error("sendDeletedProduct hatası", e.message);
        }
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
      if (outOfStock !== undefined && outOfStock !== null) product.outOfStock = outOfStock;
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
          console.error("stock sendNotification hatası", e.message);
        }
        try {
          await sendPriceChange(product.id, product.newPrice, isHB ? "hb" : "amazon");
        } catch (e) {
          console.error("stock sendPriceChange hatası", e.message);
        }
        priceChanged = true;
      } else if (targetPrice > 0 && newPrice > 0 && newPrice <= targetPrice && updatedPrice !== prevPrice) {
        console.log(`Hedef fiyata ulaştı -> ${product.id}: ${newPrice} <= ${targetPrice}`);
        try {
          await sendNotification(product, prevPrice, product.newPrice, "targetPrice");
        } catch (e) {
          console.error("targetPrice sendNotification hatası", e.message);
        }
        try {
          await sendPriceChange(product.id, product.newPrice, isHB ? "hb" : "amazon");
        } catch (e) {
          console.error("targetPrice sendPriceChange hatası", e.message);
        }
        priceChanged = true;
      } else if (!isNaN(newPrice) && newPrice > 0 && product.firstPrice !== null) {
        const comparePrice = fetchedPrice > 0 ? fetchedPrice : oldPrice;
        const comparePriceRaw = fetchedPrice > 0 ? prevPrice : product.firstPrice;

        if (comparePrice > 0 && newPrice < comparePrice) {
          console.log(`Fiyat düştü -> ${product.id}: ${comparePrice} -> ${newPrice}`);
          try {
            await sendNotification(product, comparePriceRaw, product.newPrice, "discount");
          } catch (e) {
            console.error("discount sendNotification hatası", e.message);
          }
          try {
            await sendPriceChange(product.id, product.newPrice, isHB ? "hb" : "amazon");
          } catch (e) {
            console.error("discount sendPriceChange hatası", e.message);
          }
          priceChanged = true;
        } else if (comparePrice > 0 && newPrice > comparePrice) {
          console.log(`Fiyat arttı -> ${product.id}: ${comparePrice} -> ${newPrice}`);
          try {
            await sendNotification(product, comparePriceRaw, product.newPrice, "priceIncrease");
          } catch (e) {
            console.error("priceIncrease sendNotification hatası", e.message);
          }
          try {
            await sendPriceChange(product.id, product.newPrice, isHB ? "hb" : "amazon");
          } catch (e) {
            console.error("priceIncrease sendPriceChange hatası", e.message);
          }
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
      const checkDelay = Math.floor(Math.random() * 1000) + 2000;
      await new Promise((resolve) => setTimeout(resolve, checkDelay));
      if (onProductChecked) onProductChecked(id);
    } catch (err) {
      console.error(`checkSingle hata [${id}]:`, err.message);
      if (onProductChecked) onProductChecked(id);
    }
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
    const result = isHB
      ? fetchMode === "dom"
        ? await domProductHB(product.url)
        : await fetchProductHB(product.url)
      : fetchMode === "dom"
        ? await domProductAmazon(product.url)
        : await fetchProductAmazon(product.url);

    const {stockCount, promoText, installment, condition, deleted, outOfStock, bestSeller, campaigns, bestPrice, discountedPrice} = result;

    if (deleted) {
      return {newPrice: product.newPrice, outOfStock: product.outOfStock, deleted: true};
    }

    if (isHB && bestSeller && bestSeller.price > 0) {
      const finalPrice = bestPrice;
      const finalPriceStr = formatTL(finalPrice);

      if (bestSeller.url) {
        product.url = bestSeller.url;
      }
      const prevPrice = product.newPrice ?? product.firstPrice;
      if (finalPriceStr !== prevPrice) {
        product.newPriceDate = Date.now();
      }
      product.newPrice = finalPriceStr;

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
      return {newPrice: finalPriceStr, newPriceDate: product.newPriceDate, outOfStock: false};
    }

    // Amazon veya HB fallback
    const currentPrice = result.price ?? null;
    const productData = (await browser.storage.local.get(product.id))[product.id] || {};
    if (stockCount !== null) {
      productData.stockCount = stockCount;
    } else {
      delete productData.stockCount;
    }
    if (promoText) {
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
    } else if (outOfStock === null) {
      return {newPrice: product.newPrice, newPriceDate: product.newPriceDate, outOfStock: undefined};
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

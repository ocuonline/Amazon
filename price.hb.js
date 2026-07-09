// background > price.hb.js (bu açıklamayı silme)
import {formatTL} from "./utils.js";

if (typeof browser === "undefined") {
  var browser = chrome;
}

function pickBestListing(listings) {
  let bestPrice = Infinity;
  let bestListing = null;
  for (const listing of listings) {
    if (!listing.isSalable) continue;
    const value = listing.minimumPrices?.find((p) => p.name === "non-segmented-price")?.value ?? listing.price?.value;
    if (!value || !listing.merchantName) continue;
    if (value < bestPrice) {
      bestPrice = value;
      bestListing = listing;
    }
  }
  return {bestPrice, bestListing};
}

function parsePageData(pageHtml) {
  const productId = pageHtml.match(/"productId"\s*:\s*"([^"]+)"/)?.[1] ?? pageHtml.match(/HBC[A-Z0-9]+/)?.[0];
  const catsRaw = pageHtml.match(/"rootCategoryList"\s*:\s*(\[[^\]]+\])/)?.[1];
  const rootCategoryList = catsRaw
    ? JSON.parse(catsRaw)
        .map((c) => Number(c.categoryId))
        .filter(Boolean)
    : [];
  const brand = pageHtml.match(/"brand"\s*:\s*"([^"]+)"/)?.[1];
  const definitionName = pageHtml.match(/"definitionName"\s*:\s*"([^"]+)"/)?.[1];
  const definitionId = pageHtml.match(/"definitionId"\s*:\s*(\d+)/)?.[1];
  return {productId, rootCategoryList, brand, definitionName, definitionId};
}

export async function fetchProductHB(url) {
  let pageRes;
  try {
    pageRes = await fetch(url);
  } catch (err) {
    console.error("fetchProductHB: sayfa fetch hatası", err, url);
    return {price: null, outOfStock: true, deleted: false};
  }
  if (!pageRes.ok) {
    if (pageRes.status === 404) return {price: null, outOfStock: false, deleted: true};
    return {price: null, outOfStock: null, deleted: false};
  }
  const pageHtml = await pageRes.text();

  const pageType = pageHtml.match(/name="page_type"\s+content="([^"]+)"/i)?.[1];
  if (pageType === "category") return {price: null, outOfStock: false, deleted: true};

  const hbid = pageHtml.match(/name="page_value"\s+content="([^"]+)"/i)?.[1] ?? null;
  const urlHasVariant = url.includes("-p-") || url.includes("-pm-");
  if (!hbid) return {price: null, outOfStock: null, deleted: false};

  let res;
  try {
    res = await fetch(`https://www.hepsiburada.com/api/v1/product/listings/${hbid}`, {
      headers: {accept: "application/json"},
    });
  } catch (err) {
    console.error("fetchProductHB: listings fetch hatası", err);
    return {price: null, outOfStock: true};
  }
  if (!res.ok) return {price: null, outOfStock: true};

  const json = await res.json();
  const listings = json?.data?.listings ?? [];
  let bestPrice, bestListing;
  try {
    ({bestPrice, bestListing} = pickBestListing(listings));
  } catch (e) {
    return {price: null, outOfStock: true};
  }
  if (!bestListing) return urlHasVariant && hbid ? {price: null, outOfStock: true} : {price: null, outOfStock: null, deleted: false};
  try {
    return await finalizeHB(url, parsePageData(pageHtml), bestPrice, bestListing, hbid);
  } catch (e) {
    console.error("finalizeHB hatası", e);
    return {price: null, outOfStock: true};
  }
}

async function finalizeHB(url, pageData, bestPrice, bestListing, hbid) {
  const base = url.split("?")[0];
  const best = {
    price: bestPrice,
    url: `${base}?magaza=${encodeURIComponent(bestListing.merchantName)}`,
  };

  const taksitTag = bestListing.tagList?.find((t) => /kredi-karti-\d+-taksit/.test(t.tagId));
  const match = taksitTag?.tagId.match(/kredi-karti-(\d+)-taksit/);
  const installment = match ? Number(match[1]) : null;

  try {
    const {productId, rootCategoryList, brand, definitionName, definitionId} = pageData;
    const tagIds = bestListing.tagList?.map((t) => t.tagId) ?? [];

    const otherRes = await fetch("https://www.hepsiburada.com/api/v1/otherMerchants", {
      method: "POST",
      headers: {"content-type": "application/json", accept: "application/json"},
      body: JSON.stringify({
        userId: "",
        product: {
          productTags: tagIds,
          sku: hbid,
          productId,
          brand,
          rootCategoryList,
          rootBuyingCategoryList: rootCategoryList.length ? [rootCategoryList[rootCategoryList.length - 1]] : [],
          definitionName,
          definitionId,
          taxVatRate: 20,
          campaignIds: bestListing.campaignIds ?? [],
          otherMerchants: [
            {
              productTags: tagIds,
              campaignIds: bestListing.campaignIds ?? [],
              finalPriceOnSale: bestPrice,
              minimumPriceForNLastDays: bestListing.minimumPrice?.value ?? bestPrice,
              merchantId: bestListing.merchantId,
              merchantName: bestListing.merchantName,
              listingId: bestListing.listingId,
            },
          ],
        },
      }),
    });

    if (!otherRes.ok) throw new Error(`otherMerchants HTTP ${otherRes.status}`);
    const otherJson = await otherRes.json();
    const merchantResult = otherJson?.data?.result?.products?.otherMerchants?.find((m) => m.listingId === bestListing.listingId);

    const campaigns = merchantResult?.campaigns?.length ? merchantResult.campaigns.map((c) => ({text: c.text})) : null;

    const discountedPrice = merchantResult?.priceData?.discountedPrice ?? null;

    // Ham veriyi döndür, hangi fiyatın kullanılacağına update.js karar verecek
    return {
      outOfStock: false,
      installment,
      bestSeller: best,
      campaigns,
      bestPrice,
      discountedPrice,
      deleted: false,
    };
  } catch (err) {
    console.error("finalizeHB: otherMerchants hatası", err);
    // otherMerchants başarısız olsa da ham fiyatla devam et
    return {
      outOfStock: false,
      installment,
      bestSeller: best,
      campaigns: null,
      bestPrice,
      discountedPrice: null,
      deleted: false,
    };
  }
}

export async function domProductHB(url) {
  const tab = await browser.tabs.create({url, active: false, pinned: true});
  const tabId = tab.id;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      try {
        browser.tabs.remove(tabId);
      } catch (_) {}
      resolve({price: null, outOfStock: true});
    }, 15000);

    function listener(id, info) {
      if (id !== tabId || info.status !== "complete") return;
      browser.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeout);

      try {
        browser.scripting.executeScript(
          {
            target: {tabId},
            func: async () => {
              const pageType = document.querySelector('meta[name="page_type"]')?.content;
              if (pageType === "category") return {deleted: true};

              const hbid = document.querySelector('meta[name="page_value"]')?.content ?? null;
              if (!hbid) return {price: null, outOfStock: null, deleted: false};

              let listings = [];
              try {
                const res = await fetch(`https://www.hepsiburada.com/api/v1/product/listings/${hbid}`, {
                  headers: {accept: "application/json"},
                });
                if (!res.ok) return {price: null, outOfStock: null, deleted: false};
                const json = await res.json();
                listings = json?.data?.listings ?? [];
              } catch {
                return {price: null, outOfStock: true};
              }

              const pageHtml = document.documentElement.outerHTML;
              const productId = pageHtml.match(/"productId"\s*:\s*"([^"]+)"/)?.[1] ?? pageHtml.match(/HBC[A-Z0-9]+/)?.[0];
              const catsRaw = pageHtml.match(/"rootCategoryList"\s*:\s*(\[[^\]]+\])/)?.[1];
              const rootCategoryList = catsRaw
                ? JSON.parse(catsRaw)
                    .map((c) => Number(c.categoryId))
                    .filter(Boolean)
                : [];
              const brand = pageHtml.match(/"brand"\s*:\s*"([^"]+)"/)?.[1];
              const definitionName = pageHtml.match(/"definitionName"\s*:\s*"([^"]+)"/)?.[1];
              const definitionId = pageHtml.match(/"definitionId"\s*:\s*(\d+)/)?.[1];

              return {hbid, listings, pageData: {productId, rootCategoryList, brand, definitionName, definitionId}};
            },
          },
          async ([result]) => {
            if (browser.runtime.lastError) {
              console.error("domProductHB: lastError", browser.runtime.lastError);
              try {
                browser.tabs.remove(tabId);
              } catch (_) {}
              return resolve({price: null, outOfStock: true});
            }
            try {
              browser.tabs.remove(tabId);
            } catch (_) {}

            const raw = result?.result;
            if (!raw) return resolve({price: null, outOfStock: null, deleted: false});
            if (raw.deleted) return resolve({price: null, outOfStock: false, deleted: true});
            if (raw.price !== undefined || raw.outOfStock !== undefined) return resolve(raw);

            const {hbid, listings, pageData} = raw;
            const urlHasVariant = url.includes("-p-") || url.includes("-pm-");
            const {bestPrice, bestListing} = pickBestListing(listings);
            if (!bestListing) return resolve(urlHasVariant && hbid ? {price: null, outOfStock: true} : {price: null, outOfStock: null, deleted: false});

            try {
              const finalResult = await finalizeHB(url, pageData, bestPrice, bestListing, hbid);
              resolve(finalResult);
            } catch (e) {
              console.error("domProductHB: finalizeHB hatası", e);
              resolve({price: null, outOfStock: true});
            }
          },
        );
      } catch (err) {
        console.error("domProductHB: executeScript hatası", err);
        try {
          browser.tabs.remove(tabId);
        } catch (_) {}
        resolve({price: null, outOfStock: true});
      }
    }
    browser.tabs.onUpdated.addListener(listener);
  });
}

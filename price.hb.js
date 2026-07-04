// background > price.hb.js (bu açıklamayı silme)
import {buildPrice, formatTL} from "./utils.js";

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

export async function fetchProductHB(url) {
  let pageRes;
  try {
    pageRes = await fetch(url);
  } catch (err) {
    console.error("fetchProductHB: sayfa fetch hatası", err, url);
    return {price: null, outOfStock: true, deleted: false};
  }
  if (!pageRes.ok) return {price: null, outOfStock: true, deleted: false};
  const pageHtml = await pageRes.text();

  const pageType = pageHtml.match(/name="page_type"\s+content="([^"]+)"/i)?.[1];
  if (pageType !== "pdp") return {price: null, outOfStock: false, deleted: true};

  const hbid = pageHtml.match(/name="page_value"\s+content="([^"]+)"/i)?.[1] ?? null;
  if (!hbid) return {price: null, outOfStock: true};

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
  if (!bestListing) return {price: null, outOfStock: true};
  try {
    return await finalizeHB(url, pageHtml, bestPrice, bestListing, hbid);
  } catch (e) {
    console.error("finalizeHB hatası", e);
    return {price: null, outOfStock: true};
  }
}

async function finalizeHB(url, pageHtml, bestPrice, bestListing, hbid) {
  const base = url.split("?")[0];
  const best = {
    price: bestPrice,
    url: `${base}?magaza=${encodeURIComponent(bestListing.merchantName)}`,
  };

  let priceStr = formatTL(bestPrice);

  const taksitTag = bestListing.tagList?.find((t) => /kredi-karti-\d+-taksit/.test(t.tagId));
  const match = taksitTag?.tagId.match(/kredi-karti-(\d+)-taksit/);
  const installment = match ? Number(match[1]) : null;

  let campaigns = null;

  try {
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

    if (merchantResult?.campaigns?.length) {
      campaigns = merchantResult.campaigns.map((c) => ({text: c.text}));
    }

    const discountedPrice = merchantResult?.priceData?.discountedPrice;
    if (discountedPrice > 0 && discountedPrice < bestPrice) {
      priceStr = formatTL(discountedPrice);
    }
  } catch (err) {
    console.error("finalizeHB: otherMerchants hatası", err);
  }

  return {price: priceStr, outOfStock: false, installment, bestSeller: best, campaigns, deleted: false};
}

export async function domProductHB(url) {
  const tab = await browser.tabs.create({url, active: false, pinned: true});
  const tabId = tab.id;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      browser.tabs.remove(tabId);
      resolve({price: null, outOfStock: true});
    }, 15000);

    function listener(id, info) {
      if (id !== tabId || info.status !== "complete") return;
      browser.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeout);

      browser.scripting.executeScript(
        {
          target: {tabId},
          func: async () => {
            function formatTL(price) {
              return price.toLocaleString("tr-TR", {maximumFractionDigits: 2}).replace(/,00$/, "");
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

            const pageHtml = document.documentElement.outerHTML;
            const pageType = document.querySelector('meta[name="page_type"]')?.content;
            if (pageType !== "pdp") return {price: null, outOfStock: false, deleted: true};

            const hbid = document.querySelector('meta[name="page_value"]')?.content ?? null;
            if (!hbid) return {price: null, outOfStock: true};

            let listings = [];
            try {
              const res = await fetch(`https://www.hepsiburada.com/api/v1/product/listings/${hbid}`, {
                headers: {accept: "application/json"},
              });
              if (!res.ok) return {price: null, outOfStock: true};
              const json = await res.json();
              listings = json?.data?.listings ?? [];
            } catch {
              return {price: null, outOfStock: true};
            }

            const {bestPrice, bestListing} = pickBestListing(listings);
            if (!bestListing) return {price: null, outOfStock: true};

            const base = window.location.href.split("?")[0];
            const bestSeller = {price: bestPrice, url: `${base}?magaza=${encodeURIComponent(bestListing.merchantName)}`};

            let priceStr = formatTL(bestPrice);
            const taksitTag = bestListing.tagList?.find((t) => /kredi-karti-\d+-taksit/.test(t.tagId));
            const match = taksitTag?.tagId.match(/kredi-karti-(\d+)-taksit/);
            const installment = match ? Number(match[1]) : null;

            let campaigns = null;

            try {
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

              if (merchantResult?.campaigns?.length) {
                campaigns = merchantResult.campaigns.map((c) => ({text: c.text}));
              }

              const discountedPrice = merchantResult?.priceData?.discountedPrice;
              if (discountedPrice > 0 && discountedPrice < bestPrice) {
                priceStr = formatTL(discountedPrice);
              }
            } catch (err) {
              console.error("domProductHB: otherMerchants hatası", err);
            }

            return {price: priceStr, outOfStock: false, installment, bestSeller, campaigns, deleted: false};
          },
        },
        ([result]) => {
          browser.tabs.remove(tabId);
          resolve(result?.result ?? {price: null, outOfStock: false});
        },
      );
    }
    browser.tabs.onUpdated.addListener(listener);
  });
}

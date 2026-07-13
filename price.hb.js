// background > price.hb.js (bu açıklamayı silme)
if (typeof browser === "undefined") {
  var browser = chrome;
}

export async function fetchProductHB(url) {
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

    let rootCategoryList = [];
    try {
      const catsMatch = pageHtml.match(/"rootCategoryList"\s*:\s*(\[[\s\S]*?\])\s*(?:,|\})/);
      if (catsMatch?.[1]) {
        rootCategoryList = JSON.parse(catsMatch[1])
          .map((c) => Number(c.categoryId))
          .filter(Boolean);
      }
    } catch (e) {
      console.error("parsePageData: rootCategoryList ayrıştırma hatası", e.message);
    }

    const brand = pageHtml.match(/"brand"\s*:\s*"([^"]+)"/)?.[1];
    const definitionName = pageHtml.match(/"definitionName"\s*:\s*"([^"]+)"/)?.[1];
    const definitionId = pageHtml.match(/"definitionId"\s*:\s*(\d+)/)?.[1];
    return {productId, rootCategoryList, brand, definitionName, definitionId};
  }

  async function finalizeHB(url, pageData, bestPrice, bestListing, hbid) {
    const base = url.split("?")[0];
    const best = {
      price: bestPrice,
      url: `${base}?magaza=${encodeURIComponent(bestListing.merchantName)}`,
    };

    try {
      const {productId, rootCategoryList, brand, definitionName, definitionId} = pageData;
      const tagIds = bestListing.tagList?.map((t) => t.tagId) ?? [];

      const promoRes = await fetch("https://www.hepsiburada.com/api/v1/withoutAffordability", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          referer: "https://www.hepsiburada.com/",
          origin: "https://www.hepsiburada.com",
          "x-gotham_App-Key": "All",
          "x-gotham_is_enabled_evaluate_coupon": "true",
          "x-gotham_is_enabled_next_eligible_campaign": "true",
          "x-gotham_is_include_payment_campaigns": "true",
          "x-gotham_is_include_premium_clubs": "true",
        },
        body: JSON.stringify({
          userId: "",
          product: {
            productTags: tagIds,
            finalPrice: bestPrice,
            sku: hbid,
            listingId: bestListing.listingId,
            productId,
            brand,
            merchantId: bestListing.merchantId,
            rootCategoryList,
            rootBuyingCategoryList: rootCategoryList.length ? [rootCategoryList[rootCategoryList.length - 1]] : [],
            campaignIds: bestListing.campaignIds ?? [],
            definitionName,
            definitionId,
            finalPriceOnSale: bestPrice,
            taxVatRate: 20,
          },
        }),
      });

      if (!promoRes.ok) {
        console.warn(`withoutAffordability ${promoRes.status}, devam ediliyor`);
        return {outOfStock: false, installment: null, bestSeller: best, campaigns: null, bestPrice, deleted: false};
      }

      const promoJson = await promoRes.json();
      const promoData = promoJson?.data?.result?.product?.promoData?.data;
      const affordability = promoJson?.data?.result?.affordabilityRequest?.additionalData;

      const installment = affordability?.installmentCount ?? null;

      const discountList = promoData?.campaigns?.campaignTabDetailList?.discountCampaignList ?? [];
      const shippingList = promoData?.campaigns?.campaignTabDetailList?.freeShippingCampaignList ?? [];
      const allCampaigns = [...discountList, ...shippingList].map((c) => ({text: c.name}));
      const campaigns = allCampaigns.length ? allCampaigns : null;

      return {
        outOfStock: false,
        installment,
        bestSeller: best,
        campaigns,
        bestPrice,
        deleted: false,
      };
    } catch (err) {
      console.error("finalizeHB: withoutAffordability hatası", err);
      return {
        outOfStock: false,
        installment: null,
        bestSeller: best,
        campaigns: null,
        bestPrice,
        deleted: false,
      };
    }
  }

  let pageRes;
  try {
    pageRes = await fetch(url);
  } catch (err) {
    console.error("fetchProductHB: sayfa fetch hatası", err, url);
    return {price: null, outOfStock: null, deleted: false};
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
    return {price: null, outOfStock: null};
  }
  if (!res.ok) return {price: null, outOfStock: null};

  const json = await res.json();
  const listings = json?.data?.listings ?? [];
  let bestPrice, bestListing;
  try {
    ({bestPrice, bestListing} = pickBestListing(listings));
  } catch (e) {
    console.error("fetchProductHB: pickBestListing hatası", e.message);
    return {price: null, outOfStock: null};
  }
  if (!bestListing) return urlHasVariant && hbid ? {price: null, outOfStock: true} : {price: null, outOfStock: null, deleted: false};
  try {
    return await finalizeHB(url, parsePageData(pageHtml), bestPrice, bestListing, hbid);
  } catch (e) {
    console.error("finalizeHB hatası", e);
    return {price: null, outOfStock: null};
  }
}

export async function domProductHB(url) {
  const tab = await browser.tabs.create({url, active: false, pinned: true});
  const tabId = tab.id;
  return new Promise((resolve) => {
    let settled = false;
    let activeTimeout;

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(activeTimeout);
      browser.tabs.onUpdated.removeListener(listener);
      try {
        browser.tabs.remove(tabId);
      } catch (_) {}
    }

    function settleWith(value) {
      cleanup();
      resolve(value);
    }

    activeTimeout = setTimeout(() => {
      settleWith({price: null, outOfStock: null});
    }, 15000);

    function listener(id, info) {
      if (id !== tabId || info.status !== "complete") return;
      if (settled) return;
      browser.tabs.onUpdated.removeListener(listener);

      browser.scripting
        .executeScript({
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
              return {price: null, outOfStock: null};
            }

            const pageHtml = document.documentElement.outerHTML;
            const productId = pageHtml.match(/"productId"\s*:\s*"([^"]+)"/)?.[1] ?? pageHtml.match(/HBC[A-Z0-9]+/)?.[0];
            const catsMatch = pageHtml.match(/"rootCategoryList"\s*:\s*(\[[\s\S]*?\])\s*(?:,|\})/);
            const rootCategoryList = catsMatch?.[1]
              ? JSON.parse(catsMatch[1])
                  .map((c) => Number(c.categoryId))
                  .filter(Boolean)
              : [];
            const brand = pageHtml.match(/"brand"\s*:\s*"([^"]+)"/)?.[1];
            const definitionName = pageHtml.match(/"definitionName"\s*:\s*"([^"]+)"/)?.[1];
            const definitionId = pageHtml.match(/"definitionId"\s*:\s*(\d+)/)?.[1];

            const urlHasVariant = location.href.includes("-p-") || location.href.includes("-pm-");

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

            if (!bestListing) {
              return urlHasVariant && hbid ? {price: null, outOfStock: true} : {price: null, outOfStock: null, deleted: false};
            }

            const base = location.href.split("?")[0];
            const best = {
              price: bestPrice,
              url: `${base}?magaza=${encodeURIComponent(bestListing.merchantName)}`,
            };

            const tagIds = bestListing.tagList?.map((t) => t.tagId) ?? [];

            let installment = null;
            let campaigns = null;

            try {
              const promoRes = await fetch("https://www.hepsiburada.com/api/v1/withoutAffordability", {
                method: "POST",
                credentials: "include",
                headers: {
                  "content-type": "application/json",
                  accept: "application/json",
                  "x-gotham_App-Key": "All",
                  "x-gotham_is_enabled_evaluate_coupon": "true",
                  "x-gotham_is_enabled_next_eligible_campaign": "true",
                  "x-gotham_is_include_payment_campaigns": "true",
                  "x-gotham_is_include_premium_clubs": "true",
                },
                body: JSON.stringify({
                  userId: "",
                  product: {
                    productTags: tagIds,
                    finalPrice: bestPrice,
                    sku: hbid,
                    listingId: bestListing.listingId,
                    productId,
                    brand,
                    merchantId: bestListing.merchantId,
                    rootCategoryList,
                    rootBuyingCategoryList: rootCategoryList.length ? [rootCategoryList[rootCategoryList.length - 1]] : [],
                    campaignIds: bestListing.campaignIds ?? [],
                    definitionName,
                    definitionId,
                    finalPriceOnSale: bestPrice,
                    taxVatRate: 20,
                  },
                }),
              });

              if (promoRes.ok) {
                const promoJson = await promoRes.json();
                const promoData = promoJson?.data?.result?.product?.promoData?.data;
                const affordability = promoJson?.data?.result?.affordabilityRequest?.additionalData;
                installment = affordability?.installmentCount ?? null;
                const discountList = promoData?.campaigns?.campaignTabDetailList?.discountCampaignList ?? [];
                const shippingList = promoData?.campaigns?.campaignTabDetailList?.freeShippingCampaignList ?? [];
                const allCampaigns = [...discountList, ...shippingList].map((c) => ({text: c.name}));
                campaigns = allCampaigns.length ? allCampaigns : null;
              }
            } catch (_) {}

            return {
              outOfStock: false,
              installment,
              bestSeller: best,
              campaigns,
              bestPrice,
              deleted: false,
            };
          },
        })
        .then(([result]) => {
          const raw = result?.result;
          if (!raw) return settleWith({price: null, outOfStock: null, deleted: false});
          if (raw.deleted) return settleWith({price: null, outOfStock: false, deleted: true});
          settleWith(raw);
        })
        .catch((err) => {
          console.error("domProductHB: executeScript hatası", err);
          settleWith({price: null, outOfStock: null});
        });
    }
    browser.tabs.onUpdated.addListener(listener);
  });
}

// background > price.amazon.js (bu açıklamayı silme)
import {buildPrice, parsePrice, formatTL} from "./utils.js";

if (typeof browser === "undefined") {
  var browser = chrome;
}

export async function fetchProductAmazon(url) {
  async function fetchHtml(targetUrl) {
    try {
      const res = await fetch(targetUrl, {
        credentials: "include",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "tr-TR,tr;q=0.9",
          "Cache-Control": "no-cache",
          "Upgrade-Insecure-Requests": "1",
        },
      });
      if (!res.ok) {
        if (res.status === 404) return {html: null, deleted: true};
        return {html: null, deleted: false};
      }
      return {html: await res.text(), deleted: false};
    } catch (err) {
      console.error("fetchHtml hatası", err);
      return {html: null, deleted: false};
    }
  }

  const isProductUrl = url.includes("/dp/") || url.includes("/gp/product/");
  let {html, deleted} = await fetchHtml(url);
  if (html === null) {
    if (deleted && !isProductUrl) return {price: null, stockCount: null, promoText: null, outOfStock: false, deleted: true};
    if (deleted && isProductUrl) return {price: null, stockCount: null, promoText: null, outOfStock: true, deleted: false};
    return {price: null, stockCount: null, promoText: null, outOfStock: null, deleted: false};
  }

  if (html && html.includes("black-curtain-yes-button")) {
    const yesHref = html.match(/id="black-curtain-yes-button"[\s\S]*?href="([^"]+)"/)?.[1];
    if (yesHref) {
      const yesUrl = yesHref.startsWith("http") ? yesHref : `https://www.amazon.com.tr${yesHref}`;
      let result;
      try {
        result = await fetchHtml(yesUrl);
      } catch (err) {
        console.error("black-curtain yesUrl hatası", err);
        return {price: null, stockCount: null, promoText: null, deleted: false};
      }
      if (result.html === null) return {price: null, stockCount: null, promoText: null, deleted: result.deleted};
      html = result.html;
    }
  }

  // Fiyat
  let price = null;
  const containerIDs = ["corePrice_feature_div", "corePriceDisplay_desktop_feature_div"];
  for (const id of containerIDs) {
    const block = html.match(new RegExp(`<div[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)</div>`, "i"))?.[1];
    if (!block) continue;
    const whole = block.match(/a-price-whole[^>]*>([\d.,]+)/)?.[1]?.trim();
    const fraction = block.match(/a-price-fraction[^>]*>(\d+)/)?.[1]?.trim() ?? "00";
    if (whole) {
      price = buildPrice(whole, fraction);
      break;
    }
  }
  if (!price) {
    const fallback = html.match(
      /<span[^>]*class=["'][^"']*a-price[^"']*a-size-medium[^"']*["'][^>]*>[\s\S]*?<span[^>]*class=["'][^"']*a-offscreen[^"']*["'][^>]*>([^<]+)<\/span>/i,
    )?.[1];
    price = fallback?.trim() ?? null;
  }

  // Stok adedi
  const stockMatch = html.match(/<span[^>]*class=["'][^"']*primary-availability-message[^"']*["'][^>]*>\s*Stokta sadece\s+(\d+)\s+adet kaldı\.\s*<\/span>/i);
  const stockCount = stockMatch ? parseInt(stockMatch[1], 10) : null;

  // Promo
  const marker = 'id="promoPriceBlockMessage_feature_div"';
  const markerPos = html.indexOf(marker);
  let promoText = null;
  if (markerPos !== -1) {
    const tagStart = html.lastIndexOf("<", markerPos);
    let depth = 1,
      i = tagStart,
      end = -1;
    while (i < html.length) {
      if (html[i] === "<") {
        if (html.startsWith("</div", i)) {
          if (--depth === 0) {
            end = i;
            break;
          }
        } else if (html.startsWith("<div", i)) depth++;
      }
      i++;
    }
    const block = end !== -1 ? html.slice(tagStart, end) : "";
    promoText =
      block
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ")
        .replace(/&[Uu]uml;/g, (m) => (m[1] === "U" ? "Ü" : "ü"))
        .replace(/&[Oo]uml;/g, (m) => (m[1] === "O" ? "Ö" : "ö"))
        .replace(/&[Cc]cedil;/g, (m) => (m[1] === "C" ? "Ç" : "ç"))
        .replace(/&[Ii]acute;/g, (m) => (m[1] === "I" ? "İ" : "ı"))
        .replace(/&[Gg]breve;/g, (m) => (m[1] === "G" ? "Ğ" : "ğ"))
        .replace(/&[Ss]cedil;/g, (m) => (m[1] === "S" ? "Ş" : "ş"))
        .replace(/\s+/g, " ")
        .replace(/12 aya varan taksit[\s\S]*/i, "")
        .replace(/Taksitler[\s\S]*/i, "")
        .replace(/\{[\s\S]*\}/g, "")
        .replace(/Kaydol\s*/gi, "")
        .replace(/Kayıtlı\s*/gi, "")
        .replace(/Daha fazla bilgi alın\s*/gi, "")
        .replace(/(.{20,}?)\s+\1/g, "$1")
        .trim() || null;
  }

  let installment = 0;
  const tableMatches = html.matchAll(/id="[^"]*-table-container"[\s\S]*?<\/table>/gi);
  for (const tableMatch of tableMatches) {
    const rows = tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi);
    for (const row of rows) {
      const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      if (cells.length < 3) continue;
      const vadeFarki = cells[2][1]
        .replace(/<[^>]+>/g, "")
        .trim()
        .toLowerCase();
      if (vadeFarki.includes("ücretsiz")) {
        const taksit = parseInt(cells[0][1].replace(/<[^>]+>/g, "").trim());
        if (taksit > installment) installment = taksit;
      }
    }
  }
  const conditionBlock = html.match(/usedOnlyLayoutCondition_feature_div[\s\S]*?offer-display-feature-text-message">([^<]+)<\/span>/);
  const condition = conditionBlock
    ? conditionBlock[1]
        .replace(/&nbsp;/g, " ")
        .replace(/^İkinci El\s*-\s*/i, "")
        .trim()
    : null;

  const outOfStock = isProductUrl && (!price || parsePrice(price) <= 0);
  return {price, stockCount, promoText, installment: installment || null, condition, outOfStock};
}

export async function domProductAmazon(url) {
  const tab = await browser.tabs.create({url, active: false, pinned: true});
  const tabId = tab.id;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      try {
        browser.tabs.remove(tabId);
      } catch (_) {}
      resolve({price: null, stockCount: null, promoText: null, outOfStock: true});
    }, 15000);

    function listener(id, info) {
      if (id !== tabId || info.status !== "complete") return;

      browser.tabs
        .get(tabId)
        .then((currentTab) => {
          if (currentTab.url && (currentTab.url.includes("/black-curtain/") || currentTab.url.includes("/errors/validateCaptcha"))) {
            browser.scripting.executeScript({
              target: {tabId},
              func: () => {
                const yesBtn = document.querySelector("#black-curtain-yes-button a");
                if (yesBtn) {
                  yesBtn.click();
                  return;
                }
                const captchaBtn = document.querySelector('form[action="/errors/validateCaptcha"] button[type="submit"]');
                if (captchaBtn) captchaBtn.click();
              },
            });
            return;
          }

          browser.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);

          const tabUrl = currentTab.url ?? url;
          const isProductUrl = tabUrl.includes("/dp/") || tabUrl.includes("/gp/product/");
          if (!isProductUrl) {
            try {
              browser.tabs.remove(tabId);
            } catch (_) {}
            resolve({price: null, stockCount: null, promoText: null, outOfStock: false, deleted: true});
            return;
          }

          try {
            browser.scripting.executeScript(
              {
                target: {tabId},
                func: () => {
                  const containerIDs = ["corePrice_feature_div", "corePriceDisplay_desktop_feature_div"];
                  let whole = null,
                    fraction = "00";
                  for (const id of containerIDs) {
                    const el = document.getElementById(id);
                    if (!el) continue;
                    whole = el.querySelector(".a-price-whole")?.textContent?.trim().replace(/,+$/, "");
                    fraction = el.querySelector(".a-price-fraction")?.textContent?.replace(/\./g, "").trim() ?? "00";
                    if (whole) break;
                  }
                  if (!whole) {
                    const fallback = document.querySelector(".a-price.a-size-medium .a-offscreen");
                    if (fallback) {
                      whole = fallback.textContent.trim();
                      fraction = null;
                    }
                  }
                  const stockEl = document.querySelector(".primary-availability-message");
                  const stockMatch = stockEl?.textContent?.match(/Stokta sadece\s+(\d+)\s+adet/i);
                  const stockCount = stockMatch ? parseInt(stockMatch[1], 10) : null;
                  const promoEl = document.querySelector("#promoPriceBlockMessage_feature_div");
                  const promoText = promoEl
                    ? promoEl.innerText
                        .replace(/\s+/g, " ")
                        .replace(/<script[\s\S]*?<\/script>/gi, "")
                        .replace(/<style[\s\S]*?<\/style>/gi, "")
                        .replace(/12 aya varan taksit[\s\S]*/i, "")
                        .replace(/Taksitler[\s\S]*/i, "")
                        .replace(/\{[\s\S]*\}/g, "")
                        .replace(/Kaydol\s*/gi, "")
                        .replace(/Kayıtlı\s*/gi, "")
                        .replace(/Daha fazla bilgi alın\s*/gi, "")
                        .replace(/(.{20,}?)\s+\1/g, "$1")
                        .trim() || null
                    : null;
                  let installment = 0;
                  document.querySelectorAll('[id$="-table-container"]').forEach((el) => {
                    el.querySelectorAll("tr").forEach((row) => {
                      const cells = row.querySelectorAll("td");
                      if (cells.length < 3) return;
                      const vadeFarki = cells[2].textContent.trim().toLowerCase();
                      if (vadeFarki.includes("ücretsiz")) {
                        const taksit = parseInt(cells[0].textContent.trim());
                        if (taksit > installment) installment = taksit;
                      }
                    });
                  });
                  const conditionEl = document.querySelector("#usedOnlyLayoutCondition_feature_div .offer-display-feature-text-message");
                  const condition = conditionEl ? conditionEl.innerText.replace(/İkinci El\s*-\s*/i, "").trim() : null;
                  return {whole, fraction, stockCount, promoText, installment: installment || null, condition};
                },
              },
              ([result]) => {
                if (browser.runtime.lastError) {
                  console.error("domProductAmazon: lastError", browser.runtime.lastError);
                  try {
                    browser.tabs.remove(tabId);
                  } catch (_) {}
                  return resolve({price: null, stockCount: null, promoText: null, outOfStock: true});
                }
                try {
                  browser.tabs.remove(tabId);
                } catch (_) {}
                const {whole, fraction, stockCount, promoText, installment, condition} = result?.result ?? {};
                let price = null;
                try {
                  price = buildPrice(whole, fraction ?? null);
                } catch (e) {
                  console.error("buildPrice hatası", e);
                }
                const outOfStock = price && parsePrice(price) > 0 ? false : true;
                resolve({price, stockCount, promoText, installment, condition, outOfStock});
              },
            );
          } catch (err) {
            console.error("domProductAmazon: executeScript hatası", err);
            try {
              browser.tabs.remove(tabId);
            } catch (_) {}
            resolve({price: null, stockCount: null, promoText: null, outOfStock: null});
          }
        })
        .catch((err) => {
          console.error("tabs.get hatası", err);
          clearTimeout(timeout);
          browser.tabs.onUpdated.removeListener(listener);
          resolve({price: null, stockCount: null, promoText: null, deleted: false});
        });
    }
    browser.tabs.onUpdated.addListener(listener);
  });
}

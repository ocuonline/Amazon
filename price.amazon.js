// background > price.amazon.js (bu açıklamayı silme)
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

  if (html && (html.includes("black-curtain-yes-button") || html.includes('action="/errors/validateCaptcha"'))) {
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
      if (!html.includes('id="ASIN"')) return {price: null, stockCount: null, promoText: null, outOfStock: null, deleted: false};
    } else {
      const amzn = html.match(/name="amzn"\s+value="([^"]+)"/)?.[1];
      const amznR = html.match(/name="amzn-r"\s+value="([^"]+)"/)?.[1];
      const keywords = html.match(/name="field-keywords"\s+value="([^"]+)"/)?.[1];
      if (amzn && amznR) {
        const params = new URLSearchParams({amzn, "amzn-r": amznR});
        if (keywords) params.set("field-keywords", keywords);
        const bypassUrl = `https://www.amazon.com.tr/errors/validateCaptcha?${params.toString()}`;
        console.log("[captcha] bypass url:", bypassUrl);
        let result;
        try {
          result = await fetchHtml(bypassUrl);
        } catch (err) {
          console.error("captcha bypass hatası", err);
          return {price: null, stockCount: null, promoText: null, deleted: false};
        }
        if (result.html === null) return {price: null, stockCount: null, promoText: null, deleted: result.deleted};
        html = result.html;
        if (!html.includes('id="ASIN"')) return {price: null, stockCount: null, promoText: null, outOfStock: null, deleted: false};
      }
    }
  }

  // Fiyat
  let price = null;
  const rawAmount =
    html.match(/<input[^>]+id="items\[0\.base\]\[customerVisiblePrice\]\[amount\]"[^>]+value="([^"]+)"/)?.[1] ??
    html.match(/<input[^>]+value="([^"]+)"[^>]+id="items\[0\.base\]\[customerVisiblePrice\]\[amount\]"/)?.[1];
  price = rawAmount ? +rawAmount : null;

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

  const outOfStock = !isProductUrl ? null : !price || price <= 0;
  return {price, stockCount, promoText, installment: installment || null, condition, outOfStock};
}

export async function domProductAmazon(url) {
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
      settleWith({price: null, stockCount: null, promoText: null, outOfStock: true});
    }, 15000);

    function listener(id, info) {
      if (settled || id !== tabId || info.status !== "complete") return;

      browser.scripting
        .executeScript({
          target: {tabId},
          func: () => {
            const hasBlackCurtain = !!document.querySelector("#black-curtain-yes-button");
            const hasCaptchaForm = !!document.querySelector('form[action="/errors/validateCaptcha"]');
            return {hasBlackCurtain, hasCaptchaForm};
          },
        })
        .then(async (results) => {
          if (settled) return;
          const {hasBlackCurtain, hasCaptchaForm} = results?.[0]?.result ?? {};

          if (hasBlackCurtain || hasCaptchaForm) {
            if (!settled) {
              clearTimeout(activeTimeout);
              activeTimeout = setTimeout(() => {
                settleWith({price: null, stockCount: null, promoText: null, outOfStock: true});
              }, 15000);
            }

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

          const isProductUrl = url.includes("/dp/") || url.includes("/gp/product/");
          if (!isProductUrl) {
            settleWith({price: null, stockCount: null, promoText: null, outOfStock: false, deleted: true});
            return;
          }

          if (settled) return;
          let asinCheck;
          try {
            asinCheck = await browser.scripting.executeScript({
              target: {tabId},
              func: () => !!document.querySelector("#ASIN"),
            });
          } catch (err) {
            console.error("domProductAmazon: asinCheck hatası", err);
            settleWith({price: null, stockCount: null, promoText: null, outOfStock: null, deleted: false});
            return;
          }
          if (!asinCheck?.[0]?.result) {
            settleWith({price: null, stockCount: null, promoText: null, outOfStock: null, deleted: false});
            return;
          }

          if (settled) return;
          browser.scripting
            .executeScript({
              target: {tabId},
              func: () => {
                const priceInput = document.getElementById("items[0.base][customerVisiblePrice][amount]");
                const rawAmount = priceInput?.value ?? null;
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
                return {rawAmount, stockCount, promoText, installment: installment || null, condition};
              },
            })
            .then((results) => {
              const {rawAmount, stockCount, promoText, installment, condition} = results?.[0]?.result ?? {};
              const price = rawAmount ? +rawAmount : null;
              const parsedPrice = price ?? 0;
              const outOfStock = parsedPrice <= 0;
              settleWith({price, stockCount, promoText, installment, condition, outOfStock});
            })
            .catch((err) => {
              console.error("domProductAmazon: executeScript hatası", err);
              settleWith({price: null, stockCount: null, promoText: null, outOfStock: null});
            });
        })
        .catch((err) => {
          console.error("domProductAmazon: checkResult hatası", err);
          settleWith({price: null, stockCount: null, promoText: null, outOfStock: true});
        });
    }

    browser.tabs.onUpdated.addListener(listener);
  });
}

// content.hb.js
const {saveToSync, removeFromSync} = window.storage.sync;

const browser = globalThis.browser ?? globalThis.chrome;

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
const hrefObserver = new MutationObserver(() => {
  if (window.location.href !== lastHref) {
    lastHref = window.location.href;
    setTimeout(() => {
      startPriceObserver();
      addFollowButton();
    }, 300);
  }
});
hrefObserver.observe(document.body, {childList: true, subtree: true});

function getProductName() {
  return document.querySelector('h1[data-test-id="title"]')?.innerText?.trim() || "";
}

function addFollowButton() {
  document.querySelector("#followButtonWrapper")?.remove();
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
    alarmButton.addEventListener("click", () =>
      openAlarmModal(hbid, product, alarmButton, {
        resolveProduct: async (p) => {
          const bestSeller = await findBestSeller();
          const bestPrice = await resolvePrice(bestSeller);
          return {...p, firstPrice: bestPrice, url: bestSeller?.url ?? p.url};
        },
        onSave: async (resolved) => {
          const {id, url, name, firstPrice} = resolved;
          const {base64: pic, url: picUrl} = await getProductImage();
          const barcode = getBarcode();
          await saveToDB([{id, date: formatDateTime(), pic, picUrl}]);
          await saveToMysql(id, firstPrice, url, name, "hb", barcode);
        },
        onRefresh: () => addFollowButton(),
      }),
    );

    checkCheaperSeller();
    window.getPriceHistory(hbid, "hb");
  });
}

async function checkCheaperSeller() {
  const bestSeller = await findBestSeller();
  insertCheaperSellerBox(bestSeller);
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
  } catch (error) {
    console.error("findBestSeller hata:", error);
    return null;
  }
}

async function resolvePrice(bestSeller) {
  bestSeller = bestSeller || (await findBestSeller());
  const price = bestSeller?.price ?? null;
  return price !== null ? Math.round(price * 100) / 100 : null;
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
      await saveToMysql(id, bestPrice, bestUrl, name, "hb", barcode);
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

window.getLivePrice = getPrice;
window.findBestSeller = findBestSeller;

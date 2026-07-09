// content.amazon.js
const {saveToSync, removeFromSync} = window.storage.sync;

if (typeof browser === "undefined") {
  var browser = chrome;
}

async function saveToDB(order) {
  return new Promise((resolve) => {
    browser.runtime.sendMessage({action: "saveToDB", order}, (response) => {
      resolve(response);
    });
  });
}

async function removeFromDB(id) {
  return new Promise((resolve) => {
    browser.runtime.sendMessage({action: "removeFromDB", id}, (response) => {
      resolve(response);
    });
  });
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "updateImage" && message.id) {
    const asin = message.id;
    if (getASIN() !== asin) return;

    const product = getProduct(asin);
    if (!product || product.variationsValid === false) return;

    getProductImage().then(async ({base64, url}) => {
      if (base64 || url) {
        await saveToDB([{id: asin, pic: base64, picUrl: url}]);
      }
    });
  }
});

let previousASIN = "";
addFollowButton();
document.querySelector("#twister_feature_div")?.addEventListener("click", () => {
  setTimeout(detectAsinChange, 3000);
});

function getBlocks(data) {
  return Object.keys(data)
    .filter((key) => window.PRODUCT_KEY_REGEX.test(key))
    .map((key) => data[key]);
}

function getPrice() {
  const selectors = ["#corePrice_feature_div", "#corePriceDisplay_desktop_feature_div"];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const getText = (cls, def = "") => el.querySelector(cls)?.textContent.trim() || def;
    const whole = getText(".a-price-whole");
    if (whole) return `${whole}${getText(".a-price-fraction", "00")}${getText(".a-price-symbol")}`;
  }

  const fallback = document.querySelector("#corePrice_feature_div .a-price.a-size-medium .a-offscreen");
  return fallback?.textContent.trim() || null;
}

function getASIN() {
  const match = window.location.href.match(/(?:\/dp\/|\/gp\/product\/|\/)([A-Z0-9]{10})(?:[/?]|$)/);
  return match ? match[1] : null;
}

function detectAsinChange() {
  const currentASIN = getASIN() || "";
  if (currentASIN === previousASIN) return;
  previousASIN = currentASIN;
  addFollowButton();
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

function updateButton(isFollowed, hasPrice, button, forceSelect = false) {
  if (!button) return;
  let config;
  if (forceSelect) {
    config = {className: "notify-btn", text: "Takip Etmek için Seçim Yapın"};
  } else {
    config = hasPrice
      ? {
          className: isFollowed ? "unfollow-btn" : "follow-btn",
          text: isFollowed ? "⭐ Takipten Çık" : "⭐ Takip Et",
        }
      : {
          className: isFollowed ? "unfollow-btn" : "notify-btn",
          text: isFollowed ? "⭐ Takipten Çık" : "⭐ Stoğa Gelince Bildir",
        };
  }

  button.textContent = config.text;
  button.className = config.className;
}

function addFollowButton() {
  const existing = document.querySelector("#followButton");
  if (existing) existing.remove();
  const existingAlarm = document.querySelector("#alarmButton");
  if (existingAlarm) existingAlarm.remove();

  const title = document.querySelector("#productTitle");
  if (!title) return;
  const asin = getASIN();
  const product = getProduct(asin);
  if (!product) return;

  browser.storage.sync.get(null).then((data) => {
    const blocks = getBlocks(data);
    const isFollowed = blocks.some((item) => item.id === asin);
    const followedProduct = blocks.find((item) => item.id === asin);

    const button = document.createElement("button");
    button.id = "followButton";

    updateButton(isFollowed, !!product.firstPrice, button, product.variationsValid === false);

    const alarmButton = document.createElement("button");
    alarmButton.id = "alarmButton";
    alarmButton.className = "alarm-btn";
    const hasAlarm = followedProduct?.targetPrice != null && followedProduct.targetPrice !== "";
    alarmButton.textContent = `🔔 ${hasAlarm ? "Alarm Güncelle" : "Alarm Kur"}`;

    const wrapper = document.createElement("div");
    wrapper.id = "followButtonWrapper";
    wrapper.appendChild(button);
    if (product.variationsValid !== false) wrapper.appendChild(alarmButton);

    title.insertAdjacentElement("afterend", wrapper);
    button.addEventListener("click", toggleFollow);
    alarmButton.addEventListener("click", () => openAlarmModal(asin, product, alarmButton));
    window.getPriceHistory(asin);
    window.fetchCanonicalPrice(asin);
  });
}

async function getProductImage() {
  const imgEl = document.querySelector("#imgTagWrapperId img") || document.querySelector(".imgTagWrapper img");

  const picUrl = imgEl?.getAttribute("src") || null;
  if (!imgEl || !picUrl) return {base64: null, url: null};

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

function parseLocalizedPrice(str) {
  return parseFloat(
    String(str)
      .replace(/[^0-9,]/g, "")
      .replace(/\./g, "")
      .replace(",", "."),
  );
}

async function openAlarmModal(asin, product, alarmButton) {
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
  input.value = currentPrice ? formatNumberForDisplay(currentPrice.replace(/[^0-9,]/g, "")) : "";
  input.placeholder = "Hedef fiyat girin...";
  input.className = "alarm-modal-input";

  function formatNumberForDisplay(value) {
    let num = value.replace(/\./g, "").replace(",", ".");
    let floatNum = parseFloat(num);
    if (isNaN(floatNum)) return value;
    return floatNum.toLocaleString("tr-TR");
  }

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

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Hedefi Sil";
  deleteBtn.className = "alarm-modal-delete";
  deleteBtn.addEventListener("click", async () => {
    const data = await browser.storage.sync.get(null);
    let followList = getBlocks(data);
    const index = followList.findIndex((item) => item.id === asin);
    if (index !== -1) {
      followList[index].targetPrice = null;
      await saveToSync(followList);
    }
    close();
    toast("Alarm silindi.", "success");
    addFollowButton();
  });

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
    const index = followList.findIndex((item) => item.id === asin);

    if (index === -1) {
      const {id, name, url} = product;
      const firstPrice = (await fetchCanonicalPrice(id)) || product.firstPrice;
      const productWithCanonical = {...product, firstPrice};
      followList.push(buildFollowEntry(productWithCanonical, {targetPrice: cleanPrice(val)}));
      const result = await saveToSync(followList);
      if (!result.success) {
        errorDiv.textContent = result.message;
        return;
      }
      const {base64: pic, url: picUrl} = await getProductImage();
      await saveToDB([
        {id, date: new Date().toLocaleString("tr-TR", {day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"}), pic, picUrl},
      ]);
      await saveToMysl(id, firstPrice, url, name);
    } else {
      followList[index].targetPrice = cleanPrice(val);
      await saveToSync(followList);
    }

    close();
    toast("Alarm kuruldu!", "success");
    addFollowButton();
  });
}

function buildFollowEntry(product, extras = {}) {
  const {id, name, url, firstPrice} = product;
  return {
    id,
    date: new Date().toLocaleString("tr-TR", {day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"}),
    name,
    url,
    firstPrice: cleanPrice(firstPrice),
    ...(firstPrice === null && {outOfStock: true}),
    ...extras,
  };
}

async function toggleFollow() {
  const asin = getASIN();
  if (!asin) return;

  try {
    const product = getProduct(asin);
    if (product && product.variationsValid === false) {
      toast("Takip edebilmek için lütfen renk ve beden seçiniz", "warning");
      return;
    }

    const data = await browser.storage.sync.get(null);
    let followList = getBlocks(data);
    const index = followList.findIndex((item) => item.id === asin);
    const date = new Date().toLocaleDateString("tr-TR");

    if (index === -1) {
      const {id, name, url} = product;
      const firstPrice = (await fetchCanonicalPrice(id)) || product.firstPrice;
      const productWithCanonical = {...product, firstPrice};
      followList.push(buildFollowEntry(productWithCanonical));

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
      await saveToMysl(id, firstPrice, url, name);
      addFollowButton();
    } else {
      followList.splice(index, 1);
      await removeFromSync(asin);
      await removeFromDB(asin);
      await saveToSync(followList);

      toast("Takip listesinden silindi", "warning");
      addFollowButton();
    }
  } catch (error) {
    console.error("toggleFollow hata:", error);
  }
}

async function saveToMysl(id, price, url, name) {
  if (parseLocalizedPrice(price || "0") === 0) return;
  try {
    const data = new URLSearchParams();
    data.append("productId", id);
    data.append("price", price);
    data.append("url", url);
    data.append("productName", name);
    data.append("platform", "amazon");
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

function getProduct(asin) {
  const titleEl = document.querySelector("#productTitle");
  const title = titleEl ? titleEl.innerText.trim() : "";
  const url = `${window.location.origin}/dp/${asin}?th=1&psc=1`;
  const price = getPrice();
  const product = {
    id: asin,
    name: title,
    url,
    firstPrice: price,
    variationsValid: true,
  };

  const moda = document.querySelector("#wayfinding-breadcrumbs_feature_div > ul > li:nth-child(1) > span > a");
  if (moda && moda.innerText.toLowerCase().includes("moda")) {
    const size = document.querySelector("#dropdown_selected_size_name > span > span > span")?.innerText.trim();
    const color = document.querySelector("#dropdown_selected_color_name > span > span > span")?.innerText.trim();
    const inlineSize = document.querySelector("#inline-twister-expanded-dimension-text-size_name")?.innerText.trim();

    if (size === "Seç" || color === "Seç" || ["Beden Seçin", "Numara Seçin", "Ölçü Seçin"].includes(inlineSize || "")) {
      product.variationsValid = false;
    }

    const variations = [
      size,
      inlineSize,
      color,
      document.querySelector("#inline-twister-expanded-dimension-text-color_name")?.innerText,
      document.querySelector("#variation_color_name > div.a-row > span")?.innerText,
    ]
      .filter(Boolean)
      .join(", ");
    if (variations) product.name += ` (${variations})`;
  }

  return product;
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

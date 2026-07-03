// content.sepet.js
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

function toast(message, type) {
  const box = document.createElement("div");
  box.className = `toast ${type}`;
  box.innerText = message;
  document.body.querySelector(".toast")?.remove();
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 3000);
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

async function getProductImageFromUrl(picUrl) {
  if (!picUrl) return {base64: null, url: null};
  const response = await browser.runtime.sendMessage({action: "fetchImageAsBase64", url: picUrl});
  return {base64: response?.base64 ? `data:image/webp;base64,${response.base64}` : null, url: picUrl};
}

async function saveToMysl(id, price, url, name) {
  if (parseLocalizedPrice(price || "0") === 0) return;
  try {
    const data = new URLSearchParams();
    data.append("productId", id);
    data.append("price", price);
    data.append("url", url);
    data.append("productName", name);
    const auth = await window.getAuthHeaders();
    const res = await fetch("https://aft.web.tr/extension/SavePrice.php", {
      method: "POST",
      headers: {"Content-Type": "application/x-www-form-urlencoded", ...auth},
      body: data,
    });
    if (!res.ok) throw new Error("Veri gönderme sırasında hata oluştu.");
    console.log("Veri başarıyla gönderildi.");
  } catch (error) {
    console.error("Veri gönderilirken hata oluştu:", error.message);
  }
}

function getCartProduct(item) {
  const asin = item.dataset.asin;
  if (!asin) return null;

  const rawPrice = item.dataset.price;
  const num = parseFloat(rawPrice);
  const firstPrice = isNaN(num) ? null : num.toLocaleString("tr-TR", {minimumFractionDigits: 2, maximumFractionDigits: 2});

  const name = item.querySelector(".a-truncate-full")?.textContent?.trim() || item.querySelector(".a-truncate-cut")?.textContent?.trim() || "";
  const picUrl = item.querySelector(".sc-product-image")?.src || null;
  const url = `${window.location.origin}/dp/${asin}?th=1&psc=1`;

  const FASHION_LABELS = ["beden", "numara", "renk"];

  const variations = [...item.querySelectorAll(".sc-product-variation")]
    .map((el) => {
      const spans = [...el.querySelectorAll("span.a-size-small")];
      const label = spans
        .find((s) => s.classList.contains("a-text-bold"))
        ?.textContent?.replace(":", "")
        .trim();
      const value = spans.find((s) => !s.classList.contains("a-text-bold"))?.textContent?.trim();
      if (!label || !value) return null;
      if (!FASHION_LABELS.some((f) => label.toLowerCase().includes(f))) return null;
      return `${label}: ${value}`;
    })
    .filter(Boolean)
    .join(", ");

  return {
    id: asin,
    name: variations ? `${name} (${variations})` : name,
    url,
    firstPrice,
    newPrice: null,
    picUrl,
    variationsValid: true,
  };
}

function updateCartButton(button, isFollowed, hasPrice) {
  if (!button) return;
  button.textContent = "⭐ Takip";
  button.className = isFollowed ? "star-btn followed" : "star-btn";
}

async function toggleCartFollow(product, button, alarmButton) {
  const asin = product.id;
  const data = await browser.storage.sync.get(null);
  let followList = getBlocks(data);
  const index = followList.findIndex((item) => item.id === asin);
  const date = new Date().toLocaleDateString("tr-TR");

  if (index === -1) {
    followList.push(buildFollowEntry(product));
    const result = await saveToSync(followList);
    if (!result.success) {
      if (result.message.includes("doldu")) toast(result.message, "error");
      return;
    }
    const {base64: pic, url: picUrl} = await getProductImageFromUrl(product.picUrl);
    await saveToDB([{id: asin, date, pic, picUrl}]);
    await saveToMysl(asin, product.firstPrice, product.url, product.name);
    toast("Takip listesine eklendi", "success");
    updateCartButton(button, true, !!product.firstPrice);
  } else {
    await removeFromSync(asin);
    await removeFromDB(asin);
    toast("Takip listesinden silindi", "warning");
    updateCartButton(button, false, !!product.firstPrice);
  }
}

async function openCartAlarmModal(asin, product, alarmButton) {
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
    if (!isNaN(num)) e.target.value = num.toLocaleString("tr-TR");
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
    const index = followList.findIndex((item) => item.id === asin);
    if (index !== -1) {
      followList[index].targetPrice = null;
      await saveToSync(followList);
    }
    close();
    toast("Alarm silindi.", "success");
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
      followList.push(buildFollowEntry(product, {targetPrice: cleanPrice(val)}));
      const result = await saveToSync(followList);
      if (!result.success) {
        errorDiv.textContent = result.message;
        return;
      }
      const {base64: pic, url: picUrl} = await getProductImageFromUrl(product.picUrl);
      await saveToDB([
        {
          id: asin,
          date: new Date().toLocaleString("tr-TR", {day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"}),
          pic,
          picUrl,
        },
      ]);
      await saveToMysl(asin, product.firstPrice, product.url, product.name);
    } else {
      followList[index].targetPrice = cleanPrice(val);
      await saveToSync(followList);
    }

    close();
    toast("Alarm kuruldu!", "success");
  });
}

function addCartButtons(item) {
  const product = getCartProduct(item);
  if (!product) return;

  const actionLinks = item.querySelector(".sc-action-links");
  if (!actionLinks) return;

  browser.storage.sync.get(null).then((data) => {
    const followList = getBlocks(data);
    const isFollowed = followList.some((p) => p.id === product.id);
    const followedProduct = followList.find((p) => p.id === product.id);
    const hasAlarm = followedProduct?.targetPrice != null && followedProduct.targetPrice !== "";

    const wrapper = document.createElement("div");
    wrapper.className = "cart-follow-wrapper";

    const separator = document.createElement("i");
    separator.className = "a-icon a-icon-text-separator sc-action-separator";
    separator.setAttribute("role", "presentation");

    const followBtn = document.createElement("button");
    followBtn.type = "button";
    followBtn.title = isFollowed ? "Takipten Çık" : "Takip Et";
    followBtn.className = "star-btn";
    updateCartButton(followBtn, isFollowed, !!product.firstPrice);

    const alarmBtn = document.createElement("button");
    alarmBtn.type = "button";
    alarmBtn.title = hasAlarm ? "Alarm Güncelle" : "Alarm Kur";
    alarmBtn.className = "ring-btn";
    alarmBtn.innerHTML = `🔔 Alarm`;

    followBtn.addEventListener("click", () => toggleCartFollow(product, followBtn, alarmBtn));
    alarmBtn.addEventListener("click", () => openCartAlarmModal(product.id, product, alarmBtn));

    wrapper.appendChild(separator);
    wrapper.appendChild(followBtn);
    wrapper.appendChild(alarmBtn);
    actionLinks.appendChild(wrapper);
  });
}

function initCartButtons() {
  document.querySelectorAll("[id^='sc-active-']").forEach((item) => {
    if (!item.dataset.asin) return;
    addCartButtons(item);
  });
}

initCartButtons();

let debounceTimer = null;

const observer = new MutationObserver((mutations) => {
  const hasRelevant = mutations.some(
    (m) =>
      m.target.closest?.("[id^='sc-active-']") &&
      [...m.removedNodes, ...m.addedNodes].some((n) => n.nodeType === 1 && !n.classList?.contains("cart-follow-wrapper")),
  );
  if (!hasRelevant) return;

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    observer.disconnect();
    document.querySelectorAll("[id^='sc-active-']").forEach((item) => {
      if (!item.dataset.asin) return;
      if (!item.querySelector(".cart-follow-wrapper")) addCartButtons(item);
    });
    observer.observe(document.body, {childList: true, subtree: true});
  }, 500);
});

observer.observe(document.body, {childList: true, subtree: true});

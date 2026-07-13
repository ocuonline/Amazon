//content.shared.js

function buildFollowEntry(product, extras = {}) {
  const {id, name, url, firstPrice} = product;
  return {
    id,
    date: formatDateTime(),
    name,
    url,
    firstPrice,
    ...(firstPrice === null && {outOfStock: true}),
    ...extras,
  };
}

function parseLocalizedPrice(str) {
  return parseFloat(
    String(str)
      .replace(/[^0-9,]/g, "")
      .replace(/\./g, "")
      .replace(",", "."),
  );
}

function formatDateTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

function getBlocks(data) {
  return Object.keys(data)
    .filter((key) => window.PRODUCT_KEY_REGEX.test(key))
    .map((key) => data[key]);
}

async function saveToMysql(id, price, url, name, platform, barcode = null) {
  if (!price || price === 0) return;
  try {
    const data = new URLSearchParams();
    data.append("productId", id);
    data.append("price", price);
    data.append("url", url);
    data.append("productName", name);
    data.append("platform", platform);
    if (barcode) data.append("barcode", barcode);
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

function insertCheaperSellerBox(bestSeller) {
  document.querySelector(".cheaper-seller-box")?.remove();

  if (!bestSeller?.price || !bestSeller?.currentPrice) return;
  if (bestSeller.price >= bestSeller.currentPrice) return;

  const wrapper = document.querySelector("#followButtonWrapper");
  if (!wrapper) return;

  const url = bestSeller.merchantUrl ?? bestSeller.url;
  const box = document.createElement("div");
  box.className = "cheaper-seller-box";

  const text = document.createTextNode(`💰 Bu ürünü `);
  const strong = document.createElement("strong");
  strong.textContent = `${bestSeller.price.toLocaleString("tr-TR")} TL`;
  const mid = document.createTextNode(` fiyatına satan farklı bir satıcı var. `);
  const link = document.createElement("a");
  link.href = url;
  link.textContent = "Satıcıya git";

  box.append(text, strong, mid, link);

  wrapper.insertAdjacentElement("afterend", box);
}

async function openAlarmModal(productId, product, alarmButton, callbacks = {}) {
  const {resolveProduct, onSave, onRefresh} = callbacks;
  const currentPrice = product.firstPrice ?? null;

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
  input.value = currentPrice != null ? currentPrice.toLocaleString("tr-TR") : "";
  input.placeholder = "Hedef fiyat girin...";
  input.className = "alarm-modal-input";

  input.addEventListener("input", function (e) {
    const raw = e.target.value.replace(/[^0-9,]/g, "");
    const num = parseLocalizedPrice(raw);
    if (!isNaN(num)) {
      e.target.value = num.toLocaleString("tr-TR");
    }
  });

  const errorDiv = document.createElement("div");
  errorDiv.className = "alarm-modal-error";

  const pctRow = document.createElement("div");
  pctRow.id = "modal-pct-row";
  [5, 10, 20, 30, 40, 50].forEach((pct) => {
    const btn = document.createElement("button");
    btn.textContent = `%${pct}`;
    btn.type = "button";
    btn.addEventListener("click", () => {
      const base = currentPrice ?? 0;
      const target = base * (1 - pct / 100);
      input.value = target.toLocaleString("tr-TR", {minimumFractionDigits: 0, maximumFractionDigits: 2});
    });
    pctRow.appendChild(btn);
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Hedefi Sil";
  deleteBtn.className = "alarm-modal-delete";
  deleteBtn.addEventListener("click", async () => {
    const data = await browser.storage.sync.get(null);
    const followList = getBlocks(data);
    const index = followList.findIndex((item) => item.id === productId);
    if (index !== -1) {
      followList[index].targetPrice = null;
      await saveToSync(followList);
    }
    close();
    toast("Alarm silindi.", "success");
    onRefresh?.();
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "İptal";
  cancelBtn.className = "alarm-modal-cancel";

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Kaydet";
  saveBtn.className = "alarm-modal-save";

  const actions = document.createElement("div");
  actions.className = "alarm-modal-actions";
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
    const currentPriceVal = currentPrice ?? 0;

    if (isNaN(val) || val <= 0) {
      errorDiv.textContent = "Geçerli bir fiyat girin.";
      return;
    }
    if (currentPriceVal > 0 && val >= currentPriceVal) {
      errorDiv.textContent = `Hedef fiyat mevcut fiyattan (${currentPriceVal.toLocaleString("tr-TR")}) düşük olmalı.`;
      return;
    }

    const data = await browser.storage.sync.get(null);
    const followList = getBlocks(data);
    const index = followList.findIndex((item) => item.id === productId);

    if (index === -1) {
      const resolved = resolveProduct ? await resolveProduct(product) : product;
      followList.push(buildFollowEntry(resolved, {targetPrice: val}));
      const result = await saveToSync(followList);
      if (!result.success) {
        errorDiv.textContent = result.message;
        return;
      }
      if (onSave) await onSave(resolved);
    } else {
      followList[index].targetPrice = val;
      await saveToSync(followList);
    }

    close();
    toast("Alarm kuruldu!", "success");
    onRefresh?.();
  });
}

function toast(message, type) {
  const box = document.createElement("div");
  box.className = `toast ${type}`;
  box.innerText = message;
  box.addEventListener("animationend", () => box.remove(), {once: true});
  document.body.appendChild(box);
}

window.toast = toast;

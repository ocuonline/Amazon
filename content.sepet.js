// content.sepet.js
const {saveToSync, removeFromSync} = window.storage.sync;

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

async function getProductImageFromUrl(picUrl) {
  if (!picUrl) return {base64: null, url: null};
  const response = await browser.runtime.sendMessage({action: "fetchImageAsBase64", url: picUrl});
  return {base64: response?.base64 ? `data:image/webp;base64,${response.base64}` : null, url: picUrl};
}

function getCartProduct(item) {
  const asin = item.dataset.asin;
  if (!asin) return null;

  const rawPrice = item.dataset.price;
  const num = parseFloat(rawPrice);
  const firstPrice = isNaN(num) ? null : num;

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

  if (index === -1) {
    followList.push(buildFollowEntry(product));
    const result = await saveToSync(followList);
    if (!result.success) {
      if (result.message.includes("doldu")) toast(result.message, "error");
      return;
    }
    const {base64: pic, url: picUrl} = await getProductImageFromUrl(product.picUrl);
    await saveToDB([{id: asin, date: formatDateTime(), pic, picUrl}]);
    await saveToMysql(asin, product.firstPrice, product.url, product.name, "amazon");
    toast("Takip listesine eklendi", "success");
    updateCartButton(button, true, !!product.firstPrice);
  } else {
    await removeFromSync(asin);
    await removeFromDB(asin);
    toast("Takip listesinden silindi", "warning");
    updateCartButton(button, false, !!product.firstPrice);
  }
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
    alarmBtn.addEventListener("click", () =>
      openAlarmModal(product.id, product, alarmBtn, {
        onSave: async (resolved) => {
          const {base64: pic, url: picUrl} = await getProductImageFromUrl(resolved.picUrl);
          await saveToDB([{id: resolved.id, date: formatDateTime(), pic, picUrl}]);
          await saveToMysql(resolved.id, resolved.firstPrice, resolved.url, resolved.name, "amazon");
        },
        onRefresh: () => {
          item.querySelector(".cart-follow-wrapper")?.remove();
          addCartButtons(item);
        },
      }),
    );

    wrapper.appendChild(separator);
    wrapper.appendChild(followBtn);
    wrapper.appendChild(alarmBtn);
    actionLinks.appendChild(wrapper);
  });
}

function initCartButtons() {
  document.querySelectorAll("[id^='sc-active-']").forEach((item) => {
    if (!item.dataset.asin) return;
    if (!item.querySelector(".cart-follow-wrapper")) addCartButtons(item);
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
    document.querySelectorAll("[id^='sc-active-']").forEach((item) => {
      if (!item.dataset.asin) return;
      if (!item.querySelector(".cart-follow-wrapper")) addCartButtons(item);
    });
  }, 500);
});

observer.observe(document.body, {childList: true, subtree: true});

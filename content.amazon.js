// content.amazon.js
const {saveToSync, removeFromSync} = window.storage.sync;

const browser = globalThis.browser ?? globalThis.chrome;

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

function getPrice() {
  const raw = document.getElementById("items[0.base][customerVisiblePrice][amount]")?.value ?? null;
  if (!raw) return null;
  const num = parseFloat(raw);
  return isNaN(num) ? null : Math.round(num * 100) / 100;
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
    alarmButton.addEventListener("click", () =>
      openAlarmModal(asin, product, alarmButton, {
        resolveProduct: async (p) => {
          const bestSeller = await findBestSeller(p.id);
          const firstPrice = bestSeller?.price || p.firstPrice;
          return {...p, firstPrice};
        },
        onSave: async (resolved) => {
          const {id, url, name, firstPrice} = resolved;
          const {base64: pic, url: picUrl} = await getProductImage();
          await saveToDB([{id, date: formatDateTime(), pic, picUrl}]);
          await saveToMysql(id, firstPrice, url, name, "amazon");
        },
        onRefresh: () => addFollowButton(),
      }),
    );
    window.getPriceHistory(asin, "amazon");
    findBestSeller(asin).then((bestSeller) => insertCheaperSellerBox(bestSeller));
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
    if (index === -1) {
      const {id, name, url} = product;
      const bestSeller = await findBestSeller(id);
      const firstPrice = bestSeller?.price || product.firstPrice;
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
      await saveToDB([{id, date: formatDateTime(), pic, picUrl}]);
      toast("Takip listesine eklendi", "success");
      await saveToMysql(id, firstPrice, url, name, "amazon");
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

async function findBestSeller(asin) {
  try {
    const res = await fetch(`https://www.amazon.com.tr/dp/${asin}?th=1&psc=1`);
    const html = await res.text();
    const match = html.match(/"priceAmount":([\d.]+)/);
    if (!match) return null;
    const num = parseFloat(match[1]);
    if (!Number.isFinite(num)) return null;
    const currentPrice = window.getLivePrice?.() ?? 0;
    return {price: num, url: `https://www.amazon.com.tr/dp/${asin}?th=1&psc=1`, currentPrice};
  } catch (error) {
    console.error("findBestSeller hata:", error);
    return null;
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

window.getLivePrice = getPrice;

// background.js (bu açıklamayı silme)
import {saveToDB, removeFromDB, fixProductData} from "./storage.js";
import {checkPrices} from "./update.js";

if (typeof browser === "undefined") {
  var browser = chrome;
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "clearBadge") {
    browser.action.setBadgeText({text: ""});
    browser.storage.local.remove(["badgeCounts", "badgeProducts"]);
    sendResponse({success: true});
    return true;
  }
  if (message.action === "saveToDB") {
    saveToDB(message.order)
      .then(() => sendResponse({success: true}))
      .catch((error) => sendResponse({success: false, error: error.message}));
    return true;
  }
  if (message.action === "fetchImageAsBase64") {
    fetch(message.url)
      .then((res) => res.blob())
      .then(
        (blob) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(",")[1]);
            reader.readAsDataURL(blob);
          }),
      )
      .then((base64) => sendResponse({base64}))
      .catch(() => sendResponse({base64: null}));
    return true;
  }
  if (message.action === "startPriceCheck") {
    checkPrices();
    sendResponse({started: true});
    return true;
  }
  if (message.action === "removeFromDB") {
    removeFromDB(message.id)
      .then(() => sendResponse({success: true}))
      .catch((error) => sendResponse({success: false, error: error.message}));
    return true;
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.hasOwnProperty("settings")) {
    if (!changes.settings.newValue) {
      const defaultSettings = getDefaultSettings();
      browser.storage.sync.set({settings: defaultSettings}).then(() => {
        console.log("Varsayılan ayarlar geri yüklendi.");
        schedulePriceCheck(defaultSettings);
      });
    } else {
      const oldValue = changes.settings.oldValue || {};
      const newValue = changes.settings.newValue;
      const changed = Object.fromEntries(Object.entries(newValue).filter(([k, v]) => oldValue[k] !== v));
      console.log("Ayarlar değişti:", changed);
      schedulePriceCheck(changes.settings.newValue);
    }
  }
});

async function registerToken() {
  try {
    const extensionId = browser.runtime.id;
    const res = await fetch("https://aft.web.tr/extension/register.php", {
      method: "POST",
      headers: {"Content-Type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({extension_id: extensionId}),
    });
    const data = await res.json();
    if (data.token) {
      await browser.storage.local.set({authToken: data.token});
    }
  } catch (err) {
    console.error("Token alınamadı:", err);
  }
}

browser.runtime.onInstalled.addListener(async (details) => {
  await registerToken();
  const settings = (await browser.storage.sync.get("settings")).settings || getDefaultSettings();
  if (settings.priceCheckInterval !== "0") {
    initializeSettings();
    checkPrices();
  }
  if (details.reason === "update") {
    await fixProductData();
  }
});

browser.runtime.onStartup.addListener(async () => {
  console.log("Tarayıcı yeniden başlatıldı.");
  const settings = (await browser.storage.sync.get("settings")).settings || getDefaultSettings();
  if (settings.priceCheckInterval !== "0") {
    initializeSettings();
    checkPrices();
  }
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "priceCheckAlarm") {
    checkPrices();
  }
});

async function initializeSettings() {
  const defaultSettings = getDefaultSettings();
  const data = await browser.storage.sync.get("settings");
  if (!data.settings) {
    await browser.storage.sync.set({settings: defaultSettings});
    console.log("Varsayılan ayarlar yüklendi.");
    schedulePriceCheck(defaultSettings);
  } else {
    schedulePriceCheck(data.settings);
  }
}

function schedulePriceCheck(settings) {
  if (settings) {
    browser.alarms.clear("priceCheckAlarm");
    if (settings.priceCheckInterval === "0") {
      console.log("Fiyat kontrolü devre dışı bırakıldı.");
      return;
    }
    browser.alarms.create("priceCheckAlarm", {
      periodInMinutes: parseInt(settings.priceCheckInterval),
    });
  } else {
    console.error("Ayarlar yüklenemedi.");
  }
}

function getDefaultSettings() {
  return {
    priceCheckInterval: "60",
    notificationType: "n_on",
    discountNotification: "d_on",
    discountSound: "Capri",
    stockNotification: "s_on",
    stockSound: "Whistle",
    priceIncreaseNotification: "pi_on",
    priceIncreaseSound: "Cuckoo",
    targetPriceNotification: "tp_on",
    targetPriceSound: "som_matricula",
    priceChangeThreshold: "0",
    allVisualNotification: "av_on",
    visualDiscountNotification: "vd_on",
    visualStockNotification: "vs_on",
    visualPriceIncreaseNotification: "vpi_on",
    visualTargetPriceNotification: "vtp_on",
    requireInteraction: "ri_on",
    notificationVolume: 100,
    fetchMode: "fetch",
    concurrentLimit: "1",
  };
}

//background > notifications.js
import {getAllFromSync} from "./storage.js";
import {formatTL} from "./utils.js";

const browser = globalThis.browser ?? globalThis.chrome;
const notificationTargetKey = (notificationId) => `notificationTarget_${notificationId}`;

browser.notifications.onClicked.addListener(async (notificationId) => {
  const key = notificationTargetKey(notificationId);
  const stored = await browser.storage.local.get(key);
  const url = stored[key];
  if (!url) return;
  await browser.storage.local.remove(key);
  await browser.tabs.create({url});
});

browser.notifications.onClosed.addListener((notificationId) => {
  browser.storage.local.remove(notificationTargetKey(notificationId));
});

async function registerNotificationTarget(notificationId, url) {
  await browser.storage.local.set({[notificationTargetKey(notificationId)]: url});
}

export async function sendNotification(product, oldPrice, newPrice, type) {
  const {settings = {}} = await browser.storage.sync.get("settings");
  const threshold = parseFloat(settings.priceChangeThreshold) || 0;
  const oldPriceValue = oldPrice ?? 0;
  const newPriceValue = newPrice ?? 0;
  const priceChange = Math.abs(newPriceValue - oldPriceValue);
  const percentageChange = oldPriceValue ? (priceChange / oldPriceValue) * 100 : 0;
  const percentChangeRounded = Math.round(percentageChange);

  if (type === "stock") {
    const notificationId = `stock_${product.id}`;
    if (settings.allVisualNotification === "av_on" && settings.visualStockNotification === "vs_on" && settings.stockNotification === "s_on") {
      const stockOptions = {
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "",
        message: `Ürün Stoğa Girdi: ₺${formatTL(newPrice)}\n${product.name}`,
      };
      if (typeof chrome?.offscreen !== "undefined") stockOptions.requireInteraction = settings.requireInteraction === "ri_on";
      await registerNotificationTarget(notificationId, product.url);
      browser.notifications.create(notificationId, stockOptions);
    }
    if (settings.notificationType === "n_on" && settings.stockNotification === "s_on") {
      playNotificationSound(settings.stockSound, settings.notificationVolume);
    }
  } else if (type === "targetPrice") {
    const notificationId = `targetPrice_${product.id}`;
    if (settings.allVisualNotification === "av_on" && settings.visualTargetPriceNotification === "vtp_on" && settings.targetPriceNotification === "tp_on") {
      const previousPrice = oldPrice == null ? "" : formatTL(oldPrice);
      const priceMessage = previousPrice
        ? `🎯 Hedef Fiyata Ulaştı: ₺${previousPrice} -> ₺${formatTL(newPrice)}`
        : `🎯 Hedef Fiyata Ulaştı: ₺${formatTL(newPrice)}`;
      const targetOptions = {
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "",
        message: `${priceMessage}\n${product.name}`,
      };
      if (typeof chrome?.offscreen !== "undefined") targetOptions.requireInteraction = settings.requireInteraction === "ri_on";
      await registerNotificationTarget(notificationId, product.url);
      browser.notifications.create(notificationId, targetOptions);
    }
    if (settings.notificationType === "n_on" && settings.targetPriceNotification === "tp_on") {
      playNotificationSound(settings.targetPriceSound, settings.notificationVolume);
    }
  } else if (type === "discount" && percentageChange >= threshold) {
    const notificationId = `discount_${product.id}`;
    if (settings.allVisualNotification === "av_on" && settings.visualDiscountNotification === "vd_on" && settings.discountNotification === "d_on") {
      const discountOptions = {
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "",
        message: `İndirim ₺${formatTL(oldPrice)} -> ₺${formatTL(newPrice)} (%${percentChangeRounded})\n${product.name}`,
      };
      if (typeof chrome?.offscreen !== "undefined") discountOptions.requireInteraction = settings.requireInteraction === "ri_on";
      await registerNotificationTarget(notificationId, product.url);
      browser.notifications.create(notificationId, discountOptions);
    }
    if (settings.notificationType === "n_on" && settings.discountNotification === "d_on") {
      playNotificationSound(settings.discountSound, settings.notificationVolume);
    }
  } else if (type === "priceIncrease" && percentageChange) {
    const notificationId = `priceIncrease_${product.id}`;
    if (settings.allVisualNotification === "av_on" && settings.visualPriceIncreaseNotification === "vpi_on" && settings.priceIncreaseNotification === "pi_on") {
      const increaseOptions = {
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "",
        message: `Zam ₺${formatTL(oldPrice)} -> ₺${formatTL(newPrice)} (%${percentChangeRounded})\n${product.name}`,
      };
      if (typeof chrome?.offscreen !== "undefined") increaseOptions.requireInteraction = settings.requireInteraction === "ri_on";
      await registerNotificationTarget(notificationId, product.url);
      browser.notifications.create(notificationId, increaseOptions);
    }
    if (settings.notificationType === "n_on" && settings.priceIncreaseNotification === "pi_on") {
      playNotificationSound(settings.priceIncreaseSound, settings.notificationVolume);
    }
  }
}

export async function playNotificationSound(url, volume = 100) {
  if (typeof chrome?.offscreen !== "undefined") {
    await ensureOffscreenDocument();
    browser.runtime.sendMessage({action: "playNotificationSound", soundUrl: url, volume}).catch(() => {});
  } else {
    const audio = new Audio(browser.runtime.getURL(`sound/${url}.mp3`));
    audio.volume = Math.min(1, Math.max(0, volume / 100));
    audio.play().catch((error) => console.error("Ses çalma hatası:", error));
  }
}

let offscreenLock = null;

async function ensureOffscreenDocument() {
  if (offscreenLock) return offscreenLock;
  offscreenLock = (async () => {
    try {
      const hasOffscreen = await browser.offscreen.hasDocument();
      if (!hasOffscreen) {
        await browser.offscreen.createDocument({
          url: "offscreen.html",
          reasons: ["AUDIO_PLAYBACK"],
          justification: "Bildirim sesi çalmak için",
        });
      }
    } catch (error) {
      console.error("Offscreen document kontrol edilirken veya yaratılırken hata oluştu:", error);
    } finally {
      offscreenLock = null;
    }
  })();
  return offscreenLock;
}

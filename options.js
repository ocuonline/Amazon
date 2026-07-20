// options.js (bu açıklamayı silme)
import {getAllFromDB, getAllFromSync, saveToSync, STORAGE_CONFIG, clearAllStorage, fixProductData} from "./storage.js";
import {showToast} from "./utils.js";

const browser = globalThis.browser ?? globalThis.chrome;

const settings = [
  "priceCheckInterval",
  "fetchMode",
  "concurrentLimit",
  "notificationType",
  "discountNotification",
  "discountSound",
  "stockNotification",
  "stockSound",
  "priceIncreaseNotification",
  "priceIncreaseSound",
  "targetPriceNotification",
  "targetPriceSound",
  "priceChangeThreshold",
  "allVisualNotification",
  "visualDiscountNotification",
  "visualStockNotification",
  "visualPriceIncreaseNotification",
  "visualTargetPriceNotification",
  "requireInteraction",
  "notificationVolume",
];

const soundOptions = [
  "Capri",
  "Cuckoo",
  "Dewdrop",
  "DingDong",
  "Doorbell",
  "News",
  "Pixiedust",
  "S_Chirps",
  "S_On_Time",
  "S_Opener",
  "S_Postman",
  "S_Pure_Bell",
  "S_Temple_Bell",
  "Whistle",
  "Whistling_Bird",
  "som_matricula",
];

const soundSelectIds = ["discountSound", "stockSound", "priceIncreaseSound", "targetPriceSound"];

const getSettingRow = (nameOrId) => {
  const el = document.querySelector(`[name="${nameOrId}"]`) || document.getElementById(nameOrId);
  return el?.closest(".card-row") || null;
};

const toggleVisibility = (name, condition) => {
  const row = getSettingRow(name);
  if (row) row.classList.toggle("hidden-option", !condition);
};

const updateRangeText = (value) => {
  const el = document.getElementById("rangeValue");
  if (el) el.textContent = value == 0 ? "Her Zaman" : `${value}%`;
};

const updateVolumeText = (value) => {
  const el = document.getElementById("volumeValue");
  if (el) el.textContent = `${value}%`;
};

const toggleSoundOptions = () => {
  const nt = document.querySelector('[name="notificationType"]:checked')?.value;
  const av = document.querySelector('[name="allVisualNotification"]:checked')?.value;
  const soundOn = nt === "n_on";
  const visualOn = av === "av_on";
  const val = (name) => document.querySelector(`[name="${name}"]:checked`)?.value;

  const soundCm = {
    discountNotification: soundOn,
    stockNotification: soundOn,
    priceIncreaseNotification: soundOn,
    targetPriceNotification: soundOn,
    priceChangeThreshold: soundOn,
    requireInteraction: soundOn,
    notificationVolume: soundOn,
  };

  const visualCm = {
    visualDiscountNotification: visualOn,
    visualStockNotification: visualOn,
    visualPriceIncreaseNotification: visualOn,
    visualTargetPriceNotification: visualOn,
  };

  const soundVisibility = {
    discountSound: soundOn && val("discountNotification") === "d_on",
    stockSound: soundOn && val("stockNotification") === "s_on",
    priceIncreaseSound: soundOn && val("priceIncreaseNotification") === "pi_on",
    targetPriceSound: soundOn && val("targetPriceNotification") === "tp_on",
  };

  Object.entries(soundVisibility).forEach(([k, c]) => {
    const el = document.getElementById(k);
    if (el) el.classList.toggle("sound-hidden", !c);
  });
  Object.entries(soundCm).forEach(([k, c]) => toggleVisibility(k, c));
  Object.entries(visualCm).forEach(([k, c]) => toggleVisibility(k, c));
};

const updateSetting = (name, value) => {
  browser.storage.sync.get("settings").then(({settings = {}}) => {
    settings[name] = value;
    browser.storage.sync.set({settings}).then(() => showToast("Ayarlar kaydedildi!", "success"));
  });
};

const populateSoundOptions = () => {
  soundSelectIds.forEach((id) => {
    const select = document.getElementById(id);
    if (select) {
      select.innerHTML = "";
      soundOptions.forEach((sound) => {
        const option = document.createElement("option");
        option.value = sound;
        option.textContent = sound;
        select.appendChild(option);
      });
    }
  });
};

let currentAudio = null;

const playSound = (sound, volume = 100) => {
  try {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    }
    currentAudio = new Audio(`sound/${sound}.mp3`);
    currentAudio.volume = Math.min(1, Math.max(0, volume / 100));
    currentAudio.play().catch(() => showToast(`Ses çalma hatası: ${sound}.mp3 oynatılamadı.`, "error"));
  } catch (e) {
    showToast(`Ses çalma hatası: ${e.message}`, "error");
  }
};

const importProducts = async () => {
  try {
    const input = Object.assign(document.createElement("input"), {type: "file", accept: "application/json"});
    input.onchange = async ({target}) => {
      const file = target.files[0];
      const reader = new FileReader();
      reader.onload = async () => {
        let newList;
        try {
          newList = JSON.parse(reader.result);
        } catch {
          return showToast("Geçersiz JSON formatı: Dosya okunamadı.", "error");
        }
        if (!Array.isArray(newList)) return showToast("Geçersiz JSON formatı: Dizi bekleniyor.", "error");

        const invalid = newList.filter((p) => !p.id || typeof p.id !== "string" || !p.id.trim());
        if (invalid.length) return showToast(`Geçersiz veri: ${invalid.length} ürünün ID alanı eksik veya hatalı.`, "error");

        const existing = await getAllFromSync();
        const ids = new Set(existing.map((p) => p.id));
        const unique = newList.filter((p) => !ids.has(p.id));

        if (!unique.length) return showToast(`İçe aktarılan ${newList.length} ürün zaten listede.`, "info");

        const max = STORAGE_CONFIG.MAX_ITEMS - existing.length;
        const added = Math.min(unique.length, Math.max(max, 0));
        const skipped = unique.length - added;
        const updated = [...existing, ...unique.slice(0, added)];
        const result = await saveToSync(updated);

        showToast(
          result.success ? `${added} yeni ürün eklendi${skipped > 0 ? `, ${skipped} ürün kota nedeniyle atlandı.` : "."}` : result.message,
          result.success ? "success" : "error",
        );
        if (result.success) await fixProductData();
      };
      reader.onerror = () => showToast("Dosya okuma başarısız.", "error");
      reader.readAsText(file);
    };
    input.click();
  } catch (e) {
    showToast(`İçe aktarma başlatılamadı: ${e.message}`, "error");
  }
};

const exportProducts = async () => {
  try {
    const data = await getAllFromSync();
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), {
      href: url,
      download: "Amazon Takip Listesi.json",
    }).click();
    showToast(`${data.length} ürün dışarı aktarıldı.`, "success");
  } catch (e) {
    showToast(`Ürünler dışarı aktarılırken hata oluştu: ${e.message}`, "error");
  }
};

// ── TAB NAVİGASYONU ──
const initTabs = () => {
  const buttons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      buttons.forEach((b) => b.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${target}`)?.classList.add("active");
    });
  });
};

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  populateSoundOptions();

  browser.storage.sync.get("settings").then(({settings: loaded = {}}) => {
    settings.forEach((key) => {
      const val = loaded[key];
      const el = document.querySelector(`[name="${key}"]`);
      if (val !== undefined && el) {
        const radio = document.querySelector(`[name="${key}"][value="${val}"]`);
        if (radio) radio.checked = true;
        else if (["SELECT", "INPUT"].includes(el.tagName)) el.value = val;
      }
    });
    toggleSoundOptions();
    updateRangeText(loaded.priceChangeThreshold);
    updateVolumeText(loaded.notificationVolume ?? 50);
  });

  document.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("change", ({target}) => {
      const {name, value, type} = target;
      const val = type === "range" ? parseInt(value, 10) : value;
      updateSetting(name, val);
      toggleSoundOptions();
      if (name === "priceChangeThreshold") updateRangeText(value);
      if (name === "notificationVolume") {
        updateVolumeText(value);
        const currentSound = document.getElementById("discountSound")?.value ?? "Capri";
        playSound(currentSound, parseInt(value));
      }
    });
  });

  soundSelectIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", (e) => playSound(e.target.value));
  });

  document.getElementById("rehber-btn")?.addEventListener("click", () => {
    window.open("src/popup_rehber.html", "_blank");
  });
  document.getElementById("import-json")?.addEventListener("click", importProducts);
  document.getElementById("export-json")?.addEventListener("click", exportProducts);
  document.getElementById("update-images")?.addEventListener("click", async () => {
    const products = await getAllFromDB();
    const syncList = await getAllFromSync();
    const syncMap = new Map(syncList.map((p) => [p.id, p]));
    const noPic = products.filter((p) => !p.pic).map((p) => ({...p, url: syncMap.get(p.id)?.url ?? null}));

    if (!noPic.length) {
      showToast("Tüm ürünlerin görseli mevcut.", "info");
      return;
    }

    showToast(`${noPic.length} ürün için görsel güncelleme başlatılıyor...`, "info");

    const GROUP_SIZE = 3;

    for (let i = 0; i < noPic.length; i += GROUP_SIZE) {
      const group = noPic.slice(i, i + GROUP_SIZE);
      await Promise.all(
        group.map(async (item) => {
          const tabUrl = item.url;
          if (!tabUrl) return;
          const tab = await browser.tabs.create({
            url: tabUrl,
            active: false,
            pinned: true,
          });
          await new Promise((resolve) => {
            browser.tabs.onUpdated.addListener(function listener(tabId, info) {
              if (tabId === tab.id && info.status === "complete") {
                browser.tabs.onUpdated.removeListener(listener);
                setTimeout(() => {
                  browser.tabs.sendMessage(tab.id, {action: "updateImage", id: item.id});
                  setTimeout(() => {
                    browser.tabs.remove(tab.id);
                    resolve();
                  }, 1500);
                }, 500);
              }
            });
          });
        }),
      );
    }

    showToast(`${noPic.length} ürün için görsel güncelleme tamamlandı.`, "success");
  });

  document.getElementById("clear-data")?.addEventListener("click", async () => {
    if (confirm("Verileri ve ayarları silmek istediğinize emin misiniz?")) {
      await clearAllStorage();
      await browser.storage.sync.remove("settings");
      showToast("Tüm veriler silindi.", "success");
      location.reload();
    }
  });

  try {
    document.getElementById("extension-version").textContent = `v${browser.runtime.getManifest().version}`;
    const icon = document.getElementById("brand-icon");
    if (icon) {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      icon.src = isDark ? "icons/icon48.png" : "icons/darkicon48.png";
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
        icon.src = e.matches ? "icons/icon48.png" : "icons/darkicon48.png";
      });
    }
  } catch (e) {
    showToast(`Eklenti sürümü alınırken hata: ${e.message}`, "error");
  }
});

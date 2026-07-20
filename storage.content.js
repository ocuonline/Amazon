// storage.content.js

const browser = globalThis.browser ?? globalThis.chrome;

const STORAGE_CONFIG = {MAX_ITEMS: 100};
const PRODUCT_KEY_REGEX = /^[A-Z0-9]{10}$|^HB[A-Z0-9]{10,13}$/;
window.PRODUCT_KEY_REGEX = PRODUCT_KEY_REGEX;

window.storage = {
  sync: {
    async saveToSync(items) {
      try {
        if (!Array.isArray(items)) {
          throw new Error("'items' bir dizi olmalıdır.");
        }
        if (items.length === 0) {
          await browser.storage.sync.clear();
          return {success: true, message: "Depolama temizlendi."};
        }

        let itemsToSave = items;
        if (items.length > STORAGE_CONFIG.MAX_ITEMS) {
          itemsToSave = items.slice(0, STORAGE_CONFIG.MAX_ITEMS);
        }

        const groupedData = {};
        for (const item of itemsToSave) {
          groupedData[item.id] = item;
        }
        await browser.storage.sync.set(groupedData);

        return {success: true, message: "Ürünler kaydedildi."};
      } catch (error) {
        return {success: false, message: `İçe aktarma hatası: ${error.message}`};
      }
    },

    async removeFromSync(id) {
      try {
        await browser.storage.sync.remove(id);
        await browser.storage.local.remove(id);
        return true;
      } catch (error) {
        throw new Error(`Ürün silinirken hata oluştu: ${error.message}`);
      }
    },
  },
};

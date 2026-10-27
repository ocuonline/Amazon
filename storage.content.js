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
          const allSync = await browser.storage.sync.get(null);
          const productKeys = Object.keys(allSync).filter((key) => PRODUCT_KEY_REGEX.test(key));
          if (productKeys.length) await browser.storage.sync.remove(productKeys);
          return {success: true, message: "Ürün listesi temizlendi."};
        }

        if (items.length > STORAGE_CONFIG.MAX_ITEMS) {
          return {success: false, message: `Takip listesi en fazla ${STORAGE_CONFIG.MAX_ITEMS} ürün olabilir; liste doldu.`};
        }

        const groupedData = {};
        for (const item of items) {
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

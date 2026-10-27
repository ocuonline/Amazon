//background > sendUrl.js
const browser = globalThis.browser ?? globalThis.chrome;

export async function sendPriceChange(productId, newPrice, platform = "amazon") {
  const body = new URLSearchParams({
    id: browser.runtime.id,
    urun_id: productId,
    fiyat: newPrice,
    platform,
  }).toString();

  const response = await fetch("https://aft.web.tr/extension/Update.php", {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body,
  });

  if (!response.ok) {
    throw new Error(`Veri gönderilemedi, durum kodu: ${response.status}`);
  }
  return true;
}

export async function sendDeletedProduct(productId) {
  const body = new URLSearchParams({urun_id: productId}).toString();
  await fetch("https://aft.web.tr/extension/deletedProduct.php", {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body,
  });
}

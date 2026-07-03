//background > sendUrl.js

async function getAuthHeaders() {
  const extensionId = browser.runtime.id;
  const result = await browser.storage.local.get("authToken");
  return {
    "X-Token": result.authToken || "",
    "X-Extension-Id": extensionId,
  };
}

export async function sendPriceChange(productId, newPrice, platform = "amazon") {
  const authHeaders = await getAuthHeaders();
  const response = await fetch("https://aft.web.tr/extension/UpdatePrice.php", {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded", ...authHeaders},
    body: new URLSearchParams({urun_id: productId, fiyat: newPrice, platform}),
  });

  if (!response.ok) {
    console.log(`Veri gönderilemedi`);
    throw new Error(`Veri gönderilemedi, durum kodu: ${response.status}`);
  }
  return true;
}

export async function sendDeletedProduct(productId) {
  await fetch("https://aft.web.tr/extension/deletedProduct.php", {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({urun_id: productId}),
  });
}

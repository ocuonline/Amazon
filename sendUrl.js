//background > sendUrl.js

export async function registerToken() {
  try {
    const extensionId = browser.runtime.id;
    const res = await fetch("https://aft.web.tr/extension/register.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Extension-Id": extensionId,
      },
      body: new URLSearchParams({extension_id: extensionId}),
    });
    const data = await res.json();
    const update = {};
    if (data.token) update.authToken = data.token;
    if (data.hmac_secret) update.hmacSecret = data.hmac_secret;
    if (data.expires_at) update.expiresAt = data.expires_at;
    if (Object.keys(update).length) {
      await browser.storage.local.set(update);
    }
  } catch (err) {
    console.error("Token alınamadı:", err);
  }
}

async function hmacSign(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getAuthHeaders(body) {
  const extensionId = browser.runtime.id;
  const result = await browser.storage.local.get(["authToken", "hmacSecret"]);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await hmacSign(result.hmacSecret || "", timestamp + "." + body);
  return {
    "X-Token": result.authToken || "",
    "X-Extension-Id": extensionId,
    "X-Timestamp": timestamp,
    "X-Signature": signature,
  };
}

export async function refreshToken() {
  const extensionId = browser.runtime.id;
  const result = await browser.storage.local.get(["authToken", "hmacSecret"]);
  if (!result.hmacSecret || !result.authToken) {
    console.warn("refreshToken: credentials eksik, atlanıyor.");
    return;
  }
  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await hmacSign(result.hmacSecret, timestamp + ".");
    const response = await fetch("https://aft.web.tr/extension/refresh_token.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Token": result.authToken || "",
        "X-Extension-Id": extensionId,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
      },
    });
    if (!response.ok) {
      console.warn("refreshToken başarısız, durum kodu:", response.status);
      if (response.status === 401) {
        await registerToken();
      }
      return;
    }
    const data = await response.json();
    const update = {};
    if (data.token) {
      update.authToken = data.token;
    }
    if (data.hmac_secret) {
      update.hmacSecret = data.hmac_secret;
    }
    if (data.expires_at) {
      update.expiresAt = data.expires_at;
    }
    if (Object.keys(update).length) {
      await browser.storage.local.set(update);
    }
  } catch (e) {
    console.error("refreshToken hatası:", e.message);
  }
}

export async function sendPriceChange(productId, newPrice, platform = "amazon") {
  const body = new URLSearchParams({urun_id: productId, fiyat: newPrice, platform}).toString();
  const authHeaders = await getAuthHeaders(body);
  const response = await fetch("https://aft.web.tr/extension/UpdatePrice.php", {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded", ...authHeaders},
    body,
  });

  if (!response.ok) {
    throw new Error(`Veri gönderilemedi, durum kodu: ${response.status}`);
  }
  return true;
}

export async function sendDeletedProduct(productId) {
  const body = new URLSearchParams({urun_id: productId}).toString();
  const authHeaders = await getAuthHeaders(body);
  await fetch("https://aft.web.tr/extension/deletedProduct.php", {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded", ...authHeaders},
    body,
  });
}

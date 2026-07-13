// src/auth.js

async function hmacSign(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getAuthHeaders(body = "") {
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

window.getAuthHeaders = getAuthHeaders;

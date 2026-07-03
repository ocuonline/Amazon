// src/auth.js

async function getAuthHeaders() {
  const extensionId = browser.runtime.id;
  const result = await browser.storage.local.get("authToken");
  const token = result.authToken || "";

  return {
    "X-Token": token,
    "X-Extension-Id": extensionId,
  };
}

window.getAuthHeaders = getAuthHeaders;

//utils.js
if (typeof browser === "undefined") {
  var browser = chrome;
}

export async function LastUpdateTime() {
  const formattedDate = formatDate(Date.now());
  await browser.storage.sync.set({lastUpdateTime: formattedDate});
  console.log("Son Kontrol:", formattedDate);
  return true;
}

export function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString("tr-TR", {
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function parsePrice(price) {
  if (!price) return 0;
  const cleanedPrice = String(price)
    .replace(/[^0-9,]/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const parsed = parseFloat(cleanedPrice);
  return isNaN(parsed) ? 0 : parsed;
}

export function buildPrice(whole, fraction) {
  if (!whole) return null;
  if (fraction !== null && fraction !== undefined) {
    const raw = `${whole},${fraction}`.replace(/\./g, "").replace(",", ".");
    const num = parseFloat(raw);
    return isNaN(num) ? `${whole},${fraction}`.trim() : num.toLocaleString("tr-TR", {maximumFractionDigits: 2});
  }
  const raw = whole.replace(/\s*TL/gi, "").trim().replace(/,+$/, "").replace(/\./g, "").replace(",", ".");
  const num = parseFloat(raw);
  return isNaN(num) ? whole.trim() : num.toLocaleString("tr-TR", {maximumFractionDigits: 2});
}

export function getTimeAgo(timestamp) {
  const ts = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "az önce";
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} saat önce`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} gün önce`;
  return `${Math.floor(diff / 2592000)} ay önce`;
}

export function formatTL(val) {
  const num = parseFloat(String(val).replace(",", "."));
  if (isNaN(num)) return val;
  return num.toLocaleString("tr-TR", {minimumFractionDigits: 0, maximumFractionDigits: 2}).replace(/,00$/, "");
}

export function parseDate(d) {
  if (!d) return 0;
  const [datePart, timePart] = d.split(" ");
  const [day, month, year] = datePart.split(".");
  return new Date(`${year}-${month}-${day}${timePart ? "T" + timePart : ""}`).getTime();
}

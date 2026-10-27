//utils.js
const browser = globalThis.browser ?? globalThis.chrome;

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
  if (!Number.isFinite(num)) return "";
  return num.toLocaleString("tr-TR", {minimumFractionDigits: 0, maximumFractionDigits: 2}).replace(/,00$/, "");
}

export function parseDate(d) {
  if (!d) return 0;
  const [datePart, timePart] = d.split(" ");
  const [day, month, year] = datePart.split(".");
  return new Date(`${year}-${month}-${day}${timePart ? "T" + timePart : ""}`).getTime();
}

export function showToast(message, type) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerText = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("visible");
  }, 100);
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 500);
  }, 3000);
}

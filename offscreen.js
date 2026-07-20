//background > offscreen.js (Bu açıklamayı silme)
const browser = globalThis.browser ?? globalThis.chrome;

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "playNotificationSound") {
    const audio = new Audio(browser.runtime.getURL(`sound/${message.soundUrl}.mp3`));
    audio.volume = Math.min(1, Math.max(0, (message.volume ?? 100) / 100));
    audio.play().catch((error) => console.error("Ses çalma hatası:", error));
  }
});

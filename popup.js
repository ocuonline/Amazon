// popup.js
import {getAllFromSync, saveToSync, clearAllStorage, getAllFromDB, saveToDB} from "./storage.js";
import {renderProductList, sortByOrder, updateProductRow, calcPercent} from "./table.js";
import {checkPrices, cancelPriceCheck, parsePrice} from "./update.js";
import {showToast} from "./notifications.js";

if (typeof browser === "undefined") {
  var browser = chrome;
}

let sortOrder = 1;
let groupIndex = 0;
let activeFilter = null;

function parseDate(d) {
  if (!d) return 0;
  const [datePart, timePart] = d.split(" ");
  const [day, month, year] = datePart.split(".");
  return new Date(`${year}-${month}-${day}${timePart ? "T" + timePart : ""}`).getTime();
}

function calcBasePrice(product, percentMode, oldPriceMap) {
  return percentMode === "instant" ? parsePrice(oldPriceMap[product.id]?.oldPrice) || parsePrice(product.firstPrice) : parsePrice(product.firstPrice);
}

async function getOldPriceMap(products) {
  return browser.storage.local.get(products.map((p) => p.id));
}

async function applyFilter(products) {
  if (!activeFilter || activeFilter === "all") return products;
  if (activeFilter === "stock-in") {
    const localData = await browser.storage.local.get(products.map((p) => p.id));
    return products.filter((p) => localData[p.id]?.stockIn);
  }
  if (activeFilter === "stock-out") return products.filter((p) => p.outOfStock === true);
  if (activeFilter === "target") {
    return products.filter((p) => {
      const target = parsePrice(p.targetPrice);
      const cur = parsePrice(p.newPrice);
      return target > 0 && cur > 0 && cur <= target;
    });
  }
  if (activeFilter === "discount" || activeFilter === "increase") {
    const {percentMode = "general"} = await browser.storage.local.get("percentMode");
    const oldPriceMap = await getOldPriceMap(products);
    return products.filter((p) => {
      const cur = parsePrice(p.newPrice);
      const base = calcBasePrice(p, percentMode, oldPriceMap);
      if (activeFilter === "discount") return cur > 0 && base > 0 && cur < base;
      return cur > 0 && base > 0 && cur > base;
    });
  }
  return products.filter((p) => p.group === activeFilter);
}

async function buildAndSaveOrder(list) {
  const order = list.map((p, i) => ({id: p.id, no: i + 1}));
  await saveToDB(order);
  return order;
}

async function saveLastSort(by, order) {
  await browser.storage.local.set({lastSort: {by, order}});
}

async function getSortedProducts(sortBy, order, productsList) {
  const list = [...productsList];
  switch (sortBy) {
    case "name":
      list.sort((a, b) => order * a.name.toUpperCase().localeCompare(b.name.toUpperCase()));
      break;
    case "Nprice":
      list.sort((a, b) => order * (parsePrice(a.newPrice) - parsePrice(b.newPrice)));
      break;
    case "Ndate":
      list.sort((a, b) => order * ((b.newPriceDate ?? 0) - (a.newPriceDate ?? 0)));
      break;
    case "date":
      list.sort((a, b) => order * (parseDate(b.date) - parseDate(a.date)));
      break;
    case "percent": {
      const {percentMode = "general"} = await browser.storage.local.get("percentMode");
      const oldPriceMap = await getOldPriceMap(list);
      const percentOf = (p) => calcPercent(parsePrice(p.newPrice), calcBasePrice(p, percentMode, oldPriceMap));
      list.sort((a, b) => order * (percentOf(a) - percentOf(b)));
      break;
    }
  }
  return list;
}

async function sortProducts(sortBy) {
  const products = await getAllFromSync();
  let productsList = [...products];

  if (sortBy === "group") {
    const usedGroups = ["", ...new Set(productsList.map((p) => p.group || "").filter((g) => g !== ""))];
    groupIndex = (groupIndex + 1) % usedGroups.length;
    productsList.sort((a, b) => {
      const aIndex = usedGroups.indexOf(a.group || "");
      const bIndex = usedGroups.indexOf(b.group || "");
      const groupA = (aIndex - groupIndex + usedGroups.length) % usedGroups.length;
      const groupB = (bIndex - groupIndex + usedGroups.length) % usedGroups.length;
      return groupA - groupB;
    });
  } else {
    productsList = await getSortedProducts(sortBy, sortOrder, productsList);
  }

  const newOrder = await buildAndSaveOrder(productsList);
  await saveLastSort(sortBy, sortOrder);
  sortOrder *= -1;
  const filteredList = await applyFilter(productsList);
  renderProductList(sortByOrder(filteredList, newOrder), document.getElementById("product-list"));
  updateSortMenuIndicator(sortBy, sortOrder);
  updateSortBtnIcon(sortBy, sortOrder);
}

const SORT_ICONS = {name: "🔤", date: "📅", Nprice: "💰", Ndate: "🕒", percent: "📊"};

function updateSortBtnIcon(sortBy, order) {
  const sortBtn = document.getElementById("sort-btn");
  const icon = SORT_ICONS[sortBy];
  sortBtn.innerHTML = icon ? `${icon}${order === 1 ? "↑" : "↓"}` : '<span class="material-icons">sort</span>';
}

function updateSortMenuIndicator(sortBy, order) {
  document.querySelectorAll("#sort-menu [data-sort-by]").forEach((opt) => {
    const arrow = opt.querySelector(".sort-arrow");
    if (arrow) arrow.remove();
    opt.classList.remove("active");
    if (opt.dataset.sortBy === sortBy) {
      opt.classList.add("active");
      const span = document.createElement("span");
      span.className = `sort-arrow ${order === 1 ? "sort-arrow-up" : "sort-arrow-down"}`;
      span.textContent = order === 1 ? "↑" : "↓";
      opt.appendChild(span);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const feedbackButton = document.getElementById("feedback-button");
  const deleteAllButton = document.getElementById("delete-all");
  const settingsButton = document.getElementById("settings-button");
  const productList = document.getElementById("product-list");
  const lastUpdateTime = document.getElementById("last-update-time");
  const searchBox = document.getElementById("search-box");
  const productGroupHeader = document.getElementById("p-group");
  const updateButton = document.getElementById("update-button");
  if (!deleteAllButton || !productList || !updateButton) {
    return;
  }

  setupEventListeners();
  setupFilterMenu();

  browser.storage.local.get("lastSort").then((result) => {
    if (result.lastSort) {
      sortOrder = result.lastSort.order;
      updateSortMenuIndicator(result.lastSort.by, result.lastSort.order);
      updateSortBtnIcon(result.lastSort.by, result.lastSort.order);
    }
  });

  const checkProgress = document.getElementById("check-progress");
  const checkProgressBar = document.getElementById("check-progress-bar");
  const checkProgressText = document.getElementById("check-progress-text");

  loadProductList().then(() => {
    browser.storage.local.get(["checkProgress", "checkedIds"]).then(({checkProgress: progress, checkedIds = []}) => {
      if (progress) {
        updateProgressUI(progress);
        checkedIds.forEach((id) => markChecked(id));
      }
    });
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.checkProgress) {
      const val = changes.checkProgress.newValue;
      if (val) updateProgressUI(val);
      else {
        checkProgress.style.display = "none";
        updateLastUpdateTime();
        document.querySelectorAll(".spinning").forEach((icon) => {
          icon.classList.replace("spinning", "checked");
          icon.textContent = "check_circle";
          icon.closest("button").disabled = false;
        });
      }
    }
    if (area === "local" && changes.checkedIds) {
      const oldIds = changes.checkedIds.oldValue || [];
      const newIds = changes.checkedIds.newValue || [];
      newIds.filter((id) => !oldIds.includes(id)).forEach((id) => markChecked(id));
    }
  });

  async function markChecked(id) {
    await updateProductRow(id, productList);
    const btn = document.getElementById(`check-btn-${id}`);
    if (btn) {
      const icon = btn.querySelector("span");
      icon.textContent = "check_circle";
      icon.classList.remove("spinning");
      icon.classList.add("checked");
      btn.disabled = false;
    }
  }

  function updateProgressUI(progress) {
    const pct = (progress.current / progress.total) * 100;
    checkProgress.style.display = "block";
    checkProgressBar.style.width = `${pct}%`;
    const spanSayi = checkProgressText.querySelectorAll("span")[1];
    spanSayi.textContent = `${progress.current}/${progress.total}`;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      browser.runtime.sendMessage({action: "clearBadge"});
    }
  });

  window.addEventListener("unload", () => {
    browser.runtime.sendMessage({action: "clearBadge"});
  });

  async function renderWithOrder(products, notFoundMsg = null) {
    const order = await getAllFromDB();
    renderProductList(sortByOrder(await applyFilter(products), order), productList, null, notFoundMsg);
  }

  async function filterProductsByName(query) {
    const products = await getAllFromSync();
    const filtered = products.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.id.toLowerCase().includes(query.toLowerCase()));
    await renderWithOrder(filtered);
  }

  async function updateLastUpdateTime() {
    const lastUpdateData = await browser.storage.sync.get("lastUpdateTime");
    if (lastUpdateData.lastUpdateTime) {
      lastUpdateTime.innerText = `Son Kontrol: ${lastUpdateData.lastUpdateTime}`;
    }
  }

  async function loadProductList() {
    try {
      const products = await getAllFromSync();
      const dbOrder = await getAllFromDB();
      const {lastSort} = await browser.storage.local.get("lastSort");
      const missingOrder = products.some((p) => !dbOrder.some((o) => o.id === p.id && o.no != null));
      const needsRebuild = dbOrder.length === 0 || dbOrder.length !== products.length || missingOrder;
      let order = dbOrder;
      if (needsRebuild) {
        let ordered = products;
        if (lastSort?.by === "date") {
          ordered = [...products].sort((a, b) => lastSort.order * (parseDate(b.date) - parseDate(a.date)));
        }
        order = ordered.map((product, index) => ({id: product.id, no: index + 1}));
      }
      if (needsRebuild) await saveToDB(order);

      const badgeResult = await browser.action.getBadgeText({});
      const hasBadge = badgeResult && badgeResult !== "";

      const {badgeProducts = []} = await browser.storage.local.get("badgeProducts");
      const changedProducts = hasBadge && badgeProducts.length > 0 ? products.filter((p) => badgeProducts.includes(p.id)) : [];
      const listToRender = changedProducts.length > 0 ? changedProducts : products;

      if (lastSort && ["name", "Nprice", "Ndate", "date", "percent"].includes(lastSort.by)) {
        const sortedList = await getSortedProducts(lastSort.by, lastSort.order, listToRender);
        order = await buildAndSaveOrder(sortedList);
      }

      const filtered = await applyFilter(listToRender);
      renderProductList(sortByOrder(filtered, order), productList);
      updateLastUpdateTime();
    } catch (error) {
      console.error(error);
    }
  }

  function setFilterIcon(filter) {
    const filterBtn = document.getElementById("filter-btn");
    filterBtn.textContent = "";
    const iconMap = {
      "stock-in": ["material-icons", "filter-icon-in", "add_circle"],
      "stock-out": ["material-icons", "filter-icon-out", "do_not_disturb"],
      all: ["material-icons", "", "filter_list"],
    };
    const textMap = {discount: "⬇️", increase: "⬆️", target: "🎯", "🔴": "🔴", "🟡": "🟡", "🟢": "🟢"};
    if (iconMap[filter]) {
      const [cls1, cls2, text] = iconMap[filter];
      const span = document.createElement("span");
      span.className = [cls1, cls2].filter(Boolean).join(" ");
      span.textContent = text;
      filterBtn.appendChild(span);
    } else {
      filterBtn.textContent = textMap[filter] ?? "";
    }
  }

  function setupFilterMenu() {
    const filterBtn = document.getElementById("filter-btn");
    const filterMenu = document.getElementById("filter-menu");
    const filterClearBtn = document.getElementById("filter-clear-btn");

    const savedFilter = localStorage.getItem("activeFilter");
    if (savedFilter && savedFilter !== "all") {
      activeFilter = savedFilter;
      const matchedOption = filterMenu.querySelector(`[data-filter="${savedFilter}"]`);
      if (matchedOption) matchedOption.classList.add("active");
      filterClearBtn.style.display = "inline-flex";
      setFilterIcon(activeFilter);
      filterBtn.classList.add("active");
    }

    filterClearBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      activeFilter = null;
      localStorage.removeItem("activeFilter");
      filterMenu.querySelectorAll(".filter-option").forEach((o) => o.classList.remove("active"));
      filterClearBtn.style.display = "none";
      setFilterIcon("all");
      filterBtn.classList.remove("active");
      const products = await getAllFromSync();
      await renderWithOrder(products);
    });

    filterBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.getElementById("sort-menu").style.display = "none";
      filterMenu.style.display = filterMenu.style.display === "block" ? "none" : "block";
    });

    document.addEventListener("click", () => {
      filterMenu.style.display = "none";
      document.getElementById("sort-menu").style.display = "none";
    });

    filterMenu.querySelectorAll(".filter-option").forEach((option) => {
      option.addEventListener("click", async (e) => {
        e.stopPropagation();
        activeFilter = option.dataset.filter;
        filterMenu.style.display = "none";

        filterMenu.querySelectorAll(".filter-option").forEach((o) => o.classList.remove("active"));
        if (activeFilter !== "all") option.classList.add("active");
        localStorage.setItem("activeFilter", activeFilter);
        filterClearBtn.style.display = activeFilter !== "all" ? "inline-flex" : "none";
        setFilterIcon(activeFilter ?? "all");
        filterBtn.classList.toggle("active", activeFilter !== "all");

        const products = await getAllFromSync();
        await renderWithOrder(products, "Bu filtreye uygun ürün bulunamadı.");
      });
    });
  }

  function setupEventListeners() {
    feedbackButton.addEventListener("click", () => {
      window.open("https://aft.web.tr/ticket/", "_blank");
    });

    deleteAllButton.addEventListener("click", async () => {
      if (confirm("Tüm ürünleri silmek istediğinize emin misiniz?")) {
        cancelPriceCheck();
        const products = await getAllFromSync();
        await clearAllStorage();
        renderProductList([], productList);
        showToast("Tüm ürünler silindi.", "success");
        if (browser.action?.setBadgeText) browser.action.setBadgeText({text: ""});
        const keysToRemove = products.map((p) => p.id);
        await browser.storage.local.remove([...keysToRemove, "badgeProducts", "badgeCounts"]);
      }
    });

    settingsButton.addEventListener("click", () => {
      browser.runtime.openOptionsPage();
    });
    productGroupHeader.addEventListener("click", () => sortProducts("group"));

    const percentModeBtn = document.getElementById("percent-mode-btn");

    function updatePercentModeBtn(mode) {
      percentModeBtn.textContent = mode === "instant" ? "A" : "G";
      percentModeBtn.title = mode === "instant" ? "Anlık Değişim Oranını Göster" : "Genel Değişim Oranını Göster";
    }

    browser.storage.local.get("percentMode").then((result) => {
      updatePercentModeBtn(result.percentMode ?? "general");
    });

    percentModeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const result = await browser.storage.local.get("percentMode");
      const current = result.percentMode ?? "general";
      const next = current === "general" ? "instant" : "general";
      await browser.storage.local.set({percentMode: next});
      updatePercentModeBtn(next);

      const {lastSort} = await browser.storage.local.get("lastSort");
      const products = await getAllFromSync();

      if (lastSort?.by === "percent") {
        const sorted = await getSortedProducts("percent", -lastSort.order, products);
        const newOrder = await buildAndSaveOrder(sorted);
        renderProductList(sortByOrder(await applyFilter(sorted), newOrder), productList);
      } else {
        await renderWithOrder(products);
      }
    });
    const sortBtn = document.getElementById("sort-btn");
    const sortMenu = document.getElementById("sort-menu");

    sortBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.getElementById("filter-menu").style.display = "none";
      sortMenu.style.display = sortMenu.style.display === "block" ? "none" : "block";
    });

    sortMenu.querySelectorAll("[data-sort-by]").forEach((option) => {
      option.addEventListener("click", (e) => {
        e.stopPropagation();
        sortProducts(option.dataset.sortBy);
      });
    });

    updateButton.addEventListener("click", async () => {
      showToast("Ürün fiyatları kontrol ediliyor...", "info");

      const products = await getAllFromSync();
      products.forEach((p) => {
        const btn = document.getElementById(`check-btn-${p.id}`);
        if (btn) {
          const icon = btn.querySelector("span");
          icon.textContent = "sync";
          icon.classList.remove("checked");
          icon.classList.add("spinning");
          btn.disabled = true;
        }
      });

      browser.runtime.sendMessage({action: "startPriceCheck"});
    });

    if (searchBox) {
      searchBox.addEventListener("input", () => filterProductsByName(searchBox.value));
    }
  }
});

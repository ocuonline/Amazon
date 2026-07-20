// popup.js
import {getAllFromSync, saveToSync, clearAllStorage, getAllFromDB, saveToDB} from "./storage.js";
import {renderProductList, sortByOrder, updateProductRow, calcPercent} from "./popup.table.js";
import {checkPrices, cancelPriceCheck} from "./update.js";
import {parseDate, showToast} from "./utils.js";

const browser = globalThis.browser ?? globalThis.chrome;

let groupIndex = 0;
let activeFilter = null;

function calcBasePrice(product, percentMode, oldPriceMap) {
  return percentMode === "instant" ? (oldPriceMap[product.id]?.oldPrice ?? product.firstPrice) : product.firstPrice;
}

async function getOldPriceMap(products) {
  return browser.storage.local.get(products.map((p) => p.id));
}

async function applyFilter(products, {localData, percentMode, oldPriceMap} = {}) {
  if (!activeFilter || activeFilter === "all") return products;
  if (activeFilter === "stock-in") {
    const resolved = localData ?? (await browser.storage.local.get(products.map((p) => p.id)));
    return products.filter((p) => resolved[p.id]?.stockIn);
  }
  if (activeFilter === "stock-out") return products.filter((p) => p.outOfStock === true);
  if (activeFilter === "deleted") {
    const resolved = localData ?? (await browser.storage.local.get(products.map((p) => p.id)));
    return products.filter((p) => resolved[p.id]?.deleted);
  }
  if (activeFilter === "target") {
    return products.filter((p) => {
      const target = p.targetPrice ?? 0;
      const cur = p.newPrice ?? 0;
      return target > 0 && cur > 0 && cur <= target;
    });
  }
  if (activeFilter === "discount" || activeFilter === "increase") {
    const [resolvedMode, resolvedMap] = await Promise.all([
      percentMode != null ? Promise.resolve(percentMode) : browser.storage.local.get("percentMode").then((r) => r.percentMode ?? "general"),
      oldPriceMap != null ? Promise.resolve(oldPriceMap) : getOldPriceMap(products),
    ]);
    return products.filter((p) => {
      const cur = p.newPrice ?? 0;
      const base = calcBasePrice(p, resolvedMode, resolvedMap);
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

async function saveOrderAndRender(list, listElement) {
  const order = await buildAndSaveOrder(list);
  const filtered = await applyFilter(list);
  renderProductList(sortByOrder(filtered, order), listElement);
  return order;
}

async function saveLastSort(by, order) {
  await browser.storage.local.set({lastSort: {by, order}});
}

async function getSortedProducts(sortBy, order, productsList, percentMode = null) {
  const list = [...productsList];
  switch (sortBy) {
    case "name":
      list.sort((a, b) => order * a.name.toUpperCase().localeCompare(b.name.toUpperCase()));
      break;
    case "Nprice":
      list.sort((a, b) => order * ((a.newPrice ?? 0) - (b.newPrice ?? 0)));
      break;
    case "Ndate":
      list.sort((a, b) => order * ((b.newPriceDate ?? 0) - (a.newPriceDate ?? 0)));
      break;
    case "date":
      list.sort((a, b) => order * (parseDate(b.date) - parseDate(a.date)));
      break;
    case "percent": {
      const resolvedMode = percentMode ?? (await browser.storage.local.get("percentMode")).percentMode ?? "general";
      const oldPriceMap = await getOldPriceMap(list);
      const percentOf = (p) => calcPercent(p.newPrice ?? 0, calcBasePrice(p, resolvedMode, oldPriceMap));
      list.sort((a, b) => order * (percentOf(a) - percentOf(b)));
      break;
    }
  }
  return list;
}

const SORT_ICONS = {name: "🆎", date: "📅", Nprice: "💲", Ndate: "🕒", percent: "📊"};

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

async function sortProducts(sortBy, productList) {
  const products = await getAllFromSync();
  let productsList = [...products];

  const [{lastSort: prev}, {percentMode = "general"}] = await Promise.all([browser.storage.local.get("lastSort"), browser.storage.local.get("percentMode")]);
  const nextOrder = prev?.by === sortBy ? (prev.order ?? 1) * -1 : 1;

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
    productsList = await getSortedProducts(sortBy, nextOrder, productsList, percentMode);
  }

  await saveLastSort(sortBy, nextOrder);
  const order = await buildAndSaveOrder(productsList);
  const filtered = await applyFilter(productsList, {percentMode});
  renderProductList(sortByOrder(filtered, order), productList);
  updateSortMenuIndicator(sortBy, nextOrder);
  updateSortBtnIcon(sortBy, nextOrder);
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
        productList.querySelectorAll(".spinning").forEach((icon) => {
          icon.classList.replace("spinning", "checked");
          icon.textContent = "check_circle";
          icon.closest("button").disabled = false;
        });
      }
    }
    if (area === "local" && changes.checkedIds) {
      const oldIds = changes.checkedIds.oldValue || [];
      const newIds = changes.checkedIds.newValue || [];
      const added = newIds.filter((id) => !oldIds.includes(id));
      if (added.length > 0) markChecked(added);
    }
  });

  async function markChecked(ids) {
    const resolvedIds = Array.isArray(ids) ? ids : [ids];
    const [products, order, {percentMode = "general"}, localDataBatch] = await Promise.all([
      getAllFromSync(),
      getAllFromDB(),
      browser.storage.local.get("percentMode"),
      browser.storage.local.get(resolvedIds),
    ]);
    await Promise.all(resolvedIds.map((id) => updateProductRow(id, productList, {products, order, percentMode, localDataBatch})));
    for (const id of resolvedIds) {
      const btn = document.getElementById(`check-btn-${id}`);
      if (btn) {
        const icon = btn.querySelector("span");
        icon.textContent = "check_circle";
        icon.classList.remove("spinning");
        icon.classList.add("checked");
        btn.disabled = false;
      }
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

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  async function filterProductsByName(query) {
    const [products, order] = await Promise.all([getAllFromSync(), getAllFromDB()]);
    const q = query.toLowerCase();
    const filtered = products.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
    const {percentMode = "general"} = await browser.storage.local.get("percentMode");
    renderProductList(sortByOrder(await applyFilter(filtered, {percentMode}), order), productList, order);
  }

  async function renderFiltered(products, order = null, notFoundMsg = null, save = false) {
    const resolvedOrder = order ?? (await getAllFromDB());
    if (save) await saveToDB(resolvedOrder);
    const {percentMode = "general"} = await browser.storage.local.get("percentMode");
    const filtered = await applyFilter(products, {percentMode});
    renderProductList(sortByOrder(filtered, resolvedOrder), productList, null, notFoundMsg);
    return resolvedOrder;
  }

  async function updateLastUpdateTime() {
    const lastUpdateData = await browser.storage.sync.get("lastUpdateTime");
    if (lastUpdateData.lastUpdateTime) {
      lastUpdateTime.innerText = `Son Kontrol: ${lastUpdateData.lastUpdateTime}`;
    }
    await updateProductStats();
  }

  async function updateProductStats() {
    const statsEl = document.getElementById("product-stats");
    if (!statsEl) return;

    const products = await getAllFromSync();
    const total = products.length;
    const [localData, {percentMode = "general"}, oldPriceMap] = await Promise.all([
      browser.storage.local.get(products.map((p) => p.id)),
      browser.storage.local.get("percentMode"),
      getOldPriceMap(products),
    ]);

    let up = 0,
      down = 0,
      target = 0,
      outOfStock = 0,
      stockIn = 0,
      deleted = 0;

    for (const p of products) {
      const cur = p.newPrice ?? 0;
      const base = calcBasePrice(p, percentMode, oldPriceMap);

      if (cur > 0 && base > 0) {
        if (cur > base) up++;
        else if (cur < base) down++;
      }

      const t = p.targetPrice ?? 0;
      if (t > 0 && cur > 0 && cur <= t) target++;

      if (p.outOfStock === true) outOfStock++;
      if (localData[p.id]?.stockIn) stockIn++;
      if (localData[p.id]?.deleted) deleted++;
    }

    const parts = [
      `<span class="stat-item">Toplam Ürün: <strong>${total}</strong></span>`,
      target > 0 ? `<span class="stat-item stat-target">🎯 ${target}</span>` : "",
      down > 0 ? `<span class="stat-item stat-down">↓${down}</span>` : "",
      stockIn > 0 ? `<span class="stat-item stat-in">➕${stockIn}</span>` : "",
      up > 0 ? `<span class="stat-item stat-up">↑${up}</span>` : "",
      outOfStock > 0 ? `<span class="stat-item stat-out">⛔${outOfStock}</span>` : "",
      deleted > 0 ? `<span class="stat-item stat-del">🗑️${deleted}</span>` : "",
    ]
      .filter(Boolean)
      .join(" ");

    statsEl.textContent = "";
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = parts;
    while (tempDiv.firstChild) statsEl.appendChild(tempDiv.firstChild);
  }

  async function loadProductList() {
    try {
      const [products, dbOrder, {lastSort}] = await Promise.all([getAllFromSync(), getAllFromDB(), browser.storage.local.get("lastSort")]);
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

      const {percentMode = "general"} = await browser.storage.local.get("percentMode");
      let finalList = listToRender;
      if (lastSort && ["name", "Nprice", "Ndate", "date", "percent"].includes(lastSort.by)) {
        finalList = await getSortedProducts(lastSort.by, lastSort.order, listToRender, percentMode);
        order = await buildAndSaveOrder(finalList);
      }

      const filtered = await applyFilter(finalList, {percentMode});
      renderProductList(sortByOrder(filtered, order), productList);
      updateLastUpdateTime();
    } catch (error) {
      console.error(error);
    }
  }

  function setFilterIcon(filter) {
    const filterBtn = document.getElementById("filter-btn");

    const textMap = {
      discount: "⬇️",
      increase: "⬆️",
      target: "🎯",
      "stock-in": "➕",
      "stock-out": "⛔",
      deleted: "🗑️",
      "🔴": "🔴",
      "🟡": "🟡",
      "🟢": "🟢",
    };

    filterBtn.textContent = textMap[filter] ?? "";
    if (!textMap[filter]) {
      const icon = document.createElement("span");
      icon.className = "material-icons";
      icon.textContent = "filter_list";
      filterBtn.appendChild(icon);
    }
  }

  async function setupFilterMenu() {
    const filterBtn = document.getElementById("filter-btn");
    const filterMenu = document.getElementById("filter-menu");
    const filterClearBtn = document.getElementById("filter-clear-btn");

    const {activeFilter: savedFilter} = await browser.storage.local.get("activeFilter");
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
      await browser.storage.local.remove("activeFilter");
      filterMenu.querySelectorAll(".filter-option").forEach((o) => o.classList.remove("active"));
      filterClearBtn.style.display = "none";
      setFilterIcon("all");
      filterBtn.classList.remove("active");
      const products = await getAllFromSync();
      await renderFiltered(products);
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
        await browser.storage.local.set({activeFilter});
        filterClearBtn.style.display = activeFilter !== "all" ? "inline-flex" : "none";
        setFilterIcon(activeFilter ?? "all");
        filterBtn.classList.toggle("active", activeFilter !== "all");

        const products = await getAllFromSync();
        await renderFiltered(products, null, "Bu filtreye uygun ürün bulunamadı.");
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
    productGroupHeader.addEventListener("click", () => sortProducts("group", productList));

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
        const sorted = await getSortedProducts("percent", lastSort.order, products);
        await saveOrderAndRender(sorted, productList);
      } else {
        await renderFiltered(products);
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
        sortProducts(option.dataset.sortBy, productList);
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
      searchBox.addEventListener(
        "input",
        debounce(() => filterProductsByName(searchBox.value), 250),
      );
    }
  }
});

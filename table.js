// popup > table.js
import {getAllFromSync, saveToSync, removeFromSync, getAllFromDB, saveToDB} from "./storage.js";
import {fetchProductData, renderChart} from "./chart.popup.js";
import {formatDate, getTimeAgo, formatTL, parsePrice} from "./utils.js";
import {showToast} from "./notifications.js";
import {checkPrices} from "./update.js";

if (typeof browser === "undefined") {
  var browser = chrome;
}

function addBadge(container, className, text, title = "", insertAfter = null) {
  const badge = document.createElement("span");
  badge.className = className;
  badge.textContent = text;
  if (title) badge.title = title;
  if (insertAfter) insertAfter.insertAdjacentElement("afterend", badge);
  else container.appendChild(badge);
  return badge;
}

export function calcPercent(fetched, base) {
  return fetched > 0 && base > 0 ? ((fetched - base) / base) * 100 : 0;
}

export function sortByOrder(products, order) {
  const orderMap = new Map(order.map((o) => [o.id, o.no]));
  return products.slice().sort((a, b) => {
    const aNo = orderMap.get(a.id) || Infinity;
    const bNo = orderMap.get(b.id) || Infinity;
    return aNo - bNo;
  });
}

export function openAlarmModal(product, alarmWrapper, oldPriceFormatted) {
  const alarmTextNode = alarmWrapper.lastChild;
  const modal = document.getElementById("alarm-modal");
  const input = document.getElementById("modal-alarm-input");
  const saveBtn = document.getElementById("modal-save");
  const cancelBtn = document.getElementById("modal-cancel");
  const deleteBtn = document.getElementById("modal-delete-target");
  const productName = document.getElementById("modal-product-name");
  const ac = new AbortController();
  const sig = ac.signal;

  productName.textContent = product.name;
  const initialVal = product.targetPrice || parsePrice(product.firstPrice) || "";
  input.value = initialVal ? formatTL(initialVal) : "";
  modal.style.display = "flex";

  const currentPrice = parsePrice(product.firstPrice);
  const pctRow = document.createElement("div");
  pctRow.id = "modal-pct-row";
  [5, 10, 20, 30, 40, 50].forEach((pct) => {
    const btn = document.createElement("button");
    btn.textContent = `%${pct}`;
    btn.type = "button";
    btn.addEventListener("click", () => {
      const target = currentPrice * (1 - pct / 100);
      document.getElementById("modal-alarm-input").value = formatTL(target);
    });
    pctRow.appendChild(btn);
  });
  document.getElementById("modal-pct-row")?.remove();
  input.insertAdjacentElement("afterend", pctRow);

  setTimeout(() => input.focus(), 50);

  const errorDiv = document.getElementById("modal-alarm-error");
  const close = () => {
    pctRow.remove();
    modal.style.display = "none";
    errorDiv.textContent = "";
    ac.abort();
  };

  const save = async () => {
    const rawVal = input.value.trim();
    const oldPriceVal = parsePrice(product.firstPrice);

    // Türk formatı düzeltme: "8.570,50" → 8570.50, "8570" → 8570
    const normalized = rawVal.replace(/\./g, "").replace(",", ".");
    const val = parseFloat(normalized);

    if (isNaN(val) || val <= 0) {
      errorDiv.textContent = "Geçerli bir fiyat girin.";
      return;
    }
    if (oldPriceVal > 0 && val >= oldPriceVal) {
      errorDiv.textContent = `Hedef fiyat mevcut fiyattan (₺ ${oldPriceVal}) düşük olmalı.`;
      return;
    }

    errorDiv.textContent = "";
    product.targetPrice = val === oldPriceVal ? null : val;
    alarmTextNode.textContent = ` ${product.targetPrice ? `${formatTL(product.targetPrice)} ₺ ` : oldPriceFormatted || "—"}`;

    const allProducts = await getAllFromSync();
    const idx = allProducts.findIndex((p) => p.id === product.id);
    if (idx >= 0) {
      allProducts[idx].targetPrice = product.targetPrice;
      await saveToSync(allProducts);
    }
    close();
  };

  saveBtn.addEventListener("click", save, {signal: sig});
  cancelBtn.addEventListener("click", close, {signal: sig});
  deleteBtn.addEventListener(
    "click",
    async () => {
      product.targetPrice = null;
      alarmTextNode.textContent = ` ${oldPriceFormatted || "—"}`;
      const allProducts = await getAllFromSync();
      const idx = allProducts.findIndex((p) => p.id === product.id);
      if (idx >= 0) {
        allProducts[idx].targetPrice = null;
        await saveToSync(allProducts);
      }
      close();
    },
    {signal: sig},
  );
  modal.addEventListener(
    "click",
    (e) => {
      if (e.target === modal) close();
    },
    {signal: sig},
  );
  input.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter") save();
      if (e.key === "Escape") close();
    },
    {signal: sig},
  );

  input.addEventListener("input", (e) => {
    const pos = e.target.selectionStart;
    const raw = e.target.value.replace(/[^0-9,]/g, "");
    const num = parseFloat(raw.replace(/\./g, "").replace(",", "."));
    if (!isNaN(num)) {
      e.target.value = formatTL(num);
      e.target.setSelectionRange(pos, pos);
    }
  });
}

export async function renderProductList(products, productList, order = null, emptyMessage = "Henüz ürün takip edilmiyor.") {
  setupProductListEvents(productList);
  productList.textContent = "";

  if (!products.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = emptyMessage ?? "Henüz ürün takip edilmiyor.";
    productList.appendChild(empty);
    return;
  }

  const resolvedOrder = order ?? (await getAllFromDB());
  const picMap = new Map(resolvedOrder.map((o) => [o.id, o.pic]));
  const sortedProducts = products;

  const [{percentMode = "general"}, localDataResult] = await Promise.all([
    browser.storage.local.get("percentMode"),
    browser.storage.local.get(sortedProducts.map((p) => p.id)),
  ]);

  const rows = await Promise.all(
    sortedProducts.map((product, index) =>
      createProductRow(product, index, productList, resolvedOrder, picMap, percentMode, localDataResult[product.id] || {}),
    ),
  );

  rows.forEach((row) => productList.appendChild(row));
}

document.addEventListener("click", (event) => {
  document.querySelectorAll(".group-menu").forEach((menu) => {
    if (!menu.contains(event.target) && !menu.parentElement.contains(event.target)) {
      menu.classList.remove("visible");
    }
  });
});

const GROUPS = ["🔴", "🟡", "🟢"];

function createCheckCell(product) {
  const checkCell = document.createElement("div");
  checkCell.className = "col-check";
  const checkBtn = document.createElement("button");
  checkBtn.id = `check-btn-${product.id}`;
  checkBtn.className = "check-btn";
  const syncIcon = document.createElement("span");
  syncIcon.className = "material-icons icon-small";
  syncIcon.textContent = "sync";
  checkBtn.appendChild(syncIcon);
  checkCell.appendChild(checkBtn);
  return checkCell;
}

function createGroupCell(product, order, productList) {
  const groupCell = document.createElement("div");
  groupCell.className = "col-group";
  const groupButton = document.createElement("button");
  groupButton.className = "group-btn";
  groupButton.title = "Grup Seç";
  product.group = product.group || "";
  groupButton.textContent = product.group ? product.group : "+";

  const groupMenu = document.createElement("div");
  groupMenu.className = "group-menu";
  GROUPS.forEach((group) => {
    const option = document.createElement("div");
    option.textContent = group;
    option.className = "group-menu-option";
    option.onclick = async (e) => {
      e.stopPropagation();
      product.group = product.group === group ? "" : group;
      groupButton.textContent = product.group || "+";
      try {
        const products = await getAllFromSync();
        const i = products.findIndex((p) => p.id === product.id);
        if (i >= 0) {
          products[i].group = product.group;
          await saveToSync(products);
          renderProductList(sortByOrder(products, order), productList);
        }
      } catch {
        showToast("Hata oluştu. Lütfen tekrar deneyin.", "error");
      }
      groupMenu.classList.remove("visible");
    };
    groupMenu.appendChild(option);
  });

  groupButton.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    document.querySelectorAll(".group-menu.visible").forEach((m) => m.classList.remove("visible"));
    const rect = groupButton.getBoundingClientRect();
    groupMenu.style.left = `${rect.left + window.scrollX + 32}px`;
    groupMenu.style.top = `${rect.top + window.scrollY - 30}px`;
    groupMenu.classList.add("visible");
  };

  groupCell.appendChild(groupButton);
  groupCell.appendChild(groupMenu);
  return groupCell;
}

function createPictureCell(product, picMap) {
  const picCell = document.createElement("div");
  picCell.className = "col-pic";
  const previewImg = document.createElement("img");
  previewImg.className = "preview-img";

  const pic = picMap.get(product.id);
  if (pic) {
    previewImg.src = pic;
    previewImg.classList.add("preview-img-show");
  }

  picCell.appendChild(previewImg);
  picCell.addEventListener("click", (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(product.id);
  });
  return picCell;
}

function createNameCell(product, localData) {
  const nameCell = document.createElement("div");
  nameCell.className = "col-name";
  const link = document.createElement("a");
  link.href = product.url;
  link.target = "_blank";
  link.textContent = product.name;
  const isHB = product.url?.includes("hepsiburada.com");
  link.className = `product-link ${isHB ? "product-link-hb" : "product-link-amazon"}`;
  link.title = product.name;

  const metaDiv = document.createElement("div");
  metaDiv.className = "product-meta";
  const oldPriceFormatted = product.firstPrice ? `₺ ${product.firstPrice}` : "";

  const metaLeft = document.createElement("span");
  metaLeft.textContent = `📅 ${product.date ? product.date.split(" ")[0] : "—"}`;
  const displayTarget = product.targetPrice ? `₺ ${product.targetPrice}` : oldPriceFormatted || "—";
  const alarmWrapper = document.createElement("span");
  alarmWrapper.className = "alarm-wrapper";
  alarmWrapper.title = "Hedef fiyat belirle";
  alarmWrapper.dataset.oldPriceFormatted = oldPriceFormatted;
  const alarmIcon = document.createElement("span");
  alarmIcon.className = "material-icons alarm-icon";
  alarmIcon.textContent = "alarm";
  alarmWrapper.appendChild(alarmIcon);
  alarmWrapper.appendChild(document.createTextNode(` ${displayTarget}`));
  alarmWrapper._product = product;
  if (product.targetPrice) alarmWrapper.classList.add("alarm-active");

  metaDiv.appendChild(metaLeft);
  metaDiv.appendChild(alarmWrapper);

  if (product.deleted) {
    addBadge(metaDiv, "promo-badge promo-badge-out", "Ürün Silinmiş", "Ürün Amazondan Silinmiş");
  } else if (product.outOfStock) {
    addBadge(metaDiv, "promo-badge promo-badge-out", "Stokta Yok", localData.stockOutDate ? formatDate(localData.stockOutDate) : "");
  }
  const nameLine = document.createElement("div");
  nameLine.className = "name-line";
  nameLine.appendChild(link);
  nameCell.appendChild(nameLine);

  const promo = localData.promoText;
  if (promo) {
    const lines = promo
      .replace(/Kampanya ürünlerini gör/gi, "")
      .replace(/Uygun ürünler/gi, "")
      .replace(/Koşullar/gi, "")
      .split(/(?=Prime üyelerine|Kampanyalar|Ödeme esnasında)/i)
      .map((s) => s.trim())
      .filter(Boolean);
    lines.forEach((line) => {
      const isPrime = /prime/i.test(line);
      addBadge(metaDiv, `promo-badge ${isPrime ? "promo-badge-prime" : "promo-badge-promo"}`, "P", line);
    });
  }
  if (localData.installment) {
    addBadge(metaDiv, "promo-badge promo-badge-promo", `${localData.installment} Taksit`, `Peşin fiyatına ${localData.installment} taksit`);
  }
  if (isHB && localData.campaigns?.length) {
    localData.campaigns.forEach((c) => {
      addBadge(metaDiv, "promo-badge promo-badge-campaign", "K", typeof c === "string" ? c : (c?.text?.trim() ?? ""));
    });
  }

  nameCell.appendChild(metaDiv);

  if (localData.stockIn) {
    addBadge(metaDiv, "promo-badge promo-badge-in", "Stoğa Girdi", localData.stockInDate ? formatDate(localData.stockInDate) : "");
  }
  const count = localData.stockCount;
  if (count !== undefined) {
    addBadge(metaDiv, "stock-badge", count, `Stokta sadece ${count} adet kaldı.`, alarmWrapper);
  }
  if (localData.condition) {
    addBadge(metaDiv, "promo-badge promo-badge-condition", localData.condition, `İkinci El Ürün Durumu: ${localData.condition}`, alarmWrapper);
  }

  return {nameCell, alarmWrapper};
}

function createPriceCell(product, percentMode, oldPriceRaw) {
  const newPriceCell = document.createElement("div");
  newPriceCell.className = "col-price price-cell";
  const {firstPrice: oldPrice, newPrice} = product;
  let priceText = null;
  if (newPrice) {
    const compareBase = percentMode === "instant" && oldPriceRaw ? oldPriceRaw : oldPrice;
    const old = parsePrice(compareBase),
      _new = parsePrice(newPrice);

    priceText = document.createElement("div");
    priceText.className = "price-value";
    const priceColorClass = !old ? "price-new" : _new < old ? "price-down" : _new > old ? "price-up" : "price-same";
    priceText.classList.add(priceColorClass);
    priceText.textContent = `₺ ${newPrice}`;

    const subPrice = document.createElement("div");
    subPrice.className = "price-old";
    subPrice.textContent = oldPriceRaw && oldPriceRaw !== newPrice ? `₺ ${oldPriceRaw}` : "";

    const timeAgo = document.createElement("div");
    timeAgo.className = "price-time-ago";
    if (product.newPriceDate) timeAgo.textContent = getTimeAgo(product.newPriceDate);

    newPriceCell.appendChild(priceText);
    newPriceCell.appendChild(subPrice);
    newPriceCell.appendChild(timeAgo);
  }
  return {newPriceCell, priceText};
}

function createPercentCell(fetched, basePrice) {
  const percentCell = document.createElement("div");
  percentCell.className = "col-percent percent-cell";

  if (fetched > 0 && basePrice > 0 && fetched !== basePrice) {
    const percent = calcPercent(fetched, basePrice).toFixed(1);
    const diff = (fetched - basePrice).toFixed(2);
    const arrow = percent > 0 ? "↑" : "↓";
    const colorClass = percent > 0 ? "percent-up" : "percent-down";

    const percentLine = document.createElement("div");
    percentLine.textContent = `${arrow}${Math.abs(percent)}%`;
    percentLine.classList.add(colorClass);

    const diffLine = document.createElement("div");
    const diffFormatted = Math.abs(diff).toLocaleString("tr-TR", {minimumFractionDigits: 0, maximumFractionDigits: 2});
    diffLine.textContent = `₺ ${percent > 0 ? "+" : "-"}${diffFormatted}`;
    diffLine.classList.add("percent-diff");

    percentCell.appendChild(percentLine);
    percentCell.appendChild(diffLine);
  }
  return percentCell;
}

function createDeleteCell() {
  const deleteCell = document.createElement("div");
  deleteCell.className = "col-delete";
  const deleteButton = document.createElement("button");
  deleteButton.className = "delete-btn";
  deleteButton.title = "Ürünü Sil";
  deleteButton.textContent = "x";
  deleteCell.appendChild(deleteButton);
  return deleteCell;
}

export async function createProductRow(product, index, productList, order, picMap = new Map(), percentMode = "general", localData = {}) {
  const productRow = document.createElement("div");
  productRow.className = "product-row";
  productRow.dataset.id = product.id;
  const oldPriceRaw = localData.oldPrice ?? null;
  const fetched = parsePrice(product.newPrice);
  const basePrice = percentMode === "instant" && oldPriceRaw ? parsePrice(oldPriceRaw) : fetched > 0 ? parsePrice(product.firstPrice) || 0 : 0;

  productRow.appendChild(createCheckCell(product));
  productRow.appendChild(createGroupCell(product, order, productList));
  productRow.appendChild(createPictureCell(product, picMap));

  const {nameCell} = createNameCell(product, localData);
  productRow.appendChild(nameCell);

  const {newPriceCell, priceText} = createPriceCell(product, percentMode, oldPriceRaw);
  productRow.appendChild(newPriceCell);

  if (localData.stockIn && priceText && product.outOfStock === false) {
    const old = parsePrice(product.firstPrice);
    const cur = parsePrice(product.newPrice);
    if (old > 0 && cur === old) {
      priceText.classList.remove("price-down", "price-up", "price-same");
      priceText.classList.add("price-new");
    }
  }

  productRow.appendChild(createPercentCell(fetched, basePrice));
  productRow.appendChild(createDeleteCell());

  return productRow;
}

export function setupProductListEvents(productList) {
  if (productList._delegated) return;
  productList._delegated = true;

  productList.addEventListener("click", async (e) => {
    const row = e.target.closest(".product-row");
    if (!row) return;
    const id = row.dataset.id;

    const deleteBtn = e.target.closest(".delete-btn");
    if (deleteBtn) return removeProduct(id, productList);

    const checkBtn = e.target.closest(".check-btn");
    if (checkBtn) {
      const icon = checkBtn.querySelector("span");
      icon.classList.add("spinning");
      checkBtn.disabled = true;
      try {
        await checkPrices(id);
        await updateProductRow(id, productList);
        const newBtn = document.getElementById(`check-btn-${id}`);
        if (newBtn) {
          const newIcon = newBtn.querySelector("span");
          newIcon.classList.remove("spinning");
          newIcon.classList.add("checked");
          newBtn.disabled = false;
        }
      } catch {
        icon.classList.remove("spinning");
        checkBtn.disabled = false;
      }
      return;
    }

    const alarmWrapper = e.target.closest(".alarm-wrapper");
    if (alarmWrapper) {
      const product = alarmWrapper._product;
      if (product) openAlarmModal(product, alarmWrapper, alarmWrapper.dataset.oldPriceFormatted || "");
      return;
    }

    const isInteractive = e.target.closest("button, a");
    if (isInteractive) return;
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    const index = Array.from(productList.querySelectorAll(".product-row")).indexOf(row);
    const products = await getAllFromSync();
    const product = products.find((p) => p.id === id);
    if (product) toggleAccordion(index, product, productList);
  });

  productList.addEventListener("mouseover", (e) => {
    const picCell = e.target.closest(".col-pic");
    if (!picCell) return;
    const previewImg = picCell.querySelector(".preview-img");
    if (!previewImg) return;
    const allRows = productList.querySelectorAll(".product-row");
    const row = picCell.closest(".product-row");
    const isFirst = row === allRows[0];
    const isLast = row === allRows[allRows.length - 1] && allRows.length > 1;
    previewImg.classList.add(isLast ? "preview-img-zoom-up" : isFirst ? "preview-img-zoom-down" : "preview-img-zoom");
  });

  productList.addEventListener("mouseout", (e) => {
    const picCell = e.target.closest(".col-pic");
    if (!picCell) return;
    const previewImg = picCell.querySelector(".preview-img");
    if (previewImg) previewImg.classList.remove("preview-img-zoom", "preview-img-zoom-up", "preview-img-zoom-down");
  });
}

let lastExpandedIndex = null;
const fetchingSet = new Set();

export function toggleAccordion(index, product, productList) {
  const existingAccordion = document.querySelector(".accordion");
  const prevRow = document.querySelector(".product-row.accordion-open");
  if (prevRow) prevRow.classList.remove("accordion-open");

  if (existingAccordion) {
    existingAccordion.remove();
    if (lastExpandedIndex === index) {
      lastExpandedIndex = null;
      return;
    }
  }

  const productRow = productList.querySelectorAll(".product-row")[index];
  productRow.classList.add("accordion-open");

  if (fetchingSet.has(index)) return;
  fetchingSet.add(index);
  fetchProductData(product.id)
    .then((data) => {
      const accordion = document.createElement("div");
      accordion.className = "accordion accordion-row";

      const content = document.createElement("div");
      content.className = "accordion-content";

      const chartDiv = document.createElement("div");
      chartDiv.id = `chart-${index}`;
      chartDiv.className = "chart-div chart-hidden";

      const noData = document.createElement("div");
      noData.id = `no-data-${index}`;
      noData.className = "no-data-message no-data-visible";
      noData.textContent = "Veri bulunamadı.";

      content.append(chartDiv, noData);
      accordion.appendChild(content);
      productRow.insertAdjacentElement("afterend", accordion);
      setTimeout(() => accordion.scrollIntoView({behavior: "smooth", block: "nearest"}), 50);

      chartDiv.classList.replace("chart-hidden", "chart-visible");
      noData.classList.replace("no-data-visible", "no-data-hidden");
      renderChart(`chart-${index}`, data ?? [], product.id);
    })
    .then(() => {
      lastExpandedIndex = index;
    })
    .catch(() => showToast("Veri alınırken hata oluştu.", "error"))
    .finally(() => {
      fetchingSet.delete(index);
    });
}

export async function updateProductRow(id, productList) {
  const products = await getAllFromSync();
  const product = products.find((p) => p.id === id);
  if (!product) return;
  const order = await getAllFromDB();
  const picMap = new Map(order.map((o) => [o.id, o.pic]));
  const oldRow = document.getElementById(`check-btn-${id}`)?.closest(".product-row");
  const index = Array.from(productList.querySelectorAll(".product-row")).indexOf(oldRow);
  const [{percentMode = "general"}, localDataResult] = await Promise.all([browser.storage.local.get("percentMode"), browser.storage.local.get(product.id)]);
  const localData = localDataResult[product.id] || {};
  const newRow = await createProductRow(product, index, productList, order, picMap, percentMode, localData);
  if (oldRow) oldRow.replaceWith(newRow);
}

export async function removeProduct(id, productList) {
  try {
    let [products, order] = await Promise.all([getAllFromSync(), getAllFromDB()]);
    const removedIndex = products.findIndex((p) => p.id === id);
    const removedNo = order.find((o) => o.id === id)?.no ?? null;

    if (removedIndex !== -1) products.splice(removedIndex, 1);
    order = order.filter((o) => o.id !== id).map((o) => ({...o, no: removedNo !== null && o.no > removedNo ? o.no - 1 : o.no}));

    const sorted = sortByOrder(products, order);
    await Promise.all([removeFromSync(id), saveToDB(order), saveToSync(sorted)]);

    const row = document.getElementById(`check-btn-${id}`)?.closest(".product-row");
    if (row) row.remove();
    if (!sorted.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Henüz ürün takip edilmiyor.";
      productList.appendChild(empty);
    }
    showToast("Ürün listeden silindi.", "success");
  } catch (error) {
    showToast("Ürünü silerken hata oluştu.", "error");
  }
}

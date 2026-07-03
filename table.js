// popup > table.js
import {getAllFromSync, saveToSync, removeFromSync, getAllFromDB, saveToDB} from "./storage.js";
import {fetchProductData, renderChart} from "./chart.popup.js";
import {checkPrices, parsePrice} from "./update.js";
import {showToast} from "./notifications.js";

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

function formatTL(val) {
  const num = parseFloat(String(val).replace(",", "."));
  if (isNaN(num)) return val;
  return num.toLocaleString("tr-TR", {minimumFractionDigits: 0, maximumFractionDigits: 2});
}

export function openAlarmModal(product, alarmWrapper, oldPriceFormatted) {
  const alarmTextNode = alarmWrapper.lastChild;
  const modal = document.getElementById("alarm-modal");
  const input = document.getElementById("modal-alarm-input");
  const saveBtn = document.getElementById("modal-save");
  const cancelBtn = document.getElementById("modal-cancel");
  const deleteBtn = document.getElementById("modal-delete-target");
  const productName = document.getElementById("modal-product-name");

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
  input.insertAdjacentElement("afterend", pctRow);

  setTimeout(() => input.focus(), 50);

  const errorDiv = document.getElementById("modal-alarm-error");
  const close = () => {
    document.getElementById("modal-pct-row")?.remove();
    modal.style.display = "none";
    errorDiv.textContent = "";
    saveBtn.replaceWith(saveBtn.cloneNode(true));
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    deleteBtn.replaceWith(deleteBtn.cloneNode(true));
    input.replaceWith(input.cloneNode(true));
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

  saveBtn.addEventListener("click", save);
  cancelBtn.addEventListener("click", close);
  deleteBtn.addEventListener("click", async () => {
    product.targetPrice = null;
    alarmTextNode.textContent = ` ${oldPriceFormatted || "—"}`;
    const allProducts = await getAllFromSync();
    const idx = allProducts.findIndex((p) => p.id === product.id);
    if (idx >= 0) {
      allProducts[idx].targetPrice = null;
      await saveToSync(allProducts);
    }
    close();
  });
  modal.addEventListener(
    "click",
    (e) => {
      if (e.target === modal) close();
    },
    {once: true},
  );
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") close();
  });

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
  productList.textContent = "";

  if (!products.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = emptyMessage;
    productList.appendChild(empty);
    return;
  }

  const resolvedOrder = order ?? (await getAllFromDB());
  const picMap = new Map(resolvedOrder.map((o) => [o.id, o.pic]));
  for (const [index, product] of sortByOrder(products, resolvedOrder).entries()) {
    productList.appendChild(await createProductRow(product, index, productList, resolvedOrder, picMap));
  }
}

document.addEventListener("click", (event) => {
  document.querySelectorAll(".group-menu").forEach((menu) => {
    if (!menu.contains(event.target) && !menu.parentElement.contains(event.target)) {
      menu.classList.remove("visible");
    }
  });
});

const GROUPS = ["🔴", "🟡", "🟢"];

export async function createProductRow(product, index, productList, order, picMap = new Map()) {
  const productRow = document.createElement("div");
  productRow.className = "product-row";

  // Tekil kontrol hücresi
  const checkCell = document.createElement("div");
  checkCell.className = "col-check";

  const checkBtn = document.createElement("button");
  checkBtn.id = `check-btn-${product.id}`;
  checkBtn.className = "check-btn";
  const syncIcon = document.createElement("span");
  syncIcon.className = "material-icons icon-small";
  syncIcon.textContent = "sync";
  checkBtn.appendChild(syncIcon);

  checkBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const icon = checkBtn.querySelector("span");
    icon.classList.add("spinning");
    checkBtn.disabled = true;

    try {
      await checkPrices(product.id);
      await updateProductRow(product.id, productList);
      setCheckedState(document.getElementById(`check-btn-${product.id}`));
    } catch {
      icon.classList.remove("spinning");
      checkBtn.disabled = false;
    }
  });

  function setCheckedState(btn) {
    const icon = btn.querySelector("span");
    icon.classList.remove("spinning");
    icon.classList.add("checked");
    btn.disabled = false;
  }

  checkCell.appendChild(checkBtn);
  productRow.appendChild(checkCell);

  // Grup hücresi
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
  productRow.appendChild(groupCell);

  // Resim hücresi
  const picCell = document.createElement("div");
  picCell.className = "col-pic";
  const previewImg = document.createElement("img");
  previewImg.className = "preview-img";

  picCell.addEventListener("mouseenter", () => {
    const allRows = document.querySelectorAll(".product-row");
    const isFirst = productRow === allRows[0];
    const isLast = productRow === allRows[allRows.length - 1] && allRows.length > 1;
    previewImg.classList.add(isLast ? "preview-img-zoom-up" : isFirst ? "preview-img-zoom-down" : "preview-img-zoom");
  });
  picCell.addEventListener("mouseleave", () => {
    previewImg.classList.remove("preview-img-zoom", "preview-img-zoom-up", "preview-img-zoom-down");
  });

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
  productRow.appendChild(picCell);

  // Ürün adı
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
  const alarmIcon = document.createElement("span");
  alarmIcon.className = "material-icons alarm-icon";
  alarmIcon.textContent = "alarm";
  alarmWrapper.appendChild(alarmIcon);
  alarmWrapper.appendChild(document.createTextNode(` ${displayTarget}`));
  if (product.targetPrice) alarmWrapper.classList.add("alarm-active");

  alarmWrapper.addEventListener("click", (e) => {
    e.stopPropagation();
    openAlarmModal(product, alarmWrapper, oldPriceFormatted);
  });

  const percentMode = (await browser.storage.local.get("percentMode")).percentMode ?? "general";
  const localData = (await browser.storage.local.get(product.id))[product.id] || {};
  const oldPriceRaw = localData.oldPrice ?? null;

  const fetched = parsePrice(product.newPrice);
  const basePrice = percentMode === "instant" && oldPriceRaw ? parsePrice(oldPriceRaw) : fetched > 0 ? parsePrice(product.firstPrice) || 0 : 0;

  metaDiv.appendChild(metaLeft);
  metaDiv.appendChild(alarmWrapper);

  // Stok durumu badge (hedef fiyattan sonra)
  if (product.deleted) {
    addBadge(metaDiv, "promo-badge promo-badge-out", "Ürün Silinmiş", "Ürün Amazondan Silinmiş");
  } else if (product.outOfStock) {
    addBadge(metaDiv, "promo-badge promo-badge-out", "Stokta Yok", localData.stockOutDate ? formatDate(localData.stockOutDate) : "");
  }
  const nameLine = document.createElement("div");
  nameLine.className = "name-line";
  nameLine.appendChild(link);
  nameCell.appendChild(nameLine);

  {
    const productData = localData;
    const promo = productData.promoText;
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
    if (productData.installment) {
      addBadge(metaDiv, "promo-badge promo-badge-promo", `${productData.installment} Taksit`, `Peşin fiyatına ${productData.installment} taksit`);
    }

    if (isHB && productData.campaigns?.length) {
      productData.campaigns.forEach((c) => {
        addBadge(metaDiv, "promo-badge promo-badge-campaign", "K", typeof c === "string" ? c : (c?.text?.trim() ?? ""));
      });
    }
  }

  nameCell.appendChild(metaDiv);
  productRow.appendChild(nameCell);

  // Yeni fiyat
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
  productRow.appendChild(newPriceCell);

  {
    const productData = localData;

    if (productData.stockIn && priceText && product.outOfStock === false) {
      const old = parsePrice(product.firstPrice);
      const cur = parsePrice(product.newPrice);
      if (old > 0 && cur === old) {
        priceText.classList.remove("price-down", "price-up", "price-same");
        priceText.classList.add("price-new");
      }
    }

    if (productData.stockIn) {
      addBadge(metaDiv, "promo-badge promo-badge-in", "Stoğa Girdi", productData.stockInDate ? formatDate(productData.stockInDate) : "");
    }

    const count = productData.stockCount;
    if (count !== undefined) {
      addBadge(metaDiv, "stock-badge", count, `Stokta sadece ${count} adet kaldı.`, alarmWrapper);
    }

    if (productData.condition) {
      addBadge(metaDiv, "promo-badge promo-badge-condition", productData.condition, `İkinci El Ürün Durumu: ${productData.condition}`, alarmWrapper);
    }
  }

  // Yüzde değişim
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
  productRow.appendChild(percentCell);

  // Silme butonu
  const deleteCell = document.createElement("div");
  deleteCell.className = "col-delete";
  const deleteButton = document.createElement("button");
  deleteButton.className = "delete-btn";
  deleteButton.title = "Ürünü Sil";
  deleteButton.textContent = "x";
  deleteButton.onclick = () => removeProduct(product.id, productList);
  deleteCell.appendChild(deleteButton);
  productRow.appendChild(deleteCell);
  productRow.addEventListener("click", (e) => {
    const isInteractive = e.target.closest("button, a");
    if (isInteractive) return;
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    toggleAccordion(index, product, productList);
  });
  return productRow;
}

let lastExpandedIndex = null;

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
      renderChart(chartDiv.id, data ?? [], product.id);
    })
    .then(() => {
      lastExpandedIndex = index;
    })
    .catch(() => showToast("Veri alınırken hata oluştu.", "error"));
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString("tr-TR", {
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getTimeAgo(timestamp) {
  const ts = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "az önce";
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} saat önce`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} gün önce`;
  return `${Math.floor(diff / 2592000)} ay önce`;
}

export async function updateProductRow(id, productList) {
  const products = await getAllFromSync();
  const product = products.find((p) => p.id === id);
  if (!product) return;
  const order = await getAllFromDB();
  const picMap = new Map(order.map((o) => [o.id, o.pic]));
  const oldRow = document.getElementById(`check-btn-${id}`)?.closest(".product-row");
  const index = Array.from(productList.querySelectorAll(".product-row")).indexOf(oldRow);
  const newRow = await createProductRow(product, index, productList, order, picMap);
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
    if (!sorted.length) renderProductList(sorted, productList);
    showToast("Ürün listeden silindi.", "success");
  } catch (error) {
    showToast("Ürünü silerken hata oluştu.", "error");
  }
}

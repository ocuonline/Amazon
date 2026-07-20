//content.chart.js

async function getPriceHistory(urunId, platform) {
  try {
    const auth = await window.getAuthHeaders();
    const res = await fetch(`https://aft.web.tr/extension/GetPrice.php?urun_id=${urunId}&platform=${platform}`, {
      headers: auth,
    });
    const data = await res.json();
    const hasAftData = Array.isArray(data) && data.length >= 2;

    const nowPrice = window.getLivePrice?.();
    const parsedNow = nowPrice ?? 0;

    let rawEntries = hasAftData ? data : [];

    if (Number.isFinite(parsedNow) && parsedNow > 0) {
      const lastDbPrice = parseFloat(rawEntries.at(-1)?.fiyat);
      if (lastDbPrice !== parsedNow) {
        let priceToSave = parsedNow;

        if (platform === "amazon") {
          const bestSeller = await window.findBestSeller?.(urunId);
          priceToSave = bestSeller?.price || parsedNow;
        }

        const updateBody = new URLSearchParams({urun_id: urunId, fiyat: priceToSave, platform}).toString();
        const authUpdate = await window.getAuthHeaders(updateBody);
        await fetch("https://aft.web.tr/extension/UpdatePrice.php", {
          method: "POST",
          headers: {"Content-Type": "application/x-www-form-urlencoded", ...authUpdate},
          body: updateBody,
        });

        const auth2 = await window.getAuthHeaders();
        const res2 = await fetch(`https://aft.web.tr/extension/GetPrice.php?urun_id=${urunId}&platform=${platform}`, {
          headers: auth2,
        });
        const data2 = await res2.json();
        if (Array.isArray(data2) && data2.length >= 2) rawEntries = data2;

        if (platform === "amazon") {
          console.log("[AFT] rawEntries son eleman:", rawEntries.at(-1));
        }
      }
    }

    const yanyoEntries = platform === "amazon" ? await fetchYanyoData(urunId) : [];
    console.log("[Yanyo] yanyoEntries:", yanyoEntries.length);
    const hasYanyo = yanyoEntries.length >= 2;

    if (!rawEntries.length && !hasYanyo) {
      if (platform === "hb") return;
    }

    let mesaj, sınıf;
    if (rawEntries.length >= 2) {
      ({mesaj, sınıf} = getPriceMessage(rawEntries));
    } else if (hasYanyo) {
      ({mesaj, sınıf} = getPriceMessage(yanyoEntries));
    } else {
      if (!rawEntries.length) return;
      ({mesaj, sınıf} = getPriceMessage(rawEntries));
    }

    insertBox(sınıf, mesaj, rawEntries, yanyoEntries, platform);
  } catch (err) {
    console.error("getPriceHistory hata:", err);
  }
}

function getPriceMessage(data) {
  const V = {...data.at(-1), tarih: new Date(data.at(-1).tarih)};
  const fiyatlar = data.map((d) => ({tarih: new Date(d.tarih), fiyat: parseFloat(d.fiyat)})).filter((d) => Number.isFinite(d.fiyat));

  const N = fiyatlar.at(-1).fiyat;
  const B = fiyatlar.at(-2);
  const L = fiyatlar.reduce((a, b) => (b.fiyat < a.fiyat ? b : a));
  const maxFiyat = Math.max(...fiyatlar.map((d) => d.fiyat));
  const T = Math.ceil((V.tarih - fiyatlar[0].tarih) / 864e5);
  const enDusukTekrar = fiyatlar.filter((d) => d.fiyat === L.fiyat);

  const sameN = fiyatlar.filter((d) => d.fiyat === N && d.tarih.getTime() !== V.tarih.getTime());
  const S = sameN.length > 0 ? sameN.sort((a, b) => Math.abs(V.tarih - a.tarih) - Math.abs(V.tarih - b.tarih))[0] : null;

  const Y =
    fiyatlar
      .filter((d) => d.tarih.getTime() !== V.tarih.getTime())
      .map((d) => ({...d, diff: Math.abs(d.fiyat - N)}))
      .sort((a, b) => a.diff - b.diff)[0] || null;

  const yüzde = Math.round(Math.abs(((N - B.fiyat) / B.fiyat) * 1000)) / 10;
  const akış = `${TL(B.fiyat)} → ${TL(N)}`;

  let mesaj = "",
    sınıf = "";

  if (!Number.isFinite(N) || N <= 0) {
    mesaj = `Ürünün son fiyatı ${TL(V.fiyat)} idi.<br><br>${format(L.tarih)} tarihinde ${TL(L.fiyat)} fiyattı.`;
    sınıf = "bilgi";
  } else if (N < B.fiyat) {
    mesaj = `📉 (%${yüzde} indirim) ${akış}`;
    if (N === L.fiyat) {
      mesaj += `<br><br>Son ${T} günün En Düşük fiyatı.`;
      if (enDusukTekrar.length > 1) {
        mesaj += `<br><br>${format(L.tarih)} tarihinden sonra En Uygun Fiyat.`;
      }
    } else if (S) {
      mesaj += `<br><br>${format(S.tarih)} tarihinden sonra En Uygun Fiyat.`;
    } else if (Y) {
      mesaj += `<br><br>${format(Y.tarih)} tarihinden sonra En Uygun Fiyat.`;
    }
    sınıf = "indirim";
  } else if (N > B.fiyat) {
    mesaj = `📈 (%${yüzde} zam) ${akış}`;
    mesaj += `<br><br>${format(L.tarih)} tarihinde En düşük ${TL(L.fiyat)} idi.`;
    if (N === maxFiyat) {
      mesaj += `<br><br>Son ${T} günün En yüksek fiyatı.`;
    }
    sınıf = "zam";
  } else {
    mesaj = `Ürünün son fiyatı ${TL(V.fiyat)} idi.<br><br>${format(L.tarih)} tarihinde ${TL(L.fiyat)} fiyattı.`;
    sınıf = "bilgi";
  }

  return {mesaj, sınıf};
}

function TL(val) {
  const n = parseFloat(val);
  return Number.isFinite(n) ? `${n.toLocaleString("tr-TR")} TL` : "";
}

function format(date) {
  const d = new Date(date);
  return d.toLocaleDateString("tr-TR");
}

function insertBox(cls, html, rawEntries, yanyoEntries = [], platform) {
  document.querySelector(".price-history-box")?.remove();

  const box = document.createElement("div");
  box.className = `price-history-box ${cls}`;
  const template = document.createElement("template");
  template.innerHTML = html;
  box.appendChild(template.content.cloneNode(true));
  box.style.position = "relative";

  const shareBtn = document.createElement("button");
  shareBtn.textContent = "Paylaş";
  shareBtn.className = "share-btn";

  shareBtn.onclick = async () => {
    const tempDiv = document.createElement("div");
    tempDiv.style.cssText = "position:absolute;left:-9999px;";
    document.body.appendChild(tempDiv);

    const boxClone = box.cloneNode(true);
    boxClone.querySelector("button")?.remove();
    tempDiv.appendChild(boxClone);

    let url;
    if (platform === "amazon") {
      const idMatch = window.location.pathname.match(/\/(?:dp|gp\/product)\/([^\/]+)/);
      const id = idMatch?.[1];
      url = `https://www.amazon.com.tr/dp/${id}?th=1&psc=1`;
    } else {
      const pmMatch = window.location.href.match(/(pm?-[A-Z0-9]+)(?:[/?]|$)/i);
      url = pmMatch ? `https://www.hepsiburada.com/-${pmMatch[1]}` : window.location.href.split("?")[0];
    }

    const urlPara = document.createElement("p");
    urlPara.textContent = url;
    urlPara.style.cssText = "margin-bottom:12px;font-weight:bold;color:#333;";
    tempDiv.appendChild(urlPara);

    try {
      await navigator.clipboard.writeText(tempDiv.innerText);
      window.toast("Ürün bilgisi kopyalandı.", "success");
    } catch {
      window.toast("Kopyalama başarısız.", "error");
    }

    tempDiv.remove();
  };

  box.appendChild(shareBtn);

  const target = document.querySelector("#followButtonWrapper");
  if (target) target.insertAdjacentElement("afterend", box);
  document.querySelector("#chartDiv")?.parentElement?.remove();

  insertChartAfterContent(rawEntries, yanyoEntries, platform);
}

const PERIODS = {"1yıl": 12, "6ay": 6, "3ay": 3, "1ay": 1};

function filterByPeriod(rawEntries, ay) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - ay, now.getDate());
  return rawEntries.filter((e) => new Date(e.tarih) >= start);
}

function insertChartAfterContent(rawEntries, yanyoEntries = [], platform) {
  const anchorEl =
    platform === "amazon"
      ? document.querySelector("#ATFCriticalFeaturesDataContainer")
      : document.querySelector("#followButtonWrapper") || document.querySelector('h1[data-test-id="title"]');

  if (!anchorEl) return;

  const hasRaw = Array.isArray(rawEntries) && rawEntries.length > 0;
  const hasYanyo = yanyoEntries.length > 0;

  if (!hasRaw && !hasYanyo) {
    const noDataDiv = document.createElement("div");
    noDataDiv.id = "chartDiv";
    noDataDiv.className = "no-data";
    noDataDiv.textContent = "Grafik verisi bulunamadı.";
    anchorEl.insertAdjacentElement("afterend", noDataDiv);
    return;
  }

  document.querySelector("#priceChartContainer")?.remove();

  const toggleState = {aft: true, yanyo: true};
  let currentPeriod = 12;

  const container = document.createElement("div");
  container.id = "priceChartContainer";
  container.className = "chart-container";

  // Periyot butonları
  const btnGroup = document.createElement("div");
  btnGroup.className = "chart-btn-group";

  Object.keys(PERIODS).forEach((key) => {
    const btn = document.createElement("button");
    btn.textContent = key.replace("ay", " Ay").replace("yıl", " Yıl");
    btn.className = "chart-period-btn";
    if (key === "1yıl") btn.classList.add("active");
    btn.addEventListener("click", () => {
      btnGroup.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentPeriod = PERIODS[key];
      updateChart(chart, filterByPeriod(rawEntries, currentPeriod), filterByPeriod(yanyoEntries, currentPeriod), toggleState);
    });
    btnGroup.appendChild(btn);
  });

  container.appendChild(btnGroup);

  // Toggle butonları — sadece Amazon + Yanyo verisi varsa
  if (platform === "amazon") {
    const toggleGroup = document.createElement("div");
    toggleGroup.className = "chart-btn-group toggle-group-right";

    ["AFT", "Yaniyo"].forEach((label) => {
      const key = label === "AFT" ? "aft" : "yanyo";
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.className = "chart-period-btn active";
      btn.addEventListener("click", () => {
        toggleState[key] = !toggleState[key];
        btn.classList.toggle("active", toggleState[key]);
        updateChart(chart, filterByPeriod(rawEntries, currentPeriod), filterByPeriod(yanyoEntries, currentPeriod), toggleState);
      });
      toggleGroup.appendChild(btn);
    });

    container.appendChild(toggleGroup);
  }

  const chartDiv = document.createElement("div");
  chartDiv.id = "chartDiv";
  chartDiv.className = "chart-area";
  container.appendChild(chartDiv);

  if (platform === "amazon") {
    anchorEl.insertAdjacentElement("afterend", container);
  } else {
    const campaignBundle = document.querySelector('[data-test-id="campaign-bundle"]');
    if (campaignBundle) {
      campaignBundle.insertAdjacentElement("beforebegin", container);
    } else if (document.querySelector(".price-history-box")) {
      document.querySelector(".price-history-box").insertAdjacentElement("afterend", container);
    } else {
      anchorEl.insertAdjacentElement("afterend", container);
    }
  }

  if (insertChartAfterContent._chartInstance) {
    insertChartAfterContent._chartInstance.dispose();
  }

  const chart = echarts.init(chartDiv);
  insertChartAfterContent._chartInstance = chart;

  updateChart(chart, filterByPeriod(rawEntries, currentPeriod), filterByPeriod(yanyoEntries, currentPeriod), toggleState);

  if (insertChartAfterContent._resizeHandler) {
    window.removeEventListener("resize", insertChartAfterContent._resizeHandler);
  }
  insertChartAfterContent._resizeHandler = () => chart.resize();
  window.addEventListener("resize", insertChartAfterContent._resizeHandler);
}

function updateChart(chart, entries, yanyoEntries = [], toggleState = {aft: true, yanyo: true}) {
  if ((!entries || entries.length === 0) && yanyoEntries.length === 0) return;
  entries = entries || [];

  const aftTimestamps = toggleState.aft ? entries.map((e) => new Date(e.tarih).getTime()) : [];
  const yanyoTimestamps = toggleState.yanyo && yanyoEntries.length > 0 ? yanyoEntries.map((e) => new Date(e.tarih).getTime()) : [];

  const allTimestamps = [...new Set([...aftTimestamps, ...yanyoTimestamps])].sort((a, b) => a - b);
  const allLabels = allTimestamps.map((ts) =>
    new Date(ts).toLocaleString("tr-TR", {day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"}),
  );

  const aftPoints = toggleState.aft ? entries.map((e) => parseFloat(e.fiyat)) : [];
  const yanyoPoints = toggleState.yanyo && yanyoEntries.length > 0 ? yanyoEntries.map((e) => parseFloat(e.fiyat)) : [];
  const allPoints = [...aftPoints, ...yanyoPoints].filter(Number.isFinite);

  const minY = allPoints.length ? Math.min(...allPoints) - 10 : 0;
  const maxY = allPoints.length ? Math.max(...allPoints) + 10 : 100;

  chart.setOption({
    replaceMerge: ["series"],
    grid: {left: "0%", right: "0%", bottom: "0%", top: "5%", containLabel: true},
    tooltip: {
      trigger: "axis",
      axisPointer: {type: "cross"},
      formatter: (params) => {
        return params
          .map((param) => {
            const i = param.dataIndex;
            const ts = allTimestamps[i];
            const sourceEntries = param.seriesName === "Yaniyo" ? yanyoEntries : entries;
            const e = sourceEntries.find((e) => new Date(e.tarih).getTime() === ts);
            if (!e) return "";

            const idx = sourceEntries.indexOf(e);
            const d = new Date(e.tarih);
            const date = d.toLocaleDateString("tr-TR");
            const time = d.toLocaleTimeString("tr-TR", {hour: "2-digit", minute: "2-digit", second: "2-digit"});
            const val = parseFloat(e.fiyat).toFixed(2);
            const prev = idx > 0 ? parseFloat(sourceEntries[idx - 1]?.fiyat ?? val) : val;
            const diff = prev !== 0 ? ((val - prev) / prev) * 100 : 0;
            const pct = Math.abs(diff).toFixed(2);
            const up = val > prev,
              down = val < prev;
            const arrow = up ? "⬆" : down ? "⬇" : "⟷";
            const color = up ? "#D32F2F" : down ? "#388E3C" : "#333";
            const seriesLabel = yanyoEntries.length > 0 ? `[${param.seriesName}] ` : "";
            return `<div style="color:${color};font-weight:bold;">${seriesLabel}${arrow} %${pct} - ₺${val}</div>
                    <div style="color:#555;">${date} ${time}</div>`;
          })
          .filter(Boolean)
          .join("<hr style='margin:4px 0;border-color:#eee;'/>");
      },
    },
    xAxis: {
      type: "category",
      data: allLabels,
      axisLabel: {interval: Math.floor(allLabels.length / 10)},
    },
    yAxis: {
      type: "value",
      min: minY,
      max: maxY,
      axisLabel: {formatter: (v) => `₺${Math.round(v)}`},
    },
    series: [
      {
        name: "AFT",
        data: toggleState.aft
          ? allTimestamps.map((ts) => {
              const e = entries.find((e) => new Date(e.tarih).getTime() === ts);
              return e ? parseFloat(e.fiyat) : null;
            })
          : [],
        type: "line",
        smooth: true,
        connectNulls: true,
        lineStyle: {color: "#4575f7"},
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              {offset: 0, color: "rgba(255,0,0,0.3)"},
              {offset: 1, color: "rgba(0,255,0,0.3)"},
            ],
          },
        },
        markPoint: {
          symbol: "pin",
          symbolSize: 21,
          data: [
            {type: "max", itemStyle: {color: "#ff0000"}, label: {show: false}},
            {type: "min", itemStyle: {color: "#ff0000"}, label: {show: false}},
          ],
        },
      },
      {
        name: "Yaniyo",
        data:
          toggleState.yanyo && yanyoEntries.length > 0
            ? allTimestamps.map((ts) => {
                const e = yanyoEntries.find((e) => new Date(e.tarih).getTime() === ts);
                return e ? parseFloat(e.fiyat) : null;
              })
            : [],
        type: "line",
        smooth: true,
        connectNulls: true,
        lineStyle: {color: "#f7a645"},
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              {offset: 0, color: "rgba(247,166,69,0.3)"},
              {offset: 1, color: "rgba(247,166,69,0.05)"},
            ],
          },
        },
        markPoint: {
          symbol: "pin",
          symbolSize: 21,
          data: [
            {type: "max", itemStyle: {color: "#ff0000"}, label: {show: false}},
            {type: "min", itemStyle: {color: "#ff0000"}, label: {show: false}},
          ],
        },
      },
    ],
  });
}

async function fetchYanyoData(asin) {
  try {
    const html = await new Promise((resolve) => {
      browser.runtime.sendMessage({action: "fetchYanyoPage", asin}, (response) => {
        resolve(response?.html ?? null);
      });
    });
    if (!html) return [];

    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match?.[1]) return [];

    const unescaped = match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    const markerIdx = unescaped.indexOf('"dfwqs"');
    if (markerIdx === -1) return [];

    const arrayStart = unescaped.lastIndexOf("[", markerIdx);
    if (arrayStart === -1) return [];

    let depth = 0,
      arrayEnd = -1;
    for (let i = arrayStart; i < unescaped.length; i++) {
      if (unescaped[i] === "[") depth++;
      else if (unescaped[i] === "]") {
        depth--;
        if (depth === 0) {
          arrayEnd = i;
          break;
        }
      }
    }
    if (arrayEnd === -1) return [];

    let entries;
    try {
      entries = JSON.parse(unescaped.slice(arrayStart, arrayEnd + 1));
    } catch {
      return [];
    }
    if (!Array.isArray(entries) || entries.length === 0) return [];

    return entries
      .map((item) => {
        const price = parseFloat(item.dfwqs);
        const dateObj = new Date(item.rohs?.replace("H", "T")?.replace("N", "Z"));
        if (!Number.isFinite(price) || isNaN(dateObj.getTime())) return null;
        return {tarih: dateObj.toISOString(), fiyat: price.toFixed(2)};
      })
      .filter(Boolean);
  } catch (err) {
    console.error("[Yanyo] fetchYanyoData hata:", err);
    return [];
  }
}

window.getPriceHistory = getPriceHistory;

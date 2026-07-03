// chart.amazon.js

async function getPriceHistory(asin) {
  try {
    const auth = await window.getAuthHeaders();
    const res = await fetch(`https://aft.web.tr/extension/GetPrice.php?urun_id=${asin}&platform=amazon`, {
      headers: auth,
    });
    const data = await res.json();
    const hasAftData = Array.isArray(data) && data.length >= 2;

    const nowPrice = window.getLivePrice?.();
    const parsedNow = parseFloat(nowPrice?.replace(/\./g, "").replace(",", "."));

    if (hasAftData && Number.isFinite(parsedNow) && parsedNow > 0) {
      const updateAuth = await window.getAuthHeaders();
      await fetch("https://aft.web.tr/extension/UpdatePrice.php", {
        method: "POST",
        headers: {"Content-Type": "application/x-www-form-urlencoded", ...updateAuth},
        body: new URLSearchParams({urun_id: asin, fiyat: nowPrice, platform: "amazon"}),
      });
    }

    const auth2 = await window.getAuthHeaders();
    const res2 = await fetch(`https://aft.web.tr/extension/GetPrice.php?urun_id=${asin}&platform=amazon`, {
      headers: auth2,
    });
    const data2 = await res2.json();
    const hasAftData2 = Array.isArray(data2) && data2.length >= 2;

    const yanyoEntries = await fetchYanyoData(asin);
    const hasYanyo = yanyoEntries.length >= 2;

    if (!hasAftData2 && !hasYanyo) return;

    const rawEntries = hasAftData2 ? data2 : [];
    const hasYanyo2 = yanyoEntries.length >= 2;
    const {mesaj, sınıf} = hasAftData2 ? getPriceMessage(data2, nowPrice) : hasYanyo2 ? getPriceMessage(yanyoEntries, nowPrice) : {mesaj: "", sınıf: "bilgi"};

    const labels = rawEntries.map((d) => new Date(d.tarih).toLocaleDateString("tr-TR"));
    const dataPoints = rawEntries.map((d) => parseFloat(d.fiyat));

    insertBox(sınıf, mesaj, labels, dataPoints, rawEntries, yanyoEntries);
  } catch (err) {
    console.error("getPriceHistory hata:", err);
  }
}

function getPriceMessage(data, nowPrice) {
  const V = {...data.at(-1), tarih: new Date(data.at(-1).tarih)};
  const fiyatlar = data.map((d) => ({tarih: new Date(d.tarih), fiyat: parseFloat(d.fiyat)})).filter((d) => Number.isFinite(d.fiyat));

  const N = parseFloat(nowPrice?.replace(/\./g, "").replace(",", "."));
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

function insertBox(cls, html, labels, dataPoints, rawEntries, yanyoEntries = []) {
  document.querySelector(".price-history-box")?.remove();

  const box = document.createElement("div");
  box.className = `price-history-box ${cls}`;
  box.innerHTML = html;
  box.style.position = "relative";

  const shareBtn = document.createElement("button");
  shareBtn.textContent = "Paylaş";
  shareBtn.style.cssText = `
    display: inline-block;
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
    z-index: 10;
    background-color: #ff7300ff;
    border: 1px solid #0059ffff;
    border-radius: 4px;
    color: #333;
  `;

  shareBtn.onclick = async () => {
    const tempDiv = Object.assign(document.createElement("div"), {
      style: {position: "absolute", left: "-9999px"},
    });
    document.body.appendChild(tempDiv);

    const boxClone = box.cloneNode(true);
    boxClone.querySelector("button")?.remove();
    tempDiv.appendChild(boxClone);

    const idMatch = window.location.pathname.match(/\/(?:dp|gp\/product)\/([^\/]+)/);
    const id = idMatch?.[1];
    const url = `https://www.amazon.com.tr/dp/${id}?th=1&psc=1`;

    const urlPara = document.createElement("p");
    urlPara.textContent = url;
    urlPara.style.cssText = "margin-bottom:12px;font-weight:bold;color:#333;";
    tempDiv.appendChild(urlPara);

    try {
      await navigator.clipboard.writeText(tempDiv.innerText);
      window.toast("Ürün bilgisi kopyalandı.", "success");
    } catch (err) {
      window.toast("Kopyalama başarısız.", "error");
    }

    tempDiv.remove();
  };

  box.appendChild(shareBtn);

  const target = document.querySelector("#followButtonWrapper");
  if (target) target.insertAdjacentElement("afterend", box);
  const chartContainer = document.querySelector("#chartDiv")?.parentElement;
  if (chartContainer) chartContainer.remove();

  insertChartAfterPPD(labels, dataPoints, rawEntries, yanyoEntries);
}

//grafik ekleme
const PERIODS = {"1yıl": 12, "6ay": 6, "3ay": 3, "1ay": 1};

function filterByPeriod(rawEntries, ay) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - ay, now.getDate());
  return rawEntries.filter((e) => new Date(e.tarih) >= start);
}

function insertChartAfterPPD(labels, dataPoints, rawEntries, yanyoEntries = []) {
  const EndDiv = document.querySelector("#ATFCriticalFeaturesDataContainer");
  if (!EndDiv) return;

  if ((!Array.isArray(rawEntries) || rawEntries.length === 0) && yanyoEntries.length === 0) {
    const noDataDiv = document.createElement("div");
    noDataDiv.id = "chartDiv";
    noDataDiv.className = "no-data";
    noDataDiv.textContent = "Grafik verisi bulunamadı.";
    EndDiv.insertAdjacentElement("afterend", noDataDiv);
    return;
  }

  const toggleState = {aft: true, yanyo: true};

  const container = document.createElement("div");
  container.id = "priceChartContainer";
  container.className = "chart-container";

  // Toggle butonları
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

  // Periyot butonları
  const btnGroup = document.createElement("div");
  btnGroup.className = "chart-btn-group";
  let currentPeriod = 12;

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

  const chartDiv = document.createElement("div");
  chartDiv.id = "chartDiv";
  chartDiv.className = "chart-area";

  container.appendChild(btnGroup);
  container.appendChild(toggleGroup);
  container.appendChild(chartDiv);
  EndDiv.insertAdjacentElement("afterend", container);

  const chart = echarts.init(chartDiv);

  currentPeriod = 12;
  btnGroup.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.textContent === "1 Yıl");
  });
  const initialEntries = filterByPeriod(rawEntries, 12);
  const initialYanyo = filterByPeriod(yanyoEntries, 12);
  updateChart(chart, initialEntries, initialYanyo, toggleState);
  window.addEventListener("resize", () => chart.resize());
}

function updateChart(chart, entries, yanyoEntries = [], toggleState = {aft: true, yanyo: true}) {
  if ((!entries || entries.length === 0) && yanyoEntries.length === 0) return;
  entries = entries || [];

  const aftPoints = toggleState.aft ? entries.map((e) => parseFloat(e.fiyat)) : [];
  const aftLabels = toggleState.aft ? entries.map((e) => new Date(e.tarih).toLocaleDateString("tr-TR")) : [];

  const yanyoPoints = toggleState.yanyo && yanyoEntries.length > 0 ? yanyoEntries.map((e) => parseFloat(e.fiyat)) : [];
  const yanyoLabels = toggleState.yanyo && yanyoEntries.length > 0 ? yanyoEntries.map((e) => new Date(e.tarih).toLocaleDateString("tr-TR")) : [];

  const allLabels = [...new Set([...aftLabels, ...yanyoLabels])].sort(
    (a, b) => new Date(a.split(".").reverse().join("-")) - new Date(b.split(".").reverse().join("-")),
  );

  const allPoints = [...aftPoints, ...yanyoPoints].filter(Number.isFinite);
  const minY = allPoints.length ? Math.min(...allPoints) - 10 : 0;
  const maxY = allPoints.length ? Math.max(...allPoints) + 10 : 100;

  const dataPoints = aftPoints;
  const labels = allLabels;

  chart.setOption({
    grid: {left: "0%", right: "0%", bottom: "0%", top: "5%", containLabel: true},
    tooltip: {
      trigger: "axis",
      axisPointer: {type: "cross"},
      formatter: (params) => {
        return params
          .map((param) => {
            const seriesName = param.seriesName;
            const i = param.dataIndex;
            const label = labels[i];
            const sourceEntries = seriesName === "Yaniyo" ? yanyoEntries : entries;
            const e = sourceEntries.find((e) => new Date(e.tarih).toLocaleDateString("tr-TR") === label);
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
            return `<div style="color:${color};font-weight:bold;">[${seriesName}] ${arrow} %${pct} - ₺${val}</div>
                  <div style="color:#555;">${date} ${time}</div>`;
          })
          .filter(Boolean)
          .join("<hr style='margin:4px 0;border-color:#eee;'/>");
      },
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: {interval: Math.floor(labels.length / 10)},
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
          ? labels.map((l) => {
              const e = entries.find((e) => new Date(e.tarih).toLocaleDateString("tr-TR") === l);
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
            {type: "max", itemStyle: {color: "#ff0000"}, label: {formatter: "₺{c}", color: "#ff0000", position: "bottom", fontWeight: "bold"}},
            {type: "min", itemStyle: {color: "#ff0000"}, label: {formatter: "₺{c}", color: "#ff0000", position: "top", fontWeight: "bold"}},
          ],
        },
      },
      {
        name: "Yaniyo",
        data: toggleState.yanyo
          ? labels.map((l) => {
              const e = yanyoEntries.find((e) => new Date(e.tarih).toLocaleDateString("tr-TR") === l);
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
      },
    ],
  });
}

async function fetchYanyoData(asin) {
  const PRICE_HISTORY_ARRAY_KEY = "dfwqsZwgh";
  const PRICE_KEY = "dfwqs";
  const DATE_KEY = "rohs";

  const productApiUrl = `https://apiv2.yaniyo.com/api/product/id/${asin}`;

  try {
    const response = await fetch(productApiUrl, {credentials: "omit"});
    if (!response.ok) {
      console.error("Yanyo API HTTP error:", response.status);
      return [];
    }

    const rawText = await response.text();
    const regex = new RegExp(`"${PRICE_HISTORY_ARRAY_KEY}"\\s*:\\s*(\\[[\\s\\S]*?\\])`, "i");
    const match = rawText.match(regex);

    if (!match?.[1]) return [];

    const obfuscatedArray = JSON.parse(match[1]);
    if (!Array.isArray(obfuscatedArray)) return [];

    return obfuscatedArray
      .map((item) => {
        let date = item[DATE_KEY];
        const price = item[PRICE_KEY];

        if (price === null || date === null || typeof date !== "string" || isNaN(parseFloat(price))) return null;

        if (date.endsWith("N")) date = date.slice(0, -1) + "Z";
        if (date.charAt(10) === "H") date = date.slice(0, 10) + "T" + date.slice(11);

        const dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) {
          console.warn("Geçersiz tarih, atlanıyor:", item[DATE_KEY]);
          return null;
        }

        return {
          fiyat: parseFloat(price).toFixed(2),
          tarih: dateObj.toISOString(),
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.error("Yanyo fetch/parse hatası:", error);
    return [];
  }
}

window.getPriceHistory = getPriceHistory;

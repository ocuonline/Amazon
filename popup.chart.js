//popup.chart.js (bu açıklamayı silme)
import {getAuthHeaders} from "./src/auth2.js";

if (typeof browser === "undefined") {
  var browser = chrome;
}

const CONFIG = {
  TL_FORMAT: {minimumFractionDigits: 2, maximumFractionDigits: 2},
  PERIODS: {"1yıl": 12, "6ay": 6, "3ay": 3, "1ay": 1},
};

async function fetchYanyoData(asin) {
  try {
    const response = await fetch(`https://yaniyo.com/dp/${asin}`);
    if (!response.ok) return [];

    const html = await response.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match?.[1]) return [];

    const json = JSON.parse(match[1]);
    const priceList = json?.props?.pageProps?.data?.priceList;
    if (!Array.isArray(priceList) || priceList.length === 0) return [];

    return priceList
      .map((item) => {
        const price = parseFloat(item.price);
        const dateObj = new Date(item.date);
        if (!Number.isFinite(price) || isNaN(dateObj.getTime())) return null;
        return {tarih: dateObj.toISOString(), fiyat: price.toFixed(2)};
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function fetchProductData(urun_id) {
  const platform = urun_id.startsWith("HB") ? "hb" : "amazon";
  console.log("[fetchProductData] başladı:", urun_id, "platform:", platform);
  try {
    const auth = await getAuthHeaders();
    console.log("[fetchProductData] auth headers:", auth);
    const res = await fetch(`https://aft.web.tr/extension/GetPrice.php?urun_id=${urun_id}&platform=${platform}`, {
      headers: auth,
    });
    console.log("[fetchProductData] response status:", res.status, res.ok);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const json = await res.json();
    console.log("[fetchProductData] dönen veri:", json);
    return json;
  } catch (err) {
    console.error("[fetchProductData] HATA:", err.message);
    return null;
  }
}

export async function renderChart(urun_id, data, realProductId = urun_id) {
  console.log("[renderChart] başladı, urun_id:", urun_id, "realProductId:", realProductId);
  const el = document.getElementById(urun_id);
  console.log("[renderChart] element bulundu mu:", el);
  const container = el?.parentNode;
  console.log("[renderChart] container:", container);
  if (!container) {
    console.error("[renderChart] container bulunamadı, çıkılıyor.");
    return;
  }

  data = Array.isArray(data) ? data : [];
  console.log("[renderChart] data uzunluğu:", data.length, "ilk 3 kayıt:", data.slice(0, 3));

  const isAmazon = !realProductId.startsWith("HB");
  const yanyoRaw = !realProductId.startsWith("HB") ? await fetchYanyoData(realProductId) : [];

  const chartDiv = document.createElement("div");
  chartDiv.id = `${urun_id}-echart`;
  chartDiv.style.height = "200px";
  chartDiv.style.width = "100%";
  container.appendChild(chartDiv);

  const chart = echarts.init(chartDiv);
  const resizeHandler = () => chart.resize();
  window.addEventListener("resize", resizeHandler);
  chartDiv.addEventListener(
    "remove",
    () => {
      chart.dispose();
      window.removeEventListener("resize", resizeHandler);
    },
    {once: true},
  );
  const toggleState = {aft: true, yanyo: true};
  let currentPeriod = 12;

  const getAgg = (ay) => aggregateData(data, ay);
  const getYanyo = (ay) => aggregateData(yanyoRaw, ay);

  const initialAgg = getAgg(12);
  const initialYanyo = getYanyo(12);
  console.log("[YANIYO DEBUG] initialAgg.length:", initialAgg.length, "initialYanyo.length:", initialYanyo.length, "initialYanyo:", initialYanyo);
  chart.setOption(getChartOption(initialAgg, initialYanyo, toggleState));

  const {periodButtons, toggleButtons} = createHeader(container, "1yıl", isAmazon);

  toggleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.toggle;
      toggleState[key] = !toggleState[key];
      btn.classList.toggle("active", toggleState[key]);
      const agg = getAgg(currentPeriod);
      const yanyo = getYanyo(currentPeriod);
      chart.setOption(getChartOption(agg, yanyo, toggleState));
    });
  });

  periodButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.id.replace("Btn", "");
      setActive(btn, periodButtons);
      currentPeriod = CONFIG.PERIODS[key];
      const agg = getAgg(currentPeriod);
      const yanyo = getYanyo(currentPeriod);
      chart.setOption(getChartOption(agg, yanyo, toggleState));
    });
  });
}

function aggregateData(data, ay) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - ay, now.getDate());

  return data
    .filter(({tarih}) => {
      const d = new Date(tarih);
      return !isNaN(d) && d >= start;
    })
    .map(({tarih, fiyat}) => ({date: tarih, fiyat: parseFloat(fiyat)}))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function createHeader(container, defaultKey, showToggle = false) {
  const header = document.createElement("div");
  header.id = "priceHeader";

  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";

  Object.keys(CONFIG.PERIODS).forEach((key) => {
    const btn = document.createElement("button");
    btn.id = `${key}Btn`;
    btn.textContent = key.replace("ay", " Ay").replace("yıl", " Yıl");
    btn.setAttribute("aria-label", `Son ${key} fiyatlarını göster`);
    if (key === defaultKey) btn.classList.add("active");
    btn.dataset.period = key;
    buttonGroup.appendChild(btn);
  });

  header.appendChild(buttonGroup);

  const toggleButtons = [];
  if (showToggle) {
    const toggleGroup = document.createElement("div");
    toggleGroup.className = "button-group toggle-group-right";
    ["AFT", "Yaniyo"].forEach((label) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.className = "active";
      btn.dataset.toggle = label === "AFT" ? "aft" : "yanyo";
      toggleGroup.appendChild(btn);
      toggleButtons.push(btn);
    });
    header.appendChild(toggleGroup);
  }

  container.insertBefore(header, container.firstChild);

  return {periodButtons: buttonGroup.querySelectorAll("button"), toggleButtons};
}

function setActive(activeBtn, buttons) {
  buttons.forEach((btn) => btn.classList.remove("active"));
  activeBtn.classList.add("active");
}

function getChartOption(data, yanyoData = [], toggleState = {aft: true, yanyo: true}) {
  const allLabels = [...new Set([...data.map((d) => d.date), ...yanyoData.map((d) => d.date)])].sort((a, b) => new Date(a) - new Date(b));

  const aftPoints = toggleState.aft
    ? allLabels.map((l) => {
        const d = data.find((d) => d.date === l);
        return d ? d.fiyat : null;
      })
    : [];
  const yanyoPoints = toggleState.yanyo
    ? allLabels.map((l) => {
        const d = yanyoData.find((d) => d.date === l);
        return d ? d.fiyat : null;
      })
    : [];
  const allPoints = [...aftPoints, ...yanyoPoints].filter(Number.isFinite);
  const minY = allPoints.length ? Math.min(...allPoints) - 10 : 0;
  const maxY = allPoints.length ? Math.max(...allPoints) + 10 : 100;

  return {
    grid: {left: "0%", right: "1%", top: "7%", bottom: "0%", containLabel: true},
    tooltip: {
      trigger: "axis",
      axisPointer: {type: "cross"},
      formatter: (params) => {
        return params
          .map((param) => {
            const seriesName = param.seriesName;
            const i = param.dataIndex;
            const label = allLabels[i];
            const sourceData = seriesName === "Yaniyo" ? yanyoData : data;
            const current = sourceData.find((d) => d.date === label);
            if (!current) return "";

            const idx = sourceData.indexOf(current);
            const prev = idx > 0 ? sourceData[idx - 1] : current;
            const value = current.fiyat;
            const prevVal = prev.fiyat;
            const diff = prevVal !== 0 ? ((value - prevVal) / prevVal) * 100 : 0;
            const pct = Math.abs(diff).toFixed(2);
            const arrow = value > prevVal ? "⬆" : value < prevVal ? "⬇" : "⟷";
            const color = value > prevVal ? "#ef4444" : value < prevVal ? "#22c55e" : "#aaa";

            return `<div style="color:${color}; font-weight:bold;">[${seriesName}] ${arrow} %${pct} - ₺${value.toLocaleString("tr-TR", CONFIG.TL_FORMAT)}</div>
                  <div style="color:#aaa;">${formatDateTime(current.date)}</div>`;
          })
          .filter(Boolean)
          .join("<hr style='margin:4px 0;border-color:#2a2a2a;'/>");
      },
    },
    xAxis: {
      type: "category",
      data: allLabels,
      axisLabel: {color: "#aaa"},
      axisLine: {lineStyle: {color: "#444"}},
      splitLine: {lineStyle: {color: "#2a2a2a"}},
    },
    yAxis: {
      type: "value",
      min: minY,
      max: maxY,
      axisLabel: {
        formatter: (val) => `₺${val.toLocaleString("tr-TR")}`,
        color: "#aaa",
      },
      axisLine: {lineStyle: {color: "#444"}},
      splitLine: {lineStyle: {color: "#2a2a2a"}},
    },
    series: [
      {
        name: "AFT",
        data: aftPoints,
        type: "line",
        smooth: true,
        connectNulls: true,
        lineStyle: {width: 2, color: "#4575f7"},
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              {offset: 0, color: "rgba(255, 0, 0, 0.3)"},
              {offset: 1, color: "rgba(0, 255, 0, 0.3)"},
            ],
          },
        },
        markPoint: {
          symbol: "pin",
          symbolSize: 16,
          data: [
            {type: "max", itemStyle: {color: "#ff0000"}, label: {show: false}},
            {type: "min", itemStyle: {color: "#ff0000"}, label: {show: false}},
          ],
        },
      },
      {
        name: "Yaniyo",
        data: yanyoPoints,
        type: "line",
        smooth: true,
        connectNulls: true,
        lineStyle: {width: 2, color: "#f7a645"},
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
          symbolSize: 16,
          data: [
            {type: "max", itemStyle: {color: "#ff0000"}, label: {show: false}},
            {type: "min", itemStyle: {color: "#ff0000"}, label: {show: false}},
          ],
        },
      },
    ],
  };
}

function formatDateTime(dateStr) {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

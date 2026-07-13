//popup.chart.js (bu açıklamayı silme)

if (typeof browser === "undefined") {
  var browser = chrome;
}

const CONFIG = {
  TL_FORMAT: {minimumFractionDigits: 2, maximumFractionDigits: 2},
  PERIODS: {"1yıl": 12, "6ay": 6, "3ay": 3, "1ay": 1},
};

async function hmacSign(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getAuthHeaders(body = "") {
  const extensionId = browser.runtime.id;
  const result = await browser.storage.local.get(["authToken", "hmacSecret"]);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await hmacSign(result.hmacSecret || "", timestamp + "." + body);
  return {
    "X-Token": result.authToken || "",
    "X-Extension-Id": extensionId,
    "X-Timestamp": timestamp,
    "X-Signature": signature,
  };
}

async function fetchYanyoData(asin) {
  const PRICE_HISTORY_ARRAY_KEY = "dfwqsZwgh";
  const PRICE_KEY = "dfwqs";
  const DATE_KEY = "rohs";

  try {
    const response = await fetch(`https://apiv2.yaniyo.com/api/product/id/${asin}`);
    if (!response.ok) return [];
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
        if (isNaN(dateObj.getTime())) return null;
        return {tarih: dateObj.toISOString(), fiyat: parseFloat(price).toFixed(2)};
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function fetchProductData(urun_id) {
  const platform = urun_id.startsWith("HB") ? "hb" : "amazon";
  try {
    const auth = await getAuthHeaders();
    const res = await fetch(`https://aft.web.tr/extension/GetPrice.php?urun_id=${urun_id}&platform=${platform}`, {
      headers: auth,
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.log("Veri alınırken hata:", err.message);
    return null;
  }
}

export async function renderChart(urun_id, data, realProductId = urun_id) {
  const container = document.getElementById(urun_id)?.parentNode;
  if (!container) return;

  data = Array.isArray(data) ? data : [];

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
  const result = [];
  const map = {};
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - ay, now.getDate());

  data.forEach(({tarih, fiyat}) => {
    const d = new Date(tarih);
    if (isNaN(d) || d < start) return;
    const key = d.toISOString().split("T")[0];
    if (!map[key]) map[key] = [];
    map[key].push(parseFloat(fiyat));
  });

  for (const key in map) {
    const ort = Math.round(map[key].reduce((a, b) => a + b, 0) / map[key].length);
    result.push({date: key, fiyat: ort});
  }

  return result.sort((a, b) => new Date(a.date) - new Date(b.date));
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
            {type: "max", itemStyle: {color: "#ff0000"}, label: {show: true, formatter: "₺{c}", color: "#ff0000", position: "left", fontWeight: "bold"}},
            {type: "min", itemStyle: {color: "#eeff00"}, label: {show: true, formatter: "₺{c}", color: "#eeff00", position: "left", fontWeight: "bold"}},
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

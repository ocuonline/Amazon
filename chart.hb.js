// content.chart.hb.js

async function getPriceHistory(urunId) {
  try {
    const auth = await window.getAuthHeaders();
    const res = await fetch(`https://aft.web.tr/extension/GetPrice.php?urun_id=${urunId}&platform=hb`, {
      headers: auth,
    });
    const data = await res.json();
    if (!Array.isArray(data) || data.length < 2) return;

    const nowPrice = window.getLivePrice?.();
    const parsedNow = parseFloat(nowPrice?.replace(/\s*TL/gi, "").replace(/\./g, "").replace(",", "."));

    if (Number.isFinite(parsedNow) && parsedNow > 0) {
      const updateAuth = await window.getAuthHeaders();
      await fetch("https://aft.web.tr/extension/UpdatePrice.php", {
        method: "POST",
        headers: {"Content-Type": "application/x-www-form-urlencoded", ...updateAuth},
        body: new URLSearchParams({urun_id: urunId, fiyat: nowPrice, platform: "hb"}),
      });
    }

    const auth2 = await window.getAuthHeaders();
    const res2 = await fetch(`https://aft.web.tr/extension/GetPrice.php?urun_id=${urunId}&platform=hb`, {
      headers: auth2,
    });
    const data2 = await res2.json();
    if (!Array.isArray(data2) || data2.length < 2) return;

    const {mesaj, sınıf} = getPriceMessage(data2, nowPrice);

    const labels = data2.map((d) => new Date(d.tarih).toLocaleDateString("tr-TR"));
    const dataPoints = data2.map((d) => parseFloat(d.fiyat));
    const rawEntries = data2;

    insertBox(sınıf, mesaj, labels, dataPoints, rawEntries);
  } catch (err) {
    console.error("getPriceHistory hata:", err);
  }
}

function getPriceMessage(data, nowPrice) {
  const V = {...data.at(-1), tarih: new Date(data.at(-1).tarih)};
  const fiyatlar = data.map((d) => ({tarih: new Date(d.tarih), fiyat: parseFloat(d.fiyat)})).filter((d) => Number.isFinite(d.fiyat));

  const N = parseFloat(nowPrice?.replace(/\s*TL/gi, "").replace(/\./g, "").replace(",", "."));
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

function insertBox(cls, html, labels, dataPoints, rawEntries) {
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

    const pmMatch = window.location.href.match(/(pm?-[A-Z0-9]+)(?:[/?]|$)/i);
    const url = pmMatch ? `https://www.hepsiburada.com/-${pmMatch[1]}` : window.location.href.split("?")[0];

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

  insertChartAfterContent(labels, dataPoints, rawEntries);
}

// grafik ekleme
const PERIODS = {"1yıl": 12, "6ay": 6, "3ay": 3, "1ay": 1};

function filterByPeriod(rawEntries, ay) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - ay, now.getDate());
  return rawEntries.filter((e) => new Date(e.tarih) >= start);
}

function insertChartAfterContent(labels, dataPoints, rawEntries) {
  const anchorEl = document.querySelector("#followButtonWrapper") || document.querySelector('h1[data-test-id="title"]');
  if (!anchorEl) return;

  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    const noDataDiv = document.createElement("div");
    noDataDiv.id = "chartDiv";
    noDataDiv.className = "no-data";
    noDataDiv.textContent = "Grafik verisi bulunamadı.";
    anchorEl.insertAdjacentElement("afterend", noDataDiv);
    return;
  }

  const existing = document.querySelector("#priceChartContainer");
  if (existing) existing.remove();

  const container = document.createElement("div");
  container.id = "priceChartContainer";
  container.className = "chart-container";

  const btnGroup = document.createElement("div");
  btnGroup.className = "chart-btn-group";
  Object.keys(PERIODS).forEach((key) => {
    const btn = document.createElement("button");
    btn.textContent = key.replace("ay", " Ay").replace("yıl", " Yıl");
    btn.className = "chart-period-btn";
    if (key === "1ay") btn.classList.add("active");
    btn.addEventListener("click", () => {
      btnGroup.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const filtered = filterByPeriod(rawEntries, PERIODS[key]);
      updateChart(chart, filtered);
    });
    btnGroup.appendChild(btn);
  });

  const chartDiv = document.createElement("div");
  chartDiv.id = "chartDiv";
  chartDiv.className = "chart-area";

  container.appendChild(btnGroup);
  container.appendChild(chartDiv);

  const campaignBundle = document.querySelector('[data-test-id="campaign-bundle"]');
  if (campaignBundle) {
    campaignBundle.insertAdjacentElement("beforebegin", container);
  } else if (document.querySelector(".price-history-box")) {
    document.querySelector(".price-history-box").insertAdjacentElement("afterend", container);
  } else {
    anchorEl.insertAdjacentElement("afterend", container);
  }

  const chart = echarts.init(chartDiv);

  const defaultPeriods = [12, 6, 3, 1];
  let initialEntries = [];
  for (const ay of defaultPeriods) {
    const filtered = filterByPeriod(rawEntries, ay);
    if (filtered.length >= 2) {
      initialEntries = filtered;
      const matchKey = Object.keys(PERIODS).find((k) => PERIODS[k] === ay);
      btnGroup.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("active", b.textContent === matchKey?.replace("ay", " Ay").replace("yıl", " Yıl"));
      });
      break;
    }
  }
  if (!initialEntries.length) initialEntries = rawEntries;
  updateChart(chart, initialEntries);
  window.addEventListener("resize", () => chart.resize());
}

function updateChart(chart, entries) {
  if (!entries || entries.length === 0) return;

  const dataPoints = entries.map((e) => parseFloat(e.fiyat));
  const labels = entries.map((e) => new Date(e.tarih).toLocaleDateString("tr-TR"));
  const minY = Math.min(...dataPoints) - 10;
  const maxY = Math.max(...dataPoints) + 10;

  chart.setOption({
    grid: {left: "0%", right: "0%", bottom: "0%", top: "5%", containLabel: true},
    tooltip: {
      trigger: "axis",
      axisPointer: {type: "cross"},
      formatter: ({[0]: {dataIndex: i}}) => {
        const e = entries[i];
        const d = new Date(e.tarih);
        const date = d.toLocaleDateString("tr-TR");
        const time = d.toLocaleTimeString("tr-TR", {hour: "2-digit", minute: "2-digit", second: "2-digit"});
        const val = parseFloat(e.fiyat).toFixed(2);
        const prev = i > 0 ? parseFloat(entries[i - 1].fiyat) : val;
        const diff = prev !== 0 ? ((val - prev) / prev) * 100 : 0;
        const pct = Math.abs(diff).toFixed(2);
        const up = val > prev,
          down = val < prev;
        const arrow = up ? "⬆" : down ? "⬇" : "⟷";
        const color = up ? "#D32F2F" : down ? "#388E3C" : "#333";
        return `<div style="color:${color};font-weight:bold;">${arrow} %${pct} - ₺${val}</div>
                <div style="color:#555;">${date} ${time}</div>`;
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
        data: dataPoints,
        type: "line",
        smooth: true,
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
    ],
  });
}

window.getPriceHistory = getPriceHistory;

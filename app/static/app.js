const state = {
  products: [],
  selectedIsins: new Set(),
  chartRefreshes: new Map(),
  chart: null,
};

const elements = {
  totalProducts: document.querySelector("#totalProducts"),
  lastSync: document.querySelector("#lastSync"),
  statusMessage: document.querySelector("#statusMessage"),
  shownProducts: document.querySelector("#shownProducts"),
  searchInput: document.querySelector("#searchInput"),
  scopeInput: document.querySelector("#scopeInput"),
  assetClassInput: document.querySelector("#assetClassInput"),
  regionInput: document.querySelector("#regionInput"),
  currencyInput: document.querySelector("#currencyInput"),
  distributionInput: document.querySelector("#distributionInput"),
  replicationInput: document.querySelector("#replicationInput"),
  instrumentTypeInput: document.querySelector("#instrumentTypeInput"),
  zeroFeeInput: document.querySelector("#zeroFeeInput"),
  maxTerInput: document.querySelector("#maxTerInput"),
  minFundSizeInput: document.querySelector("#minFundSizeInput"),
  maxRiskInput: document.querySelector("#maxRiskInput"),
  sortInput: document.querySelector("#sortInput"),
  productsBody: document.querySelector("#productsBody"),
  manualIsins: document.querySelector("#manualIsins"),
  chartHelp: document.querySelector("#chartHelp"),
};

function setStatus(message) {
  elements.statusMessage.textContent = message;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.detail || response.statusText);
  }
  return response.json();
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(2)}%`;
}

function formatNumber(value, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
}

function trendClass(value) {
  const numericValue = Number(value);
  if (Number.isNaN(numericValue) || numericValue === 0) return "";
  return numericValue > 0 ? "positive" : "negative";
}

function formatInstrumentType(value) {
  const labels = {
    stock: "Stock",
    etf: "ETF",
    crypto_etp: "Crypto & other ETP",
  };
  return labels[value] || value || "—";
}

function isEtfProduct(product) {
  return product.instrument_type === "etf" || product.asset_class === "ETF";
}

function optionList(select, values, placeholder, emptyPlaceholder = "No values available yet", labelFormatter = (value) => value) {
  const currentValue = select.value;
  const normalizedValues = values.filter(Boolean);
  select.innerHTML = `<option value="">${normalizedValues.length ? placeholder : emptyPlaceholder}</option>`;
  select.disabled = normalizedValues.length === 0;
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labelFormatter(value);
    select.append(option);
  });
  select.value = normalizedValues.includes(currentValue) ? currentValue : "";
}

async function loadFilters() {
  const filters = await api(`/api/filters?scope=${elements.scopeInput.value}`);
  optionList(elements.assetClassInput, filters.asset_class || [], "Any asset class");
  optionList(elements.regionInput, filters.region || [], "Any region", "Refresh justETF overview first");
  optionList(elements.currencyInput, filters.currency || [], "Any currency", "Refresh justETF overview first");
  optionList(elements.distributionInput, filters.distribution_policy || [], "Any distribution");
  optionList(elements.replicationInput, filters.replication || [], "Any replication", "Refresh justETF overview first");
  optionList(elements.instrumentTypeInput, filters.instrument_type || [], "Any neon type", "No neon types found", formatInstrumentType);
}

function buildProductQuery() {
  const params = new URLSearchParams({
    scope: elements.scopeInput.value,
    limit: "500",
    sort: elements.sortInput.value || "name",
  });
  const mappings = [
    ["search", elements.searchInput.value],
    ["asset_class", elements.assetClassInput.value],
    ["region", elements.regionInput.value],
    ["currency", elements.currencyInput.value],
    ["distribution_policy", elements.distributionInput.value],
    ["replication", elements.replicationInput.value],
    ["instrument_type", elements.instrumentTypeInput.value],
    ["zero_fee", elements.zeroFeeInput.value],
    ["max_ter", elements.maxTerInput.value],
    ["min_fund_size", elements.minFundSizeInput.value],
    ["max_risk", elements.maxRiskInput.value],
  ];
  mappings.forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

function clearFilters() {
  elements.searchInput.value = "";
  elements.scopeInput.value = "neon";
  [
    elements.assetClassInput,
    elements.regionInput,
    elements.currencyInput,
    elements.distributionInput,
    elements.replicationInput,
    elements.instrumentTypeInput,
    elements.zeroFeeInput,
    elements.sortInput,
  ].forEach((input) => {
    input.value = input === elements.sortInput ? "name" : "";
  });
  elements.maxTerInput.value = "";
  elements.minFundSizeInput.value = "";
  elements.maxRiskInput.value = "";
}

function renderProducts(items, total) {
  state.products = items;
  elements.shownProducts.textContent = `Showing ${total} product${total === 1 ? "" : "s"}`;
  elements.productsBody.innerHTML = "";

  if (!items.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="15">No products yet. Add neon ISINs or refresh the official neon list — the database goblin is hungry.</td>`;
    elements.productsBody.append(row);
    return;
  }

  items.forEach((product) => {
    const row = document.createElement("tr");
    const checked = state.selectedIsins.has(product.isin) ? "checked" : "";
    row.innerHTML = `
      <td><input type="checkbox" data-isin="${product.isin}" ${checked} /></td>
      <td>${formatInstrumentType(product.instrument_type)}</td>
      <td class="name-cell">${product.full_name || product.name || product.neon_name || "Unnamed instrument"}</td>
      <td class="number">${product.isin}</td>
      <td>${product.zero_fee === null || product.zero_fee === undefined ? "—" : product.zero_fee ? "✅" : "no"}</td>
      <td class="number">${formatPercent(product.ter)}</td>
      <td class="number">${formatNumber(product.fund_size_mn, " mn")}</td>
      <td>${product.currency || "—"}</td>
      <td>${product.region || "—"}</td>
      <td>${product.distribution_policy || "—"}</td>
      <td>${product.replication || "—"}</td>
      <td class="number ${trendClass(product.return_1y)}">${formatPercent(product.return_1y)}</td>
      <td class="number ${trendClass(product.return_3y)}">${formatPercent(product.return_3y)}</td>
      <td class="number ${trendClass(product.return_5y)}">${formatPercent(product.return_5y)}</td>
      <td class="number ${trendClass(product.max_drawdown)}">${formatPercent(product.max_drawdown)}</td>
    `;
    row.querySelector("input").addEventListener("change", async (event) => {
      if (event.target.checked) {
        state.selectedIsins.add(product.isin);
        await refreshChartDataForProduct(product);
      } else {
        state.selectedIsins.delete(product.isin);
        await loadPerformance();
      }
    });
    elements.productsBody.append(row);
  });
}

async function loadProducts() {
  setStatus("Loading products…");
  const data = await api(`/api/products?${buildProductQuery()}`);
  renderProducts(data.items, data.total);
  setStatus("Ready");
}

async function loadDatabaseTotal() {
  const data = await api("/api/products?scope=neon&limit=1");
  elements.totalProducts.textContent = `${data.total} product${data.total === 1 ? "" : "s"}`;
}

async function loadSyncRuns() {
  const data = await api("/api/sync/runs?limit=1");
  const lastRun = data.items?.[0];
  elements.lastSync.textContent = lastRun
    ? `${lastRun.source}: ${lastRun.status} · ${lastRun.records} records`
    : "No sync yet";
}

function chartColors(index) {
  return ["#19b878", "#17211d", "#e8a039", "#5c7cfa", "#d6336c", "#0ca678"][index % 6];
}

async function loadPerformance() {
  const isins = Array.from(state.selectedIsins);
  const context = document.querySelector("#performanceChart");
  if (!isins.length) {
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    elements.chartHelp.innerHTML =
      "Select ETF rows in the table. The app will fetch justETF chart data automatically and redraw the comparison.";
    return;
  }

  const data = await api(`/api/performance?isins=${encodeURIComponent(isins.join(","))}&normalize=true`);
  const seriesWithPoints = data.series.filter((series) => series.points.length > 0);
  const missingSeries = data.series.filter((series) => series.points.length === 0);
  if (!seriesWithPoints.length) {
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    elements.chartHelp.innerHTML =
      "No saved chart data for the selected instruments yet. Chart data is fetched automatically for ETFs; stocks and some ETPs are not available from justETF.";
    return;
  }

  elements.chartHelp.textContent = missingSeries.length
    ? `Showing ${seriesWithPoints.length} product${seriesWithPoints.length === 1 ? "" : "s"}. ${missingSeries.length} selected instrument${missingSeries.length === 1 ? " has" : "s have"} no saved justETF chart data.`
    : "Drag to pan, scroll/pinch to zoom. Values are normalized from each product’s first saved chart date.";

  const labels = Array.from(new Set(seriesWithPoints.flatMap((series) => series.points.map((point) => point.date)))).sort();
  const datasets = seriesWithPoints.map((series, index) => {
    const pointMap = new Map(series.points.map((point) => [point.date, point.value]));
    return {
      label: `${series.name || series.isin}`,
      data: labels.map((label) => pointMap.get(label) ?? null),
      borderColor: chartColors(index),
      backgroundColor: chartColors(index),
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.22,
      spanGaps: true,
    };
  });

  if (state.chart) state.chart.destroy();
  state.chart = new Chart(context, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (contextItem) => `${contextItem.dataset.label}: ${formatPercent(contextItem.raw)}`,
          },
        },
        zoom: {
          pan: { enabled: true, mode: "x" },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "x",
          },
        },
      },
      scales: {
        y: {
          ticks: { callback: (value) => `${value}%` },
          title: { display: true, text: "Return since first shared date" },
        },
        x: { ticks: { maxTicksLimit: 10 } },
      },
    },
  });
}

async function refreshChartDataForProduct(product) {
  if (!isEtfProduct(product)) {
    elements.chartHelp.textContent = "Chart data is fetched automatically for ETFs. This selected instrument is not marked as an ETF.";
    await loadPerformance();
    return;
  }

  if (state.chartRefreshes.has(product.isin)) {
    await state.chartRefreshes.get(product.isin);
    return;
  }

  const label = product.neon_name || product.name || product.isin;
  elements.chartHelp.textContent = `Fetching justETF chart data for ${label}…`;
  setStatus(`Fetching chart data for ${product.isin}…`);

  const refreshPromise = api("/api/sync/justetf/charts", {
    method: "POST",
    body: JSON.stringify({ isins: [product.isin], unclosed: false }),
  })
    .then(async (result) => {
      setStatus(result.message || "Chart data refreshed");
      await loadPerformance();
    })
    .catch(async (error) => {
      setStatus(`Chart refresh failed: ${error.message}`);
      elements.chartHelp.textContent =
        "Could not fetch chart data for that instrument. It may not be available from justETF.";
      await loadPerformance();
    })
    .finally(() => {
      state.chartRefreshes.delete(product.isin);
    });

  state.chartRefreshes.set(product.isin, refreshPromise);
  await refreshPromise;
}

function parseIsins(rawText) {
  return Array.from(new Set((rawText.match(/[A-Z]{2}[A-Z0-9]{9}[0-9]/gi) || []).map((isin) => isin.toUpperCase())));
}

async function runBusy(button, label, task) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = label;
  setStatus(label);
  try {
    const result = await task();
    setStatus(result.message || "Done");
    await refreshAll();
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function refreshAll() {
  await loadFilters();
  await loadDatabaseTotal();
  await loadProducts();
  await loadSyncRuns();
}

document.querySelector("#applyFiltersButton").addEventListener("click", loadProducts);
document.querySelector("#clearFiltersButton").addEventListener("click", async () => {
  clearFilters();
  await refreshAll();
});
elements.scopeInput.addEventListener("change", refreshAll);
elements.searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadProducts();
});

document.querySelector("#scanNeonButton").addEventListener("click", (event) =>
  runBusy(event.currentTarget, "Scanning neon…", () =>
    api("/api/sync/neon", { method: "POST", body: JSON.stringify(null) }),
  ),
);

document.querySelector("#refreshNeonInstrumentsButton").addEventListener("click", (event) =>
  runBusy(event.currentTarget, "Refreshing neon list…", () =>
    api("/api/sync/neon/instruments", { method: "POST", body: JSON.stringify({}) }),
  ),
);

document.querySelector("#refreshOverviewButton").addEventListener("click", (event) =>
  runBusy(event.currentTarget, "Refreshing overview…", () =>
    api("/api/sync/justetf/overview?strategy=epg-longOnly&enrich=true", { method: "POST" }),
  ),
);

document.querySelector("#refreshProfilesButton").addEventListener("click", (event) =>
  runBusy(event.currentTarget, "Refreshing profiles…", () =>
    api("/api/sync/justetf/profiles", {
      method: "POST",
      body: JSON.stringify({ isins: Array.from(state.selectedIsins) }),
    }),
  ),
);

document.querySelector("#addIsinsButton").addEventListener("click", (event) =>
  runBusy(event.currentTarget, "Adding ISINs…", () =>
    api("/api/neon/products", {
      method: "POST",
      body: JSON.stringify({ isins: parseIsins(elements.manualIsins.value), notes: "Manually added" }),
    }),
  ),
);

document.querySelector("#resetZoomButton").addEventListener("click", () => {
  if (state.chart) state.chart.resetZoom();
});

refreshAll().catch((error) => setStatus(`Error: ${error.message}`));

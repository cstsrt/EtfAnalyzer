const state = {
  products: [],
  selectedIsins: new Set(),
  chart: null,
};

const elements = {
  totalProducts: document.querySelector("#totalProducts"),
  lastSync: document.querySelector("#lastSync"),
  statusMessage: document.querySelector("#statusMessage"),
  searchInput: document.querySelector("#searchInput"),
  scopeInput: document.querySelector("#scopeInput"),
  assetClassInput: document.querySelector("#assetClassInput"),
  regionInput: document.querySelector("#regionInput"),
  currencyInput: document.querySelector("#currencyInput"),
  distributionInput: document.querySelector("#distributionInput"),
  replicationInput: document.querySelector("#replicationInput"),
  maxTerInput: document.querySelector("#maxTerInput"),
  minFundSizeInput: document.querySelector("#minFundSizeInput"),
  maxRiskInput: document.querySelector("#maxRiskInput"),
  sortInput: document.querySelector("#sortInput"),
  productsBody: document.querySelector("#productsBody"),
  manualIsins: document.querySelector("#manualIsins"),
  eventDate: document.querySelector("#eventDate"),
  eventTitle: document.querySelector("#eventTitle"),
  eventCategory: document.querySelector("#eventCategory"),
  eventNotes: document.querySelector("#eventNotes"),
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

function optionList(select, values, placeholder) {
  const currentValue = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>`;
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
  select.value = currentValue;
}

async function loadFilters() {
  const filters = await api(`/api/filters?scope=${elements.scopeInput.value}`);
  optionList(elements.assetClassInput, filters.asset_class || [], "Any asset class");
  optionList(elements.regionInput, filters.region || [], "Any region");
  optionList(elements.currencyInput, filters.currency || [], "Any currency");
  optionList(elements.distributionInput, filters.distribution_policy || [], "Any distribution");
  optionList(elements.replicationInput, filters.replication || [], "Any replication");
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
    ["max_ter", elements.maxTerInput.value],
    ["min_fund_size", elements.minFundSizeInput.value],
    ["max_risk", elements.maxRiskInput.value],
  ];
  mappings.forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

function renderProducts(items, total) {
  state.products = items;
  elements.totalProducts.textContent = `${total} product${total === 1 ? "" : "s"}`;
  elements.productsBody.innerHTML = "";

  if (!items.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="13">No products yet. Add neon ISINs or refresh data — the database goblin is hungry.</td>`;
    elements.productsBody.append(row);
    return;
  }

  items.forEach((product) => {
    const row = document.createElement("tr");
    const checked = state.selectedIsins.has(product.isin) ? "checked" : "";
    row.innerHTML = `
      <td><input type="checkbox" data-isin="${product.isin}" ${checked} /></td>
      <td class="name-cell">${product.name || "Unnamed ETF"}</td>
      <td class="number">${product.isin}</td>
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
    row.querySelector("input").addEventListener("change", (event) => {
      if (event.target.checked) state.selectedIsins.add(product.isin);
      else state.selectedIsins.delete(product.isin);
      loadPerformance();
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
    return;
  }

  const data = await api(`/api/performance?isins=${encodeURIComponent(isins.join(","))}&normalize=true`);
  const labels = Array.from(
    new Set(data.series.flatMap((series) => series.points.map((point) => point.date))),
  ).sort();
  const datasets = data.series.map((series, index) => {
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
  await loadProducts();
  await loadSyncRuns();
}

document.querySelector("#applyFiltersButton").addEventListener("click", loadProducts);
elements.scopeInput.addEventListener("change", refreshAll);
elements.searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadProducts();
});

document.querySelector("#scanNeonButton").addEventListener("click", (event) =>
  runBusy(event.currentTarget, "Scanning neon…", () =>
    api("/api/sync/neon", { method: "POST", body: JSON.stringify(null) }),
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

document.querySelector("#refreshChartsButton").addEventListener("click", (event) =>
  runBusy(event.currentTarget, "Refreshing charts…", () =>
    api("/api/sync/justetf/charts", {
      method: "POST",
      body: JSON.stringify({ isins: Array.from(state.selectedIsins), unclosed: false }),
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

document.querySelector("#addEventButton").addEventListener("click", (event) =>
  runBusy(event.currentTarget, "Saving event…", async () => {
    await api("/api/events", {
      method: "POST",
      body: JSON.stringify({
        event_date: elements.eventDate.value,
        title: elements.eventTitle.value,
        category: elements.eventCategory.value,
        notes: elements.eventNotes.value,
      }),
    });
    elements.eventTitle.value = "";
    elements.eventCategory.value = "";
    elements.eventNotes.value = "";
    return { message: "Event saved" };
  }),
);

document.querySelector("#resetZoomButton").addEventListener("click", () => {
  if (state.chart) state.chart.resetZoom();
});

elements.eventDate.valueAsDate = new Date();
refreshAll().catch((error) => setStatus(`Error: ${error.message}`));

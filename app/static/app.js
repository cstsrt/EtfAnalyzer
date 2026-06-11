const state = {
  products: [],
  currentTotal: 0,
  selectedIsins: new Set(),
  chartRefreshes: new Map(),
  sort: { column: "name", direction: "asc" },
  tableFilters: {},
  filterOptions: {},
  columnOrder: [],
  hiddenColumns: new Set(),
  chart: null,
};

const COLUMN_CONFIG_KEY = "neonEtfAnalyzer.columnConfig.v1";

const DEFAULT_COLUMNS = [
  { id: "compare", label: "Compare", lockVisible: true },
  { id: "instrument_type", label: "Type", sortable: true, sortKey: "instrument_type", filterType: "select", filterParam: "instrument_type" },
  { id: "name", label: "Name", sortable: true, sortKey: "name", filterType: "text", filterParam: "name_filter" },
  { id: "isin", label: "ISIN", sortable: true, sortKey: "isin", filterType: "text", filterParam: "isin_filter" },
  { id: "zero_fee", label: "0% fee", sortable: true, sortKey: "zero_fee", filterType: "select", filterParam: "zero_fee" },
  { id: "ter", label: "TER", sortable: true, sortKey: "ter", filterType: "number", filterParam: "max_ter", filterPlaceholder: "≤ %" },
  { id: "fund_size_mn", label: "Fund size", sortable: true, sortKey: "fund_size_mn", filterType: "number", filterParam: "min_fund_size", filterPlaceholder: "≥ mn" },
  { id: "currency", label: "Currency", sortable: true, sortKey: "currency", filterType: "select", filterParam: "currency" },
  { id: "region", label: "Region", sortable: true, sortKey: "region", filterType: "select", filterParam: "region" },
  { id: "distribution_policy", label: "Distribution", sortable: true, sortKey: "distribution_policy", filterType: "select", filterParam: "distribution_policy" },
  { id: "replication", label: "Replication", sortable: true, sortKey: "replication", filterType: "select", filterParam: "replication" },
  { id: "return_1y", label: "1Y", sortable: true, sortKey: "return_1y", filterType: "number", filterParam: "min_return_1y", filterPlaceholder: "≥ %" },
  { id: "return_3y", label: "3Y", sortable: true, sortKey: "return_3y", filterType: "number", filterParam: "min_return_3y", filterPlaceholder: "≥ %" },
  { id: "return_5y", label: "5Y", sortable: true, sortKey: "return_5y", filterType: "number", filterParam: "min_return_5y", filterPlaceholder: "≥ %" },
  { id: "max_drawdown", label: "Max drawdown", sortable: true, sortKey: "max_drawdown" },
];

const COLUMN_BY_ID = Object.fromEntries(DEFAULT_COLUMNS.map((column) => [column.id, column]));

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
  productsHead: document.querySelector("#productsHead"),
  productsBody: document.querySelector("#productsBody"),
  columnControls: document.querySelector("#columnControls"),
  resetColumnsButton: document.querySelector("#resetColumnsButton"),
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

function loadColumnConfig() {
  const defaultOrder = DEFAULT_COLUMNS.map((column) => column.id);
  state.columnOrder = defaultOrder;
  state.hiddenColumns = new Set();
  try {
    const savedConfig = JSON.parse(localStorage.getItem(COLUMN_CONFIG_KEY) || "{}");
    const savedOrder = Array.isArray(savedConfig.order) ? savedConfig.order.filter((id) => COLUMN_BY_ID[id]) : [];
    const missingIds = defaultOrder.filter((id) => !savedOrder.includes(id));
    state.columnOrder = [...savedOrder, ...missingIds];
    state.hiddenColumns = new Set(
      (Array.isArray(savedConfig.hidden) ? savedConfig.hidden : []).filter(
        (id) => COLUMN_BY_ID[id] && !COLUMN_BY_ID[id].lockVisible,
      ),
    );
  } catch {
    state.columnOrder = defaultOrder;
    state.hiddenColumns = new Set();
  }
}

function saveColumnConfig() {
  localStorage.setItem(
    COLUMN_CONFIG_KEY,
    JSON.stringify({
      order: state.columnOrder,
      hidden: Array.from(state.hiddenColumns),
    }),
  );
}

function resetColumnConfig() {
  localStorage.removeItem(COLUMN_CONFIG_KEY);
  loadColumnConfig();
  renderColumnControls();
  renderProducts(state.products, state.currentTotal);
}

function getOrderedColumns() {
  return state.columnOrder.map((id) => COLUMN_BY_ID[id]).filter(Boolean);
}

function getVisibleColumns() {
  return getOrderedColumns().filter((column) => !state.hiddenColumns.has(column.id) || column.lockVisible);
}

function filterOptionsForColumn(column) {
  const options = {
    instrument_type: state.filterOptions.instrument_type || [],
    zero_fee: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
    currency: state.filterOptions.currency || [],
    region: state.filterOptions.region || [],
    distribution_policy: state.filterOptions.distribution_policy || [],
    replication: state.filterOptions.replication || [],
  };
  return options[column.id] || [];
}

function tableFilterValue(column) {
  return state.tableFilters[column.filterParam] || "";
}

function setTableFilter(column, value) {
  if (!column.filterParam) return;
  if (value) state.tableFilters[column.filterParam] = value;
  else delete state.tableFilters[column.filterParam];
}

function renderColumnControls() {
  elements.columnControls.innerHTML = "";
  getOrderedColumns().forEach((column, index) => {
    const item = document.createElement("div");
    item.className = "column-control-item";
    item.innerHTML = `
      <label class="column-toggle">
        <input type="checkbox" data-column="${column.id}" ${state.hiddenColumns.has(column.id) ? "" : "checked"} ${column.lockVisible ? "disabled" : ""} />
        <span>${column.label}</span>
      </label>
      <div class="column-move-actions">
        <button class="secondary" data-action="left" ${index === 0 ? "disabled" : ""}>←</button>
        <button class="secondary" data-action="right" ${index === state.columnOrder.length - 1 ? "disabled" : ""}>→</button>
      </div>
    `;
    item.querySelector("input").addEventListener("change", (event) => {
      if (event.target.checked) state.hiddenColumns.delete(column.id);
      else state.hiddenColumns.add(column.id);
      saveColumnConfig();
      renderColumnControls();
      renderProductHeader();
      renderProducts(state.products, state.currentTotal);
    });
    item.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        const currentIndex = state.columnOrder.indexOf(column.id);
        const direction = button.dataset.action === "left" ? -1 : 1;
        const nextIndex = currentIndex + direction;
        if (nextIndex < 0 || nextIndex >= state.columnOrder.length) return;
        [state.columnOrder[currentIndex], state.columnOrder[nextIndex]] = [
          state.columnOrder[nextIndex],
          state.columnOrder[currentIndex],
        ];
        saveColumnConfig();
        renderColumnControls();
        renderProductHeader();
        renderProducts(state.products, state.currentTotal);
      });
    });
    elements.columnControls.append(item);
  });
}

function renderProductHeader() {
  const headerRow = document.createElement("tr");
  const filterRow = document.createElement("tr");
  filterRow.className = "table-filter-row";

  getVisibleColumns().forEach((column) => {
    const headerCell = document.createElement("th");
    const headerButton = document.createElement("button");
    headerButton.type = "button";
    headerButton.className = `table-header-button${column.sortable ? " sortable" : ""}`;
    headerButton.dataset.column = column.id;
    if (column.sortable) headerButton.dataset.sort = column.sortKey;
    headerButton.textContent = column.label;
    if (column.sortable && state.sort.column === column.sortKey) {
      headerButton.dataset.direction = state.sort.direction;
      headerButton.setAttribute("aria-sort", state.sort.direction === "asc" ? "ascending" : "descending");
      headerButton.textContent = `${column.label} ${state.sort.direction === "asc" ? "↑" : "↓"}`;
    }
    if (column.sortable) {
      headerButton.addEventListener("click", async () => {
        if (state.sort.column === column.sortKey) {
          state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
        } else {
          state.sort.column = column.sortKey;
          state.sort.direction = "asc";
        }
        if ([...elements.sortInput.options].some((option) => option.value === state.sort.column)) {
          elements.sortInput.value = state.sort.column;
        }
        renderProductHeader();
        await loadProducts();
      });
    } else {
      headerButton.disabled = true;
    }
    headerCell.append(headerButton);
    headerRow.append(headerCell);

    const filterCell = document.createElement("th");
    filterCell.append(renderColumnFilter(column));
    filterRow.append(filterCell);
  });

  elements.productsHead.innerHTML = "";
  elements.productsHead.append(headerRow, filterRow);
}

function renderColumnFilter(column) {
  if (!column.filterType) {
    const spacer = document.createElement("span");
    spacer.className = "table-filter-spacer";
    return spacer;
  }

  const value = tableFilterValue(column);
  if (column.filterType === "select") {
    const select = document.createElement("select");
    select.className = "table-filter-control";
    select.innerHTML = '<option value="">All</option>';
    filterOptionsForColumn(column).forEach((optionValue) => {
      const option = document.createElement("option");
      option.value = typeof optionValue === "object" ? optionValue.value : optionValue;
      option.textContent =
        typeof optionValue === "object"
          ? optionValue.label
          : column.id === "instrument_type"
            ? formatInstrumentType(optionValue)
            : optionValue;
      select.append(option);
    });
    select.value = value;
    select.addEventListener("change", async () => {
      setTableFilter(column, select.value);
      syncTopFilterFromTable(column, select.value);
      await loadProducts();
    });
    return select;
  }

  const input = document.createElement("input");
  input.className = "table-filter-control";
  input.type = column.filterType;
  if (column.filterType === "number") input.step = "0.01";
  input.placeholder = column.filterPlaceholder || "Filter";
  input.value = value;
  input.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      setTableFilter(column, input.value.trim());
      syncTopFilterFromTable(column, input.value.trim());
      await loadProducts();
    }
  });
  input.addEventListener("change", async () => {
    setTableFilter(column, input.value.trim());
    syncTopFilterFromTable(column, input.value.trim());
    await loadProducts();
  });
  return input;
}

function syncTopFilterFromTable(column, value) {
  const mapping = {
    instrument_type: elements.instrumentTypeInput,
    zero_fee: elements.zeroFeeInput,
    currency: elements.currencyInput,
    region: elements.regionInput,
    distribution_policy: elements.distributionInput,
    replication: elements.replicationInput,
    max_ter: elements.maxTerInput,
    min_fund_size: elements.minFundSizeInput,
    min_return_1y: null,
    min_return_3y: null,
    min_return_5y: null,
  };
  const input = mapping[column.filterParam];
  if (input) input.value = value;
}

async function loadFilters() {
  const filters = await api(`/api/filters?scope=${elements.scopeInput.value}`);
  state.filterOptions = filters;
  optionList(elements.assetClassInput, filters.asset_class || [], "Any asset class");
  optionList(elements.regionInput, filters.region || [], "Any region", "Refresh justETF overview first");
  optionList(elements.currencyInput, filters.currency || [], "Any currency", "Refresh justETF overview first");
  optionList(elements.distributionInput, filters.distribution_policy || [], "Any distribution");
  optionList(elements.replicationInput, filters.replication || [], "Any replication", "Refresh justETF overview first");
  optionList(elements.instrumentTypeInput, filters.instrument_type || [], "Any neon type", "No neon types found", formatInstrumentType);
  renderProductHeader();
}

function buildProductQuery() {
  const params = new URLSearchParams({
    scope: elements.scopeInput.value,
    limit: "500",
    sort: state.sort.column || elements.sortInput.value || "name",
    direction: state.sort.direction || "asc",
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
  Object.entries(state.tableFilters).forEach(([key, value]) => {
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
  state.sort = { column: "name", direction: "asc" };
  state.tableFilters = {};
  elements.maxTerInput.value = "";
  elements.minFundSizeInput.value = "";
  elements.maxRiskInput.value = "";
}

function renderProducts(items, total) {
  state.products = items;
  state.currentTotal = total;
  elements.shownProducts.textContent = `Showing ${total} product${total === 1 ? "" : "s"}`;
  renderProductHeader();
  elements.productsBody.innerHTML = "";

  if (!items.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="${getVisibleColumns().length}">No products match the current filters.</td>`;
    elements.productsBody.append(row);
    return;
  }

  items.forEach((product) => {
    const row = document.createElement("tr");
    getVisibleColumns().forEach((column) => {
      const cell = document.createElement("td");
      renderProductCell(cell, column, product);
      row.append(cell);
    });
    elements.productsBody.append(row);
  });
}

function renderProductCell(cell, column, product) {
  if (["isin", "ter", "fund_size_mn", "return_1y", "return_3y", "return_5y", "max_drawdown"].includes(column.id)) {
    cell.classList.add("number");
  }
  if (["return_1y", "return_3y", "return_5y", "max_drawdown"].includes(column.id)) {
    const returnTrend = trendClass(product[column.id]);
    if (returnTrend) cell.classList.add(returnTrend);
  }

  if (column.id === "compare") {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.isin = product.isin;
    checkbox.checked = state.selectedIsins.has(product.isin);
    checkbox.addEventListener("change", async (event) => {
      if (event.target.checked) {
        state.selectedIsins.add(product.isin);
        await refreshChartDataForProduct(product);
      } else {
        state.selectedIsins.delete(product.isin);
        await loadPerformance();
      }
    });
    cell.append(checkbox);
    return;
  }

  const renderers = {
    instrument_type: () => formatInstrumentType(product.instrument_type),
    name: () => product.full_name || product.name || product.neon_name || "Unnamed instrument",
    isin: () => product.isin,
    zero_fee: () => (product.zero_fee === null || product.zero_fee === undefined ? "—" : product.zero_fee ? "✅" : "no"),
    ter: () => formatPercent(product.ter),
    fund_size_mn: () => formatNumber(product.fund_size_mn, " mn"),
    currency: () => product.currency || "—",
    region: () => product.region || "—",
    distribution_policy: () => product.distribution_policy || "—",
    replication: () => product.replication || "—",
    return_1y: () => formatPercent(product.return_1y),
    return_3y: () => formatPercent(product.return_3y),
    return_5y: () => formatPercent(product.return_5y),
    max_drawdown: () => formatPercent(product.max_drawdown),
  };

  cell.textContent = renderers[column.id] ? renderers[column.id]() : product[column.id] || "—";
  if (column.id === "name") cell.classList.add("name-cell");
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
  renderProductHeader();
  await refreshAll();
});
elements.sortInput.addEventListener("change", async () => {
  state.sort = { column: elements.sortInput.value || "name", direction: "asc" };
  renderProductHeader();
  await loadProducts();
});
elements.resetColumnsButton.addEventListener("click", resetColumnConfig);
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

loadColumnConfig();
renderColumnControls();
refreshAll().catch((error) => setStatus(`Error: ${error.message}`));

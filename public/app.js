let sessionUser = null;
function resolveViewMode() {
  if (window.__FORCED_VIEW === "mobile" || window.__FORCED_VIEW === "desktop") return window.__FORCED_VIEW;
  const path = window.location.pathname.toLowerCase();
  if (path.includes("/mobile")) return "mobile";
  if (path.includes("/desktop")) return "desktop";
  return window.matchMedia("(max-width: 759px)").matches ? "mobile" : "desktop";
}

function applyViewMode() {
  document.body.dataset.view = resolveViewMode();
}

applyViewMode();

const views = {
  store: document.querySelector("#storeView"),
  login: document.querySelector("#loginView"),
  register: document.querySelector("#registerView"),
  cart: document.querySelector("#cartView"),
  admin: document.querySelector("#adminView")
};

const productGrid = document.querySelector("#productGrid");
const priceNote = document.querySelector("#priceNote");
const storeSearch = document.querySelector("#storeSearch");
const storeCategory = document.querySelector("#storeCategory");
const categoryTiles = document.querySelector("#categoryTiles");
const appStatus = document.querySelector("#appStatus");
const appStatusText = document.querySelector("#appStatusText");
const minimumStatusMs = 140;
let productsRequest = null;
let adminRequest = null;
let viewModeRaf = 0;
const productCategories = [
  "Electronics",
  "Scooters & Mobility",
  "Tools & Hardware",
  "Home & Office",
  "Furniture",
  "Appliances",
  "Automotive",
  "Warehouse & Storage",
  "Safety",
  "Janitorial",
  "Clothing & Accessories",
  "Toys & Games",
  "Other"
];
let statusDepth = 0;
let productCache = [];
let cart = JSON.parse(localStorage.getItem("dealerCart") || "[]");
let productRotatorTimer = null;
let exitAlertShown = localStorage.getItem("exitAlertDismissed") === "true";
let selectedAdminProductId = null;
let adminProductSearch = "";
let adminProductMobileDetailOpen = false;
let adminProductsCache = [];
let bulkProductSearch = "";
let bulkNewRowSequence = 1;

function showStatus(message = "Working...") {
  statusDepth += 1;
  appStatusText.textContent = message;
  appStatus.classList.remove("hidden");
  document.body.classList.add("is-busy");
}

function hideStatus() {
  statusDepth = Math.max(0, statusDepth - 1);
  if (statusDepth === 0) {
    appStatus.classList.add("hidden");
    document.body.classList.remove("is-busy");
  }
}

async function withStatus(message, task) {
  const startedAt = Date.now();
  showStatus(message);
  try {
    return await task();
  } finally {
    const remaining = minimumStatusMs - (Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
    hideStatus();
  }
}

function setButtonBusy(button, busyText) {
  const original = button.textContent;
  button.disabled = true;
  button.classList.add("button-busy");
  button.dataset.originalText = original;
  button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${escapeHtml(busyText)}</span>`;
  return () => {
    button.disabled = false;
    button.classList.remove("button-busy");
    button.textContent = button.dataset.originalText || original;
    delete button.dataset.originalText;
  };
}

function loadingCards(count = 3) {
  return Array.from({ length: count }).map(() => `
    <article class="product-card skeleton-card" aria-hidden="true">
      <div class="skeleton skeleton-image"></div>
      <div class="product-body">
        <div class="skeleton skeleton-line wide"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
      </div>
    </article>
  `).join("");
}

function loadingRows(count = 3) {
  return Array.from({ length: count }).map(() => `
    <div class="row skeleton-row" aria-hidden="true">
      <div>
        <div class="skeleton skeleton-line wide"></div>
        <div class="skeleton skeleton-line"></div>
      </div>
    </div>
  `).join("");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...options
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : { error: await response.text().catch(() => "") };
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}` || "Request failed.");
  return data;
}

function setRoute(route) {
  Object.entries(views).forEach(([name, element]) => element.classList.toggle("hidden", name !== route));
  if (route === "store") loadProducts();
  if (route === "cart") {
    if (cart.length && !productCache.length) loadProducts().then(renderCart);
    else renderCart();
  }
  if (route === "admin") loadAdmin();
}

function routeFromHash() {
  const route = window.location.hash.replace("#", "");
  return views[route] ? route : "store";
}

function updateNav() {
  const signedIn = Boolean(sessionUser);
  document.querySelectorAll(".signed-in").forEach((item) => item.classList.toggle("hidden", !signedIn));
  document.querySelectorAll(".signed-out").forEach((item) => item.classList.toggle("hidden", signedIn));
  document.querySelectorAll(".admin-only").forEach((item) => item.classList.toggle("hidden", sessionUser?.role !== "admin"));
  updateCartCount();
}

function productImage(product, rotateImages = false) {
  const imageUrls = [...new Set([...(product.imageUrls || []), product.imageUrl].filter(Boolean))];
  const imageUrl = imageUrls[0];
  if (rotateImages && imageUrls.length > 1) {
    return `
      <div class="product-image product-image-rotator" data-image-rotator>
        ${imageUrls.map((url, index) => `<img class="${index === 0 ? "active" : ""}" src="${escapeHtml(url)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async">`).join("")}
      </div>
    `;
  }
  if (imageUrl) {
    return `<div class="product-image"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async"></div>`;
  }
  return `<div class="product-image">${escapeHtml(product.brand || product.category || "Dealer")}</div>`;
}

function stopProductRotator() {
  if (productRotatorTimer) {
    window.clearInterval(productRotatorTimer);
    productRotatorTimer = null;
  }
}

function startProductRotator() {
  stopProductRotator();
  const rotators = [...document.querySelectorAll("[data-image-rotator]")];
  if (!rotators.length) return;
  productRotatorTimer = window.setInterval(() => {
    rotators.forEach((rotator) => {
      const images = [...rotator.querySelectorAll("img")];
      if (images.length < 2) return;
      const activeIndex = Math.max(0, images.findIndex((image) => image.classList.contains("active")));
      images[activeIndex]?.classList.remove("active");
      images[(activeIndex + 1) % images.length]?.classList.add("active");
    });
  }, 2600);
}

function recommendedAddonsBlock(product) {
  if (!product.recommendedAddons?.length) {
    return "";
  }
  return `
    <div class="recommended-addons">
      <div class="recommended-title">Recommended add-ons</div>
      <div class="addon-list">
        ${product.recommendedAddons.map((addon) => `
          <div class="addon-pill">
            <span>${escapeHtml(addon.name)}</span>
            ${addon.brand ? `<small>${escapeHtml(addon.brand)}</small>` : ""}
            ${addon.price ? `<strong>${escapeHtml(addon.price)}</strong>` : ""}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function adminProductMatchesSearch(product, search) {
  const text = [
    product.name,
    product.brand,
    product.sku,
    product.upc,
    product.category,
    product.description
  ].filter(Boolean).join(" ").toLowerCase();
  return !search || text.includes(search);
}

function addonChoicesMarkup(product, products) {
  return products
    .filter((item) => item.id !== product.id)
    .map((item) => `
      <label class="addon-choice">
        <input type="checkbox" name="recommendedAddonIds" value="${item.id}" ${(product.recommendedAddonIds || []).includes(item.id) ? "checked" : ""}>
        <span>${escapeHtml(item.name)}</span>
      </label>
    `).join("");
}

function adminProductListItem(product, isSelected = false) {
  return `
    <button type="button" class="admin-product-list-item ${isSelected ? "selected" : ""}" data-select-product="${product.id}">
      <strong>${escapeHtml(product.name)}</strong>
      <span>${escapeHtml(product.category || "No category")}${product.brand ? ` | ${escapeHtml(product.brand)}` : ""}</span>
      <span>${product.price || "$0.00"} | Qty ${escapeHtml(product.quantityOnHand ?? 0)} | ${product.active ? "Live" : "Hidden"}</span>
    </button>
  `;
}

function moneyInputValue(cents) {
  return cents == null ? "" : (Number(cents) / 100).toFixed(2);
}

function productUpdateSnapshot(product) {
  return {
    name: String(product.name || "").trim(),
    brand: String(product.brand || "").trim(),
    sku: String(product.sku || "").trim(),
    upc: String(product.upc || "").trim(),
    category: String(product.category || "").trim(),
    price: moneyInputValue(product.priceCents),
    dealerPrice: moneyInputValue(product.dealerPriceCents),
    quantityOnHand: String(Math.max(0, Math.floor(Number(product.quantityOnHand || 0)))),
    condition: String(product.productSpecs?.condition || "").trim(),
    listingStatus: String(product.productSpecs?.listingStatus || "draft").trim(),
    marketplaceStatus: String(product.productSpecs?.marketplaceStatus || "not_listed").trim(),
    active: product.active ? "true" : "false"
  };
}

function bulkEditorRow(product) {
  const state = productUpdateSnapshot(product);
  return `
    <tr data-bulk-product-row="${product.id}">
      <td><input name="name" value="${escapeHtml(state.name)}" data-original="${escapeHtml(state.name)}"></td>
      <td><input name="brand" value="${escapeHtml(state.brand)}" data-original="${escapeHtml(state.brand)}"></td>
      <td><input name="sku" value="${escapeHtml(state.sku)}" data-original="${escapeHtml(state.sku)}"></td>
      <td><input name="upc" value="${escapeHtml(state.upc)}" data-original="${escapeHtml(state.upc)}" inputmode="numeric"></td>
      <td><select name="category" data-original="${escapeHtml(state.category)}">${categorySelect(product.category)}</select></td>
      <td><select name="condition" data-original="${escapeHtml(state.condition)}">${conditionSelect(product)}</select></td>
      <td><input name="quantityOnHand" type="number" min="0" step="1" value="${escapeHtml(state.quantityOnHand)}" data-original="${escapeHtml(state.quantityOnHand)}"></td>
      <td><input name="price" type="number" min="0" step="0.01" value="${escapeHtml(state.price)}" data-original="${escapeHtml(state.price)}"></td>
      <td><input name="dealerPrice" type="number" min="0" step="0.01" value="${escapeHtml(state.dealerPrice)}" data-original="${escapeHtml(state.dealerPrice)}"></td>
      <td><select name="listingStatus" data-original="${escapeHtml(state.listingStatus)}">${["draft", "ready_to_list", "listed_on_site", "sold", "picked_up", "archived", "removed"].map((status) => `<option value="${status}" ${state.listingStatus === status ? "selected" : ""}>${status.replaceAll("_", " ")}</option>`).join("")}</select></td>
      <td><select name="marketplaceStatus" data-original="${escapeHtml(state.marketplaceStatus)}">${["not_listed", "ready_for_facebook", "listed_on_facebook", "offer_pending", "sold_on_facebook"].map((status) => `<option value="${status}" ${state.marketplaceStatus === status ? "selected" : ""}>${status.replaceAll("_", " ")}</option>`).join("")}</select></td>
      <td><select name="active" data-original="${escapeHtml(state.active)}">
        <option value="true" ${product.active ? "selected" : ""}>Active</option>
        <option value="false" ${product.active ? "" : "selected"}>Hidden</option>
      </select></td>
    </tr>
  `;
}

function bulkNewRow(rowId = `new-${bulkNewRowSequence++}`) {
  return `
    <tr data-bulk-product-row="${rowId}" class="bulk-new-row">
      <td><input name="name" placeholder="New product title"></td>
      <td><input name="brand" placeholder="Brand"></td>
      <td><input name="sku" placeholder="SKU"></td>
      <td><input name="upc" placeholder="UPC" inputmode="numeric"></td>
      <td><select name="category">${categorySelect("")}</select></td>
      <td><select name="condition"><option value="">Condition</option><option value="Brand New In Box (BNIB)">Brand New In Box (BNIB)</option><option value="Open Box / Refurbished (OP/R)">Open Box / Refurbished (OP/R)</option><option value="Used (U)">Used (U)</option></select></td>
      <td><input name="quantityOnHand" type="number" min="0" step="1" value="0"></td>
      <td><input name="price" type="number" min="0" step="0.01" placeholder="0.00"></td>
      <td><input name="dealerPrice" type="number" min="0" step="0.01" placeholder="Optional"></td>
      <td><select name="listingStatus"><option value="draft">draft</option><option value="listed_on_site">listed on site</option><option value="sold">sold</option></select></td>
      <td><select name="marketplaceStatus"><option value="not_listed">not listed</option><option value="ready_for_facebook">ready for facebook</option><option value="listed_on_facebook">listed on facebook</option></select></td>
      <td><select name="active"><option value="true" selected>Active</option><option value="false">Hidden</option></select></td>
    </tr>
  `;
}

function renderBulkProductEditor(products) {
  const host = document.querySelector("#bulkProductGrid");
  if (!host) return;
  const search = bulkProductSearch.trim().toLowerCase();
  const filteredProducts = products.filter((product) => adminProductMatchesSearch(product, search));
  if (!filteredProducts.length) {
    host.innerHTML = "<p>No matching products for bulk edit.</p>";
    return;
  }
  host.innerHTML = `
    <div class="bulk-product-table-wrap">
      <table class="bulk-product-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Brand</th>
            <th>SKU</th>
            <th>UPC</th>
            <th>Category</th>
            <th>Condition</th>
            <th>Qty</th>
            <th>Public</th>
            <th>Dealer</th>
            <th>Listing</th>
            <th>Facebook</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${bulkNewRow()}
          ${filteredProducts.map((product) => bulkEditorRow(product)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function bulkRowValues(row) {
  const read = (name) => String(row.querySelector(`[name="${name}"]`)?.value || "").trim();
  return {
    name: read("name"),
    brand: read("brand"),
    sku: read("sku"),
    upc: read("upc"),
    category: read("category"),
    condition: read("condition"),
    quantityOnHand: read("quantityOnHand"),
    price: read("price"),
    dealerPrice: read("dealerPrice"),
    listingStatus: read("listingStatus"),
    marketplaceStatus: read("marketplaceStatus"),
    active: read("active")
  };
}

function bulkNewRowReady(row) {
  const values = bulkRowValues(row);
  return Boolean(values.name && values.category && values.price);
}

function appendBulkNewRow() {
  const tbody = document.querySelector("#bulkProductGrid tbody");
  if (!tbody) return;
  tbody.insertAdjacentHTML("beforeend", bulkNewRow());
  tbody.lastElementChild?.querySelector("input, select")?.focus();
}

function rowHasBulkChanges(row, product) {
  const current = bulkRowValues(row);
  const original = productUpdateSnapshot(product);
  return Object.keys(original).some((key) => String(current[key] || "") !== String(original[key] || ""));
}

function buildProductUpdateFormData(product, overrides = {}) {
  const data = new FormData();
  const specs = product.productSpecs || {};
  const values = {
    name: product.name || "",
    sku: product.sku || "",
    upc: product.upc || "",
    brand: product.brand || "",
    category: product.category || "",
    description: product.description || "",
    price: moneyInputValue(product.priceCents),
    dealerPrice: moneyInputValue(product.dealerPriceCents),
    sourceUrl: product.sourceUrl || "",
    quantityOnHand: String(Math.max(0, Math.floor(Number(product.quantityOnHand || 0)))),
    length: specs.length || "",
    width: specs.width || "",
    height: specs.height || "",
    dimensionUnit: specs.dimensionUnit || "in",
    weight: specs.weight || "",
    weightUnit: specs.weightUnit || "lb",
    color: specs.color || "",
    material: specs.material || "",
    model: specs.model || "",
    condition: specs.condition || "",
    fulfillmentType: specs.fulfillmentType || "pickup_only",
    cost: specs.cost || "",
    sourceNotes: specs.sourceNotes || "",
    listingStatus: specs.listingStatus || "draft",
    marketplaceStatus: specs.marketplaceStatus || "not_listed",
    active: product.active ? "true" : "false",
    recommendedAddonIds: (product.recommendedAddonIds || []).join(",")
  };
  Object.entries({ ...values, ...overrides }).forEach(([key, value]) => {
    data.append(key, value == null ? "" : String(value));
  });
  return data;
}

function adminProductDetailMarkup(product, _products) {
  return `
    <div class="admin-product-detail-card">
      <div class="admin-product-detail-head">
        <button type="button" class="nav-button admin-product-back" data-back-products>Back to list</button>
        <div>
          <h3>${escapeHtml(product.name)}</h3>
          <p>${product.price || "$0.00"} | Qty ${escapeHtml(product.quantityOnHand ?? 0)} | ${escapeHtml(product.category || "No category")} | ${product.active ? "Live" : "Hidden"}</p>
        </div>
      </div>
      <form class="product-edit-form simple-product-form" data-product-edit="${product.id}">
        <div class="simple-field-grid">
          <label>Title<input name="name" value="${escapeHtml(product.name)}" required autocomplete="off"></label>
          <label>Price<input name="price" type="number" min="0" step="0.01" value="${escapeHtml(((product.priceCents || 0) / 100).toFixed(2))}" required></label>
          <label>Category<select name="category" required>${categorySelect(product.category)}</select></label>
          <label>Condition<select name="condition">${conditionSelect(product)}</select></label>
          <label>Quantity<input name="quantityOnHand" type="number" min="0" step="1" value="${escapeHtml(product.quantityOnHand ?? 0)}"></label>
          <label>Fulfillment<select name="fulfillmentType">
            <option value="pickup_only" ${product.productSpecs?.fulfillmentType === "ships_or_pickup" ? "" : "selected"}>Pickup only</option>
            <option value="ships_or_pickup" ${product.productSpecs?.fulfillmentType === "ships_or_pickup" ? "selected" : ""}>Can be shipped or picked up</option>
          </select></label>
          <label>Brand<input name="brand" value="${escapeHtml(product.brand)}" autocomplete="organization"></label>
          <label>SKU<input name="sku" value="${escapeHtml(product.sku)}"></label>
          <label>UPC<input name="upc" value="${escapeHtml(product.upc)}" inputmode="numeric"></label>
          <label>Status<select name="active">
            <option value="true" ${product.active ? "selected" : ""}>Live</option>
            <option value="false" ${product.active ? "" : "selected"}>Hidden</option>
          </select></label>
        </div>
        <label class="wide-field">Description<textarea name="description" rows="4">${escapeHtml(product.description)}</textarea></label>
        <label class="dropzone wide-field" data-image-dropzone>
          <span>Replace photos</span>
          <input name="images" type="file" accept="image/*" multiple>
          <strong>Drop replacement photos here or click to choose</strong>
          <small data-image-hint>Leave empty to keep current photos.</small>
        </label>
        ${product.imageUrls?.length ? `<div class="admin-editor-image-preview wide-field"><strong>Current photos</strong><div class="admin-image-strip">${product.imageUrls.map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="${escapeHtml(product.name)} image"></a>`).join("")}</div></div>` : ""}
        <div class="row-actions wide-field simple-product-actions">
          <button class="primary" type="submit">Save changes</button>
          ${product.active || product.productSpecs?.listingStatus !== "archived"
            ? `<button type="button" data-archive-product="${product.id}">Archive</button>`
            : `<button type="button" data-restore-product="${product.id}">Restore</button>`}
          <button type="button" class="danger" data-delete-product="${product.id}">Delete</button>
        </div>
        <p class="form-message wide-field"></p>
      </form>
    </div>
  `;
}

function renderAdminProducts(products) {
  const search = adminProductSearch.trim().toLowerCase();
  const filteredProducts = products.filter((product) => adminProductMatchesSearch(product, search));
  const host = document.querySelector("#adminProducts");
  if (!host) return;
  if (!filteredProducts.length) {
    host.innerHTML = `
      <div class="admin-product-workspace">
        <section class="panel admin-product-list-panel">
          <div class="admin-product-list-head">
            <div>
              <p class="eyebrow">Product list</p>
              <h3>Products</h3>
            </div>
            <span>${products.length} total</span>
          </div>
          <label class="admin-product-search">Search products<input id="adminProductSearch" type="search" value="${escapeHtml(adminProductSearch)}" placeholder="Search by title, SKU, UPC, brand"></label>
          <p>No matching products.</p>
        </section>
      </div>
    `;
    return;
  }
  if (!filteredProducts.some((product) => product.id === selectedAdminProductId)) {
    selectedAdminProductId = filteredProducts[0].id;
  }
  const selectedProduct = filteredProducts.find((product) => product.id === selectedAdminProductId) || filteredProducts[0];
  host.innerHTML = `
    <div class="admin-product-workspace ${adminProductMobileDetailOpen ? "detail-open" : ""}">
      <section class="panel admin-product-list-panel">
        <div class="admin-product-list-head">
          <div>
            <p class="eyebrow">Product list</p>
            <h3>Products</h3>
          </div>
          <span>${filteredProducts.length} shown</span>
        </div>
        <label class="admin-product-search">Search products<input id="adminProductSearch" type="search" value="${escapeHtml(adminProductSearch)}" placeholder="Search by title, SKU, UPC, brand"></label>
        <div class="admin-product-list">
          ${filteredProducts.map((product) => adminProductListItem(product, product.id === selectedProduct.id)).join("")}
        </div>
      </section>
      <section class="panel admin-product-detail-panel">
        ${adminProductDetailMarkup(selectedProduct, products)}
      </section>
    </div>
  `;
  initializeAdminSteppers(host);
}

function stepperOrder(stepper) {
  if (!stepper) return [];
  return (stepper.dataset.stepOrder || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function setAdminStep(stepper, step) {
  if (!stepper) return;
  const form = stepper.closest("form") || stepper.closest(".panel") || document;
  const order = stepperOrder(stepper);
  const buttons = [...stepper.querySelectorAll("[data-admin-step]")];
  const fallbackStep = stepper.dataset.defaultStep || order[0] || buttons[0]?.dataset.adminStep || "";
  const targetStep = order.includes(step) ? step : fallbackStep;
  if (!targetStep) {
    stepper.dataset.currentStep = "";
    buttons.forEach((button) => {
      button.classList.remove("active");
      button.setAttribute("aria-pressed", "false");
    });
    form.querySelectorAll("[data-step-panel]").forEach((panel) => panel.classList.remove("active"));
    const backButton = form.querySelector("[data-admin-step-nav='-1']");
    const nextButton = form.querySelector("[data-admin-step-nav='1']");
    if (backButton) backButton.disabled = true;
    if (nextButton) nextButton.disabled = false;
    return;
  }
  stepper.dataset.currentStep = targetStep;
  buttons.forEach((button) => {
    const active = button.dataset.adminStep === targetStep;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  form.querySelectorAll("[data-step-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.stepPanel === targetStep);
  });
  const backButton = form.querySelector("[data-admin-step-nav='-1']");
  const nextButton = form.querySelector("[data-admin-step-nav='1']");
  const index = order.indexOf(targetStep);
  if (backButton) backButton.disabled = index <= 0;
  if (nextButton) nextButton.disabled = index === -1 || index >= order.length - 1;
}

function initializeAdminSteppers(root = document) {
  root.querySelectorAll(".admin-stepper").forEach((stepper) => {
    const current = stepper.dataset.currentStep || stepper.dataset.defaultStep || "";
    setAdminStep(stepper, current);
  });
}

function shoppingLinksBlock(product) {
  if (!product.searchLinks?.length) {
    return "";
  }
  return `
    <div class="shopping-links" aria-label="Compare on other sites">
      ${product.searchLinks.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.site)}</a>`).join("")}
    </div>
  `;
}

function dealerPriceBlock(product) {
  return product.dealerPrice
    ? `<div class="dealer-price">Dealer price ${escapeHtml(product.dealerPrice)}</div>`
    : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

document.querySelectorAll("[data-year]").forEach((node) => {
  node.textContent = new Date().getFullYear();
});

function absoluteUrl(path) {
  return new URL(path || "/", window.location.origin).toString();
}

function shortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function alertLeadName(lead) {
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.contactName || lead.email;
}

function saveCart() {
  localStorage.setItem("dealerCart", JSON.stringify(cart));
  updateCartCount();
}

function updateCartCount() {
  const count = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const cartCount = document.querySelector("#cartCount");
  if (cartCount) cartCount.textContent = count;
  const cartButton = document.querySelector(".cart-icon-button");
  if (cartButton) {
    cartButton.classList.toggle("cart-has-items", count > 0);
    cartButton.setAttribute("aria-label", count ? `Open cart, ${count} item${count === 1 ? "" : "s"}` : "Open cart");
  }
}

function addToCart(productId) {
  const existing = cart.find((item) => item.productId === Number(productId));
  if (existing) existing.quantity += 1;
  else cart.push({ productId: Number(productId), quantity: 1 });
  saveCart();
}

function cartProducts() {
  return cart.map((item) => {
    const product = productCache.find((entry) => entry.id === item.productId);
    return product ? { ...item, product } : null;
  }).filter(Boolean);
}

function updateCheckoutPaymentOptions(items = cartProducts()) {
  const form = document.querySelector("#checkoutForm");
  const fulfillment = form?.elements.fulfillmentMethod?.value || "ship";
  const payment = form?.elements.paymentMethod;
  const creditOption = payment?.querySelector('option[value="credit_card"]');
  const allItemsCanShip = items.length > 0 && items.every(({ product }) => product.productSpecs?.fulfillmentType === "ships_or_pickup");
  if (!creditOption || !payment) return;
  creditOption.disabled = fulfillment !== "ship" || !allItemsCanShip;
  creditOption.textContent = allItemsCanShip ? "Credit card for shipped items" : "Credit card unavailable for pickup-only items";
  if (creditOption.disabled && payment.value === "credit_card") payment.value = "etransfer";
}

function provinceFromPostalCode(postalCode) {
  const first = String(postalCode || "").trim().toUpperCase()[0];
  return {
    A: "NL",
    B: "NS",
    C: "PE",
    E: "NB",
    G: "QC",
    H: "QC",
    J: "QC",
    K: "ON",
    L: "ON",
    M: "ON",
    N: "ON",
    P: "ON",
    R: "MB",
    S: "SK",
    T: "AB",
    V: "BC",
    X: "NT",
    Y: "YT"
  }[first] || "";
}

function normalizePostalCode(value) {
  const text = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(text)) return `${text.slice(0, 3)} ${text.slice(3)}`;
  return String(value || "").trim().toUpperCase();
}

function parseQuickAddress(value) {
  const original = String(value || "").replace(/\s+/g, " ").trim();
  if (!original) return null;
  const postalMatch = original.match(/[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d/i);
  const postalCode = postalMatch ? normalizePostalCode(postalMatch[0]) : "";
  const withoutPostal = postalCode ? original.replace(postalMatch[0], "").replace(/\s+,/g, ",").replace(/,\s*,/g, ",").trim() : original;
  const parts = withoutPostal.split(",").map((part) => part.trim()).filter(Boolean);
  const countryIndex = parts.findIndex((part) => /^(canada|ca|usa|united states|us)$/i.test(part));
  const country = countryIndex >= 0
    ? (/^(usa|united states|us)$/i.test(parts[countryIndex]) ? "United States" : "Canada")
    : "Canada";
  if (countryIndex >= 0) parts.splice(countryIndex, 1);
  let region = "";
  const regionIndex = parts.findIndex((part) => /^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT|ALBERTA|BRITISH COLUMBIA|MANITOBA|NEW BRUNSWICK|NEWFOUNDLAND|NOVA SCOTIA|ONTARIO|QUEBEC|SASKATCHEWAN)$/i.test(part));
  if (regionIndex >= 0) {
    region = parts[regionIndex].toUpperCase();
    parts.splice(regionIndex, 1);
  }
  if (!region) region = provinceFromPostalCode(postalCode);
  const address1 = parts[0] || "";
  const city = parts.length > 1 ? parts[parts.length - 1] : "";
  return { address1, city, region, postalCode, country };
}

function fillCheckoutAddress() {
  const form = document.querySelector("#checkoutForm");
  const quickAddress = document.querySelector("#quickAddress");
  const parsed = parseQuickAddress(quickAddress?.value);
  if (!form || !parsed) return false;
  for (const [field, value] of Object.entries(parsed)) {
    if (value && form.elements[field]) form.elements[field].value = value;
  }
  return Boolean(parsed.address1 || parsed.city || parsed.postalCode);
}

function renderCart() {
  const items = cartProducts();
  const cartItems = document.querySelector("#cartItems");
  const cartSubtotal = document.querySelector("#cartSubtotal");
  const checkoutMessage = document.querySelector("#checkoutMessage");
  if (checkoutMessage) checkoutMessage.textContent = "";
  if (!items.length) {
    cartItems.innerHTML = `<p>Your cart is empty.</p>`;
    cartSubtotal.textContent = "$0.00";
    updateCheckoutPaymentOptions(items);
    return;
  }
  cartItems.innerHTML = items.map(({ product, quantity }) => `
    <div class="cart-line">
      <div>
        <strong>${escapeHtml(product.name)}</strong>
        <p>${escapeHtml(product.sku)} ${product.brand ? `| ${escapeHtml(product.brand)}` : ""}</p>
        <span>${escapeHtml(product.price)} each</span>
      </div>
      <div class="cart-controls">
        <button type="button" data-cart-qty="${product.id}" data-delta="-1">-</button>
        <strong>${quantity}</strong>
        <button type="button" data-cart-qty="${product.id}" data-delta="1">+</button>
        <button type="button" class="danger" data-cart-remove="${product.id}">Remove</button>
      </div>
    </div>
  `).join("");
  cartSubtotal.textContent = money(items.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0));
  updateCheckoutPaymentOptions(items);
}

function facebookListingText(product) {
  const shareUrl = absoluteUrl(product.shortUrl || product.url || `/products/${product.id}`);
  return [
    product.name,
    product.price ? `Price: ${product.price}` : "",
    product.brand ? `Brand: ${product.brand}` : "",
    product.sku ? `SKU: ${product.sku}` : "",
    product.upc ? `UPC: ${product.upc}` : "",
    `Qty available: ${product.quantityOnHand ?? 0}`,
    product.category ? `Category: ${product.category}` : "",
    product.productSpecs?.condition ? `Condition: ${product.productSpecs.condition}` : "",
    product.productSpecs?.length && product.productSpecs?.width && product.productSpecs?.height ? `Dimensions: ${product.productSpecs.length} x ${product.productSpecs.width} x ${product.productSpecs.height} ${product.productSpecs.dimensionUnit || ""}`.trim() : "",
    product.productSpecs?.weight ? `Weight: ${product.productSpecs.weight} ${product.productSpecs.weightUnit || ""}`.trim() : "",
    "",
    product.description || "",
    "",
    `View or buy here: ${shareUrl}`,
    product.productSpecs?.fulfillmentType === "ships_or_pickup"
      ? "Pickup orders use e-transfer or cash. Credit card is available for shipped orders on this item."
      : "Pickup currently in Mississauga. Payment by e-transfer or cash on pickup.",
    "Message me if interested."
  ].filter((line, index, lines) => line || lines[index - 1] !== "").join("\n").trim();
}

function stockHistoryBlock(product) {
  const history = Array.isArray(product.productSpecs?.stockHistory) ? product.productSpecs.stockHistory.slice(-5).reverse() : [];
  if (!history.length) return `<p class="mini-note">No stock changes recorded yet.</p>`;
  return `<div class="stock-history">${history.map((entry) => `
    <div><strong>${escapeHtml(entry.from)} to ${escapeHtml(entry.to)}</strong><span>${escapeHtml(entry.reason || "adjusted")} | ${escapeHtml(new Date(entry.at).toLocaleString())}</span></div>
  `).join("")}</div>`;
}

function specValue(product, key) {
  return escapeHtml(product.productSpecs?.[key] || "");
}

function specSelect(product, key, value, label) {
  return `<option value="${value}" ${product.productSpecs?.[key] === value ? "selected" : ""}>${label}</option>`;
}

function categorySelect(currentCategory = "") {
  const current = currentCategory || "";
  return `<option value="">Select category</option>${productCategories.map((category) => `<option value="${escapeHtml(category)}" ${current === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}`;
}

function conditionSelect(product) {
  const conditions = [
    ["", "Select condition"],
    ["Brand New In Box (BNIB)", "Brand New In Box (BNIB)"],
    ["Open Box / Refurbished (OP/R)", "Open Box / Refurbished (OP/R)"],
    ["Used (U)", "Used (U)"]
  ];
  const current = product.productSpecs?.condition || "";
  return conditions.map(([value, label]) => `<option value="${escapeHtml(value)}" ${current === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function productSpecsSummary(product) {
  const specs = product.productSpecs || {};
  const compact = [
    specs.condition ? `Condition: ${specs.condition}` : "",
    specs.model ? `Model: ${specs.model}` : "",
    specs.weight ? `Weight: ${specs.weight} ${specs.weightUnit || ""}`.trim() : "",
    specs.size ? `Size: ${specs.size}` : "",
    specs.color ? `Color: ${specs.color}` : ""
  ].filter(Boolean);
  const text = compact.slice(0, 3).map(escapeHtml).join(" | ");
  return text ? `<p class="spec-summary">${text}</p>` : "";
}

function fulfillmentLabel(product) {
  return product.productSpecs?.fulfillmentType === "ships_or_pickup" ? "Ships or Mississauga pickup" : "Mississauga pickup only";
}

function fulfillmentBadge(product) {
  const canShip = product.productSpecs?.fulfillmentType === "ships_or_pickup";
  return `<div class="fulfillment-alert ${canShip ? "ships" : "pickup"}">${escapeHtml(fulfillmentLabel(product))}</div>`;
}

function productText(product) {
  return [product.name, product.brand, product.sku, product.upc, product.category, product.description].join(" ").toLowerCase();
}

function renderStoreCategories(products) {
  const categories = [...new Set(products.map((product) => product.category).filter(Boolean))].sort();
  const current = storeCategory.value;
  storeCategory.innerHTML = `<option value="">All categories</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
  if (categories.includes(current)) storeCategory.value = current;
}

function filteredProducts(products) {
  const search = storeSearch.value.trim().toLowerCase();
  const category = storeCategory.value;
  return products.filter((product) => {
    const matchesSearch = !search || productText(product).includes(search);
    const matchesCategory = !category || product.category === category;
    return matchesSearch && matchesCategory;
  });
}

function updateStoreStructuredData(products) {
  document.querySelector("#storeStructuredData")?.remove();
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.id = "storeStructuredData";
  script.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: products.slice(0, 24).map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Product",
        name: product.name,
        brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
        sku: product.sku || undefined,
        gtin12: product.upc || undefined,
        image: product.imageUrl ? new URL(product.imageUrl, window.location.origin).toString() : undefined,
        description: product.description || undefined,
        offers: {
          "@type": "Offer",
          priceCurrency: "CAD",
          price: product.priceCents == null ? undefined : (Number(product.priceCents) / 100).toFixed(2),
          availability: "https://schema.org/InStock",
          url: window.location.href
        }
      }
    }))
  });
  document.head.appendChild(script);
}

function renderProducts(canSeePrices = false) {
  const products = filteredProducts(productCache);
  stopProductRotator();
  productGrid.innerHTML = products.length ? products.map((product) => `
    <article class="product-card">
        ${productImage(product, true)}
        <div class="product-body">
          <div class="product-copy">
            <div>
              <h2><a class="product-title-link" href="${escapeHtml(product.url || `/products/${product.id}`)}">${escapeHtml(product.name)}</a></h2>
              <p class="sku">${product.brand ? `${escapeHtml(product.brand)} | ` : ""}${escapeHtml(product.sku)} ${product.category ? `| ${escapeHtml(product.category)}` : ""}</p>
            </div>
            <p>${escapeHtml(product.description)}</p>
            ${productSpecsSummary(product)}
            ${fulfillmentBadge(product)}
            <div class="product-pricing">
              <div class="price">${escapeHtml(product.price || "$0.00")}</div>
              ${dealerPriceBlock(product)}
            </div>
          </div>
          <div class="product-card-footer">
            <div class="product-actions">
              <button class="primary" data-add-cart="${product.id}">Add to cart</button>
              <button type="button" data-copy-share="${product.id}" data-copy-url="${escapeHtml(absoluteUrl(product.shortUrl || product.url || `/products/${product.id}`))}">Share</button>
              <a class="nav-button" href="${escapeHtml(product.url || `/products/${product.id}`)}">Details</a>
            </div>
          </div>
        </div>
    </article>
  `).join("") : `<div class="panel empty-catalog"><h2>No matching items</h2><p>Try another search or category.</p></div>`;
  if (products.length) startProductRotator();
}

function renderLookupResults(data, quantityOnHand) {
  const results = document.querySelector("#upcLookupResults");
  const links = data.searchLinks.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.site)}</a>`).join("");
  const candidates = data.candidates.length
    ? data.candidates.map((item) => `
      <div class="lookup-result">
        ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async">` : `<div class="lookup-image-fallback">UPC</div>`}
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <p>${escapeHtml(item.site)} ${item.brand ? `| ${escapeHtml(item.brand)}` : ""} ${item.price ? `| ${escapeHtml(item.price)}` : ""}</p>
          ${item.description ? `<p>${escapeHtml(item.description.slice(0, 220))}</p>` : ""}
          <div class="row-actions">
            <a class="source-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Open result</a>
            <button type="button" data-import-candidate="${escapeHtml(item.url)}" data-import-qty="${escapeHtml(quantityOnHand)}">Load into form</button>
          </div>
        </div>
      </div>
    `).join("")
    : `<p>No extractable listing pages found. Try one of the search links below.</p>`;
  results.innerHTML = `
    <div class="lookup-summary">
      <strong>UPC ${escapeHtml(data.upc)}</strong>
      <div class="comparison-links">${links}</div>
    </div>
    ${candidates}
  `;
}

function populateProductFormFromImport(listing, quantityOnHand = 1) {
  const form = document.querySelector("#productForm");
  const message = document.querySelector("#productMessage");
  if (!form || !listing) return;
  const setValue = (name, value) => {
    if (form.elements[name]) form.elements[name].value = value ?? "";
  };
  setValue("name", listing.name || "");
  setValue("brand", listing.brand || "");
  setValue("sku", listing.sku || "");
  setValue("upc", listing.upc || "");
  setValue("category", listing.category || "Other");
  setValue("description", listing.description || "");
  setValue("price", listing.priceCents != null ? (Number(listing.priceCents) / 100).toFixed(2) : "");
  setValue("quantityOnHand", quantityOnHand || 1);
  setValue("sourceUrl", listing.sourceUrl || "");
  setValue("remoteImageUrl", listing.remoteImageUrl || "");
  setValue("active", "false");
  setValue("listingStatus", "draft");
  setValue("marketplaceStatus", "not_listed");
  if (imageInput) imageInput.value = "";
  if (imageDropHint) updateImageHint(imageInput, imageDropHint);
  if (message) message.textContent = listing.importWarning
    || (listing.remoteImageUrl
      ? "Listing loaded into the form. Review it, then save when ready. Imported items save hidden by default."
      : "Listing loaded into the form. Review it, then save when ready.");
  initializeAdminSteppers(form);
  setAdminStep(form.querySelector(".admin-stepper"), "basics");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadProducts() {
  if (productsRequest) return productsRequest;
  if (productCache.length) {
    renderProducts(Boolean(sessionUser?.canSeePrices));
    return { products: productCache, canSeePrices: Boolean(sessionUser?.canSeePrices) };
  }
  productGrid.innerHTML = loadingCards();
  productsRequest = withStatus("Loading products...", async () => {
    const data = await api("/api/products");
    productCache = data.products;
    renderStoreCategories(productCache);
    updateStoreStructuredData(productCache);
    priceNote.textContent = data.canSeePrices
      ? "Account pricing is visible on your approved account."
      : "Public pricing is visible. Create an account before checkout. Pickup is currently in Mississauga only.";
    renderProducts(data.canSeePrices);
    return data;
  });
  try {
    return await productsRequest;
  } finally {
    productsRequest = null;
  }
}

function comparisonBlock(product) {
  const rows = product.comparisons?.length
    ? product.comparisons.map((item) => `
      <li>
        <span>${escapeHtml(item.site)}</span>
        <strong>${escapeHtml(item.price)}</strong>
        ${item.productUrl ? `<a href="${escapeHtml(item.productUrl)}" target="_blank" rel="noopener">View</a>` : ""}
      </li>
    `).join("")
    : "<li><span>No saved competitor prices yet</span></li>";
  const links = product.searchLinks.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.site)}</a>`).join("");
  return `
    <div class="comparison-box">
      <div class="comparison-title">Market comparison</div>
      <ul>${rows}</ul>
      <div class="comparison-links">${links}</div>
    </div>
  `;
}

async function loadSession() {
  await withStatus("Checking session...", async () => {
    const data = await api("/api/session");
    sessionUser = data.user;
    updateNav();
  });
}

async function loadAdmin() {
  if (sessionUser?.role !== "admin") return setRoute("store");
  if (adminRequest) return adminRequest;
  const adminProducts = document.querySelector("#adminProducts");
  if (adminProducts) adminProducts.innerHTML = loadingRows(3);
  adminRequest = withStatus("Loading products...", () => api("/api/admin/products"));
  const products = await adminRequest;
  adminRequest = null;

  adminProductsCache = products.products;
  if (!selectedAdminProductId && adminProductsCache.length) {
    selectedAdminProductId = adminProductsCache[0].id;
  }
  renderAdminProducts(adminProductsCache);
  renderBulkProductEditor(adminProductsCache);

  setupImageDropzones(document.querySelector("#adminView"));
}

document.addEventListener("click", async (event) => {
  const stepButton = event.target.closest("[data-admin-step]");
  if (stepButton) {
    setAdminStep(stepButton.closest(".admin-stepper"), stepButton.dataset.adminStep);
    return;
  }

  const stepNav = event.target.closest("[data-admin-step-nav]");
  if (stepNav) {
    const form = stepNav.closest("form");
    const stepper = form?.querySelector(".admin-stepper");
    const order = stepperOrder(stepper);
    const current = stepper?.dataset.currentStep || stepper?.dataset.defaultStep || order[0];
    const index = Math.max(0, order.indexOf(current));
    const nextIndex = Math.min(order.length - 1, Math.max(0, index + Number(stepNav.dataset.adminStepNav || 0)));
    setAdminStep(stepper, order[nextIndex]);
    return;
  }

  const selectProductId = event.target.closest("[data-select-product]")?.dataset.selectProduct;
  if (selectProductId) {
    selectedAdminProductId = Number(selectProductId);
    adminProductMobileDetailOpen = true;
    renderAdminProducts(adminProductsCache);
    return;
  }

  if (event.target.closest("[data-back-products]")) {
    adminProductMobileDetailOpen = false;
    renderAdminProducts(adminProductsCache);
    return;
  }

  if (event.target.closest("[data-open-bug-report]")) {
    const modal = document.querySelector("#bugReportModal");
    const pageUrl = document.querySelector("#bugReportPageUrl");
    if (pageUrl) pageUrl.value = window.location.href;
    modal?.classList.remove("hidden");
    document.querySelector("#mainMenu")?.removeAttribute("open");
  }

  if (event.target.closest("[data-close-bug-report]")) {
    document.querySelector("#bugReportModal")?.classList.add("hidden");
  }

  const route = event.target.closest("[data-route]")?.dataset.route;
  if (route) {
    window.location.hash = route;
    setRoute(route);
    document.querySelector("#mainMenu")?.removeAttribute("open");
  }

  const categoryFilter = event.target.closest("[data-category-filter]");
  if (categoryFilter) {
    const category = categoryFilter.dataset.categoryFilter || "";
    storeCategory.value = category;
    storeSearch.value = "";
    renderProducts(Boolean(sessionUser?.canSeePrices));
    productGrid.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const addCartId = event.target.closest("[data-add-cart]")?.dataset.addCart;
  if (addCartId) {
    addToCart(addCartId);
    event.target.textContent = "Added";
    setTimeout(() => {
      event.target.textContent = "Add to cart";
    }, 1100);
  }

  const shareProductId = event.target.closest("[data-copy-share]")?.dataset.copyShare;
  if (shareProductId) {
    const shareButton = event.target.closest("[data-copy-share]");
    const product = productCache.find((entry) => entry.id === Number(shareProductId));
    const url = shareButton.dataset.copyUrl || absoluteUrl(product?.shortUrl || product?.url || `/products/${shareProductId}`);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = url;
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }
    const original = shareButton.textContent;
    shareButton.textContent = "Copied";
    setTimeout(() => { shareButton.textContent = original; }, 900);
  }

  const catalogButton = event.target.closest("[data-copy-catalog]");
  if (catalogButton) {
    const url = absoluteUrl("/s/catalog");
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = url;
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }
    const original = catalogButton.textContent;
    catalogButton.textContent = "Catalog link copied";
    setTimeout(() => { catalogButton.textContent = original; }, 1000);
  }

  if (event.target.closest("[data-close-exit-alert]")) {
    closeExitAlert(true);
  }

  if (event.target.id === "exitAlertModal") {
    closeExitAlert(true);
  }

  const qtyProductId = event.target.closest("[data-cart-qty]")?.dataset.cartQty;
  const delta = Number(event.target.closest("[data-cart-qty]")?.dataset.delta || 0);
  if (qtyProductId && delta) {
    const item = cart.find((entry) => entry.productId === Number(qtyProductId));
    if (item) item.quantity = Math.max(1, item.quantity + delta);
    saveCart();
    renderCart();
  }

  const removeProductId = event.target.closest("[data-cart-remove]")?.dataset.cartRemove;
  if (removeProductId) {
    cart = cart.filter((item) => item.productId !== Number(removeProductId));
    saveCart();
    renderCart();
  }

  const userId = event.target.closest("[data-user]")?.dataset.user;
  const status = event.target.closest("[data-status]")?.dataset.status;
  if (userId && status) {
    const restore = setButtonBusy(event.target.closest("[data-user]"), status === "approved" ? "Approving..." : "Saving...");
    try {
      await withStatus("Updating dealer status...", () => api(`/api/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      }));
      await loadAdmin();
    } finally {
      restore();
    }
  }

  const productId = event.target.closest("[data-inquire]")?.dataset.inquire;
  if (productId) {
    const button = event.target.closest("[data-inquire]");
    const restore = setButtonBusy(button, "Sending...");
    try {
      await withStatus("Sending request...", () => api("/api/inquiries", {
        method: "POST",
        body: JSON.stringify({ productId, quantity: 1 })
      }));
      button.textContent = "Request sent";
      button.disabled = true;
    } catch (error) {
      restore();
      throw error;
    }
  }

  const comparisonId = event.target.closest("[data-delete-comparison]")?.dataset.deleteComparison;
  if (comparisonId) {
    const restore = setButtonBusy(event.target.closest("[data-delete-comparison]"), "Removing...");
    try {
      await withStatus("Removing comparison...", () => api(`/api/admin/comparisons/${comparisonId}`, { method: "DELETE" }));
      await loadAdmin();
      await loadProducts();
    } finally {
      restore();
    }
  }

  const archiveProductId = event.target.closest("[data-archive-product]")?.dataset.archiveProduct;
  if (archiveProductId) {
    const button = event.target.closest("[data-archive-product]");
    const restore = setButtonBusy(button, "Archiving...");
    try {
      await withStatus("Archiving item...", () => api(`/api/admin/products/${archiveProductId}/archive`, { method: "POST", body: JSON.stringify({}) }));
      await loadAdmin();
      await loadProducts();
    } finally {
      restore();
    }
  }

  const restoreProductId = event.target.closest("[data-restore-product]")?.dataset.restoreProduct;
  if (restoreProductId) {
    const button = event.target.closest("[data-restore-product]");
    const restore = setButtonBusy(button, "Restoring...");
    try {
      await withStatus("Restoring item...", () => api(`/api/admin/products/${restoreProductId}/restore`, { method: "POST", body: JSON.stringify({}) }));
      await loadAdmin();
      await loadProducts();
    } finally {
      restore();
    }
  }

  const deleteProductId = event.target.closest("[data-delete-product]")?.dataset.deleteProduct;
  if (deleteProductId) {
    if (!window.confirm("Delete this item permanently? Use archive if you may want it later.")) return;
    const button = event.target.closest("[data-delete-product]");
    const restore = setButtonBusy(button, "Deleting...");
    try {
      await withStatus("Deleting item...", () => api(`/api/admin/products/${deleteProductId}`, { method: "DELETE" }));
      if (Number(selectedAdminProductId) === Number(deleteProductId)) selectedAdminProductId = null;
      adminProductMobileDetailOpen = false;
      await loadAdmin();
      await loadProducts();
    } catch (error) {
      alert(error.message);
    } finally {
      restore();
    }
  }

  const facebookProductId = event.target.closest("[data-copy-facebook]")?.dataset.copyFacebook;
  if (facebookProductId) {
    const textarea = document.querySelector(`#facebookListing${facebookProductId}`);
    if (!textarea) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(textarea.value);
    } else {
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
    }
    event.target.textContent = "Copied";
    setTimeout(() => {
      event.target.textContent = "Copy listing text";
    }, 1600);
  }

  const importCandidateUrl = event.target.closest("[data-import-candidate]")?.dataset.importCandidate;
  if (importCandidateUrl) {
    const button = event.target.closest("[data-import-candidate]");
    const restore = setButtonBusy(button, "Importing...");
    try {
      const data = await withStatus("Importing listing...", () => api("/api/admin/import-url", {
        method: "POST",
        body: JSON.stringify({
          url: importCandidateUrl,
          quantityOnHand: button.dataset.importQty || 1
        })
      }));
      populateProductFormFromImport(data.listing, button.dataset.importQty || 1);
      document.querySelector("#upcLookupMessage").textContent = data.warning || "Listing loaded into the form. Review and save when ready.";
      document.querySelector("#upcLookupResults").innerHTML = "";
    } catch (error) {
      document.querySelector("#upcLookupMessage").textContent = error.message;
    } finally {
      restore();
    }
  }
});

document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#loginMessage");
  try {
    const restore = setButtonBusy(event.target.querySelector("button[type='submit']"), "Logging in...");
    const form = new FormData(event.target);
    const data = await withStatus("Logging in...", () => api("/api/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form))
    }));
    sessionUser = data.user;
    updateNav();
    setRoute(sessionUser.role === "admin" ? "admin" : "store");
    restore();
  } catch (error) {
    message.textContent = error.message;
    const button = event.target.querySelector("button[type='submit']");
    if (button.dataset.originalText) {
      button.disabled = false;
      button.classList.remove("button-busy");
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
});

document.querySelector("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#registerMessage");
  const submitButton = event.target.querySelector("button[type='submit']");
  const restore = setButtonBusy(submitButton, "Registering...");
  try {
    const form = new FormData(event.target);
    const data = await withStatus("Submitting registration...", () => api("/api/register", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form))
    }));
    message.textContent = data.message;
    event.target.reset();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    restore();
  }
});

document.querySelector("#alertSignupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitAlertForm(event.target, document.querySelector("#alertSignupMessage"));
});

document.querySelector("#exitAlertForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const ok = await submitAlertForm(event.target, document.querySelector("#exitAlertMessage"));
  if (ok) setTimeout(() => closeExitAlert(true), 900);
});

document.querySelector("#bugReportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#bugReportMessage");
  const submitButton = event.target.querySelector("button[type='submit']");
  if (message) message.textContent = "";
  const restore = setButtonBusy(submitButton, "Sending...");
  try {
    document.querySelector("#bugReportPageUrl").value = window.location.href;
    const form = new FormData(event.target);
    const data = await withStatus("Sending report...", () => api("/api/bug-reports", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form))
    }));
    if (message) message.textContent = data.message;
    event.target.reset();
    setTimeout(() => document.querySelector("#bugReportModal")?.classList.add("hidden"), 900);
    if (sessionUser?.role === "admin") loadAdmin();
  } catch (error) {
    if (message) message.textContent = error.message;
  } finally {
    restore();
  }
});

function showExitAlert() {
  if (exitAlertShown || sessionUser) return;
  exitAlertShown = true;
  const modal = document.querySelector("#exitAlertModal");
  if (modal) modal.classList.remove("hidden");
}

function closeExitAlert(persist = false) {
  document.querySelector("#exitAlertModal")?.classList.add("hidden");
  if (persist) localStorage.setItem("exitAlertDismissed", "true");
}

async function submitAlertForm(formElement, messageElement) {
  const submitButton = formElement.querySelector("button[type='submit']");
  if (messageElement) messageElement.textContent = "";
  const restore = setButtonBusy(submitButton, "Saving...");
  try {
    const form = new FormData(formElement);
    const data = await withStatus("Saving alert signup...", () => api("/api/alerts", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form))
    }));
    if (messageElement) messageElement.textContent = data.message;
    formElement.reset();
    return true;
  } catch (error) {
    if (messageElement) messageElement.textContent = error.message;
    return false;
  } finally {
    restore();
  }
}

document.addEventListener("mouseleave", (event) => {
  if (event.clientY <= 0) showExitAlert();
});

window.addEventListener("blur", () => {
  if (window.innerWidth < 760) setTimeout(showExitAlert, 250);
});

window.addEventListener("resize", () => {
  if (viewModeRaf) cancelAnimationFrame(viewModeRaf);
  viewModeRaf = requestAnimationFrame(() => {
    viewModeRaf = 0;
    applyViewMode();
  });
});

const imageInput = document.querySelector("#productImages");
const imageDropzone = document.querySelector("#imageDropzone");
const imageDropHint = document.querySelector("#imageDropHint");
const exportProductsButton = document.querySelector("#exportProductsButton");
const importProductsButton = document.querySelector("#importProductsButton");
const importProductsFile = document.querySelector("#importProductsFile");
const productForm = document.querySelector("#productForm");
const openMobileListingButton = document.querySelector("#openMobileListing");
const closeMobileListingButton = document.querySelector("#closeMobileListing");
const toggleMobileListingDetailsButton = document.querySelector("#toggleMobileListingDetails");

function mobileListingMode() {
  return document.body.dataset.view === "mobile";
}

function setMobileListingAdvanced(expanded) {
  if (!productForm) return;
  productForm.classList.toggle("show-mobile-advanced", Boolean(expanded));
  if (toggleMobileListingDetailsButton) {
    toggleMobileListingDetailsButton.textContent = expanded ? "Basic view" : "More options";
    toggleMobileListingDetailsButton.setAttribute("aria-expanded", expanded ? "true" : "false");
  }
}

function openMobileListing() {
  if (!mobileListingMode() || !productForm) return;
  setMobileListingAdvanced(false);
  productForm.classList.add("mobile-open");
  document.body.classList.add("admin-listing-open");
  setTimeout(() => productForm.querySelector("[name='name']")?.focus(), 40);
}

function closeMobileListing() {
  productForm?.classList.remove("mobile-open");
  document.body.classList.remove("admin-listing-open");
  setMobileListingAdvanced(false);
}

storeSearch.addEventListener("input", () => renderProducts(Boolean(sessionUser?.canSeePrices)));
storeCategory.addEventListener("change", () => renderProducts(Boolean(sessionUser?.canSeePrices)));
document.querySelector("#storeSearchButton")?.addEventListener("click", () => {
  storeSearch.focus();
  renderProducts(Boolean(sessionUser?.canSeePrices));
});
document.querySelector("#checkoutForm")?.elements.fulfillmentMethod?.addEventListener("change", () => updateCheckoutPaymentOptions());
document.querySelector("#fillAddressBtn")?.addEventListener("click", () => {
  const message = document.querySelector("#checkoutMessage");
  const filled = fillCheckoutAddress();
  if (message) message.textContent = filled ? "Address fields filled. Please review before checkout." : "Paste a full address with city/province/postal code first.";
});
document.querySelector("#quickAddress")?.addEventListener("change", fillCheckoutAddress);

exportProductsButton?.addEventListener("click", () => {
  const message = document.querySelector("#productImportMessage") || document.querySelector("#productMessage");
  const run = async () => {
    const response = await fetch("/api/admin/products/export");
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      const data = contentType.includes("application/json")
        ? await response.json().catch(() => ({}))
        : { error: await response.text().catch(() => "") };
      throw new Error(data.error || "Could not export products.");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
    const filename = filenameMatch?.[1] || `selltomakemoney-products-${new Date().toISOString().slice(0, 10)}.csv`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    if (message) message.textContent = "Product export downloaded.";
  };
  const restore = setButtonBusy(exportProductsButton, "Exporting...");
  if (message) message.textContent = "";
  withStatus("Preparing product export...", run)
    .catch((error) => {
      if (message) message.textContent = error.message || "Could not export products.";
    })
    .finally(() => restore());
});

importProductsButton?.addEventListener("click", () => {
  importProductsFile?.click();
});

importProductsFile?.addEventListener("change", async (event) => {
  const message = document.querySelector("#productImportMessage") || document.querySelector("#productMessage");
  const file = event.target.files?.[0];
  if (!file) return;
  if (message) message.textContent = "";
  const restore = setButtonBusy(importProductsButton, "Importing...");
  try {
    const text = await file.text();
    const payload = { format: "csv", text };
    const result = await withStatus("Importing products...", () => api("/api/admin/products/import", {
      method: "POST",
      body: JSON.stringify(payload)
    }));
    if (message) message.textContent = `Import complete. Created ${result.created}, updated ${result.updated}.`;
    productCache = [];
    await loadAdmin();
    await loadProducts();
  } catch (error) {
    if (message) message.textContent = error.message || "Could not import products.";
  } finally {
    if (importProductsFile) importProductsFile.value = "";
    restore();
  }
});

openMobileListingButton?.addEventListener("click", openMobileListing);
closeMobileListingButton?.addEventListener("click", closeMobileListing);
toggleMobileListingDetailsButton?.addEventListener("click", () => {
  setMobileListingAdvanced(!productForm?.classList.contains("show-mobile-advanced"));
});

function setImageFiles(input, files) {
  const transfer = new DataTransfer();
  files.filter((file) => file.type.startsWith("image/")).forEach((file) => transfer.items.add(file));
  input.files = transfer.files;
}

function updateImageHint(input, hint) {
  const count = input.files.length;
  hint.textContent = count ? `${count} image${count === 1 ? "" : "s"} selected.` : (hint.dataset.defaultText || "You can add multiple product photos at once.");
}

function setupImageDropzones(root = document) {
  root.querySelectorAll("[data-image-dropzone], #imageDropzone").forEach((dropzone) => {
    if (dropzone.dataset.dropzoneReady === "true") return;
    dropzone.dataset.dropzoneReady = "true";
    const input = dropzone.querySelector("input[type='file']");
    const hint = dropzone.querySelector("[data-image-hint], small");
    if (!input || !hint) return;
    hint.dataset.defaultText ||= hint.textContent;
    input.addEventListener("change", () => updateImageHint(input, hint));
    ["dragenter", "dragover"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.add("drag-over");
      });
    });
    ["dragleave", "drop"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.remove("drag-over");
      });
    });
    dropzone.addEventListener("drop", (event) => {
      setImageFiles(input, [...event.dataTransfer.files]);
      updateImageHint(input, hint);
    });
  });
}

setupImageDropzones();
initializeAdminSteppers(document.querySelector("#adminView"));

document.querySelector("#productForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#productMessage");
  const submitButton = event.target.querySelector("button[type='submit']");
  message.textContent = "";
  const restore = setButtonBusy(submitButton, "Adding...");
  const form = new FormData(event.target);
  try {
    await withStatus("Adding product...", () => api("/api/admin/products", { method: "POST", body: form }));
    event.target.reset();
    if (event.target.elements.active) event.target.elements.active.value = "true";
    if (event.target.elements.remoteImageUrl) event.target.elements.remoteImageUrl.value = "";
    setMobileListingAdvanced(false);
    updateImageHint(imageInput, imageDropHint);
    message.textContent = "Product added.";
    if (mobileListingMode()) closeMobileListing();
    await loadAdmin();
    await loadProducts();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    restore();
  }
});

document.querySelector("#checkoutForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#checkoutMessage");
  const submitButton = event.target.querySelector("button[type='submit']");
  message.textContent = "";
  if (!cart.length) {
    message.textContent = "Add at least one item to the cart.";
    return;
  }
  const restore = setButtonBusy(submitButton, "Submitting...");
  const form = new FormData(event.target);
  const body = {
    items: cart.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    shipTo: {
      fulfillmentMethod: form.get("fulfillmentMethod"),
      paymentMethod: form.get("paymentMethod"),
      recipientName: form.get("recipientName"),
      company: form.get("company"),
      phone: form.get("phone"),
      email: form.get("email"),
      address1: form.get("address1"),
      address2: form.get("address2"),
      city: form.get("city"),
      region: form.get("region"),
      postalCode: form.get("postalCode"),
      country: form.get("country"),
      deliveryWindow: form.get("deliveryWindow"),
      receivingInstructions: form.get("receivingInstructions"),
      residentialAddress: form.has("residentialAddress"),
      liftgateRequired: form.has("liftgateRequired"),
      contactBeforeDelivery: form.has("contactBeforeDelivery")
    },
    note: form.get("note")
  };
  try {
    const data = await withStatus("Submitting checkout...", () => api("/api/orders", {
      method: "POST",
      body: JSON.stringify(body)
    }));
    cart = [];
    saveCart();
    renderCart();
    event.target.reset();
    event.target.elements.country.value = "Canada";
    event.target.elements.contactBeforeDelivery.checked = true;
    message.textContent = `Checkout request #${data.orderId} submitted.`;
  } catch (error) {
    if (error.message === "Please login first.") {
      message.innerHTML = `Please login or create an account before checkout. Payment is e-transfer or cash on pickup in Mississauga only.`;
    } else {
      message.textContent = error.message;
    }
  } finally {
    restore();
  }
});

document.addEventListener("input", async (event) => {
  if (event.target.id === "adminProductSearch") {
    adminProductSearch = event.target.value || "";
    if (sessionUser?.role === "admin" && !views.admin.classList.contains("hidden")) renderAdminProducts(adminProductsCache);
  }
  if (event.target.id === "bulkProductSearch") {
    bulkProductSearch = event.target.value || "";
    if (sessionUser?.role === "admin" && !views.admin.classList.contains("hidden")) renderBulkProductEditor(adminProductsCache);
  }
});

document.querySelector("#bulkProductForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#bulkProductMessage");
  const submitButton = event.target.querySelector("button[type='submit']");
  const restore = setButtonBusy(submitButton, "Saving...");
  if (message) message.textContent = "";
  try {
    const rows = [...event.target.querySelectorAll("[data-bulk-product-row]")];
    const newRows = rows.filter((row) => String(row.dataset.bulkProductRow || "").startsWith("new-"));
    const changes = rows
      .map((row) => {
        if (String(row.dataset.bulkProductRow || "").startsWith("new-")) return null;
        const productId = Number(row.dataset.bulkProductRow);
        const product = adminProductsCache.find((item) => Number(item.id) === productId);
        if (!product || !rowHasBulkChanges(row, product)) return null;
        return { row, product, values: bulkRowValues(row) };
      })
      .filter(Boolean);
    const newRowsToCreate = newRows
      .filter((row) => bulkNewRowReady(row))
      .map((row) => bulkRowValues(row));
    if (!changes.length && !newRowsToCreate.length) {
      if (message) message.textContent = "No bulk changes to save.";
      return;
    }
    let created = 0;
    for (const newRowValues of newRowsToCreate) {
      const formData = new FormData();
      formData.append("name", newRowValues.name);
      formData.append("brand", newRowValues.brand);
      formData.append("sku", newRowValues.sku);
      formData.append("upc", newRowValues.upc);
      formData.append("category", newRowValues.category);
      formData.append("condition", newRowValues.condition);
      formData.append("quantityOnHand", newRowValues.quantityOnHand || "0");
      formData.append("price", newRowValues.price);
      formData.append("dealerPrice", newRowValues.dealerPrice);
      formData.append("listingStatus", newRowValues.listingStatus || "draft");
      formData.append("marketplaceStatus", newRowValues.marketplaceStatus || "not_listed");
      formData.append("active", newRowValues.active || "true");
      await withStatus(`Adding ${newRowValues.name}...`, () => api("/api/admin/products", {
        method: "POST",
        body: formData
      }));
      created += 1;
    }
    for (const change of changes) {
      const formData = buildProductUpdateFormData(change.product, change.values);
      await withStatus(`Saving ${change.product.name}...`, () => api(`/api/admin/products/${change.product.id}`, {
        method: "PATCH",
        body: formData
      }));
    }
    if (message) {
      const updatedText = changes.length ? `Saved ${changes.length} product update${changes.length === 1 ? "" : "s"}.` : "";
      const createdText = created ? `Added ${created} new product.` : "";
      message.textContent = [createdText, updatedText].filter(Boolean).join(" ");
    }
    await loadAdmin();
    await loadProducts();
  } catch (error) {
    if (message) message.textContent = error.message || "Could not save bulk updates.";
  } finally {
    restore();
  }
});

document.querySelector("#addBulkRowButton")?.addEventListener("click", () => {
  appendBulkNewRow();
});

document.addEventListener("submit", async (event) => {
  const editForm = event.target.closest("[data-product-edit]");
  if (editForm) {
    event.preventDefault();
    const productId = editForm.dataset.productEdit;
    const message = editForm.querySelector(".form-message");
    const submitButton = editForm.querySelector("button[type='submit']");
    const restore = setButtonBusy(submitButton, "Saving...");
    message.textContent = "";
    try {
      await withStatus("Saving listing...", () => api(`/api/admin/products/${productId}`, {
        method: "PATCH",
        body: new FormData(editForm)
      }));
      message.textContent = "Listing updated.";
      await loadAdmin();
      await loadProducts();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      restore();
    }
    return;
  }

  const form = event.target.closest("[data-comparison-form]");
  if (!form) return;
  event.preventDefault();
  const productId = form.dataset.comparisonForm;
  const body = Object.fromEntries(new FormData(form));
  const restore = setButtonBusy(form.querySelector("button[type='submit']"), "Adding...");
  try {
    await withStatus("Adding comparison...", () => api(`/api/admin/products/${productId}/comparisons`, {
      method: "POST",
      body: JSON.stringify(body)
    }));
    form.reset();
    await loadAdmin();
    await loadProducts();
  } finally {
    restore();
  }
});

document.querySelector("#logoutButton").addEventListener("click", async () => {
  await withStatus("Logging out...", () => api("/api/logout", { method: "POST", body: JSON.stringify({}) }));
  sessionUser = null;
  updateNav();
  document.querySelector("#mainMenu")?.removeAttribute("open");
  setRoute("store");
});

window.addEventListener("hashchange", () => setRoute(routeFromHash()));

loadSession().then(() => setRoute(routeFromHash()));

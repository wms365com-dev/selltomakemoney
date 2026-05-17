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
  sellwithus: document.querySelector("#sellwithusView"),
  cart: document.querySelector("#cartView"),
  seller: document.querySelector("#sellerView"),
  admin: document.querySelector("#adminView"),
  facebook: document.querySelector("#facebookView")
};

const productGrid = document.querySelector("#productGrid");
const priceNote = document.querySelector("#priceNote");
const storeEyebrow = document.querySelector("#storeEyebrow");
const storeHeading = document.querySelector("#storeHeading");
const storeHeroCopy = document.querySelector("#storeHeroCopy");
const shareCatalogButton = document.querySelector("#shareCatalogButton");
const storeInsights = document.querySelector("#storeInsights");
const storeFeaturedPrimary = document.querySelector("#storeFeaturedPrimary");
const storeFeaturedGrid = document.querySelector("#storeFeaturedGrid");
const storeSearch = document.querySelector("#storeSearch");
const storeCategory = document.querySelector("#storeCategory");
const categoryTiles = document.querySelector("#categoryTiles");
const appStatus = document.querySelector("#appStatus");
const appStatusText = document.querySelector("#appStatusText");
const minimumStatusMs = 140;
let productsRequest = null;
let adminRequest = null;
let viewModeRaf = 0;
let currentStoreMode = "store";
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
let adminSummary = null;
let recentVisitors = [];
let visitorAnalytics = null;
let adminUsersCache = [];
let bulkProductSearch = "";
let bulkNewRowSequence = 1;
let activeFacebookListingProductId = null;
let selectedFacebookProductId = null;
let facebookProductSearch = "";
let facebookBridgeAccounts = [];
let facebookBridgeConfigured = false;
let sellerProductsCache = [];
let adminVisitorFilters = { country: "", deviceType: "", path: "" };
let consentState = { consent: "", analyticsEnabled: false };

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
  const requestedRoute = route || "store";
  if (requestedRoute === "admin" && sessionUser?.role !== "admin") {
    window.location.hash = "login";
    return setRoute("login");
  }
  if (requestedRoute === "facebook" && sessionUser?.role !== "admin") {
    window.location.hash = "login";
    return setRoute("login");
  }
  if (requestedRoute === "dealer" && !(sessionUser?.canSeePrices || sessionUser?.role === "admin")) {
    window.location.hash = "login";
    return setRoute("login");
  }
  if (requestedRoute === "shopper" && !sessionUser) {
    window.location.hash = "login";
    return setRoute("login");
  }
  if (requestedRoute === "seller" && !(sessionUser?.role === "admin" || sessionUser?.accountType === "seller")) {
    window.location.hash = "login";
    return setRoute("login");
  }
  const visibleRoute = requestedRoute === "dealer" ? "store" : requestedRoute;
  currentStoreMode = requestedRoute === "dealer" ? "dealer" : requestedRoute === "shopper" ? "shopper" : "store";
  document.body.dataset.storeMode = currentStoreMode;
  document.body.dataset.route = visibleRoute;
  Object.entries(views).forEach(([name, element]) => element.classList.toggle("hidden", name !== visibleRoute));
  if (visibleRoute === "store") loadProducts(currentStoreMode);
  if (route === "cart") {
    if (cart.length && !productCache.length) loadProducts().then(renderCart);
    else renderCart();
  }
  if (visibleRoute === "admin") loadAdmin();
  if (visibleRoute === "facebook") loadFacebookPage();
  if (visibleRoute === "seller") loadSeller();
}

function routeFromHash() {
  const route = window.location.hash.replace("#", "");
  if (route) return views[route] ? route : (route === "dealer" || route === "shopper" || route === "seller" ? route : "store");
  if (window.__ENTRY_ROUTE === "dealer") return "dealer";
  if (window.__ENTRY_ROUTE === "shopper") return "shopper";
  if (window.__ENTRY_ROUTE === "seller") return "seller";
  if (window.__ENTRY_ROUTE === "sellwithus") return "sellwithus";
  if (window.__ENTRY_ROUTE === "admin") return "admin";
  if (window.__ENTRY_ROUTE === "facebook") return "facebook";
  return "store";
}

function updateNav() {
  const signedIn = Boolean(sessionUser);
  document.body.classList.toggle("user-signed-in", signedIn);
  document.querySelectorAll(".signed-in").forEach((item) => item.classList.toggle("hidden", !signedIn));
  document.querySelectorAll(".signed-out").forEach((item) => item.classList.toggle("hidden", signedIn));
  document.querySelectorAll(".admin-only").forEach((item) => item.classList.toggle("hidden", sessionUser?.role !== "admin"));
  document.querySelectorAll(".shopper-only").forEach((item) => item.classList.toggle("hidden", sessionUser?.accountType !== "shopper"));
  document.querySelectorAll(".dealer-only").forEach((item) => item.classList.toggle("hidden", !(sessionUser?.canSeePrices || sessionUser?.role === "admin")));
  document.querySelectorAll(".seller-only").forEach((item) => item.classList.toggle("hidden", !(sessionUser?.accountType === "seller" || sessionUser?.role === "admin")));
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
      <span>${product.price || "$0.00"} | Qty ${escapeHtml(product.quantityOnHand ?? 0)} | Views ${escapeHtml(product.viewCount ?? 0)} | ${product.active ? "Live" : "Hidden"}</span>
    </button>
  `;
}

function sellerProductListItem(product) {
  return `
    <article class="admin-product-list-item seller-product-item">
      <strong>${escapeHtml(product.name)}</strong>
      <span>${escapeHtml(product.category || "No category")}${product.brand ? ` | ${escapeHtml(product.brand)}` : ""}</span>
      <span>${escapeHtml(product.price || "$0.00")} | Qty ${escapeHtml(product.quantityOnHand ?? 0)} | ${product.active ? "Live" : "Pending review"}</span>
    </article>
  `;
}

function renderAdminMetrics(summary) {
  const host = document.querySelector("#adminMetrics");
  if (!host) return;
  if (!summary) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = `
    <div class="panel admin-metric-card"><strong>${escapeHtml(summary.siteVisits ?? 0)}</strong><span>Site visits</span></div>
    <div class="panel admin-metric-card"><strong>${escapeHtml(summary.uniqueVisitors ?? 0)}</strong><span>Visitors</span></div>
    <div class="panel admin-metric-card"><strong>${escapeHtml(summary.listingViews ?? 0)}</strong><span>Listing views</span></div>
  `;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function visitorActivityItem(visitor) {
  const location = [visitor.city, visitor.region, visitor.country].filter(Boolean).join(", ") || "Unknown location";
  const device = [visitor.deviceType, visitor.browserName, visitor.osName].filter(Boolean).join(" | ") || "Unknown device";
  return `
    <article class="visitor-activity-item">
      <div>
        <strong>${escapeHtml(location)}</strong>
        <span>${escapeHtml(device)}</span>
      </div>
      <div>
        <strong>${escapeHtml(visitor.ipAddress || "Unknown IP")}</strong>
        <span>${escapeHtml(visitor.visitCount ?? 0)} visits | Last page ${escapeHtml(visitor.lastPath || "/")}</span>
      </div>
      <div>
        <strong>${escapeHtml(formatDateTime(visitor.lastSeenAt) || "Just now")}</strong>
        <span>${escapeHtml(visitor.referrer || "Direct visit")}</span>
      </div>
    </article>
  `;
}

function visitorSummaryCard(label, value) {
  return `
    <div class="panel visitor-summary-card">
      <strong>${escapeHtml(value ?? 0)}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function renderVisitorAnalyticsSummary(analytics) {
  const host = document.querySelector("#visitorAnalyticsSummary");
  if (!host) return;
  if (!analytics) {
    host.innerHTML = "";
    return;
  }
  const topCountry = analytics.topCountries?.[0]?.country || "No location yet";
  host.innerHTML = [
    visitorSummaryCard("Today visits", analytics.todayVisits ?? 0),
    visitorSummaryCard("Unique visitors today", analytics.uniqueVisitorsToday ?? 0),
    visitorSummaryCard("Top country today", topCountry)
  ].join("");
}

function renderVisitorHourlyChart(analytics) {
  const host = document.querySelector("#visitorHourlyChart");
  if (!host) return;
  const hourly = analytics?.hourly || [];
  if (!hourly.length) {
    host.innerHTML = "<p class=\"muted\">No visitor activity yet for today.</p>";
    return;
  }
  const maxVisits = Math.max(1, ...hourly.map((entry) => Number(entry.visits || 0)));
  host.innerHTML = `
    <div class="visitor-chart-head">
      <strong>Today by hour</strong>
      <span>${escapeHtml((analytics?.todayVisits ?? 0).toString())} total visits today</span>
    </div>
    <div class="visitor-chart-bars">
      ${hourly.map((entry) => {
        const visits = Number(entry.visits || 0);
        const height = Math.max(10, Math.round((visits / maxVisits) * 100));
        const label = `${String(entry.hour).padStart(2, "0")}:00`;
        return `
          <div class="visitor-chart-bar-wrap" title="${escapeHtml(`${label} - ${visits} visits`)}">
            <div class="visitor-chart-bar" style="height:${height}%"></div>
            <span>${escapeHtml(String(entry.hour).padStart(2, "0"))}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderVisitorActivity(visitors) {
  const host = document.querySelector("#visitorActivity");
  if (!host) return;
  if (!visitors?.length) {
    host.innerHTML = "<p>No visitor activity yet.</p>";
    return;
  }
  host.innerHTML = visitors.map((visitor) => visitorActivityItem(visitor)).join("");
}

function renderInteractionFunnel(interactions) {
  const host = document.querySelector("#interactionFunnel");
  if (!host) return;
  const funnel = interactions?.funnel;
  if (!funnel) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = [
    visitorSummaryCard("Product detail", funnel.productDetail ?? 0),
    visitorSummaryCard("Add to cart", funnel.addToCart ?? 0),
    visitorSummaryCard("Share", funnel.share ?? 0),
    visitorSummaryCard("Checkout start", funnel.checkoutStart ?? 0),
    visitorSummaryCard("Register start", funnel.registerStart ?? 0),
    visitorSummaryCard("Register submit", funnel.registerSubmit ?? 0)
  ].join("");
}

function renderInteractionTopProducts(interactions) {
  const host = document.querySelector("#interactionTopProducts");
  if (!host) return;
  const items = interactions?.topProducts || [];
  if (!items.length) {
    host.innerHTML = "<p>No tracked product interactions yet today.</p>";
    return;
  }
  host.innerHTML = items.map((item) => `
    <article class="visitor-activity-item">
      <div>
        <strong>${escapeHtml(item.name || `Product #${item.productId}`)}</strong>
        <span>Product ID ${escapeHtml(item.productId)}</span>
      </div>
      <div>
        <strong>${escapeHtml(item.interactions)}</strong>
        <span>Tracked interactions today</span>
      </div>
    </article>
  `).join("");
}

function renderInteractionEvents(interactions) {
  const host = document.querySelector("#interactionEvents");
  if (!host) return;
  const events = interactions?.recentEvents || [];
  if (!events.length) {
    host.innerHTML = "<p>No tracked interactions yet today.</p>";
    return;
  }
  host.innerHTML = events.map((event) => {
    const location = [event.city, event.region, event.country].filter(Boolean).join(", ") || "Unknown location";
    return `
      <article class="visitor-activity-item">
        <div>
          <strong>${escapeHtml(event.type || "interaction")}</strong>
          <span>${escapeHtml(event.label || event.path || "/")}</span>
        </div>
        <div>
          <strong>${escapeHtml(location)}</strong>
          <span>${escapeHtml([event.deviceType, event.browserName].filter(Boolean).join(" | ") || "Unknown device")}</span>
        </div>
        <div>
          <strong>${escapeHtml(formatDateTime(event.createdAt) || "Just now")}</strong>
          <span>${escapeHtml(event.value || event.referrer || "Tracked event")}</span>
        </div>
      </article>
    `;
  }).join("");
}

function syncVisitorFilterControls() {
  const country = document.querySelector("#visitorCountryFilter");
  const device = document.querySelector("#visitorDeviceFilter");
  const path = document.querySelector("#visitorPathFilter");
  if (country) country.value = adminVisitorFilters.country || "";
  if (device) device.value = adminVisitorFilters.deviceType || "";
  if (path) path.value = adminVisitorFilters.path || "";
}

async function loadVisitorAnalytics() {
  if (sessionUser?.role !== "admin") return;
  const query = new URLSearchParams();
  if (adminVisitorFilters.country) query.set("country", adminVisitorFilters.country);
  if (adminVisitorFilters.deviceType) query.set("deviceType", adminVisitorFilters.deviceType);
  if (adminVisitorFilters.path) query.set("path", adminVisitorFilters.path);
  const analytics = await api(`/api/admin/visitors${query.toString() ? `?${query}` : ""}`);
  visitorAnalytics = analytics;
  recentVisitors = analytics.recentVisitors || [];
  renderVisitorAnalyticsSummary(visitorAnalytics);
  renderVisitorHourlyChart(visitorAnalytics);
  renderVisitorActivity(recentVisitors);
  renderInteractionFunnel(visitorAnalytics.interactions);
  renderInteractionTopProducts(visitorAnalytics.interactions);
  renderInteractionEvents(visitorAnalytics.interactions);
  syncVisitorFilterControls();
}

function adminUserItem(user) {
  const accountType = user.accountType || "shopper";
  const userStatus = user.status || "pending";
  return `
    <article class="admin-user-item">
      <div>
        <strong>${escapeHtml(user.contactName || user.company || user.email)}</strong>
        <span>${escapeHtml(user.email)}${user.company ? ` | ${escapeHtml(user.company)}` : ""}</span>
        <span>${escapeHtml(user.phone || "No phone saved")}</span>
      </div>
      <div class="admin-user-controls">
        <label>Type
          <select data-user-account-type="${user.id}">
            <option value="shopper" ${accountType === "shopper" ? "selected" : ""}>Shopper</option>
            <option value="dealer" ${accountType === "dealer" ? "selected" : ""}>Dealer</option>
            <option value="seller" ${accountType === "seller" ? "selected" : ""}>Seller</option>
          </select>
        </label>
        <label>Status
          <select data-user-status="${user.id}">
            <option value="pending" ${userStatus === "pending" ? "selected" : ""}>Pending</option>
            <option value="approved" ${userStatus === "approved" ? "selected" : ""}>Approved</option>
            <option value="rejected" ${userStatus === "rejected" ? "selected" : ""}>Rejected</option>
          </select>
        </label>
      </div>
    </article>
  `;
}

function renderAdminUsers(users) {
  const host = document.querySelector("#adminUsers");
  if (!host) return;
  if (!users?.length) {
    host.innerHTML = "<p>No users yet.</p>";
    return;
  }
  host.innerHTML = users.map((user) => adminUserItem(user)).join("");
}

function renderSellerProducts(products) {
  const host = document.querySelector("#sellerProducts");
  if (!host) return;
  if (!products?.length) {
    host.innerHTML = `<div class="panel empty-catalog"><h2>No seller listings yet</h2><p>Submit your first item and it will appear here while it moves through review.</p></div>`;
    return;
  }
  host.innerHTML = products.map((product) => sellerProductListItem(product)).join("");
}

function updateSellerWorkspaceVisibility() {
  const pendingNotice = document.querySelector("#sellerPendingNotice");
  const workspace = document.querySelector("#sellerWorkspaceContent");
  if (!pendingNotice || !workspace) return;
  const approvedSeller = sessionUser?.role === "admin" || (sessionUser?.accountType === "seller" && sessionUser?.status === "approved");
  pendingNotice.classList.toggle("hidden", approvedSeller);
  workspace.classList.toggle("hidden", !approvedSeller);
}

function facebookProductListItem(product, isSelected = false) {
  return `
    <button type="button" class="admin-product-list-item ${isSelected ? "selected" : ""}" data-select-facebook-product="${product.id}">
      <strong>${escapeHtml(product.name)}</strong>
      <span>${product.price || "$0.00"}${product.productSpecs?.condition ? ` | ${escapeHtml(product.productSpecs.condition)}` : ""}</span>
      <span>${escapeHtml(product.brand || product.category || "Product")} | Qty ${escapeHtml(product.quantityOnHand ?? 0)}</span>
    </button>
  `;
}

function renderFacebookSelectedSummary(product, index, total) {
  const host = document.querySelector("#facebookSelectedProductSummary");
  if (!host) return;
  if (!product) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = `
    <div class="panel visitor-summary-card">
      <strong>${escapeHtml(product.name)}</strong>
      <span>${escapeHtml(product.brand || product.category || "Product")} | ${escapeHtml(product.price || "$0.00")} | ${escapeHtml(product.productSpecs?.condition || "Condition not set")}</span>
    </div>
    <div class="panel visitor-summary-card">
      <strong>${escapeHtml(index + 1)}</strong>
      <span>Selected of ${escapeHtml(total)}</span>
    </div>
    <div class="panel visitor-summary-card">
      <strong>Facebook draft</strong>
      ${facebookBridgeControlsMarkup(product)}
    </div>
  `;
}

function facebookBridgeControlsMarkup(product) {
  const accounts = facebookBridgeAccounts.length
    ? facebookBridgeAccounts
    : [{ id: "prathab-personal", label: "Prathab Personal", facebookProfileId: "" }];
  const selected = product?.productSpecs?.facebookAccountId || accounts[0]?.id || "prathab-personal";
  return `
    <label class="mini-note">Account
      <select data-facebook-account-select="${escapeHtml(product?.id || "")}">
        ${accounts.map((account) => `<option value="${escapeHtml(account.id)}" ${selected === account.id ? "selected" : ""}>${escapeHtml(account.label || account.id)}${account.facebookProfileId ? ` (${escapeHtml(account.facebookProfileId)})` : ""}</option>`).join("")}
      </select>
    </label>
    <button type="button" data-push-facebook-draft="${escapeHtml(product?.id || "")}" ${facebookBridgeConfigured ? "" : "disabled"}>Push to Facebook Drafts</button>
    <span class="mini-note">${facebookBridgeConfigured ? "Sends to the local Facebook bridge queue." : "Bridge env vars are not configured."}</span>
  `;
}

function moneyInputValue(cents) {
  return cents == null ? "" : (Number(cents) / 100).toFixed(2);
}

function singleLineText(value, max = 120) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
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
          <p>${product.price || "$0.00"} | Qty ${escapeHtml(product.quantityOnHand ?? 0)} | Views ${escapeHtml(product.viewCount ?? 0)} | ${escapeHtml(product.category || "No category")} | ${product.active ? "Live" : "Hidden"}</p>
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
        <label class="wide-field">Photo folder / image URLs<textarea name="remoteImageUrls" rows="3" placeholder="Paste a public folder/gallery URL or direct image URLs, one per line"></textarea></label>
        ${product.imageUrls?.length ? `<div class="admin-editor-image-preview wide-field"><strong>Current photos</strong><div class="admin-image-strip">${product.imageUrls.map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="${escapeHtml(product.name)} image"></a>`).join("")}</div></div>` : ""}
        <div class="row-actions wide-field simple-product-actions">
          <button class="primary" type="submit">Save changes</button>
          <button type="button" data-open-facebook-helper="${product.id}">Facebook List</button>
          ${facebookBridgeControlsMarkup(product)}
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

function pricingBlock(product, canSeePrices = false) {
  if (canSeePrices && product.dealerPrice) {
    return `
      <div class="product-pricing dealer-pricing">
        <div>
          <span class="pricing-label">Dealer price</span>
          <div class="price dealer-price-emphasis">${escapeHtml(product.dealerPrice)}</div>
        </div>
        <div>
          <span class="pricing-label">Retail price</span>
          <div class="retail-price-muted">${escapeHtml(product.price || "$0.00")}</div>
        </div>
      </div>
    `;
  }
  if (canSeePrices) {
    return `
      <div class="product-pricing dealer-pricing">
        <div>
          <span class="pricing-label">Retail price</span>
          <div class="price">${escapeHtml(product.price || "$0.00")}</div>
        </div>
        <div class="dealer-contact-note">Dealer price: contact the person that sent this link.</div>
      </div>
    `;
  }
  return `
    <div class="product-pricing">
      <div class="price">${escapeHtml(product.price || "$0.00")}</div>
    </div>
  `;
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

async function submitQuickInquiry(productId, note, button, busyText = "Sending...") {
  if (!sessionUser) {
    window.location.hash = "login";
    setRoute("login");
    const message = document.querySelector("#loginMessage");
    if (message) message.textContent = "Please login or register first, then ask about the item.";
    return;
  }
  const restore = setButtonBusy(button, busyText);
  try {
    await withStatus("Sending request...", () => api("/api/inquiries", {
      method: "POST",
      body: JSON.stringify({ productId, quantity: 1, note })
    }));
    button.textContent = "Sent";
    button.disabled = true;
  } catch (error) {
    alert(error.message);
    restore();
  }
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
    cartItems.innerHTML = `<p>Your cart is empty. Pick an item to reserve.</p>`;
    cartSubtotal.textContent = "$0.00";
    updateCheckoutPaymentOptions(items);
    return;
  }
  cartItems.innerHTML = items.map(({ product, quantity }) => `
    <div class="cart-line">
      <div>
        <strong>${escapeHtml(product.name)}</strong>
        ${product.brand ? `<p>${escapeHtml(product.brand)}</p>` : ""}
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
    singleLineText(product.name, 100),
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

function facebookListingFields(product) {
  const shareUrl = absoluteUrl(product.shortUrl || product.url || `/products/${product.id}`);
  const description = [
    product.description || "",
    "",
    product.brand ? `Brand: ${product.brand}` : "",
    product.sku ? `SKU: ${product.sku}` : "",
    product.upc ? `UPC: ${product.upc}` : "",
    product.productSpecs?.condition ? `Condition: ${product.productSpecs.condition}` : "",
    `Qty available: ${product.quantityOnHand ?? 0}`,
    product.productSpecs?.fulfillmentType === "ships_or_pickup"
      ? "Pickup in Mississauga or shipping available depending on the item."
      : "Pickup in Mississauga only.",
    "Payment by e-transfer or cash on pickup.",
    "",
    `View item: ${shareUrl}`
  ].filter((line, index, lines) => line || lines[index - 1] !== "").join("\n").trim();
  return [
    { key: "title", label: "Title", value: singleLineText(product.name, 100), tone: "short" },
    { key: "price", label: "Price", value: (product.price || "$0.00").replace("$", ""), tone: "short" },
    { key: "category", label: "Category", value: product.category || "Other", tone: "short" },
    { key: "condition", label: "Condition", value: product.productSpecs?.condition || "Not set", tone: "short" },
    { key: "location", label: "Location", value: "Mississauga, ON", tone: "short" },
    { key: "description", label: "Description", value: description, tone: "long" },
    { key: "link", label: "Store link", value: shareUrl, tone: "short" }
  ];
}

function renderFacebookListingHelper(product) {
  const host = document.querySelector("#facebookListingFields");
  const title = document.querySelector("#facebookListingTitle");
  const copyFullButton = document.querySelector("#copyFacebookFullButton");
  if (!host || !product) return;
  activeFacebookListingProductId = product.id;
  if (title) title.textContent = `Facebook listing helper: ${product.name}`;
  host.innerHTML = facebookCopyCardsMarkup(product);
  if (copyFullButton) copyFullButton.textContent = "Copy full listing";
}

function facebookCopyCardsMarkup(product) {
  return facebookListingFields(product).map((field) => `
    <button
      type="button"
      class="facebook-copy-card ${field.tone === "long" ? "facebook-copy-card-long" : ""}"
      data-copy-facebook-field="${escapeHtml(field.key)}"
      data-copy-text="${escapeHtml(field.value)}"
    >
      <span class="facebook-copy-label">${escapeHtml(field.label)}</span>
      <span class="facebook-copy-hint">Tap to copy</span>
      <span class="facebook-copy-value ${field.tone === "long" ? "multiline" : ""}">${escapeHtml(field.value)}</span>
    </button>
  `).join("");
}

function renderFacebookMobilePage(products) {
  const listHost = document.querySelector("#facebookProductList");
  const fieldsHost = document.querySelector("#facebookMobileFields");
  const copyButton = document.querySelector("#copyFacebookMobileFullButton");
  if (!listHost || !fieldsHost || !copyButton) return;
  const search = facebookProductSearch.trim().toLowerCase();
  const filteredProducts = products.filter((product) => adminProductMatchesSearch(product, search));
  if (!filteredProducts.length) {
    listHost.innerHTML = "<p>No matching products.</p>";
    fieldsHost.innerHTML = "";
    renderFacebookSelectedSummary(null, 0, 0);
    return;
  }
  if (!filteredProducts.some((product) => product.id === selectedFacebookProductId)) {
    selectedFacebookProductId = filteredProducts[0].id;
  }
  const selectedIndex = Math.max(0, filteredProducts.findIndex((product) => product.id === selectedFacebookProductId));
  const selectedProduct = filteredProducts[selectedIndex] || filteredProducts[0];
  activeFacebookListingProductId = selectedProduct.id;
  listHost.innerHTML = filteredProducts.map((product) => facebookProductListItem(product, product.id === selectedProduct.id)).join("");
  fieldsHost.innerHTML = facebookCopyCardsMarkup(selectedProduct);
  renderFacebookSelectedSummary(selectedProduct, selectedIndex, filteredProducts.length);
  copyButton.textContent = "Copy full listing";
  const prevButton = document.querySelector("#facebookPrevButton");
  const nextButton = document.querySelector("#facebookNextButton");
  if (prevButton) prevButton.disabled = selectedIndex <= 0;
  if (nextButton) nextButton.disabled = selectedIndex >= filteredProducts.length - 1;
}

function openFacebookListingHelper(productId) {
  const product = adminProductsCache.find((entry) => entry.id === Number(productId))
    || productCache.find((entry) => entry.id === Number(productId));
  if (!product) return;
  renderFacebookListingHelper(product);
  document.querySelector("#facebookListingModal")?.classList.remove("hidden");
}

function closeFacebookListingHelper() {
  document.querySelector("#facebookListingModal")?.classList.add("hidden");
}

async function copyTextValue(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const fallback = document.createElement("textarea");
  fallback.value = value;
  document.body.appendChild(fallback);
  fallback.focus();
  fallback.select();
  document.execCommand("copy");
  fallback.remove();
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

function productSalesBadges(product) {
  const badges = [];
  const qty = Number(product.quantityOnHand || 0);
  const createdAt = product.createdAt ? new Date(product.createdAt) : null;
  if (qty > 0 && qty <= 2) badges.push(["Low stock", "low-stock"]);
  if (Number(product.viewCount || 0) >= 10 || Number(product.uniqueViewers || 0) >= 5) badges.push(["Popular", "popular"]);
  if (createdAt && !Number.isNaN(createdAt.getTime()) && (Date.now() - createdAt.getTime()) <= (1000 * 60 * 60 * 24 * 14)) {
    badges.push(["New arrival", "new-arrival"]);
  }
  if (!badges.length) return "";
  return `<div class="sales-badges">${badges.map(([label, tone]) => `<span class="sales-badge ${tone}">${escapeHtml(label)}</span>`).join("")}</div>`;
}

function productText(product) {
  return [product.name, product.brand, product.sku, product.upc, product.category, product.description].join(" ").toLowerCase();
}

function renderStoreCategories(products) {
  const categories = [...new Set(products.map((product) => product.category).filter(Boolean))].sort();
  const current = storeCategory.value;
  storeCategory.innerHTML = `<option value="">All categories</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
  if (categories.includes(current)) storeCategory.value = current;
  if (categoryTiles) {
    const categoryCards = categories.map((category) => {
      const matching = products.filter((product) => product.category === category);
      const lead = matching.find((product) => product.imageUrl || product.imageUrls?.length) || matching[0];
      const imageUrl = lead?.imageUrl || lead?.imageUrls?.[0] || "";
      return `
        <button type="button" class="category-tile" data-category-tile="${escapeHtml(category)}">
          ${imageUrl
            ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(category)}" loading="lazy" decoding="async">`
            : `<span>${escapeHtml((lead?.brand || category).slice(0, 18))}</span>`}
          <strong>${escapeHtml(category)}</strong>
          <small>${escapeHtml(matching.length)} item${matching.length === 1 ? "" : "s"}</small>
        </button>
      `;
    });
    categoryTiles.innerHTML = categoryCards.join("");
  }
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

function featuredStoreProducts(products) {
  return [...products]
    .sort((left, right) => {
      const rightScore = Number(right.viewCount || 0) + Number(right.uniqueViewers || 0);
      const leftScore = Number(left.viewCount || 0) + Number(left.uniqueViewers || 0);
      if (rightScore !== leftScore) return rightScore - leftScore;
      return Number(right.priceCents || 0) - Number(left.priceCents || 0);
    })
    .slice(0, 4);
}

function renderStoreHero(products) {
  if (!storeFeaturedPrimary || !storeFeaturedGrid) return;
  const featured = featuredStoreProducts(products);
  if (!featured.length) {
    storeFeaturedPrimary.innerHTML = "";
    storeFeaturedGrid.innerHTML = "";
    return;
  }
  const primary = featured[0];
  const secondary = featured.slice(1, 4);
  const primaryImage = primary.imageUrl || primary.imageUrls?.[0] || "";
  storeFeaturedPrimary.innerHTML = `
    <a class="hero-feature-link" href="${escapeHtml(primary.url || `/products/${primary.id}`)}">
      ${primaryImage ? `<img src="${escapeHtml(primaryImage)}" alt="${escapeHtml(primary.name)}" loading="eager" decoding="async">` : `<span>${escapeHtml(primary.brand || primary.category || "Featured")}</span>`}
      <div class="hero-feature-copy">
        <p class="eyebrow">Featured product</p>
        <strong>${escapeHtml(primary.name)}</strong>
        <span>${escapeHtml(primary.brand || primary.category || "Inventory find")}</span>
      </div>
    </a>
  `;
  storeFeaturedGrid.innerHTML = secondary.map((product) => {
    const imageUrl = product.imageUrl || product.imageUrls?.[0] || "";
    return `
      <a class="hero-feature-mini" href="${escapeHtml(product.url || `/products/${product.id}`)}">
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async">` : `<span>${escapeHtml(product.brand || product.category || "Featured")}</span>`}
        <strong>${escapeHtml(product.name)}</strong>
      </a>
    `;
  }).join("");
}

function renderStoreInsights(products) {
  if (!storeInsights) return;
  storeInsights.innerHTML = "";
}

function renderProducts(canSeePrices = false) {
  const products = filteredProducts(productCache);
  stopProductRotator();
  productGrid.innerHTML = products.length ? products.map((product) => `
    <article class="product-card">
        <a class="product-card-link" href="${escapeHtml(product.url || `/products/${product.id}`)}" aria-label="View details for ${escapeHtml(product.name)}">
          ${productImage(product, false)}
        </a>
        <div class="product-body">
          <div class="product-copy">
            <div>
              <h2><a class="product-title-link" href="${escapeHtml(product.url || `/products/${product.id}`)}">${escapeHtml(product.name)}</a></h2>
              <p class="product-card-meta">${escapeHtml([product.brand, product.category].filter(Boolean).join(" | ") || "Available inventory")}</p>
            </div>
            ${pricingBlock(product, canSeePrices)}
            ${fulfillmentBadge(product)}
          </div>
          <div class="product-card-footer">
            <div class="product-actions">
              <a class="nav-button" href="${escapeHtml(product.url || `/products/${product.id}`)}">View details</a>
              <button class="primary" data-buy-now="${product.id}">Reserve</button>
            </div>
          </div>
        </div>
    </article>
  `).join("") : `<div class="panel empty-catalog"><h2>No matching items</h2><p>Try another search or category.</p></div>`;
}

function applyStoreModeCopy(canSeePrices = false) {
  const dealerMode = currentStoreMode === "dealer";
  const shopperMode = currentStoreMode === "shopper";
  if (storeEyebrow) storeEyebrow.textContent = dealerMode ? "Dealer pricing" : shopperMode ? "Shopper account" : "Public deals";
  if (storeHeading) storeHeading.textContent = dealerMode ? "Dealer products" : shopperMode ? "Shopper products" : "Shop available inventory.";
  if (storeHeroCopy) {
    storeHeroCopy.textContent = dealerMode
      ? "Search inventory and open the products you want."
      : shopperMode
        ? "Search inventory and add the products you want."
        : "Search inventory, check the details, and reserve the products you want.";
  }
  if (priceNote) {
    priceNote.textContent = dealerMode
      ? "Dealer account pricing is active. If dealer price is missing on an item, contact the person that sent you the link."
      : shopperMode
        ? "Shopper account is active. Public pricing is shown here for checkout and saved activity."
        : (canSeePrices
        ? "Account pricing is visible on your approved account."
        : "Reserve products online and finish pickup details in the cart.");
  }
  if (shareCatalogButton) {
    shareCatalogButton.textContent = dealerMode ? "Share dealer page" : shopperMode ? "Share shopper page" : "Share catalog";
  }
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

async function loadProducts(mode = currentStoreMode) {
  currentStoreMode = mode || "store";
  document.body.dataset.storeMode = currentStoreMode;
  if (productsRequest) return productsRequest;
  if (productCache.length) {
    applyStoreModeCopy(Boolean(sessionUser?.canSeePrices));
    renderStoreHero(productCache);
    renderStoreInsights(productCache);
    renderStoreCategories(productCache);
    renderProducts(Boolean(sessionUser?.canSeePrices));
    return { products: productCache, canSeePrices: Boolean(sessionUser?.canSeePrices) };
  }
  productGrid.innerHTML = loadingCards();
  productsRequest = withStatus("Loading products...", async () => {
    const data = await api("/api/products");
    productCache = data.products;
    renderStoreCategories(productCache);
    renderStoreHero(productCache);
    renderStoreInsights(productCache);
    updateStoreStructuredData(productCache);
    applyStoreModeCopy(data.canSeePrices);
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
    consentState = data.consent || consentState;
    updateNav();
    updateConsentBanner();
  });
}

function updateConsentBanner() {
  const banner = document.querySelector("#consentBanner");
  if (!banner) return;
  banner.classList.toggle("hidden", Boolean(consentState?.consent));
}

async function setConsentPreference(consent) {
  const data = await api("/api/consent", {
    method: "POST",
    body: JSON.stringify({ consent })
  });
  consentState = data.consent || { consent, analyticsEnabled: consent === "analytics" };
  updateConsentBanner();
}

async function trackEvent(type, payload = {}) {
  if (!consentState?.analyticsEnabled) return;
  try {
    await fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        path: window.location.pathname + window.location.hash,
        ...payload
      }),
      keepalive: true
    });
  } catch {}
}

async function loadAdmin() {
  if (sessionUser?.role !== "admin") return setRoute("store");
  if (adminRequest) return adminRequest;
  const adminProducts = document.querySelector("#adminProducts");
  if (adminProducts) adminProducts.innerHTML = loadingRows(3);
  adminRequest = withStatus("Loading products...", async () => {
    const visitorQuery = new URLSearchParams();
    if (adminVisitorFilters.country) visitorQuery.set("country", adminVisitorFilters.country);
    if (adminVisitorFilters.deviceType) visitorQuery.set("deviceType", adminVisitorFilters.deviceType);
    if (adminVisitorFilters.path) visitorQuery.set("path", adminVisitorFilters.path);
    const [products, summary, visitors, users, facebookBridge] = await Promise.all([
      api("/api/admin/products"),
      api("/api/admin/summary"),
      api(`/api/admin/visitors${visitorQuery.toString() ? `?${visitorQuery}` : ""}`),
      api("/api/admin/users"),
      api("/api/admin/facebook-bridge/accounts").catch(() => ({ configured: false, accounts: [] }))
    ]);
    return { products, summary, visitors, users, facebookBridge };
  });
  const { products, summary, visitors, users, facebookBridge } = await adminRequest;
  adminRequest = null;

  adminSummary = summary;
  visitorAnalytics = visitors;
  recentVisitors = visitors.recentVisitors || [];
  adminUsersCache = users.users || [];
  adminProductsCache = products.products;
  facebookBridgeAccounts = facebookBridge.accounts || [];
  facebookBridgeConfigured = Boolean(facebookBridge.configured);
  if (!selectedAdminProductId && adminProductsCache.length) {
    selectedAdminProductId = adminProductsCache[0].id;
  }
  renderAdminMetrics(adminSummary);
  renderAdminUsers(adminUsersCache);
  renderVisitorAnalyticsSummary(visitorAnalytics);
  renderVisitorHourlyChart(visitorAnalytics);
  renderVisitorActivity(recentVisitors);
  renderInteractionFunnel(visitorAnalytics.interactions);
  renderInteractionTopProducts(visitorAnalytics.interactions);
  renderInteractionEvents(visitorAnalytics.interactions);
  renderAdminProducts(adminProductsCache);
  renderBulkProductEditor(adminProductsCache);
  renderFacebookMobilePage(adminProductsCache);
  syncVisitorFilterControls();

  setupImageDropzones(document.querySelector("#adminView"));
}

async function loadFacebookPage() {
  if (sessionUser?.role !== "admin") return setRoute("store");
  if (!adminProductsCache.length) await loadAdmin();
  renderFacebookMobilePage(adminProductsCache);
}

async function loadSeller() {
  if (!(sessionUser?.role === "admin" || sessionUser?.accountType === "seller")) return setRoute("store");
  updateSellerWorkspaceVisibility();
  if (!(sessionUser?.role === "admin" || sessionUser?.status === "approved")) return;
  const data = await withStatus("Loading seller workspace...", () => api("/api/seller/products"));
  sellerProductsCache = data.products || [];
  renderSellerProducts(sellerProductsCache);
  setupImageDropzones(document.querySelector("#sellerView"));
}

document.addEventListener("click", async (event) => {
  const registerIntentButton = event.target.closest("[data-register-intent]");
  if (registerIntentButton) {
    const accountTypeField = document.querySelector("#registerForm [name='accountType']");
    if (accountTypeField) accountTypeField.value = registerIntentButton.dataset.registerIntent || "shopper";
  }

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

  const facebookHelperProductId = event.target.closest("[data-open-facebook-helper]")?.dataset.openFacebookHelper;
  if (facebookHelperProductId) {
    openFacebookListingHelper(facebookHelperProductId);
    return;
  }

  if (event.target.closest("[data-close-facebook-helper]")) {
    closeFacebookListingHelper();
    return;
  }

  const selectFacebookProductId = event.target.closest("[data-select-facebook-product]")?.dataset.selectFacebookProduct;
  if (selectFacebookProductId) {
    selectedFacebookProductId = Number(selectFacebookProductId);
    renderFacebookMobilePage(adminProductsCache);
    return;
  }

  if (event.target.closest("#facebookPrevButton") || event.target.closest("#facebookNextButton")) {
    const search = facebookProductSearch.trim().toLowerCase();
    const filteredProducts = adminProductsCache.filter((product) => adminProductMatchesSearch(product, search));
    if (!filteredProducts.length) return;
    const currentIndex = Math.max(0, filteredProducts.findIndex((product) => product.id === selectedFacebookProductId));
    const direction = event.target.closest("#facebookNextButton") ? 1 : -1;
    const nextIndex = Math.min(filteredProducts.length - 1, Math.max(0, currentIndex + direction));
    selectedFacebookProductId = filteredProducts[nextIndex].id;
    renderFacebookMobilePage(adminProductsCache);
    return;
  }

  const pushFacebookDraftId = event.target.closest("[data-push-facebook-draft]")?.dataset.pushFacebookDraft;
  if (pushFacebookDraftId) {
    const button = event.target.closest("[data-push-facebook-draft]");
    const accountSelect = document.querySelector(`[data-facebook-account-select="${CSS.escape(pushFacebookDraftId)}"]`);
    const restore = setButtonBusy(button, "Pushing...");
    try {
      const data = await withStatus("Pushing to Facebook drafts...", () => api(`/api/admin/products/${pushFacebookDraftId}/facebook-draft`, {
        method: "POST",
        body: JSON.stringify({ facebookAccountId: accountSelect?.value || "" })
      }));
      const index = adminProductsCache.findIndex((product) => Number(product.id) === Number(pushFacebookDraftId));
      if (index >= 0 && data.product) adminProductsCache[index] = data.product;
      renderAdminProducts(adminProductsCache);
      renderFacebookMobilePage(adminProductsCache);
      alert(`Facebook draft created: ${data.draft?.id || "ready"}`);
    } catch (error) {
      alert(error.message);
    } finally {
      restore();
    }
    return;
  }

  const copyFacebookField = event.target.closest("[data-copy-facebook-field]");
  if (copyFacebookField) {
    await copyTextValue(copyFacebookField.dataset.copyText || "");
    const hint = copyFacebookField.querySelector(".facebook-copy-hint");
    const original = hint?.textContent || "Tap to copy";
    if (hint) hint.textContent = "Copied";
    setTimeout(() => {
      if (hint) hint.textContent = original;
    }, 900);
    return;
  }

  if (event.target.closest("#copyFacebookFullButton")) {
    const product = adminProductsCache.find((entry) => entry.id === Number(activeFacebookListingProductId))
      || productCache.find((entry) => entry.id === Number(activeFacebookListingProductId));
    if (!product) return;
    await copyTextValue(facebookListingText(product));
    const button = event.target.closest("#copyFacebookFullButton");
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = original;
    }, 1000);
    return;
  }

  if (event.target.closest("#copyFacebookMobileFullButton")) {
    const product = adminProductsCache.find((entry) => entry.id === Number(activeFacebookListingProductId))
      || productCache.find((entry) => entry.id === Number(activeFacebookListingProductId));
    if (!product) return;
    await copyTextValue(facebookListingText(product));
    const button = event.target.closest("#copyFacebookMobileFullButton");
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = original;
    }, 1000);
    return;
  }

  const route = event.target.closest("[data-route]")?.dataset.route;
  if (route) {
    window.location.hash = route;
    setRoute(route);
    document.querySelector("#mainMenu")?.removeAttribute("open");
    if (route === "register") trackEvent("register_start", { label: "Open register" });
    if (route === "cart") trackEvent("checkout_start", { label: "Open cart" });
    if (route === "facebook") trackEvent("facebook_posting_open", { label: "Open Facebook posting workspace" });
  }

  const categoryFilter = event.target.closest("[data-category-filter]");
  if (categoryFilter) {
    const category = categoryFilter.dataset.categoryFilter || "";
    storeCategory.value = category;
    storeSearch.value = "";
    renderProducts(Boolean(sessionUser?.canSeePrices));
    trackEvent("category_filter", { label: category || "All categories", value: category || "" });
    productGrid.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const addCartId = event.target.closest("[data-add-cart]")?.dataset.addCart;
  if (addCartId) {
    const product = productCache.find((entry) => entry.id === Number(addCartId));
    addToCart(addCartId);
    trackEvent("add_to_cart", { productId: addCartId, label: product?.name || `Product ${addCartId}`, value: product?.price || "" });
    event.target.textContent = "Added";
    setTimeout(() => {
      event.target.textContent = "Add to cart";
    }, 1100);
  }

  const buyNowId = event.target.closest("[data-buy-now]")?.dataset.buyNow;
  if (buyNowId) {
    const product = productCache.find((entry) => entry.id === Number(buyNowId));
    addToCart(buyNowId);
    trackEvent("add_to_cart", { productId: buyNowId, label: product?.name || `Product ${buyNowId}`, value: product?.price || "" });
    window.location.hash = "cart";
    setRoute("cart");
    document.querySelector("#mainMenu")?.removeAttribute("open");
    return;
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
    trackEvent("share", { productId: shareProductId, label: product?.name || `Product ${shareProductId}`, value: url });
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
    trackEvent("share_catalog", { label: "Catalog share", value: url });
    const original = catalogButton.textContent;
    catalogButton.textContent = "Catalog link copied";
    setTimeout(() => { catalogButton.textContent = original; }, 1000);
  }

  const productDetailLink = event.target.closest(".product-card a[href*='/products/']");
  if (productDetailLink) {
    const productCard = productDetailLink.closest(".product-card");
    const addCartButton = productCard?.querySelector("[data-add-cart]");
    const productId = addCartButton?.dataset.addCart;
    const product = productCache.find((entry) => entry.id === Number(productId));
    trackEvent("product_detail", { productId, label: product?.name || productDetailLink.textContent.trim() });
  }

  const quickInquiryId = event.target.closest("[data-quick-inquiry]")?.dataset.quickInquiry;
  if (quickInquiryId) {
    const button = event.target.closest("[data-quick-inquiry]");
    await submitQuickInquiry(quickInquiryId, button.dataset.inquiryNote || "Asked about this item.", button, "Sending...");
    return;
  }

  const holdRequestId = event.target.closest("[data-hold-request]")?.dataset.holdRequest;
  if (holdRequestId) {
    const button = event.target.closest("[data-hold-request]");
    await submitQuickInquiry(holdRequestId, button.dataset.inquiryNote || "Please hold this item for pickup.", button, "Holding...");
    return;
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

document.addEventListener("change", async (event) => {
  if (event.target.matches("#visitorDeviceFilter, #visitorPathFilter")) {
    adminVisitorFilters = {
      country: document.querySelector("#visitorCountryFilter")?.value.trim() || "",
      deviceType: document.querySelector("#visitorDeviceFilter")?.value || "",
      path: document.querySelector("#visitorPathFilter")?.value || ""
    };
    await withStatus("Refreshing visitor analytics...", async () => loadVisitorAnalytics());
    return;
  }
});

document.addEventListener("input", async (event) => {
  if (event.target.matches("#visitorCountryFilter")) {
    window.clearTimeout(window.__visitorFilterTimer);
    window.__visitorFilterTimer = window.setTimeout(async () => {
      adminVisitorFilters = {
        country: document.querySelector("#visitorCountryFilter")?.value.trim() || "",
        deviceType: document.querySelector("#visitorDeviceFilter")?.value || "",
        path: document.querySelector("#visitorPathFilter")?.value || ""
      };
      await withStatus("Refreshing visitor analytics...", async () => loadVisitorAnalytics());
    }, 220);
  }
});

document.addEventListener("change", async (event) => {
  const userStatusSelect = event.target.closest("[data-user-status]");
  if (userStatusSelect) {
    const userStatusId = userStatusSelect.dataset.userStatus;
    const status = userStatusSelect.value;
    const restore = setButtonBusy(userStatusSelect, status === "approved" ? "Approving..." : "Saving...");
    try {
      await withStatus("Updating user status...", () => api(`/api/admin/users/${userStatusId}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      }));
      await loadAdmin();
    } finally {
      restore();
    }
    return;
  }

  const userAccountTypeSelect = event.target.closest("[data-user-account-type]");
  if (userAccountTypeSelect) {
    const userAccountTypeId = userAccountTypeSelect.dataset.userAccountType;
    const accountType = userAccountTypeSelect.value;
    const restore = setButtonBusy(userAccountTypeSelect, "Saving...");
    try {
      await withStatus("Updating user type...", () => api(`/api/admin/users/${userAccountTypeId}`, {
        method: "PATCH",
        body: JSON.stringify({ accountType })
      }));
      await loadAdmin();
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
    trackEvent("login_submit", { label: String(form.get("email") || "").trim().toLowerCase() });
    const data = await withStatus("Logging in...", () => api("/api/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form))
    }));
    sessionUser = data.user;
    consentState = data.consent || consentState;
    updateNav();
    if (sessionUser.role === "admin") {
      window.location.assign("/admin");
    } else if (sessionUser.accountType === "dealer") {
      window.location.assign("/dealer");
    } else if (sessionUser.accountType === "seller") {
      window.location.assign("/sell");
    } else if (sessionUser.accountType === "shopper") {
      window.location.assign("/shopper");
    } else {
      setRoute("store");
    }
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
    trackEvent("register_submit", { label: String(form.get("email") || "").trim().toLowerCase() });
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

document.querySelector("#sellerProductForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#sellerProductMessage");
  const submitButton = event.target.querySelector("button[type='submit']");
  const restore = setButtonBusy(submitButton, "Submitting...");
  if (message) message.textContent = "";
  try {
    const formData = new FormData(event.target);
    const response = await withStatus("Submitting seller listing...", async () => {
      const response = await fetch("/api/seller/products", {
        method: "POST",
        body: formData
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not submit seller listing.");
      return data;
    });
    if (message) message.textContent = response.message || "Listing submitted for review.";
    event.target.reset();
    await loadSeller();
  } catch (error) {
    if (message) message.textContent = error.message;
  } finally {
    restore();
  }
});

document.querySelector("#alertSignupForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitAlertForm(event.target, document.querySelector("#alertSignupMessage"));
});

document.querySelector("#exitAlertForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const ok = await submitAlertForm(event.target, document.querySelector("#exitAlertMessage"));
  if (ok) setTimeout(() => closeExitAlert(true), 900);
});

document.querySelector("#bugReportForm")?.addEventListener("submit", async (event) => {
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
const facebookProductSearchInput = document.querySelector("#facebookProductSearch");

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
categoryTiles?.addEventListener("click", (event) => {
  const tile = event.target.closest("[data-category-tile]");
  if (!tile) return;
  storeCategory.value = tile.dataset.categoryTile || "";
  renderProducts(Boolean(sessionUser?.canSeePrices));
  trackEvent("category_tile", { label: storeCategory.value, value: storeCategory.value });
});
storeSearch.addEventListener("change", () => {
  const value = String(storeSearch.value || "").trim();
  if (value) trackEvent("search", { label: value, value });
});
storeCategory.addEventListener("change", () => {
  const value = String(storeCategory.value || "").trim();
  if (value) trackEvent("category_filter", { label: value, value });
});
facebookProductSearchInput?.addEventListener("input", () => {
  facebookProductSearch = facebookProductSearchInput.value || "";
  renderFacebookMobilePage(adminProductsCache);
});
document.querySelector("#storeSearchButton")?.addEventListener("click", () => {
  storeSearch.focus();
  renderProducts(Boolean(sessionUser?.canSeePrices));
  const value = String(storeSearch.value || "").trim();
  if (value) trackEvent("search", { label: value, value });
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
    trackEvent("checkout_start", { label: body.shipTo.fulfillmentMethod || "checkout", value: `${cart.length} items` });
    const data = await withStatus("Submitting checkout...", () => api("/api/orders", {
      method: "POST",
      body: JSON.stringify(body)
    }));
    cart = [];
    saveCart();
    renderCart();
    event.target.reset();
    event.target.elements.country.value = "Canada";
    if (event.target.elements.contactBeforeDelivery) event.target.elements.contactBeforeDelivery.value = "on";
    message.textContent = `Request #${data.orderId} sent. We will contact you to finish pickup.`;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    restore();
  }
});

document.querySelector("#consentAnalyticsButton")?.addEventListener("click", async () => {
  await withStatus("Saving preference...", () => setConsentPreference("analytics"));
  await trackEvent("consent_analytics", { label: "Analytics consent accepted" });
});

document.querySelector("#consentEssentialButton")?.addEventListener("click", async () => {
  await withStatus("Saving preference...", () => setConsentPreference("essential"));
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
  if (window.location.pathname.toLowerCase().includes("/dealer") || window.location.pathname.toLowerCase().includes("/admin") || window.location.pathname.toLowerCase().includes("/sell")) {
    window.location.assign("/desktop");
    return;
  }
  setRoute("store");
});

window.addEventListener("hashchange", () => setRoute(routeFromHash()));

loadSession().then(() => setRoute(routeFromHash()));

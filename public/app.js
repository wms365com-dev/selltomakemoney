let sessionUser = null;
const viewMode = window.location.pathname.includes("mobile") ? "mobile" : "desktop";
document.body.dataset.view = viewMode;

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
let statusDepth = 0;
let productCache = [];
let cart = JSON.parse(localStorage.getItem("dealerCart") || "[]");
let productRotatorTimer = null;
let exitAlertShown = localStorage.getItem("exitAlertDismissed") === "true";

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

function startProductImageRotators() {
  if (productRotatorTimer) {
    clearInterval(productRotatorTimer);
    productRotatorTimer = null;
  }
  const rotators = [...document.querySelectorAll("[data-image-rotator]")].map((rotator) => ({
    images: [...rotator.querySelectorAll("img")],
    index: 0
  })).filter((rotator) => rotator.images.length > 1);
  if (!rotators.length) return;
  productRotatorTimer = setInterval(() => {
    rotators.forEach((rotator) => {
      rotator.images[rotator.index].classList.remove("active");
      rotator.index = (rotator.index + 1) % rotator.images.length;
      rotator.images[rotator.index].classList.add("active");
    });
  }, 3200);
}

function recommendedAddonsBlock(product) {
  if (!product.recommendedAddons?.length) return "";
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

function shoppingLinksBlock(product) {
  if (!product.searchLinks?.length) return "";
  return `
    <div class="shopping-links" aria-label="Compare on other sites">
      ${product.searchLinks.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.site)}</a>`).join("")}
    </div>
  `;
}

function dealerPriceBlock(product) {
  return product.dealerPrice ? `<div class="dealer-price">Dealer price ${escapeHtml(product.dealerPrice)}</div>` : "";
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
  const dimensions = [specs.length, specs.width, specs.height].filter(Boolean).join(" x ");
  const lines = [
    dimensions ? `Dims: ${dimensions} ${specs.dimensionUnit || ""}`.trim() : "",
    specs.weight ? `Weight: ${specs.weight} ${specs.weightUnit || ""}`.trim() : "",
    specs.condition ? `Condition: ${specs.condition}` : "",
    specs.color ? `Color: ${specs.color}` : "",
    specs.material ? `Material: ${specs.material}` : "",
    specs.model ? `Model: ${specs.model}` : ""
  ].filter(Boolean);
  return lines.length ? `<p class="spec-summary">${lines.map(escapeHtml).join(" | ")}</p>` : "";
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

function renderCategoryTiles(products) {
  if (!categoryTiles) return;
  const categoryMap = new Map();
  products.forEach((product) => {
    const category = product.category || "Featured";
    if (!categoryMap.has(category)) categoryMap.set(category, product);
  });
  const tiles = [...categoryMap.entries()].slice(0, 9);
  categoryTiles.innerHTML = tiles.length ? tiles.map(([category, product]) => {
    const imageUrl = product.imageUrl || product.imageUrls?.[0] || "";
    return `
      <button type="button" class="category-tile" data-category-filter="${escapeHtml(category)}">
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" decoding="async">` : `<span>${escapeHtml(category.slice(0, 2).toUpperCase())}</span>`}
        <strong>${escapeHtml(category)}</strong>
      </button>
    `;
  }).join("") : "";
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
  productGrid.innerHTML = products.length ? products.map((product) => `
    <article class="product-card">
        ${productImage(product, !canSeePrices)}
        <div class="product-body">
          <div>
          <h2><a class="product-title-link" href="${escapeHtml(product.url || `/products/${product.id}`)}">${escapeHtml(product.name)}</a></h2>
          <p class="sku">${product.brand ? `${escapeHtml(product.brand)} | ` : ""}${escapeHtml(product.sku)} ${product.category ? `| ${escapeHtml(product.category)}` : ""}</p>
        </div>
        <p>${escapeHtml(product.description)}</p>
        ${productSpecsSummary(product)}
        ${fulfillmentBadge(product)}
        <div class="price">${escapeHtml(product.price || "$0.00")}</div>
        ${dealerPriceBlock(product)}
        ${shoppingLinksBlock(product)}
        ${recommendedAddonsBlock(product)}
        <div class="product-actions">
          <button class="primary" data-add-cart="${product.id}">Add to cart</button>
          <button type="button" data-copy-share="${product.id}" data-copy-url="${escapeHtml(absoluteUrl(product.shortUrl || product.url || `/products/${product.id}`))}">Share</button>
          <a class="nav-button" href="${escapeHtml(product.url || `/products/${product.id}`)}">Details</a>
        </div>
      </div>
    </article>
  `).join("") : `<div class="panel empty-catalog"><h2>No matching items</h2><p>Try another search or category.</p></div>`;
  startProductImageRotators();
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
            <button type="button" data-import-candidate="${escapeHtml(item.url)}" data-import-qty="${escapeHtml(quantityOnHand)}">Import this listing</button>
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

async function loadProducts() {
  productGrid.innerHTML = loadingCards();
  await withStatus("Loading products...", async () => {
    const data = await api("/api/products");
    productCache = data.products;
    renderStoreCategories(productCache);
    renderCategoryTiles(productCache);
    updateStoreStructuredData(productCache);
    priceNote.textContent = data.canSeePrices
      ? "Account pricing is visible on your approved account."
      : "Public pricing is visible. Create an account before checkout. Pickup is currently in Mississauga only.";
    renderProducts(data.canSeePrices);
  });
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
  document.querySelector("#adminStats").innerHTML = loadingRows(3);
  document.querySelector("#usersList").innerHTML = loadingRows(2);
  document.querySelector("#adminProducts").innerHTML = loadingRows(3);
  document.querySelector("#inquiriesList").innerHTML = loadingRows(1);
  document.querySelector("#alertLeadsList").innerHTML = loadingRows(1);
  document.querySelector("#ordersList").innerHTML = loadingRows(2);
  const [summary, users, products, inquiries, alertLeads, orders] = await withStatus("Loading admin data...", () => Promise.all([
    api("/api/admin/summary"),
    api("/api/admin/users"),
    api("/api/admin/products"),
    api("/api/admin/inquiries"),
    api("/api/admin/alert-leads"),
    api("/api/admin/orders")
  ]));

  document.querySelector("#adminStats").innerHTML = `
    <div class="stat"><strong>${summary.pendingUsers}</strong>Pending dealers</div>
    <div class="stat"><strong>${summary.products}</strong>Products</div>
    <div class="stat"><strong>${summary.inquiries}</strong>New inquiries</div>
    <div class="stat"><strong>${summary.alertLeads || 0}</strong>Alert signups</div>
    <div class="stat"><strong>${summary.orders || 0}</strong>Checkout requests</div>
    <div class="stat"><strong>${summary.returningCustomers || 0}</strong>Returning customers</div>
  `;

  document.querySelector("#usersList").innerHTML = users.users.map((user) => `
    <div class="row">
      <div>
        <strong>${escapeHtml(user.company || user.email)}</strong>
        <p>${escapeHtml(user.contactName)} | ${escapeHtml(user.email)} | ${escapeHtml(user.status)}</p>
        <p class="customer-meta">
          <span class="${user.returningCustomer ? "returning-badge" : "new-badge"}">${user.returningCustomer ? "Returning customer" : "New customer"}</span>
          ${Number(user.orderCount || 0)} order${Number(user.orderCount || 0) === 1 ? "" : "s"}
          ${user.lastOrderAt ? `| Last order ${escapeHtml(shortDate(user.lastOrderAt))}` : ""}
          ${Number(user.totalSpentCents || 0) ? `| Lifetime ${money(user.totalSpentCents)}` : ""}
        </p>
      </div>
      <div class="row-actions">
        ${user.role === "admin" ? "" : `
          <button data-user="${user.id}" data-status="approved">Approve</button>
          <button class="danger" data-user="${user.id}" data-status="rejected">Reject</button>
        `}
      </div>
    </div>
  `).join("");

  const addonChoices = (product) => products.products
    .filter((item) => item.id !== product.id)
    .map((item) => `
      <label class="addon-choice">
        <input type="checkbox" name="recommendedAddonIds" value="${item.id}" ${(product.recommendedAddonIds || []).includes(item.id) ? "checked" : ""}>
        <span>${escapeHtml(item.name)}</span>
      </label>
    `).join("");

  document.querySelector("#adminProducts").innerHTML = products.products.map((product) => `
    <div class="row">
      <div>
        <strong>${escapeHtml(product.name)}</strong>
        <p>${product.brand ? `${escapeHtml(product.brand)} | ` : ""}${escapeHtml(product.sku)} ${product.upc ? `| UPC ${escapeHtml(product.upc)}` : ""} | Qty ${escapeHtml(product.quantityOnHand ?? 0)} | Public ${product.price} ${product.dealerPrice ? `| Dealer ${escapeHtml(product.dealerPrice)}` : ""} | ${product.active ? "Active" : "Hidden"}</p>
        <p class="mini-note">Listing: ${escapeHtml(product.productSpecs?.listingStatus || "draft")} | Marketplace: ${escapeHtml(product.productSpecs?.marketplaceStatus || "not_listed")} | Short link: ${escapeHtml(absoluteUrl(product.shortUrl || product.url))}</p>
        ${productSpecsSummary(product)}
        ${product.sourceUrl ? `<p><a class="source-link" href="${escapeHtml(product.sourceUrl)}" target="_blank" rel="noopener">Source listing</a></p>` : ""}
        <details class="edit-listing">
          <summary>Edit listing</summary>
          <form class="product-edit-form" data-product-edit="${product.id}">
            <details class="listing-section" open>
              <summary>Product identity</summary>
              <div class="listing-section-grid">
                <label>Name<input name="name" value="${escapeHtml(product.name)}" required autocomplete="off"></label>
                <label>Brand<input name="brand" value="${escapeHtml(product.brand)}" autocomplete="organization"></label>
                <label>SKU<input name="sku" value="${escapeHtml(product.sku)}"></label>
                <label>UPC<input name="upc" value="${escapeHtml(product.upc)}" inputmode="numeric"></label>
                <label>Category<input name="category" value="${escapeHtml(product.category)}"></label>
                <label>Model<input name="model" value="${specValue(product, "model")}" autocomplete="off"></label>
              </div>
            </details>
            <details class="listing-section" open>
              <summary>Inventory and pricing</summary>
              <div class="listing-section-grid">
                <label>Qty on hand<input name="quantityOnHand" type="number" min="0" step="1" value="${escapeHtml(product.quantityOnHand ?? 0)}"></label>
                <label>Public price<input name="price" type="number" min="0" step="0.01" value="${escapeHtml(((product.priceCents || 0) / 100).toFixed(2))}" required></label>
                <label>Dealer price<input name="dealerPrice" type="number" min="0" step="0.01" value="${product.dealerPriceCents == null ? "" : escapeHtml((product.dealerPriceCents / 100).toFixed(2))}" placeholder="Optional"></label>
                <label>Cost <input name="cost" type="number" min="0" step="0.01" value="${specValue(product, "cost")}" placeholder="Private"></label>
                <label>Status<select name="active">
                  <option value="true" ${product.active ? "selected" : ""}>Active</option>
                  <option value="false" ${product.active ? "" : "selected"}>Hidden</option>
                </select></label>
                <label>Listing status<select name="listingStatus">
                  ${["draft", "ready_to_list", "listed_on_site", "sold", "picked_up", "removed"].map((status) => `<option value="${status}" ${product.productSpecs?.listingStatus === status ? "selected" : ""}>${status.replaceAll("_", " ")}</option>`).join("")}
                </select></label>
                <label>Facebook status<select name="marketplaceStatus">
                  ${["not_listed", "ready_for_facebook", "listed_on_facebook", "offer_pending", "sold_on_facebook"].map((status) => `<option value="${status}" ${product.productSpecs?.marketplaceStatus === status ? "selected" : ""}>${status.replaceAll("_", " ")}</option>`).join("")}
                </select></label>
                <label>Customer fulfillment<select name="fulfillmentType">
                  <option value="pickup_only" ${product.productSpecs?.fulfillmentType === "ships_or_pickup" ? "" : "selected"}>Pickup only</option>
                  <option value="ships_or_pickup" ${product.productSpecs?.fulfillmentType === "ships_or_pickup" ? "selected" : ""}>Can be shipped or picked up</option>
                </select></label>
                <label>Condition<select name="condition">${conditionSelect(product)}</select></label>
                <label>Color<input name="color" value="${specValue(product, "color")}"></label>
              </div>
            </details>
            <details class="listing-section">
              <summary>Dimensions and shipping specs</summary>
              <div class="listing-section-grid">
                <label>Length<input name="length" type="number" min="0" step="0.01" value="${specValue(product, "length")}" inputmode="decimal"></label>
                <label>Width<input name="width" type="number" min="0" step="0.01" value="${specValue(product, "width")}" inputmode="decimal"></label>
                <label>Height<input name="height" type="number" min="0" step="0.01" value="${specValue(product, "height")}" inputmode="decimal"></label>
                <label>Dimension unit<select name="dimensionUnit">${specSelect(product, "dimensionUnit", "in", "in")}${specSelect(product, "dimensionUnit", "cm", "cm")}</select></label>
                <label>Weight<input name="weight" type="number" min="0" step="0.01" value="${specValue(product, "weight")}" inputmode="decimal"></label>
                <label>Weight unit<select name="weightUnit">${specSelect(product, "weightUnit", "lb", "lb")}${specSelect(product, "weightUnit", "kg", "kg")}</select></label>
                <label>Material<input name="material" value="${specValue(product, "material")}"></label>
              </div>
            </details>
            <details class="listing-section" open>
              <summary>Description and media</summary>
              <div class="listing-section-grid">
                <label class="wide-field">Description<textarea name="description" rows="3">${escapeHtml(product.description)}</textarea></label>
                <label class="wide-field">Source URL<input name="sourceUrl" type="url" value="${escapeHtml(product.sourceUrl)}" placeholder="Optional"></label>
                <label class="wide-field">Private source notes<textarea name="sourceNotes" rows="2" placeholder="Where it came from, costs, customer notes">${escapeHtml(product.productSpecs?.sourceNotes || "")}</textarea></label>
                <label class="wide-field">Replace images<input name="images" type="file" accept="image/*" multiple><small>Leave empty to keep current photos.</small></label>
              </div>
            </details>
            <details class="listing-section">
              <summary>Stock history</summary>
              ${stockHistoryBlock(product)}
            </details>
            <fieldset class="addon-picker wide-field">
              <legend>Recommended add-ons</legend>
              ${addonChoices(product) || "<p>No other products available yet.</p>"}
            </fieldset>
            <div class="row-actions wide-field">
              <button class="primary" type="submit">Save changes</button>
            </div>
            <p class="form-message wide-field"></p>
          </form>
        </details>
        ${recommendedAddonsBlock(product)}
        <details class="facebook-listing">
          <summary>List on Facebook</summary>
          <textarea readonly rows="9" id="facebookListing${product.id}">${escapeHtml(facebookListingText(product))}</textarea>
          <div class="row-actions">
            <button type="button" data-copy-facebook="${product.id}">Copy listing text</button>
            <button type="button" data-copy-share="${product.id}" data-copy-url="${escapeHtml(absoluteUrl(product.shortUrl || product.url || `/products/${product.id}`))}">Copy short link</button>
            ${product.imageUrl ? `<a class="source-link" href="${escapeHtml(product.imageUrl)}" target="_blank" rel="noopener">Open main image</a>` : ""}
          </div>
          ${product.imageUrls?.length ? `<div class="admin-image-strip">${product.imageUrls.map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="${escapeHtml(product.name)} image"></a>`).join("")}</div>` : ""}
        </details>
        <div class="mini-comparisons">
          ${(product.comparisons || []).map((item) => `<span>${escapeHtml(item.site)} ${escapeHtml(item.price)} <button type="button" data-delete-comparison="${item.id}">Remove</button></span>`).join("") || "<span>No competitor prices</span>"}
        </div>
        <form class="comparison-form" data-comparison-form="${product.id}">
          <input name="site" placeholder="Site" required>
          <input name="price" type="number" min="0" step="0.01" placeholder="Price" required>
          <input name="productUrl" placeholder="Product URL">
          <select name="currency">
            <option>CAD</option>
            <option>USD</option>
          </select>
          <select name="matchType">
            <option value="upc">UPC</option>
            <option value="description">Description</option>
          </select>
          <button type="submit">Add comparison</button>
        </form>
      </div>
    </div>
  `).join("");

  document.querySelector("#inquiriesList").innerHTML = inquiries.inquiries.length
    ? inquiries.inquiries.map((inquiry) => `
      <div class="row">
        <div>
          <strong>${escapeHtml(inquiry.productName)} x ${inquiry.quantity}</strong>
          <p>${escapeHtml(inquiry.company)} | ${escapeHtml(inquiry.email)} | ${escapeHtml(inquiry.note)}</p>
        </div>
      </div>
    `).join("")
    : "<p>No inquiries yet.</p>";

  document.querySelector("#alertLeadsList").innerHTML = alertLeads.leads.length
    ? alertLeads.leads.map((lead) => `
      <div class="row">
        <div>
          <strong>${escapeHtml(alertLeadName(lead))}</strong>
          <p>${escapeHtml(lead.email)}${lead.phone ? ` | ${escapeHtml(lead.phone)}` : ""} | ${escapeHtml(lead.status || "new")}</p>
          <p class="customer-meta">${lead.interests ? `Looking for: ${escapeHtml(lead.interests)} | ` : ""}${lead.updatedAt ? `Updated ${escapeHtml(shortDate(lead.updatedAt))}` : ""}</p>
        </div>
        <div class="row-actions">
          <a class="nav-button" href="mailto:${escapeHtml(lead.email)}">Email</a>
          ${lead.phone ? `<a class="nav-button" href="tel:${escapeHtml(lead.phone)}">Call</a>` : ""}
        </div>
      </div>
    `).join("")
    : "<p>No alert signups yet.</p>";

  document.querySelector("#ordersList").innerHTML = orders.orders.length
    ? orders.orders.map((order) => `
      <div class="row order-row">
        <div>
          <strong>Order #${order.id} | ${money(order.subtotalCents)}</strong>
          <p>${escapeHtml(order.company)} | ${escapeHtml(order.email)} | ${escapeHtml(order.status)}</p>
          <p class="customer-meta">
            <span class="${order.returningCustomer ? "returning-badge" : "new-badge"}">${order.returningCustomer ? "Returning customer" : "First order"}</span>
            ${Number(order.customerOrderCount || 1)} lifetime order${Number(order.customerOrderCount || 1) === 1 ? "" : "s"}
            ${Number(order.previousOrderCount || 0) ? `| ${Number(order.previousOrderCount)} previous` : ""}
            ${Number(order.customerTotalSpentCents || 0) ? `| Lifetime ${money(order.customerTotalSpentCents)}` : ""}
          </p>
          <p>${escapeHtml(order.shipTo?.fulfillmentMethod)} | ${escapeHtml(order.shipTo?.paymentMethod || "etransfer")} ${order.shipTo?.pickupLocation ? `| Pickup: ${escapeHtml(order.shipTo.pickupLocation)}` : ""} for ${escapeHtml(order.shipTo?.recipientName)} | ${escapeHtml(order.shipTo?.phone)}</p>
          <p>${escapeHtml(order.shipTo?.address1)} ${order.shipTo?.address2 ? `, ${escapeHtml(order.shipTo.address2)}` : ""}, ${escapeHtml(order.shipTo?.city)}, ${escapeHtml(order.shipTo?.region)} ${escapeHtml(order.shipTo?.postalCode)}, ${escapeHtml(order.shipTo?.country)}</p>
          <p>${escapeHtml(order.shipTo?.deliveryWindow)} | ${escapeHtml(order.shipTo?.receivingInstructions)}</p>
          <ul class="order-items">
            ${(order.items || []).map((item) => `<li>${escapeHtml(item.name)} x ${escapeHtml(item.quantity)} (${money(item.lineTotalCents)})</li>`).join("")}
          </ul>
          ${order.note ? `<p>Note: ${escapeHtml(order.note)}</p>` : ""}
        </div>
      </div>
    `).join("")
    : "<p>No checkout requests yet.</p>";
}

document.addEventListener("click", async (event) => {
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
      document.querySelector("#upcLookupMessage").textContent = data.imported.savedImage ? "Imported with image saved." : "Imported. No image was available to save.";
      document.querySelector("#upcLookupResults").innerHTML = "";
      await loadAdmin();
      await loadProducts();
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

document.querySelector("#importUrlForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#importUrlMessage");
  const submitButton = event.target.querySelector("button[type='submit']");
  message.textContent = "";
  const restore = setButtonBusy(submitButton, "Importing...");
  try {
    const body = Object.fromEntries(new FormData(event.target));
    const data = await withStatus("Importing listing...", () => api("/api/admin/import-url", {
      method: "POST",
      body: JSON.stringify(body)
    }));
    event.target.reset();
    message.textContent = data.imported.savedImage ? "Imported with image saved." : "Imported. No image was available to save.";
    await loadAdmin();
    await loadProducts();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    restore();
  }
});

document.querySelector("#upcLookupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#upcLookupMessage");
  const results = document.querySelector("#upcLookupResults");
  const submitButton = event.target.querySelector("button[type='submit']");
  const form = new FormData(event.target);
  message.textContent = "";
  results.innerHTML = loadingRows(2);
  const restore = setButtonBusy(submitButton, "Searching...");
  try {
    const upc = encodeURIComponent(form.get("upc"));
    const data = await withStatus("Searching UPC...", () => api(`/api/admin/upc-lookup?upc=${upc}`));
    renderLookupResults(data, form.get("quantityOnHand") || 1);
    message.textContent = data.candidates.length ? "Choose the best match to import." : "No extractable matches found yet.";
  } catch (error) {
    results.innerHTML = "";
    message.textContent = error.message;
  } finally {
    restore();
  }
});

const imageInput = document.querySelector("#productImages");
const imageDropzone = document.querySelector("#imageDropzone");
const imageDropHint = document.querySelector("#imageDropHint");

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

function updateImageHint() {
  const count = imageInput.files.length;
  imageDropHint.textContent = count ? `${count} image${count === 1 ? "" : "s"} selected.` : "You can add multiple product photos at once.";
}

imageInput.addEventListener("change", updateImageHint);

["dragenter", "dragover"].forEach((eventName) => {
  imageDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    imageDropzone.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  imageDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    imageDropzone.classList.remove("drag-over");
  });
});

imageDropzone.addEventListener("drop", (event) => {
  const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith("image/"));
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  imageInput.files = transfer.files;
  updateImageHint();
});

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
    updateImageHint();
    message.textContent = "Product added.";
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

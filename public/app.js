let sessionUser = null;
const viewMode = window.location.pathname.includes("mobile") ? "mobile" : "desktop";
document.body.dataset.view = viewMode;
document.querySelector("#desktopViewLink").classList.toggle("active", viewMode === "desktop");
document.querySelector("#mobileViewLink").classList.toggle("active", viewMode === "mobile");

const views = {
  store: document.querySelector("#storeView"),
  login: document.querySelector("#loginView"),
  register: document.querySelector("#registerView"),
  cart: document.querySelector("#cartView"),
  admin: document.querySelector("#adminView")
};

const productGrid = document.querySelector("#productGrid");
const priceNote = document.querySelector("#priceNote");
const appStatus = document.querySelector("#appStatus");
const appStatusText = document.querySelector("#appStatusText");
const minimumStatusMs = 140;
let statusDepth = 0;
let productCache = [];
let cart = JSON.parse(localStorage.getItem("dealerCart") || "[]");
let productRotatorTimer = null;

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

function saveCart() {
  localStorage.setItem("dealerCart", JSON.stringify(cart));
  updateCartCount();
}

function updateCartCount() {
  const count = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const cartCount = document.querySelector("#cartCount");
  if (cartCount) cartCount.textContent = count;
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

function renderCart() {
  const items = cartProducts();
  const cartItems = document.querySelector("#cartItems");
  const cartSubtotal = document.querySelector("#cartSubtotal");
  const checkoutMessage = document.querySelector("#checkoutMessage");
  if (checkoutMessage) checkoutMessage.textContent = "";
  if (!items.length) {
    cartItems.innerHTML = `<p>Your cart is empty.</p>`;
    cartSubtotal.textContent = "$0.00";
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
}

function facebookListingText(product) {
  return [
    product.name,
    product.price ? `Price: ${product.price}` : "",
    product.brand ? `Brand: ${product.brand}` : "",
    product.sku ? `SKU: ${product.sku}` : "",
    product.upc ? `UPC: ${product.upc}` : "",
    `Qty available: ${product.quantityOnHand ?? 0}`,
    product.category ? `Category: ${product.category}` : "",
    "",
    product.description || "",
    "",
    "Message me if interested."
  ].filter((line, index, lines) => line || lines[index - 1] !== "").join("\n").trim();
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
    priceNote.textContent = data.canSeePrices
      ? "Dealer pricing is visible on your approved account."
      : "Login after approval to see dealer pricing.";
    productGrid.innerHTML = data.products.map((product) => `
      <article class="product-card">
        ${productImage(product, !data.canSeePrices)}
        <div class="product-body">
          <div>
            <h2>${escapeHtml(product.name)}</h2>
            <p class="sku">${product.brand ? `${escapeHtml(product.brand)} | ` : ""}${escapeHtml(product.sku)} ${product.category ? `| ${escapeHtml(product.category)}` : ""}</p>
          </div>
          <p>${escapeHtml(product.description)}</p>
          ${product.price ? `<div class="price">${product.price}</div>` : `<div class="locked">Dealer login required for pricing</div>`}
          ${recommendedAddonsBlock(product)}
          ${product.price ? `<button class="primary" data-add-cart="${product.id}">Add to cart</button>` : ""}
        </div>
      </article>
    `).join("");
    startProductImageRotators();
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
  document.querySelector("#ordersList").innerHTML = loadingRows(2);
  const [summary, users, products, inquiries, orders] = await withStatus("Loading admin data...", () => Promise.all([
    api("/api/admin/summary"),
    api("/api/admin/users"),
    api("/api/admin/products"),
    api("/api/admin/inquiries"),
    api("/api/admin/orders")
  ]));

  document.querySelector("#adminStats").innerHTML = `
    <div class="stat"><strong>${summary.pendingUsers}</strong>Pending dealers</div>
    <div class="stat"><strong>${summary.products}</strong>Products</div>
    <div class="stat"><strong>${summary.inquiries}</strong>New inquiries</div>
    <div class="stat"><strong>${summary.orders || 0}</strong>Checkout requests</div>
  `;

  document.querySelector("#usersList").innerHTML = users.users.map((user) => `
    <div class="row">
      <div>
        <strong>${escapeHtml(user.company || user.email)}</strong>
        <p>${escapeHtml(user.contactName)} | ${escapeHtml(user.email)} | ${escapeHtml(user.status)}</p>
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
        <p>${product.brand ? `${escapeHtml(product.brand)} | ` : ""}${escapeHtml(product.sku)} ${product.upc ? `| UPC ${escapeHtml(product.upc)}` : ""} | Qty ${escapeHtml(product.quantityOnHand ?? 0)} | ${product.price} | ${product.active ? "Active" : "Hidden"}</p>
        ${product.sourceUrl ? `<p><a class="source-link" href="${escapeHtml(product.sourceUrl)}" target="_blank" rel="noopener">Source listing</a></p>` : ""}
        <details class="edit-listing">
          <summary>Edit listing</summary>
          <form class="product-edit-form" data-product-edit="${product.id}">
            <label>Name<input name="name" value="${escapeHtml(product.name)}" required autocomplete="off"></label>
            <label>Brand<input name="brand" value="${escapeHtml(product.brand)}" autocomplete="organization"></label>
            <label>SKU<input name="sku" value="${escapeHtml(product.sku)}"></label>
            <label>UPC<input name="upc" value="${escapeHtml(product.upc)}" inputmode="numeric"></label>
            <label>Category<input name="category" value="${escapeHtml(product.category)}"></label>
            <label>Qty on hand<input name="quantityOnHand" type="number" min="0" step="1" value="${escapeHtml(product.quantityOnHand ?? 0)}"></label>
            <label>Price<input name="price" type="number" min="0" step="0.01" value="${escapeHtml(((product.priceCents || 0) / 100).toFixed(2))}" required></label>
            <label>Status<select name="active">
              <option value="true" ${product.active ? "selected" : ""}>Active</option>
              <option value="false" ${product.active ? "" : "selected"}>Hidden</option>
            </select></label>
            <label class="wide-field">Description<textarea name="description" rows="3">${escapeHtml(product.description)}</textarea></label>
            <label class="wide-field">Source URL<input name="sourceUrl" type="url" value="${escapeHtml(product.sourceUrl)}" placeholder="Optional"></label>
            <label class="wide-field">Replace images<input name="images" type="file" accept="image/*" multiple><small>Leave empty to keep current photos.</small></label>
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

  document.querySelector("#ordersList").innerHTML = orders.orders.length
    ? orders.orders.map((order) => `
      <div class="row order-row">
        <div>
          <strong>Order #${order.id} | ${money(order.subtotalCents)}</strong>
          <p>${escapeHtml(order.company)} | ${escapeHtml(order.email)} | ${escapeHtml(order.status)}</p>
          <p>${escapeHtml(order.shipTo?.fulfillmentMethod)} for ${escapeHtml(order.shipTo?.recipientName)} | ${escapeHtml(order.shipTo?.phone)}</p>
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
  }

  const addCartId = event.target.closest("[data-add-cart]")?.dataset.addCart;
  if (addCartId) {
    addToCart(addCartId);
    event.target.textContent = "Added";
    setTimeout(() => {
      event.target.textContent = "Add to cart";
    }, 1100);
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
    message.textContent = error.message;
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
  setRoute("store");
});

window.addEventListener("hashchange", () => setRoute(routeFromHash()));

loadSession().then(() => setRoute(routeFromHash()));

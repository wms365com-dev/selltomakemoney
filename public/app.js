let sessionUser = null;
const viewMode = window.location.pathname.includes("mobile") ? "mobile" : "desktop";
document.body.dataset.view = viewMode;
document.querySelector("#desktopViewLink").classList.toggle("active", viewMode === "desktop");
document.querySelector("#mobileViewLink").classList.toggle("active", viewMode === "mobile");

const views = {
  store: document.querySelector("#storeView"),
  login: document.querySelector("#loginView"),
  register: document.querySelector("#registerView"),
  admin: document.querySelector("#adminView")
};

const productGrid = document.querySelector("#productGrid");
const priceNote = document.querySelector("#priceNote");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function setRoute(route) {
  Object.entries(views).forEach(([name, element]) => element.classList.toggle("hidden", name !== route));
  if (route === "store") loadProducts();
  if (route === "admin") loadAdmin();
}

function updateNav() {
  const signedIn = Boolean(sessionUser);
  document.querySelectorAll(".signed-in").forEach((item) => item.classList.toggle("hidden", !signedIn));
  document.querySelectorAll(".signed-out").forEach((item) => item.classList.toggle("hidden", signedIn));
  document.querySelectorAll(".admin-only").forEach((item) => item.classList.toggle("hidden", sessionUser?.role !== "admin"));
}

function productImage(product) {
  if (product.imageUrl) {
    return `<div class="product-image"><img src="${product.imageUrl}" alt="${escapeHtml(product.name)}"></div>`;
  }
  return `<div class="product-image">${escapeHtml(product.brand || product.category || "Dealer")}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

async function loadProducts() {
  const data = await api("/api/products");
  priceNote.textContent = data.canSeePrices
    ? "Dealer pricing is visible on your approved account."
    : "Login after approval to see dealer pricing.";
  productGrid.innerHTML = data.products.map((product) => `
    <article class="product-card">
      ${productImage(product)}
      <div class="product-body">
        <div>
          <h2>${escapeHtml(product.name)}</h2>
          <p class="sku">${product.brand ? `${escapeHtml(product.brand)} | ` : ""}${escapeHtml(product.sku)} ${product.category ? `| ${escapeHtml(product.category)}` : ""}</p>
        </div>
        <p>${escapeHtml(product.description)}</p>
        ${product.price ? `<div class="price">${product.price}</div>` : `<div class="locked">Dealer login required for pricing</div>`}
        ${product.price ? `<button class="primary" data-inquire="${product.id}">Request quote</button>` : ""}
      </div>
    </article>
  `).join("");
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
  const data = await api("/api/session");
  sessionUser = data.user;
  updateNav();
}

async function loadAdmin() {
  if (sessionUser?.role !== "admin") return setRoute("store");
  const [summary, users, products, inquiries] = await Promise.all([
    api("/api/admin/summary"),
    api("/api/admin/users"),
    api("/api/admin/products"),
    api("/api/admin/inquiries")
  ]);

  document.querySelector("#adminStats").innerHTML = `
    <div class="stat"><strong>${summary.pendingUsers}</strong>Pending dealers</div>
    <div class="stat"><strong>${summary.products}</strong>Products</div>
    <div class="stat"><strong>${summary.inquiries}</strong>New inquiries</div>
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

  document.querySelector("#adminProducts").innerHTML = products.products.map((product) => `
    <div class="row">
      <div>
        <strong>${escapeHtml(product.name)}</strong>
        <p>${product.brand ? `${escapeHtml(product.brand)} | ` : ""}${escapeHtml(product.sku)} ${product.upc ? `| UPC ${escapeHtml(product.upc)}` : ""} | Qty ${escapeHtml(product.quantityOnHand ?? 0)} | ${product.price} | ${product.active ? "Active" : "Hidden"}</p>
        ${product.sourceUrl ? `<p><a class="source-link" href="${escapeHtml(product.sourceUrl)}" target="_blank" rel="noopener">Source listing</a></p>` : ""}
        <details class="facebook-listing">
          <summary>List on Facebook</summary>
          <textarea readonly rows="9" id="facebookListing${product.id}">${escapeHtml(facebookListingText(product))}</textarea>
          <div class="row-actions">
            <button type="button" data-copy-facebook="${product.id}">Copy listing text</button>
            ${product.imageUrl ? `<a class="source-link" href="${escapeHtml(product.imageUrl)}" target="_blank" rel="noopener">Open image</a>` : ""}
          </div>
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
}

document.addEventListener("click", async (event) => {
  const route = event.target.closest("[data-route]")?.dataset.route;
  if (route) setRoute(route);

  const userId = event.target.closest("[data-user]")?.dataset.user;
  const status = event.target.closest("[data-status]")?.dataset.status;
  if (userId && status) {
    await api(`/api/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    loadAdmin();
  }

  const productId = event.target.closest("[data-inquire]")?.dataset.inquire;
  if (productId) {
    await api("/api/inquiries", {
      method: "POST",
      body: JSON.stringify({ productId, quantity: 1 })
    });
    event.target.textContent = "Request sent";
    event.target.disabled = true;
  }

  const comparisonId = event.target.closest("[data-delete-comparison]")?.dataset.deleteComparison;
  if (comparisonId) {
    await api(`/api/admin/comparisons/${comparisonId}`, { method: "DELETE" });
    loadAdmin();
    loadProducts();
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
});

document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#loginMessage");
  try {
    const form = new FormData(event.target);
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form))
    });
    sessionUser = data.user;
    updateNav();
    setRoute(sessionUser.role === "admin" ? "admin" : "store");
  } catch (error) {
    message.textContent = error.message;
  }
});

document.querySelector("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#registerMessage");
  try {
    const form = new FormData(event.target);
    const data = await api("/api/register", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form))
    });
    message.textContent = data.message;
    event.target.reset();
  } catch (error) {
    message.textContent = error.message;
  }
});

document.querySelector("#importUrlForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#importUrlMessage");
  const submitButton = event.target.querySelector("button[type='submit']");
  message.textContent = "";
  submitButton.disabled = true;
  submitButton.textContent = "Importing...";
  try {
    const body = Object.fromEntries(new FormData(event.target));
    const data = await api("/api/admin/import-url", {
      method: "POST",
      body: JSON.stringify(body)
    });
    event.target.reset();
    message.textContent = data.imported.savedImage ? "Imported with image saved." : "Imported. No image was available to save.";
    await loadAdmin();
    await loadProducts();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Import URL";
  }
});

document.querySelector("#productForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#productMessage");
  const submitButton = event.target.querySelector("button[type='submit']");
  message.textContent = "";
  submitButton.disabled = true;
  submitButton.textContent = "Adding...";
  const form = new FormData(event.target);
  try {
    await api("/api/admin/products", { method: "POST", body: form });
    event.target.reset();
    message.textContent = "Product added.";
    await loadAdmin();
    await loadProducts();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Add product";
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-comparison-form]");
  if (!form) return;
  event.preventDefault();
  const productId = form.dataset.comparisonForm;
  const body = Object.fromEntries(new FormData(form));
  await api(`/api/admin/products/${productId}/comparisons`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  form.reset();
  loadAdmin();
  loadProducts();
});

document.querySelector("#logoutButton").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
  sessionUser = null;
  updateNav();
  setRoute("store");
});

loadSession().then(loadProducts);

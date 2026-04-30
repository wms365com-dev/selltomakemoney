const catalogGrid = document.querySelector("#catalogGrid");
const catalogStatus = document.querySelector("#catalogStatus");
const catalogSearch = document.querySelector("#catalogSearch");
const catalogCategory = document.querySelector("#catalogCategory");
let catalogProducts = [];
let catalogRotatorTimer = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function productImage(product) {
  const imageUrls = [...new Set([...(product.imageUrls || []), product.imageUrl].filter(Boolean))];
  const imageUrl = imageUrls[0];
  if (imageUrls.length > 1) {
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

function startImageRotators() {
  if (catalogRotatorTimer) {
    clearInterval(catalogRotatorTimer);
    catalogRotatorTimer = null;
  }
  const rotators = [...document.querySelectorAll("[data-image-rotator]")].map((rotator) => ({
    images: [...rotator.querySelectorAll("img")],
    index: 0
  })).filter((rotator) => rotator.images.length > 1);
  if (!rotators.length) return;
  catalogRotatorTimer = setInterval(() => {
    rotators.forEach((rotator) => {
      rotator.images[rotator.index].classList.remove("active");
      rotator.index = (rotator.index + 1) % rotator.images.length;
      rotator.images[rotator.index].classList.add("active");
    });
  }, 3200);
}

function productText(product) {
  return [product.name, product.brand, product.sku, product.upc, product.category, product.description].join(" ").toLowerCase();
}

function shoppingLinksBlock(product) {
  if (!product.searchLinks?.length) return "";
  return `
    <div class="shopping-links" aria-label="Compare on other sites">
      ${product.searchLinks.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.site)}</a>`).join("")}
    </div>
  `;
}

function renderCategories(products) {
  const categories = [...new Set(products.map((product) => product.category).filter(Boolean))].sort();
  catalogCategory.innerHTML = `<option value="">All categories</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
}

function renderCatalog() {
  const search = catalogSearch.value.trim().toLowerCase();
  const category = catalogCategory.value;
  const filtered = catalogProducts.filter((product) => {
    const matchesSearch = !search || productText(product).includes(search);
    const matchesCategory = !category || product.category === category;
    return matchesSearch && matchesCategory;
  });

  catalogGrid.innerHTML = filtered.length ? filtered.map((product) => `
    <article class="product-card catalog-card">
      ${productImage(product)}
      <div class="product-body">
        <div>
          <h2>${escapeHtml(product.name)}</h2>
          <p class="sku">${product.brand ? `${escapeHtml(product.brand)} | ` : ""}${escapeHtml(product.sku)} ${product.category ? `| ${escapeHtml(product.category)}` : ""}</p>
        </div>
        <p>${escapeHtml(product.description)}</p>
        <div class="locked">Dealer login required for pricing</div>
        ${shoppingLinksBlock(product)}
        <a class="nav-button primary" href="/mobile#register">Request access</a>
      </div>
    </article>
  `).join("") : `<div class="panel empty-catalog"><h2>No matching items</h2><p>Try another search or category.</p></div>`;
  startImageRotators();
}

async function loadCatalog() {
  try {
    const response = await fetch("/api/products");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load catalog.");
    catalogProducts = data.products || [];
    renderCategories(catalogProducts);
    renderCatalog();
  } catch (error) {
    catalogGrid.innerHTML = `<div class="panel empty-catalog"><h2>Catalog unavailable</h2><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    catalogStatus.classList.add("hidden");
  }
}

catalogSearch.addEventListener("input", renderCatalog);
catalogCategory.addEventListener("change", renderCatalog);
loadCatalog();

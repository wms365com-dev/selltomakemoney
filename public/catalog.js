const catalogGrid = document.querySelector("#catalogGrid");
const catalogStatus = document.querySelector("#catalogStatus");
const catalogSearch = document.querySelector("#catalogSearch");
const catalogCategory = document.querySelector("#catalogCategory");
let catalogProducts = [];
let catalogRotatorTimer = null;
const initialCatalogSearch = new URLSearchParams(window.location.search).get("search") || "";
if (initialCatalogSearch) catalogSearch.value = initialCatalogSearch;

document.querySelectorAll("[data-year]").forEach((node) => {
  node.textContent = new Date().getFullYear();
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function absoluteUrl(path) {
  return new URL(path || "/", window.location.origin).toString();
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

function fulfillmentBadge(product) {
  const canShip = product.productSpecs?.fulfillmentType === "ships_or_pickup";
  return `<div class="fulfillment-alert ${canShip ? "ships" : "pickup"}">${canShip ? "Ships or Mississauga pickup" : "Mississauga pickup only"}</div>`;
}

function updateCatalogStructuredData(products) {
  document.querySelector("#catalogStructuredData")?.remove();
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.id = "catalogStructuredData";
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
          <h2><a class="product-title-link" href="${escapeHtml(product.url || `/products/${product.id}`)}">${escapeHtml(product.name)}</a></h2>
          <p class="sku">${product.brand ? `${escapeHtml(product.brand)} | ` : ""}${escapeHtml(product.sku)} ${product.category ? `| ${escapeHtml(product.category)}` : ""}</p>
        </div>
        <p>${escapeHtml(product.description)}</p>
        ${productSpecsSummary(product)}
        ${fulfillmentBadge(product)}
        <div class="price">${escapeHtml(product.price || "$0.00")}</div>
        ${shoppingLinksBlock(product)}
        <div class="product-actions">
          <a class="nav-button primary" href="/mobile#cart">Checkout</a>
          <button type="button" data-copy-share="${product.id}" data-copy-url="${escapeHtml(absoluteUrl(product.shortUrl || product.url || `/products/${product.id}`))}">Share</button>
          <a class="nav-button" href="${escapeHtml(product.url || `/products/${product.id}`)}">Details</a>
        </div>
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
    updateCatalogStructuredData(catalogProducts);
    renderCatalog();
  } catch (error) {
    catalogGrid.innerHTML = `<div class="panel empty-catalog"><h2>Catalog unavailable</h2><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    catalogStatus.classList.add("hidden");
  }
}

catalogSearch.addEventListener("input", renderCatalog);
catalogCategory.addEventListener("change", renderCatalog);
document.addEventListener("click", async (event) => {
  const productId = event.target.closest("[data-copy-share]")?.dataset.copyShare;
  const catalogButton = event.target.closest("#copyCatalogLink");
  if (!productId && !catalogButton) return;
  const shareButton = event.target.closest("[data-copy-share]");
  const product = catalogProducts.find((entry) => Number(entry.id) === Number(productId));
  const url = catalogButton ? absoluteUrl("/s/catalog") : (shareButton?.dataset.copyUrl || absoluteUrl(product?.shortUrl || product?.url || `/products/${productId}`));
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
  const button = event.target.closest("button");
  const original = button.textContent;
  button.textContent = "Copied";
  setTimeout(() => { button.textContent = original; }, 900);
});
loadCatalog();

const path = require("path");
const fs = require("fs");
const dns = require("dns").promises;
const net = require("net");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const cheerio = require("cheerio");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, "uploads");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "store.json");
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || "replace-this-before-production";
const ADMIN_EMAIL = "k.prathab@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "DealerStore!2026";
const AMAZON_AFFILIATE_TAG = process.env.AMAZON_AFFILIATE_TAG || "dealerstore-20";
const PRODUCT_CATEGORIES = [
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

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function dollars(cents, currency = "CAD") {
  if (cents == null) return null;
  return `${currency === "USD" ? "US$" : "$"}${(Number(cents) / 100).toFixed(2)}`;
}

function slugSearch(product) {
  return encodeURIComponent(product.upc || product.sku || `${product.name} ${product.description || ""}`.trim());
}

function amazonSearchUrl(query) {
  const tag = encodeURIComponent(AMAZON_AFFILIATE_TAG);
  return `https://www.amazon.com/s?k=${query}&tag=${tag}`;
}

function searchLinks(product) {
  const query = slugSearch(product);
  return [
    { site: "Google Shopping", url: `https://www.google.com/search?tbm=shop&q=${query}` },
    { site: "Amazon", url: amazonSearchUrl(query) },
    { site: "Walmart", url: `https://www.walmart.com/search?q=${query}` },
    { site: "eBay", url: `https://www.ebay.com/sch/i.html?_nkw=${query}` }
  ];
}

function isPrivateAddress(address) {
  if (!address) return true;
  if (net.isIPv6(address)) return address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:");
  if (!net.isIPv4(address)) return true;
  const parts = address.split(".").map(Number);
  return parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254) ||
    parts[0] === 0;
}

async function assertSafeImportUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    throw new Error("Paste a valid listing URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only http and https listing URLs are supported.");
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local")) throw new Error("Local/private URLs cannot be imported.");
  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Local/private URLs cannot be imported.");
  }
  return parsed;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "selltomakemoney.com Importer/1.0 (+https://selltomakemoney.com)",
        "accept": "text/html,application/xhtml+xml"
      }
    });
    if (!response.ok) throw new Error(`The listing page returned ${response.status}.`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      throw new Error("That URL did not return an HTML listing page.");
    }
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function asText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return asText(value[0]);
  if (typeof value === "object") return asText(value.name || value.value || value["@id"]);
  return String(value).trim();
}

function asImage(value) {
  if (!value) return "";
  if (Array.isArray(value)) return asImage(value[0]);
  if (typeof value === "object") return asText(value.url || value.contentUrl);
  return asText(value);
}

function flattenJsonLd(node, output = []) {
  if (!node) return output;
  if (Array.isArray(node)) {
    node.forEach((item) => flattenJsonLd(item, output));
    return output;
  }
  if (typeof node !== "object") return output;
  output.push(node);
  if (node["@graph"]) flattenJsonLd(node["@graph"], output);
  return output;
}

function productFromJsonLd($) {
  const nodes = [];
  $('script[type="application/ld+json"]').each((_index, element) => {
    try {
      flattenJsonLd(JSON.parse($(element).contents().text()), nodes);
    } catch (_error) {
      // Ignore malformed structured data from third-party pages.
    }
  });
  return nodes.find((node) => {
    const type = node["@type"];
    return Array.isArray(type) ? type.includes("Product") : type === "Product";
  }) || null;
}

function metaContent($, selectors) {
  for (const selector of selectors) {
    const value = $(selector).attr("content") || $(selector).attr("value");
    if (value) return value.trim();
  }
  return "";
}

function parseCents(value) {
  const text = asText(value).replace(/,/g, "");
  const match = text.match(/(\d+(?:\.\d{1,2})?)/);
  if (!match) return 0;
  return Math.round(Number(match[1]) * 100);
}

function extractListing(html, listingUrl) {
  const $ = cheerio.load(html);
  const structured = productFromJsonLd($);
  const offers = Array.isArray(structured?.offers) ? structured.offers[0] : structured?.offers;
  const title = asText(structured?.name) || metaContent($, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) || $("title").first().text().trim();
  const description = asText(structured?.description) || metaContent($, ['meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]']);
  const image = asImage(structured?.image) || metaContent($, ['meta[property="og:image"]', 'meta[name="twitter:image"]']);
  const priceCents = parseCents(offers?.price || metaContent($, ['meta[property="product:price:amount"]', 'meta[name="price"]']));
  const currency = asText(offers?.priceCurrency) || metaContent($, ['meta[property="product:price:currency"]']) || "CAD";
  const brand = asText(structured?.brand);
  const sku = asText(structured?.sku || structured?.mpn);
  const upc = asText(structured?.gtin12 || structured?.gtin13 || structured?.gtin14 || structured?.gtin || structured?.upc);
  const category = asText(structured?.category);
  return {
    name: title.slice(0, 180),
    brand: brand.slice(0, 120),
    sku: sku.slice(0, 80),
    upc: upc.slice(0, 40),
    category: category.slice(0, 120),
    description: description.slice(0, 1200),
    priceCents,
    currency: currency.toUpperCase().slice(0, 3),
    remoteImageUrl: image ? new URL(image, listingUrl).toString() : "",
    sourceUrl: listingUrl
  };
}

function parseRecommendedAddonIds(value, productId = 0) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .flatMap((item) => String(item || "").split(","))
    .map((item) => Number(item))
    .filter((id) => Number.isInteger(id) && id > 0 && id !== Number(productId)))];
}

function cleanUpc(value) {
  const upc = String(value || "").replace(/\D/g, "");
  if (upc.length < 8 || upc.length > 14) throw new Error("Enter a valid UPC, EAN, or GTIN.");
  return upc;
}

function decodeSearchUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.hostname.includes("duckduckgo.com") && parsed.searchParams.get("uddg")) {
      return parsed.searchParams.get("uddg");
    }
    return parsed.toString();
  } catch (_error) {
    return "";
  }
}

async function searchListingsByUpc(upc) {
  const query = encodeURIComponent(`${upc} product`);
  const searchUrl = `https://duckduckgo.com/html/?q=${query}`;
  const seen = new Set();
  const candidates = [];

  const addSearchCandidates = (html, selectors, blockedHosts = []) => {
    const $ = cheerio.load(html);
    selectors.forEach((selector) => {
      $(selector).each((_index, element) => {
        const href = decodeSearchUrl($(element).attr("href") || "");
        if (!href || seen.has(href)) return;
        let parsed;
        try {
          parsed = new URL(href);
        } catch (_error) {
          return;
        }
        if (!["http:", "https:"].includes(parsed.protocol)) return;
        if (blockedHosts.some((host) => parsed.hostname.includes(host))) return;
        seen.add(href);
        candidates.push({
          url: href,
          site: parsed.hostname.replace(/^www\./, ""),
          title: $(element).text().replace(/\s+/g, " ").trim().slice(0, 180)
        });
      });
    });
  };

  try {
    addSearchCandidates(await fetchText(searchUrl), [".result__a", "a.result__url", "a[href]"], ["duckduckgo.com"]);
  } catch (_error) {
    // Search providers can throttle automated requests; fall back to another public search page.
  }
  if (!candidates.length) {
    try {
      addSearchCandidates(await fetchText(`https://www.bing.com/search?q=${query}`), ["li.b_algo h2 a", "a[href]"], ["bing.com", "microsoft.com"]);
    } catch (_error) {
      // Manual marketplace links are still returned below.
    }
  }

  const enriched = [];
  for (const candidate of candidates.slice(0, 8)) {
    let listing = null;
    try {
      const pageHtml = await fetchText(candidate.url);
      listing = extractListing(pageHtml, candidate.url);
    } catch (_error) {
      listing = null;
    }
    enriched.push({
      ...candidate,
      name: listing?.name || candidate.title || candidate.site,
      brand: listing?.brand || "",
      sku: listing?.sku || "",
      upc: listing?.upc || upc,
      description: listing?.description || "",
      price: listing?.priceCents ? dollars(listing.priceCents, listing.currency) : "",
      imageUrl: listing?.remoteImageUrl || "",
      importable: Boolean(listing?.name)
    });
  }
  return {
    upc,
    searchUrl,
    candidates: enriched,
    searchLinks: [
      { site: "Google Shopping", url: `https://www.google.com/search?tbm=shop&q=${query}` },
      { site: "Amazon", url: amazonSearchUrl(query) },
      { site: "Walmart", url: `https://www.walmart.com/search?q=${query}` },
      { site: "eBay", url: `https://www.ebay.com/sch/i.html?_nkw=${query}` }
    ]
  };
}

async function downloadImage(imageUrl) {
  if (!imageUrl) return "";
  const parsed = await assertSafeImportUrl(imageUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(parsed, {
      signal: controller.signal,
      headers: { "user-agent": "selltomakemoney.com Importer/1.0" }
    });
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return "";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024) return "";
    const typeExt = contentType.split(";")[0].split("/")[1] || "";
    const urlExt = path.extname(parsed.pathname).replace(".", "");
    const ext = (urlExt || typeExt || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5);
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), bytes);
    return `/uploads/${filename}`;
  } finally {
    clearTimeout(timeout);
  }
}

function emptyJsonStore() {
  return {
    nextIds: { users: 1, products: 1, inquiries: 1, comparisons: 1, orders: 1, alertLeads: 1, bugReports: 1 },
    users: [],
    products: [],
    inquiries: [],
    comparisons: [],
    orders: [],
    alertLeads: [],
    bugReports: []
  };
}

function readJsonStore() {
  if (!fs.existsSync(DB_PATH)) return emptyJsonStore();
  const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  data.nextIds.comparisons ||= 1;
  data.nextIds.orders ||= 1;
  data.nextIds.alertLeads ||= 1;
  data.nextIds.bugReports ||= 1;
  data.comparisons ||= [];
  data.orders ||= [];
  data.alertLeads ||= [];
  data.bugReports ||= [];
  data.products = data.products.map((product) => ({
    brand: "",
    upc: "",
    sourceUrl: "",
    quantityOnHand: 0,
    productSpecs: product.productSpecs || {},
    dealerPriceCents: product.dealerPriceCents ?? null,
    imageUrls: product.imageUrls || (product.imageUrl ? [product.imageUrl] : []),
    recommendedAddonIds: product.recommendedAddonIds || [],
    ...product
  }));
  return data;
}

function writeJsonStore(store) {
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2));
}

function createJsonDatabase() {
  const store = readJsonStore();

  function insert(collection, row) {
    const id = store.nextIds[collection]++;
    const record = { id, createdAt: new Date().toISOString(), ...row };
    store[collection].push(record);
    writeJsonStore(store);
    return record;
  }

  return {
    type: "json",
    async init() {},
    async seedAdmin() {
      if (store.users.some((user) => user.email === ADMIN_EMAIL)) return;
      insert("users", {
        email: ADMIN_EMAIL,
        passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 12),
        company: "Owner",
        contactName: "K. Prathab",
        phone: "",
        status: "approved",
        role: "admin"
      });
    },
    async seedProducts() {
      if (store.products.length) return;
      seedProductRows().forEach((product) => insert("products", product));
    },
    async getUserById(id) {
      return store.users.find((user) => user.id === Number(id)) || null;
    },
    async getUserByEmail(email) {
      return store.users.find((user) => user.email === email) || null;
    },
    async createUser(user) {
      return insert("users", user);
    },
    async createAlertLead(lead) {
      const cleanEmail = String(lead.email || "").toLowerCase().trim();
      const existing = store.alertLeads.find((item) => item.email === cleanEmail);
      if (existing) {
        Object.assign(existing, { ...lead, email: cleanEmail, updatedAt: new Date().toISOString() });
        writeJsonStore(store);
        return existing;
      }
      return insert("alertLeads", { ...lead, email: cleanEmail, status: "new" });
    },
    async listAlertLeads() {
      return [...store.alertLeads].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    },
    async createBugReport(report) {
      return insert("bugReports", { ...report, status: "new" });
    },
    async listBugReports() {
      return [...store.bugReports].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    },
    async listUsers() {
      return [...store.users].map((user) => {
        const orders = store.orders.filter((order) => Number(order.userId) === Number(user.id));
        const lastOrder = orders.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
        return {
          ...user,
          orderCount: orders.length,
          returningCustomer: orders.length > 1,
          lastOrderAt: lastOrder?.createdAt || "",
          totalSpentCents: orders.reduce((sum, order) => sum + Number(order.subtotalCents || 0), 0)
        };
      }).sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
    },
    async updateUserStatus(id, status) {
      const user = store.users.find((item) => item.id === Number(id) && item.role !== "admin");
      if (!user) return null;
      user.status = status;
      writeJsonStore(store);
      return user;
    },
    async listProducts({ activeOnly = false } = {}) {
      const products = store.products.filter((product) => !activeOnly || product.active);
      return products.sort((a, b) => b.id - a.id);
    },
    async getProduct(id) {
      return store.products.find((product) => product.id === Number(id)) || null;
    },
    async getProductsByIds(ids, { activeOnly = false } = {}) {
      const orderedIds = ids.map(Number);
      const wanted = new Set(orderedIds);
      return store.products
        .filter((product) => wanted.has(Number(product.id)) && (!activeOnly || product.active))
        .sort((a, b) => orderedIds.indexOf(Number(a.id)) - orderedIds.indexOf(Number(b.id)));
    },
    async createProduct(product) {
      return insert("products", product);
    },
    async updateProduct(id, updates) {
      const product = store.products.find((item) => item.id === Number(id));
      if (!product) return null;
      Object.assign(product, updates);
      writeJsonStore(store);
      return product;
    },
    async listComparisons(productId) {
      return store.comparisons.filter((comparison) => comparison.productId === Number(productId)).sort((a, b) => a.priceCents - b.priceCents);
    },
    async createComparison(comparison) {
      return insert("comparisons", comparison);
    },
    async deleteComparison(id) {
      const index = store.comparisons.findIndex((comparison) => comparison.id === Number(id));
      if (index === -1) return false;
      store.comparisons.splice(index, 1);
      writeJsonStore(store);
      return true;
    },
    async createInquiry(inquiry) {
      return insert("inquiries", inquiry);
    },
    async listInquiries() {
      return store.inquiries.map((inquiry) => {
        const user = store.users.find((item) => item.id === inquiry.userId) || {};
        const product = store.products.find((item) => item.id === inquiry.productId) || {};
        return { ...inquiry, email: user.email || "", company: user.company || "", productName: product.name || "", sku: product.sku || "" };
      }).sort((a, b) => b.id - a.id);
    },
    async createOrder(order) {
      const created = insert("orders", { status: "new", ...order });
      for (const item of order.items || []) {
        const product = store.products.find((entry) => Number(entry.id) === Number(item.productId));
        if (!product) continue;
        const previousQty = Math.max(0, Math.floor(Number(product.quantityOnHand || 0)));
        const nextQty = Math.max(0, previousQty - Math.max(1, Math.floor(Number(item.quantity || 1))));
        product.quantityOnHand = nextQty;
        product.productSpecs = appendStockHistory(product.productSpecs || {}, previousQty, nextQty, `checkout #${created.id}`);
      }
      writeJsonStore(store);
      return created;
    },
    async listOrders() {
      return store.orders.map((order) => {
        const user = store.users.find((item) => item.id === order.userId) || {};
        const customerOrders = store.orders
          .filter((item) => Number(item.userId) === Number(order.userId))
          .sort((a, b) => Number(a.id) - Number(b.id));
        const orderIndex = customerOrders.findIndex((item) => Number(item.id) === Number(order.id));
        return {
          ...order,
          email: user.email || "",
          company: user.company || "",
          contactName: user.contactName || "",
          customerOrderCount: customerOrders.length,
          previousOrderCount: Math.max(0, orderIndex),
          returningCustomer: orderIndex > 0,
          customerTotalSpentCents: customerOrders.reduce((sum, item) => sum + Number(item.subtotalCents || 0), 0)
        };
      }).sort((a, b) => b.id - a.id);
    },
    async summary() {
      return {
        pendingUsers: store.users.filter((user) => user.status === "pending").length,
        products: store.products.length,
        inquiries: store.inquiries.filter((inquiry) => inquiry.status === "new").length,
        orders: store.orders.filter((order) => order.status === "new").length,
        alertLeads: store.alertLeads.length,
        bugReports: store.bugReports.filter((report) => report.status === "new").length,
        returningCustomers: new Set(store.orders.map((order) => order.userId).filter((userId) => store.orders.filter((order) => order.userId === userId).length > 1)).size
      };
    }
  };
}

function camelUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    company: row.company,
    contactName: row.contact_name,
    phone: row.phone,
    status: row.status,
    role: row.role,
    createdAt: row.created_at
  };
}

function camelAlertLead(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name || row.firstName || "",
    lastName: row.last_name || row.lastName || "",
    contactName: row.contact_name,
    phone: row.phone,
    interests: row.interests,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function camelBugReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    priority: row.priority,
    title: row.title,
    details: row.details,
    pageUrl: row.page_url || row.pageUrl || "",
    email: row.email,
    userId: row.user_id || row.userId || null,
    userEmail: row.user_email || row.userEmail || "",
    status: row.status,
    createdAt: row.created_at || row.createdAt
  };
}

function camelProduct(row) {
  if (!row) return null;
  let imageUrls = [];
  let recommendedAddonIds = [];
  try {
    imageUrls = JSON.parse(row.image_urls || "[]");
  } catch (_error) {
    imageUrls = [];
  }
  try {
    recommendedAddonIds = JSON.parse(row.recommended_addon_ids || "[]").map(Number).filter(Boolean);
  } catch (_error) {
    recommendedAddonIds = [];
  }
  if (!imageUrls.length && row.image_url) imageUrls = [row.image_url];
  let productSpecs = {};
  try {
    productSpecs = JSON.parse(row.product_specs || "{}");
  } catch (_error) {
    productSpecs = {};
  }
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    upc: row.upc,
    category: row.category,
    brand: row.brand,
    description: row.description,
    priceCents: row.price_cents,
    dealerPriceCents: row.dealer_price_cents,
    imageUrl: row.image_url,
    imageUrls,
    sourceUrl: row.source_url,
    quantityOnHand: row.quantity_on_hand,
    productSpecs,
    recommendedAddonIds,
    active: row.active,
    createdAt: row.created_at
  };
}

function camelComparison(row) {
  if (!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    site: row.site,
    title: row.title,
    priceCents: row.price_cents,
    currency: row.currency,
    productUrl: row.product_url,
    matchType: row.match_type,
    checkedAt: row.checked_at,
    createdAt: row.created_at
  };
}

function camelOrder(row) {
  if (!row) return null;
  const parseJson = (value, fallback) => {
    if (value == null) return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  };
  return {
    id: row.id,
    userId: row.user_id,
    items: parseJson(row.items, []),
    shipTo: parseJson(row.ship_to, {}),
    subtotalCents: row.subtotal_cents,
    status: row.status,
    note: row.note,
    createdAt: row.created_at
  };
}

function createPostgresDatabase() {
  const useSsl = process.env.PGSSLMODE !== "disable" && !DATABASE_URL.includes(".railway.internal");
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : false
  });

  async function query(sql, params = []) {
    const result = await pool.query(sql, params);
    return result;
  }

  async function migrateFromJsonIfEmpty() {
    if (!fs.existsSync(DB_PATH)) return;
    const productCount = Number((await query("SELECT COUNT(*) AS count FROM products")).rows[0].count);
    const userCount = Number((await query("SELECT COUNT(*) AS count FROM users")).rows[0].count);
    if (productCount || userCount > 1) return;
    const old = readJsonStore();
    for (const user of old.users) {
      await query(`
        INSERT INTO users (id, email, password_hash, company, contact_name, phone, status, role, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (email) DO NOTHING
      `, [user.id, user.email, user.passwordHash, user.company, user.contactName, user.phone, user.status, user.role, user.createdAt || new Date()]);
    }
    for (const product of old.products) {
      await query(`
        INSERT INTO products (id, name, sku, upc, brand, category, description, price_cents, dealer_price_cents, image_url, image_urls, source_url, quantity_on_hand, product_specs, active, recommended_addon_ids, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (id) DO NOTHING
      `, [
        product.id,
        product.name,
        product.sku,
        product.upc || "",
        product.brand || "",
        product.category,
        product.description,
        product.priceCents,
        product.dealerPriceCents ?? null,
        product.imageUrl,
        JSON.stringify(product.imageUrls || (product.imageUrl ? [product.imageUrl] : [])),
        product.sourceUrl || "",
        product.quantityOnHand || 0,
        JSON.stringify(product.productSpecs || {}),
        product.active,
        JSON.stringify(product.recommendedAddonIds || []),
        product.createdAt || new Date()
      ]);
    }
    for (const inquiry of old.inquiries) {
      await query(`
        INSERT INTO inquiries (id, user_id, product_id, quantity, note, status, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id) DO NOTHING
      `, [inquiry.id, inquiry.userId, inquiry.productId, inquiry.quantity, inquiry.note, inquiry.status, inquiry.createdAt || new Date()]);
    }
    for (const comparison of old.comparisons || []) {
      await query(`
        INSERT INTO price_comparisons (id, product_id, site, title, price_cents, currency, product_url, match_type, checked_at, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO NOTHING
      `, [comparison.id, comparison.productId, comparison.site, comparison.title, comparison.priceCents, comparison.currency, comparison.productUrl, comparison.matchType, comparison.checkedAt, comparison.createdAt || new Date()]);
    }
    for (const order of old.orders || []) {
      await query(`
        INSERT INTO orders (id, user_id, items, ship_to, subtotal_cents, status, note, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO NOTHING
      `, [order.id, order.userId, JSON.stringify(order.items || []), JSON.stringify(order.shipTo || {}), order.subtotalCents || 0, order.status || "new", order.note || "", order.createdAt || new Date()]);
    }
    await query("SELECT setval('users_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM users), 1), 1))");
    await query("SELECT setval('products_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM products), 1), 1))");
    await query("SELECT setval('inquiries_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM inquiries), 1), 1))");
    await query("SELECT setval('price_comparisons_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM price_comparisons), 1), 1))");
    await query("SELECT setval('orders_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM orders), 1), 1))");
  }

  return {
    type: "postgres",
    async init() {
      await query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          company TEXT NOT NULL DEFAULT '',
          contact_name TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          role TEXT NOT NULL DEFAULT 'dealer',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          sku TEXT NOT NULL DEFAULT '',
          upc TEXT NOT NULL DEFAULT '',
          brand TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          price_cents INTEGER NOT NULL DEFAULT 0,
          dealer_price_cents INTEGER,
          image_url TEXT NOT NULL DEFAULT '',
          image_urls TEXT NOT NULL DEFAULT '[]',
          source_url TEXT NOT NULL DEFAULT '',
          quantity_on_hand INTEGER NOT NULL DEFAULT 0,
          product_specs TEXT NOT NULL DEFAULT '{}',
          recommended_addon_ids TEXT NOT NULL DEFAULT '[]',
          active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS inquiries (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id),
          product_id INTEGER NOT NULL REFERENCES products(id),
          quantity INTEGER NOT NULL DEFAULT 1,
          note TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'new',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS price_comparisons (
          id SERIAL PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          site TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          price_cents INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'CAD',
          product_url TEXT NOT NULL DEFAULT '',
          match_type TEXT NOT NULL DEFAULT 'description',
          checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id),
          items JSONB NOT NULL DEFAULT '[]',
          ship_to JSONB NOT NULL DEFAULT '{}',
          subtotal_cents INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'new',
          note TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS alert_leads (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          first_name TEXT NOT NULL DEFAULT '',
          last_name TEXT NOT NULL DEFAULT '',
          contact_name TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          interests TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'store',
          status TEXT NOT NULL DEFAULT 'new',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS bug_reports (
          id SERIAL PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'bug',
          priority TEXT NOT NULL DEFAULT 'normal',
          title TEXT NOT NULL,
          details TEXT NOT NULL,
          page_url TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          user_id INTEGER REFERENCES users(id),
          user_email TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'new',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_products_upc ON products(upc);
        ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT '';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS image_urls TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS source_url TEXT NOT NULL DEFAULT '';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS quantity_on_hand INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE products ADD COLUMN IF NOT EXISTS product_specs TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS dealer_price_cents INTEGER;
        ALTER TABLE products ADD COLUMN IF NOT EXISTS recommended_addon_ids TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE alert_leads ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '';
        ALTER TABLE alert_leads ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '';
        CREATE INDEX IF NOT EXISTS idx_products_search ON products USING gin(to_tsvector('english', name || ' ' || description || ' ' || sku || ' ' || upc || ' ' || brand));
        CREATE INDEX IF NOT EXISTS idx_price_comparisons_product ON price_comparisons(product_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_alert_leads_created ON alert_leads(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON bug_reports(created_at DESC);
      `);
      await migrateFromJsonIfEmpty();
    },
    async seedAdmin() {
      const existing = await this.getUserByEmail(ADMIN_EMAIL);
      if (existing) return;
      await query(`
        INSERT INTO users (email, password_hash, company, contact_name, status, role)
        VALUES ($1,$2,'Owner','K. Prathab','approved','admin')
      `, [ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 12)]);
    },
    async seedProducts() {
      const count = Number((await query("SELECT COUNT(*) AS count FROM products")).rows[0].count);
      if (count) return;
      for (const product of seedProductRows()) await this.createProduct(product);
    },
    async getUserById(id) {
      return camelUser((await query("SELECT * FROM users WHERE id = $1", [id])).rows[0]);
    },
    async getUserByEmail(email) {
      return camelUser((await query("SELECT * FROM users WHERE email = $1", [email])).rows[0]);
    },
    async createUser(user) {
      const result = await query(`
        INSERT INTO users (email, password_hash, company, contact_name, phone, status, role)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
      `, [user.email, user.passwordHash, user.company, user.contactName, user.phone, user.status, user.role]);
      return camelUser(result.rows[0]);
    },
    async createAlertLead(lead) {
      const result = await query(`
        INSERT INTO alert_leads (email, first_name, last_name, contact_name, phone, interests, source, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'new')
        ON CONFLICT (email) DO UPDATE SET
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          contact_name = EXCLUDED.contact_name,
          phone = EXCLUDED.phone,
          interests = EXCLUDED.interests,
          source = EXCLUDED.source,
          updated_at = NOW()
        RETURNING *
      `, [lead.email, lead.firstName, lead.lastName, lead.contactName, lead.phone, lead.interests, lead.source]);
      return camelAlertLead(result.rows[0]);
    },
    async listAlertLeads() {
      return (await query("SELECT * FROM alert_leads ORDER BY updated_at DESC, created_at DESC LIMIT 200")).rows.map(camelAlertLead);
    },
    async createBugReport(report) {
      const result = await query(`
        INSERT INTO bug_reports (type, priority, title, details, page_url, email, user_id, user_email, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'new') RETURNING *
      `, [report.type, report.priority, report.title, report.details, report.pageUrl, report.email, report.userId, report.userEmail]);
      return camelBugReport(result.rows[0]);
    },
    async listBugReports() {
      return (await query("SELECT * FROM bug_reports ORDER BY created_at DESC LIMIT 200")).rows.map(camelBugReport);
    },
    async listUsers() {
      return (await query(`
        SELECT users.*,
          COALESCE(customer_orders.order_count, 0)::int AS "orderCount",
          COALESCE(customer_orders.total_spent_cents, 0)::int AS "totalSpentCents",
          customer_orders.last_order_at AS "lastOrderAt",
          (COALESCE(customer_orders.order_count, 0) > 1) AS "returningCustomer"
        FROM users
        LEFT JOIN (
          SELECT user_id, COUNT(*) AS order_count, SUM(subtotal_cents) AS total_spent_cents, MAX(created_at) AS last_order_at
          FROM orders
          GROUP BY user_id
        ) customer_orders ON customer_orders.user_id = users.id
        ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, created_at DESC
      `)).rows.map((row) => ({ ...camelUser(row), orderCount: row.orderCount, totalSpentCents: row.totalSpentCents, lastOrderAt: row.lastOrderAt, returningCustomer: row.returningCustomer }));
    },
    async updateUserStatus(id, status) {
      const result = await query("UPDATE users SET status = $1 WHERE id = $2 AND role != 'admin' RETURNING *", [status, id]);
      return camelUser(result.rows[0]);
    },
    async listProducts({ activeOnly = false } = {}) {
      const result = await query(`SELECT * FROM products ${activeOnly ? "WHERE active = true" : ""} ORDER BY id DESC`);
      return result.rows.map(camelProduct);
    },
    async getProduct(id) {
      return camelProduct((await query("SELECT * FROM products WHERE id = $1", [id])).rows[0]);
    },
    async getProductsByIds(ids, { activeOnly = false } = {}) {
      if (!ids.length) return [];
      const result = await query(
        `SELECT * FROM products WHERE id = ANY($1::int[]) ${activeOnly ? "AND active = true" : ""}`,
        [ids]
      );
      const byId = new Map(result.rows.map((row) => [Number(row.id), camelProduct(row)]));
      return ids.map(Number).map((id) => byId.get(id)).filter(Boolean);
    },
    async createProduct(product) {
      const result = await query(`
        INSERT INTO products (name, sku, upc, brand, category, description, price_cents, dealer_price_cents, image_url, image_urls, source_url, quantity_on_hand, product_specs, active, recommended_addon_ids)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *
      `, [
        product.name,
        product.sku,
        product.upc,
        product.brand,
        product.category,
        product.description,
        product.priceCents,
        product.dealerPriceCents ?? null,
        product.imageUrl,
        JSON.stringify(product.imageUrls || (product.imageUrl ? [product.imageUrl] : [])),
        product.sourceUrl || "",
        product.quantityOnHand || 0,
        JSON.stringify(product.productSpecs || {}),
        product.active,
        JSON.stringify(product.recommendedAddonIds || [])
      ]);
      return camelProduct(result.rows[0]);
    },
    async updateProduct(id, product) {
      const result = await query(`
        UPDATE products SET name=$1, sku=$2, upc=$3, brand=$4, category=$5, description=$6, price_cents=$7, dealer_price_cents=$8, image_url=$9, image_urls=$10, source_url=$11, quantity_on_hand=$12, product_specs=$13, active=$14, recommended_addon_ids=$15
        WHERE id=$16 RETURNING *
      `, [
        product.name,
        product.sku,
        product.upc,
        product.brand,
        product.category,
        product.description,
        product.priceCents,
        product.dealerPriceCents ?? null,
        product.imageUrl,
        JSON.stringify(product.imageUrls || (product.imageUrl ? [product.imageUrl] : [])),
        product.sourceUrl || "",
        product.quantityOnHand || 0,
        JSON.stringify(product.productSpecs || {}),
        product.active,
        JSON.stringify(product.recommendedAddonIds || []),
        id
      ]);
      return camelProduct(result.rows[0]);
    },
    async listComparisons(productId) {
      const result = await query("SELECT * FROM price_comparisons WHERE product_id = $1 ORDER BY price_cents ASC, site ASC", [productId]);
      return result.rows.map(camelComparison);
    },
    async createComparison(comparison) {
      const result = await query(`
        INSERT INTO price_comparisons (product_id, site, title, price_cents, currency, product_url, match_type, checked_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *
      `, [comparison.productId, comparison.site, comparison.title, comparison.priceCents, comparison.currency, comparison.productUrl, comparison.matchType]);
      return camelComparison(result.rows[0]);
    },
    async deleteComparison(id) {
      const result = await query("DELETE FROM price_comparisons WHERE id = $1", [id]);
      return result.rowCount > 0;
    },
    async createInquiry(inquiry) {
      const result = await query(`
        INSERT INTO inquiries (user_id, product_id, quantity, note, status)
        VALUES ($1,$2,$3,$4,'new') RETURNING *
      `, [inquiry.userId, inquiry.productId, inquiry.quantity, inquiry.note]);
      return result.rows[0];
    },
    async listInquiries() {
      return (await query(`
        SELECT inquiries.id, inquiries.quantity, inquiries.note, inquiries.status, inquiries.created_at AS "createdAt",
               users.email, users.company, products.name AS "productName", products.sku
        FROM inquiries
        JOIN users ON users.id = inquiries.user_id
        JOIN products ON products.id = inquiries.product_id
        ORDER BY inquiries.id DESC
      `)).rows;
    },
    async createOrder(order) {
      const result = await query(`
        INSERT INTO orders (user_id, items, ship_to, subtotal_cents, status, note)
        VALUES ($1,$2,$3,$4,'new',$5) RETURNING *
      `, [order.userId, JSON.stringify(order.items), JSON.stringify(order.shipTo), order.subtotalCents, order.note]);
      const created = camelOrder(result.rows[0]);
      for (const item of order.items || []) {
        const existing = await this.getProduct(Number(item.productId));
        if (!existing) continue;
        const previousQty = Math.max(0, Math.floor(Number(existing.quantityOnHand || 0)));
        const nextQty = Math.max(0, previousQty - Math.max(1, Math.floor(Number(item.quantity || 1))));
        await query(
          "UPDATE products SET quantity_on_hand = $1, product_specs = $2 WHERE id = $3",
          [nextQty, JSON.stringify(appendStockHistory(existing.productSpecs || {}, previousQty, nextQty, `checkout #${created.id}`)), existing.id]
        );
      }
      return created;
    },
    async listOrders() {
      return (await query(`
        SELECT orders.*, users.email, users.company, users.contact_name AS "contactName",
          COUNT(*) OVER (PARTITION BY orders.user_id)::int AS "customerOrderCount",
          (ROW_NUMBER() OVER (PARTITION BY orders.user_id ORDER BY orders.id ASC) - 1)::int AS "previousOrderCount",
          SUM(orders.subtotal_cents) OVER (PARTITION BY orders.user_id)::int AS "customerTotalSpentCents"
        FROM orders
        JOIN users ON users.id = orders.user_id
        ORDER BY orders.id DESC
      `)).rows.map((row) => ({
        ...camelOrder(row),
        email: row.email,
        company: row.company,
        contactName: row.contactName,
        customerOrderCount: row.customerOrderCount,
        previousOrderCount: row.previousOrderCount,
        returningCustomer: Number(row.previousOrderCount || 0) > 0,
        customerTotalSpentCents: row.customerTotalSpentCents
      }));
    },
    async summary() {
      const result = await query(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE status = 'pending')::int AS "pendingUsers",
          (SELECT COUNT(*) FROM products)::int AS products,
          (SELECT COUNT(*) FROM inquiries WHERE status = 'new')::int AS inquiries,
          (SELECT COUNT(*) FROM orders WHERE status = 'new')::int AS orders,
          (SELECT COUNT(*) FROM alert_leads)::int AS "alertLeads",
          (SELECT COUNT(*) FROM bug_reports WHERE status = 'new')::int AS "bugReports",
          (SELECT COUNT(*) FROM (SELECT user_id FROM orders GROUP BY user_id HAVING COUNT(*) > 1) returning_customers)::int AS "returningCustomers"
      `);
      return result.rows[0];
    }
  };
}

function seedProductRows() {
  return [
    { name: "Dealer Starter Kit", sku: "DSK-100", upc: "", brand: "House Brand", category: "Other", description: "A ready-to-sell bundle for new dealer accounts.", priceCents: 19900, imageUrl: "", imageUrls: [], sourceUrl: "", quantityOnHand: 0, recommendedAddonIds: [], active: true },
    { name: "Premium Inventory Pack", sku: "PIP-250", upc: "", brand: "House Brand", category: "Warehouse & Storage", description: "Higher-margin product mix for established dealers.", priceCents: 54900, imageUrl: "", imageUrls: [], sourceUrl: "", quantityOnHand: 0, recommendedAddonIds: [], active: true },
    { name: "Display Sample Set", sku: "DSS-050", upc: "", brand: "House Brand", category: "Home & Office", description: "Showroom samples and sell sheets for in-person selling.", priceCents: 8900, imageUrl: "", imageUrls: [], sourceUrl: "", quantityOnHand: 0, recommendedAddonIds: [], active: true }
  ];
}

const db = DATABASE_URL ? createPostgresDatabase() : createJsonDatabase();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
  }),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 12
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Only image uploads are allowed."));
    cb(null, true);
  }
});

function uploadedImageUrls(req) {
  const files = Object.values(req.files || {}).flat();
  if (req.file) files.push(req.file);
  return files.map((file) => `/uploads/${file.filename}`);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use("/uploads", express.static(UPLOAD_DIR, {
  etag: true,
  setHeaders: (res) => res.setHeader("Cache-Control", "public, max-age=604800")
}));
app.use(express.static(path.join(ROOT, "public"), {
  index: false,
  etag: true,
  setHeaders: (res) => res.setHeader("Cache-Control", "public, max-age=3600")
}));

function isMobileRequest(req) {
  const ua = req.get("user-agent") || "";
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
}

function sendApp(_req, res) {
  res.sendFile(path.join(ROOT, "public", "index.html"));
}

function sendCatalog(_req, res) {
  res.sendFile(path.join(ROOT, "public", "catalog.html"));
}

function sendDealers(_req, res) {
  res.sendFile(path.join(ROOT, "public", "dealers.html"));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function productSlug(product) {
  const base = [product.brand, product.name, product.sku || product.upc]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return base || `product-${product.id}`;
}

function productPath(product) {
  return `/products/${product.id}/${productSlug(product)}`;
}

function shortProductPath(product) {
  return `/s/p/${product.id}`;
}

function publicBaseUrl(req) {
  return process.env.PUBLIC_SITE_URL || (req.get("host")?.includes("localhost") ? `${req.protocol}://${req.get("host")}` : "https://selltomakemoney.com");
}

app.get("/robots.txt", (req, res) => {
  const baseUrl = publicBaseUrl(req).replace(/\/$/, "");
  res.type("text/plain").send([
    "User-agent: *",
    "Allow: /",
    `Sitemap: ${baseUrl}/sitemap.xml`,
    ""
  ].join("\n"));
});

app.get("/sitemap.xml", async (req, res) => {
  const baseUrl = publicBaseUrl(req).replace(/\/$/, "");
  const products = await db.listProducts({ activeOnly: true });
  const urls = ["", "/catalog", "/s/catalog", "/dealers", "/desktop", "/mobile", ...products.flatMap((product) => [productPath(product), shortProductPath(product)])];
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${baseUrl}${url}</loc><changefreq>${url.startsWith("/products/") ? "weekly" : "daily"}</changefreq><priority>${url === "" ? "1.0" : url.startsWith("/products/") ? "0.7" : "0.8"}</priority></url>`).join("\n")}
</urlset>`);
});

app.get("/s/catalog", (_req, res) => {
  res.redirect(302, "/catalog");
});

app.get("/s/p/:id", async (req, res) => {
  const product = await db.getProduct(Number(req.params.id));
  if (!product || !product.active) return res.redirect(302, "/catalog");
  res.redirect(302, productPath(product));
});

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    company: user.company,
    contactName: user.contactName,
    phone: user.phone,
    status: user.status,
    role: user.role,
    canSeePrices: user.status === "approved"
  };
}

function productSpecsLines(product) {
  const specs = publicProductSpecs(product.productSpecs || {});
  const dimensions = [specs.length, specs.width, specs.height].filter(Boolean).join(" x ");
  return [
    product.brand ? ["Brand", product.brand] : null,
    product.sku ? ["SKU", product.sku] : null,
    product.upc ? ["UPC", product.upc] : null,
    product.category ? ["Category", product.category] : null,
    specs.model ? ["Model", specs.model] : null,
    specs.condition ? ["Condition", specs.condition] : null,
    specs.color ? ["Color", specs.color] : null,
    specs.material ? ["Material", specs.material] : null,
    specs.fulfillmentType ? ["Fulfillment", fulfillmentLabel(specs.fulfillmentType)] : null,
    dimensions ? ["Dimensions", `${dimensions} ${specs.dimensionUnit || ""}`.trim()] : null,
    specs.weight ? ["Weight", `${specs.weight} ${specs.weightUnit || ""}`.trim()] : null
  ].filter(Boolean);
}

function fulfillmentLabel(value) {
  return value === "ships_or_pickup" ? "Shipping or Mississauga pickup" : "Mississauga pickup only";
}

function publicProductSpecs(specs = {}) {
  const hiddenKeys = new Set(["cost", "sourceNotes", "stockHistory", "listingStatus", "marketplaceStatus"]);
  return Object.fromEntries(Object.entries(specs || {}).filter(([key]) => !hiddenKeys.has(key)));
}

function productJsonLd(product, canonicalUrl, imageUrl) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    sku: product.sku || undefined,
    gtin12: product.upc || undefined,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    category: product.category || undefined,
    image: imageUrl || undefined,
    offers: {
      "@type": "Offer",
      priceCurrency: "CAD",
      price: (Number(product.priceCents || 0) / 100).toFixed(2),
      availability: "https://schema.org/InStock",
      url: canonicalUrl
    }
  });
}

function safeJsonScript(json) {
  return json.replaceAll("<", "\\u003c");
}

async function sendProductPage(req, res) {
  const product = await db.getProduct(Number(req.params.id));
  if (!product || !product.active) return res.status(404).send("Product not found.");
  const baseUrl = publicBaseUrl(req).replace(/\/$/, "");
  const canonicalPath = productPath(product);
  const canonicalUrl = `${baseUrl}${canonicalPath}`;
  const shortUrl = `${baseUrl}${shortProductPath(product)}`;
  const currentYear = new Date().getFullYear();
  const mainImage = (product.imageUrls?.[0] || product.imageUrl || "");
  const absoluteImage = mainImage ? new URL(mainImage, baseUrl).toString() : "";
  const price = dollars(product.priceCents);
  const title = `${product.name} | ${price} | selltomakemoney.com`;
  const description = `${product.brand ? `${product.brand} ` : ""}${product.name}. ${product.description || "Available from selltomakemoney.com."}`.slice(0, 155);
  const specs = productSpecsLines(product);
  const fulfillmentType = product.productSpecs?.fulfillmentType || "pickup_only";
  const fulfillmentText = fulfillmentLabel(fulfillmentType);
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="keywords" content="${escapeHtml([product.name, product.brand, product.sku, product.upc, product.category, "selltomakemoney", "Mississauga pickup", "inventory deals"].filter(Boolean).join(", "))}">
  <meta name="robots" content="index,follow">
  <meta name="geo.region" content="CA-ON">
  <meta name="geo.placename" content="Mississauga">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="product">
  <meta property="og:site_name" content="selltomakemoney.com">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  ${absoluteImage ? `<meta property="og:image" content="${escapeHtml(absoluteImage)}">` : ""}
  <meta name="twitter:card" content="${absoluteImage ? "summary_large_image" : "summary"}">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  ${absoluteImage ? `<meta name="twitter:image" content="${escapeHtml(absoluteImage)}">` : ""}
  <title>${escapeHtml(title)}</title>
  <script type="application/ld+json">${safeJsonScript(productJsonLd(product, canonicalUrl, absoluteImage))}</script>
  <link rel="stylesheet" href="/styles.css?v=sell-share-tools-1">
</head>
<body>
  <header class="topbar catalog-topbar">
    <a class="brand" href="/desktop" aria-label="selltomakemoney.com home"><img src="/assets/logo.svg?v=sell-share-tools-1" alt="selltomakemoney.com"></a>
    <nav><a class="nav-button" href="/desktop">Store</a><a class="nav-button" href="/catalog">Catalog</a><a class="nav-button primary" href="/desktop#cart">Checkout</a></nav>
  </header>
  <main>
    <article class="product-detail">
      <div class="product-detail-media">
        ${mainImage ? `<img src="${escapeHtml(mainImage)}" alt="${escapeHtml(product.name)}" loading="eager" decoding="async">` : `<div class="product-image">${escapeHtml(product.brand || product.category || "Product")}</div>`}
      </div>
      <section class="product-detail-body">
        <p class="eyebrow">${escapeHtml(product.category || "Available inventory")}</p>
        <h1>${escapeHtml(product.name)}</h1>
        <p class="sku">${escapeHtml([product.brand, product.sku, product.upc ? `UPC ${product.upc}` : ""].filter(Boolean).join(" | "))}</p>
        <div class="price">${escapeHtml(price)}</div>
        <div class="fulfillment-alert ${fulfillmentType === "ships_or_pickup" ? "ships" : "pickup"}">${escapeHtml(fulfillmentText)}</div>
        <p>${escapeHtml(product.description)}</p>
        ${specs.length ? `<dl class="product-spec-list">${specs.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : ""}
        <div class="checkout-notice">
          <strong>Checkout requires an account.</strong>
          <span>Pickup orders use e-transfer or cash to keep fees down. Credit card is available only for eligible shipped items.</span>
        </div>
        <div class="catalog-actions">
          <a class="nav-button primary" href="/desktop">Open store to add to cart</a>
          <button class="nav-button" type="button" onclick="navigator.clipboard?.writeText('${escapeHtml(shortUrl)}');this.textContent='Copied link';">Copy short link</button>
          <a class="nav-button" href="/catalog">Browse catalog</a>
        </div>
      </section>
    </article>
  </main>
  <footer class="site-footer">
    <div>
      <strong>selltomakemoney.com</strong>
      <span>Public deals, Mississauga pickup, and select shippable inventory.</span>
    </div>
    <div>Copyright &copy; ${currentYear} selltomakemoney.com. All rights reserved.</div>
  </footer>
</body>
</html>`);
}

async function currentUser(req) {
  if (!req.session.userId) return null;
  return db.getUserById(req.session.userId);
}

async function requireLogin(req, res, next) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "Please login first." });
  req.user = user;
  next();
}

async function requireAdmin(req, res, next) {
  const user = await currentUser(req);
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Admin access required." });
  req.user = user;
  next();
}

async function productPayload(product, showPrice, includeAdminData = false) {
  const normalizedCategory = normalizeCategory(product.category, { fallback: "Other" });
  const payload = {
    id: product.id,
    url: productPath(product),
    shortUrl: shortProductPath(product),
    name: product.name,
    sku: product.sku,
    upc: product.upc,
    brand: product.brand,
    category: normalizedCategory,
    description: product.description,
    imageUrl: product.imageUrl,
    imageUrls: product.imageUrls || (product.imageUrl ? [product.imageUrl] : []),
    productSpecs: includeAdminData ? (product.productSpecs || {}) : publicProductSpecs(product.productSpecs || {}),
    active: Boolean(product.active),
    recommendedAddonIds: product.recommendedAddonIds || [],
    priceCents: product.priceCents,
    price: dollars(product.priceCents),
    dealerPriceCents: showPrice ? product.dealerPriceCents : null,
    dealerPrice: showPrice ? dollars(product.dealerPriceCents) : null,
    searchLinks: searchLinks(product)
  };
  const recommendedAddons = await db.getProductsByIds(product.recommendedAddonIds || [], { activeOnly: !includeAdminData });
  payload.recommendedAddons = recommendedAddons.map((addon) => ({
    id: addon.id,
    name: addon.name,
    sku: addon.sku,
    brand: addon.brand,
    imageUrl: addon.imageUrl,
    imageUrls: addon.imageUrls || (addon.imageUrl ? [addon.imageUrl] : []),
    price: dollars(addon.priceCents),
    dealerPrice: showPrice ? dollars(addon.dealerPriceCents) : null
  }));
  if (!includeAdminData) return payload;
  const comparisons = await db.listComparisons(product.id);
  return {
    ...payload,
    sourceUrl: product.sourceUrl || "",
    quantityOnHand: product.quantityOnHand || 0,
    comparisons: comparisons.map((comparison) => ({
      id: comparison.id,
      site: comparison.site,
      title: comparison.title,
      priceCents: comparison.priceCents,
      price: dollars(comparison.priceCents, comparison.currency),
      currency: comparison.currency,
      productUrl: comparison.productUrl,
      matchType: comparison.matchType,
      checkedAt: comparison.checkedAt
    }))
  };
}

function cleanRequired(value, label, max = 180) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text.slice(0, max);
}

function cleanOptional(value, max = 600) {
  return String(value || "").trim().slice(0, max);
}

function cleanSpec(value, max = 80) {
  return String(value || "").trim().slice(0, max);
}

function normalizeCategory(value, { fallback = "", required = false } = {}) {
  const raw = cleanSpec(value || fallback, 120);
  const exact = PRODUCT_CATEGORIES.find((category) => category.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  if (!raw) {
    if (required) throw new Error("Choose a category for this item.");
    return "";
  }
  const text = raw.toLowerCase();
  const rules = [
    ["Scooters & Mobility", /\b(scooter|bike|bicycle|mobility|wheelchair|segway|hoverboard)\b/],
    ["Tools & Hardware", /\b(tool|drill|saw|wrench|hardware|compressor|ladder|generator)\b/],
    ["Electronics", /\b(electronic|computer|laptop|tablet|phone|camera|tv|audio|speaker|monitor|console)\b/],
    ["Home & Office", /\b(office|desk|chair|home|decor|kitchen|bath|household)\b/],
    ["Furniture", /\b(furniture|sofa|table|cabinet|shelf|dresser|mattress|bed)\b/],
    ["Appliances", /\b(appliance|fridge|freezer|washer|dryer|microwave|oven|dishwasher|vacuum)\b/],
    ["Automotive", /\b(auto|automotive|car|truck|tire|wheel|battery|garage)\b/],
    ["Warehouse & Storage", /\b(warehouse|storage|rack|shelving|pallet|bin|tote|material handling)\b/],
    ["Safety", /\b(safety|ppe|vest|cone|traffic|first aid|helmet|glove)\b/],
    ["Janitorial", /\b(janitorial|cleaning|mop|broom|sanitizer|trash|garbage)\b/],
    ["Clothing & Accessories", /\b(clothing|shirt|pants|jacket|shoes|boots|accessory|bag)\b/],
    ["Toys & Games", /\b(toy|game|kids|children|puzzle|lego)\b/]
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] || "Other";
}

function inferCategoryFromListing(listing) {
  return normalizeCategory([listing.category, listing.name, listing.description, listing.brand].filter(Boolean).join(" "));
}

function cleanCondition(value, fallback = "") {
  const normalized = cleanSpec(value || fallback);
  const aliases = {
    bnib: "Brand New In Box (BNIB)",
    "brand new in box": "Brand New In Box (BNIB)",
    "brand new in box (bnib)": "Brand New In Box (BNIB)",
    opr: "Open Box / Refurbished (OP/R)",
    "op/r": "Open Box / Refurbished (OP/R)",
    "open box": "Open Box / Refurbished (OP/R)",
    refurbished: "Open Box / Refurbished (OP/R)",
    "open box / refurbished (op/r)": "Open Box / Refurbished (OP/R)",
    u: "Used (U)",
    used: "Used (U)",
    "used (u)": "Used (U)"
  };
  return aliases[normalized.toLowerCase()] || normalized;
}

function centsFromInput(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : fallback;
}

function productSpecsFromBody(body, fallback = {}) {
  const existingHistory = Array.isArray(fallback.stockHistory) ? fallback.stockHistory : [];
  const specs = {
    length: cleanSpec(body.length ?? fallback.length),
    width: cleanSpec(body.width ?? fallback.width),
    height: cleanSpec(body.height ?? fallback.height),
    dimensionUnit: cleanSpec(body.dimensionUnit ?? fallback.dimensionUnit ?? "in", 12),
    weight: cleanSpec(body.weight ?? fallback.weight),
    weightUnit: cleanSpec(body.weightUnit ?? fallback.weightUnit ?? "lb", 12),
    color: cleanSpec(body.color ?? fallback.color),
    material: cleanSpec(body.material ?? fallback.material),
    model: cleanSpec(body.model ?? fallback.model),
    condition: cleanCondition(body.condition, fallback.condition),
    fulfillmentType: ["pickup_only", "ships_or_pickup"].includes(cleanSpec(body.fulfillmentType ?? fallback.fulfillmentType)) ? cleanSpec(body.fulfillmentType ?? fallback.fulfillmentType) : "pickup_only",
    cost: cleanSpec(body.cost ?? fallback.cost),
    sourceNotes: cleanSpec(body.sourceNotes ?? fallback.sourceNotes, 500),
    listingStatus: cleanSpec(body.listingStatus ?? fallback.listingStatus ?? "draft", 40),
    marketplaceStatus: cleanSpec(body.marketplaceStatus ?? fallback.marketplaceStatus ?? "not_listed", 40),
    stockHistory: existingHistory
  };
  return Object.fromEntries(Object.entries(specs).filter(([, value]) => Array.isArray(value) ? value.length : value));
}

function appendStockHistory(specs = {}, previousQty, nextQty, reason = "adjusted") {
  const history = Array.isArray(specs.stockHistory) ? specs.stockHistory.slice(-24) : [];
  if (Number(previousQty) !== Number(nextQty)) {
    history.push({
      at: new Date().toISOString(),
      from: Math.max(0, Math.floor(Number(previousQty || 0))),
      to: Math.max(0, Math.floor(Number(nextQty || 0))),
      reason
    });
  }
  return { ...specs, stockHistory: history };
}

async function buildOrder(req) {
  const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
  if (!rawItems.length) throw new Error("Add at least one item to the cart.");
  const quantitiesByProduct = new Map();
  for (const item of rawItems) {
    const productId = Number(item.productId);
    const quantity = Math.max(1, Math.min(999, Math.floor(Number(item.quantity || 1))));
    if (Number.isInteger(productId) && productId > 0) {
      quantitiesByProduct.set(productId, (quantitiesByProduct.get(productId) || 0) + quantity);
    }
  }
  if (!quantitiesByProduct.size) throw new Error("Cart items are invalid.");
  const products = await db.getProductsByIds([...quantitiesByProduct.keys()], { activeOnly: true });
  if (products.length !== quantitiesByProduct.size) throw new Error("One or more cart items are no longer available.");
  const allItemsCanShip = products.every((product) => product.productSpecs?.fulfillmentType === "ships_or_pickup");
  const items = products.map((product) => {
    const quantity = quantitiesByProduct.get(Number(product.id));
    return {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      upc: product.upc,
      brand: product.brand,
      quantity,
      unitPriceCents: product.priceCents,
      lineTotalCents: product.priceCents * quantity
    };
  });
  const ship = req.body.shipTo || {};
  const fulfillmentMethod = cleanRequired(ship.fulfillmentMethod, "Fulfillment method", 40);
  const paymentMethod = cleanRequired(ship.paymentMethod, "Payment method", 40);
  if (!["ship", "pickup"].includes(fulfillmentMethod)) throw new Error("Choose shipping or customer pickup.");
  if (!["etransfer", "cash_pickup", "credit_card"].includes(paymentMethod)) throw new Error("Choose e-transfer, cash on pickup, or credit card for eligible shipped items.");
  if (paymentMethod === "cash_pickup" && fulfillmentMethod !== "pickup") throw new Error("Cash payment is only available for customer pickup in Mississauga.");
  if (fulfillmentMethod === "ship" && !allItemsCanShip) throw new Error("This cart includes pickup-only items. Remove pickup-only items or choose Mississauga pickup.");
  if (paymentMethod === "credit_card" && (fulfillmentMethod !== "ship" || !allItemsCanShip)) {
    throw new Error("Credit card is available only for shipped orders where every item can be shipped.");
  }
  const shipTo = {
    fulfillmentMethod,
    paymentMethod,
    pickupLocation: fulfillmentMethod === "pickup" ? "Mississauga, Ontario" : "",
    recipientName: cleanRequired(ship.recipientName, "Recipient name"),
    company: cleanRequired(ship.company, "Company"),
    phone: cleanRequired(ship.phone, "Phone", 60),
    email: cleanRequired(ship.email, "Email", 160),
    address1: cleanRequired(ship.address1, "Address line 1"),
    address2: cleanOptional(ship.address2, 180),
    city: cleanRequired(ship.city, "City", 120),
    region: cleanRequired(ship.region, "Province/state", 120),
    postalCode: cleanRequired(ship.postalCode, "Postal/ZIP code", 40),
    country: cleanRequired(ship.country, "Country", 80),
    deliveryWindow: cleanRequired(ship.deliveryWindow, "Preferred delivery or pickup window", 160),
    receivingInstructions: cleanRequired(ship.receivingInstructions, "Receiving or pickup instructions", 700),
    liftgateRequired: Boolean(ship.liftgateRequired),
    residentialAddress: Boolean(ship.residentialAddress),
    contactBeforeDelivery: Boolean(ship.contactBeforeDelivery)
  };
  return {
    userId: req.user.id,
    items,
    shipTo,
    subtotalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0),
    note: cleanOptional(req.body.note, 1000)
  };
}

app.get("/api/session", async (req, res) => {
  res.json({ user: publicUser(await currentUser(req)) });
});

app.post("/api/register", async (req, res) => {
  const { email, password, company, contactName, phone } = req.body;
  if (!email || !password || !company || !contactName) {
    return res.status(400).json({ error: "Email, password, company, and contact name are required." });
  }
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  const cleanEmail = email.toLowerCase().trim();
  if (await db.getUserByEmail(cleanEmail)) return res.status(409).json({ error: "That email is already registered." });
  await db.createUser({
    email: cleanEmail,
    passwordHash: await bcrypt.hash(password, 12),
    company: company.trim(),
    contactName: contactName.trim(),
    phone: (phone || "").trim(),
    status: "pending",
    role: "dealer"
  });
  res.status(201).json({ ok: true, message: "Registration sent. You can login after admin approval." });
});

app.post("/api/alerts", async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    const firstName = cleanRequired(req.body.firstName, "First name", 80);
    const lastName = cleanRequired(req.body.lastName, "Last name", 80);
    const fallbackContactName = cleanOptional(req.body.contactName, 160);
    const contactName = [firstName, lastName].filter(Boolean).join(" ") || fallbackContactName;
    const phone = cleanOptional(req.body.phone, 80);
    const interests = cleanOptional(req.body.interests, 500);
    const source = cleanOptional(req.body.source || "store", 80);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email for alerts." });
    }
    await db.createAlertLead({ email, firstName, lastName, contactName, phone, interests, source });
    res.status(201).json({ ok: true, message: "You are on the alert list. We will send updates when new items are available." });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not save alert signup." });
  }
});

app.post("/api/bug-reports", async (req, res) => {
  try {
    const user = await currentUser(req);
    const type = ["bug", "feature", "usability"].includes(cleanOptional(req.body.type, 40)) ? cleanOptional(req.body.type, 40) : "bug";
    const priority = ["low", "normal", "high"].includes(cleanOptional(req.body.priority, 40)) ? cleanOptional(req.body.priority, 40) : "normal";
    const report = await db.createBugReport({
      type,
      priority,
      title: cleanRequired(req.body.title, "Title", 160),
      details: cleanRequired(req.body.details, "Details", 2000),
      pageUrl: cleanOptional(req.body.pageUrl, 500),
      email: cleanOptional(req.body.email || user?.email || "", 160).toLowerCase(),
      userId: user?.id || null,
      userEmail: user?.email || ""
    });
    res.status(201).json({ ok: true, id: report.id, message: "Thanks. The report has been saved for admin review." });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not save report." });
  }
});

app.post("/api/login", async (req, res) => {
  const user = await db.getUserByEmail(String(req.body.email || "").toLowerCase().trim());
  if (!user || !(await bcrypt.compare(req.body.password || "", user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/products", async (req, res) => {
  const user = await currentUser(req);
  const showPrice = Boolean(user && user.status === "approved");
  const products = await db.listProducts({ activeOnly: true });
  res.json({ products: await Promise.all(products.map((product) => productPayload(product, showPrice, false))), canSeePrices: showPrice });
});

app.post("/api/inquiries", requireLogin, async (req, res) => {
  if (req.user.status !== "approved") return res.status(403).json({ error: "Your account is still pending approval." });
  const productId = Number(req.body.productId);
  const product = await db.getProduct(productId);
  if (!product || !product.active) return res.status(404).json({ error: "Product not found." });
  await db.createInquiry({
    userId: req.user.id,
    productId,
    quantity: Math.max(1, Number(req.body.quantity || 1)),
    note: String(req.body.note || "").trim()
  });
  res.status(201).json({ ok: true });
});

app.post("/api/orders", requireLogin, async (req, res) => {
  try {
    if (req.user.status !== "approved") return res.status(403).json({ error: "Your account is still pending approval." });
    const order = await db.createOrder(await buildOrder(req));
    res.status(201).json({ orderId: order.id });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not submit checkout." });
  }
});

app.get("/api/admin/summary", requireAdmin, async (_req, res) => {
  res.json(await db.summary());
});

app.get("/api/admin/users", requireAdmin, async (_req, res) => {
  const users = (await db.listUsers()).map(({ passwordHash, ...user }) => user);
  res.json({ users });
});

app.get("/api/admin/alert-leads", requireAdmin, async (_req, res) => {
  res.json({ leads: await db.listAlertLeads() });
});

app.get("/api/admin/bug-reports", requireAdmin, async (_req, res) => {
  res.json({ reports: await db.listBugReports() });
});

app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
  if (!["pending", "approved", "rejected"].includes(req.body.status)) return res.status(400).json({ error: "Invalid status." });
  const user = await db.updateUserStatus(Number(req.params.id), req.body.status);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ ok: true });
});

app.get("/api/admin/products", requireAdmin, async (_req, res) => {
  const products = await db.listProducts();
  res.json({ products: await Promise.all(products.map((product) => productPayload(product, true, true))) });
});

const productImageUpload = upload.any();

app.post("/api/admin/products", requireAdmin, productImageUpload, async (req, res) => {
  try {
    if (!req.body.name) return res.status(400).json({ error: "Product name is required." });
    let imageUrls = uploadedImageUrls(req);
    if (!imageUrls.length && req.body.remoteImageUrl) {
      const downloadedImage = await downloadImage(String(req.body.remoteImageUrl || "").trim());
      if (downloadedImage) imageUrls = [downloadedImage];
    }
    const quantityOnHand = Math.max(0, Math.floor(Number(req.body.quantityOnHand || 0)));
    const productSpecs = appendStockHistory(productSpecsFromBody(req.body), 0, quantityOnHand, "created");
    const category = normalizeCategory(req.body.category, { required: true });
    const product = await db.createProduct({
      name: String(req.body.name || "").trim(),
      sku: String(req.body.sku || "").trim(),
      upc: String(req.body.upc || "").trim(),
      brand: String(req.body.brand || "").trim(),
      category,
      description: String(req.body.description || "").trim(),
      priceCents: centsFromInput(req.body.price, 0),
      dealerPriceCents: centsFromInput(req.body.dealerPrice),
      imageUrl: imageUrls[0] || "",
      imageUrls,
      sourceUrl: String(req.body.sourceUrl || "").trim(),
      quantityOnHand,
      productSpecs,
      recommendedAddonIds: parseRecommendedAddonIds(req.body.recommendedAddonIds),
      active: req.body.active !== "false"
    });
    res.status(201).json({ id: product.id });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not add product." });
  }
});

app.patch("/api/admin/products/:id", requireAdmin, productImageUpload, async (req, res) => {
  const existing = await db.getProduct(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: "Product not found." });
  let newImageUrls = uploadedImageUrls(req);
  if (!newImageUrls.length && req.body.remoteImageUrl) {
    const downloadedImage = await downloadImage(String(req.body.remoteImageUrl || "").trim());
    if (downloadedImage) newImageUrls = [downloadedImage];
  }
  const imageUrls = newImageUrls.length ? newImageUrls : (existing.imageUrls || (existing.imageUrl ? [existing.imageUrl] : []));
  const quantityOnHand = Math.max(0, Math.floor(Number(req.body.quantityOnHand ?? existing.quantityOnHand ?? 0)));
  const productSpecs = appendStockHistory(productSpecsFromBody(req.body, existing.productSpecs || {}), existing.quantityOnHand, quantityOnHand);
  const category = normalizeCategory(req.body.category, { fallback: existing.category, required: true });
  const product = await db.updateProduct(existing.id, {
    name: String(req.body.name || existing.name).trim(),
    sku: String(req.body.sku || "").trim(),
    upc: String(req.body.upc || "").trim(),
    brand: String(req.body.brand || "").trim(),
    category,
    description: String(req.body.description || "").trim(),
    priceCents: centsFromInput(req.body.price, existing.priceCents),
    dealerPriceCents: centsFromInput(req.body.dealerPrice, existing.dealerPriceCents),
    imageUrl: imageUrls[0] || "",
    imageUrls,
    sourceUrl: String(req.body.sourceUrl || existing.sourceUrl || "").trim(),
    quantityOnHand,
    productSpecs,
    recommendedAddonIds: parseRecommendedAddonIds(req.body.recommendedAddonIds, existing.id),
    active: req.body.active !== "false"
  });
  res.json({ product: await productPayload(product, true, true) });
});

app.get("/api/admin/upc-lookup", requireAdmin, async (req, res) => {
  try {
    const upc = cleanUpc(req.query.upc);
    res.json(await searchListingsByUpc(upc));
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not search for that UPC." });
  }
});

app.post("/api/admin/import-url", requireAdmin, async (req, res) => {
  try {
    const parsedUrl = await assertSafeImportUrl(String(req.body.url || "").trim());
    const html = await fetchText(parsedUrl.toString());
    const listing = extractListing(html, parsedUrl.toString());
    if (!listing.name) return res.status(422).json({ error: "Could not find enough listing information on that page." });
    listing.category = inferCategoryFromListing(listing);
    res.status(200).json({
      listing,
      imported: {
        remoteImageUrl: listing.remoteImageUrl,
        currency: listing.currency
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not import that listing URL." });
  }
});

app.post("/api/admin/products/:id/comparisons", requireAdmin, async (req, res) => {
  const product = await db.getProduct(Number(req.params.id));
  if (!product) return res.status(404).json({ error: "Product not found." });
  if (!req.body.site || !req.body.price) return res.status(400).json({ error: "Site and price are required." });
  const comparison = await db.createComparison({
    productId: product.id,
    site: String(req.body.site || "").trim(),
    title: String(req.body.title || product.name).trim(),
    priceCents: Math.round(Number(req.body.price || 0) * 100),
    currency: String(req.body.currency || "CAD").trim().toUpperCase(),
    productUrl: String(req.body.productUrl || "").trim(),
    matchType: String(req.body.matchType || (product.upc ? "upc" : "description")).trim()
  });
  res.status(201).json({ comparison });
});

app.delete("/api/admin/comparisons/:id", requireAdmin, async (req, res) => {
  const deleted = await db.deleteComparison(Number(req.params.id));
  if (!deleted) return res.status(404).json({ error: "Comparison not found." });
  res.json({ ok: true });
});

app.get("/api/admin/inquiries", requireAdmin, async (_req, res) => {
  res.json({ inquiries: await db.listInquiries() });
});

app.get("/api/admin/orders", requireAdmin, async (_req, res) => {
  res.json({ orders: await db.listOrders() });
});

app.use("/api", (error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "One or more images is too large. Upload images under 15 MB each."
      : error.message;
    return res.status(400).json({ error: message });
  }
  if (error) {
    return res.status(400).json({ error: error.message || "Request failed." });
  }
  res.status(500).json({ error: "Request failed." });
});

app.get("/", (req, res) => {
  res.redirect(isMobileRequest(req) ? "/mobile" : "/desktop");
});

app.get("/products/:id/:slug?", sendProductPage);
app.get(["/desktop", "/mobile"], sendApp);
app.get("/catalog", sendCatalog);
app.get("/dealers", sendDealers);

app.get("*", sendApp);

async function start() {
  await db.init();
  await db.seedAdmin();
  await db.seedProducts();
  app.listen(PORT, () => {
    console.log(`selltomakemoney.com running at http://localhost:${PORT} using ${db.type} storage`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});

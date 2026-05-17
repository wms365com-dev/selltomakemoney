const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const cheerio = require("cheerio");
const { Pool } = require("pg");
const { createTelegramProjectBot } = require("./lib/telegram-control");

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
const PRODUCT_LISTING_PULL_API_KEY = process.env.PRODUCT_LISTING_PULL_API_KEY || "";
const FACEBOOK_BRIDGE_URL = (process.env.FACEBOOK_BRIDGE_URL || "https://search-bridge-production.up.railway.app").replace(/\/$/, "");
const FACEBOOK_BRIDGE_ADMIN_KEY = process.env.FACEBOOK_BRIDGE_ADMIN_KEY || "";
const FACEBOOK_BRIDGE_DEFAULT_ACCOUNT_ID = process.env.FACEBOOK_BRIDGE_DEFAULT_ACCOUNT_ID || "prathab-personal";
const FACEBOOK_BRIDGE_ACCOUNTS_JSON = process.env.FACEBOOK_BRIDGE_ACCOUNTS_JSON || JSON.stringify([
  { id: "prathab-personal", label: "Prathab Personal", facebookProfileId: process.env.DEFAULT_FACEBOOK_PROFILE_ID || "" }
]);
const VISITOR_COOKIE_NAME = "stm_vid";
const CONSENT_COOKIE_NAME = "stm_consent";
const GOOGLE_SITE_VERIFICATION = process.env.GOOGLE_SITE_VERIFICATION || "";
const GOOGLE_SITE_VERIFICATION_FILE = process.env.GOOGLE_SITE_VERIFICATION_FILE || "";
const GOOGLE_SITE_VERIFICATION_CONTENT = process.env.GOOGLE_SITE_VERIFICATION_CONTENT || "";
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const WHATSAPP_NOTIFY_TO = process.env.WHATSAPP_NOTIFY_TO || "";
const WHATSAPP_TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME || "";
const WHATSAPP_TEMPLATE_LANGUAGE = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_NOTIFY_CHAT_ID = process.env.TELEGRAM_NOTIFY_CHAT_ID || "";
const TELEGRAM_MESSAGE_THREAD_ID = process.env.TELEGRAM_MESSAGE_THREAD_ID || "";
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const TELEGRAM_PROJECT_NAME = process.env.TELEGRAM_PROJECT_NAME || "selltomakemoney.com";
const COUNTRY_NAMES = typeof Intl?.DisplayNames === "function"
  ? new Intl.DisplayNames(["en"], { type: "region" })
  : null;
const CANADA_PROVINCES = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon"
};
const US_STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana",
  IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia"
};
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

function searchQuery(product) {
  const title = String(product.name || "").trim();
  const brand = String(product.brand || "").trim();
  const model = String(product.productSpecs?.model || "").trim();
  const raw = [title, brand && !title.toLowerCase().includes(brand.toLowerCase()) ? brand : "", model]
    .filter(Boolean)
    .join(" ")
    .trim();
  return encodeURIComponent(raw || product.upc || product.sku || `${product.name} ${product.description || ""}`.trim());
}

function extractAmazonAsin(product = {}) {
  const sku = String(product.sku || "").trim().toUpperCase();
  if (/^[A-Z0-9]{10}$/.test(sku)) return sku;
  const sourceUrl = String(product.sourceUrl || "").trim();
  if (!sourceUrl) return "";
  try {
    const parsed = new URL(sourceUrl);
    if (!/amazon\./i.test(parsed.hostname)) return "";
    const asinMatch = parsed.pathname.match(/\/dp\/([A-Z0-9]{10})/i) || parsed.pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i);
    return (asinMatch?.[1] || "").toUpperCase();
  } catch (_error) {
    return "";
  }
}

function amazonSearchUrl(query) {
  const tag = encodeURIComponent(AMAZON_AFFILIATE_TAG);
  return `https://www.amazon.ca/s?k=${query}&tag=${tag}`;
}

function amazonProductUrl(asin) {
  const tag = encodeURIComponent(AMAZON_AFFILIATE_TAG);
  return `https://www.amazon.ca/dp/${encodeURIComponent(asin)}?tag=${tag}`;
}

function searchLinks(product) {
  const query = searchQuery(product);
  const asin = extractAmazonAsin(product);
  return [
    { site: "Amazon", url: asin ? amazonProductUrl(asin) : amazonSearchUrl(query) }
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

function looksLikeAmazonBlockPage(html = "") {
  const text = String(html || "");
  return /opfcaptcha|validateCaptcha|automated access to Amazon data|Continue shopping/i.test(text);
}

function titleCaseWords(value = "") {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function amazonFallbackListing(listingUrl) {
  let parsed;
  try {
    parsed = new URL(listingUrl);
  } catch (_error) {
    return null;
  }
  if (!/amazon\./i.test(parsed.hostname)) return null;
  const asinMatch = parsed.pathname.match(/\/dp\/([A-Z0-9]{10})/i);
  const slugMatch = parsed.pathname.match(/^\/([^/]+)\/dp\//i);
  const rawSlug = slugMatch?.[1] || "";
  const cleanedName = titleCaseWords(rawSlug.replace(/[-_]+/g, " ").trim());
  const brandGuess = cleanedName.split(/\s+/)[0] || "";
  const importedSpecs = listingPullSpecs(payload);
  return {
    name: cleanedName.slice(0, 180) || "Amazon listing",
    brand: brandGuess.slice(0, 120),
    sku: (asinMatch?.[1] || "").slice(0, 80),
    upc: "",
    category: "",
    description: "",
    priceCents: 0,
    currency: "CAD",
    remoteImageUrl: "",
    sourceUrl: listingUrl,
    importWarning: "Amazon blocked live product details. Review the draft and fill in price, UPC, images, and any missing details before saving."
  };
}

function extractListing(html, listingUrl) {
  if (looksLikeAmazonBlockPage(html)) {
    return amazonFallbackListing(listingUrl) || {
      name: "",
      brand: "",
      sku: "",
      upc: "",
      category: "",
      description: "",
      priceCents: 0,
      currency: "CAD",
      remoteImageUrl: "",
      sourceUrl: listingUrl,
      importWarning: "This site blocked live product details. Review the draft and fill in the missing fields before saving."
    };
  }
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

function looksLikeDirectImageUrl(value) {
  const text = String(value || "").trim().toLowerCase();
  return /\.(avif|gif|jpe?g|png|webp)(\?|#|$)/i.test(text);
}

function uniqueUrls(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function parseRemoteImageSources(value) {
  return uniqueUrls(
    String(value || "")
      .split(/\r?\n|,/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

async function extractImageUrlsFromFolderPage(folderUrl) {
  const parsedBase = await assertSafeImportUrl(folderUrl);
  const html = await fetchText(parsedBase.toString());
  const $ = cheerio.load(html);
  const candidates = [];
  const addCandidate = (rawUrl) => {
    if (!rawUrl) return;
    let absolute;
    try {
      absolute = new URL(rawUrl, parsedBase).toString();
    } catch (_error) {
      return;
    }
    if (!looksLikeDirectImageUrl(absolute)) return;
    candidates.push(absolute);
  };
  $("img[src]").each((_index, element) => addCandidate($(element).attr("src")));
  $("a[href]").each((_index, element) => addCandidate($(element).attr("href")));
  return uniqueUrls(candidates).slice(0, 12);
}

async function resolveRemoteImageUrls(value, fallbackSingleUrl = "") {
  const sources = parseRemoteImageSources(value);
  const combined = sources.length ? sources : (fallbackSingleUrl ? [fallbackSingleUrl] : []);
  if (!combined.length) return [];
  if (combined.length === 1 && !looksLikeDirectImageUrl(combined[0])) {
    return extractImageUrlsFromFolderPage(combined[0]);
  }
  const resolved = [];
  for (const source of combined) {
    if (looksLikeDirectImageUrl(source)) {
      resolved.push(source);
      continue;
    }
    const scraped = await extractImageUrlsFromFolderPage(source);
    resolved.push(...scraped);
    if (resolved.length >= 12) break;
  }
  return uniqueUrls(resolved).slice(0, 12);
}

async function downloadedRemoteImageUrls(value, fallbackSingleUrl = "") {
  const remoteUrls = await resolveRemoteImageUrls(value, fallbackSingleUrl);
  const downloaded = [];
  for (const remoteUrl of remoteUrls) {
    const imageUrl = await downloadImage(remoteUrl);
    if (imageUrl) downloaded.push(imageUrl);
    if (downloaded.length >= 12) break;
  }
  return uniqueUrls(downloaded);
}

function slugifyFilePart(value, fallback = "product-image") {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return slug || fallback;
}

function imageUrlToUploadPath(imageUrl) {
  const filename = path.basename(String(imageUrl || ""));
  if (!filename) return "";
  return path.join(UPLOAD_DIR, filename);
}

function resolveSeoImageFilename(productName, version, ext) {
  const base = `${slugifyFilePart(productName)}-v${version}`;
  const safeExt = String(ext || ".jpg").startsWith(".") ? String(ext || ".jpg").toLowerCase() : `.${String(ext || "jpg").toLowerCase()}`;
  let candidate = `${base}${safeExt}`;
  let counter = 2;
  while (fs.existsSync(path.join(UPLOAD_DIR, candidate))) {
    candidate = `${base}-${counter}${safeExt}`;
    counter += 1;
  }
  return candidate;
}

function renameImagesForSeo(imageUrls, productName) {
  return (imageUrls || []).map((imageUrl, index) => {
    const currentPath = imageUrlToUploadPath(imageUrl);
    if (!currentPath || !fs.existsSync(currentPath)) return imageUrl;
    const ext = path.extname(currentPath) || ".jpg";
    const targetFilename = resolveSeoImageFilename(productName, index + 1, ext);
    const targetPath = path.join(UPLOAD_DIR, targetFilename);
    if (currentPath !== targetPath) fs.renameSync(currentPath, targetPath);
    return `/uploads/${targetFilename}`;
  });
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
    bugReports: [],
    siteVisitors: [],
    productViews: [],
    siteVisitEvents: [],
    interactionEvents: []
  };
}

function normalizeAccountType(value, fallback = "shopper") {
  return ["shopper", "dealer", "seller"].includes(String(value || "").trim().toLowerCase())
    ? String(value || "").trim().toLowerCase()
    : fallback;
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
  data.siteVisitors ||= [];
  data.productViews ||= [];
  data.siteVisitEvents ||= [];
  data.interactionEvents ||= [];
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
  data.users = (data.users || []).map((user) => ({
    accountType: user.role === "admin" ? "admin" : normalizeAccountType(user.accountType, user.role === "dealer" ? "dealer" : "shopper"),
    ...user
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
        role: "admin",
        accountType: "admin"
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
    async recordSiteVisit(visitorKey, pathName, userId = null, metadata = {}) {
      const now = new Date().toISOString();
      const existing = store.siteVisitors.find((entry) => entry.visitorKey === visitorKey);
      store.siteVisitEvents.push({
        visitorKey,
        path: pathName || "",
        at: now,
        userId: userId || null,
        ipAddress: metadata.ipAddress || "",
        city: metadata.city || "",
        region: metadata.region || "",
        country: metadata.country || "",
        deviceType: metadata.deviceType || "",
        browserName: metadata.browserName || "",
        osName: metadata.osName || "",
        userAgent: metadata.userAgent || "",
        referrer: metadata.referrer || ""
      });
      if (store.siteVisitEvents.length > 5000) {
        store.siteVisitEvents = store.siteVisitEvents.slice(-5000);
      }
      if (existing) {
        existing.visitCount = Number(existing.visitCount || 0) + 1;
        existing.lastSeenAt = now;
        existing.lastPath = pathName || existing.lastPath || "";
        if (userId && !existing.userId) existing.userId = userId;
        Object.assign(existing, {
          ipAddress: metadata.ipAddress || existing.ipAddress || "",
          city: metadata.city || existing.city || "",
          region: metadata.region || existing.region || "",
          country: metadata.country || existing.country || "",
          deviceType: metadata.deviceType || existing.deviceType || "",
          browserName: metadata.browserName || existing.browserName || "",
          osName: metadata.osName || existing.osName || "",
          userAgent: metadata.userAgent || existing.userAgent || "",
          referrer: metadata.referrer || existing.referrer || ""
        });
        writeJsonStore(store);
        return existing;
      }
      const created = {
        visitorKey,
        visitCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        lastPath: pathName || "",
        userId: userId || null,
        ipAddress: metadata.ipAddress || "",
        city: metadata.city || "",
        region: metadata.region || "",
        country: metadata.country || "",
        deviceType: metadata.deviceType || "",
        browserName: metadata.browserName || "",
        osName: metadata.osName || "",
        userAgent: metadata.userAgent || "",
        referrer: metadata.referrer || ""
      };
      store.siteVisitors.push(created);
      writeJsonStore(store);
      return created;
    },
    async recordProductView(productId, visitorKey, userId = null) {
      const now = new Date().toISOString();
      const existing = store.productViews.find((entry) => Number(entry.productId) === Number(productId) && entry.visitorKey === visitorKey);
      if (existing) {
        existing.viewCount = Number(existing.viewCount || 0) + 1;
        existing.lastSeenAt = now;
        if (userId && !existing.userId) existing.userId = userId;
        writeJsonStore(store);
        return existing;
      }
      const created = {
        productId: Number(productId),
        visitorKey,
        viewCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        userId: userId || null
      };
      store.productViews.push(created);
      writeJsonStore(store);
      return created;
    },
    async getProductMetrics(productIds = []) {
      const wantedIds = productIds.map(Number).filter(Boolean);
      const wanted = new Set(wantedIds);
      return wantedIds.reduce((metrics, productId) => {
        const views = store.productViews.filter((entry) => wanted.has(Number(entry.productId)) && Number(entry.productId) === productId);
        metrics[productId] = {
          viewCount: views.reduce((sum, entry) => sum + Number(entry.viewCount || 0), 0),
          uniqueViewers: views.length
        };
        return metrics;
      }, {});
    },
    async listVisitors({ limit = 10, country = "", deviceType = "", path = "" } = {}) {
      const normalizedCountry = String(country || "").trim().toLowerCase();
      const normalizedDevice = String(deviceType || "").trim().toLowerCase();
      const normalizedPath = String(path || "").trim().toLowerCase();
      return [...store.siteVisitors]
        .filter((visitor) => !normalizedCountry || String(visitor.country || "").toLowerCase().includes(normalizedCountry))
        .filter((visitor) => !normalizedDevice || String(visitor.deviceType || "").toLowerCase() === normalizedDevice)
        .filter((visitor) => !normalizedPath || String(visitor.lastPath || "").toLowerCase().includes(normalizedPath))
        .sort((a, b) => new Date(b.lastSeenAt || b.createdAt || 0) - new Date(a.lastSeenAt || a.createdAt || 0))
        .slice(0, Math.max(1, Number(limit) || 10));
    },
    async visitorAnalytics(filters = {}) {
      const normalizedCountry = String(filters.country || "").trim().toLowerCase();
      const normalizedDevice = String(filters.deviceType || "").trim().toLowerCase();
      const normalizedPath = String(filters.path || "").trim().toLowerCase();
      const now = new Date();
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const filteredEvents = store.siteVisitEvents.filter((event) => {
        if (!normalizedCountry && !normalizedDevice && !normalizedPath) return true;
        if (normalizedCountry && !String(event.country || "").toLowerCase().includes(normalizedCountry)) return false;
        if (normalizedDevice && String(event.deviceType || "").toLowerCase() !== normalizedDevice) return false;
        if (normalizedPath && !String(event.path || "").toLowerCase().includes(normalizedPath)) return false;
        return true;
      });
      const todayEvents = filteredEvents.filter((event) => new Date(event.at || 0).getTime() >= dayStart);
      const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, visits: 0 }));
      todayEvents.forEach((event) => {
        const at = new Date(event.at || 0);
        const hour = Number.isNaN(at.getTime()) ? -1 : at.getHours();
        if (hour >= 0 && hour < 24) hourly[hour].visits += 1;
      });
      return {
        recentVisitors: await this.listVisitors({ ...filters, limit: 10 }),
        todayVisits: todayEvents.length,
        uniqueVisitorsToday: new Set(todayEvents.map((event) => event.visitorKey).filter(Boolean)).size,
        topCountries: Object.entries(todayEvents.reduce((acc, event) => {
          const key = String(event.country || "Unknown");
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([countryName, visits]) => ({ country: countryName, visits })),
        hourly
      };
    },
    async updateVisitorLocation(visitorKey, metadata = {}) {
      const existing = store.siteVisitors.find((entry) => entry.visitorKey === visitorKey);
      if (!existing) return null;
      if (metadata.city) existing.city = metadata.city;
      if (metadata.region) existing.region = metadata.region;
      if (metadata.country) existing.country = metadata.country;
      if (metadata.ipAddress) existing.ipAddress = metadata.ipAddress;
      writeJsonStore(store);
      return existing;
    },
    async recordInteractionEvent(event) {
      const created = {
        id: crypto.randomUUID(),
        type: String(event.type || "").trim(),
        path: String(event.path || "").trim(),
        productId: event.productId ? Number(event.productId) : null,
        label: String(event.label || "").trim(),
        value: String(event.value || "").trim(),
        referrer: String(event.referrer || "").trim(),
        visitorKey: String(event.visitorKey || "").trim(),
        userId: event.userId ? Number(event.userId) : null,
        ipAddress: String(event.ipAddress || "").trim(),
        city: String(event.city || "").trim(),
        region: String(event.region || "").trim(),
        country: String(event.country || "").trim(),
        deviceType: String(event.deviceType || "").trim(),
        browserName: String(event.browserName || "").trim(),
        osName: String(event.osName || "").trim(),
        createdAt: new Date().toISOString()
      };
      store.interactionEvents.push(created);
      if (store.interactionEvents.length > 10000) {
        store.interactionEvents = store.interactionEvents.slice(-10000);
      }
      writeJsonStore(store);
      return created;
    },
    async interactionAnalytics() {
      const now = new Date();
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const todayEvents = store.interactionEvents.filter((event) => new Date(event.createdAt || 0).getTime() >= dayStart);
      const countByType = todayEvents.reduce((acc, event) => {
        const key = String(event.type || "unknown");
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const productCounts = todayEvents.reduce((acc, event) => {
        if (!event.productId) return acc;
        const key = String(event.productId);
        acc[key] ||= { productId: Number(event.productId), interactions: 0, name: String(event.label || "") };
        acc[key].interactions += 1;
        if (!acc[key].name && event.label) acc[key].name = String(event.label);
        return acc;
      }, {});
      const recentEvents = [...todayEvents]
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, 20);
      return {
        funnel: {
          productDetail: Number(countByType.product_detail || 0),
          addToCart: Number(countByType.add_to_cart || 0),
          share: Number(countByType.share || 0),
          checkoutStart: Number(countByType.checkout_start || 0),
          registerStart: Number(countByType.register_start || 0),
          registerSubmit: Number(countByType.register_submit || 0)
        },
        topProducts: Object.values(productCounts).sort((a, b) => b.interactions - a.interactions).slice(0, 5),
        recentEvents
      };
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
    async updateUserAccountType(id, accountType) {
      const user = store.users.find((item) => item.id === Number(id) && item.role !== "admin");
      if (!user) return null;
      user.accountType = normalizeAccountType(accountType, user.accountType || "shopper");
      writeJsonStore(store);
      return user;
    },
    async listProducts({ activeOnly = false, ownerUserId } = {}) {
      const products = store.products.filter((product) => {
        if (activeOnly && !product.active) return false;
        if (ownerUserId != null && Number(product.ownerUserId || 0) !== Number(ownerUserId)) return false;
        return true;
      });
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
      return insert("products", { ownerUserId: null, ...product });
    },
    async updateProduct(id, updates) {
      const product = store.products.find((item) => item.id === Number(id));
      if (!product) return null;
      Object.assign(product, updates);
      writeJsonStore(store);
      return product;
    },
    async deleteProduct(id) {
      const productId = Number(id);
      const index = store.products.findIndex((item) => item.id === productId);
      if (index === -1) return false;
      store.products.splice(index, 1);
      store.comparisons = store.comparisons.filter((comparison) => Number(comparison.productId) !== productId);
      store.products.forEach((product) => {
        product.recommendedAddonIds = (product.recommendedAddonIds || []).filter((addonId) => Number(addonId) !== productId);
      });
      writeJsonStore(store);
      return true;
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
        const shipTo = order.shipTo || {};
        const customerOrders = order.userId
          ? store.orders
            .filter((item) => Number(item.userId) === Number(order.userId))
            .sort((a, b) => Number(a.id) - Number(b.id))
          : [];
        const orderIndex = customerOrders.findIndex((item) => Number(item.id) === Number(order.id));
        return {
          ...order,
          email: user.email || shipTo.email || "",
          company: user.company || shipTo.company || "",
          contactName: user.contactName || shipTo.recipientName || "",
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
        returningCustomers: new Set(store.orders.map((order) => order.userId).filter((userId) => store.orders.filter((order) => order.userId === userId).length > 1)).size,
        siteVisits: store.siteVisitors.reduce((sum, entry) => sum + Number(entry.visitCount || 0), 0),
        uniqueVisitors: store.siteVisitors.length,
        listingViews: store.productViews.reduce((sum, entry) => sum + Number(entry.viewCount || 0), 0),
        amazonAffiliateTag: AMAZON_AFFILIATE_TAG
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
    accountType: row.account_type || row.accountType || (row.role === "admin" ? "admin" : "shopper"),
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
    ownerUserId: row.owner_user_id || row.ownerUserId || null,
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
          account_type TEXT NOT NULL DEFAULT 'shopper',
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
          owner_user_id INTEGER REFERENCES users(id),
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
        CREATE TABLE IF NOT EXISTS site_visitors (
          visitor_key TEXT PRIMARY KEY,
          visit_count INTEGER NOT NULL DEFAULT 1,
          first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_path TEXT NOT NULL DEFAULT '',
          user_id INTEGER REFERENCES users(id),
          ip_address TEXT NOT NULL DEFAULT '',
          city TEXT NOT NULL DEFAULT '',
          region TEXT NOT NULL DEFAULT '',
          country TEXT NOT NULL DEFAULT '',
          device_type TEXT NOT NULL DEFAULT '',
          browser_name TEXT NOT NULL DEFAULT '',
          os_name TEXT NOT NULL DEFAULT '',
          user_agent TEXT NOT NULL DEFAULT '',
          referrer TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS site_visit_events (
          id SERIAL PRIMARY KEY,
          visitor_key TEXT NOT NULL,
          path TEXT NOT NULL DEFAULT '',
          visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          user_id INTEGER REFERENCES users(id),
          ip_address TEXT NOT NULL DEFAULT '',
          city TEXT NOT NULL DEFAULT '',
          region TEXT NOT NULL DEFAULT '',
          country TEXT NOT NULL DEFAULT '',
          device_type TEXT NOT NULL DEFAULT '',
          browser_name TEXT NOT NULL DEFAULT '',
          os_name TEXT NOT NULL DEFAULT '',
          user_agent TEXT NOT NULL DEFAULT '',
          referrer TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS interaction_events (
          id SERIAL PRIMARY KEY,
          visitor_key TEXT NOT NULL,
          type TEXT NOT NULL,
          path TEXT NOT NULL DEFAULT '',
          product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
          label TEXT NOT NULL DEFAULT '',
          value TEXT NOT NULL DEFAULT '',
          referrer TEXT NOT NULL DEFAULT '',
          user_id INTEGER REFERENCES users(id),
          ip_address TEXT NOT NULL DEFAULT '',
          city TEXT NOT NULL DEFAULT '',
          region TEXT NOT NULL DEFAULT '',
          country TEXT NOT NULL DEFAULT '',
          device_type TEXT NOT NULL DEFAULT '',
          browser_name TEXT NOT NULL DEFAULT '',
          os_name TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS product_views (
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          visitor_key TEXT NOT NULL,
          view_count INTEGER NOT NULL DEFAULT 1,
          first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          user_id INTEGER REFERENCES users(id),
          PRIMARY KEY (product_id, visitor_key)
        );
        CREATE INDEX IF NOT EXISTS idx_products_upc ON products(upc);
        ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT '';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS image_urls TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS source_url TEXT NOT NULL DEFAULT '';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS quantity_on_hand INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE products ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id);
        ALTER TABLE products ADD COLUMN IF NOT EXISTS product_specs TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS dealer_price_cents INTEGER;
        ALTER TABLE products ADD COLUMN IF NOT EXISTS recommended_addon_ids TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE alert_leads ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '';
        ALTER TABLE alert_leads ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'shopper';
        CREATE INDEX IF NOT EXISTS idx_products_search ON products USING gin(to_tsvector('english', name || ' ' || description || ' ' || sku || ' ' || upc || ' ' || brand));
        CREATE INDEX IF NOT EXISTS idx_price_comparisons_product ON price_comparisons(product_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_alert_leads_created ON alert_leads(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON bug_reports(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_product_views_product ON product_views(product_id);
        CREATE INDEX IF NOT EXISTS idx_site_visitors_last_seen ON site_visitors(last_seen_at DESC);
        CREATE INDEX IF NOT EXISTS idx_site_visit_events_visited ON site_visit_events(visited_at DESC);
        CREATE INDEX IF NOT EXISTS idx_site_visit_events_path ON site_visit_events(path);
        CREATE INDEX IF NOT EXISTS idx_interaction_events_created ON interaction_events(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_interaction_events_type ON interaction_events(type);
        ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS ip_address TEXT NOT NULL DEFAULT '';
        ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '';
        ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT '';
        ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT '';
        ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT '';
        ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS browser_name TEXT NOT NULL DEFAULT '';
        ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS os_name TEXT NOT NULL DEFAULT '';
        ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '';
        ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS referrer TEXT NOT NULL DEFAULT '';
      `);
      await migrateFromJsonIfEmpty();
    },
    async seedAdmin() {
      const existing = await this.getUserByEmail(ADMIN_EMAIL);
      if (existing) return;
      await query(`
        INSERT INTO users (email, password_hash, company, contact_name, status, role, account_type)
        VALUES ($1,$2,'Owner','K. Prathab','approved','admin','admin')
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
        INSERT INTO users (email, password_hash, company, contact_name, phone, status, role, account_type)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
      `, [user.email, user.passwordHash, user.company, user.contactName, user.phone, user.status, user.role, normalizeAccountType(user.accountType, user.role === "admin" ? "admin" : "shopper")]);
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
    async recordSiteVisit(visitorKey, pathName, userId = null, metadata = {}) {
      await query(`
        INSERT INTO site_visit_events (
          visitor_key, path, visited_at, user_id, ip_address, city, region, country,
          device_type, browser_name, os_name, user_agent, referrer
        )
        VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        visitorKey,
        pathName || "",
        userId || null,
        metadata.ipAddress || "",
        metadata.city || "",
        metadata.region || "",
        metadata.country || "",
        metadata.deviceType || "",
        metadata.browserName || "",
        metadata.osName || "",
        metadata.userAgent || "",
        metadata.referrer || ""
      ]);
      await query(`
        INSERT INTO site_visitors (
          visitor_key, visit_count, first_seen_at, last_seen_at, last_path, user_id,
          ip_address, city, region, country, device_type, browser_name, os_name, user_agent, referrer
        )
        VALUES ($1, 1, NOW(), NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (visitor_key) DO UPDATE SET
          visit_count = site_visitors.visit_count + 1,
          last_seen_at = NOW(),
          last_path = EXCLUDED.last_path,
          user_id = COALESCE(site_visitors.user_id, EXCLUDED.user_id),
          ip_address = COALESCE(NULLIF(site_visitors.ip_address, ''), EXCLUDED.ip_address),
          city = COALESCE(NULLIF(site_visitors.city, ''), EXCLUDED.city),
          region = COALESCE(NULLIF(site_visitors.region, ''), EXCLUDED.region),
          country = COALESCE(NULLIF(site_visitors.country, ''), EXCLUDED.country),
          device_type = COALESCE(NULLIF(site_visitors.device_type, ''), EXCLUDED.device_type),
          browser_name = COALESCE(NULLIF(site_visitors.browser_name, ''), EXCLUDED.browser_name),
          os_name = COALESCE(NULLIF(site_visitors.os_name, ''), EXCLUDED.os_name),
          user_agent = COALESCE(NULLIF(site_visitors.user_agent, ''), EXCLUDED.user_agent),
          referrer = COALESCE(NULLIF(site_visitors.referrer, ''), EXCLUDED.referrer)
      `, [
        visitorKey,
        pathName || "",
        userId || null,
        metadata.ipAddress || "",
        metadata.city || "",
        metadata.region || "",
        metadata.country || "",
        metadata.deviceType || "",
        metadata.browserName || "",
        metadata.osName || "",
        metadata.userAgent || "",
        metadata.referrer || ""
      ]);
    },
    async recordProductView(productId, visitorKey, userId = null) {
      await query(`
        INSERT INTO product_views (product_id, visitor_key, view_count, first_seen_at, last_seen_at, user_id)
        VALUES ($1, $2, 1, NOW(), NOW(), $3)
        ON CONFLICT (product_id, visitor_key) DO UPDATE SET
          view_count = product_views.view_count + 1,
          last_seen_at = NOW(),
          user_id = COALESCE(product_views.user_id, EXCLUDED.user_id)
      `, [productId, visitorKey, userId || null]);
    },
    async getProductMetrics(productIds = []) {
      const ids = productIds.map(Number).filter(Boolean);
      if (!ids.length) return {};
      const result = await query(`
        SELECT product_id AS "productId",
               COALESCE(SUM(view_count), 0)::int AS "viewCount",
               COUNT(*)::int AS "uniqueViewers"
        FROM product_views
        WHERE product_id = ANY($1::int[])
        GROUP BY product_id
      `, [ids]);
      const metrics = Object.fromEntries(ids.map((id) => [id, { viewCount: 0, uniqueViewers: 0 }]));
      result.rows.forEach((row) => {
        metrics[Number(row.productId)] = {
          viewCount: Number(row.viewCount || 0),
          uniqueViewers: Number(row.uniqueViewers || 0)
        };
      });
      return metrics;
    },
    async listVisitors({ limit = 10, country = "", deviceType = "", path = "" } = {}) {
      const clauses = [];
      const params = [];
      if (country) {
        params.push(`%${String(country).trim()}%`);
        clauses.push(`LOWER(country) LIKE LOWER($${params.length})`);
      }
      if (deviceType) {
        params.push(String(deviceType).trim());
        clauses.push(`LOWER(device_type) = LOWER($${params.length})`);
      }
      if (path) {
        params.push(`%${String(path).trim()}%`);
        clauses.push(`LOWER(last_path) LIKE LOWER($${params.length})`);
      }
      params.push(Math.max(1, Number(limit) || 10));
      const result = await query(`
        SELECT visitor_key AS "visitorKey",
               visit_count AS "visitCount",
               first_seen_at AS "firstSeenAt",
               last_seen_at AS "lastSeenAt",
               last_path AS "lastPath",
               user_id AS "userId",
               ip_address AS "ipAddress",
               city,
               region,
               country,
               device_type AS "deviceType",
               browser_name AS "browserName",
               os_name AS "osName",
               user_agent AS "userAgent",
               referrer
        FROM site_visitors
        ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
        ORDER BY last_seen_at DESC
        LIMIT $${params.length}
      `, params);
      return result.rows;
    },
    async visitorAnalytics(filters = {}) {
      const clauses = ["visited_at >= date_trunc('day', NOW())"];
      const params = [];
      if (filters.country) {
        params.push(`%${String(filters.country).trim()}%`);
        clauses.push(`LOWER(country) LIKE LOWER($${params.length})`);
      }
      if (filters.deviceType) {
        params.push(String(filters.deviceType).trim());
        clauses.push(`LOWER(device_type) = LOWER($${params.length})`);
      }
      if (filters.path) {
        params.push(`%${String(filters.path).trim()}%`);
        clauses.push(`LOWER(path) LIKE LOWER($${params.length})`);
      }
      const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const hourlyResult = await query(`
        SELECT EXTRACT(HOUR FROM visited_at)::int AS hour, COUNT(*)::int AS visits
        FROM site_visit_events
        ${whereClause}
        GROUP BY 1
        ORDER BY 1
      `, params);
      const summaryResult = await query(`
        SELECT COUNT(*)::int AS "todayVisits",
               COUNT(DISTINCT visitor_key)::int AS "uniqueVisitorsToday"
        FROM site_visit_events
        ${whereClause}
      `, params);
      const topCountryResult = await query(`
        SELECT CASE WHEN country = '' THEN 'Unknown' ELSE country END AS country, COUNT(*)::int AS visits
        FROM site_visit_events
        ${whereClause}
        GROUP BY 1
        ORDER BY visits DESC, country ASC
        LIMIT 5
      `, params);
      const hourlyMap = new Map(hourlyResult.rows.map((row) => [Number(row.hour), Number(row.visits || 0)]));
      return {
        recentVisitors: await this.listVisitors({ ...filters, limit: 10 }),
        todayVisits: Number(summaryResult.rows[0]?.todayVisits || 0),
        uniqueVisitorsToday: Number(summaryResult.rows[0]?.uniqueVisitorsToday || 0),
        topCountries: topCountryResult.rows.map((row) => ({ country: row.country, visits: Number(row.visits || 0) })),
        hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, visits: hourlyMap.get(hour) || 0 }))
      };
    },
    async updateVisitorLocation(visitorKey, metadata = {}) {
      const result = await query(`
        UPDATE site_visitors
        SET ip_address = COALESCE(NULLIF($2, ''), ip_address),
            city = COALESCE(NULLIF($3, ''), city),
            region = COALESCE(NULLIF($4, ''), region),
            country = COALESCE(NULLIF($5, ''), country)
        WHERE visitor_key = $1
        RETURNING visitor_key AS "visitorKey",
                  visit_count AS "visitCount",
                  first_seen_at AS "firstSeenAt",
                  last_seen_at AS "lastSeenAt",
                  last_path AS "lastPath",
                  user_id AS "userId",
                  ip_address AS "ipAddress",
                  city, region, country,
                  device_type AS "deviceType",
                  browser_name AS "browserName",
                  os_name AS "osName",
                  user_agent AS "userAgent",
                  referrer
      `, [visitorKey, metadata.ipAddress || "", metadata.city || "", metadata.region || "", metadata.country || ""]);
      return result.rows[0] || null;
    },
    async recordInteractionEvent(event) {
      const result = await query(`
        INSERT INTO interaction_events (
          visitor_key, type, path, product_id, label, value, referrer, user_id,
          ip_address, city, region, country, device_type, browser_name, os_name
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        RETURNING id, visitor_key AS "visitorKey", type, path, product_id AS "productId", label, value,
                  referrer, user_id AS "userId", ip_address AS "ipAddress", city, region, country,
                  device_type AS "deviceType", browser_name AS "browserName", os_name AS "osName",
                  created_at AS "createdAt"
      `, [
        event.visitorKey,
        event.type,
        event.path || "",
        event.productId ? Number(event.productId) : null,
        event.label || "",
        event.value || "",
        event.referrer || "",
        event.userId || null,
        event.ipAddress || "",
        event.city || "",
        event.region || "",
        event.country || "",
        event.deviceType || "",
        event.browserName || "",
        event.osName || ""
      ]);
      return result.rows[0];
    },
    async interactionAnalytics() {
      const funnelResult = await query(`
        SELECT
          COUNT(*) FILTER (WHERE type = 'product_detail')::int AS "productDetail",
          COUNT(*) FILTER (WHERE type = 'add_to_cart')::int AS "addToCart",
          COUNT(*) FILTER (WHERE type = 'share')::int AS "share",
          COUNT(*) FILTER (WHERE type = 'checkout_start')::int AS "checkoutStart",
          COUNT(*) FILTER (WHERE type = 'register_start')::int AS "registerStart",
          COUNT(*) FILTER (WHERE type = 'register_submit')::int AS "registerSubmit"
        FROM interaction_events
        WHERE created_at >= date_trunc('day', NOW())
      `);
      const topProductsResult = await query(`
        SELECT product_id AS "productId", MAX(label) AS name, COUNT(*)::int AS interactions
        FROM interaction_events
        WHERE created_at >= date_trunc('day', NOW()) AND product_id IS NOT NULL
        GROUP BY product_id
        ORDER BY interactions DESC, product_id DESC
        LIMIT 5
      `);
      const recentEventsResult = await query(`
        SELECT id, visitor_key AS "visitorKey", type, path, product_id AS "productId", label, value,
               referrer, user_id AS "userId", ip_address AS "ipAddress", city, region, country,
               device_type AS "deviceType", browser_name AS "browserName", os_name AS "osName",
               created_at AS "createdAt"
        FROM interaction_events
        WHERE created_at >= date_trunc('day', NOW())
        ORDER BY created_at DESC
        LIMIT 20
      `);
      return {
        funnel: {
          productDetail: Number(funnelResult.rows[0]?.productDetail || 0),
          addToCart: Number(funnelResult.rows[0]?.addToCart || 0),
          share: Number(funnelResult.rows[0]?.share || 0),
          checkoutStart: Number(funnelResult.rows[0]?.checkoutStart || 0),
          registerStart: Number(funnelResult.rows[0]?.registerStart || 0),
          registerSubmit: Number(funnelResult.rows[0]?.registerSubmit || 0)
        },
        topProducts: topProductsResult.rows.map((row) => ({ productId: Number(row.productId), name: row.name || "", interactions: Number(row.interactions || 0) })),
        recentEvents: recentEventsResult.rows
      };
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
    async updateUserAccountType(id, accountType) {
      const result = await query("UPDATE users SET account_type = $1 WHERE id = $2 AND role != 'admin' RETURNING *", [normalizeAccountType(accountType), id]);
      return camelUser(result.rows[0]);
    },
    async listProducts({ activeOnly = false, ownerUserId } = {}) {
      const conditions = [];
      const params = [];
      if (activeOnly) conditions.push("active = true");
      if (ownerUserId != null) {
        params.push(Number(ownerUserId));
        conditions.push(`owner_user_id = $${params.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const result = await query(`SELECT * FROM products ${where} ORDER BY id DESC`, params);
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
        INSERT INTO products (name, sku, upc, brand, category, description, price_cents, dealer_price_cents, image_url, image_urls, source_url, quantity_on_hand, owner_user_id, product_specs, active, recommended_addon_ids)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *
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
        product.ownerUserId ?? null,
        JSON.stringify(product.productSpecs || {}),
        product.active,
        JSON.stringify(product.recommendedAddonIds || [])
      ]);
      return camelProduct(result.rows[0]);
    },
    async updateProduct(id, product) {
      const result = await query(`
        UPDATE products SET name=$1, sku=$2, upc=$3, brand=$4, category=$5, description=$6, price_cents=$7, dealer_price_cents=$8, image_url=$9, image_urls=$10, source_url=$11, quantity_on_hand=$12, owner_user_id=$13, product_specs=$14, active=$15, recommended_addon_ids=$16
        WHERE id=$17 RETURNING *
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
        product.ownerUserId ?? null,
        JSON.stringify(product.productSpecs || {}),
        product.active,
        JSON.stringify(product.recommendedAddonIds || []),
        id
      ]);
      return camelProduct(result.rows[0]);
    },
    async deleteProduct(id) {
      await query(`
        UPDATE products
        SET recommended_addon_ids = COALESCE((
          SELECT json_agg(value::int)
          FROM json_array_elements_text(recommended_addon_ids::json) AS value
          WHERE value::int <> $1
        )::text, '[]')
        WHERE recommended_addon_ids <> '[]'
      `, [id]);
      const result = await query("DELETE FROM products WHERE id = $1 RETURNING id", [id]);
      return Boolean(result.rows[0]);
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
        LEFT JOIN users ON users.id = orders.user_id
        ORDER BY orders.id DESC
      `)).rows.map((row) => ({
        ...camelOrder(row),
        email: row.email || row.ship_to?.email || row.shipTo?.email || "",
        company: row.company || row.ship_to?.company || row.shipTo?.company || "",
        contactName: row.contactName || row.ship_to?.recipientName || row.shipTo?.recipientName || "",
        customerOrderCount: row.user_id ? row.customerOrderCount : 0,
        previousOrderCount: row.user_id ? row.previousOrderCount : 0,
        returningCustomer: Boolean(row.user_id) && Number(row.previousOrderCount || 0) > 0,
        customerTotalSpentCents: row.user_id ? row.customerTotalSpentCents : 0
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
          (SELECT COUNT(*) FROM (SELECT user_id FROM orders GROUP BY user_id HAVING COUNT(*) > 1) returning_customers)::int AS "returningCustomers",
          (SELECT COALESCE(SUM(visit_count), 0) FROM site_visitors)::int AS "siteVisits",
          (SELECT COUNT(*) FROM site_visitors)::int AS "uniqueVisitors",
          (SELECT COALESCE(SUM(view_count), 0) FROM product_views)::int AS "listingViews"
      `);
      return {
        ...result.rows[0],
        amazonAffiliateTag: AMAZON_AFFILIATE_TAG
      };
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
const productImageUpload = upload.any();

function uploadedImageUrls(req) {
  const files = Object.values(req.files || {}).flat();
  if (req.file) files.push(req.file);
  return files.map((file) => `/uploads/${file.filename}`);
}

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
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

function readCookie(req, name) {
  const raw = String(req.headers.cookie || "");
  if (!raw) return "";
  const target = `${name}=`;
  for (const chunk of raw.split(";")) {
    const value = chunk.trim();
    if (!value.startsWith(target)) continue;
    return decodeURIComponent(value.slice(target.length));
  }
  return "";
}

function ensureVisitorKey(req, res) {
  const existing = readCookie(req, VISITOR_COOKIE_NAME);
  if (existing) return existing;
  const visitorKey = crypto.randomUUID();
  res.cookie(VISITOR_COOKIE_NAME, visitorKey, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 365 * 2
  });
  return visitorKey;
}

function readConsent(req) {
  const value = String(readCookie(req, CONSENT_COOKIE_NAME) || "").trim().toLowerCase();
  return value === "analytics" || value === "essential" ? value : "";
}

function setConsent(res, value) {
  res.cookie(CONSENT_COOKIE_NAME, value, {
    httpOnly: false,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 365
  });
}

async function recordSiteVisit(req, res, pathName = req.path) {
  try {
    const visitorKey = ensureVisitorKey(req, res);
    const user = await currentUser(req);
    const metadata = await visitorMetadata(req);
    await db.recordSiteVisit(visitorKey, pathName, user?.id || null, metadata);
    return visitorKey;
  } catch (error) {
    console.error("Could not record site visit", error);
    return "";
  }
}

async function recordProductView(req, res, productId) {
  try {
    const visitorKey = await recordSiteVisit(req, res, req.path);
    if (!visitorKey || !productId) return;
    const user = await currentUser(req);
    await db.recordProductView(Number(productId), visitorKey, user?.id || null);
  } catch (error) {
    console.error("Could not record product view", error);
  }
}

async function recordInteractionEvent(req, res, payload = {}) {
  try {
    if (readConsent(req) !== "analytics") return null;
    const visitorKey = ensureVisitorKey(req, res);
    if (!visitorKey) return null;
    const user = await currentUser(req);
    const metadata = await visitorMetadata(req);
    return await db.recordInteractionEvent({
      visitorKey,
      userId: user?.id || null,
      type: String(payload.type || "").trim(),
      path: String(payload.path || req.path || "").trim(),
      productId: payload.productId ? Number(payload.productId) : null,
      label: String(payload.label || "").trim(),
      value: String(payload.value || "").trim(),
      referrer: String(req.get("referer") || metadata.referrer || "").trim(),
      ipAddress: metadata.ipAddress || "",
      city: metadata.city || "",
      region: metadata.region || "",
      country: metadata.country || "",
      deviceType: metadata.deviceType || "",
      browserName: metadata.browserName || "",
      osName: metadata.osName || ""
    });
  } catch (error) {
    console.error("Could not record interaction event", error);
    return null;
  }
}

const geoLookupCache = new Map();

function clientIpAddress(req) {
  const forwarded = String(req.get("x-forwarded-for") || "").split(",")[0].trim();
  const raw = forwarded
    || String(req.get("cf-connecting-ip") || "").trim()
    || String(req.get("x-real-ip") || "").trim()
    || String(req.ip || "").trim();
  const normalized = raw.replace(/^::ffff:/, "").replace(/^\[|\]$/g, "");
  if (!normalized || normalized === "::1") return "127.0.0.1";
  return normalized;
}

function privateIpAddress(ipAddress = "") {
  const ip = String(ipAddress || "").toLowerCase();
  if (!ip) return true;
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")) return true;
  return false;
}

function parseDeviceContext(userAgent = "") {
  const ua = String(userAgent || "");
  const lower = ua.toLowerCase();
  const deviceType = /ipad|tablet|playbook|silk/.test(lower)
    ? "tablet"
    : /mobi|iphone|ipod|android/.test(lower)
      ? "mobile"
      : /bot|spider|crawl|slurp/.test(lower)
        ? "bot"
        : "desktop";
  const browserName = /edg\//i.test(ua)
    ? "Edge"
    : /chrome\//i.test(ua) && !/edg\//i.test(ua)
      ? "Chrome"
      : /safari\//i.test(ua) && !/chrome\//i.test(ua)
        ? "Safari"
        : /firefox\//i.test(ua)
          ? "Firefox"
          : /opr\//i.test(ua)
            ? "Opera"
            : /msie|trident/i.test(ua)
              ? "Internet Explorer"
              : "Other";
  const osName = /windows nt/i.test(ua)
    ? "Windows"
    : /android/i.test(ua)
      ? "Android"
      : /iphone|ipad|ipod/i.test(ua)
        ? "iOS"
        : /mac os x/i.test(ua)
          ? "macOS"
          : /linux/i.test(ua)
            ? "Linux"
            : "Other";
  return { deviceType, browserName, osName };
}

function headerLocationHints(req) {
  const country = String(
    req.get("cf-ipcountry")
    || req.get("x-vercel-ip-country")
    || req.get("x-country-code")
    || req.get("fastly-client-country-code")
    || ""
  ).trim();
  const region = String(
    req.get("x-vercel-ip-country-region")
    || req.get("x-region")
    || req.get("cloudfront-viewer-country-region")
    || ""
  ).trim();
  const city = String(
    req.get("x-vercel-ip-city")
    || req.get("x-city")
    || req.get("cloudfront-viewer-city")
    || ""
  ).trim();
  return {
    city: city && city.toLowerCase() !== "unknown" ? city : "",
    region: region && region.toLowerCase() !== "unknown" ? region : "",
    country: country && country.toLowerCase() !== "xx" && country.toLowerCase() !== "unknown" ? country : ""
  };
}

function expandCountry(country = "") {
  const value = String(country || "").trim();
  if (!value) return "";
  if (value.length === 2 && COUNTRY_NAMES) {
    return COUNTRY_NAMES.of(value.toUpperCase()) || value.toUpperCase();
  }
  return value;
}

function expandRegion(region = "", country = "") {
  const value = String(region || "").trim();
  const countryCode = String(country || "").trim().toUpperCase();
  if (!value) return "";
  if (countryCode === "CA" || countryCode === "CANADA") {
    return CANADA_PROVINCES[value.toUpperCase()] || value;
  }
  if (countryCode === "US" || countryCode === "USA" || countryCode === "UNITED STATES") {
    return US_STATES[value.toUpperCase()] || value;
  }
  return value;
}

function normalizeLocation(location = {}) {
  const rawCountry = String(location.country || "").trim();
  const rawRegion = String(location.region || "").trim();
  return {
    city: String(location.city || "").trim(),
    region: expandRegion(rawRegion, rawCountry),
    country: expandCountry(rawCountry)
  };
}

async function fetchGeoFromIpwho(ipAddress, controller) {
  const response = await fetch(`https://ipwho.is/${encodeURIComponent(ipAddress)}`, {
    signal: controller.signal,
    headers: { "user-agent": "selltomakemoney.com Analytics/1.0" }
  });
  const payload = await response.json();
  if (!payload || payload.success === false) return { city: "", region: "", country: "" };
  return normalizeLocation({
    city: payload.city,
    region: payload.region,
    country: payload.country || payload.country_code
  });
}

async function fetchGeoFromIpapi(ipAddress, controller) {
  const response = await fetch(`https://ipapi.co/${encodeURIComponent(ipAddress)}/json/`, {
    signal: controller.signal,
    headers: { "user-agent": "selltomakemoney.com Analytics/1.0" }
  });
  const payload = await response.json();
  if (!payload || payload.error) return { city: "", region: "", country: "" };
  return normalizeLocation({
    city: payload.city,
    region: payload.region || payload.region_code,
    country: payload.country_name || payload.country
  });
}

async function geoLookup(ipAddress) {
  if (!ipAddress || privateIpAddress(ipAddress)) return { city: "", region: "", country: "" };
  if (geoLookupCache.has(ipAddress)) return geoLookupCache.get(ipAddress);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    let result = await fetchGeoFromIpwho(ipAddress, controller);
    if (!result.city && !result.region && !result.country) {
      result = await fetchGeoFromIpapi(ipAddress, controller);
    }
    geoLookupCache.set(ipAddress, result);
    return result;
  } catch (_error) {
    return { city: "", region: "", country: "" };
  } finally {
    clearTimeout(timeout);
  }
}

async function visitorMetadata(req) {
  const ipAddress = clientIpAddress(req);
  const userAgent = String(req.get("user-agent") || "").trim();
  const referrer = String(req.get("referer") || "").trim();
  const hinted = normalizeLocation(headerLocationHints(req));
  const fallback = (!hinted.city || !hinted.region || !hinted.country) ? await geoLookup(ipAddress) : { city: "", region: "", country: "" };
  const city = hinted.city || fallback.city || "";
  const region = hinted.region || fallback.region || "";
  const country = hinted.country || fallback.country || "";
  const { deviceType, browserName, osName } = parseDeviceContext(userAgent);
  return {
    ipAddress,
    city,
    region,
    country,
    deviceType,
    browserName,
    osName,
    userAgent,
    referrer
  };
}

async function backfillVisitorLocations(visitors = []) {
  const updates = [];
  for (const visitor of visitors) {
    const missingLocation = !visitor.city || !visitor.region || !visitor.country;
    if (!missingLocation) continue;
    if (privateIpAddress(visitor.ipAddress)) continue;
    const resolved = await geoLookup(visitor.ipAddress);
    if (!resolved.city && !resolved.region && !resolved.country) continue;
    const normalized = normalizeLocation(resolved);
    const updated = await db.updateVisitorLocation(visitor.visitorKey, {
      ipAddress: visitor.ipAddress || "",
      city: normalized.city || visitor.city || "",
      region: normalized.region || visitor.region || "",
      country: normalized.country || visitor.country || ""
    });
    updates.push(updated || { ...visitor, ...normalized });
  }
  if (!updates.length) return visitors;
  const byKey = new Map(updates.filter(Boolean).map((visitor) => [visitor.visitorKey, visitor]));
  return visitors.map((visitor) => byKey.get(visitor.visitorKey) || visitor);
}

app.use("/uploads", express.static(UPLOAD_DIR, {
  etag: true,
  maxAge: "7d",
  immutable: true,
  setHeaders: (res) => res.setHeader("Cache-Control", "public, max-age=604800, immutable")
}));
app.use(express.static(path.join(ROOT, "public"), {
  index: false,
  etag: true,
  setHeaders: (res, filePath) => {
    if (/\.(css|js|svg|png|jpg|jpeg|webp|gif|ico)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return;
    }
    if (/\.html$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-cache");
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=3600");
  }
}));

function isMobileRequest(req) {
  const ua = req.get("user-agent") || "";
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
}

function appHtml(forcedView = "", entryRoute = "") {
  const indexPath = path.join(ROOT, "public", "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  const view = forcedView === "mobile" || forcedView === "desktop" ? forcedView : "";
  const forceScript = `<script>window.__FORCED_VIEW=${JSON.stringify(view)};</script>`;
  const routeScript = `<script>window.__ENTRY_ROUTE=${JSON.stringify(entryRoute || "")};</script>`;
  const verificationMeta = GOOGLE_SITE_VERIFICATION
    ? `\n<meta name="google-site-verification" content="${escapeHtml(GOOGLE_SITE_VERIFICATION)}">`
    : "";
  const routeMeta = spaRouteMeta(entryRoute || "store");
  return html
    .replace("<body>", `<body data-entry-view="${view || "auto"}">`)
    .replace('<meta name="description" content="Browse selltomakemoney.com for public deals, scooters, electronics, tools, and inventory finds with Mississauga pickup plus select shippable items across Canada.">', `<meta name="description" content="${escapeHtml(routeMeta.description)}">`)
    .replace('<meta name="keywords" content="selltomakemoney, Mississauga deals, local pickup, inventory finds, scooters, electronics, tools, online catalog, e-transfer, cash pickup">', `<meta name="keywords" content="${escapeHtml(routeMeta.keywords)}">`)
    .replace('<link rel="canonical" href="https://selltomakemoney.com/">', `<link rel="canonical" href="${escapeHtml(routeMeta.canonical)}">`)
    .replace('<meta property="og:title" content="selltomakemoney.com Store | Mississauga Deals and Inventory Finds">', `<meta property="og:title" content="${escapeHtml(routeMeta.title)}">`)
    .replace('<meta property="og:description" content="Browse public prices, compare categories, and request checkout for Mississauga pickup or select shippable items across Canada.">', `<meta property="og:description" content="${escapeHtml(routeMeta.ogDescription)}">`)
    .replace('<meta property="og:url" content="https://selltomakemoney.com/">', `<meta property="og:url" content="${escapeHtml(routeMeta.canonical)}">`)
    .replace('<meta name="twitter:title" content="selltomakemoney.com Store | Mississauga Deals">', `<meta name="twitter:title" content="${escapeHtml(routeMeta.twitterTitle)}">`)
    .replace('<meta name="twitter:description" content="Shop public deals, inventory finds, Mississauga pickup, and select shippable items across Canada.">', `<meta name="twitter:description" content="${escapeHtml(routeMeta.twitterDescription)}">`)
    .replace('<title>selltomakemoney.com Store | Mississauga Deals and Inventory Finds</title>', `<title>${escapeHtml(routeMeta.title)}</title>`)
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/, routeMeta.jsonLd)
    .replace("</head>", `${verificationMeta}${forceScript}\n${routeScript}\n</head>`);
}

function spaRouteMeta(entryRoute = "store") {
  const baseUrl = "https://selltomakemoney.com";
  const organizationJsonLd = safeJsonScript({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "selltomakemoney.com",
    url: `${baseUrl}/`,
    areaServed: "Canada",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Mississauga",
      addressRegion: "ON",
      addressCountry: "CA"
    },
    sameAs: [`${baseUrl}/catalog`]
  });
  const sharedKeywords = "selltomakemoney, Mississauga deals, local pickup, inventory finds, online catalog, e-transfer, cash pickup";
  const routeMap = {
    store: {
      canonical: `${baseUrl}/`,
      title: "selltomakemoney.com Store | Mississauga Deals and Inventory Finds",
      description: "Browse selltomakemoney.com for public deals, scooters, electronics, tools, and inventory finds with Mississauga pickup plus select shippable items across Canada.",
      ogDescription: "Browse public prices, compare categories, and request checkout for Mississauga pickup or select shippable items across Canada.",
      twitterTitle: "selltomakemoney.com Store | Mississauga Deals",
      twitterDescription: "Shop public deals, inventory finds, Mississauga pickup, and select shippable items across Canada.",
      keywords: `${sharedKeywords}, scooters, electronics, tools`,
      pageJsonLd: safeJsonScript({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "selltomakemoney.com",
        url: `${baseUrl}/`,
        potentialAction: {
          "@type": "SearchAction",
          target: `${baseUrl}/catalog?search={search_term_string}`,
          "query-input": "required name=search_term_string"
        }
      })
    },
    sellwithus: {
      canonical: `${baseUrl}/list-with-us`,
      title: "List With Us | selltomakemoney.com Seller Marketplace",
      description: "Apply to list products on selltomakemoney.com and get a separate seller workspace for approved marketplace inventory.",
      ogDescription: "Approved sellers get a dedicated workspace, product uploads, and a separate marketplace listing flow.",
      twitterTitle: "List With Us | selltomakemoney.com",
      twitterDescription: "Apply to become an approved seller and submit inventory through a separate seller workspace.",
      keywords: `${sharedKeywords}, seller marketplace, list products, approved sellers`,
      pageJsonLd: safeJsonScript({
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "List With Us | selltomakemoney.com Seller Marketplace",
        url: `${baseUrl}/list-with-us`,
        description: "Seller application page for approved marketplace inventory on selltomakemoney.com."
      })
    },
    dealer: {
      canonical: `${baseUrl}/dealer`,
      title: "Dealer Account Access | selltomakemoney.com",
      description: "Dealer accounts on selltomakemoney.com support repeat buying, tracked order history, and inventory sourcing in Mississauga.",
      ogDescription: "Dealer buyers can review inventory, track order history, and source repeat inventory.",
      twitterTitle: "Dealer Account Access | selltomakemoney.com",
      twitterDescription: "Dealer buyers can create accounts for repeat inventory sourcing and order tracking.",
      keywords: `${sharedKeywords}, dealer account, repeat buyers, inventory sourcing`,
      pageJsonLd: safeJsonScript({
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Dealer Account Access | selltomakemoney.com",
        url: `${baseUrl}/dealer`,
        description: "Dealer account access and sourcing workflow on selltomakemoney.com."
      })
    },
    shopper: {
      canonical: `${baseUrl}/shopper`,
      title: "Shopper Account Access | selltomakemoney.com",
      description: "Create or manage a shopper account on selltomakemoney.com to save checkout details and submit order requests faster.",
      ogDescription: "Shopper accounts make it easier to request checkout and manage order details.",
      twitterTitle: "Shopper Account Access | selltomakemoney.com",
      twitterDescription: "Create a shopper account to speed up checkout requests and saved order details.",
      keywords: `${sharedKeywords}, shopper account, order requests, checkout details`,
      pageJsonLd: safeJsonScript({
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Shopper Account Access | selltomakemoney.com",
        url: `${baseUrl}/shopper`,
        description: "Shopper account workflow for selltomakemoney.com order requests."
      })
    },
    seller: {
      canonical: `${baseUrl}/sell`,
      title: "Seller Workspace | selltomakemoney.com",
      description: "Approved sellers on selltomakemoney.com can upload photos, submit listings, and track marketplace items in a separate workspace.",
      ogDescription: "Seller workspace for approved accounts to submit and manage marketplace inventory.",
      twitterTitle: "Seller Workspace | selltomakemoney.com",
      twitterDescription: "Approved sellers can submit and manage inventory in a separate seller workspace.",
      keywords: `${sharedKeywords}, seller workspace, marketplace submissions, listing workflow`,
      pageJsonLd: safeJsonScript({
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Seller Workspace | selltomakemoney.com",
        url: `${baseUrl}/sell`,
        description: "Separate seller workspace for approved marketplace inventory submissions."
      })
    }
  };
  const meta = routeMap[entryRoute] || routeMap.store;
  return {
    ...meta,
    jsonLd: `<script type="application/ld+json">${meta.pageJsonLd}</script>\n  <script type="application/ld+json">${organizationJsonLd}</script>`
  };
}

async function sendDesktopApp(req, res) {
  await recordSiteVisit(req, res, "/desktop");
  res.type("html").send(appHtml("desktop", "store"));
}

async function sendMobileApp(req, res) {
  await recordSiteVisit(req, res, "/mobile");
  res.type("html").send(appHtml("mobile", "store"));
}

async function sendMobileListWithUsApp(req, res) {
  await recordSiteVisit(req, res, "/m/list-with-us");
  res.type("html").send(appHtml("mobile", "sellwithus"));
}

async function sendDealerApp(req, res) {
  await recordSiteVisit(req, res, "/dealer");
  res.type("html").send(appHtml(isMobileRequest(req) ? "mobile" : "desktop", "dealer"));
}

async function sendMobileDealerApp(req, res) {
  await recordSiteVisit(req, res, "/m/dealer");
  res.type("html").send(appHtml("mobile", "dealer"));
}

async function sendShopperApp(req, res) {
  await recordSiteVisit(req, res, "/shopper");
  res.type("html").send(appHtml(isMobileRequest(req) ? "mobile" : "desktop", "shopper"));
}

async function sendMobileShopperApp(req, res) {
  await recordSiteVisit(req, res, "/m/shopper");
  res.type("html").send(appHtml("mobile", "shopper"));
}

async function sendSellerApp(req, res) {
  await recordSiteVisit(req, res, "/sell");
  res.type("html").send(appHtml(isMobileRequest(req) ? "mobile" : "desktop", "seller"));
}

async function sendMobileSellerApp(req, res) {
  await recordSiteVisit(req, res, "/m/sell");
  res.type("html").send(appHtml("mobile", "seller"));
}

async function sendListWithUsApp(req, res) {
  await recordSiteVisit(req, res, "/list-with-us");
  res.type("html").send(appHtml(isMobileRequest(req) ? "mobile" : "desktop", "sellwithus"));
}

async function sendAdminApp(req, res) {
  await recordSiteVisit(req, res, "/admin");
  res.type("html").send(appHtml(isMobileRequest(req) ? "mobile" : "desktop", "admin"));
}

async function sendAdminFacebookApp(req, res) {
  await recordSiteVisit(req, res, "/admin/facebookmobile");
  res.type("html").send(appHtml(isMobileRequest(req) ? "mobile" : "desktop", "facebook"));
}

async function sendCatalog(req, res) {
  await recordSiteVisit(req, res, "/catalog");
  res.sendFile(path.join(ROOT, "public", "catalog.html"));
}

async function sendDealers(req, res) {
  await recordSiteVisit(req, res, "/dealers");
  res.sendFile(path.join(ROOT, "public", "dealers.html"));
}

async function sendPrivacyPage(req, res) {
  await recordSiteVisit(req, res, "/privacy");
  res.type("html").send(renderInfoPage({
    title: "Privacy",
    description: "Privacy notice for selltomakemoney.com visitor analytics, account data, checkout requests, and inventory activity tracking.",
    eyebrow: "Privacy",
    heading: "Visitor tracking notice",
    intro: "When you use selltomakemoney.com, we collect operational and analytics data to run the site, protect it, understand traffic, and see which listings are drawing interest.",
    sections: [
      {
        heading: "What we track",
        bullets: [
          "Visits to the site and product pages",
          "A first-party visitor cookie used to recognize return visits and track on-site activity",
          "IP address",
          "Approximate city, region, and country derived from IP address",
          "Device type, browser, operating system, and user agent",
          "Referrer, last page visited, and timestamps",
          "Interaction events such as search, category filters, share clicks, product detail clicks, add to cart, and checkout start when analytics is allowed",
          "Account, cart, checkout, and inquiry activity when you choose to use those features"
        ]
      },
      {
        heading: "Why we track it",
        bullets: [
          "To keep the site running and defend against abuse",
          "To understand return visitors and listing interest",
          "To improve catalog layout, checkout flow, and product merchandising",
          "To support customer service, follow-up, and order handling"
        ]
      },
      {
        heading: "How it is used",
        paragraphs: [
          "We use this data as first-party site analytics and operational logging. We may review aggregate traffic, per-listing popularity, visitor journeys, and recent interaction activity in the admin tools."
        ]
      },
      {
        heading: "Your use of the site",
        paragraphs: [
          "You can choose analytics-enabled tracking or essential-only tracking through the banner shown on the site. If you do not want this information collected, please do not use the site."
        ]
      },
      {
        heading: "Questions",
        paragraphs: [
          "For privacy questions, contact the site operator through the contact details shared during checkout or account communication."
        ]
      }
    ]
  }));
}

async function sendAboutPage(req, res) {
  await recordSiteVisit(req, res, "/about");
  res.type("html").send(renderInfoPage({
    title: "About",
    description: "About selltomakemoney.com, a Mississauga-based inventory and local pickup storefront focused on scooters, electronics, tools, home items, and hard-to-find deals.",
    eyebrow: "About",
    heading: "Real inventory, local pickup, and direct follow-up.",
    intro: "selltomakemoney.com is built to help shoppers reserve real inventory fast instead of fighting marketplace noise. We focus on deals, overstock, inventory finds, and products that can be picked up in Mississauga or shipped when available.",
    sections: [
      {
        heading: "What we sell",
        paragraphs: [
          "Inventory changes often, but the catalog regularly includes scooters, electronics, tools, safes, home items, and other local deals."
        ]
      },
      {
        heading: "How buying works",
        bullets: [
          "Browse available inventory online",
          "Reserve the item you want",
          "We follow up with pickup or shipping details",
          "Most items are paid by e-transfer or cash on pickup"
        ]
      },
      {
        heading: "Why shoppers use us",
        bullets: [
          "Visible pricing",
          "Local pickup in Mississauga",
          "Direct follow-up from a real person",
          "Inventory that is priced to move"
        ]
      }
    ]
  }));
}

async function sendContactPage(req, res) {
  await recordSiteVisit(req, res, "/contact");
  res.type("html").send(renderInfoPage({
    title: "Contact",
    description: "Contact selltomakemoney.com for product questions, pickup timing, shipping availability, and reservation support.",
    eyebrow: "Contact",
    heading: "Questions before you reserve?",
    intro: "If you want to confirm availability, pickup timing, or item condition before reserving, use the details below and we will point you in the right direction.",
    sections: [
      {
        heading: "Fastest way to reach us",
        paragraphs: [
          "Use the reservation form on the cart page for the item you want. That gives us the product, your contact details, and your pickup note in one place."
        ]
      },
      {
        heading: "Support details",
        bullets: [
          "Email: support@selltomakemoney.com",
          "Pickup area: Mississauga, Ontario",
          "Response type: direct follow-up after reservation or inquiry"
        ]
      },
      {
        heading: "Good reasons to contact us first",
        bullets: [
          "You want to confirm pickup timing",
          "You need to know whether an item can be shipped",
          "You have a condition or compatibility question",
          "You want to reserve more than one item"
        ]
      }
    ]
  }));
}

async function sendFaqPage(req, res) {
  await recordSiteVisit(req, res, "/faq");
  res.type("html").send(renderInfoPage({
    title: "FAQ",
    description: "Frequently asked questions about reserving items, Mississauga pickup, shipping availability, and payment on selltomakemoney.com.",
    eyebrow: "FAQ",
    heading: "Frequently asked questions",
    intro: "Here are the answers shoppers usually need before reserving an item.",
    sections: [
      {
        heading: "Do I pay online?",
        paragraphs: [
          "Most items are reserved online and paid by e-transfer or cash on pickup. If an item is available for shipping, we will confirm that separately."
        ]
      },
      {
        heading: "Where do pickups happen?",
        paragraphs: [
          "Pickups are arranged in Mississauga, Ontario after we confirm your request."
        ]
      },
      {
        heading: "Can items be shipped?",
        paragraphs: [
          "Some items can be shipped across Canada depending on size, handling, and the product itself. The product page or follow-up message will confirm that."
        ]
      },
      {
        heading: "How do I know if something is still available?",
        paragraphs: [
          "Send a reservation request through the cart. We will follow up to confirm availability and next steps."
        ]
      }
    ]
  }));
}

async function sendReturnsPage(req, res) {
  await recordSiteVisit(req, res, "/returns");
  res.type("html").send(renderInfoPage({
    title: "Returns",
    description: "Returns and reservation guidance for selltomakemoney.com pickup and select shippable inventory.",
    eyebrow: "Returns",
    heading: "Pickup reservations should feel clear and fair.",
    intro: "Because many items are local pickup inventory finds, the most important step is confirming the item details before pickup. If something is not as described, contact us before pickup so we can review it with you.",
    sections: [
      {
        heading: "Before pickup",
        bullets: [
          "Review the product page carefully",
          "Ask questions if you need to confirm condition or fit",
          "Wait for pickup confirmation before making plans"
        ]
      },
      {
        heading: "If there is a problem",
        paragraphs: [
          "If an item is materially different from the listing, contact us before pickup or immediately after a shipped order arrives so we can review the issue."
        ]
      },
      {
        heading: "Best next step",
        paragraphs: [
          "Use the contact details on the Contact page or reply through the same reservation conversation so we can match your question to the item quickly."
        ]
      }
    ]
  }));
}

async function sendShippingPage(req, res) {
  await recordSiteVisit(req, res, "/shipping");
  res.type("html").send(renderInfoPage({
    title: "Shipping",
    description: "Shipping and local pickup information for selltomakemoney.com inventory in Mississauga and select shippable items across Canada.",
    eyebrow: "Shipping",
    heading: "Pickup first, shipping when available.",
    intro: "Most items on selltomakemoney.com are reserved online and picked up in Mississauga. Some items can also be shipped across Canada depending on the product.",
    sections: [
      {
        heading: "Local pickup",
        bullets: [
          "Pickup details are confirmed after your reservation request",
          "Payment is usually by e-transfer or cash on pickup",
          "Use the pickup note field to share your preferred timing"
        ]
      },
      {
        heading: "Shipping availability",
        paragraphs: [
          "Shipping depends on the item size, handling requirements, and listing details. If shipping is available, we will confirm the next steps before the order moves forward."
        ]
      },
      {
        heading: "What to expect",
        paragraphs: [
          "Reserve first, then wait for a follow-up with pickup or shipping confirmation. That helps us avoid over-promising on inventory that moves quickly."
        ]
      }
    ]
  }));
}

async function sendTermsPage(req, res) {
  await recordSiteVisit(req, res, "/terms");
  res.type("html").send(renderInfoPage({
    title: "Terms",
    description: "Terms for using selltomakemoney.com, reserving products, and arranging pickup or shipping.",
    eyebrow: "Terms",
    heading: "Basic terms for browsing and reserving inventory",
    intro: "By using selltomakemoney.com, you agree to use the site for legitimate browsing, reservation requests, and communication about available inventory.",
    sections: [
      {
        heading: "Inventory and pricing",
        bullets: [
          "Listings may change as inventory changes",
          "Availability is not final until your request is confirmed",
          "Prices and item details may be updated if a listing needs correction"
        ]
      },
      {
        heading: "Reservations",
        bullets: [
          "Submitting a reservation request does not guarantee the item until it is confirmed",
          "Pickup and shipping details are handled after follow-up",
          "Incomplete or abusive requests may be declined"
        ]
      },
      {
        heading: "Site use",
        paragraphs: [
          "Do not misuse the site, interfere with access, or submit false information through account, inquiry, or reservation forms."
        ]
      }
    ]
  }));
}

function renderInfoPage({ title, description, eyebrow, heading, intro, sections = [] }) {
  const currentYear = new Date().getFullYear();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow">
  <title>${escapeHtml(title)} | selltomakemoney.com</title>
  <link rel="stylesheet" href="/styles.css?v=simple-sale-3">
</head>
<body>
  <header class="topbar catalog-topbar">
    <a class="brand" href="/desktop" aria-label="selltomakemoney.com home"><img src="/assets/logo.svg?v=simple-sale-3" alt="selltomakemoney.com"></a>
    <nav>
      <a class="nav-button" href="/desktop">Store</a>
      <a class="nav-button" href="/catalog">Catalog</a>
      <a class="nav-button" href="/dealers">Dealer Info</a>
      <a class="nav-button primary" href="/desktop#cart">Cart</a>
    </nav>
  </header>
  <main>
    <section class="panel privacy-page info-page">
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <h1>${escapeHtml(heading)}</h1>
      <p>${escapeHtml(intro)}</p>
      ${sections.map((section) => `
        <section class="info-section">
          <h2>${escapeHtml(section.heading)}</h2>
          ${Array.isArray(section.paragraphs) ? section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("") : ""}
          ${Array.isArray(section.bullets) && section.bullets.length ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>` : ""}
        </section>
      `).join("")}
    </section>
  </main>
  <footer class="site-footer">
    <div class="footer-trust">
      <strong>Local pickup in Mississauga</strong>
      <span>Reserve online, pay on pickup, and get direct follow-up from a real person.</span>
    </div>
    <nav class="footer-links" aria-label="Support links">
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
      <a href="/shipping">Shipping</a>
      <a href="/returns">Returns</a>
      <a href="/faq">FAQ</a>
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
    </nav>
    <div>Copyright &copy; ${currentYear} selltomakemoney.com. All rights reserved.</div>
  </footer>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatProductDescriptionHtml(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (!blocks.length) return "";
  return `
    <div class="product-description">
      ${blocks.map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`).join("")}
    </div>
  `;
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
    "Disallow: /admin",
    "Disallow: /admin/",
    "Disallow: /dealer",
    "Disallow: /dealer/",
    "Disallow: /sell",
    "Disallow: /sell/",
    "Disallow: /shopper",
    "Disallow: /shopper/",
    "Disallow: /mobile",
    "Disallow: /m",
    "Disallow: /m/",
    "Disallow: /api/",
    `Sitemap: ${baseUrl}/sitemap.xml`,
    ""
  ].join("\n"));
});

app.get("/sitemap.xml", async (req, res) => {
  const baseUrl = publicBaseUrl(req).replace(/\/$/, "");
  const products = await db.listProducts({ activeOnly: true });
  const staticUrls = [
    { path: "", changefreq: "daily", priority: "1.0" },
    { path: "/catalog", changefreq: "daily", priority: "0.9" },
    { path: "/list-with-us", changefreq: "weekly", priority: "0.8" },
    { path: "/dealers", changefreq: "monthly", priority: "0.6" },
    { path: "/about", changefreq: "monthly", priority: "0.5" },
    { path: "/contact", changefreq: "monthly", priority: "0.5" },
    { path: "/faq", changefreq: "monthly", priority: "0.4" },
    { path: "/shipping", changefreq: "monthly", priority: "0.4" },
    { path: "/returns", changefreq: "monthly", priority: "0.4" },
    { path: "/terms", changefreq: "yearly", priority: "0.3" },
    { path: "/privacy", changefreq: "yearly", priority: "0.3" }
  ];
  const productUrls = products.map((product) => ({
    path: productPath(product),
    changefreq: "weekly",
    priority: "0.7",
    lastmod: product.createdAt ? new Date(product.createdAt).toISOString() : ""
  }));
  const urls = [...staticUrls, ...productUrls];
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${baseUrl}${url.path}</loc>${url.lastmod ? `<lastmod>${url.lastmod}</lastmod>` : ""}<changefreq>${url.changefreq}</changefreq><priority>${url.priority}</priority></url>`).join("\n")}
</urlset>`);
});

if (GOOGLE_SITE_VERIFICATION_FILE) {
  app.get(`/${GOOGLE_SITE_VERIFICATION_FILE}`, (_req, res) => {
    const content = GOOGLE_SITE_VERIFICATION_CONTENT || `google-site-verification: ${GOOGLE_SITE_VERIFICATION_FILE}`;
    res.type("text/plain").send(content);
  });
}

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
    accountType: user.accountType || (user.role === "admin" ? "admin" : "shopper"),
    canSeePrices: user.role === "admin" || (user.status === "approved" && (user.accountType || "shopper") === "dealer"),
    canListItems: user.role === "admin" || (user.status === "approved" && (user.accountType || "shopper") === "seller")
  };
}

function consentPayload(req) {
  const consent = readConsent(req) || "";
  return {
    consent,
    analyticsEnabled: consent === "analytics"
  };
}

const HIDDEN_PRODUCT_SPEC_KEYS = new Set(["cost", "sourceNotes", "stockHistory", "listingStatus", "marketplaceStatus"]);
const PRODUCT_SPEC_LABELS = {
  model: "Model",
  condition: "Condition",
  color: "Color",
  material: "Material",
  fulfillmentType: "Fulfillment",
  asin: "ASIN",
  manufacturer: "Manufacturer",
  manufacturerPartNumber: "Manufacturer Part Number",
  partNumber: "Part Number",
  itemModelNumber: "Item Model Number",
  size: "Size",
  style: "Style",
  pattern: "Pattern",
  finishType: "Finish Type",
  itemForm: "Item Form",
  scent: "Scent",
  flavor: "Flavor",
  unitCount: "Unit Count",
  countPerPack: "Count Per Pack",
  itemPackageQuantity: "Package Quantity",
  numberOfItems: "Number of Items",
  capacity: "Capacity",
  volume: "Volume",
  wattage: "Wattage",
  voltage: "Voltage",
  amperage: "Amperage",
  horsepower: "Horsepower",
  powerSource: "Power Source",
  connectivityTechnology: "Connectivity Technology",
  wirelessCommunicationTechnology: "Wireless Communication",
  specialFeature: "Special Feature",
  compatibility: "Compatibility",
  includedComponents: "Included Components",
  targetAudience: "Target Audience",
  ageRangeDescription: "Age Range",
  department: "Department",
  assemblyRequired: "Assembly Required",
  warrantyDescription: "Warranty",
  batteriesRequired: "Batteries Required",
  batteriesIncluded: "Batteries Included",
  batteryCellType: "Battery Cell Type",
  countryOfOrigin: "Country of Origin",
  dateFirstAvailable: "Date First Available",
  releaseDate: "Release Date",
  itemDimensionsLxWxH: "Item Dimensions",
  packageDimensionsLxWxH: "Package Dimensions",
  itemWeight: "Item Weight",
  packageWeight: "Package Weight",
  bulletPoint1: "Feature 1",
  bulletPoint2: "Feature 2",
  bulletPoint3: "Feature 3",
  bulletPoint4: "Feature 4",
  bulletPoint5: "Feature 5",
  bestSellersRank: "Best Sellers Rank"
};
const PRODUCT_SPEC_DISPLAY_ORDER = [
  "asin", "manufacturer", "manufacturerPartNumber", "partNumber", "itemModelNumber",
  "model", "condition", "size", "style", "pattern", "color", "material", "finishType",
  "itemForm", "scent", "flavor", "specialFeature", "compatibility", "includedComponents",
  "targetAudience", "ageRangeDescription", "department", "unitCount", "countPerPack",
  "itemPackageQuantity", "numberOfItems", "capacity", "volume", "powerSource", "wattage",
  "voltage", "amperage", "horsepower", "connectivityTechnology", "wirelessCommunicationTechnology",
  "assemblyRequired", "warrantyDescription", "batteriesRequired", "batteriesIncluded",
  "batteryCellType", "countryOfOrigin", "dateFirstAvailable", "releaseDate",
  "itemDimensionsLxWxH", "packageDimensionsLxWxH", "itemWeight", "packageWeight",
  "bulletPoint1", "bulletPoint2", "bulletPoint3", "bulletPoint4", "bulletPoint5",
  "bestSellersRank"
];

function humanizeProductSpecKey(key) {
  if (PRODUCT_SPEC_LABELS[key]) return PRODUCT_SPEC_LABELS[key];
  return String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function cleanProductSpecValue(value, maxLength = 4000) {
  if (value == null) return "";
  if (Array.isArray(value)) return cleanProductSpecValue(value.filter(Boolean).join(", "), maxLength);
  if (typeof value === "object") {
    try {
      return cleanProductSpecValue(JSON.stringify(value), maxLength);
    } catch (_error) {
      return "";
    }
  }
  return cleanSpec(value, maxLength);
}

function productSpecsLines(product) {
  const specs = publicProductSpecs(product.productSpecs || {});
  const dimensions = [specs.length, specs.width, specs.height].filter(Boolean).join(" x ");
  const baseLines = [
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
  const usedKeys = new Set(["model", "condition", "color", "material", "fulfillmentType", "length", "width", "height", "dimensionUnit", "weight", "weightUnit"]);
  const orderedExtras = PRODUCT_SPEC_DISPLAY_ORDER
    .filter((key) => !usedKeys.has(key))
    .map((key) => specs[key] ? [humanizeProductSpecKey(key), specs[key]] : null)
    .filter(Boolean);
  const remainingExtras = Object.entries(specs)
    .filter(([key, value]) => value && !usedKeys.has(key) && !PRODUCT_SPEC_DISPLAY_ORDER.includes(key))
    .map(([key, value]) => [humanizeProductSpecKey(key), value]);
  return [...baseLines, ...orderedExtras, ...remainingExtras];
}

function fulfillmentLabel(value) {
  return value === "ships_or_pickup" ? "Shipping or Mississauga pickup" : "Mississauga pickup only";
}

function salesBadgeMarkup({ quantityOnHand = 0, viewCount = 0, uniqueViewers = 0, createdAt = "" } = {}) {
  const badges = [];
  const qty = Number(quantityOnHand || 0);
  if (qty > 0 && qty <= 2) badges.push(["Low stock", "low-stock"]);
  if (Number(viewCount || 0) >= 10 || Number(uniqueViewers || 0) >= 5) badges.push(["Popular", "popular"]);
  const created = createdAt ? new Date(createdAt) : null;
  if (created && !Number.isNaN(created.getTime()) && (Date.now() - created.getTime()) <= (1000 * 60 * 60 * 24 * 14)) {
    badges.push(["New arrival", "new-arrival"]);
  }
  if (!badges.length) return "";
  return `<div class="sales-badges">${badges.map(([label, tone]) => `<span class="sales-badge ${tone}">${escapeHtml(label)}</span>`).join("")}</div>`;
}

function publicProductSpecs(specs = {}) {
  return Object.fromEntries(Object.entries(specs || {}).filter(([key]) => !HIDDEN_PRODUCT_SPEC_KEYS.has(key)));
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
  const serialized = typeof json === "string" ? json : JSON.stringify(json);
  return serialized.replaceAll("<", "\\u003c");
}

async function sendProductPage(req, res) {
  const product = await db.getProduct(Number(req.params.id));
  if (!product || !product.active) return res.status(404).send("Product not found.");
  await recordProductView(req, res, product.id);
  const metricsByProductId = await db.getProductMetrics([product.id]);
  const productMetrics = metricsByProductId[product.id] || { viewCount: 0, uniqueViewers: 0 };
  const user = await currentUser(req);
  const showDealerPricing = Boolean(user && (user.role === "admin" || (user.status === "approved" && (user.accountType || "shopper") === "dealer")));
  const baseUrl = publicBaseUrl(req).replace(/\/$/, "");
  const canonicalPath = productPath(product);
  const canonicalUrl = `${baseUrl}${canonicalPath}`;
  const shortUrl = `${baseUrl}${shortProductPath(product)}`;
  const currentYear = new Date().getFullYear();
  const imageUrls = [...new Set([...(product.imageUrls || []), product.imageUrl].filter(Boolean))];
  const mainImage = (imageUrls[0] || "");
  const absoluteImage = mainImage ? new URL(mainImage, baseUrl).toString() : "";
  const price = dollars(product.priceCents);
  const dealerPrice = showDealerPricing ? dollars(product.dealerPriceCents) : null;
  const title = `${product.name} | ${price} | selltomakemoney.com`;
  const description = `${product.brand ? `${product.brand} ` : ""}${product.name}. ${product.description || "Available from selltomakemoney.com."}`.slice(0, 155);
  const specs = productSpecsLines(product);
  const fulfillmentType = product.productSpecs?.fulfillmentType || "pickup_only";
  const fulfillmentText = fulfillmentLabel(fulfillmentType);
  const includedComponents = cleanProductSpecValue(product.productSpecs?.includedComponents || "");
  const conditionText = cleanProductSpecValue(product.productSpecs?.condition || "");
  const productBadges = salesBadgeMarkup({
    quantityOnHand: product.quantityOnHand,
    viewCount: productMetrics.viewCount,
    uniqueViewers: productMetrics.uniqueViewers,
    createdAt: product.createdAt
  });
  const mobileRequest = isMobileRequest(req);
  const homePath = mobileRequest ? "/mobile" : "/desktop";
  const cartPath = `${homePath}#cart`;
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
  <link rel="stylesheet" href="/styles.css?v=simple-sale-3">
</head>
<body>
  <header class="topbar catalog-topbar">
    <a class="brand" href="${homePath}" aria-label="selltomakemoney.com home"><img src="/assets/logo.svg?v=simple-sale-3" alt="selltomakemoney.com"></a>
    <nav><a class="nav-button primary" href="${cartPath}">Cart</a></nav>
  </header>
  <main>
    <article class="product-detail">
      <div class="product-detail-gallery">
        ${imageUrls.length > 1 ? `<div class="product-detail-thumbs" aria-label="Product images">
          ${imageUrls.map((imageUrl, index) => `<button class="product-detail-thumb ${index === 0 ? "active" : ""}" type="button" data-product-thumb="${index}" data-image-src="${escapeHtml(imageUrl)}" aria-label="Show image ${index + 1}">
            <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(`${product.name} image ${index + 1}`)}" loading="lazy" decoding="async">
          </button>`).join("")}
        </div>` : ""}
        <div class="product-detail-media">
          ${mainImage ? `<img id="productDetailMainImage" src="${escapeHtml(mainImage)}" alt="${escapeHtml(product.name)}" loading="eager" decoding="async">` : `<div class="product-image">${escapeHtml(product.brand || product.category || "Product")}</div>`}
        </div>
      </div>
      <section class="product-detail-body">
        <p class="eyebrow">${escapeHtml(product.category || "Available inventory")}</p>
        <h1>${escapeHtml(product.name)}</h1>
        <p class="sku">${escapeHtml([product.brand, product.sku, product.upc ? `UPC ${product.upc}` : ""].filter(Boolean).join(" | "))}</p>
        ${productBadges}
        ${showDealerPricing && dealerPrice
          ? `<div class="product-pricing dealer-pricing">
              <div>
                <span class="pricing-label">Dealer price</span>
                <div class="price dealer-price-emphasis">${escapeHtml(dealerPrice)}</div>
              </div>
              <div>
                <span class="pricing-label">Retail price</span>
                <div class="retail-price-muted">${escapeHtml(price)}</div>
              </div>
            </div>`
          : showDealerPricing
            ? `<div class="product-pricing dealer-pricing">
                <div>
                  <span class="pricing-label">Retail price</span>
                  <div class="price">${escapeHtml(price)}</div>
                </div>
                <div class="dealer-contact-note">Dealer price: contact the person that sent this link.</div>
              </div>`
            : `<div class="price">${escapeHtml(price)}</div>`}
        <div class="fulfillment-alert ${fulfillmentType === "ships_or_pickup" ? "ships" : "pickup"}">${escapeHtml(fulfillmentText)}</div>
        <div class="product-detail-trust compact-sale-trust">
          ${conditionText ? `<div><strong>Condition</strong><span>${escapeHtml(conditionText)}</span></div>` : ""}
          <div><strong>Available</strong><span>${escapeHtml(product.quantityOnHand || 0)} in stock</span></div>
          <div><strong>Payment</strong><span>E-transfer or cash on pickup</span></div>
        </div>
        ${formatProductDescriptionHtml(product.description)}
        <div class="product-detail-cta">
          <button class="nav-button primary" type="button" id="productBuyNow">Reserve item</button>
          <p id="productDetailMessage" class="form-message"></p>
        </div>
      </section>
    </article>
  </main>
  <footer class="site-footer">
    <div class="footer-trust">
      <strong>Reserve online, confirm with a real person</strong>
      <span>Mississauga pickup on most items, plus support pages for shipping, returns, and contact details.</span>
    </div>
    <nav class="footer-links" aria-label="Support links">
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
      <a href="/shipping">Shipping</a>
      <a href="/returns">Returns</a>
      <a href="/faq">FAQ</a>
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
    </nav>
    <div>Copyright &copy; ${currentYear} selltomakemoney.com. All rights reserved.</div>
  </footer>
  <script>
    const detailMessage = document.getElementById('productDetailMessage');
    const galleryThumbs = Array.from(document.querySelectorAll('[data-product-thumb]'));
    const galleryMainImage = document.getElementById('productDetailMainImage');
    document.getElementById('productBuyNow')?.addEventListener('click', () => {
      const cart = JSON.parse(localStorage.getItem('dealerCart') || '[]');
      const item = cart.find((entry) => Number(entry.productId) === ${Number(product.id)});
      if (item) item.quantity = Number(item.quantity || 0) + 1;
      else cart.push({ productId: ${Number(product.id)}, quantity: 1 });
      localStorage.setItem('dealerCart', JSON.stringify(cart));
      window.location.href = '${cartPath}';
    });
    if (galleryMainImage && galleryThumbs.length) {
      galleryThumbs.forEach((thumb) => {
        thumb.addEventListener('click', function () {
          const src = this.dataset.imageSrc || '';
          if (!src) return;
          galleryMainImage.src = src;
          galleryThumbs.forEach((item) => item.classList.toggle('active', item === this));
        });
      });
    }
    async function sendProductInquiry(note, button) {
      detailMessage.textContent = '';
      button.disabled = true;
      const original = button.textContent;
      button.textContent = 'Sending...';
      try {
        const response = await fetch('/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: ${product.id}, quantity: 1, note })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not send request.');
        detailMessage.textContent = 'Request sent. We can follow up on this item.';
        button.textContent = 'Sent';
      } catch (error) {
        if (String(error.message || '').includes('login')) {
          window.location.href = '/desktop#login';
          return;
        }
        detailMessage.textContent = error.message || 'Could not send request.';
        button.disabled = false;
        button.textContent = original;
      }
    }
    document.querySelector('[data-ask-product]')?.addEventListener('click', function () {
      sendProductInquiry(this.dataset.inquiryNote || 'Asked about this item.', this);
    });
    document.querySelector('[data-hold-product]')?.addEventListener('click', function () {
      sendProductInquiry(this.dataset.inquiryNote || 'Please hold this item for pickup.', this);
    });
  </script>
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

async function requireSeller(req, res, next) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "Please login first." });
  if (user.role === "admin") {
    req.user = user;
    return next();
  }
  if (user.status !== "approved") return res.status(403).json({ error: "Your seller account is still pending approval." });
  if ((user.accountType || "shopper") !== "seller") return res.status(403).json({ error: "Seller access required." });
  req.user = user;
  next();
}

async function productPayload(product, showPrice, includeAdminData = false, productMetrics = null) {
  const normalizedCategory = normalizeCategory(product.category, { fallback: "Other" });
  const metrics = productMetrics || { viewCount: 0, uniqueViewers: 0 };
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
    quantityOnHand: Number(product.quantityOnHand || 0),
    createdAt: product.createdAt || "",
    recommendedAddonIds: product.recommendedAddonIds || [],
    priceCents: product.priceCents,
    price: dollars(product.priceCents),
    dealerPriceCents: showPrice ? product.dealerPriceCents : null,
    dealerPrice: showPrice ? dollars(product.dealerPriceCents) : null,
    viewCount: Number(metrics.viewCount || 0),
    uniqueViewers: Number(metrics.uniqueViewers || 0),
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
    ownerUserId: product.ownerUserId ?? null,
    sourceUrl: product.sourceUrl || "",
    quantityOnHand: product.quantityOnHand || 0,
    viewCount: Number(metrics.viewCount || 0),
    uniqueViewers: Number(metrics.uniqueViewers || 0),
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

function facebookBridgeAccounts() {
  try {
    const accounts = JSON.parse(FACEBOOK_BRIDGE_ACCOUNTS_JSON);
    if (Array.isArray(accounts) && accounts.length) {
      return accounts
        .map((account) => ({
          id: String(account.id || "").trim(),
          label: String(account.label || account.id || "").trim(),
          facebookProfileId: String(account.facebookProfileId || "").trim()
        }))
        .filter((account) => account.id);
    }
  } catch (_error) {
    // Use default below.
  }
  return [{ id: FACEBOOK_BRIDGE_DEFAULT_ACCOUNT_ID, label: "Prathab Personal", facebookProfileId: process.env.DEFAULT_FACEBOOK_PROFILE_ID || "" }];
}

function facebookBridgeAccountFor(id) {
  const accounts = facebookBridgeAccounts();
  return accounts.find((account) => account.id === id) || accounts[0];
}

function facebookMarketplaceCategory(product) {
  const category = String(product.category || "").toLowerCase();
  if (category.includes("electronics")) return "Electronics & computers";
  if (category.includes("scooter")) return "Electronics & computers";
  if (category.includes("tool")) return "Tools";
  if (category.includes("furniture")) return "Furniture";
  if (category.includes("appliance")) return "Appliances";
  if (category.includes("automotive")) return "Auto parts";
  if (category.includes("clothing")) return "Clothing & Accessories";
  if (category.includes("toy")) return "Toys & Games";
  if (category.includes("home") || category.includes("warehouse") || category.includes("janitorial") || category.includes("safety")) return "Household";
  return "Miscellaneous";
}

function facebookMarketplaceCondition(product) {
  const condition = String(product.productSpecs?.condition || "").toLowerCase();
  if (condition.includes("brand new") || condition.includes("bnib") || condition === "new") return "New";
  if (condition.includes("open box") || condition.includes("refurb")) return "Used - Like New";
  if (condition.includes("fair")) return "Used - Fair";
  return "Used - Good";
}

function facebookBridgeDraftPayload(product, req, accountId) {
  const baseUrl = publicBaseUrl(req).replace(/\/$/, "");
  const account = facebookBridgeAccountFor(accountId);
  const productUrl = `${baseUrl}${shortProductPath(product)}`;
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
    `View item: ${productUrl}`
  ].filter((line, index, lines) => line || lines[index - 1] !== "").join("\n").trim();
  const imageUrls = (product.imageUrls || (product.imageUrl ? [product.imageUrl] : []))
    .map((url) => {
      try {
        return new URL(url, baseUrl).toString();
      } catch (_error) {
        return "";
      }
    })
    .filter(Boolean);

  return {
    source: "selltomakemoney",
    sourceProductId: String(product.id),
    sourceUrl: productUrl,
    facebookAccountId: account.id,
    facebookProfileId: account.facebookProfileId,
    title: String(product.name || "").trim().slice(0, 120),
    price: Number(product.priceCents || 0) / 100,
    category: facebookMarketplaceCategory(product),
    condition: facebookMarketplaceCondition(product),
    availability: "List as Single Item",
    description,
    brand: product.brand || "",
    sku: product.sku || "",
    location: "Mississauga, Ontario, Canada",
    tags: [product.brand, product.category, product.sku, product.upc].filter(Boolean).slice(0, 20),
    images: imageUrls.slice(0, 10).map((url) => ({ url })),
    meetupPreferences: ["public_meetup"],
    hideFromFriends: true,
    promoteAfterPublish: false,
    notes: `Imported from selltomakemoney.com product ${product.id}. Review before local Facebook fill.`
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

function cleanPhone(value, label = "Phone", { required = true } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    if (!required) return "";
    throw new Error(`${label} is required.`);
  }
  const normalized = raw.replace(/[^\d+]/g, "");
  const digitCount = normalized.replace(/\D/g, "").length;
  if (digitCount < 10) throw new Error(`${label} must include at least 10 digits.`);
  return normalized.slice(0, 24);
}

function formatAccountTypeLabel(accountType) {
  if (accountType === "dealer") return "Dealer";
  if (accountType === "seller") return "Seller";
  if (accountType === "admin") return "Admin";
  return "Shopper";
}

function canSendWhatsappNotifications() {
  return Boolean(WHATSAPP_ACCESS_TOKEN && WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_NOTIFY_TO);
}

function canSendTelegramNotifications() {
  return Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_NOTIFY_CHAT_ID);
}

function formatCurrency(cents) {
  const value = Number(cents || 0) / 100;
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD"
  }).format(value);
}

async function sendTelegramSignupNotification(user) {
  if (!canSendTelegramNotifications()) return { skipped: true, reason: "missing_config" };
  const accountTypeLabel = formatAccountTypeLabel(user.accountType);
  const messageLines = [
    `New signup on ${TELEGRAM_PROJECT_NAME}`,
    `Type: ${accountTypeLabel}`,
    `Name: ${user.contactName || "-"}`,
    `Company: ${user.company || "-"}`,
    `Email: ${user.email || "-"}`,
    `Phone: ${user.phone || "-"}`,
    `Status: ${user.status || "pending"}`
  ];
  return telegramProjectBot.notify(messageLines.join("\n"));
}

async function sendTelegramAlertLeadNotification(lead) {
  if (!canSendTelegramNotifications()) return { skipped: true, reason: "missing_config" };
  const messageLines = [
    `New alert signup on ${TELEGRAM_PROJECT_NAME}`,
    `Name: ${lead.contactName || [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "-"}`,
    `Email: ${lead.email || "-"}`,
    `Phone: ${lead.phone || "-"}`,
    `Interests: ${lead.interests || "-"}`,
    `Source: ${lead.source || "store"}`
  ];
  return telegramProjectBot.notify(messageLines.join("\n"));
}

async function sendTelegramOrderNotification(order, user = {}) {
  if (!canSendTelegramNotifications()) return { skipped: true, reason: "missing_config" };
  const itemsSummary = Array.isArray(order.items)
    ? order.items.slice(0, 4).map((item) => `${item.quantity}x ${item.name}`).join(", ")
    : "";
  const shipTo = order.shipTo || {};
  const messageLines = [
    `New order #${order.id || "-"}`,
    `Customer: ${user.contactName || shipTo.recipientName || "-"}`,
    `Company: ${user.company || shipTo.company || "-"}`,
    `Email: ${user.email || shipTo.email || "-"}`,
    `Phone: ${shipTo.phone || user.phone || "-"}`,
    `Fulfillment: ${shipTo.fulfillmentMethod || "-"}`,
    `Payment: ${shipTo.paymentMethod || "-"}`,
    `Subtotal: ${formatCurrency(order.subtotalCents)}`,
    `Items: ${itemsSummary || "-"}`
  ];
  return telegramProjectBot.notify(messageLines.join("\n"));
}

async function telegramStatusMessage() {
  const summary = await db.summary();
  return [
    `${TELEGRAM_PROJECT_NAME} status`,
    `Pending users: ${summary.pendingUsers || 0}`,
    `New orders: ${summary.orders || 0}`,
    `New inquiries: ${summary.inquiries || 0}`,
    `Alert leads: ${summary.alertLeads || 0}`,
    `Bug reports: ${summary.bugReports || 0}`,
    `Products: ${summary.products || 0}`,
    `Site visits: ${summary.siteVisits || 0}`,
    `Unique visitors: ${summary.uniqueVisitors || 0}`,
    `Listing views: ${summary.listingViews || 0}`
  ].join("\n");
}

const telegramProjectBot = createTelegramProjectBot({
  botToken: TELEGRAM_BOT_TOKEN,
  defaultChatId: TELEGRAM_NOTIFY_CHAT_ID,
  defaultMessageThreadId: TELEGRAM_MESSAGE_THREAD_ID,
  webhookSecret: TELEGRAM_WEBHOOK_SECRET,
  projectName: TELEGRAM_PROJECT_NAME,
  getStatusMessage: telegramStatusMessage
});

async function sendWhatsappSignupNotification(user) {
  if (!canSendWhatsappNotifications()) return { skipped: true, reason: "missing_config" };
  const endpoint = `https://graph.facebook.com/v23.0/${encodeURIComponent(WHATSAPP_PHONE_NUMBER_ID)}/messages`;
  const accountTypeLabel = formatAccountTypeLabel(user.accountType);
  const messageLines = [
    "New signup on selltomakemoney.com",
    `Type: ${accountTypeLabel}`,
    `Name: ${user.contactName || "-"}`,
    `Company: ${user.company || "-"}`,
    `Email: ${user.email || "-"}`,
    `Phone: ${user.phone || "-"}`,
    `Status: ${user.status || "pending"}`
  ];
  const templatePayload = WHATSAPP_TEMPLATE_NAME
    ? {
        messaging_product: "whatsapp",
        to: WHATSAPP_NOTIFY_TO,
        type: "template",
        template: {
          name: WHATSAPP_TEMPLATE_NAME,
          language: { code: WHATSAPP_TEMPLATE_LANGUAGE },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: messageLines.join(" | ") }]
            }
          ]
        }
      }
    : {
        messaging_product: "whatsapp",
        to: WHATSAPP_NOTIFY_TO,
        type: "text",
        text: { preview_url: false, body: messageLines.join("\n") }
      };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(templatePayload)
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`WhatsApp notify failed: ${response.status} ${errorBody}`.trim());
  }
  return response.json().catch(() => ({ ok: true }));
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
  const cleaned = typeof value === "string" ? value.replace(/[^0-9.-]/g, "") : value;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : fallback;
}

function centsValueFromInput(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const cleaned = typeof value === "string" ? value.replace(/[^0-9-]/g, "") : value;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : fallback;
}

function dollarsNumber(cents) {
  if (cents === undefined || cents === null || cents === "") return null;
  const amount = Number(cents);
  return Number.isFinite(amount) ? Math.round(amount) / 100 : null;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvValue(value) {
  return value == null ? "" : String(value);
}

function exportProductsCsv(products) {
  const headers = [
    "id", "name", "brand", "sku", "upc", "category", "description",
    "price", "dealerPrice", "quantityOnHand", "active", "sourceUrl",
    "condition", "fulfillmentType", "listingStatus", "marketplaceStatus",
    "model", "color", "material", "length", "width", "height",
    "dimensionUnit", "weight", "weightUnit", "cost", "sourceNotes",
    "productSpecsJson", "imageUrl", "imageUrls", "recommendedAddonIds"
  ];
  const lines = [headers.join(",")];
  for (const product of products) {
    const specs = product.productSpecs || {};
    const row = [
      product.id,
      product.name,
      product.brand,
      product.sku,
      product.upc,
      product.category,
      product.description,
      dollarsNumber(product.priceCents) ?? "",
      dollarsNumber(product.dealerPriceCents) ?? "",
      Math.max(0, Math.floor(Number(product.quantityOnHand || 0))),
      product.active ? "true" : "false",
      product.sourceUrl || "",
      specs.condition || "",
      specs.fulfillmentType || "",
      specs.listingStatus || "",
      specs.marketplaceStatus || "",
      specs.model || "",
      specs.color || "",
      specs.material || "",
      specs.length || "",
      specs.width || "",
      specs.height || "",
      specs.dimensionUnit || "",
      specs.weight || "",
      specs.weightUnit || "",
      specs.cost || "",
      specs.sourceNotes || "",
      JSON.stringify(product.productSpecs || {}),
      product.imageUrl || "",
      (product.imageUrls || []).join("|"),
      (product.recommendedAddonIds || []).join("|")
    ].map((value) => csvEscape(csvValue(value)));
    lines.push(row.join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

function importField(source, fallbackValue, ...keys) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
  }
  return fallbackValue;
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\r") continue;
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => String(value || "").trim() !== ""));
}

function importProductsFromCsv(text) {
  const cleaned = String(text || "").replace(/^\uFEFF/, "");
  const rows = parseCsvText(cleaned);
  if (rows.length < 2) throw new Error("No product rows were found in the CSV file.");
  const headers = rows[0].map((value) => String(value || "").trim());
  const products = rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  if (!products.length) throw new Error("No product rows were found in the CSV file.");
  return products;
}

function parseImportedProductSpecs(productSpecsJson, productSpecsObject) {
  if (productSpecsObject && typeof productSpecsObject === "object" && !Array.isArray(productSpecsObject)) {
    return productSpecsObject;
  }
  const text = String(productSpecsJson || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function productSpecsFromBody(body, fallback = {}) {
  const existingHistory = Array.isArray(fallback.stockHistory) ? fallback.stockHistory : [];
  const importedSpecs = parseImportedProductSpecs(body.productSpecsJson, body.productSpecs);
  const specs = {
    ...Object.fromEntries(Object.entries(fallback || {}).filter(([key]) => key !== "stockHistory")),
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
  Object.entries(importedSpecs).forEach(([key, value]) => {
    if (value == null || value === "") return;
    if (key === "stockHistory") return;
    specs[key] = cleanProductSpecValue(value);
  });
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
    userId: req.user?.id || null,
    items,
    shipTo,
    subtotalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0),
    note: cleanOptional(req.body.note, 1000)
  };
}

function integrationBearerToken(req) {
  const header = String(req.get("authorization") || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function requireProductListingPull(req, res, next) {
  if (!PRODUCT_LISTING_PULL_API_KEY) {
    return res.status(503).json({ error: "Product Listing Pull integration is not configured." });
  }
  if (integrationBearerToken(req) !== PRODUCT_LISTING_PULL_API_KEY) {
    return res.status(401).json({ error: "Invalid Product Listing Pull token." });
  }
  next();
}

function firstDetail(payload, ...keys) {
  const details = payload.product_details && typeof payload.product_details === "object" ? payload.product_details : {};
  const normalized = Object.fromEntries(Object.entries(details).map(([key, value]) => [String(key).trim().toLowerCase(), value]));
  for (const key of keys) {
    const direct = details[key];
    const normalizedValue = normalized[String(key).trim().toLowerCase()];
    const value = direct || normalizedValue;
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function optionalCleanUpc(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return cleanUpc(text);
  } catch (_error) {
    return "";
  }
}

function listingPullSpecs(payload) {
  const details = payload.product_details && typeof payload.product_details === "object" ? payload.product_details : {};
  const bullets = Array.isArray(payload.bullet_points) ? payload.bullet_points : [];
  const publishLive = payload.publish === true || String(payload.listing_mode || "").toLowerCase() === "live";
  const sourceSite = String(payload.source_site || "").trim();
  const specs = {
    asin: String(payload.amazon_sku || "").trim(),
    sourceSite,
    sourceSku: String(payload.product_sku || payload.amazon_sku || "").trim(),
    condition: cleanCondition(payload.condition, "Brand New In Box (BNIB)"),
    model: firstDetail(payload, "Model Number", "Model number", "Model", "Model Name", "Item model number"),
    manufacturer: firstDetail(payload, "Manufacturer", "Brand Name", "Brand"),
    manufacturerPartNumber: firstDetail(payload, "Manufacturer Part Number", "Part Number"),
    partNumber: firstDetail(payload, "Part Number"),
    itemModelNumber: firstDetail(payload, "Item model number", "Model Number", "Model number"),
    unitCount: firstDetail(payload, "Unit Count"),
    countryOfOrigin: firstDetail(payload, "Country of Origin"),
    warrantyDescription: firstDetail(payload, "Warranty Description"),
    fulfillmentType: "pickup_only",
    listingStatus: publishLive ? "listed" : "draft",
    marketplaceStatus: publishLive ? "listed" : "not_listed",
    sourceNotes: publishLive
      ? "Imported from Product Listing Pull and listed live by integration token. Review price, inventory, condition, and images."
      : "Imported from Product Listing Pull. Review price, inventory, condition, and images before publishing."
  };
  bullets.slice(0, 5).forEach((bullet, index) => {
    specs[`bulletPoint${index + 1}`] = cleanProductSpecValue(bullet, 500);
  });
  Object.entries(details).forEach(([key, value]) => {
    const normalizedKey = String(key || "")
      .trim()
      .replace(/[^a-zA-Z0-9]+(.)/g, (_match, char) => char.toUpperCase())
      .replace(/^[A-Z]/, (char) => char.toLowerCase());
    if (!normalizedKey || specs[normalizedKey]) return;
    specs[normalizedKey] = cleanProductSpecValue(value);
  });
  return Object.fromEntries(Object.entries(specs).filter(([, value]) => value));
}

function listingPullProductRecord(payload, existing = {}) {
  const publishLive = payload.publish === true || String(payload.listing_mode || "").toLowerCase() === "live";
  const imageUrls = Array.isArray(payload.image_urls)
    ? payload.image_urls.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const title = cleanRequired(payload.title, "Product title", 180);
  const brand = firstDetail(payload, "Brand Name", "Brand", "Manufacturer");
  const sku = String(payload.amazon_sku || payload.product_sku || existing.sku || "").trim();
  const upc = optionalCleanUpc(firstDetail(payload, "UPC", "Global Trade Identification Number", "GTIN", "GTIN-12") || existing.upc || "");
  const descriptionParts = [
    String(payload.description || "").trim(),
    ...(Array.isArray(payload.bullet_points) ? payload.bullet_points : []).map((bullet) => `- ${String(bullet || "").trim()}`)
  ].filter(Boolean);
  const importedSpecs = listingPullSpecs(payload);
  return {
    name: title,
    sku,
    upc,
    brand,
    category: inferCategoryFromListing({ name: title, brand, description: descriptionParts.join("\n") }),
    description: descriptionParts.join("\n").slice(0, 5000),
    priceCents: centsValueFromInput(payload.price_cents ?? payload.priceCents, centsFromInput(payload.price, existing.priceCents ?? 0)),
    dealerPriceCents: existing.dealerPriceCents ?? null,
    imageUrl: imageUrls[0] || existing.imageUrl || "",
    imageUrls: imageUrls.length ? imageUrls : (existing.imageUrls || (existing.imageUrl ? [existing.imageUrl] : [])),
    sourceUrl: String(payload.url || existing.sourceUrl || "").trim(),
    quantityOnHand: Math.max(0, Math.floor(Number(existing.quantityOnHand || 0))),
    ownerUserId: existing.ownerUserId ?? null,
    productSpecs: appendStockHistory(productSpecsFromBody({ ...importedSpecs, productSpecsJson: JSON.stringify(importedSpecs) }, existing.productSpecs || {}), existing.quantityOnHand || 0, existing.quantityOnHand || 0, existing.id ? "product listing pull update" : "product listing pull import"),
    recommendedAddonIds: existing.recommendedAddonIds || [],
    active: publishLive
  };
}

app.get("/api/session", async (req, res) => {
  res.json({ user: publicUser(await currentUser(req)), consent: consentPayload(req) });
});

app.post("/api/consent", (req, res) => {
  const consent = String(req.body.consent || "").trim().toLowerCase();
  if (!["analytics", "essential"].includes(consent)) {
    return res.status(400).json({ error: "Choose analytics or essential." });
  }
  setConsent(res, consent);
  res.json({ ok: true, consent: { consent, analyticsEnabled: consent === "analytics" } });
});

app.post("/api/register", async (req, res) => {
  const { email, password, company, contactName, phone } = req.body;
  if (!email || !password || !company || !contactName || !phone) {
    return res.status(400).json({ error: "Email, password, company, contact name, and phone are required." });
  }
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  const cleanEmail = email.toLowerCase().trim();
  const requestedAccountType = normalizeAccountType(req.body.accountType, "shopper");
  if (await db.getUserByEmail(cleanEmail)) return res.status(409).json({ error: "That email is already registered." });
  const createdUser = await db.createUser({
    email: cleanEmail,
    passwordHash: await bcrypt.hash(password, 12),
    company: company.trim(),
    contactName: contactName.trim(),
    phone: cleanPhone(phone),
    status: "pending",
    role: "dealer",
    accountType: requestedAccountType
  });
  try {
    await sendWhatsappSignupNotification(createdUser);
  } catch (error) {
    console.error(error);
  }
  try {
    await sendTelegramSignupNotification(createdUser);
  } catch (error) {
    console.error(error);
  }
  res.status(201).json({ ok: true, message: requestedAccountType === "seller"
    ? "Seller application received. Your account will be reviewed and approved in the next admin review window before you can list items."
    : "Registration sent. Your account will be reviewed and approved in the next admin review window." });
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
    const createdLead = await db.createAlertLead({ email, firstName, lastName, contactName, phone, interests, source });
    try {
      await sendTelegramAlertLeadNotification(createdLead);
    } catch (error) {
      console.error(error);
    }
    res.status(201).json({ ok: true, message: "You are on the alert list. We will send updates when new items are available." });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not save alert signup." });
  }
});

app.post("/api/track", async (req, res) => {
  const type = String(req.body.type || "").trim();
  if (!type) return res.status(400).json({ error: "Tracking event type is required." });
  await recordInteractionEvent(req, res, {
    type,
    path: req.body.path || req.path,
    productId: req.body.productId,
    label: req.body.label,
    value: req.body.value
  });
  res.json({ ok: true, consent: consentPayload(req) });
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
  const showPrice = Boolean(user && (user.role === "admin" || (user.status === "approved" && (user.accountType || "shopper") === "dealer")));
  const products = await db.listProducts({ activeOnly: true });
  const metricsByProductId = await db.getProductMetrics(products.map((product) => product.id));
  res.json({ products: await Promise.all(products.map((product) => productPayload(product, showPrice, false, metricsByProductId[product.id]))), canSeePrices: showPrice });
});

app.get("/api/seller/products", requireSeller, async (req, res) => {
  const products = await db.listProducts({ ownerUserId: req.user.role === "admin" ? undefined : req.user.id });
  const metricsByProductId = await db.getProductMetrics(products.map((product) => product.id));
  res.json({ products: await Promise.all(products.map((product) => productPayload(product, false, true, metricsByProductId[product.id]))) });
});

app.post("/api/seller/products", requireSeller, productImageUpload, async (req, res) => {
  try {
    if (!req.body.name) return res.status(400).json({ error: "Product name is required." });
    const productName = String(req.body.name || "").trim();
    let imageUrls = uploadedImageUrls(req);
    imageUrls = renameImagesForSeo(imageUrls, productName);
    const quantityOnHand = Math.max(0, Math.floor(Number(req.body.quantityOnHand || 0)));
    const productSpecs = appendStockHistory(productSpecsFromBody(req.body), 0, quantityOnHand, "seller submission");
    productSpecs.listingStatus = "submitted";
    const category = normalizeCategory(req.body.category, { required: true });
    const product = await db.createProduct({
      name: productName,
      sku: String(req.body.sku || "").trim(),
      upc: String(req.body.upc || "").trim(),
      brand: String(req.body.brand || "").trim(),
      category,
      description: String(req.body.description || "").trim(),
      priceCents: centsFromInput(req.body.price, 0),
      dealerPriceCents: null,
      imageUrl: imageUrls[0] || "",
      imageUrls,
      sourceUrl: "",
      quantityOnHand,
      productSpecs,
      recommendedAddonIds: [],
      ownerUserId: req.user.role === "admin" ? null : req.user.id,
      active: false
    });
    res.status(201).json({ id: product.id, message: "Listing submitted. It is saved in the seller workspace and stays hidden until reviewed." });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not submit seller listing." });
  }
});

app.post("/api/integrations/product-listing-pull/products", requireProductListingPull, async (req, res) => {
  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const sku = String(payload.amazon_sku || "").trim();
    const sourceUrl = String(payload.url || "").trim();
    const existingProducts = await db.listProducts();
    const existing = existingProducts.find((product) => sku && String(product.sku || "").trim().toLowerCase() === sku.toLowerCase())
      || existingProducts.find((product) => sourceUrl && String(product.sourceUrl || "").trim() === sourceUrl)
      || null;
    const record = listingPullProductRecord(payload, existing || {});
    if (!record.sku && !record.sourceUrl) {
      return res.status(400).json({ error: "Amazon SKU or source URL is required." });
    }
    if (existing) {
      const product = await db.updateProduct(existing.id, record);
      return res.json({ ok: true, action: "updated", id: product.id, active: product.active, url: productPath(product) });
    }
    const product = await db.createProduct(record);
    res.status(201).json({ ok: true, action: "created", id: product.id, active: product.active, url: productPath(product) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not import Product Listing Pull item." });
  }
});

app.post("/api/integrations/product-listing-pull/products/status", requireProductListingPull, async (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const skuValues = [
    payload.amazon_sku,
    payload.product_sku,
    payload.sku
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  const sourceUrls = [
    payload.url,
    payload.source_url,
    payload.sourceUrl
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const products = await db.listProducts();
  const product = products.find((item) => {
    const itemSku = String(item.sku || "").trim().toLowerCase();
    if (itemSku && skuValues.includes(itemSku)) return true;
    const itemSourceUrl = String(item.sourceUrl || "").trim();
    return itemSourceUrl && sourceUrls.includes(itemSourceUrl);
  });
  if (!product) {
    return res.json({ ok: true, exists: false });
  }
  res.json({
    ok: true,
    exists: true,
    product: {
      id: product.id,
      sku: product.sku,
      name: product.name,
      active: Boolean(product.active),
      url: productPath(product),
      sourceUrl: product.sourceUrl || "",
      listingStatus: product.productSpecs?.listingStatus || (product.active ? "live" : "draft")
    }
  });
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

app.post("/api/orders", async (req, res) => {
  try {
    req.user = await currentUser(req);
    if (req.user && req.user.status !== "approved") return res.status(403).json({ error: "Your account is still pending approval." });
    const order = await db.createOrder(await buildOrder(req));
    try {
      await sendTelegramOrderNotification(order, req.user || {});
    } catch (error) {
      console.error(error);
    }
    res.status(201).json({ orderId: order.id });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not submit checkout." });
  }
});

app.post("/api/telegram/webhook/:secret", async (req, res) => {
  return telegramProjectBot.handleWebhook(req, res);
});

app.get("/api/admin/summary", requireAdmin, async (_req, res) => {
  res.json(await db.summary());
});

app.get("/api/admin/visitors", requireAdmin, async (req, res) => {
  const filters = {
    country: String(req.query.country || "").trim(),
    deviceType: String(req.query.deviceType || "").trim(),
    path: String(req.query.path || "").trim()
  };
  const [visitors, interactions] = await Promise.all([
    db.visitorAnalytics(filters),
    db.interactionAnalytics()
  ]);
  visitors.recentVisitors = await backfillVisitorLocations(visitors.recentVisitors || []);
  if ((!visitors.topCountries || !visitors.topCountries.length || visitors.topCountries[0]?.country === "Unknown") && visitors.recentVisitors.length) {
    const counts = visitors.recentVisitors.reduce((acc, visitor) => {
      const key = visitor.country || "Unknown";
      acc[key] = (acc[key] || 0) + Number(visitor.visitCount || 1);
      return acc;
    }, {});
    visitors.topCountries = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([country, visits]) => ({ country, visits }));
  }
  res.json({ ...visitors, interactions });
});

app.get("/api/admin/ip-lookup", requireAdmin, async (req, res) => {
  const ipAddress = String(req.query.ip || "").trim();
  if (!ipAddress) return res.status(400).json({ error: "IP address is required." });
  const location = privateIpAddress(ipAddress)
    ? { city: "", region: "", country: "", note: "Private or local IP addresses cannot be geolocated." }
    : normalizeLocation(await geoLookup(ipAddress));
  res.json({
    ipAddress,
    ...location
  });
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
  const userId = Number(req.params.id);
  let user = null;
  if (req.body.status) {
    if (!["pending", "approved", "rejected"].includes(req.body.status)) return res.status(400).json({ error: "Invalid status." });
    user = await db.updateUserStatus(userId, req.body.status);
  }
  if (req.body.accountType) {
    user = await db.updateUserAccountType(userId, req.body.accountType);
  }
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ ok: true, user: publicUser(user), consent: consentPayload(req) });
});

app.get("/api/admin/products", requireAdmin, async (_req, res) => {
  const products = await db.listProducts();
  const metricsByProductId = await db.getProductMetrics(products.map((product) => product.id));
  res.json({ products: await Promise.all(products.map((product) => productPayload(product, true, true, metricsByProductId[product.id]))) });
});

app.get("/api/admin/facebook-bridge/accounts", requireAdmin, async (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(FACEBOOK_BRIDGE_URL && FACEBOOK_BRIDGE_ADMIN_KEY),
    bridgeUrl: FACEBOOK_BRIDGE_URL,
    accounts: facebookBridgeAccounts()
  });
});

app.post("/api/admin/products/:id/facebook-draft", requireAdmin, async (req, res) => {
  try {
    if (!FACEBOOK_BRIDGE_URL || !FACEBOOK_BRIDGE_ADMIN_KEY) {
      return res.status(503).json({ error: "Facebook bridge is not configured. Set FACEBOOK_BRIDGE_URL and FACEBOOK_BRIDGE_ADMIN_KEY on Railway." });
    }

    const product = await db.getProduct(Number(req.params.id));
    if (!product) return res.status(404).json({ error: "Product not found." });

    const payload = facebookBridgeDraftPayload(product, req, req.body.facebookAccountId || FACEBOOK_BRIDGE_DEFAULT_ACCOUNT_ID);
    const response = await fetch(`${FACEBOOK_BRIDGE_URL}/api/listing-drafts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-key": FACEBOOK_BRIDGE_ADMIN_KEY
      },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Facebook bridge returned ${response.status}`);

    const productSpecs = {
      ...(product.productSpecs || {}),
      marketplaceStatus: "ready_for_facebook",
      facebookDraftId: body.draft?.id || "",
      facebookAccountId: payload.facebookAccountId,
      facebookProfileId: payload.facebookProfileId,
      facebookDraftedAt: new Date().toISOString()
    };
    const saved = await db.updateProduct(product.id, { ...product, productSpecs });
    const metricsByProductId = await db.getProductMetrics([saved.id]);
    res.json({
      ok: true,
      draft: body.draft,
      product: await productPayload(saved, true, true, metricsByProductId[saved.id])
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not push product to Facebook bridge." });
  }
});

app.get("/api/admin/products/export", requireAdmin, async (_req, res) => {
  const products = await db.listProducts();
  const filename = `selltomakemoney-products-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.type("text/csv; charset=utf-8").send(exportProductsCsv(products));
});

app.post("/api/admin/products/import", requireAdmin, async (req, res) => {
  try {
    if (String(req.body.format || "").toLowerCase() !== "csv") {
      throw new Error("Upload a CSV product file.");
    }
    const importedProducts = importProductsFromCsv(req.body.text);
    const existingProducts = await db.listProducts();
    let created = 0;
    let updated = 0;
    for (const item of importedProducts) {
      const source = item && typeof item === "object" ? item : {};
      const sku = String(source.sku || "").trim();
      const upc = cleanUpc(source.upc || "");
      const match = existingProducts.find((product) => Number(product.id) === Number(source.id))
        || (sku ? existingProducts.find((product) => String(product.sku || "").trim().toLowerCase() === sku.toLowerCase()) : null)
        || (upc ? existingProducts.find((product) => cleanUpc(product.upc || "") === upc) : null);
      const base = match || {};
      const imageUrls = Array.isArray(source.imageUrls)
        ? source.imageUrls.map((value) => String(value || "").trim()).filter(Boolean)
        : (source.imageUrl ? [String(source.imageUrl).trim()] : (base.imageUrls || (base.imageUrl ? [base.imageUrl] : [])));
      const quantityOnHand = Math.max(0, Math.floor(Number(source.quantityOnHand ?? base.quantityOnHand ?? 0)));
      const importedSpecs = source.productSpecs && typeof source.productSpecs === "object" ? source.productSpecs : {};
      const productSpecs = appendStockHistory(productSpecsFromBody({
        ...importedSpecs,
        ...source,
        cost: importedSpecs.cost ?? source.cost ?? base.productSpecs?.cost,
        sourceNotes: importedSpecs.sourceNotes ?? source.sourceNotes ?? base.productSpecs?.sourceNotes,
        listingStatus: importedSpecs.listingStatus ?? source.listingStatus ?? base.productSpecs?.listingStatus,
        marketplaceStatus: importedSpecs.marketplaceStatus ?? source.marketplaceStatus ?? base.productSpecs?.marketplaceStatus,
        fulfillmentType: importedSpecs.fulfillmentType ?? source.fulfillmentType ?? base.productSpecs?.fulfillmentType,
        condition: importedSpecs.condition ?? source.condition ?? base.productSpecs?.condition
      }, base.productSpecs || {}), base.quantityOnHand, quantityOnHand, match ? "bulk import update" : "bulk import");
      const record = {
        name: String(importField(source, base.name || "", "name")).trim(),
        sku,
        upc,
        brand: String(importField(source, base.brand || "", "brand")).trim(),
        category: normalizeCategory(importField(source, base.category || "", "category"), { fallback: base.category, required: true }),
        description: String(importField(source, base.description || "", "description")).trim(),
        priceCents: centsFromInput(importField(source, base.priceCents ?? 0, "price", "priceCents"), base.priceCents ?? 0),
        dealerPriceCents: centsFromInput(importField(source, base.dealerPriceCents, "dealerPrice", "dealerPriceCents"), base.dealerPriceCents),
        imageUrl: imageUrls[0] || "",
        imageUrls,
        sourceUrl: String(importField(source, base.sourceUrl || "", "sourceUrl")).trim(),
        quantityOnHand,
        ownerUserId: base.ownerUserId ?? null,
        productSpecs,
        recommendedAddonIds: parseRecommendedAddonIds(source.recommendedAddonIds, base.id || 0),
        active: source.active === undefined ? (base.active !== undefined ? Boolean(base.active) : false) : Boolean(source.active)
      };
      if (!record.name) throw new Error(`Each imported product needs a name. Problem row SKU: ${sku || "n/a"}, UPC: ${upc || "n/a"}.`);
      if (match) {
        const saved = await db.updateProduct(match.id, record);
        const index = existingProducts.findIndex((product) => Number(product.id) === Number(match.id));
        if (index >= 0) existingProducts[index] = saved;
        updated += 1;
      } else {
        const saved = await db.createProduct(record);
        existingProducts.unshift(saved);
        created += 1;
      }
    }
    res.json({ ok: true, created, updated, total: importedProducts.length });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not import products." });
  }
});

app.post("/api/admin/products", requireAdmin, productImageUpload, async (req, res) => {
  try {
    if (!req.body.name) return res.status(400).json({ error: "Product name is required." });
    const productName = String(req.body.name || "").trim();
    let imageUrls = uploadedImageUrls(req);
    if (!imageUrls.length) {
      const downloadedImages = await downloadedRemoteImageUrls(req.body.remoteImageUrls, String(req.body.remoteImageUrl || "").trim());
      if (downloadedImages.length) imageUrls = downloadedImages;
    }
    imageUrls = renameImagesForSeo(imageUrls, productName);
    const quantityOnHand = Math.max(0, Math.floor(Number(req.body.quantityOnHand || 0)));
    const productSpecs = appendStockHistory(productSpecsFromBody(req.body), 0, quantityOnHand, "created");
    const category = normalizeCategory(req.body.category, { required: true });
    const product = await db.createProduct({
      name: productName,
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
      ownerUserId: null,
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
  const productName = String(req.body.name || existing.name || "").trim();
  let newImageUrls = uploadedImageUrls(req);
  if (!newImageUrls.length) {
    const downloadedImages = await downloadedRemoteImageUrls(req.body.remoteImageUrls, String(req.body.remoteImageUrl || "").trim());
    if (downloadedImages.length) newImageUrls = downloadedImages;
  }
  if (newImageUrls.length) newImageUrls = renameImagesForSeo(newImageUrls, productName);
  const imageUrls = newImageUrls.length ? newImageUrls : (existing.imageUrls || (existing.imageUrl ? [existing.imageUrl] : []));
  const quantityOnHand = Math.max(0, Math.floor(Number(req.body.quantityOnHand ?? existing.quantityOnHand ?? 0)));
  const productSpecs = appendStockHistory(productSpecsFromBody(req.body, existing.productSpecs || {}), existing.quantityOnHand, quantityOnHand);
  const category = normalizeCategory(req.body.category, { fallback: existing.category, required: true });
  const product = await db.updateProduct(existing.id, {
    name: productName,
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
    ownerUserId: existing.ownerUserId ?? null,
    productSpecs,
    recommendedAddonIds: parseRecommendedAddonIds(req.body.recommendedAddonIds, existing.id),
    active: req.body.active !== "false"
  });
  const metricsByProductId = await db.getProductMetrics([product.id]);
  res.json({ product: await productPayload(product, true, true, metricsByProductId[product.id]) });
});

app.post("/api/admin/products/:id/archive", requireAdmin, async (req, res) => {
  const existing = await db.getProduct(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: "Product not found." });
  const product = await db.updateProduct(existing.id, {
    ...existing,
    active: false,
    productSpecs: {
      ...(existing.productSpecs || {}),
      listingStatus: "archived"
    }
  });
  const metricsByProductId = await db.getProductMetrics([product.id]);
  res.json({ ok: true, product: await productPayload(product, true, true, metricsByProductId[product.id]) });
});

app.post("/api/admin/products/:id/restore", requireAdmin, async (req, res) => {
  const existing = await db.getProduct(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: "Product not found." });
  const product = await db.updateProduct(existing.id, {
    ...existing,
    active: true,
    productSpecs: {
      ...(existing.productSpecs || {}),
      listingStatus: existing.productSpecs?.listingStatus === "archived"
        ? "draft"
        : (existing.productSpecs?.listingStatus || "draft")
    }
  });
  const metricsByProductId = await db.getProductMetrics([product.id]);
  res.json({ ok: true, product: await productPayload(product, true, true, metricsByProductId[product.id]) });
});

app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const productId = Number(req.params.id);
  const existing = await db.getProduct(productId);
  if (!existing) return res.status(404).json({ error: "Product not found." });
  const inquiries = await db.listInquiries();
  if (inquiries.some((inquiry) => Number(inquiry.productId) === productId)) {
    return res.status(400).json({ error: "This item has inquiry history. Archive it instead of deleting it." });
  }
  const orders = await db.listOrders();
  if (orders.some((order) => (order.items || []).some((item) => Number(item.productId) === productId))) {
    return res.status(400).json({ error: "This item appears in order history. Archive it instead of deleting it." });
  }
  const deleted = await db.deleteProduct(productId);
  if (!deleted) return res.status(404).json({ error: "Product not found." });
  res.json({ ok: true });
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
      warning: listing.importWarning || "",
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
app.get("/desktop", sendDesktopApp);
app.get("/mobile", sendMobileApp);
app.get("/m", sendMobileApp);
app.get("/m/list-with-us", sendMobileListWithUsApp);
app.get("/m/shopper", sendMobileShopperApp);
app.get("/m/dealer", sendMobileDealerApp);
app.get("/m/sell", sendMobileSellerApp);
app.get("/shopper", sendShopperApp);
app.get("/dealer", sendDealerApp);
app.get("/sell", sendSellerApp);
app.get("/list-with-us", sendListWithUsApp);
app.get("/admin", sendAdminApp);
app.get("/admin/facebookmobile", sendAdminFacebookApp);
app.get("/catalog", sendCatalog);
app.get("/dealers", sendDealers);
app.get("/about", sendAboutPage);
app.get("/contact", sendContactPage);
app.get("/faq", sendFaqPage);
app.get("/returns", sendReturnsPage);
app.get("/shipping", sendShippingPage);
app.get("/terms", sendTermsPage);
app.get("/privacy", sendPrivacyPage);

app.get("*", sendDesktopApp);

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

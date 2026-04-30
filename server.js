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

function searchLinks(product) {
  const query = slugSearch(product);
  return [
    { site: "Google Shopping", url: `https://www.google.com/search?tbm=shop&q=${query}` },
    { site: "Amazon", url: `https://www.amazon.com/s?k=${query}` },
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
        "user-agent": "DealerStoreImporter/1.0 (+https://selltomakemoney-production.up.railway.app)",
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

async function downloadImage(imageUrl) {
  if (!imageUrl) return "";
  const parsed = await assertSafeImportUrl(imageUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(parsed, {
      signal: controller.signal,
      headers: { "user-agent": "DealerStoreImporter/1.0" }
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
    nextIds: { users: 1, products: 1, inquiries: 1, comparisons: 1 },
    users: [],
    products: [],
    inquiries: [],
    comparisons: []
  };
}

function readJsonStore() {
  if (!fs.existsSync(DB_PATH)) return emptyJsonStore();
  const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  data.nextIds.comparisons ||= 1;
  data.comparisons ||= [];
  data.products = data.products.map((product) => ({
    brand: "",
    upc: "",
    sourceUrl: "",
    quantityOnHand: 0,
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
    async listUsers() {
      return [...store.users].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
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
    async summary() {
      return {
        pendingUsers: store.users.filter((user) => user.status === "pending").length,
        products: store.products.length,
        inquiries: store.inquiries.filter((inquiry) => inquiry.status === "new").length
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
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    upc: row.upc,
    category: row.category,
    brand: row.brand,
    description: row.description,
    priceCents: row.price_cents,
    imageUrl: row.image_url,
    imageUrls,
    sourceUrl: row.source_url,
    quantityOnHand: row.quantity_on_hand,
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
        INSERT INTO products (id, name, sku, upc, brand, category, description, price_cents, image_url, image_urls, source_url, quantity_on_hand, active, recommended_addon_ids, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
        product.imageUrl,
        JSON.stringify(product.imageUrls || (product.imageUrl ? [product.imageUrl] : [])),
        product.sourceUrl || "",
        product.quantityOnHand || 0,
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
    await query("SELECT setval('users_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM users), 1), 1))");
    await query("SELECT setval('products_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM products), 1), 1))");
    await query("SELECT setval('inquiries_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM inquiries), 1), 1))");
    await query("SELECT setval('price_comparisons_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM price_comparisons), 1), 1))");
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
          image_url TEXT NOT NULL DEFAULT '',
          image_urls TEXT NOT NULL DEFAULT '[]',
          source_url TEXT NOT NULL DEFAULT '',
          quantity_on_hand INTEGER NOT NULL DEFAULT 0,
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
        CREATE INDEX IF NOT EXISTS idx_products_upc ON products(upc);
        ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT '';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS image_urls TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS source_url TEXT NOT NULL DEFAULT '';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS quantity_on_hand INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE products ADD COLUMN IF NOT EXISTS recommended_addon_ids TEXT NOT NULL DEFAULT '[]';
        CREATE INDEX IF NOT EXISTS idx_products_search ON products USING gin(to_tsvector('english', name || ' ' || description || ' ' || sku || ' ' || upc || ' ' || brand));
        CREATE INDEX IF NOT EXISTS idx_price_comparisons_product ON price_comparisons(product_id);
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
    async listUsers() {
      return (await query("SELECT * FROM users ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, created_at DESC")).rows.map(camelUser);
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
        INSERT INTO products (name, sku, upc, brand, category, description, price_cents, image_url, image_urls, source_url, quantity_on_hand, active, recommended_addon_ids)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
      `, [
        product.name,
        product.sku,
        product.upc,
        product.brand,
        product.category,
        product.description,
        product.priceCents,
        product.imageUrl,
        JSON.stringify(product.imageUrls || (product.imageUrl ? [product.imageUrl] : [])),
        product.sourceUrl || "",
        product.quantityOnHand || 0,
        product.active,
        JSON.stringify(product.recommendedAddonIds || [])
      ]);
      return camelProduct(result.rows[0]);
    },
    async updateProduct(id, product) {
      const result = await query(`
        UPDATE products SET name=$1, sku=$2, upc=$3, brand=$4, category=$5, description=$6, price_cents=$7, image_url=$8, image_urls=$9, source_url=$10, quantity_on_hand=$11, active=$12, recommended_addon_ids=$13
        WHERE id=$14 RETURNING *
      `, [
        product.name,
        product.sku,
        product.upc,
        product.brand,
        product.category,
        product.description,
        product.priceCents,
        product.imageUrl,
        JSON.stringify(product.imageUrls || (product.imageUrl ? [product.imageUrl] : [])),
        product.sourceUrl || "",
        product.quantityOnHand || 0,
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
    async summary() {
      const result = await query(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE status = 'pending')::int AS "pendingUsers",
          (SELECT COUNT(*) FROM products)::int AS products,
          (SELECT COUNT(*) FROM inquiries WHERE status = 'new')::int AS inquiries
      `);
      return result.rows[0];
    }
  };
}

function seedProductRows() {
  return [
    { name: "Dealer Starter Kit", sku: "DSK-100", upc: "", brand: "House Brand", category: "Starter", description: "A ready-to-sell bundle for new dealer accounts.", priceCents: 19900, imageUrl: "", imageUrls: [], sourceUrl: "", quantityOnHand: 0, recommendedAddonIds: [], active: true },
    { name: "Premium Inventory Pack", sku: "PIP-250", upc: "", brand: "House Brand", category: "Inventory", description: "Higher-margin product mix for established dealers.", priceCents: 54900, imageUrl: "", imageUrls: [], sourceUrl: "", quantityOnHand: 0, recommendedAddonIds: [], active: true },
    { name: "Display Sample Set", sku: "DSS-050", upc: "", brand: "House Brand", category: "Samples", description: "Showroom samples and sell sheets for in-person selling.", priceCents: 8900, imageUrl: "", imageUrls: [], sourceUrl: "", quantityOnHand: 0, recommendedAddonIds: [], active: true }
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
  limits: { fileSize: 5 * 1024 * 1024 },
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
  const payload = {
    id: product.id,
    name: product.name,
    sku: product.sku,
    upc: product.upc,
    brand: product.brand,
    category: product.category,
    description: product.description,
    imageUrl: product.imageUrl,
    imageUrls: product.imageUrls || (product.imageUrl ? [product.imageUrl] : []),
    active: Boolean(product.active),
    recommendedAddonIds: product.recommendedAddonIds || [],
    priceCents: showPrice ? product.priceCents : null,
    price: showPrice ? dollars(product.priceCents) : null
  };
  const recommendedAddons = await db.getProductsByIds(product.recommendedAddonIds || [], { activeOnly: !includeAdminData });
  payload.recommendedAddons = recommendedAddons.map((addon) => ({
    id: addon.id,
    name: addon.name,
    sku: addon.sku,
    brand: addon.brand,
    imageUrl: addon.imageUrl,
    imageUrls: addon.imageUrls || (addon.imageUrl ? [addon.imageUrl] : []),
    price: showPrice ? dollars(addon.priceCents) : null
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
    })),
    searchLinks: searchLinks(product)
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

app.get("/api/admin/summary", requireAdmin, async (_req, res) => {
  res.json(await db.summary());
});

app.get("/api/admin/users", requireAdmin, async (_req, res) => {
  const users = (await db.listUsers()).map(({ passwordHash, ...user }) => user);
  res.json({ users });
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

const productImageUpload = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "images", maxCount: 12 }
]);

app.post("/api/admin/products", requireAdmin, productImageUpload, async (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: "Product name is required." });
  const imageUrls = uploadedImageUrls(req);
  const product = await db.createProduct({
    name: String(req.body.name || "").trim(),
    sku: String(req.body.sku || "").trim(),
    upc: String(req.body.upc || "").trim(),
    brand: String(req.body.brand || "").trim(),
    category: String(req.body.category || "").trim(),
    description: String(req.body.description || "").trim(),
    priceCents: Math.round(Number(req.body.price || 0) * 100),
    imageUrl: imageUrls[0] || "",
    imageUrls,
    sourceUrl: String(req.body.sourceUrl || "").trim(),
    quantityOnHand: Math.max(0, Math.floor(Number(req.body.quantityOnHand || 0))),
    recommendedAddonIds: parseRecommendedAddonIds(req.body.recommendedAddonIds),
    active: req.body.active !== "false"
  });
  res.status(201).json({ id: product.id });
});

app.patch("/api/admin/products/:id", requireAdmin, productImageUpload, async (req, res) => {
  const existing = await db.getProduct(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: "Product not found." });
  const newImageUrls = uploadedImageUrls(req);
  const imageUrls = newImageUrls.length ? newImageUrls : (existing.imageUrls || (existing.imageUrl ? [existing.imageUrl] : []));
  const product = await db.updateProduct(existing.id, {
    name: String(req.body.name || existing.name).trim(),
    sku: String(req.body.sku || "").trim(),
    upc: String(req.body.upc || "").trim(),
    brand: String(req.body.brand || "").trim(),
    category: String(req.body.category || "").trim(),
    description: String(req.body.description || "").trim(),
    priceCents: Math.round(Number(req.body.price || existing.priceCents / 100) * 100),
    imageUrl: imageUrls[0] || "",
    imageUrls,
    sourceUrl: String(req.body.sourceUrl || existing.sourceUrl || "").trim(),
    quantityOnHand: Math.max(0, Math.floor(Number(req.body.quantityOnHand ?? existing.quantityOnHand ?? 0))),
    recommendedAddonIds: parseRecommendedAddonIds(req.body.recommendedAddonIds, existing.id),
    active: req.body.active !== "false"
  });
  res.json({ product: await productPayload(product, true, true) });
});

app.post("/api/admin/import-url", requireAdmin, async (req, res) => {
  try {
    const parsedUrl = await assertSafeImportUrl(String(req.body.url || "").trim());
    const html = await fetchText(parsedUrl.toString());
    const listing = extractListing(html, parsedUrl.toString());
    if (!listing.name) return res.status(422).json({ error: "Could not find enough listing information on that page." });
    const imageUrl = await downloadImage(listing.remoteImageUrl);
    const imageUrls = imageUrl ? [imageUrl] : [];
    const product = await db.createProduct({
      name: listing.name,
      sku: listing.sku,
      upc: listing.upc,
      brand: listing.brand,
      category: listing.category,
      description: listing.description,
      priceCents: listing.priceCents,
      imageUrl,
      imageUrls,
      sourceUrl: listing.sourceUrl,
      quantityOnHand: Math.max(0, Math.floor(Number(req.body.quantityOnHand || 1))),
      recommendedAddonIds: [],
      active: true
    });
    res.status(201).json({
      product: await productPayload(product, true, true),
      imported: {
        remoteImageUrl: listing.remoteImageUrl,
        savedImage: Boolean(imageUrl),
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

app.get("/", (req, res) => {
  res.redirect(isMobileRequest(req) ? "/mobile" : "/desktop");
});

app.get(["/desktop", "/mobile"], sendApp);

app.get("*", sendApp);

async function start() {
  await db.init();
  await db.seedAdmin();
  await db.seedProducts();
  app.listen(PORT, () => {
    console.log(`Dealer store running at http://localhost:${PORT} using ${db.type} storage`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});

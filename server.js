const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
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
  data.products = data.products.map((product) => ({ upc: "", ...product }));
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
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    upc: row.upc,
    category: row.category,
    description: row.description,
    priceCents: row.price_cents,
    imageUrl: row.image_url,
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
        INSERT INTO products (id, name, sku, upc, category, description, price_cents, image_url, active, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO NOTHING
      `, [product.id, product.name, product.sku, product.upc || "", product.category, product.description, product.priceCents, product.imageUrl, product.active, product.createdAt || new Date()]);
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
          category TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          price_cents INTEGER NOT NULL DEFAULT 0,
          image_url TEXT NOT NULL DEFAULT '',
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
        CREATE INDEX IF NOT EXISTS idx_products_search ON products USING gin(to_tsvector('english', name || ' ' || description || ' ' || sku || ' ' || upc));
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
    async createProduct(product) {
      const result = await query(`
        INSERT INTO products (name, sku, upc, category, description, price_cents, image_url, active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
      `, [product.name, product.sku, product.upc, product.category, product.description, product.priceCents, product.imageUrl, product.active]);
      return camelProduct(result.rows[0]);
    },
    async updateProduct(id, product) {
      const result = await query(`
        UPDATE products SET name=$1, sku=$2, upc=$3, category=$4, description=$5, price_cents=$6, image_url=$7, active=$8
        WHERE id=$9 RETURNING *
      `, [product.name, product.sku, product.upc, product.category, product.description, product.priceCents, product.imageUrl, product.active, id]);
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
    { name: "Dealer Starter Kit", sku: "DSK-100", upc: "", category: "Starter", description: "A ready-to-sell bundle for new dealer accounts.", priceCents: 19900, imageUrl: "", active: true },
    { name: "Premium Inventory Pack", sku: "PIP-250", upc: "", category: "Inventory", description: "Higher-margin product mix for established dealers.", priceCents: 54900, imageUrl: "", active: true },
    { name: "Display Sample Set", sku: "DSS-050", upc: "", category: "Samples", description: "Showroom samples and sell sheets for in-person selling.", priceCents: 8900, imageUrl: "", active: true }
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
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(ROOT, "public")));

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

async function productPayload(product, showPrice) {
  const comparisons = await db.listComparisons(product.id);
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    upc: product.upc,
    category: product.category,
    description: product.description,
    imageUrl: product.imageUrl,
    active: Boolean(product.active),
    priceCents: showPrice ? product.priceCents : null,
    price: showPrice ? dollars(product.priceCents) : null,
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
  res.json({ products: await Promise.all(products.map((product) => productPayload(product, showPrice))), canSeePrices: showPrice });
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
  res.json({ products: await Promise.all(products.map((product) => productPayload(product, true))) });
});

app.post("/api/admin/products", requireAdmin, upload.single("image"), async (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: "Product name is required." });
  const product = await db.createProduct({
    name: String(req.body.name || "").trim(),
    sku: String(req.body.sku || "").trim(),
    upc: String(req.body.upc || "").trim(),
    category: String(req.body.category || "").trim(),
    description: String(req.body.description || "").trim(),
    priceCents: Math.round(Number(req.body.price || 0) * 100),
    imageUrl: req.file ? `/uploads/${req.file.filename}` : "",
    active: req.body.active !== "false"
  });
  res.status(201).json({ id: product.id });
});

app.patch("/api/admin/products/:id", requireAdmin, upload.single("image"), async (req, res) => {
  const existing = await db.getProduct(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: "Product not found." });
  const product = await db.updateProduct(existing.id, {
    name: String(req.body.name || existing.name).trim(),
    sku: String(req.body.sku || "").trim(),
    upc: String(req.body.upc || "").trim(),
    category: String(req.body.category || "").trim(),
    description: String(req.body.description || "").trim(),
    priceCents: Math.round(Number(req.body.price || existing.priceCents / 100) * 100),
    imageUrl: req.file ? `/uploads/${req.file.filename}` : existing.imageUrl,
    active: req.body.active !== "false"
  });
  res.json({ product: await productPayload(product, true) });
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

app.get("*", (_req, res) => {
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

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

const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "store.json");
const SESSION_SECRET = process.env.SESSION_SECRET || "replace-this-before-production";
const ADMIN_EMAIL = "k.prathab@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "DealerStore!2026";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function readDatabase() {
  if (!fs.existsSync(DB_PATH)) {
    return { nextIds: { users: 1, products: 1, inquiries: 1 }, users: [], products: [], inquiries: [] };
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

let store = readDatabase();

function writeDatabase() {
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2));
}

function insert(collection, row) {
  const id = store.nextIds[collection]++;
  const record = { id, createdAt: new Date().toISOString(), ...row };
  store[collection].push(record);
  writeDatabase();
  return record;
}

function seedAdmin() {
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
}

function seedProducts() {
  if (store.products.length) return;
  [
    ["Dealer Starter Kit", "DSK-100", "Starter", "A ready-to-sell bundle for new dealer accounts.", 19900, ""],
    ["Premium Inventory Pack", "PIP-250", "Inventory", "Higher-margin product mix for established dealers.", 54900, ""],
    ["Display Sample Set", "DSS-050", "Samples", "Showroom samples and sell sheets for in-person selling.", 8900, ""]
  ].forEach(([name, sku, category, description, priceCents, imageUrl]) => {
    insert("products", { name, sku, category, description, priceCents, imageUrl, active: true });
  });
}

seedAdmin();
seedProducts();

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

function currentUser(req) {
  if (!req.session.userId) return null;
  return store.users.find((user) => user.id === req.session.userId) || null;
}

function requireLogin(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Please login first." });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Admin access required." });
  req.user = user;
  next();
}

function productPayload(product, showPrice) {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    category: product.category,
    description: product.description,
    imageUrl: product.imageUrl,
    active: Boolean(product.active),
    priceCents: showPrice ? product.priceCents : null,
    price: showPrice ? `$${(product.priceCents / 100).toFixed(2)}` : null
  };
}

app.get("/api/session", (req, res) => {
  res.json({ user: publicUser(currentUser(req)) });
});

app.post("/api/register", async (req, res) => {
  const { email, password, company, contactName, phone } = req.body;
  if (!email || !password || !company || !contactName) {
    return res.status(400).json({ error: "Email, password, company, and contact name are required." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  const cleanEmail = email.toLowerCase().trim();
  if (store.users.some((user) => user.email === cleanEmail)) {
    return res.status(409).json({ error: "That email is already registered." });
  }
  insert("users", {
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
  const user = store.users.find((item) => item.email === String(req.body.email || "").toLowerCase().trim());
  if (!user || !(await bcrypt.compare(req.body.password || "", user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/products", (req, res) => {
  const user = currentUser(req);
  const showPrice = Boolean(user && user.status === "approved");
  const products = store.products
    .filter((product) => product.active)
    .sort((a, b) => b.id - a.id)
    .map((product) => productPayload(product, showPrice));
  res.json({ products, canSeePrices: showPrice });
});

app.post("/api/inquiries", requireLogin, (req, res) => {
  if (req.user.status !== "approved") return res.status(403).json({ error: "Your account is still pending approval." });
  const productId = Number(req.body.productId);
  const quantity = Math.max(1, Number(req.body.quantity || 1));
  const product = store.products.find((item) => item.id === productId && item.active);
  if (!product) return res.status(404).json({ error: "Product not found." });
  insert("inquiries", {
    userId: req.user.id,
    productId,
    quantity,
    note: String(req.body.note || "").trim(),
    status: "new"
  });
  res.status(201).json({ ok: true });
});

app.get("/api/admin/summary", requireAdmin, (_req, res) => {
  res.json({
    pendingUsers: store.users.filter((user) => user.status === "pending").length,
    products: store.products.length,
    inquiries: store.inquiries.filter((inquiry) => inquiry.status === "new").length
  });
});

app.get("/api/admin/users", requireAdmin, (_req, res) => {
  const users = [...store.users]
    .sort((a, b) => (a.status === "pending" ? -1 : 1) - (b.status === "pending" ? -1 : 1))
    .map(({ passwordHash, ...user }) => user);
  res.json({ users });
});

app.patch("/api/admin/users/:id", requireAdmin, (req, res) => {
  const status = req.body.status;
  if (!["pending", "approved", "rejected"].includes(status)) return res.status(400).json({ error: "Invalid status." });
  const user = store.users.find((item) => item.id === Number(req.params.id) && item.role !== "admin");
  if (!user) return res.status(404).json({ error: "User not found." });
  user.status = status;
  writeDatabase();
  res.json({ ok: true });
});

app.get("/api/admin/products", requireAdmin, (_req, res) => {
  res.json({ products: [...store.products].sort((a, b) => b.id - a.id).map((product) => productPayload(product, true)) });
});

app.post("/api/admin/products", requireAdmin, upload.single("image"), (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: "Product name is required." });
  const product = insert("products", {
    name: String(req.body.name || "").trim(),
    sku: String(req.body.sku || "").trim(),
    category: String(req.body.category || "").trim(),
    description: String(req.body.description || "").trim(),
    priceCents: Math.round(Number(req.body.price || 0) * 100),
    imageUrl: req.file ? `/uploads/${req.file.filename}` : "",
    active: req.body.active !== "false"
  });
  res.status(201).json({ id: product.id });
});

app.patch("/api/admin/products/:id", requireAdmin, upload.single("image"), (req, res) => {
  const product = store.products.find((item) => item.id === Number(req.params.id));
  if (!product) return res.status(404).json({ error: "Product not found." });
  product.name = String(req.body.name || product.name).trim();
  product.sku = String(req.body.sku || "").trim();
  product.category = String(req.body.category || "").trim();
  product.description = String(req.body.description || "").trim();
  product.priceCents = Math.round(Number(req.body.price || product.priceCents / 100) * 100);
  product.imageUrl = req.file ? `/uploads/${req.file.filename}` : product.imageUrl;
  product.active = req.body.active !== "false";
  writeDatabase();
  res.json({ ok: true });
});

app.get("/api/admin/inquiries", requireAdmin, (_req, res) => {
  const inquiries = store.inquiries.map((inquiry) => {
    const user = store.users.find((item) => item.id === inquiry.userId) || {};
    const product = store.products.find((item) => item.id === inquiry.productId) || {};
    return {
      ...inquiry,
      email: user.email || "",
      company: user.company || "",
      productName: product.name || "",
      sku: product.sku || ""
    };
  }).sort((a, b) => b.id - a.id);
  res.json({ inquiries });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Dealer store running at http://localhost:${PORT}`);
});

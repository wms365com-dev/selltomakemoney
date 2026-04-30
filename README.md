# Dealer Store

A single dealer storefront based on the ShopifyLite idea: visitors can browse products, but only approved logged-in dealers can see pricing.

## Run locally

```powershell
npm install
npm start
```

Open `http://localhost:3000`.

## Admin login

- Email: `k.prathab@gmail.com`
- Temporary password: `DealerStore!2026`

Change the password after first login. You can override the seeded password before the first run with:

```powershell
$env:ADMIN_PASSWORD="your-new-password"; npm start
```

## What is included

- SQLite database in `data/store.db`
- Uploaded product image storage in `uploads/`
- Dealer registration with pending approval
- Admin approval screen
- Product management screen
- Public catalog with prices hidden until login and approval

## Railway deployment

Railway can deploy this repo with the included `railway.json`.

Recommended Railway variables:

```text
SESSION_SECRET=use-a-long-random-secret
ADMIN_PASSWORD=change-this-before-first-production-run
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Production data should live in Railway Postgres. The app still supports `DB_PATH=/data/store.json` as a local/simple fallback, but Postgres is preferred for the live site.

Uploaded product images are stored in `uploads/`; for production permanence, mount a Railway volume for uploads too or connect cloud object storage later.

## Price comparisons

Products support UPCs and saved competitor price comparisons. Admin users can add comparison rows for Amazon, Walmart, eBay, Google Shopping, or any other site. The storefront shows those comparison prices publicly while keeping your dealer price hidden until the dealer is approved and logged in.

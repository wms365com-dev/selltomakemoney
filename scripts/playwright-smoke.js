const { chromium } = require("playwright");

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "https://selltomakemoney.com";
const DEALER_EMAIL = process.env.DEALER_EMAIL || "";
const DEALER_PASSWORD = process.env.DEALER_PASSWORD || "";
const SELLER_EMAIL = process.env.SELLER_EMAIL || "";
const SELLER_PASSWORD = process.env.SELLER_PASSWORD || "";

async function withPage(browser, path, task, viewport = { width: 1440, height: 1200 }) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  try {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: "commit", timeout: 30000 });
    return await task(page);
  } finally {
    await context.close();
  }
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--ignore-certificate-errors"]
  });
  const results = [];
  try {
    results.push(await withPage(browser, "/list-with-us", async (page) => {
      await page.waitForSelector("#sellwithusView:not(.hidden) h1");
      return {
        test: "list_with_us_desktop",
        ok: true,
        heading: await page.locator("#sellwithusView h1").textContent()
      };
    }));

    results.push(await withPage(browser, "/desktop", async (page) => {
      await page.waitForSelector("#storeView:not(.hidden) #productGrid .product-card");
      const firstCard = page.locator("#productGrid .product-card").first();
      return {
        test: "desktop_store_cards",
        ok: await page.locator("#productGrid .product-card").count() > 0
          && await firstCard.getByRole("button", { name: "Add to cart" }).isVisible()
          && await firstCard.getByRole("link", { name: "Details" }).isVisible(),
        cardCount: await page.locator("#productGrid .product-card").count()
      };
    }));

    results.push(await withPage(browser, "/desktop", async (page) => {
      await page.waitForSelector("#productGrid .product-card");
      await page.locator("#productGrid .product-card").first().getByRole("button", { name: "Add to cart" }).click();
      await page.waitForTimeout(800);
      const cartCount = await page.locator("#cartCount").textContent();
      await page.locator("[data-route='cart']").first().click();
      await page.waitForTimeout(1000);
      const subtotal = await page.locator("#cartSubtotal").textContent();
      return {
        test: "desktop_cart_flow",
        ok: Number(cartCount || 0) >= 1 && subtotal && subtotal !== "$0.00",
        cartCount,
        subtotal
      };
    }));

    results.push(await withPage(browser, "/desktop", async (page) => {
      await page.waitForSelector("#productGrid .product-card a.product-title-link");
      const href = await page.locator("#productGrid .product-card a.product-title-link").first().getAttribute("href");
      await page.goto(`${BASE_URL}${href}`, { waitUntil: "commit", timeout: 30000 });
      await page.waitForSelector(".product-detail h1");
      return {
        test: "product_detail_page",
        ok: await page.locator(".product-detail h1").count() > 0,
        title: await page.locator(".product-detail h1").textContent()
      };
    }));

    results.push(await withPage(browser, "/list-with-us", async (page) => {
      await page.waitForSelector("#sellwithusView:not(.hidden)");
      await page.getByRole("button", { name: /apply to sell/i }).click();
      await page.waitForSelector("#registerView:not(.hidden)");
      return {
        test: "seller_apply_prefills_register",
        ok: (await page.locator('#registerForm select[name="accountType"]').inputValue()) === "seller",
        route: page.url()
      };
    }));

    results.push(await withPage(browser, "/m", async (page) => {
      await page.waitForSelector("#storeView:not(.hidden)");
      return {
        test: "mobile_store_route",
        ok: true,
        route: page.url()
      };
    }, { width: 390, height: 844 }));

    results.push(await withPage(browser, "/m", async (page) => {
      await page.waitForSelector("#storeView:not(.hidden)");
      await page.locator("summary.menu-trigger").click();
      await page.waitForTimeout(600);
      const visibleMenuItems = await page.locator(".menu-panel .nav-button:visible, .menu-panel button.nav-button:visible").allTextContents();
      const forbidden = visibleMenuItems.filter((item) => /Privacy|Dealer Info|Facebook/.test(item));
      return {
        test: "mobile_menu_is_simple",
        ok: !forbidden.length,
        items: visibleMenuItems
      };
    }, { width: 390, height: 844 }));

    results.push(await withPage(browser, "/m/list-with-us", async (page) => {
      await page.waitForSelector("#sellwithusView:not(.hidden) h1");
      return {
        test: "mobile_list_with_us_route",
        ok: true,
        heading: await page.locator("#sellwithusView h1").textContent()
      };
    }, { width: 390, height: 844 }));

    if (SELLER_EMAIL && SELLER_PASSWORD) {
      results.push(await withPage(browser, "/desktop#login", async (page) => {
        await page.waitForSelector('#loginForm input[name="email"]');
        await page.locator('#loginForm input[name="email"]').fill(SELLER_EMAIL);
        await page.locator('#loginForm input[name="password"]').fill(SELLER_PASSWORD);
        await page.locator('#loginForm button[type="submit"]').click();
        await page.waitForTimeout(2500);
        const bodyText = await page.locator("body").innerText();
        return {
          test: "seller_login_route",
          ok: page.url().includes("/sell"),
          pendingNoticeVisible: /under review|approval pending|pending approval/i.test(bodyText)
        };
      }));
    }

    if (DEALER_EMAIL && DEALER_PASSWORD) {
      results.push(await withPage(browser, "/desktop#login", async (page) => {
        await page.waitForSelector('#loginForm input[name="email"]');
        await page.locator('#loginForm input[name="email"]').fill(DEALER_EMAIL);
        await page.locator('#loginForm input[name="password"]').fill(DEALER_PASSWORD);
        await page.locator('#loginForm button[type="submit"]').click();
        await page.waitForTimeout(2500);
        const bodyText = await page.locator("body").innerText();
        return {
          test: "dealer_login_route",
          ok: page.url().includes("/dealer") && /dealer/i.test(bodyText),
          route: page.url()
        };
      }));
    }

    console.log(JSON.stringify(results, null, 2));
    if (results.some((result) => !result.ok)) process.exitCode = 1;
  } catch (error) {
    console.error("PLAYWRIGHT_SMOKE_FAILED");
    console.error(error && error.stack || String(error));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();

const { chromium } = require("playwright");

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "https://selltomakemoney.com";

async function withPage(browser, path, task) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1200 }
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
    }));

    results.push(await withPage(browser, "/m/list-with-us", async (page) => {
      await page.waitForSelector("#sellwithusView:not(.hidden) h1");
      return {
        test: "mobile_list_with_us_route",
        ok: true,
        heading: await page.locator("#sellwithusView h1").textContent()
      };
    }));

    if (process.env.SELLER_EMAIL && process.env.SELLER_PASSWORD) {
      results.push(await withPage(browser, "/desktop#login", async (page) => {
        await page.waitForSelector('#loginForm input[name="email"]');
        await page.locator('#loginForm input[name="email"]').fill(process.env.SELLER_EMAIL);
        await page.locator('#loginForm input[name="password"]').fill(process.env.SELLER_PASSWORD);
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

    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    console.error("PLAYWRIGHT_SMOKE_FAILED");
    console.error(error && error.stack || String(error));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();

const { chromium } = require("playwright");
const fs = require("fs");
const { navigateWithAuth } = require("./helpers/autoLogin");

const AUTH_FILE = "auth-state.json";
const NETSUITE_URL = "https://4890950.app.netsuite.com";

(async () => {
  if (!fs.existsSync(AUTH_FILE)) {
    console.error("No auth-state.json found. Run 1-setup-auth.js first.");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: AUTH_FILE });
  const page = await context.newPage();

  console.log("Opening NetSuite with saved session...");
  await navigateWithAuth(page, context, NETSUITE_URL, AUTH_FILE, console.log);

  console.log("Close the window when done.");
  await page.waitForEvent("close", { timeout: 0 });

  await browser.close();
})();

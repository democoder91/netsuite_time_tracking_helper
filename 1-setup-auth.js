const { chromium } = require("playwright");
const { navigateWithAuth } = require("./helpers/autoLogin");

const AUTH_FILE = "auth-state.json";
const NETSUITE_URL = "https://4890950.app.netsuite.com";

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await navigateWithAuth(page, context, NETSUITE_URL, AUTH_FILE, console.log);

  console.log("Session saved to auth-state.json. You are ready to automate.");
  await browser.close();
})();

const fs = require("fs");
const path = require("path");

const CREDENTIALS_FILE = path.join(__dirname, "../credentials.json");
const LOGIN_URL =
  "https://4890950.app.netsuite.com/pages/customerlogin.jsp?c=4890950&whence=";

function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf8"));
  } catch {
    return null;
  }
}

const isLoginPage = (url) =>
  url.includes("login") || url.includes("customerlogin");

const isSecurityQuestionPage = (url) => url.includes("securityquestions");

/**
 * Navigates to targetUrl and logs in automatically if needed.
 * Falls back to waiting for manual login if credentials are missing.
 * Saves fresh cookies to authFile after a successful login.
 *
 * @param {import('playwright').Page} page
 * @param {import('playwright').BrowserContext} context
 * @param {string} targetUrl - URL to navigate to
 * @param {string} authFile - Path to auth-state.json
 * @param {function} log - Optional log callback (message: string) => void
 */
async function navigateWithAuth(
  page,
  context,
  targetUrl,
  authFile,
  log = () => {},
) {
  await page.goto(targetUrl);
  await page.waitForLoadState("networkidle");

  if (!isLoginPage(page.url())) {
    log("Session is valid.");
    return;
  }

  const creds = loadCredentials();
  if (
    creds &&
    creds.email &&
    creds.password &&
    creds.email !== "your@email.com"
  ) {
    log("Session expired. Logging in automatically...");
    await page.goto(LOGIN_URL);
    await page.waitForLoadState("networkidle");
    await page.fill("#email", creds.email);
    await page.fill("#password", creds.password);
    await page.keyboard.press("Enter");
    // Wait past login page — may land on security question page first
    await page.waitForURL((url) => !url.href.includes("customerlogin"), {
      timeout: 60000,
    });
    await page.waitForLoadState("networkidle");

    // Handle security question page if redirected there
    if (isSecurityQuestionPage(page.url())) {
      if (creds.securityAnswer) {
        log("Security question detected. Answering automatically...");
        await page.fill('[name="answer"]', creds.securityAnswer);
        await page.keyboard.press("Enter");
        await page.waitForURL((url) => !isSecurityQuestionPage(url.href), {
          timeout: 30000,
        });
        await page.waitForLoadState("networkidle");
      } else {
        log(
          "Security question detected — please answer it manually in the browser window...",
        );
        await page.waitForURL((url) => !isSecurityQuestionPage(url.href), {
          timeout: 0,
        });
        await page.waitForLoadState("networkidle");
      }
    }
  } else {
    log("Session expired — please log in manually in the browser window...");
    await page.waitForURL((url) => !isLoginPage(url.href), { timeout: 0 });
    await page.waitForLoadState("networkidle");
  }

  await context.storageState({ path: authFile });
  log("Login successful. Session saved.");

  // Navigate to the original target if we were redirected to login
  if (isLoginPage(page.url()) || page.url() !== targetUrl) {
    await page.goto(targetUrl);
    await page.waitForLoadState("networkidle");
  }
}

module.exports = { navigateWithAuth, isLoginPage };

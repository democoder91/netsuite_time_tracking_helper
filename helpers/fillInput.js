async function fillInput(page, locator, value, timeout = 10000) {
  await page.locator(locator).click();
  await page.locator(locator).fill(value);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(timeout);
  await page.waitForLoadState("networkidle");
}

module.exports = { fillInput };

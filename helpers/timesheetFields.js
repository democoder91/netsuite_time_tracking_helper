const { fillInput } = require("./fillInput");

async function fillDate(page, value) {
  await fillInput(page, "#trandate", value, 100);
}

async function fillDuration(page, value) {
  await fillInput(page, "#hours", value, 100);
}

async function fillCustomer(page, value) {
  await fillInput(page, "#customer_display", value, 100);
}

async function fillServiceItem(page, value) {
  await fillInput(page, "#item_display", value, 100);
}

async function fillMemo(page, value) {
  await page.getByRole("textbox", { name: "Memo" }).click();
  await page.getByRole("textbox", { name: "Memo" }).fill(value);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(100);
  await page.waitForLoadState("networkidle");
}

module.exports = {
  fillDate,
  fillDuration,
  fillCustomer,
  fillServiceItem,
  fillMemo,
};

async function saveEntry(page) {
  await page.locator("#btn_secondarymultibutton_submitter").click();
  await page.waitForLoadState("networkidle");
}

module.exports = { saveEntry };

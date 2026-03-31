const {
  fillDate,
  fillDuration,
  fillCustomer,
  fillServiceItem,
  fillMemo,
} = require("./timesheetFields");
const { saveEntry } = require("./saveEntry");

async function logTimesheetEntry(page, entry) {
  console.log(`Logging ${entry.mins} mins for ${entry.memo}...`);
  await fillDate(page, entry.date);
  await fillDuration(page, entry.mins);
  await fillCustomer(page, entry.customer_name);
  await fillServiceItem(page, entry.service_item_id);
  await fillMemo(page, entry.memo);
  //
  // Check for inline errors before saving
  const preErrors = await page
    .locator(".uir-alert-box .descr")
    .allTextContents()
    .catch(() => []);
  if (preErrors.some((t) => t.toLowerCase().includes("invalid"))) {
    return { ok: false, error: preErrors.join("; ") };
  }

  await saveEntry(page);

  // Check for errors after saving
  const postErrors = await page
    .locator(".uir-alert-box .descr")
    .allTextContents()
    .catch(() => []);
  if (postErrors.length > 0) {
    return { ok: false, error: postErrors.join("; ") };
  }

  return { ok: true };
}

module.exports = { logTimesheetEntry };

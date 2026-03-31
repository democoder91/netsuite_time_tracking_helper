const { chromium } = require("playwright");
const fs = require("fs");
const { logTimesheetEntry } = require("./helpers/logTimesheetEntry");

// Read your daily data
const rawData = fs.readFileSync("timesheet-data.json");
const timesheetEntries = JSON.parse(rawData);

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: "auth-state.json" });
  const page = await context.newPage();

  try {
    console.log("Navigating to NetSuite Time Bill page...");
    await page.goto(
      "https://4890950.app.netsuite.com/app/accounting/transactions/timebill.nl",
    );

    for (const entry of timesheetEntries) {
      await logTimesheetEntry(page, entry);
    }

    console.log("All timesheet entries logged successfully!");
  } catch (error) {
    console.error("An error occurred while logging time:", error);
  } finally {
    await browser.close();
  }
})();

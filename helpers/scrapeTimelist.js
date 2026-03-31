/**
 * Scrapes the current timelist page and returns all visible entries.
 * Assumes the page is already navigated to timelist.nl and past auth.
 */
async function scrapeTimelist(page) {
  const NETSUITE_BASE = "https://4890950.app.netsuite.com";

  const entries = await page.evaluate((base) => {
    const rows = document.querySelectorAll(
      "#div__body tbody tr.uir-list-row-tr",
    );
    return Array.from(rows).map((row) => {
      const cells = row.querySelectorAll("td");

      // cells[0]=Edit|View, cells[1]=Date, cells[2]=Employee,
      // cells[3]=Customer, cells[4]=Item, cells[5]=Duration, cells[6]=ApprovalStatus
      const editLink = cells[0]?.querySelector("a.edititem");
      const relativeHref = editLink?.getAttribute("href") || "";
      const editUrl = relativeHref ? base + relativeHref : "";
      const idMatch = relativeHref.match(/[?&]id=(\d+)/);
      const internalId = idMatch ? idMatch[1] : "";

      const date = cells[1]?.textContent?.trim() || "";
      const customer = cells[3]?.textContent?.trim() || "";
      const item = cells[4]?.textContent?.trim() || "";
      const duration = cells[5]?.textContent?.trim() || "";
      const approvalStatus = cells[6]?.textContent?.trim() || "";

      return {
        internalId,
        editUrl,
        date,
        customer,
        item,
        duration,
        approvalStatus,
      };
    });
  }, NETSUITE_BASE);
  return entries;
}

module.exports = { scrapeTimelist };

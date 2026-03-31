const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { logTimesheetEntry } = require("./helpers/logTimesheetEntry");
const { scrapeTimelist } = require("./helpers/scrapeTimelist");
const { navigateWithAuth } = require("./helpers/autoLogin");

const DATA_FILE = path.join(__dirname, "timesheet-data.json");
const OPTIONS_FILE = path.join(__dirname, "options.json");
const CREDS_FILE = path.join(__dirname, "credentials.json");
const AUTH_FILE = path.join(__dirname, "auth-state.json");
const NETSUITE_ENTRIES_FILE = path.join(__dirname, "netsuite-entries.json");
const NETSUITE_TIMEBILL_URL =
  "https://4890950.app.netsuite.com/app/accounting/transactions/timebill.nl";
const NETSUITE_TIMELIST_URL =
  "https://4890950.app.netsuite.com/app/accounting/transactions/timelist.nl";
const PORT = 3000;

function loadOptions() {
  try {
    return JSON.parse(fs.readFileSync(OPTIONS_FILE, "utf8"));
  } catch {
    return { projects: [], serviceItems: [] };
  }
}

function loadCredentials() {
  try {
    return JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));
  } catch {
    return { email: "", password: "", securityAnswer: "", headless: true };
  }
}

function isHeadless() {
  const creds = loadCredentials();
  return creds.headless !== false; // default true
}

function saveCredentials(creds) {
  fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2));
}

// Convert YYYY-MM-DD (date input) to D/M/YYYY (NetSuite format)
function toNetSuiteDate(isoDate) {
  const [y, m, d] = isoDate.split("-");
  return `${parseInt(d)}/${parseInt(m)}/${y}`;
}

function loadEntries() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveEntries(entries) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(entries, null, 2));
}

function loadNetsuiteEntries() {
  try {
    return JSON.parse(fs.readFileSync(NETSUITE_ENTRIES_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveNetsuiteEntries(entries) {
  fs.writeFileSync(NETSUITE_ENTRIES_FILE, JSON.stringify(entries, null, 2));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const params = new URLSearchParams(body);
      resolve(Object.fromEntries(params.entries()));
    });
  });
}

function renderPage(entries, netsuiteEntries = [], message = "") {
  const { projects, serviceItems } = loadOptions();
  const tpl = fs.readFileSync(
    path.join(__dirname, "views", "index.html"),
    "utf8",
  );

  const projectOptions = projects
    .map((p) => `<option value="${p}">${p}</option>`)
    .join("");
  const serviceOptions = serviceItems
    .map((s) => `<option value="${s}">${s}</option>`)
    .join("");

  const localRows = entries
    .map(
      (e, i) => `
      <tr>
        <td>${e.date}</td>
        <td>${e.customer_name}</td>
        <td>${e.service_item_id}</td>
        <td>${e.mins}</td>
        <td>${e.memo}</td>
        <td><form method="POST" action="/delete" class="m-0"><input type="hidden" name="index" value="${i}"><button type="submit" class="btn btn-danger btn-sm" style="font-size:.78rem;padding:2px 8px">Delete</button></form></td>
      </tr>`,
    )
    .join("");

  const localTable =
    entries.length > 0
      ? `<div class="d-flex align-items-center justify-content-between mb-2">
          <h6 class="mb-0">Pending Entries (${entries.length})</h6>
          <button class="btn btn-success btn-sm" onclick="openSyncModal()">&#8593; Sync to NetSuite</button>
        </div>
        <div class="table-responsive"><table class="table table-sm table-striped table-bordered">
          <thead class="table-light"><tr><th>Date</th><th>Project</th><th>Service Item</th><th>Mins</th><th>Memo</th><th></th></tr></thead>
          <tbody>${localRows}</tbody>
        </table></div>`
      : `<p class="text-muted small">No entries yet. Add one below.</p>`;

  const msgHtml = message
    ? `<div class="alert alert-success">${message}</div>`
    : "";

  const sorted = [...netsuiteEntries].sort((a, b) => {
    const parse = (s) => {
      const [d, m, y] = (s || "").split("/");
      return new Date(+y, +m - 1, +d);
    };
    return parse(b.date) - parse(a.date);
  });

  return tpl
    .replace("{{MESSAGE}}", msgHtml)
    .replace("{{LOCAL_TABLE}}", localTable)
    .replace(/{{TODAY}}/g, new Date().toISOString().slice(0, 10))
    .replace("{{PROJECT_OPTIONS}}", projectOptions)
    .replace("{{SERVICE_OPTIONS}}", serviceOptions)
    .replace("{{ENTRY_COUNT}}", String(entries.length))
    .replace("{{ENTRY_WORD}}", entries.length === 1 ? "entry" : "entries")
    .replace("{{NS_DATA_JSON}}", JSON.stringify(sorted));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
    const entries = loadEntries();
    const netsuiteEntries = loadNetsuiteEntries();
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(renderPage(entries, netsuiteEntries));
  } else if (req.method === "GET" && req.url === "/sync") {
    res.socket.setTimeout(0);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const send = (type, message) => {
      res.write(`data: ${JSON.stringify({ type, message })}\n\n`);
      if (typeof res.flush === "function") res.flush();
    };

    // Heartbeat to keep the connection alive during long waits (e.g. auth login)
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
      if (typeof res.flush === "function") res.flush();
    }, 15000);

    (async () => {
      try {
        const entries = loadEntries();
        if (entries.length === 0) {
          send("error", "No entries to sync.");
          res.end();
          return;
        }

        send("progress", "Launching browser...");
        const storageState = fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined;
        const browser = await chromium.launch({ headless: isHeadless() });
        const context = await browser.newContext(
          storageState ? { storageState } : {},
        );
        const page = await context.newPage();

        send("progress", "Navigating to NetSuite...");
        await navigateWithAuth(
          page,
          context,
          NETSUITE_TIMEBILL_URL,
          AUTH_FILE,
          (msg) => send("progress", msg),
        );

        let synced = 0;
        const failed = [];
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          send(
            "progress",
            `Logging entry ${i + 1} of ${entries.length}: ${entry.memo}`,
          );
          if (i > 0) {
            await page.goto(NETSUITE_TIMEBILL_URL);
            await page.waitForLoadState("networkidle");
          }
          const result = await logTimesheetEntry(page, entry);
          if (result.ok) {
            synced++;
          } else {
            send("progress", `⚠ Entry ${i + 1} failed: ${result.error}`);
            failed.push(i);
          }
        }

        await browser.close();
        // Remove only successfully synced entries (keep failed ones)
        const remaining = entries.filter((_, i) => failed.includes(i));
        saveEntries(remaining);
        if (failed.length === 0) {
          send(
            "done",
            `Successfully synced ${synced} entr${synced === 1 ? "y" : "ies"} to NetSuite. The local list has been cleared.`,
          );
        } else {
          send(
            "done",
            `Synced ${synced} of ${entries.length} entries. ${failed.length} failed and remain in the local list.`,
          );
        }
      } catch (err) {
        send("error", err.message || String(err));
      } finally {
        clearInterval(heartbeat);
        res.end();
      }
    })();
  } else if (req.method === "GET" && req.url === "/fetch-netsuite") {
    res.socket.setTimeout(0);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const send = (type, message) => {
      res.write(`data: ${JSON.stringify({ type, message })}\n\n`);
      if (typeof res.flush === "function") res.flush();
    };

    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
      if (typeof res.flush === "function") res.flush();
    }, 15000);

    (async () => {
      try {
        send("progress", "Launching browser...");
        const storageState = fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined;
        const browser = await chromium.launch({ headless: isHeadless() });
        const context = await browser.newContext(
          storageState ? { storageState } : {},
        );
        const page = await context.newPage();

        send("progress", "Navigating to NetSuite timelist...");
        await navigateWithAuth(
          page,
          context,
          NETSUITE_TIMELIST_URL,
          AUTH_FILE,
          (msg) => send("progress", msg),
        );

        send("progress", "Scraping time entries...");
        const entries = await scrapeTimelist(page);
        await browser.close();

        saveNetsuiteEntries(entries);

        // Merge new projects & items into options.json
        const opts = loadOptions();
        const projects = new Set(opts.projects || []);
        const items = new Set(opts.serviceItems || []);
        for (const e of entries) {
          if (e.customer) projects.add(e.customer);
          if (e.item) items.add(e.item);
        }
        opts.projects = [...projects].sort();
        opts.serviceItems = [...items].sort();
        fs.writeFileSync(OPTIONS_FILE, JSON.stringify(opts, null, 2));

        send(
          "done",
          `Loaded ${entries.length} entr${entries.length === 1 ? "y" : "ies"} from NetSuite.`,
        );
      } catch (err) {
        send("error", err.message || String(err));
      } finally {
        clearInterval(heartbeat);
        res.end();
      }
    })();
  } else if (req.method === "POST" && req.url === "/open-netsuite") {
    // Fire-and-forget: open NetSuite home in a headed browser
    (async () => {
      try {
        const storageState = fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined;
        const browser = await chromium.launch({ headless: false });
        const context = await browser.newContext(
          storageState ? { storageState } : {},
        );
        const page = await context.newPage();
        await navigateWithAuth(page, context, "https://4890950.app.netsuite.com/app/center/card.nl", AUTH_FILE, () => {});
      } catch (err) {
        console.error("open-netsuite error:", err);
      }
    })();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } else if (req.method === "POST" && req.url === "/open-netsuite-url") {
    const data = await parseBody(req);
    const targetUrl = data.url;
    if (
      !targetUrl ||
      !targetUrl.startsWith("https://4890950.app.netsuite.com/")
    ) {
      res.writeHead(400);
      res.end("Invalid URL");
      return;
    }
    // Open in Playwright with saved auth — wait for browser to close
    (async () => {
      try {
        const storageState = fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined;
        const browser = await chromium.launch({ headless: false });
        const context = await browser.newContext(
          storageState ? { storageState } : {},
        );
        const page = await context.newPage();
        await navigateWithAuth(page, context, targetUrl, AUTH_FILE, () => {});
        // Wait until the user closes the browser
        await new Promise((resolve) => browser.on("disconnected", resolve));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error("open-netsuite-url error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
    })();
  } else if (req.method === "POST" && req.url === "/add") {
    const data = await parseBody(req);
    const errors = [];
    if (!data.date || !data.date.trim()) errors.push("Date is required.");
    if (!data.mins || isNaN(data.mins) || parseInt(data.mins) < 1) errors.push("Duration must be a positive number.");
    if (!data.customer_name || !data.customer_name.trim()) errors.push("Project is required.");
    if (!data.service_item_id || !data.service_item_id.trim()) errors.push("Service Item is required.");
    if (!data.memo || !data.memo.trim()) errors.push("Memo is required.");
    if (errors.length > 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, errors }));
      return;
    }
    const entries = loadEntries();
    entries.push({
      date: toNetSuiteDate(data.date.trim()),
      customer_name: data.customer_name.trim(),
      service_item_id: data.service_item_id.trim(),
      mins: data.mins.trim(),
      memo: data.memo.trim(),
    });
    saveEntries(entries);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } else if (req.method === "POST" && req.url === "/delete") {
    const data = await parseBody(req);
    const entries = loadEntries();
    entries.splice(parseInt(data.index, 10), 1);
    saveEntries(entries);
    res.writeHead(302, { Location: "/" });
    res.end();
  } else if (req.method === "GET" && req.url === "/settings") {
    const creds = loadCredentials();
    const opts = loadOptions();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ credentials: { email: creds.email || "", password: creds.password || "", securityAnswer: creds.securityAnswer || "", headless: creds.headless !== false }, options: opts }));
  } else if (req.method === "POST" && req.url === "/settings") {
    const raw = await new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => resolve(body));
    });
    let payload;
    try { payload = JSON.parse(raw); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    if (payload.credentials) {
      const c = payload.credentials;
      saveCredentials({ email: (c.email || "").trim(), password: (c.password || "").trim(), securityAnswer: (c.securityAnswer || "").trim(), headless: c.headless !== false });
    }
    if (payload.options) {
      const o = payload.options;
      const clean = (arr) => (arr || []).map(s => s.trim()).filter(Boolean);
      fs.writeFileSync(OPTIONS_FILE, JSON.stringify({ projects: clean(o.projects), serviceItems: clean(o.serviceItems) }, null, 2));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } else if (req.method === "POST" && req.url === "/validate-option") {
    const raw = await new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => resolve(body));
    });
    let payload;
    try { payload = JSON.parse(raw); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    const { type, value } = payload; // type: "project" | "serviceItem"
    if (!type || !value) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ valid: false, error: "Missing type or value" })); return; }
    (async () => {
      try {
        const storageState = fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined;
        const browser = await chromium.launch({ headless: isHeadless() });
        const context = await browser.newContext(storageState ? { storageState } : {});
        const page = await context.newPage();
        await navigateWithAuth(page, context, NETSUITE_TIMEBILL_URL, AUTH_FILE, () => {});
        const selector = type === "project" ? "#customer_display" : "#item_display";
        await page.locator(selector).click();
        await page.locator(selector).fill(value);
        await page.keyboard.press("Tab");
        await page.waitForTimeout(2000);
        await page.waitForLoadState("networkidle");
        // Check if an alert/error popup appeared
        const alertText = await page.locator(".uir-alert-box, .descr, #uir_alert_box").textContent().catch(() => "");
        const fieldVal = await page.locator(selector).inputValue();
        await browser.close();
        const valid = fieldVal.length > 0 && !alertText.toLowerCase().includes("invalid");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ valid, fieldValue: fieldVal, alert: alertText || null }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ valid: false, error: err.message }));
      }
    })();
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Timesheet form running at ${url}`);
  // Auto-open in default browser
  const { exec } = require("child_process");
  exec(`start ${url}`);
});

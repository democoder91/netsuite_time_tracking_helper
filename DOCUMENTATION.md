# NetSuite Automator — Documentation

## Overview

A Node.js application that automates NetSuite time-tracking through a Bootstrap 5 web interface. Uses Playwright to interact with NetSuite's browser-based UI for creating, reading, and editing time entries.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser (localhost:3000)                        │
│  Bootstrap 5 UI  ←→  SSE progress streams        │
└────────────────────┬────────────────────────────┘
                     │ HTTP
┌────────────────────▼────────────────────────────┐
│  3-fill-timesheet.js  (Node HTTP server)         │
│  Routes: /, /add, /delete, /sync, /fetch-netsuite│
│          /open-netsuite, /open-netsuite-url       │
│          /settings, /validate-option              │
└────────────┬────────────────────────────────────┘
             │ Playwright
┌────────────▼────────────────────────────────────┐
│  NetSuite (4890950.app.netsuite.com)             │
│  timebill.nl  |  timelist.nl  |  card.nl         │
└─────────────────────────────────────────────────┘
```

### Data Flow

1. User adds entries via the web form → stored in `timesheet-data.json`
2. "Sync" sends entries to NetSuite one-by-one via Playwright → clears successful entries
3. "Fetch" scrapes the timelist page → stores in `netsuite-entries.json` and merges options into `options.json`

---

## File Structure

### Application Files

| File                  | Description                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `3-fill-timesheet.js` | Main HTTP server (port 3000). Serves UI, handles all routes, orchestrates Playwright sessions |
| `1-setup-auth.js`     | Standalone script — authenticates with NetSuite and saves session to `auth-state.json`        |
| `2-log-time.js`       | Standalone script — reads `timesheet-data.json` and submits entries via Playwright (no UI)    |
| `4-open-netsuite.js`  | Standalone script — opens NetSuite in a headed browser with saved session                     |
| `views/index.html`    | Bootstrap 5 HTML template with `{{PLACEHOLDER}}` tokens replaced at render time               |
| `package.json`        | Project metadata; depends on `playwright ^1.58.2`                                             |
| `.gitignore`          | Excludes `credentials.json`, `auth-state.json`, `netsuite-entries.json`, `node_modules/`      |

### Helper Modules (`helpers/`)

| File                   | Exports                                                                   | Description                                                                                             |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `autoLogin.js`         | `navigateWithAuth(page, context, targetUrl, authFile, log)`               | Navigates to a URL; auto-logs in if session expired; handles security questions; saves cookies          |
| `fillInput.js`         | `fillInput(page, locator, value, timeout)`                                | Base helper — clicks field, fills value, presses Tab, waits for networkidle                             |
| `timesheetFields.js`   | `fillDate`, `fillDuration`, `fillCustomer`, `fillServiceItem`, `fillMemo` | Field-specific wrappers around `fillInput` for each timebill form field                                 |
| `logTimesheetEntry.js` | `logTimesheetEntry(page, entry)`                                          | Fills all fields + saves. Returns `{ok, error}` with pre/post-save error checking                       |
| `saveEntry.js`         | `saveEntry(page)`                                                         | Clicks the NetSuite save button (`#btn_secondarymultibutton_submitter`)                                 |
| `scrapeTimelist.js`    | `scrapeTimelist(page)`                                                    | Extracts all visible rows from the timelist table (ID, date, customer, item, duration, status, editUrl) |

### Data Files (runtime-generated)

| File                    | Format                                        | Description                                      |
| ----------------------- | --------------------------------------------- | ------------------------------------------------ |
| `credentials.json`      | `{email, password, securityAnswer, headless}` | Login credentials and headless preference        |
| `auth-state.json`       | Playwright storage state                      | Saved cookies/session for re-use across launches |
| `timesheet-data.json`   | Array of entry objects                        | Pending (not yet synced) time entries            |
| `netsuite-entries.json` | Array of entry objects                        | Entries fetched (scraped) from NetSuite          |
| `options.json`          | `{projects: [...], serviceItems: [...]}`      | Dropdown options for projects and service items  |

---

## Server Routes

### `GET /`

Renders the main page. Calls `renderPage()` which:

- Reads `views/index.html`
- Replaces template tokens: `{{MESSAGE}}`, `{{LOCAL_TABLE}}`, `{{TODAY}}`, `{{PROJECT_OPTIONS}}`, `{{SERVICE_OPTIONS}}`, `{{ENTRY_COUNT}}`, `{{ENTRY_WORD}}`, `{{NS_DATA_JSON}}`
- Injects pending entries as an HTML table and NetSuite entries as a JSON array

### `POST /add`

Adds a new pending entry to `timesheet-data.json`.

- **Body** (form-urlencoded): `date`, `mins`, `customer_name`, `service_item_id`, `memo`
- **Validation**: All fields required; `mins` must be a positive number
- **Response**: `{ok: true}` on success; `{ok: false, errors: [...]}` on validation failure
- Date is converted from `YYYY-MM-DD` to `D/M/YYYY` (NetSuite format)

### `POST /delete`

Removes an entry by index from `timesheet-data.json`. Redirects to `/`.

- **Body** (form-urlencoded): `index`

### `GET /sync` (SSE)

Submits all pending entries to NetSuite via Playwright.

- Opens a browser (headless by preference), navigates to `timebill.nl`
- Iterates each entry: fills fields, saves, checks for errors
- Successful entries are removed from `timesheet-data.json`; failed entries remain
- Streams progress via Server-Sent Events:
  - `{type: "progress", message: "..."}` — status updates
  - `{type: "done", message: "..."}` — completion summary
  - `{type: "error", message: "..."}` — fatal error

### `GET /fetch-netsuite` (SSE)

Scrapes the NetSuite timelist and saves results.

- Opens a browser (headless by preference), navigates to `timelist.nl`
- Scrapes all visible rows via `scrapeTimelist()`
- Saves to `netsuite-entries.json`
- Merges discovered projects and service items into `options.json` (additive — never removes existing options)
- Streams progress via SSE (same format as sync)

### `POST /open-netsuite`

Opens NetSuite home page (`card.nl`) in a headed browser. Fire-and-forget — returns immediately.

- **Response**: `{ok: true}`
- Always uses headed (visible) browser regardless of preference

### `POST /open-netsuite-url`

Opens a specific NetSuite URL in a headed browser and waits for the user to close it.

- **Body** (form-urlencoded): `url` (must start with `https://4890950.app.netsuite.com/`)
- Blocks until the browser is closed by the user
- Used by the "Edit" button on fetched entries — after close, the UI auto-triggers a fetch

### `GET /settings`

Returns current settings as JSON:

```json
{
  "credentials": { "email": "...", "password": "...", "securityAnswer": "...", "headless": true },
  "options": { "projects": [...], "serviceItems": [...] }
}
```

### `POST /settings`

Saves credentials and/or options.

- **Body** (JSON): `{credentials: {...}, options: {...}}`
- Writes to `credentials.json` and `options.json`

### `POST /validate-option`

Validates a project name or service item against NetSuite.

- **Body** (JSON): `{type: "project"|"serviceItem", value: "..."}`
- Opens a headless browser to `timebill.nl`, fills the corresponding field, checks for errors
- **Response**: `{valid: true/false, fieldValue: "...", alert: "..."}`

---

## Authentication Flow

```
navigateWithAuth(page, context, targetUrl, authFile, log)
│
├─ Navigate to targetUrl
├─ If not on login page → session valid, return
│
├─ If credentials.json has email + password:
│   ├─ Go to login page
│   ├─ Fill email + password, press Enter
│   ├─ If redirected to security question page:
│   │   ├─ If securityAnswer exists → fill and submit
│   │   └─ Else → wait for manual answer
│   └─ Save cookies to auth-state.json
│
└─ Else → wait for manual login, then save cookies
```

Login is attempted automatically with saved credentials. If a security question page appears, it's answered automatically (if the answer is configured) or the user is prompted to answer manually. Cookies are always saved after a successful login.

---

## Template System

`views/index.html` is a static HTML file with `{{PLACEHOLDER}}` tokens. The `renderPage()` function on the server reads the template and replaces:

| Token                 | Replaced With                                              |
| --------------------- | ---------------------------------------------------------- |
| `{{MESSAGE}}`         | Alert div (success messages) or empty string               |
| `{{LOCAL_TABLE}}`     | HTML table of pending entries, or "No entries yet" message |
| `{{TODAY}}`           | Current date in `YYYY-MM-DD` format (used in date inputs)  |
| `{{PROJECT_OPTIONS}}` | `<option>` tags for projects from `options.json`           |
| `{{SERVICE_OPTIONS}}` | `<option>` tags for service items from `options.json`      |
| `{{ENTRY_COUNT}}`     | Number of pending entries                                  |
| `{{ENTRY_WORD}}`      | "entry" or "entries" (singular/plural)                     |
| `{{NS_DATA_JSON}}`    | JSON array of NetSuite entries (sorted by date descending) |

---

## Web UI

### Layout

1. **Header** — Title, "Open NetSuite" button, Settings gear
2. **Add Entry Card** — Form (date, duration, project, service item, memo) → pending entries table with Sync and Delete buttons
3. **NetSuite Entries Card** — Fetch button, filter dropdowns (project, item), page size selector, paginated table with Edit buttons

### Client-Side Features

- **Filtering**: Project and Item dropdowns filter the NetSuite entries table in real-time
- **Pagination**: Configurable page size (10/25/50/100), page navigation buttons
- **SSE Progress**: Sync and Fetch operations show a modal with live progress log streamed from the server
- **Edit Flow**: Clicking "Edit" opens the entry in a headed browser; after user closes it, entries are automatically re-fetched
- **Add Entry**: Submits via fetch API; on success, reloads the page; on validation error, displays inline messages

### Settings Modal (3 tabs)

- **Credentials**: Email, password, security answer
- **Options**: Add/remove/validate projects and service items
- **Preferences**: "Run browser in background" toggle (headless mode)

---

## Headless Preference

The `headless` flag in `credentials.json` controls whether Playwright runs visibly or in the background.

| Operation                            | Uses Preference? | Notes                                           |
| ------------------------------------ | ---------------- | ----------------------------------------------- |
| Sync (`/sync`)                       | Yes              | `isHeadless()`                                  |
| Fetch (`/fetch-netsuite`)            | Yes              | `isHeadless()`                                  |
| Validate option (`/validate-option`) | Yes              | `isHeadless()`                                  |
| Edit (`/open-netsuite-url`)          | No               | Always headed — user interacts with the browser |
| Open NetSuite (`/open-netsuite`)     | No               | Always headed — user interacts with the browser |

Default is `true` (headless). Toggle via Settings → Preferences.

---

## Entry Object Formats

### Pending Entry (`timesheet-data.json`)

```json
{
  "date": "1/6/2025",
  "customer_name": "Project Name",
  "service_item_id": "Service Item Name",
  "mins": "60",
  "memo": "Description of work"
}
```

### Fetched Entry (`netsuite-entries.json`)

```json
{
  "internalId": "12345",
  "editUrl": "https://4890950.app.netsuite.com/app/accounting/transactions/timebill.nl?id=12345&e=T",
  "date": "1/6/2025",
  "customer": "Project Name",
  "item": "Service Item Name",
  "duration": "1:00",
  "approvalStatus": "Pending Approval"
}
```

---

## NetSuite Field Selectors

| Field            | Selector                                 | Method                        |
| ---------------- | ---------------------------------------- | ----------------------------- |
| Date             | `#trandate`                              | `fillInput`                   |
| Duration         | `#hours`                                 | `fillInput`                   |
| Project/Customer | `#customer_display`                      | `fillInput`                   |
| Service Item     | `#item_display`                          | `fillInput`                   |
| Memo             | `getByRole('textbox', { name: 'Memo' })` | `page.getByRole`              |
| Save Button      | `#btn_secondarymultibutton_submitter`    | `page.locator.click`          |
| Error alerts     | `.uir-alert-box .descr`                  | Checked before and after save |

---

## Scraping (timelist.nl)

The scraper reads rows from `#div__body tbody tr.uir-list-row-tr` and extracts cells by index:

| Index | Content                                      |
| ----- | -------------------------------------------- |
| 0     | Edit link (contains `href` with internal ID) |
| 1     | Date                                         |
| 2     | Employee (not used)                          |
| 3     | Customer/Project                             |
| 4     | Service Item                                 |
| 5     | Duration                                     |
| 6     | Approval Status                              |

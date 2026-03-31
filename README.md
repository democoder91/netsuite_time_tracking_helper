# NetSuite Time Tracking Helper

A local web app that simplifies NetSuite time entry. Add timesheet entries through a clean Bootstrap 5 form, then sync them to NetSuite in one click — powered by [Playwright](https://playwright.dev/) browser automation.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green) ![Playwright](https://img.shields.io/badge/Playwright-1.58-blue) ![Bootstrap](https://img.shields.io/badge/Bootstrap-5.3-purple)

## Features

- **Web UI** — Add, review, and delete time entries from `http://localhost:3000`
- **One-click sync** — Submit all pending entries to NetSuite automatically
- **Fetch entries** — Scrape your existing NetSuite timelist and view it locally with filtering and pagination
- **Edit in NetSuite** — Open any entry in a browser, edit it, and auto-refresh the local view
- **Auto-login** — Stores credentials and handles login + security questions automatically
- **Settings panel** — Manage credentials, project/service-item options, and preferences from the UI
- **Headless mode** — Runs browser automation invisibly by default (toggle in Settings)
- **Live progress** — SSE-powered progress log during sync and fetch operations

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright's Chromium browser
npx playwright install chromium

# 3. Start the app
node 3-fill-timesheet.js
```

The app opens in your browser at **http://localhost:3000**.

On first launch, click **⚙ Settings** and enter your NetSuite credentials (email, password, and optionally your security question answer).

## How It Works

```
You (browser form)  →  Local JSON file  →  Playwright  →  NetSuite
                    add entries        sync entries     fills & submits
```

1. **Add entries** through the web form — they're saved locally in `timesheet-data.json`
2. **Sync to NetSuite** — Playwright opens NetSuite (headless by default), fills each entry into the timebill form, and submits it
3. **Fetch from NetSuite** — Scrapes the timelist page and displays entries locally with project/item filters and pagination

## Standalone Scripts

| Script                     | What it does                                                 |
| -------------------------- | ------------------------------------------------------------ |
| `node 1-setup-auth.js`     | Log in to NetSuite and save session cookies                  |
| `node 2-log-time.js`       | Submit entries from `timesheet-data.json` without the web UI |
| `node 3-fill-timesheet.js` | **Main app** — starts the web server                         |
| `node 4-open-netsuite.js`  | Open NetSuite in a browser with your saved session           |

## Project Structure

```
├── 3-fill-timesheet.js        # HTTP server + all routes
├── views/
│   └── index.html             # Bootstrap 5 UI template
├── helpers/
│   ├── autoLogin.js           # Auto-login + security question handling
│   ├── fillInput.js           # Base form-fill helper
│   ├── timesheetFields.js     # Field-specific fill functions
│   ├── logTimesheetEntry.js   # Orchestrates filling + saving an entry
│   ├── saveEntry.js           # Clicks the NetSuite save button
│   └── scrapeTimelist.js      # Scrapes the timelist table
├── 1-setup-auth.js            # Auth setup script
├── 2-log-time.js              # CLI batch submit script
├── 4-open-netsuite.js         # Open NetSuite script
├── options.json               # Project & service item dropdown options
├── timesheet-data.json        # Pending entries (local queue)
└── .gitignore
```

**Runtime files** (git-ignored):

| File                    | Purpose                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `credentials.json`      | Your login email, password, security answer, headless preference |
| `auth-state.json`       | Saved browser cookies for session reuse                          |
| `netsuite-entries.json` | Entries fetched from NetSuite                                    |

## Configuration

You can configure credentials in three ways:

1. **Settings UI** (recommended) — click ⚙ in the app header
2. **CLI script** — run `node 1-setup-auth.js` to log in via browser
3. **Manual file** — create `credentials.json`:
   ```json
   {
     "email": "your@email.com",
     "password": "your-password",
     "securityAnswer": "your-answer",
     "headless": true
   }
   ```

## Further Reading

- [SETUP.md](SETUP.md) — Detailed setup and installation instructions
- [DOCUMENTATION.md](DOCUMENTATION.md) — Full technical documentation (routes, architecture, data formats, selectors)

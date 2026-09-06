# Basepoint — POS & Business Operations Platform

Basepoint is a single-file, browser-based prototype of an all-in-one POS and
business operations platform: sales, inventory, purchasing, customers,
expenses, reporting, and a full role-based employee permissions system.

It's built to be dropped straight into GitHub Pages, opened as a local file,
or handed to a dev team as a working reference for what the real product
should do.

**[Live demo →](https://leviclinton.github.io/basepoint-pos-platform/)**
*(replace with your actual Pages URL if different)*

---

## What's inside

### Core operations
- **Onboarding wizard** — business name, type, branding, tax setup, and a choice between seeded demo data or a blank workspace
- **Dashboard** — revenue, orders, gross profit, low-stock alerts, 14-day sales trend, top products
- **Point of Sale** — product search/scan, cart, discounts, tax, hold/resume orders, split payments, printable receipts; every sale updates real stock
- **Products & Inventory** — full CRUD, low-stock alert tab, complete inventory movement history
- **Purchases & Suppliers** — create purchase orders, mark received to restock, supplier balances
- **Customers (CRM)** — profiles with live purchase history
- **Expenses** — categorized tracking that feeds the finance view
- **Reports** — sales, inventory, and financial breakdowns with CSV export

### Admin & permissions system
- **Employees** — 7-step creation wizard, status management (active/suspended/deactivated), PIN reset, owner-protected accounts
- **Roles & Permissions** — 7 seeded roles (Owner, Manager, Supervisor, Cashier, Inventory Manager, Accountant, Staff), fully custom roles, an interactive permission matrix, 60+ granular permissions in plain language
- **Special access** — per-employee additional grants and explicit restrictions, layered on top of their role
- **Manager approval** — sensitive actions (large discounts, refunds) prompt for a manager's PIN before proceeding; PINs are hashed with `SubtleCrypto` (SHA-256), never stored or compared as plaintext
- **Departments & Branches** — customizable departments scoped to modules; branch assignment per employee
- **Activity Log** — searchable, filterable audit trail of actions across the app
- **Security Center** — active sessions, failed PIN attempts, permission-change history, session revocation

### Settings
Branding, currency/tax, payment methods, receipt template, and per-module
enable/disable toggles.

---

## Tech notes

- **Single HTML file.** React, ReactDOM, Babel Standalone, and Tailwind CSS
  all load from CDNs; there's no build step and nothing to install.
- **No backend.** All data lives in React state for the current browser
  session — nothing persists after a refresh, and nothing is sent anywhere.
  This means the permission system is a genuine, centralized authorization
  model (every check runs through one `can(employee, role, permission)`
  function), but it is **not enforced server-side** because there is no
  server. Don't use this for real business data.
- **JSX runtime note:** the app code is transformed explicitly with Babel's
  *classic* JSX runtime at load time (see the bootstrap `<script>` at the
  bottom of the file) rather than relying on Babel Standalone's default
  auto-scan, which emits `import` statements that break in a plain script
  tag. If you fork this and it goes blank, check that transform first.

---

## Running it

**Locally:** just open `index.html` in any modern browser. Requires an
internet connection (for the CDN scripts and fonts).

**On GitHub Pages:**
1. Make sure the file is named `index.html` at the repo root.
2. Repo **Settings → Pages** → Source: `main` branch, `/ (root)`.
3. Wait ~30–60 seconds after each push for the deploy to refresh.
4. Hard-refresh your browser (`Ctrl/Cmd+Shift+R`) — Pages and browsers both
   cache aggressively.

---

## Trying the demo data

Choosing **"Start with demo data"** during onboarding seeds a sample café
business ("Urban Coffee") with products, sales history, and this team:

| Name | Role | Demo PIN | Status |
|---|---|---|---|
| You (Owner) | Owner | `1234` | Active |
| Peter Njoroge | Manager | `2580` | Active |
| Lucy Chebet | Cashier | `1111` | Active |
| Samuel Kiptoo | Cashier | `2222` | Active |
| Ruth Adhiambo | Inventory Manager | `3333` | Active |
| Moses Kamau | Accountant | `4444` | Suspended |

Use the employee switcher in the top bar to log in as any of them and watch
the sidebar and available actions change to match their permissions. To see
the manager-approval flow: switch to **Lucy Chebet**, open **POS → Recent
sales → Refund**, and enter Peter's PIN (`2580`) when prompted.

---

## Known limitations

- No real authentication, persistence, or multi-user sync — everything is
  local to one browser tab's session.
- No true tenant isolation, since there's only ever one business per session.
- Offline support, kitchen/table management, and payment integrations
  (M-Pesa, Stripe, etc.) are out of scope for this prototype.

## License

Add a license of your choosing here.

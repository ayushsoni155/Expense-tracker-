# 💸 Spendly — Expense Tracker

A beautiful, animated, fully-responsive expense tracker. **No database, no backend, no build step** — pure HTML/CSS/JS. Each profile's data is a JSON document kept **on the device**, and **encrypted at rest** when you set a PIN.

## ✨ Features

- **Multi-user profiles** — pick an emoji avatar + colour, a currency, and an optional 4-digit PIN. Each profile has its own isolated JSON data store.
- **Exact amounts, always** — `18086` shows as `₹18,086`, never `18.1k`. Full grouped numbers everywhere (tiles, lists, charts, tooltips).
- **Auto + manual theme** — “System” follows your device’s light/dark setting and switches live; or force Light/Dark from the top bar or **Settings → Appearance**.
- **Security, on-device** (no server involved)
  - Set a PIN → your transactions are **encrypted with AES-256-GCM** (key derived from the PIN via PBKDF2) before they’re written to storage, so they’re unreadable without it.
  - **Fingerprint / Face ID unlock** (WebAuthn platform authenticator), usable **with _or_ without a PIN**:
    - *With a PIN* — biometrics are a quick unlock; the PIN still works as a fallback.
    - *Without a PIN (biometric-only)* — a random AES key is generated and wrapped behind a **non-extractable device key** (kept in IndexedDB) that only your fingerprint / Face ID can release. Data is still encrypted; there’s no PIN fallback, so keep an exported backup.
  - All of this is local to the device — nothing is sent anywhere. Biometrics need a real origin (`https://` or `http://localhost`), so they’re disabled on `file://`.
- **Credit & debit tracking** — amount, category (with emoji), date, method (UPI / cash / card / bank), and notes. Edit or delete anything.
- **Confirmation popups** before every destructive action (delete transaction, clear all, delete profile, import).
- **Filters** — live search, type toggle, category, date ranges (this month, last month, 30/90 days, this year, custom), four sort orders, and a live filtered totals summary.
- **Analytics** — period selector, stat tiles, monthly credit-vs-debit bar chart, category donut with legend, and a top-categories ranking — all hand-drawn SVG with tooltips.
- **Dashboard** — total balance, this-month credit/debit with % change vs last month, 30-day spending trend line, recent activity.
- **JSON export / import** — back up your data or move it between devices.
- **Design** — animated gradient background, count-up numbers, staggered list & chart animations, spring modals, toasts, hover micro-interactions, mobile bottom nav + FAB. Respects `prefers-reduced-motion`.

## 🔒 How data is stored (and why it’s on-device)

Everything lives in your browser via `localStorage`, per profile:

- `spendly_profiles_v1` — profile list (name, avatar, colour, currency, PIN hash, KDF salt).
- `spendly_data_<profileId>` — that profile’s data. **Plaintext JSON if no PIN; an AES-256-GCM envelope `{ iv, ct }` if a PIN is set.**

A transaction looks like:
```json
{ "id": "m3k9x2ab", "type": "debit", "amount": 18086, "category": "shopping", "date": "2026-07-03", "note": "Laptop", "method": "card" }
```

> **Why not a shared `data.json` on the server?** Vercel’s serverless filesystem is **read-only** — an app can’t persist writes to a file, and `/tmp` is wiped between requests and never shared between devices. Truly syncing “one JSON file across every device” therefore requires cloud storage (e.g. Vercel Blob/KV) + accounts, which this build intentionally avoids. Instead, data stays **private on each device** and you move it with **Export / Import JSON**. A PIN encrypts it; biometric unlock is a convenience on top.

## 🚀 Deploy to Vercel

It’s a static site — no build step.

**CLI**
```bash
npm i -g vercel
cd ExpenseTracker
vercel --prod
```

**Dashboard:** push to a GitHub repo → [vercel.com/new](https://vercel.com/new) → import → Framework preset: **Other** → Deploy. No build command, no output directory.

`vercel.json` ships a strict Content-Security-Policy and security headers (HSTS, `nosniff`, `frame-ancestors 'none'`, no-referrer). Biometrics and Web Crypto require **HTTPS**, which Vercel provides automatically.

## 🖥️ Run locally

Open `index.html` directly, or serve it:
```bash
npx serve .
```
> Note: fingerprint/Face-ID unlock needs a real origin (`http://localhost` or HTTPS), so it’s disabled on the `file://` protocol. PIN + encryption work everywhere.

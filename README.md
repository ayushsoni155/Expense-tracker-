# 💸 Spendly — Multi-user Expense Tracker

A beautiful, animated, fully responsive expense tracker. **No database, no backend, no build step** — pure HTML/CSS/JS. Every user's data is a JSON document stored on their device (localStorage), exportable and importable as a `.json` file.

## ✨ Features

- **Multi-user profiles** — anyone opens the site, creates a profile with their name, avatar color, currency, and an optional 4-digit PIN (stored as a SHA-256 hash). Each profile gets its own isolated JSON data store.
- **Credit & debit tracking** — amount, category (with emoji), date, payment method (UPI / cash / card / bank), and notes. Edit or delete any transaction.
- **Filters** — live search, type toggle (all / credit / debit), category, date ranges (this month, last month, 30/90 days, this year, custom from–to), and four sort orders, with a live filtered totals summary.
- **Analytics** — period selector (month / 3m / 6m / year / all), stat tiles (credit, debit, net, avg spend/day, savings rate), monthly credit-vs-debit grouped bar chart, category donut with legend, and a top-categories ranking — all hand-drawn SVG with tooltips.
- **Dashboard** — total balance, this-month credit/debit with % change vs last month, 30-day spending trend line, recent activity.
- **JSON export / import** — back up your data or move it between devices (Settings → Your data).
- **Dark & light themes**, count-up numbers, staggered list animations, spring modals, toasts, animated charts, mobile bottom nav + FAB. Respects `prefers-reduced-motion`.

## 🚀 Deploy to Vercel

**Option A — Vercel CLI (fastest):**
```bash
npm i -g vercel
cd ExpenseTracker
vercel --prod
```

**Option B — Dashboard:** push this folder to a GitHub repo → [vercel.com/new](https://vercel.com/new) → import the repo → Framework preset: **Other** → Deploy. No build command, no output directory needed.

**Option C — Drag & drop:** zip the folder and drop it at [vercel.com/new](https://vercel.com/new).

## 📁 How data is stored

- `spendly_profiles_v1` — list of profiles (name, color, currency, PIN hash)
- `spendly_data_<profileId>` — that user's JSON: `{ "transactions": [...] }`

A transaction looks like:
```json
{
  "id": "m3k9x2ab",
  "type": "debit",
  "amount": 450,
  "category": "food",
  "date": "2026-07-02",
  "note": "Dinner with team",
  "method": "upi"
}
```

> **Note:** Vercel's serverless filesystem is read-only, so a shared server-side JSON file isn't possible without a database. Data therefore lives per-browser — the Export/Import JSON buttons are how you back up or move it. A PIN protects a profile from other people using the same browser, but anyone with device access could read localStorage directly — don't treat it as bank-grade security.

## 🖥️ Run locally

Just open `index.html`, or serve it:
```bash
npx serve .
```

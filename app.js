/* ═════════════════════ SPENDLY — app.js ═════════════════════
   Multi-user expense tracker. Each profile's data is a JSON
   document persisted in localStorage (exportable / importable). */

"use strict";

/* ── Constants ── */
const LS_PROFILES = "spendly_profiles_v1";
const LS_SESSION  = "spendly_session_v1";
const LS_THEME    = "spendly_theme_v1";
const dataKey = (id) => `spendly_data_${id}`;

const CURRENCY = { INR: "₹", USD: "$", EUR: "€", GBP: "£", AED: "د.إ", JPY: "¥" };

const AVATAR_COLORS = ["#3987e5", "#199e70", "#c98500", "#9085e9", "#e66767", "#d95926", "#d55181", "#256abf"];

const CATS = {
  debit: [
    { id: "food",      name: "Food & Dining",  emoji: "🍔" },
    { id: "groceries", name: "Groceries",      emoji: "🛒" },
    { id: "transport", name: "Transport",      emoji: "🚗" },
    { id: "shopping",  name: "Shopping",       emoji: "🛍️" },
    { id: "bills",     name: "Bills & Utility",emoji: "💡" },
    { id: "rent",      name: "Rent & Home",    emoji: "🏠" },
    { id: "fun",       name: "Entertainment",  emoji: "🎬" },
    { id: "health",    name: "Health",         emoji: "💊" },
    { id: "gym",       name: "Gym & Fitness",  emoji: "🏋️" },
    { id: "savings",   name: "Savings",        emoji: "💎" },
    { id: "invest-out",name: "Investment",     emoji: "📊" },
    { id: "subs",      name: "Subscriptions",  emoji: "📺" },
    { id: "mobile",    name: "Mobile & Net",   emoji: "📱" },
    { id: "emi",       name: "EMI & Loans",    emoji: "🏦" },
    { id: "insurance", name: "Insurance",      emoji: "🛡️" },
    { id: "education", name: "Education",      emoji: "📚" },
    { id: "travel",    name: "Travel",         emoji: "✈️" },
    { id: "personal",  name: "Personal Care",  emoji: "💇" },
    { id: "family",    name: "Family & Kids",  emoji: "👨‍👩‍👧" },
    { id: "pets",      name: "Pets",           emoji: "🐾" },
    { id: "donation",  name: "Donation",       emoji: "❤️" },
    { id: "gifts-out", name: "Gifts Given",    emoji: "🎁" },
    { id: "other-out", name: "Other",          emoji: "📦" },
  ],
  credit: [
    { id: "salary",    name: "Salary",     emoji: "💼" },
    { id: "business",  name: "Business",   emoji: "💰" },
    { id: "freelance", name: "Freelance",  emoji: "🧑‍💻" },
    { id: "invest",    name: "Investment Return", emoji: "📈" },
    { id: "bonus",     name: "Bonus",      emoji: "🎯" },
    { id: "interest",  name: "Interest",   emoji: "🪙" },
    { id: "rental",    name: "Rental Income", emoji: "🔑" },
    { id: "cashback",  name: "Cashback",   emoji: "💳" },
    { id: "sold",      name: "Sold Items", emoji: "🏷️" },
    { id: "pocket",    name: "Pocket Money", emoji: "🪄" },
    { id: "gift",      name: "Gift",       emoji: "🎁" },
    { id: "refund",    name: "Refund",     emoji: "↩️" },
    { id: "other-in",  name: "Other",      emoji: "📦" },
  ],
};
const ALL_CATS = [...CATS.debit, ...CATS.credit];
const catById = (id) => ALL_CATS.find((c) => c.id === id) || { id, name: id, emoji: "📦" };

const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)"];
const METHODS = { upi: "UPI", cash: "Cash", card: "Card", bank: "Bank", other: "Other" };

/* ── State ── */
let profiles = [];
let user = null;            // active profile
let data = { transactions: [] };
let currentView = "dashboard";
let modalType = "debit";
let modalCat = null;
let editingId = null;
let pendingProfile = null;  // profile awaiting PIN
let anPeriodVal = "month";
const filters = { search: "", type: "all", category: "all", range: "all", from: "", to: "", sort: "date-desc" };

/* ── Helpers ── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

function sym() { return CURRENCY[user?.currency] || "₹"; }
function fmt(n, compact = false) {
  const s = sym();
  const abs = Math.abs(n);
  if (compact && abs >= 1000) {
    const units = [["Cr", 1e7], ["L", 1e5], ["K", 1e3]];
    const useIndian = user?.currency === "INR";
    const list = useIndian ? units : [["M", 1e6], ["K", 1e3]];
    for (const [u, v] of list) if (abs >= v) return s + trim(abs / v) + u;
  }
  return s + abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
const trim = (n) => (Math.round(n * 10) / 10).toLocaleString();

/* local-timezone ISO date (toISOString shifts days for UTC+ timezones) */
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayStr = () => isoLocal(new Date());
function niceDate(iso) {
  const d = new Date(iso + "T00:00:00");
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - d) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() !== t.getFullYear() ? "numeric" : undefined });
}
const monthKey = (iso) => iso.slice(0, 7);

async function hashPin(pin) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("spendly:" + pin));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ── Storage ── */
function loadProfiles() { try { profiles = JSON.parse(localStorage.getItem(LS_PROFILES)) || []; } catch { profiles = []; } }
function saveProfiles() { localStorage.setItem(LS_PROFILES, JSON.stringify(profiles)); }
function loadData(id) {
  try { data = JSON.parse(localStorage.getItem(dataKey(id))) || { transactions: [] }; }
  catch { data = { transactions: [] }; }
  if (!Array.isArray(data.transactions)) data.transactions = [];
}
function saveData() { if (user) localStorage.setItem(dataKey(user.id), JSON.stringify(data)); }

/* ── Toasts ── */
function toast(msg, emoji = "✅") {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span>${emoji}</span><span>${esc(msg)}</span>`;
  $("#toastWrap").appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 350); }, 2600);
}

/* ── Confirm dialog ── */
let confirmCb = null;
function askConfirm(title, text, cb) {
  $("#confirmTitle").textContent = title;
  $("#confirmText").textContent = text;
  confirmCb = cb;
  $("#confirmModal").classList.remove("hidden", "closing");
}
$("#confirmYes").addEventListener("click", () => { closeOverlay("#confirmModal"); confirmCb?.(); confirmCb = null; });
$("#confirmNo").addEventListener("click", () => { closeOverlay("#confirmModal"); confirmCb = null; });

function closeOverlay(sel) {
  const ov = $(sel);
  ov.classList.add("closing");
  setTimeout(() => ov.classList.add("hidden"), 190);
}

/* ═════════════════ AUTH ═════════════════ */
let chosenColor = AVATAR_COLORS[0];

function renderColorRow() {
  $("#colorRow").innerHTML = AVATAR_COLORS.map(
    (c) => `<button type="button" class="color-dot ${c === chosenColor ? "active" : ""}" style="background:${c}" data-c="${c}" aria-label="color"></button>`
  ).join("");
}
$("#colorRow").addEventListener("click", (e) => {
  const b = e.target.closest(".color-dot"); if (!b) return;
  chosenColor = b.dataset.c; renderColorRow();
});

function showAuthPane(pane) {
  ["#profilePicker", "#createForm", "#pinForm"].forEach((s) => $(s).classList.add("hidden"));
  $(pane).classList.remove("hidden");
}

function renderProfileList() {
  const list = $("#profileList");
  if (!profiles.length) { showAuthPane("#createForm"); return; }
  showAuthPane("#profilePicker");
  list.innerHTML = profiles.map((p, i) => {
    const txCount = countTx(p.id);
    return `<button class="profile-row" style="--i:${i}" data-id="${p.id}">
      <span class="avatar" style="--av:${p.color}">${esc(p.name[0] || "?")}</span>
      <span class="meta">
        <span class="name">${esc(p.name)} ${p.pinHash ? '<span class="lock-ico">🔒</span>' : ""}</span>
        <span class="sub">${txCount} transaction${txCount === 1 ? "" : "s"} · ${p.currency}</span>
      </span>
      <svg class="arrow" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="m9 18-1.4-1.4 4.6-4.6-4.6-4.6L9 6l6 6z"/></svg>
    </button>`;
  }).join("");
}
function countTx(id) {
  try { return (JSON.parse(localStorage.getItem(dataKey(id)))?.transactions || []).length; } catch { return 0; }
}

$("#profileList").addEventListener("click", (e) => {
  const row = e.target.closest(".profile-row"); if (!row) return;
  const p = profiles.find((x) => x.id === row.dataset.id); if (!p) return;
  if (p.pinHash) { pendingProfile = p; openPinPane(p); } else enterApp(p);
});

function openPinPane(p) {
  $("#pinName").textContent = p.name;
  $("#pinError").classList.add("hidden");
  $$(".pin-digit").forEach((i) => (i.value = ""));
  showAuthPane("#pinForm");
  setTimeout(() => $$(".pin-digit")[0].focus(), 60);
}

$$(".pin-digit").forEach((inp, i, arr) => {
  inp.addEventListener("input", async () => {
    inp.value = inp.value.replace(/\D/g, "");
    if (inp.value && i < 3) arr[i + 1].focus();
    const pin = arr.map((x) => x.value).join("");
    if (pin.length === 4) {
      const h = await hashPin(pin);
      if (h === pendingProfile.pinHash) enterApp(pendingProfile);
      else {
        $("#pinError").classList.remove("hidden");
        arr.forEach((x) => (x.value = ""));
        arr[0].focus();
      }
    }
  });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !inp.value && i > 0) arr[i - 1].focus();
  });
});

$("#btnNewProfile").addEventListener("click", () => { chosenColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]; renderColorRow(); showAuthPane("#createForm"); setTimeout(() => $("#newName").focus(), 60); });
$("#btnBackToPicker").addEventListener("click", () => profiles.length ? showAuthPane("#profilePicker") : null);
$("#btnPinBack").addEventListener("click", () => { pendingProfile = null; showAuthPane("#profilePicker"); });

$("#createForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#newName").value.trim();
  if (!name) return;
  const pin = $("#newPin").value.trim();
  if (pin && !/^\d{4}$/.test(pin)) { toast("PIN must be exactly 4 digits", "⚠️"); return; }
  const p = {
    id: uid(), name, color: chosenColor,
    currency: $("#newCurrency").value,
    pinHash: pin ? await hashPin(pin) : null,
    createdAt: todayStr(),
  };
  profiles.push(p); saveProfiles();
  $("#createForm").reset();
  enterApp(p);
  toast(`Welcome, ${name}! 🎉`, "👋");
});

function enterApp(p) {
  user = p;
  loadData(p.id);
  localStorage.setItem(LS_SESSION, p.id);
  $("#authScreen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  hydrateUserUI();
  const hashView = location.hash.slice(1);
  switchView(VIEW_TITLES[hashView] ? hashView : "dashboard");
}

function logout() {
  user = null; data = { transactions: [] };
  localStorage.removeItem(LS_SESSION);
  $("#app").classList.add("hidden");
  $("#authScreen").classList.remove("hidden");
  loadProfiles(); renderProfileList();
}

function hydrateUserUI() {
  $("#chipName").textContent = user.name;
  const initial = user.name[0] || "?";
  for (const id of ["chipAvatar", "topAvatar"]) {
    const el = $("#" + id);
    el.textContent = initial;
    el.style.setProperty("--av", user.color);
  }
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  $("#greeting").textContent = `${part}, ${user.name} 👋`;
  $("#setName").value = user.name;
  $("#setCurrency").value = user.currency;
  $("#txCurSym").textContent = sym();
}

/* ═════════════════ NAVIGATION ═════════════════ */
const VIEW_TITLES = { dashboard: "Dashboard", transactions: "Transactions", analytics: "Analytics", settings: "Settings" };

function switchView(v) {
  currentView = v;
  $$(".view").forEach((s) => s.classList.remove("active"));
  const view = $("#view-" + v);
  view.classList.remove("active");
  void view.offsetWidth; // restart entry animation
  view.classList.add("active");
  $$(".nav-item, .bnav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  $("#viewTitle").textContent = VIEW_TITLES[v];
  try { history.replaceState(null, "", "#" + v); } catch {}
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$$(".nav-item, .bnav-item").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
document.body.addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto]");
  if (g) switchView(g.dataset.goto);
});
$("#userChip").addEventListener("click", logout);

/* ═════════════════ THEME ═════════════════ */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(LS_THEME, t);
  $("#iconMoon").classList.toggle("hidden", t === "light");
  $("#iconSun").classList.toggle("hidden", t !== "light");
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = t === "light" ? "#f9f9f7" : "#0d0d0d";
}
$("#btnTheme").addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  render(); // re-draw charts with new tokens
});

/* ═════════════════ TRANSACTION MODAL ═════════════════ */
function openTxModal(tx = null) {
  editingId = tx?.id || null;
  modalType = tx?.type || "debit";
  modalCat = tx?.category || null;
  $("#txModalTitle").textContent = editingId ? "Edit transaction" : "Add transaction";
  $("#txSubmit").textContent = editingId ? "Save changes" : "Add transaction";
  $("#txAmount").value = tx ? tx.amount : "";
  $("#txDate").value = tx ? tx.date : todayStr();
  $("#txNote").value = tx?.note || "";
  $("#txMethod").value = tx?.method || "upi";
  $("#txCurSym").textContent = sym();
  syncTypeToggle();
  renderCatGrid();
  $("#txModal").classList.remove("hidden", "closing");
  setTimeout(() => $("#txAmount").focus(), 120);
}
function syncTypeToggle() {
  $("#typeToggle").classList.toggle("credit", modalType === "credit");
  $$(".type-btn").forEach((b) => b.classList.toggle("active", b.dataset.type === modalType));
}
$$(".type-btn").forEach((b) =>
  b.addEventListener("click", () => {
    if (modalType === b.dataset.type) return;
    modalType = b.dataset.type;
    modalCat = null;
    syncTypeToggle(); renderCatGrid();
  })
);
function renderCatGrid() {
  const cats = CATS[modalType];
  if (!modalCat || !cats.some((c) => c.id === modalCat)) modalCat = cats[0].id;
  $("#catGrid").innerHTML = cats.map(
    (c) => `<button type="button" class="cat-cell ${c.id === modalCat ? "active" : ""}" data-id="${c.id}">
      <span class="em">${c.emoji}</span><span>${c.name}</span></button>`
  ).join("");
}
$("#catGrid").addEventListener("click", (e) => {
  const cell = e.target.closest(".cat-cell"); if (!cell) return;
  modalCat = cell.dataset.id;
  $$(".cat-cell").forEach((c) => c.classList.toggle("active", c.dataset.id === modalCat));
});

$("#txForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const amount = parseFloat($("#txAmount").value);
  if (!amount || amount <= 0) { toast("Enter a valid amount", "⚠️"); return; }
  const rec = {
    id: editingId || uid(),
    type: modalType,
    amount: Math.round(amount * 100) / 100,
    category: modalCat,
    date: $("#txDate").value || todayStr(),
    note: $("#txNote").value.trim(),
    method: $("#txMethod").value,
    createdAt: editingId ? undefined : new Date().toISOString(),
  };
  if (editingId) {
    const i = data.transactions.findIndex((t) => t.id === editingId);
    if (i > -1) { rec.createdAt = data.transactions[i].createdAt; data.transactions[i] = rec; }
    toast("Transaction updated", "✏️");
  } else {
    data.transactions.push(rec);
    toast(`${modalType === "credit" ? "Credit" : "Debit"} of ${fmt(amount)} added`, modalType === "credit" ? "💰" : "💸");
  }
  saveData();
  closeOverlay("#txModal");
  render();
});

const openAdd = () => openTxModal();
$("#btnAddTop").addEventListener("click", openAdd);
$("#btnAddSidebar").addEventListener("click", openAdd);
$("#btnAddFab").addEventListener("click", openAdd);
$("#btnCloseModal").addEventListener("click", () => closeOverlay("#txModal"));
$$(".modal-overlay").forEach((ov) =>
  ov.addEventListener("click", (e) => { if (e.target === ov) closeOverlay("#" + ov.id); })
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $$(".modal-overlay:not(.hidden)").forEach((ov) => closeOverlay("#" + ov.id));
});

/* delete / edit from lists */
function bindTxListActions(container) {
  container.addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-edit]");
    const delBtn = e.target.closest("[data-del]");
    if (editBtn) {
      const tx = data.transactions.find((t) => t.id === editBtn.dataset.edit);
      if (tx) openTxModal(tx);
    } else if (delBtn) {
      const id = delBtn.dataset.del;
      const row = delBtn.closest(".tx-row");
      askConfirm("Delete transaction?", "This can't be undone (unless you re-add it).", () => {
        row.classList.add("removing");
        setTimeout(() => {
          data.transactions = data.transactions.filter((t) => t.id !== id);
          saveData(); render();
          toast("Transaction deleted", "🗑️");
        }, 260);
      });
    }
  });
}
bindTxListActions($("#txList"));
bindTxListActions($("#recentList"));

/* ═════════════════ COMPUTATIONS ═════════════════ */
function totals(list) {
  let credit = 0, debit = 0;
  for (const t of list) t.type === "credit" ? (credit += t.amount) : (debit += t.amount);
  return { credit, debit, net: credit - debit };
}

function inRange(t, from, to) {
  return (!from || t.date >= from) && (!to || t.date <= to);
}

function rangeBounds(range) {
  const now = new Date();
  const iso = isoLocal;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  switch (range) {
    case "month": return [iso(startOfMonth), null];
    case "lastmonth": {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return [iso(s), iso(e)];
    }
    case "30": { const s = new Date(now); s.setDate(s.getDate() - 29); return [iso(s), null]; }
    case "90": { const s = new Date(now); s.setDate(s.getDate() - 89); return [iso(s), null]; }
    case "year": return [`${now.getFullYear()}-01-01`, null];
    case "3m": { const s = new Date(now.getFullYear(), now.getMonth() - 2, 1); return [iso(s), null]; }
    case "6m": { const s = new Date(now.getFullYear(), now.getMonth() - 5, 1); return [iso(s), null]; }
    default: return [null, null];
  }
}

function filteredTx() {
  let list = [...data.transactions];
  const f = filters;
  if (f.type !== "all") list = list.filter((t) => t.type === f.type);
  if (f.category !== "all") list = list.filter((t) => t.category === f.category);
  if (f.range === "custom") list = list.filter((t) => inRange(t, f.from, f.to));
  else if (f.range !== "all") { const [from, to] = rangeBounds(f.range); list = list.filter((t) => inRange(t, from, to)); }
  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter((t) =>
      (t.note || "").toLowerCase().includes(q) ||
      catById(t.category).name.toLowerCase().includes(q) ||
      String(t.amount).includes(q)
    );
  }
  const [k, dir] = f.sort.split("-");
  list.sort((a, b) => {
    let d = k === "amount" ? a.amount - b.amount : a.date.localeCompare(b.date) || (a.createdAt || "").localeCompare(b.createdAt || "");
    return dir === "desc" ? -d : d;
  });
  return list;
}

/* ═════════════════ RENDER ═════════════════ */
function render() {
  if (!user) return;
  if (currentView === "dashboard") renderDashboard();
  else if (currentView === "transactions") renderTransactions();
  else if (currentView === "analytics") renderAnalytics();
}

/* ── number count-up ── */
function countUp(el, target, compact) {
  const dur = 700, start = performance.now();
  const neg = target < 0;
  function tick(now) {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = target * eased;
    el.textContent = (neg && val < 0 ? "−" : "") + fmt(val, compact);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function statTile({ i, label, value, icon, soft, delta, cls, plain }) {
  return `<div class="stat-tile" style="--i:${i}">
    <span class="tile-ico" style="--tile-soft:${soft}">${icon}</span>
    <div class="stat-label">${label}</div>
    <div class="stat-value ${cls || ""}" data-count="${value}"${plain ? ' data-plain="1"' : ""}></div>
    ${delta ? `<div class="stat-delta">${delta}</div>` : ""}
  </div>`;
}
function runCountUps(root) {
  root.querySelectorAll("[data-count]").forEach((el) => {
    const v = parseFloat(el.dataset.count);
    el.dataset.plain ? countUpPlain(el, v) : countUp(el, v, true);
  });
}

/* ── Dashboard ── */
function renderDashboard() {
  const all = totals(data.transactions);
  const [mFrom] = rangeBounds("month");
  const monthTx = data.transactions.filter((t) => inRange(t, mFrom, null));
  const m = totals(monthTx);
  const [lmFrom, lmTo] = rangeBounds("lastmonth");
  const lm = totals(data.transactions.filter((t) => inRange(t, lmFrom, lmTo)));

  const spendDelta = lm.debit > 0 ? Math.round(((m.debit - lm.debit) / lm.debit) * 100) : null;
  const deltaHtml = spendDelta === null ? "" :
    spendDelta <= 0
      ? `<span class="up">↓ ${Math.abs(spendDelta)}%</span> vs last month`
      : `<span class="down">↑ ${spendDelta}%</span> vs last month`;

  const grid = $("#statGrid");
  grid.innerHTML =
    statTile({ i: 0, label: "Total balance", value: all.net, icon: "💼", soft: "var(--accent-soft)" }) +
    statTile({ i: 1, label: "Credit this month", value: m.credit, icon: "📈", soft: "var(--good-soft)" }) +
    statTile({ i: 2, label: "Debit this month", value: m.debit, icon: "📉", soft: "var(--bad-soft)", delta: deltaHtml }) +
    statTile({ i: 3, label: "Transactions", value: data.transactions.length, icon: "🧾", soft: "var(--accent-soft)", plain: true });
  runCountUps(grid);

  renderTrendChart();
  renderRecent();
}
function countUpPlain(el, target) {
  const dur = 600, start = performance.now();
  (function tick(now) {
    const p = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString();
    if (p < 1) requestAnimationFrame(tick);
  })(performance.now());
}

function renderRecent() {
  const recent = [...data.transactions]
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 6);
  $("#recentList").innerHTML = recent.length ? recent.map(txRow).join("") : emptyState("🌱", "No transactions yet.<br>Tap <b>Add</b> to record your first one!");
}

function emptyState(emoji, html) {
  return `<div class="empty-state"><div class="big">${emoji}</div><p>${html}</p></div>`;
}

function txRow(t, i = 0) {
  const c = catById(t.category);
  const sign = t.type === "credit" ? "+" : "−";
  return `<div class="tx-row" style="--i:${i}">
    <span class="tx-ico">${c.emoji}</span>
    <span class="tx-meta">
      <div class="tx-title">${esc(t.note || c.name)}</div>
      <div class="tx-sub">${c.name} · ${niceDate(t.date)} · ${METHODS[t.method] || t.method || ""}</div>
    </span>
    <span class="tx-amount ${t.type}">${sign}${fmt(t.amount)}</span>
    <span class="tx-actions">
      <button class="tx-act" data-edit="${t.id}" title="Edit"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M5 19h1.4l8.625-8.625-1.4-1.4L5 17.6zM3 21v-4.25L16.2 3.575q.3-.275.663-.425.362-.15.762-.15t.775.15q.375.15.65.45L20.425 5q.3.275.438.65T21 6.4q0 .4-.137.763-.138.362-.438.662L7.25 21zM19 6.4 17.6 5zm-4.075 2.675-.7-.7 1.4 1.4z"/></svg></button>
      <button class="tx-act del" data-del="${t.id}" title="Delete"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7 21q-.825 0-1.412-.587Q5 19.825 5 19V6H4V4h5V3h6v1h5v2h-1v13q0 .825-.587 1.413Q17.825 21 17 21zM17 6H7v13h10zM9 17h2V8H9zm4 0h2V8h-2z"/></svg></button>
    </span>
  </div>`;
}

/* ── 30-day trend line chart ── */
function renderTrendChart() {
  const days = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    days.push(isoLocal(d));
  }
  const perDay = days.map((d) =>
    data.transactions.filter((t) => t.date === d && t.type === "debit").reduce((s, t) => s + t.amount, 0)
  );
  const W = 560, H = 190, padL = 46, padR = 14, padT = 14, padB = 26;
  const max = Math.max(...perDay, 1);
  const niceMax = niceCeil(max);
  const x = (i) => padL + (i / 29) * (W - padL - padR);
  const y = (v) => padT + (1 - v / niceMax) * (H - padT - padB);

  if (perDay.every((v) => v === 0)) {
    $("#trendChart").innerHTML = emptyState("📉", "No spending in the last 30 days.<br>Charts appear as you add debits.");
    return;
  }

  let path = "", area = "";
  perDay.forEach((v, i) => {
    path += (i ? " L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1);
  });
  area = path + ` L${x(29).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z`;

  const gridLines = [0, 0.5, 1].map((f) => {
    const v = niceMax * f;
    return `<line class="grid-line" x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}"/>
      <text class="axis-text" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v, true)}</text>`;
  }).join("");

  const labels = [0, 9, 19, 29].map((i) =>
    `<text class="axis-text" x="${x(i)}" y="${H - 7}" text-anchor="middle">${niceDate(days[i])}</text>`
  ).join("");

  const last = perDay.length - 1;
  const hitZones = perDay.map((v, i) =>
    `<rect x="${x(i) - 9.4}" y="0" width="18.8" height="${H - padB}" fill="transparent"
       data-tip="<b>${niceDate(days[i])}</b><span class='tip-db'>${fmt(v)}</span> spent"></rect>`
  ).join("");

  const pathLen = 1400;
  $("#trendChart").innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    ${gridLines}${labels}
    <path class="area-fill" d="${area}"/>
    <path class="line-path line-draw" style="--len:${pathLen}" d="${path}"/>
    <circle class="dot-marker" cx="${x(last)}" cy="${y(perDay[last])}" r="4.5"/>
    ${hitZones}
  </svg>`;
  bindTips($("#trendChart"));
}

function niceCeil(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/* ── shared chart tooltip ── */
function bindTips(root) {
  const tip = $("#chartTip");
  root.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("mouseenter", () => { tip.innerHTML = el.dataset.tip; tip.classList.remove("hidden"); });
    el.addEventListener("mousemove", (e) => { tip.style.left = e.clientX + "px"; tip.style.top = e.clientY + "px"; });
    el.addEventListener("mouseleave", () => tip.classList.add("hidden"));
  });
}

/* ── Transactions view ── */
function renderTransactions() {
  // category filter options
  const sel = $("#fCategory");
  const cur = filters.category;
  sel.innerHTML = `<option value="all">All categories</option>` +
    ALL_CATS.filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i)
      .map((c) => `<option value="${c.id}">${c.emoji} ${c.name}</option>`).join("");
  sel.value = cur;

  const list = filteredTx();
  const t = totals(list);
  $("#filterSummary").innerHTML = list.length
    ? `<b>${list.length}</b> transaction${list.length === 1 ? "" : "s"} · <span class="cr">+${fmt(t.credit, true)}</span> in · <span class="db">−${fmt(t.debit, true)}</span> out · net <b>${t.net < 0 ? "−" : ""}${fmt(t.net, true)}</b>`
    : "";

  const wrap = $("#txList");
  if (!list.length) {
    wrap.innerHTML = emptyState("🔎", data.transactions.length ? "Nothing matches these filters.<br>Try widening the range." : "No transactions yet.<br>Tap <b>Add</b> to record your first one!");
    return;
  }
  // group by day
  let html = "", lastDay = "", idx = 0;
  for (const tx of list) {
    if (filters.sort.startsWith("date") && tx.date !== lastDay) {
      lastDay = tx.date;
      html += `<div class="tx-day-head">${niceDate(tx.date)}</div>`;
    }
    html += txRow(tx, Math.min(idx++, 14));
  }
  wrap.innerHTML = html;
}

/* filter bindings */
$("#fSearch").addEventListener("input", (e) => { filters.search = e.target.value.trim(); renderTransactions(); });
$("#fCategory").addEventListener("change", (e) => { filters.category = e.target.value; renderTransactions(); });
$("#fSort").addEventListener("change", (e) => { filters.sort = e.target.value; renderTransactions(); });
$("#fRange").addEventListener("change", (e) => {
  filters.range = e.target.value;
  $("#customRange").classList.toggle("hidden", filters.range !== "custom");
  renderTransactions();
});
$("#fFrom").addEventListener("change", (e) => { filters.from = e.target.value; renderTransactions(); });
$("#fTo").addEventListener("change", (e) => { filters.to = e.target.value; renderTransactions(); });
$("#fType").addEventListener("click", (e) => {
  const b = e.target.closest(".seg-btn"); if (!b) return;
  filters.type = b.dataset.val;
  $$("#fType .seg-btn").forEach((x) => x.classList.toggle("active", x === b));
  renderTransactions();
});

/* ── Analytics ── */
$("#anPeriod").addEventListener("click", (e) => {
  const b = e.target.closest(".seg-btn"); if (!b) return;
  anPeriodVal = b.dataset.val;
  $$("#anPeriod .seg-btn").forEach((x) => x.classList.toggle("active", x === b));
  renderAnalytics();
});

function renderAnalytics() {
  const [from, to] = rangeBounds(anPeriodVal);
  const list = data.transactions.filter((t) => inRange(t, from, to));
  const t = totals(list);
  const savings = t.credit > 0 ? Math.round((t.net / t.credit) * 100) : null;
  const dayCount = Math.max(1, daySpan(list, from));
  const avgDay = t.debit / dayCount;

  const grid = $("#anStats");
  grid.innerHTML =
    statTile({ i: 0, label: "Credit (in)", value: t.credit, icon: "📈", soft: "var(--good-soft)" }) +
    statTile({ i: 1, label: "Debit (out)", value: t.debit, icon: "📉", soft: "var(--bad-soft)" }) +
    statTile({ i: 2, label: "Net", value: t.net, icon: "⚖️", soft: "var(--accent-soft)" }) +
    statTile({ i: 3, label: "Avg spend / day", value: avgDay, icon: "📅", soft: "var(--accent-soft)", delta: savings !== null ? `Savings rate <b>${savings}%</b>` : "" });
  runCountUps(grid);

  renderBarChart(list, from);
  renderDonut(list);
  renderTopCats(list, t.debit);
}

function daySpan(list, from) {
  const today = todayStr();
  let start = from;
  if (!start) {
    if (!list.length) return 1;
    start = list.reduce((m, t) => (t.date < m ? t.date : m), today);
  }
  return Math.max(1, Math.round((new Date(today) - new Date(start)) / 864e5) + 1);
}

/* grouped monthly bars: credit vs debit */
function renderBarChart(list, from) {
  // months covered by period (min 1, max 12)
  const months = [];
  const now = new Date();
  const start = from ? new Date(from + "T00:00:00") : (list.length ? new Date(list.reduce((m, t) => (t.date < m ? t.date : m), todayStr()) + "T00:00:00") : now);
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  while (cursor <= end && months.length < 12) {
    months.push(isoLocal(cursor).slice(0, 7));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  if (months.length > 12) months.splice(0, months.length - 12);

  const per = months.map((mk) => {
    const mt = totals(list.filter((t) => monthKey(t.date) === mk));
    return { mk, ...mt };
  });

  if (per.every((p) => p.credit === 0 && p.debit === 0)) {
    $("#barChart").innerHTML = emptyState("📊", "No data in this period yet.");
    return;
  }

  const W = 560, H = 230, padL = 50, padR = 12, padT = 12, padB = 30;
  const max = niceCeil(Math.max(...per.map((p) => Math.max(p.credit, p.debit)), 1));
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / per.length;
  const barW = Math.min(24, slot * 0.28);
  const y = (v) => padT + (1 - v / max) * plotH;
  const h = (v) => (v / max) * plotH;

  const gridLines = [0, 0.5, 1].map((f) => {
    const v = max * f;
    return `<line class="grid-line" x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}"/>
      <text class="axis-text" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v, true)}</text>`;
  }).join("");

  const monthName = (mk) => new Date(mk + "-01T00:00:00").toLocaleDateString(undefined, { month: "short" });

  let bars = "";
  per.forEach((p, i) => {
    const cx = padL + slot * i + slot / 2;
    const gap = 3;
    const rr = 4;
    const mk = (val, xPos, color, label, cls) => {
      if (val <= 0) return "";
      const bh = Math.max(h(val), 2);
      const topR = Math.min(rr, bh / 2);
      return `<path class="bar-rect bar-grow" style="--i:${i}"
        d="M${xPos} ${y(0)} v-${(bh - topR).toFixed(1)} q0 -${topR} ${topR} -${topR} h${(barW - 2 * topR).toFixed(1)} q${topR} 0 ${topR} ${topR} v${(bh - topR).toFixed(1)} z"
        fill="${color}" data-tip="<b>${monthName(p.mk)} · ${label}</b><span class='${cls}'>${fmt(val)}</span>"></path>`;
    };
    bars += mk(p.credit, cx - barW - gap / 2, "var(--good)", "Credit", "tip-cr");
    bars += mk(p.debit, cx + gap / 2, "var(--bad)", "Debit", "tip-db");
    bars += `<text class="axis-text" x="${cx}" y="${H - 8}" text-anchor="middle">${monthName(p.mk)}</text>`;
  });

  $("#barChart").innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${gridLines}
      <line class="baseline" x1="${padL}" y1="${y(0)}" x2="${W - padR}" y2="${y(0)}"/>
      ${bars}
    </svg>
    <div class="legend">
      <span class="legend-item"><span class="legend-swatch" style="background:var(--good)"></span>Credit (in)</span>
      <span class="legend-item"><span class="legend-swatch" style="background:var(--bad)"></span>Debit (out)</span>
    </div>`;
  bindTips($("#barChart"));
}

/* donut: expenses by category (top 5 + Other) */
function renderDonut(list) {
  const debits = list.filter((t) => t.type === "debit");
  const total = debits.reduce((s, t) => s + t.amount, 0);
  if (!total) {
    $("#donutChart").innerHTML = emptyState("🍩", "No expenses in this period.");
    return;
  }
  const byCat = {};
  for (const t of debits) byCat[t.category] = (byCat[t.category] || 0) + t.amount;
  let entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (entries.length > 6) {
    const top = entries.slice(0, 5);
    const rest = entries.slice(5).reduce((s, [, v]) => s + v, 0);
    entries = [...top, ["__other", rest]];
  }

  const R = 80, C = 2 * Math.PI * R, GAP = 2.5;
  let offset = 0, segs = "", legend = "";
  entries.forEach(([catId, val], i) => {
    const frac = val / total;
    const len = Math.max(frac * C - GAP, 1);
    const color = SERIES[i % SERIES.length];
    const c = catId === "__other" ? { name: "Other", emoji: "📦" } : catById(catId);
    segs += `<circle class="donut-seg" style="animation-delay:${i * 90}ms" cx="105" cy="105" r="${R}"
      stroke="${color}" stroke-dasharray="${len.toFixed(1)} ${(C - len).toFixed(1)}"
      stroke-dashoffset="${(-offset).toFixed(1)}" stroke-linecap="butt"
      data-tip="<b>${c.emoji} ${esc(c.name)}</b>${fmt(val)} · ${Math.round(frac * 100)}%"></circle>`;
    legend += `<div class="dleg-row" style="--i:${i}">
      <span class="legend-swatch" style="background:${color}"></span>
      <span class="dleg-name">${c.emoji} ${esc(c.name)}</span>
      <span class="dleg-val">${fmt(val, true)}</span>
      <span class="dleg-pct">${Math.round(frac * 100)}%</span>
    </div>`;
    offset += frac * C;
  });

  $("#donutChart").innerHTML = `
    <div class="donut-svg-box">
      <svg viewBox="0 0 210 210">${segs}</svg>
      <div class="donut-center">
        <span class="val">${fmt(total, true)}</span>
        <span class="lbl">total spent</span>
      </div>
    </div>
    <div class="donut-legend">${legend}</div>`;
  bindTips($("#donutChart"));
}

function renderTopCats(list, totalDebit) {
  const debits = list.filter((t) => t.type === "debit");
  if (!debits.length) { $("#topCats").innerHTML = emptyState("🏷️", "Add some expenses to see category rankings."); return; }
  const byCat = {};
  for (const t of debits) byCat[t.category] = (byCat[t.category] || 0) + t.amount;
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxVal = entries[0][1];
  $("#topCats").innerHTML = entries.map(([catId, val], i) => {
    const c = catById(catId);
    const pct = totalDebit ? Math.round((val / totalDebit) * 100) : 0;
    return `<div class="topcat" style="--i:${i}">
      <span class="tx-ico">${c.emoji}</span>
      <div class="topcat-meta">
        <div class="topcat-name"><span>${esc(c.name)}</span><span class="pct">${pct}% of spend</span></div>
        <div class="topcat-track"><div class="topcat-fill" style="width:${(val / maxVal) * 100}%;background:${SERIES[i % SERIES.length]};--i:${i}"></div></div>
      </div>
      <span class="topcat-amt">${fmt(val, true)}</span>
    </div>`;
  }).join("");
}

/* ═════════════════ SETTINGS ═════════════════ */
$("#btnSaveProfile").addEventListener("click", async () => {
  const name = $("#setName").value.trim();
  if (!name) { toast("Name can't be empty", "⚠️"); return; }
  user.name = name;
  user.currency = $("#setCurrency").value;
  const pin = $("#setPin").value.trim();
  if (pin) {
    if (!/^\d{4}$/.test(pin)) { toast("PIN must be exactly 4 digits", "⚠️"); return; }
    user.pinHash = await hashPin(pin);
  } else if ($("#setPin").dataset.touched === "1") {
    user.pinHash = null;
  }
  const i = profiles.findIndex((p) => p.id === user.id);
  if (i > -1) profiles[i] = user;
  saveProfiles();
  $("#setPin").value = ""; $("#setPin").dataset.touched = "";
  hydrateUserUI(); render();
  toast("Profile saved", "💾");
});
$("#setPin").addEventListener("input", (e) => (e.target.dataset.touched = "1"));

/* export / import */
$("#btnExport").addEventListener("click", () => {
  const payload = {
    app: "spendly", version: 1,
    profile: { name: user.name, currency: user.currency, color: user.color },
    exportedAt: new Date().toISOString(),
    transactions: data.transactions,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `spendly-${user.name.toLowerCase().replace(/\s+/g, "-")}-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("JSON exported", "📤");
});

$("#btnImport").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const json = JSON.parse(reader.result);
      const txs = Array.isArray(json) ? json : json.transactions;
      if (!Array.isArray(txs)) throw new Error("no transactions array");
      const clean = txs.filter((t) => t && typeof t.amount === "number" && t.amount > 0 &&
        (t.type === "credit" || t.type === "debit") && /^\d{4}-\d{2}-\d{2}$/.test(t.date || ""))
        .map((t) => ({
          id: t.id || uid(), type: t.type, amount: Math.round(t.amount * 100) / 100,
          category: t.category || (t.type === "credit" ? "other-in" : "other-out"),
          date: t.date, note: String(t.note || "").slice(0, 80),
          method: METHODS[t.method] ? t.method : "other", createdAt: t.createdAt,
        }));
      if (!clean.length) { toast("No valid transactions found in file", "⚠️"); return; }
      askConfirm(`Import ${clean.length} transactions?`, "They'll be merged with your existing data (duplicates by ID are skipped).", () => {
        const existing = new Set(data.transactions.map((t) => t.id));
        const fresh = clean.filter((t) => !existing.has(t.id));
        data.transactions.push(...fresh);
        saveData(); render();
        toast(`Imported ${fresh.length} transactions`, "📥");
      });
    } catch {
      toast("That file isn't valid Spendly JSON", "❌");
    }
  };
  reader.readAsText(file);
});

/* danger zone */
$("#btnLogout").addEventListener("click", logout);
$("#btnWipe").addEventListener("click", () =>
  askConfirm("Clear all transactions?", `This deletes all ${data.transactions.length} transactions for ${user.name}. Export a backup first!`, () => {
    data.transactions = [];
    saveData(); render();
    toast("All transactions cleared", "🧹");
  })
);
$("#btnDeleteProfile").addEventListener("click", () =>
  askConfirm("Delete this profile?", `${user.name}'s profile and all their data will be permanently removed from this device.`, () => {
    localStorage.removeItem(dataKey(user.id));
    profiles = profiles.filter((p) => p.id !== user.id);
    saveProfiles();
    toast("Profile deleted", "👋");
    logout();
  })
);

/* ═════════════════ INIT ═════════════════ */
(function init() {
  applyTheme(localStorage.getItem(LS_THEME) || "dark");
  renderColorRow();
  loadProfiles();

  const sessionId = localStorage.getItem(LS_SESSION);
  const p = profiles.find((x) => x.id === sessionId);
  if (p && !p.pinHash) enterApp(p);
  else if (p && p.pinHash) { renderProfileList(); pendingProfile = p; openPinPane(p); }
  else renderProfileList();
})();

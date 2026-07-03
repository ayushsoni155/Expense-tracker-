/* ═════════════════════ SPENDLY — app.js ═════════════════════
   Multi-user expense tracker. 100% on-device: each profile's data
   is a JSON document in localStorage, exportable / importable as a
   .json file. When a PIN is set the data is ENCRYPTED at rest with
   AES-256-GCM (key derived from the PIN via PBKDF2). Optional
   fingerprint / Face ID unlock (WebAuthn) can release that key. */

"use strict";

/* ── Storage keys ── */
const LS_PROFILES = "spendly_profiles_v1";
const LS_SESSION  = "spendly_session_v1";
const LS_THEME    = "spendly_theme_v2";
const LS_THEME_OLD = "spendly_theme_v1";
const dataKey = (id) => `spendly_data_${id}`;
const bioKey  = (id) => `spendly_bio_${id}`;

const CURRENCY = { INR: "₹", USD: "$", EUR: "€", GBP: "£", AED: "د.إ", JPY: "¥", CAD: "$", AUD: "$", SGD: "$" };

const AVATAR_COLORS = ["#4f8ff7", "#18a06e", "#e0a13a", "#9b7bf0", "#ef6b6b", "#e0713a", "#e06aa4", "#3ab7c9", "#7b8794"];
const AVATAR_EMOJIS = ["🦊","🐼","🐧","🐨","🦁","🐯","🐵","🐸","🐙","🦄","🐝","🦉","🐬","🦖","🐢","🦩","🌸","⭐","🚀","🍕","🎧","🎮","👑","🌈","🍀","🔥","💎","🎯"];

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
let user = null;               // active profile
let data = { transactions: [] };
let sessionKey = null;         // CryptoKey for AES-GCM when profile is encrypted
let currentView = "dashboard";
let modalType = "debit";
let modalCat = null;
let editingId = null;
let pendingProfile = null;     // profile awaiting PIN / biometric
let anPeriodVal = "month";
let themeMode = "auto";        // "auto" | "light" | "dark"
const filters = { search: "", type: "all", category: "all", range: "all", from: "", to: "", sort: "date-desc" };

/* ── Tiny DOM helpers ── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

/* ═════════════════ MONEY FORMATTING (always exact) ═════════════════ */
function sym() { return CURRENCY[user?.currency] || "₹"; }
/* Exact currency: 18086 → "₹18,086", 18086.5 → "₹18,086.5". No K/L/Cr rounding. */
function money(n) {
  return sym() + Math.abs(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
/* Signed exact currency (adds − for negatives). */
function moneySigned(n) {
  return (Number(n) < 0 ? "−" : "") + money(n);
}
/* Axis tick label — exact grouped integer, no symbol (keeps chart edges tidy). */
function axisNum(n) {
  return Math.abs(Math.round(Number(n) || 0)).toLocaleString();
}

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

/* ═════════════════ CRYPTO (at-rest encryption) ═════════════════ */
function bufToB64(buf) {
  const bytes = new Uint8Array(buf); let bin = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}
function b64ToBuf(s) {
  const bin = atob(s); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
const randB64 = (n) => bufToB64(crypto.getRandomValues(new Uint8Array(n)));

async function hashPin(pin) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("spendly:" + pin));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function deriveKey(pin, saltB64) {
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64ToBuf(saltB64), iterations: 150000, hash: "SHA-256" },
    baseKey, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
  );
}
async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { enc: 1, iv: bufToB64(iv), ct: bufToB64(ct) };
}
async function decryptJSON(key, env) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBuf(env.iv) }, key, b64ToBuf(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ═════════════════ STORAGE ═════════════════ */
function loadProfiles() { try { profiles = JSON.parse(localStorage.getItem(LS_PROFILES)) || []; } catch { profiles = []; } }
function saveProfiles() { localStorage.setItem(LS_PROFILES, JSON.stringify(profiles)); }
function rawData(id) { try { return JSON.parse(localStorage.getItem(dataKey(id))); } catch { return null; } }

async function loadData(id) {
  const raw = rawData(id);
  if (raw && raw.enc) {
    try { data = sessionKey ? await decryptJSON(sessionKey, raw) : { transactions: [] }; }
    catch { data = { transactions: [] }; }
  } else {
    data = raw || { transactions: [] };
  }
  if (!Array.isArray(data.transactions)) data.transactions = [];
}
async function saveData() {
  if (!user) return;
  const payload = sessionKey ? await encryptJSON(sessionKey, data) : data;
  localStorage.setItem(dataKey(user.id), JSON.stringify(payload));
}

/* ═════════════════ BIOMETRIC (WebAuthn, optional & on-device) ═════════════════
   A non-extractable AES key lives in IndexedDB. It wraps the profile's data key.
   A successful platform-authenticator assertion (fingerprint/Face ID) gates the
   unwrap, so the raw data key is never stored in plaintext. Falls back to PIN. */
const IDB_NAME = "spendly-keys", IDB_STORE = "wrapKeys";
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function idbOp(mode, fn) {
  return idb().then((db) => new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, mode);
    const rq = fn(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => res(rq && rq.result);
    tx.onerror = () => rej(tx.error);
  }));
}
const idbPut = (k, v) => idbOp("readwrite", (s) => s.put(v, k));
const idbGet = (k) => idbOp("readonly", (s) => s.get(k));
const idbDel = (k) => idbOp("readwrite", (s) => s.delete(k));

const bioSupported = () => !!(window.PublicKeyCredential && navigator.credentials && location.protocol !== "file:");
async function bioAvailable() {
  if (!bioSupported()) return false;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
}
async function bioRegister(profile) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Spendly", id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: profile.name || "user", displayName: profile.name || "user" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      timeout: 60000, attestation: "none",
    },
  });
  if (!cred) throw new Error("no credential");
  const wrapKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await idbPut(profile.id, wrapKey);
  // Without a PIN there's no key yet — mint a random one so biometric-only profiles are still encrypted.
  let createdKey = false;
  if (!sessionKey) { sessionKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]); createdKey = true; }
  const rawDataKey = await crypto.subtle.exportKey("raw", sessionKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, rawDataKey);
  localStorage.setItem(bioKey(profile.id), JSON.stringify({ iv: bufToB64(iv), ct: bufToB64(wrapped) }));
  profile.bio = { credId: bufToB64(cred.rawId) };
  if (createdKey) await saveData(); // encrypt existing plaintext data with the fresh key
}
async function bioUnlock(profile) {
  const stored = JSON.parse(localStorage.getItem(bioKey(profile.id)) || "null");
  if (!stored || !profile.bio?.credId) throw new Error("no bio");
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: "public-key", id: b64ToBuf(profile.bio.credId) }],
      userVerification: "required", timeout: 60000, rpId: location.hostname,
    },
  });
  if (!assertion) throw new Error("no assertion");
  const wrapKey = await idbGet(profile.id);
  if (!wrapKey) throw new Error("no wrap key on this device");
  const rawDataKey = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBuf(stored.iv) }, wrapKey, b64ToBuf(stored.ct));
  sessionKey = await crypto.subtle.importKey("raw", rawDataKey, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}
async function bioDisable(profile) {
  try { await idbDel(profile.id); } catch {}
  localStorage.removeItem(bioKey(profile.id));
  delete profile.bio;
}

/* ═════════════════ TOASTS ═════════════════ */
function toast(msg, emoji = "✅") {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span class="toast-em">${emoji}</span><span>${esc(msg)}</span>`;
  $("#toastWrap").appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 350); }, 2600);
}

/* ═════════════════ CONFIRM DIALOG ═════════════════ */
let confirmCb = null;
function askConfirm(title, text, cb, { danger = true, yes = "Yes, do it", emoji = "⚠️" } = {}) {
  $("#confirmTitle").textContent = title;
  $("#confirmText").textContent = text;
  $("#confirmEmoji").textContent = emoji;
  const yesBtn = $("#confirmYes");
  yesBtn.textContent = yes;
  yesBtn.className = danger ? "btn btn-danger" : "btn btn-primary";
  confirmCb = cb;
  $("#confirmModal").classList.remove("hidden", "closing");
}
$("#confirmYes").addEventListener("click", () => { closeOverlay("#confirmModal"); const cb = confirmCb; confirmCb = null; cb?.(); });
$("#confirmNo").addEventListener("click", () => { closeOverlay("#confirmModal"); confirmCb = null; });

function closeOverlay(sel) {
  const ov = $(sel);
  ov.classList.add("closing");
  setTimeout(() => ov.classList.add("hidden"), 200);
}

/* ═════════════════ AVATARS ═════════════════ */
function paintAvatar(el, profile) {
  if (!el || !profile) return;
  el.style.setProperty("--av", profile.color || "var(--accent)");
  if (profile.avatar) { el.textContent = profile.avatar; el.classList.add("is-emoji"); }
  else { el.textContent = (profile.name?.[0] || "?"); el.classList.remove("is-emoji"); }
}

let chosenColor = AVATAR_COLORS[0];
let chosenAvatar = "";   // "" = use initial

function renderColorRow(containerSel) {
  $(containerSel).innerHTML = AVATAR_COLORS.map(
    (c) => `<button type="button" class="color-dot ${c === chosenColor ? "active" : ""}" style="background:${c}" data-c="${c}" aria-label="Avatar colour ${c}"></button>`
  ).join("");
}
function renderAvatarRow(containerSel) {
  const initialBtn = `<button type="button" class="avatar-opt ${chosenAvatar === "" ? "active" : ""}" data-av="" title="Use your initial">Aa</button>`;
  $(containerSel).innerHTML = initialBtn + AVATAR_EMOJIS.map(
    (e) => `<button type="button" class="avatar-opt ${e === chosenAvatar ? "active" : ""}" data-av="${e}">${e}</button>`
  ).join("");
}
function updateAvatarPreview(sel, name) {
  const el = $(sel); if (!el) return;
  paintAvatar(el, { color: chosenColor, avatar: chosenAvatar, name: name || "?" });
}

/* create-form pickers */
$("#colorRow").addEventListener("click", (e) => {
  const b = e.target.closest(".color-dot"); if (!b) return;
  chosenColor = b.dataset.c; renderColorRow("#colorRow"); updateAvatarPreview("#avatarPreview", $("#newName").value);
});
$("#avatarPicker").addEventListener("click", (e) => {
  const b = e.target.closest(".avatar-opt"); if (!b) return;
  chosenAvatar = b.dataset.av; renderAvatarRow("#avatarPicker"); updateAvatarPreview("#avatarPreview", $("#newName").value);
});
$("#newName").addEventListener("input", () => updateAvatarPreview("#avatarPreview", $("#newName").value));

/* settings pickers */
$("#setColorRow").addEventListener("click", (e) => {
  const b = e.target.closest(".color-dot"); if (!b) return;
  chosenColor = b.dataset.c; renderColorRow("#setColorRow"); updateAvatarPreview("#setAvatarPreview", $("#setName").value);
});
$("#setAvatarPicker").addEventListener("click", (e) => {
  const b = e.target.closest(".avatar-opt"); if (!b) return;
  chosenAvatar = b.dataset.av; renderAvatarRow("#setAvatarPicker"); updateAvatarPreview("#setAvatarPreview", $("#setName").value);
});
$("#setName").addEventListener("input", () => updateAvatarPreview("#setAvatarPreview", $("#setName").value));

/* ═════════════════ AUTH FLOW ═════════════════ */
function showAuthPane(pane) {
  ["#profilePicker", "#createForm", "#pinForm"].forEach((s) => $(s).classList.add("hidden"));
  $(pane).classList.remove("hidden");
}

function renderProfileList() {
  const list = $("#profileList");
  if (!profiles.length) { showAuthPane("#createForm"); prepCreateForm(); return; }
  showAuthPane("#profilePicker");
  list.innerHTML = profiles.map((p, i) => {
    const locked = !!(p.pinHash || p.bio);
    const raw = rawData(p.id);
    const sub = locked
      ? `🔒 Protected · ${p.currency}`
      : `${(raw?.transactions || []).length} transaction${(raw?.transactions || []).length === 1 ? "" : "s"} · ${p.currency}`;
    return `<button class="profile-row" style="--i:${i}" data-id="${p.id}">
      <span class="avatar ${p.avatar ? "is-emoji" : ""}" style="--av:${p.color}">${esc(p.avatar || p.name[0] || "?")}</span>
      <span class="meta">
        <span class="name">${esc(p.name)} ${locked ? '<span class="lock-ico">🔒</span>' : ""}</span>
        <span class="sub">${sub}</span>
      </span>
      <svg class="arrow" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="m9 18-1.4-1.4 4.6-4.6-4.6-4.6L9 6l6 6z"/></svg>
    </button>`;
  }).join("");
}

$("#profileList").addEventListener("click", (e) => {
  const row = e.target.closest(".profile-row"); if (!row) return;
  const p = profiles.find((x) => x.id === row.dataset.id); if (!p) return;
  if (p.pinHash || p.bio) openUnlockPane(p); else enterApp(p);
});

async function openUnlockPane(p) {
  pendingProfile = p;
  $("#pinError").classList.add("hidden");
  $$(".pin-digit").forEach((i) => (i.value = ""));
  const hasPin = !!p.pinHash;
  const bioOnly = !hasPin && !!p.bio;
  $("#unlockTitle").innerHTML = hasPin ? `Enter PIN for ${esc(p.name)}` : `Unlock ${esc(p.name)}`;
  $("#pinInputs").classList.toggle("hidden", !hasPin);
  showAuthPane("#pinForm");
  const avail = await bioAvailable();
  $("#btnBio").classList.toggle("hidden", !(p.bio && avail));
  $("#unlockHint").classList.toggle("hidden", !bioOnly);
  if (bioOnly) $("#unlockHint").textContent = avail
    ? "Use your device fingerprint / Face ID to open this profile."
    : "Biometrics aren’t available in this browser. Open this profile on the device where you set it up, or restore from your exported JSON.";
  $("#btnUnlockRemove").classList.toggle("hidden", !bioOnly);
  if (hasPin) setTimeout(() => $$(".pin-digit")[0]?.focus(), 60);
}

$$(".pin-digit").forEach((inp, i, arr) => {
  inp.addEventListener("input", async () => {
    inp.value = inp.value.replace(/\D/g, "");
    if (inp.value && i < 3) arr[i + 1].focus();
    const pin = arr.map((x) => x.value).join("");
    if (pin.length === 4) {
      const h = await hashPin(pin);
      if (h === pendingProfile.pinHash) unlockWithPin(pendingProfile, pin);
      else {
        $("#pinError").classList.remove("hidden");
        arr.forEach((x) => (x.value = ""));
        arr[0].focus();
      }
    }
  });
  inp.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !inp.value && i > 0) arr[i - 1].focus(); });
});

$("#btnBio").addEventListener("click", async () => {
  const btn = $("#btnBio"); btn.disabled = true; btn.classList.add("busy");
  try {
    await bioUnlock(pendingProfile);
    await enterApp(pendingProfile);
  } catch {
    if (pendingProfile?.pinHash) { toast("Biometric unlock failed — enter your PIN", "🔐"); $$(".pin-digit")[0]?.focus(); }
    else { toast("Couldn't unlock with biometrics on this device", "🔐"); }
  } finally { btn.disabled = false; btn.classList.remove("busy"); }
});

async function unlockWithPin(p, pin) {
  let migrate = false;
  if (!p.kdfSalt) { p.kdfSalt = randB64(16); migrate = true; }
  sessionKey = await deriveKey(pin, p.kdfSalt);
  await enterApp(p);
  if (migrate) {   // old plaintext profile → persist salt & encrypt on disk
    const i = profiles.findIndex((x) => x.id === p.id);
    if (i > -1) profiles[i] = p;
    saveProfiles();
    await saveData();
  }
}

function prepCreateForm() {
  chosenColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  chosenAvatar = AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)];
  renderColorRow("#colorRow"); renderAvatarRow("#avatarPicker");
  updateAvatarPreview("#avatarPreview", $("#newName").value);
}

$("#btnNewProfile").addEventListener("click", () => { showAuthPane("#createForm"); prepCreateForm(); setTimeout(() => $("#newName").focus(), 60); });
$("#btnBackToPicker").addEventListener("click", () => profiles.length ? showAuthPane("#profilePicker") : null);
$("#btnPinBack").addEventListener("click", () => { pendingProfile = null; showAuthPane("#profilePicker"); });
$("#btnUnlockRemove").addEventListener("click", () => {
  const p = pendingProfile; if (!p) return;
  askConfirm("Remove this profile?", `${p.name}'s profile and its data will be deleted from this device. Only do this if you can't unlock it and don't need the data (or you have an exported backup).`, async () => {
    try { await bioDisable(p); } catch {}
    localStorage.removeItem(dataKey(p.id));
    profiles = profiles.filter((x) => x.id !== p.id);
    saveProfiles();
    pendingProfile = null;
    toast("Profile removed", "👋");
    renderProfileList();
  }, { emoji: "🗑️", yes: "Remove profile" });
});

$("#createForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#newName").value.trim();
  if (!name) return;
  const pin = $("#newPin").value.trim();
  if (pin && !/^\d{4}$/.test(pin)) { toast("PIN must be exactly 4 digits", "⚠️"); return; }
  const p = {
    id: uid(), name, color: chosenColor, avatar: chosenAvatar,
    currency: $("#newCurrency").value,
    pinHash: pin ? await hashPin(pin) : null,
    kdfSalt: pin ? randB64(16) : null,
    createdAt: todayStr(),
  };
  profiles.push(p); saveProfiles();
  sessionKey = pin ? await deriveKey(pin, p.kdfSalt) : null;
  $("#createForm").reset();
  await enterApp(p);
  toast(`Welcome, ${name}!`, "👋");
});

async function enterApp(p) {
  user = p;
  await loadData(p.id);
  localStorage.setItem(LS_SESSION, p.id);
  $("#authScreen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  await hydrateUserUI();
  const hashView = location.hash.slice(1);
  switchView(VIEW_TITLES[hashView] ? hashView : "dashboard");
}

function logout() {
  user = null; data = { transactions: [] }; sessionKey = null; pendingProfile = null;
  localStorage.removeItem(LS_SESSION);
  $("#app").classList.add("hidden");
  $("#authScreen").classList.remove("hidden");
  loadProfiles(); renderProfileList();
}

async function hydrateUserUI() {
  $("#chipName").textContent = user.name;
  for (const id of ["chipAvatar", "topAvatar"]) paintAvatar($("#" + id), user);
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  $("#greeting").textContent = `${part}, ${user.name} 👋`;
  $("#setName").value = user.name;
  $("#setCurrency").value = user.currency;
  $("#txCurSym").textContent = sym();
  // settings avatar pickers reflect current profile
  chosenColor = user.color; chosenAvatar = user.avatar || "";
  renderColorRow("#setColorRow"); renderAvatarRow("#setAvatarPicker");
  updateAvatarPreview("#setAvatarPreview", user.name);
  await refreshSecurityUI();
}

/* ═════════════════ NAVIGATION ═════════════════ */
const VIEW_TITLES = { dashboard: "Dashboard", transactions: "Transactions", analytics: "Analytics", settings: "Settings" };
const VIEW_SUB = { dashboard: "Your money at a glance", transactions: "Every credit & debit", analytics: "Trends & insights", settings: "Profile, data & security" };

function switchView(v) {
  currentView = v;
  $$(".view").forEach((s) => s.classList.remove("active"));
  const view = $("#view-" + v);
  void view.offsetWidth; // restart entry animation
  view.classList.add("active");
  $$(".nav-item, .bnav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  $("#viewTitle").textContent = VIEW_TITLES[v];
  $("#greeting").textContent = currentView === "dashboard" && user
    ? (() => { const h = new Date().getHours(); const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; return `${part}, ${user.name} 👋`; })()
    : VIEW_SUB[v];
  try { history.replaceState(null, "", "#" + v); } catch {}
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$$(".nav-item, .bnav-item").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
document.body.addEventListener("click", (e) => { const g = e.target.closest("[data-goto]"); if (g) switchView(g.dataset.goto); });
$("#userChip").addEventListener("click", logout);

/* ═════════════════ THEME (auto / light / dark) ═════════════════ */
const mql = window.matchMedia("(prefers-color-scheme: dark)");
const resolveTheme = (mode) => (mode === "auto" ? (mql.matches ? "dark" : "light") : mode);

function applyTheme(mode, { rerender = true } = {}) {
  themeMode = mode;
  localStorage.setItem(LS_THEME, mode);
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  ["#iconAuto", "#iconSun", "#iconMoon"].forEach((s) => $(s)?.classList.add("hidden"));
  $(mode === "auto" ? "#iconAuto" : resolved === "light" ? "#iconSun" : "#iconMoon")?.classList.remove("hidden");
  $("#btnTheme")?.setAttribute("title", `Theme: ${mode[0].toUpperCase() + mode.slice(1)}`);
  $$("#themeSeg .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.val === mode));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = resolved === "light" ? "#f6f7fb" : "#0b0d12";
  if (rerender && user) render();
}
$("#btnTheme").addEventListener("click", () => {
  const order = ["auto", "light", "dark"];
  applyTheme(order[(order.indexOf(themeMode) + 1) % order.length]);
});
$("#themeSeg").addEventListener("click", (e) => { const b = e.target.closest(".seg-btn"); if (b) applyTheme(b.dataset.val); });
mql.addEventListener("change", () => { if (themeMode === "auto") applyTheme("auto"); });

/* ═════════════════ TRANSACTION MODAL ═════════════════ */
function openTxModal(tx = null) {
  editingId = tx?.id || null;
  modalType = tx?.type || "debit";
  modalCat = tx?.category || null;
  $("#txModalTitle").textContent = editingId ? "Edit transaction" : "Add transaction";
  $("#txSubmit").textContent = editingId ? "Save changes" : "Add transaction";
  $("#txAmount").value = tx ? tx.amount : "";
  $("#txDate").value = tx ? tx.date : todayStr();
  $("#txDate").max = todayStr();
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
    modalType = b.dataset.type; modalCat = null;
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

$("#txForm").addEventListener("submit", async (e) => {
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
    toast(`${modalType === "credit" ? "Credit" : "Debit"} of ${money(amount)} added`, modalType === "credit" ? "💰" : "💸");
  }
  await saveData();
  closeOverlay("#txModal");
  render();
});

const openAdd = () => openTxModal();
$("#btnAddTop").addEventListener("click", openAdd);
$("#btnAddSidebar").addEventListener("click", openAdd);
$("#btnAddFab").addEventListener("click", openAdd);
$("#btnCloseModal").addEventListener("click", () => closeOverlay("#txModal"));
$$(".modal-overlay").forEach((ov) => ov.addEventListener("click", (e) => { if (e.target === ov) closeOverlay("#" + ov.id); }));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $$(".modal-overlay:not(.hidden)").forEach((ov) => closeOverlay("#" + ov.id)); });

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
      const tx = data.transactions.find((t) => t.id === id);
      askConfirm("Delete this transaction?", tx ? `${tx.type === "credit" ? "Credit" : "Debit"} of ${money(tx.amount)} · ${catById(tx.category).name}. This can't be undone.` : "This can't be undone.", async () => {
        row.classList.add("removing");
        setTimeout(async () => {
          data.transactions = data.transactions.filter((t) => t.id !== id);
          await saveData(); render();
          toast("Transaction deleted", "🗑️");
        }, 280);
      }, { emoji: "🗑️", yes: "Delete" });
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
function inRange(t, from, to) { return (!from || t.date >= from) && (!to || t.date <= to); }

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

/* count-up (exact money) */
function countUp(el, target) {
  const dur = 750, start = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = moneySigned(target * eased);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
function countUpPlain(el, target) {
  const dur = 650, start = performance.now();
  (function tick(now) {
    const p = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString();
    if (p < 1) requestAnimationFrame(tick);
  })(performance.now());
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
    el.dataset.plain ? countUpPlain(el, v) : countUp(el, v);
  });
}

/* ── Dashboard ── */
function renderDashboard() {
  const all = totals(data.transactions);
  const [mFrom] = rangeBounds("month");
  const m = totals(data.transactions.filter((t) => inRange(t, mFrom, null)));
  const [lmFrom, lmTo] = rangeBounds("lastmonth");
  const lm = totals(data.transactions.filter((t) => inRange(t, lmFrom, lmTo)));

  const spendDelta = lm.debit > 0 ? Math.round(((m.debit - lm.debit) / lm.debit) * 100) : null;
  const deltaHtml = spendDelta === null ? "" :
    spendDelta <= 0
      ? `<span class="up">↓ ${Math.abs(spendDelta)}%</span> vs last month`
      : `<span class="down">↑ ${spendDelta}%</span> vs last month`;

  const grid = $("#statGrid");
  grid.innerHTML =
    statTile({ i: 0, label: "Total balance", value: all.net, icon: "💼", soft: "var(--accent-soft)", cls: all.net < 0 ? "neg" : "" }) +
    statTile({ i: 1, label: "Credit this month", value: m.credit, icon: "📈", soft: "var(--good-soft)" }) +
    statTile({ i: 2, label: "Debit this month", value: m.debit, icon: "📉", soft: "var(--bad-soft)", delta: deltaHtml }) +
    statTile({ i: 3, label: "Transactions", value: data.transactions.length, icon: "🧾", soft: "var(--accent-soft)", plain: true });
  runCountUps(grid);

  renderTrendChart();
  renderRecent();
}

function renderRecent() {
  const recent = [...data.transactions]
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 6);
  $("#recentList").innerHTML = recent.length ? recent.map((t, i) => txRow(t, i)).join("") : emptyState("🌱", "No transactions yet.<br>Tap <b>Add</b> to record your first one!");
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
    <span class="tx-amount ${t.type}">${sign}${money(t.amount)}</span>
    <span class="tx-actions">
      <button class="tx-act" data-edit="${t.id}" title="Edit" aria-label="Edit"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M5 19h1.4l8.625-8.625-1.4-1.4L5 17.6zM3 21v-4.25L16.2 3.575q.3-.275.663-.425.362-.15.762-.15t.775.15q.375.15.65.45L20.425 5q.3.275.438.65T21 6.4q0 .4-.137.763-.138.362-.438.662L7.25 21zM19 6.4 17.6 5zm-4.075 2.675-.7-.7 1.4 1.4z"/></svg></button>
      <button class="tx-act del" data-del="${t.id}" title="Delete" aria-label="Delete"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7 21q-.825 0-1.412-.587Q5 19.825 5 19V6H4V4h5V3h6v1h5v2h-1v13q0 .825-.587 1.413Q17.825 21 17 21zM17 6H7v13h10zM9 17h2V8H9zm4 0h2V8h-2z"/></svg></button>
    </span>
  </div>`;
}

/* ── 30-day trend line chart ── */
function renderTrendChart() {
  const days = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); days.push(isoLocal(d)); }
  const perDay = days.map((d) => data.transactions.filter((t) => t.date === d && t.type === "debit").reduce((s, t) => s + t.amount, 0));
  const W = 560, H = 190, padL = 54, padR = 14, padT = 14, padB = 26;
  const niceMax = niceCeil(Math.max(...perDay, 1));
  const x = (i) => padL + (i / 29) * (W - padL - padR);
  const y = (v) => padT + (1 - v / niceMax) * (H - padT - padB);

  if (perDay.every((v) => v === 0)) {
    $("#trendChart").innerHTML = emptyState("📉", "No spending in the last 30 days.<br>Charts appear as you add debits.");
    return;
  }

  let path = "";
  perDay.forEach((v, i) => { path += (i ? " L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); });
  const area = path + ` L${x(29).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z`;

  const gridLines = [0, 0.5, 1].map((f) => {
    const v = niceMax * f;
    return `<line class="grid-line" x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}"/>
      <text class="axis-text" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${axisNum(v)}</text>`;
  }).join("");
  const labels = [0, 9, 19, 29].map((i) => `<text class="axis-text" x="${x(i)}" y="${H - 7}" text-anchor="middle">${niceDate(days[i])}</text>`).join("");
  const last = perDay.length - 1;
  const hitZones = perDay.map((v, i) =>
    `<rect x="${x(i) - 9.4}" y="0" width="18.8" height="${H - padB}" fill="transparent" data-tip="<b>${niceDate(days[i])}</b><span class='tip-db'>${money(v)}</span> spent"></rect>`
  ).join("");

  $("#trendChart").innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
    </linearGradient></defs>
    ${gridLines}${labels}
    <path class="area-fill" d="${area}" fill="url(#areaGrad)"/>
    <path class="line-path line-draw" style="--len:1400" d="${path}"/>
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

/* shared chart tooltip */
function bindTips(root) {
  const tip = $("#chartTip");
  root.querySelectorAll("[data-tip]").forEach((el) => {
    const show = () => { tip.innerHTML = el.dataset.tip; tip.classList.remove("hidden"); };
    const move = (e) => { const pt = e.touches ? e.touches[0] : e; tip.style.left = pt.clientX + "px"; tip.style.top = pt.clientY + "px"; };
    el.addEventListener("mouseenter", show);
    el.addEventListener("mousemove", move);
    el.addEventListener("mouseleave", () => tip.classList.add("hidden"));
    el.addEventListener("touchstart", (e) => { show(); move(e); }, { passive: true });
    el.addEventListener("touchend", () => setTimeout(() => tip.classList.add("hidden"), 1200));
  });
}

/* ── Transactions view ── */
function renderTransactions() {
  const sel = $("#fCategory");
  const cur = filters.category;
  sel.innerHTML = `<option value="all">All categories</option>` +
    ALL_CATS.filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i)
      .map((c) => `<option value="${c.id}">${c.emoji} ${c.name}</option>`).join("");
  sel.value = cur;

  const list = filteredTx();
  const t = totals(list);
  $("#filterSummary").innerHTML = list.length
    ? `<b>${list.length}</b> transaction${list.length === 1 ? "" : "s"} · <span class="cr">+${money(t.credit)}</span> in · <span class="db">−${money(t.debit)}</span> out · net <b>${moneySigned(t.net)}</b>`
    : "";

  const wrap = $("#txList");
  if (!list.length) {
    wrap.innerHTML = emptyState("🔎", data.transactions.length ? "Nothing matches these filters.<br>Try widening the range." : "No transactions yet.<br>Tap <b>Add</b> to record your first one!");
    return;
  }
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
    statTile({ i: 2, label: "Net", value: t.net, icon: "⚖️", soft: "var(--accent-soft)", cls: t.net < 0 ? "neg" : "" }) +
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

  const per = months.map((mk) => ({ mk, ...totals(list.filter((t) => monthKey(t.date) === mk)) }));

  if (per.every((p) => p.credit === 0 && p.debit === 0)) {
    $("#barChart").innerHTML = emptyState("📊", "No data in this period yet.");
    return;
  }

  const W = 560, H = 230, padL = 56, padR = 12, padT = 12, padB = 30;
  const max = niceCeil(Math.max(...per.map((p) => Math.max(p.credit, p.debit)), 1));
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / per.length;
  const barW = Math.min(24, slot * 0.28);
  const y = (v) => padT + (1 - v / max) * plotH;
  const h = (v) => (v / max) * plotH;

  const gridLines = [0, 0.5, 1].map((f) => {
    const v = max * f;
    return `<line class="grid-line" x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}"/>
      <text class="axis-text" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${axisNum(v)}</text>`;
  }).join("");
  const monthName = (mk) => new Date(mk + "-01T00:00:00").toLocaleDateString(undefined, { month: "short" });

  let bars = "";
  per.forEach((p, i) => {
    const cx = padL + slot * i + slot / 2;
    const gap = 3, rr = 4;
    const mk = (val, xPos, color, label, cls) => {
      if (val <= 0) return "";
      const bh = Math.max(h(val), 2);
      const topR = Math.min(rr, bh / 2);
      return `<path class="bar-rect bar-grow" style="--i:${i}"
        d="M${xPos} ${y(0)} v-${(bh - topR).toFixed(1)} q0 -${topR} ${topR} -${topR} h${(barW - 2 * topR).toFixed(1)} q${topR} 0 ${topR} ${topR} v${(bh - topR).toFixed(1)} z"
        fill="${color}" data-tip="<b>${monthName(p.mk)} · ${label}</b><span class='${cls}'>${money(val)}</span>"></path>`;
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
  if (!total) { $("#donutChart").innerHTML = emptyState("🍩", "No expenses in this period."); return; }
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
      data-tip="<b>${c.emoji} ${esc(c.name)}</b>${money(val)} · ${Math.round(frac * 100)}%"></circle>`;
    legend += `<div class="dleg-row" style="--i:${i}">
      <span class="legend-swatch" style="background:${color}"></span>
      <span class="dleg-name">${c.emoji} ${esc(c.name)}</span>
      <span class="dleg-val">${money(val)}</span>
      <span class="dleg-pct">${Math.round(frac * 100)}%</span>
    </div>`;
    offset += frac * C;
  });

  $("#donutChart").innerHTML = `
    <div class="donut-svg-box">
      <svg viewBox="0 0 210 210">${segs}</svg>
      <div class="donut-center">
        <span class="val">${money(total)}</span>
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
      <span class="topcat-amt">${money(val)}</span>
    </div>`;
  }).join("");
}

/* ═════════════════ SETTINGS ═════════════════ */
$("#btnSaveProfile").addEventListener("click", async () => {
  const name = $("#setName").value.trim();
  if (!name) { toast("Name can't be empty", "⚠️"); return; }
  const newPin = $("#setPin").value.trim();
  const removingPin = !newPin && $("#setPin").dataset.touched === "1" && user.pinHash;

  if (newPin && !/^\d{4}$/.test(newPin)) { toast("PIN must be exactly 4 digits", "⚠️"); return; }

  user.name = name;
  user.currency = $("#setCurrency").value;
  user.color = chosenColor;
  user.avatar = chosenAvatar;

  if (newPin) {
    // (re)set PIN → fresh salt, derive key, encrypt going forward
    user.pinHash = await hashPin(newPin);
    user.kdfSalt = randB64(16);
    sessionKey = await deriveKey(newPin, user.kdfSalt);
    await bioDisable(user); // old wrapped key no longer valid
  } else if (removingPin) {
    user.pinHash = null; user.kdfSalt = null;
    sessionKey = null;
    await bioDisable(user);
  }

  const i = profiles.findIndex((p) => p.id === user.id);
  if (i > -1) profiles[i] = user;
  saveProfiles();
  await saveData(); // re-writes data with (or without) encryption
  $("#setPin").value = ""; $("#setPin").dataset.touched = "";
  await hydrateUserUI(); render();
  toast("Profile saved", "💾");
});
$("#setPin").addEventListener("input", (e) => (e.target.dataset.touched = "1"));

/* security card (biometric) */
async function refreshSecurityUI() {
  const hasPin = !!user.pinHash;
  const enabled = !!user.bio;
  const avail = await bioAvailable();
  const encrypted = hasPin || enabled;

  const encEl = $("#encState");
  encEl.textContent = encrypted
    ? (hasPin ? "🔒 Encrypted with your PIN (AES-256)" : "🔒 Encrypted · unlocked by biometrics (AES-256)")
    : "⚠️ Not encrypted — set a PIN or enable biometrics below";
  encEl.className = "sec-state " + (encrypted ? "on" : "off");

  const bioWrap = $("#bioRow");
  const bioState = $("#bioState");
  const bioBtn = $("#btnToggleBio");
  if (!avail && !enabled) {                          // no device biometrics at all
    bioWrap.classList.add("muted-row");
    bioState.textContent = "Not available here — needs a device with fingerprint / Face ID, over https or localhost";
    bioBtn.classList.add("hidden");
    return;
  }
  bioWrap.classList.remove("muted-row");
  bioBtn.classList.remove("hidden");
  bioBtn.disabled = false;
  if (enabled) {
    bioState.textContent = hasPin ? "👍 Enabled on this device" : "👍 Enabled — no PIN, so keep a JSON backup safe";
    bioBtn.textContent = "Turn off";
    bioBtn.className = "btn btn-ghost btn-sm";
  } else {
    bioState.textContent = "Open this profile with your fingerprint / Face ID";
    bioBtn.textContent = "Enable";
    bioBtn.className = "btn btn-primary btn-sm";
  }
}
$("#btnToggleBio").addEventListener("click", async () => {
  const btn = $("#btnToggleBio");
  const persist = () => { const i = profiles.findIndex((p) => p.id === user.id); if (i > -1) profiles[i] = user; saveProfiles(); };

  if (user.bio) {                                   // ── turn OFF
    btn.disabled = true;
    try {
      await bioDisable(user);
      if (!user.pinHash) { sessionKey = null; await saveData(); } // biometric was the only lock → store plaintext again
      persist();
      toast("Biometric unlock turned off", "🔓");
    } catch { toast("Couldn't turn off biometrics", "⚠️"); }
    finally { btn.disabled = false; await refreshSecurityUI(); }
    return;
  }

  const enable = async () => {                       // ── turn ON
    btn.disabled = true;
    try { await bioRegister(user); persist(); toast("Biometric unlock enabled", "🔐"); }
    catch { toast("Couldn't set up biometrics — please try again", "⚠️"); }
    finally { btn.disabled = false; await refreshSecurityUI(); }
  };
  if (!user.pinHash) {
    askConfirm("Protect with biometrics only?", "Without a PIN, this profile can only be opened with this device’s fingerprint / Face ID. If they’re ever unavailable, you’ll need your exported JSON backup to recover. Enable anyway?", enable, { danger: false, yes: "Enable biometrics", emoji: "🔐" });
  } else { enable(); }
});

/* export / import */
$("#btnExport").addEventListener("click", () => {
  const payload = {
    app: "spendly", version: 2,
    profile: { name: user.name, currency: user.currency, color: user.color, avatar: user.avatar || "" },
    exportedAt: new Date().toISOString(),
    transactions: data.transactions,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `spendly-${user.name.toLowerCase().replace(/\s+/g, "-")}-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Data exported as JSON", "📤");
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
      askConfirm(`Import ${clean.length} transactions?`, "They'll be merged with your existing data (duplicates by ID are skipped).", async () => {
        const existing = new Set(data.transactions.map((t) => t.id));
        const fresh = clean.filter((t) => !existing.has(t.id));
        data.transactions.push(...fresh);
        await saveData(); render();
        toast(`Imported ${fresh.length} transactions`, "📥");
      }, { danger: false, yes: "Import", emoji: "📥" });
    } catch {
      toast("That file isn't valid Spendly JSON", "❌");
    }
  };
  reader.readAsText(file);
});

/* danger zone */
$("#btnLogout").addEventListener("click", logout);
$("#btnWipe").addEventListener("click", () =>
  askConfirm("Clear all transactions?", `This deletes all ${data.transactions.length} transactions for ${user.name}. Export a backup first!`, async () => {
    data.transactions = [];
    await saveData(); render();
    toast("All transactions cleared", "🧹");
  }, { emoji: "🧹", yes: "Clear all" })
);
$("#btnDeleteProfile").addEventListener("click", () =>
  askConfirm("Delete this profile?", `${user.name}'s profile and all their data will be permanently removed from this device. This cannot be undone.`, async () => {
    await bioDisable(user);
    localStorage.removeItem(dataKey(user.id));
    profiles = profiles.filter((p) => p.id !== user.id);
    saveProfiles();
    toast("Profile deleted", "👋");
    logout();
  }, { emoji: "🗑️", yes: "Delete forever" })
);

/* ═════════════════ INIT ═════════════════ */
(function init() {
  // theme (migrate old v1 dark/light → mode; default auto)
  let mode = localStorage.getItem(LS_THEME);
  if (!mode) { const old = localStorage.getItem(LS_THEME_OLD); mode = old === "light" || old === "dark" ? old : "auto"; }
  applyTheme(mode, { rerender: false });

  loadProfiles();
  renderColorRow("#colorRow"); renderAvatarRow("#avatarPicker");
  renderColorRow("#setColorRow"); renderAvatarRow("#setAvatarPicker");

  const sessionId = localStorage.getItem(LS_SESSION);
  const p = profiles.find((x) => x.id === sessionId);
  if (p && !p.pinHash && !p.bio) enterApp(p);
  else if (p && (p.pinHash || p.bio)) { renderProfileList(); openUnlockPane(p); }
  else renderProfileList();
})();

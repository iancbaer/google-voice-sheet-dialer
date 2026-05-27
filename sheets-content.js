"use strict";

const PHONE_PATTERN = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/;
let lastDialed = { phone: "", at: 0 };
let toastTimer = null;
let lastPointerEvent = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePhone(raw, defaultCountryCode = "1") {
  const trimmed = String(raw || "").trim();
  const hasPlus = trimmed.includes("+");
  const digits = trimmed.replace(/\D/g, "");

  if (!digits) return "";
  if (hasPlus) return digits;
  if (digits.length === 10 && defaultCountryCode === "1") return `1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  return digits;
}

function displayPhone(phone) {
  if (phone.length === 11 && phone.startsWith("1")) {
    return `+1 (${phone.slice(1, 4)}) ${phone.slice(4, 7)}-${phone.slice(7)}`;
  }

  return `+${phone}`;
}

function textOfNode(node) {
  if (!node || node === window || node === document) return "";
  return [
    node.value,
    node.textContent,
    node.ariaLabel,
    node.title,
    node.getAttribute?.("aria-label"),
    node.getAttribute?.("data-tooltip"),
    node.getAttribute?.("data-value"),
    node.getAttribute?.("data-phone"),
    node.getAttribute?.("data-number"),
    node.getAttribute?.("data-formula"),
    node.getAttribute?.("href")
  ].filter(Boolean).join(" ");
}

function selectedSheetText() {
  return [
    document.querySelector(".cell-input")?.textContent,
    document.querySelector(".cell-input")?.value,
    document.querySelector(".waffle-cell-input")?.textContent,
    document.querySelector(".waffle-cell-input")?.value,
    document.querySelector("[role='gridcell'][aria-selected='true']")?.textContent,
    document.querySelector("[role='gridcell'].cell-input")?.textContent,
    document.querySelector("[aria-label*='formula bar' i]")?.textContent,
    document.querySelector("[aria-label*='formula bar' i]")?.value,
    document.querySelector("input[aria-label*='formula' i]")?.value,
    document.querySelector("textarea[aria-label*='formula' i]")?.value,
    document.querySelector("div[contenteditable='true']")?.textContent
  ].filter(Boolean).join(" ");
}

function textCandidatesFromClick(event) {
  const selection = String(window.getSelection?.() || "").trim();
  const active = document.activeElement;
  const target = event.target;
  const path = event.composedPath?.() || [];
  const pointElements = typeof document.elementsFromPoint === "function"
    ? document.elementsFromPoint(event.clientX, event.clientY).slice(0, 12)
    : [];

  return [
    selection,
    active && "value" in active ? String(active.value || "") : "",
    textOfNode(target),
    ...path.slice(0, 10).map(textOfNode),
    ...pointElements.map(textOfNode),
    selectedSheetText()
  ];
}

function googleVoiceUrl(phone, accountIndex = "0") {
  const cleanAccountIndex = String(accountIndex || "0").replace(/\D/g, "") || "0";
  const encodedPhone = encodeURIComponent(`+${phone}`);
  return `https://voice.google.com/u/${cleanAccountIndex}/calls?gv_dial=${encodedPhone}&gv_auto=1`;
}

function findPhone(values, defaultCountryCode) {
  for (const value of values) {
    const match = String(value || "").match(PHONE_PATTERN);
    const phone = normalizePhone(match?.[0] || "", defaultCountryCode);
    if (phone.length >= 10) return phone;
  }
  return "";
}

function showToast(message) {
  let toast = document.getElementById("gv-dialer-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "gv-dialer-toast";
    toast.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:18px",
      "z-index:2147483647",
      "padding:10px 12px",
      "border-radius:6px",
      "background:#20242c",
      "color:#fff",
      "font:13px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "box-shadow:0 6px 24px rgba(0,0,0,.22)",
      "max-width:320px"
    ].join(";");
    document.documentElement.appendChild(toast);
  }

  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.remove(), 2400);
}

async function getSettings() {
  return await chrome.runtime.sendMessage({ type: "GET_DIALER_SETTINGS" });
}

async function findPhoneAfterSheetsSettles(event, settings) {
  // First try the exact click event. Then wait for Google Sheets to update the
  // selected cell/formula bar. This avoids blocking Sheets' own click handlers.
  for (const delay of [0, 120, 300, 650]) {
    if (delay) await sleep(delay);
    const phone = findPhone(textCandidatesFromClick(event), settings.defaultCountryCode);
    if (phone) return phone;
  }
  return "";
}

async function maybeDialFromClick(event) {
  if (event.button !== 0) return;

  const settings = await getSettings();
  if (!settings.clickToDial) return;

  const phone = await findPhoneAfterSheetsSettles(event, settings);
  if (!phone) return;

  const now = Date.now();
  if (lastDialed.phone === phone && now - lastDialed.at < 2500) return;

  if (settings.confirmBeforeDial && !window.confirm(`Call ${displayPhone(phone)} with Google Voice?`)) return;

  lastDialed = { phone, at: now };

  // Do not preventDefault/stopPropagation here. Google Sheets needs its own
  // click pipeline for selection, and blocking it was the previous regression.
  try {
    const result = await chrome.runtime.sendMessage({ type: "DIAL_PHONE", phone });
    if (result?.ok) {
      showToast(`Opening Google Voice for ${result.displayPhone}`);
      return;
    }
  } catch {
    // If the service worker is asleep or Chrome drops the message, the URL path still works.
  }

  window.open(googleVoiceUrl(phone, settings.accountIndex), "_blank", "noopener");
  showToast(`Opening Google Voice for ${displayPhone(phone)}`);
}

function handleDialEvent(event) {
  lastPointerEvent = event;
  maybeDialFromClick(event).catch(() => {});
}

document.addEventListener("pointerup", handleDialEvent, true);
document.addEventListener("mouseup", handleDialEvent, true);
document.addEventListener("click", handleDialEvent, true);

showToast("Google Voice dialer ready");

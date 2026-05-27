"use strict";

const PHONE_PATTERN = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/;
let lastDialed = { phone: "", at: 0 };
let toastTimer = null;

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

function elementText(node) {
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
    node.getAttribute?.("href")
  ].filter(Boolean).join(" ");
}

function textCandidatesFromClick(event) {
  const selection = String(window.getSelection?.() || "").trim();
  const active = document.activeElement;
  const activeValue = active && "value" in active ? String(active.value || "") : "";
  const target = event.target;
  const path = event.composedPath?.() || [];
  const pointElements = typeof document.elementsFromPoint === "function"
    ? document.elementsFromPoint(event.clientX, event.clientY).slice(0, 12)
    : [];

  const gridSelection = [
    document.querySelector(".cell-input")?.textContent,
    document.querySelector(".cell-input")?.value,
    document.querySelector("[role='gridcell'][aria-selected='true']")?.textContent,
    document.querySelector("[role='gridcell'].cell-input")?.textContent,
    document.querySelector(".waffle-cell-input")?.textContent,
    document.querySelector("[aria-label*='formula bar' i]")?.textContent,
    document.querySelector("[aria-label*='formula bar' i]")?.value,
    document.querySelector("input[aria-label*='formula' i]")?.value,
    document.querySelector("textarea[aria-label*='formula' i]")?.value
  ].filter(Boolean).join(" ");

  return [
    selection,
    activeValue,
    target?.textContent || "",
    target?.ariaLabel || "",
    target?.title || "",
    ...path.slice(0, 10).map(elementText),
    ...pointElements.map(elementText),
    gridSelection
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
      "max-width:360px"
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

async function readClipboardText() {
  try {
    if (navigator.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }
  } catch {
    return "";
  }
  return "";
}

async function copySelectedSheetCellText() {
  // Google Sheets stores cell contents in its app state, not always in the clicked DOM node.
  // As a fallback, use the extension's trusted-key path to copy the active Sheets selection,
  // then read that text back from the clipboard. This makes canvas-backed cells dialable.
  let copiedFromEvent = "";
  const onCopy = (event) => {
    const data = event.clipboardData;
    copiedFromEvent = [
      data?.getData("text/plain"),
      data?.getData("text/html")
    ].filter(Boolean).join(" ");
  };

  document.addEventListener("copy", onCopy, true);
  document.addEventListener("copy", onCopy, false);
  try {
    await chrome.runtime.sendMessage({ type: "COPY_ACTIVE_SELECTION" }).catch(() => null);
    await sleep(120);
    const trustedCopyText = await readClipboardText();
    if (trustedCopyText) return trustedCopyText;

    document.execCommand?.("copy");
    await sleep(80);
    return copiedFromEvent || await readClipboardText();
  } catch {
    return copiedFromEvent;
  } finally {
    document.removeEventListener("copy", onCopy, true);
    document.removeEventListener("copy", onCopy, false);
  }
}

async function findPhoneFromClick(event, settings) {
  let phone = findPhone(textCandidatesFromClick(event), settings.defaultCountryCode);
  if (phone) return phone;

  // Let Sheets update the selected cell/formula bar after the click.
  for (const delay of [120, 320]) {
    await sleep(delay);
    phone = findPhone(textCandidatesFromClick(event), settings.defaultCountryCode);
    if (phone) return phone;
  }

  const copiedText = await copySelectedSheetCellText();
  return findPhone([copiedText], settings.defaultCountryCode);
}

async function maybeDialFromClick(event) {
  if (event.button !== 0 || event.defaultPrevented) return;

  const settings = await getSettings();
  if (!settings.clickToDial) return;

  const phone = await findPhoneFromClick(event, settings);
  if (!phone) return;

  const now = Date.now();
  if (lastDialed.phone === phone && now - lastDialed.at < 2500) return;

  if (settings.confirmBeforeDial && !window.confirm(`Call ${displayPhone(phone)} with Google Voice?`)) return;

  lastDialed = { phone, at: now };
  event.preventDefault();
  event.stopPropagation();

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
  maybeDialFromClick(event).catch(() => {});
}

document.addEventListener("pointerup", handleDialEvent, true);
document.addEventListener("mouseup", handleDialEvent, true);
document.addEventListener("click", handleDialEvent, true);
document.addEventListener("dblclick", handleDialEvent, true);

showToast("Google Voice dialer ready");

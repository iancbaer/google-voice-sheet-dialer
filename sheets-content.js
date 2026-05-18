"use strict";

const PHONE_PATTERN = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/;
let lastDialed = { phone: "", at: 0 };
let toastTimer = null;

function normalizePhone(raw, defaultCountryCode = "1") {
  const trimmed = String(raw || "").trim();
  const hasPlus = trimmed.includes("+");
  const digits = trimmed.replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  if (hasPlus) {
    return digits;
  }

  if (digits.length === 10 && defaultCountryCode === "1") {
    return `1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits;
  }

  return digits;
}

function displayPhone(phone) {
  if (phone.length === 11 && phone.startsWith("1")) {
    return `+1 (${phone.slice(1, 4)}) ${phone.slice(4, 7)}-${phone.slice(7)}`;
  }

  return `+${phone}`;
}

function textCandidatesFromClick(event) {
  const selection = String(window.getSelection?.() || "").trim();
  const active = document.activeElement;
  const activeValue = active && "value" in active ? String(active.value || "") : "";
  const target = event.target;
  const path = event.composedPath?.() || [];
  const pathText = path
    .slice(0, 6)
    .map((node) => {
      if (!node || node === window || node === document) return "";
      const el = node;
      return [
        el.value,
        el.textContent,
        el.ariaLabel,
        el.title,
        el.getAttribute?.("aria-label"),
        el.getAttribute?.("data-tooltip"),
        el.getAttribute?.("data-value")
      ].filter(Boolean).join(" ");
    })
    .join(" ");

  const gridSelection = [
    document.querySelector(".cell-input")?.textContent,
    document.querySelector(".cell-input")?.value,
    document.querySelector("[role='gridcell'][aria-selected='true']")?.textContent,
    document.querySelector("[role='gridcell'].cell-input")?.textContent,
    document.querySelector(".waffle-cell-input")?.textContent
  ].filter(Boolean).join(" ");

  return [
    selection,
    activeValue,
    target?.textContent || "",
    target?.ariaLabel || "",
    target?.title || "",
    pathText,
    gridSelection,
    document.querySelector("[aria-label*='formula bar' i]")?.textContent || "",
    document.querySelector("[aria-label*='formula bar' i]")?.value || ""
  ];
}

function findPhone(values, defaultCountryCode) {
  for (const value of values) {
    const match = String(value || "").match(PHONE_PATTERN);
    const phone = normalizePhone(match?.[0] || "", defaultCountryCode);
    if (phone.length >= 10) {
      return phone;
    }
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

async function maybeDialFromClick(event) {
  if (event.button !== 0) {
    return;
  }

  const settings = await getSettings();
  if (!settings.clickToDial) {
    return;
  }

  let phone = findPhone(textCandidatesFromClick(event), settings.defaultCountryCode);
  if (!phone) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    phone = findPhone(textCandidatesFromClick(event), settings.defaultCountryCode);
  }
  if (!phone) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    phone = findPhone(textCandidatesFromClick(event), settings.defaultCountryCode);
  }

  if (!phone) {
    return;
  }

  const now = Date.now();
  if (lastDialed.phone === phone && now - lastDialed.at < 2500) {
    return;
  }

  if (settings.confirmBeforeDial && !window.confirm(`Call ${displayPhone(phone)} with Google Voice?`)) {
    return;
  }

  lastDialed = { phone, at: now };
  const result = await chrome.runtime.sendMessage({ type: "DIAL_PHONE", phone });
  showToast(result?.ok ? `Opening Google Voice for ${result.displayPhone}` : `Dialer: ${result?.error || "failed"}`);
}

document.addEventListener("click", (event) => {
  maybeDialFromClick(event).catch(() => {});
}, true);

showToast("Google Voice dialer ready");

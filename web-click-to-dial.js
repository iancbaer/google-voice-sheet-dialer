"use strict";

const PHONE_PATTERN = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/;
let lastDialed = { phone: "", at: 0 };

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

function textCandidates(event) {
  const path = event.composedPath?.() || [];
  const target = event.target instanceof Element ? event.target : null;
  const nearestLink = target?.closest("a[href]");
  return [
    String(window.getSelection?.() || ""),
    nearestLink?.getAttribute("href") || "",
    nearestLink?.textContent || "",
    ...path.slice(0, 6).map((node) => {
      if (!node || node === window || node === document) return "";
      return [
        node.value,
        node.textContent,
        node.ariaLabel,
        node.title,
        node.getAttribute?.("aria-label"),
        node.getAttribute?.("title"),
        node.getAttribute?.("href"),
        node.getAttribute?.("data-phone"),
        node.getAttribute?.("data-number")
      ].filter(Boolean).join(" ");
    })
  ];
}

function findPhone(values, defaultCountryCode) {
  for (const value of values) {
    const match = String(value || "").match(PHONE_PATTERN);
    const phone = normalizePhone(match?.[0] || "", defaultCountryCode);
    if (phone.length >= 10) return phone;
  }
  return "";
}

async function getSettings() {
  return await chrome.runtime.sendMessage({ type: "GET_DIALER_SETTINGS" });
}

async function maybeDial(event) {
  if (event.button !== 0) return;

  const settings = await getSettings();
  if (!settings.clickToDial) return;

  const phone = findPhone(textCandidates(event), settings.defaultCountryCode);
  if (!phone) return;

  const now = Date.now();
  if (lastDialed.phone === phone && now - lastDialed.at < 2500) return;

  if (settings.confirmBeforeDial && !window.confirm(`Call ${displayPhone(phone)} with Google Voice?`)) return;

  lastDialed = { phone, at: now };
  event.preventDefault();
  event.stopPropagation();
  await chrome.runtime.sendMessage({ type: "DIAL_PHONE", phone });
}

document.addEventListener("click", (event) => {
  maybeDial(event).catch(() => {});
}, true);

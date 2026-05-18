"use strict";

const DEFAULT_STATE = {
  accountIndex: "0",
  defaultCountryCode: "1",
  clickToDial: true,
  confirmBeforeDial: false,
  rowsText: "",
  queue: [],
  cursor: 0
};

const els = {
  accountIndex: document.getElementById("accountIndex"),
  defaultCountryCode: document.getElementById("defaultCountryCode"),
  clickToDial: document.getElementById("clickToDial"),
  confirmBeforeDial: document.getElementById("confirmBeforeDial"),
  sourceRows: document.getElementById("sourceRows"),
  loadRows: document.getElementById("loadRows"),
  callNext: document.getElementById("callNext"),
  clearDone: document.getElementById("clearDone"),
  resetQueue: document.getElementById("resetQueue"),
  queue: document.getElementById("queue"),
  queueStatus: document.getElementById("queueStatus")
};

let state = { ...DEFAULT_STATE };

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

function firstPhoneLikeValue(values) {
  return values.find((value) => normalizePhone(value, state.defaultCountryCode).length >= 10) || "";
}

function parseRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const values = line.split(/\t|,/).map((value) => value.trim()).filter(Boolean);
      const phoneValue = firstPhoneLikeValue(values);
      const phone = normalizePhone(phoneValue, state.defaultCountryCode);
      const name = values.find((value) => value !== phoneValue && !normalizePhone(value, state.defaultCountryCode)) || "";

      return {
        id: crypto.randomUUID(),
        name: name || phoneValue || "Unknown",
        phone,
        raw: line,
        done: false
      };
    })
    .filter((row) => row.phone.length >= 10);
}

function nextIndex() {
  return state.queue.findIndex((row, index) => index >= state.cursor && !row.done);
}

function updateStatus() {
  const total = state.queue.length;
  const called = state.queue.filter((row) => row.done).length;
  const remaining = total - called;

  els.queueStatus.textContent = total
    ? `${remaining} remaining, ${called} called`
    : "No numbers loaded";
  els.callNext.disabled = remaining === 0;
}

function renderQueue() {
  els.queue.replaceChildren();

  state.queue.forEach((row, index) => {
    const item = document.createElement("li");
    item.className = `queueItem${row.done ? " isDone" : ""}`;

    const details = document.createElement("div");
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = row.name;

    const phone = document.createElement("div");
    phone.className = "phone";
    phone.textContent = displayPhone(row.phone);

    details.append(name, phone);

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = row.done ? "Again" : "Call";
    button.addEventListener("click", () => callAt(index));

    item.append(details, button);
    els.queue.append(item);
  });

  updateStatus();
}

function persist() {
  return chrome.storage.local.set({
    accountIndex: state.accountIndex,
    defaultCountryCode: state.defaultCountryCode,
    clickToDial: state.clickToDial,
    confirmBeforeDial: state.confirmBeforeDial,
    rowsText: state.rowsText,
    queue: state.queue,
    cursor: state.cursor
  });
}

function syncSettingsFromInputs() {
  state.accountIndex = String(els.accountIndex.value || "0").replace(/\D/g, "") || "0";
  state.defaultCountryCode = String(els.defaultCountryCode.value || "1").replace(/\D/g, "") || "1";
  state.clickToDial = els.clickToDial.checked;
  state.confirmBeforeDial = els.confirmBeforeDial.checked;
  state.rowsText = els.sourceRows.value;
}

async function callAt(index) {
  const row = state.queue[index];
  if (!row) {
    return;
  }

  await chrome.runtime.sendMessage({ type: "DIAL_PHONE", phone: row.phone });
  row.done = true;
  state.cursor = Math.min(index + 1, state.queue.length);
  await persist();
  renderQueue();
}

function callNext() {
  const index = nextIndex();
  if (index >= 0) {
    callAt(index).catch(() => {});
  }
}

function loadRows() {
  syncSettingsFromInputs();
  state.queue = parseRows(state.rowsText);
  state.cursor = 0;
  persist();
  renderQueue();
}

function clearDone() {
  state.queue = state.queue.filter((row) => !row.done);
  state.cursor = 0;
  persist();
  renderQueue();
}

function resetQueue() {
  state.queue = state.queue.map((row) => ({ ...row, done: false }));
  state.cursor = 0;
  persist();
  renderQueue();
}

function attachEvents() {
  els.loadRows.addEventListener("click", loadRows);
  els.callNext.addEventListener("click", callNext);
  els.clearDone.addEventListener("click", clearDone);
  els.resetQueue.addEventListener("click", resetQueue);

  [els.accountIndex, els.defaultCountryCode, els.clickToDial, els.confirmBeforeDial, els.sourceRows].forEach((input) => {
    input.addEventListener("change", () => {
      syncSettingsFromInputs();
      persist();
    });
  });
}

chrome.storage.local.get(DEFAULT_STATE).then((saved) => {
  state = { ...DEFAULT_STATE, ...saved };
  els.accountIndex.value = state.accountIndex;
  els.defaultCountryCode.value = state.defaultCountryCode;
  els.clickToDial.checked = state.clickToDial;
  els.confirmBeforeDial.checked = state.confirmBeforeDial;
  els.sourceRows.value = state.rowsText;
  attachEvents();
  renderQueue();
});

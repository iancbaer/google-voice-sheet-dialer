"use strict";

const DEFAULT_SETTINGS = {
  accountIndex: "0",
  defaultCountryCode: "1",
  clickToDial: true,
  confirmBeforeDial: false
};

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

function googleVoiceUrl(phone, accountIndex = "0") {
  const cleanAccountIndex = String(accountIndex || "0").replace(/\D/g, "") || "0";
  const encodedPhone = encodeURIComponent(`+${phone}`);
  return `https://voice.google.com/u/${cleanAccountIndex}/calls?gv_dial=${encodedPhone}&gv_auto=1`;
}

async function getSettings() {
  return await chrome.storage.local.get(DEFAULT_SETTINGS);
}

async function openGoogleVoiceCall(rawPhone) {
  const settings = await getSettings();
  const phone = normalizePhone(rawPhone, settings.defaultCountryCode);

  if (!phone || phone.length < 10) {
    return { ok: false, error: "No valid phone number found" };
  }

  const url = googleVoiceUrl(phone, settings.accountIndex);
  // Let the Google Voice content script own the actual dialing step once the
  // page is ready. Starting the same flow from here as well creates a race for
  // the debugger attachment and can make click-to-dial silently lose.
  await chrome.tabs.create({ url, active: true });
  return { ok: true, phone, displayPhone: displayPhone(phone), url };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForVoiceTabReady(tabId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      return false;
    }
    if (tab.status === "complete" && /^https:\/\/voice\.google\.com\//.test(tab.url || "")) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

async function debugCommand(tabId, method, params = {}) {
  return await chrome.debugger.sendCommand({ tabId }, method, params);
}

async function evalInTab(tabId, expression) {
  const result = await debugCommand(tabId, "Runtime.evaluate", {
    expression,
    returnByValue: true
  });
  return result?.result?.value;
}

async function dispatchTrustedEnter(tabId) {
  for (const type of ["keyDown", "char", "keyUp"]) {
    const params = {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    };
    if (type === "char") {
      params.text = "\r";
    }
    await debugCommand(tabId, "Input.dispatchKeyEvent", params);
  }
}

async function dispatchTrustedText(tabId, text) {
  for (const char of text) {
    await debugCommand(tabId, "Input.dispatchKeyEvent", {
      type: "char",
      text: char
    });
  }
}

function voicePageHelpersExpression() {
  return `
    (() => {
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const label = (element) => [
        element.innerText,
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title")
      ].filter(Boolean).join(" ").trim().toLowerCase();
      const input = [...document.querySelectorAll("input")]
        .find((item) => item.placeholder === "Enter a name or number" || /name or number/i.test(item.getAttribute("aria-label") || ""));
      const callButton = [...document.querySelectorAll("button")]
        .find((item) => visible(item) && /^call$/.test(label(item)));
      return {
        hasInput: !!input,
        hasCallButton: !!callButton,
        callButtonDisabled: !!callButton?.disabled,
        callButtonLabel: callButton ? label(callButton) : ""
      };
    })()
  `;
}

async function withDebugger(tabId, task) {
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    return await task();
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

async function placeTrustedGoogleVoiceCall(tabId, phone) {
  const ready = await waitForVoiceTabReady(tabId);
  if (!ready) {
    return false;
  }

  return await withDebugger(tabId, async () => {
    for (let attempts = 0; attempts < 80; attempts += 1) {
      const state = await evalInTab(tabId, voicePageHelpersExpression());
      if (state?.hasInput) {
        break;
      }
      await sleep(250);
    }

    await evalInTab(tabId, `
      (() => {
        const input = [...document.querySelectorAll("input")].find((item) => item.placeholder === "Enter a name or number");
        if (!input) return false;
        input.focus();
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()
    `);
    await dispatchTrustedText(tabId, String(phone || "").replace(/\D/g, ""));
    await sleep(400);
    await dispatchTrustedEnter(tabId);

    for (let attempts = 0; attempts < 30; attempts += 1) {
      const state = await evalInTab(tabId, voicePageHelpersExpression());
      if (state?.hasCallButton && !state.callButtonDisabled) {
        await evalInTab(tabId, `
          (() => {
            const visible = (element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
            };
            const label = (element) => [
              element.innerText,
              element.textContent,
              element.getAttribute("aria-label"),
              element.getAttribute("title")
            ].filter(Boolean).join(" ").trim().toLowerCase();
            [...document.querySelectorAll("button")]
              .find((item) => visible(item) && /^call$/.test(label(item)) && !item.disabled)
              ?.click();
          })()
        `);
        return true;
      }
      await sleep(250);
    }

    return false;
  });
}


async function dispatchTrustedCopy(tabId) {
  return await withDebugger(tabId, async () => {
    await debugCommand(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Control",
      code: "ControlLeft",
      windowsVirtualKeyCode: 17,
      nativeVirtualKeyCode: 17,
      modifiers: 2
    });
    await debugCommand(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "c",
      code: "KeyC",
      windowsVirtualKeyCode: 67,
      nativeVirtualKeyCode: 67,
      modifiers: 2
    });
    await debugCommand(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "c",
      code: "KeyC",
      windowsVirtualKeyCode: 67,
      nativeVirtualKeyCode: 67,
      modifiers: 2
    });
    await debugCommand(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Control",
      code: "ControlLeft",
      windowsVirtualKeyCode: 17,
      nativeVirtualKeyCode: 17
    });
    return true;
  });
}

async function commitTrustedDialInput(tabId) {
  return await withDebugger(tabId, async () => {
    await evalInTab(tabId, `
      [...document.querySelectorAll("input")]
        .find((item) => item.placeholder === "Enter a name or number")
        ?.focus()
    `);
    await dispatchTrustedEnter(tabId);
    return true;
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ clickToDial: true, confirmBeforeDial: false });
  chrome.contextMenus.create({
    id: "call-with-google-voice",
    title: "Call selected number with Google Voice",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "call-with-google-voice") {
    openGoogleVoiceCall(info.selectionText).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "DIAL_PHONE") {
    openGoogleVoiceCall(message.phone)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_DIALER_SETTINGS") {
    getSettings()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "COPY_ACTIVE_SELECTION" && sender.tab?.id != null) {
    dispatchTrustedCopy(sender.tab.id)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "COMMIT_DIAL_INPUT" && sender.tab?.id != null) {
    commitTrustedDialInput(sender.tab.id)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "PLACE_TRUSTED_CALL" && sender.tab?.id != null) {
    placeTrustedGoogleVoiceCall(sender.tab.id, message.phone)
      .then((ok) => sendResponse({ ok }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

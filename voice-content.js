"use strict";

let micWarmStream = null;
let lastMicWarmAttempt = 0;


function injectGoogleVoiceMicOverride() {
  if (document.documentElement.dataset.gvMicOverrideInjected === "1") return;
  document.documentElement.dataset.gvMicOverrideInjected = "1";

  const script = document.createElement("script");
  script.textContent = `(() => {
    if (window.__gvDialerMicOverrideInstalled) return;
    window.__gvDialerMicOverrideInstalled = true;

    const rejectBadInput = (label) => !/(monitor|airpods|bluez_output|hdmi|displayport|output)/i.test(label || "");
    const preferGoodInput = (label) => /(forced|alsa source|hw:0,0|hda|analog|headset|headphone|mic|microphone)/i.test(label || "");

    async function chooseInputDevice(mediaDevices) {
      const devices = await mediaDevices.enumerateDevices();
      const inputs = devices.filter((device) => device.kind === "audioinput");
      return inputs.find((device) => rejectBadInput(device.label) && preferGoodInput(device.label))
        || inputs.find((device) => rejectBadInput(device.label))
        || inputs.find((device) => device.deviceId === "default")
        || inputs[0]
        || null;
    }

    const originalGetUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (!originalGetUserMedia) return;

    navigator.mediaDevices.getUserMedia = async function patchedGetUserMedia(constraints) {
      const next = constraints && typeof constraints === "object" ? { ...constraints } : constraints;
      if (next && next.audio) {
        try {
          const selected = await chooseInputDevice(navigator.mediaDevices);
          if (selected?.deviceId) {
            const existing = typeof next.audio === "object" ? next.audio : {};
            next.audio = {
              ...existing,
              deviceId: { exact: selected.deviceId },
              echoCancellation: existing.echoCancellation ?? true,
              noiseSuppression: existing.noiseSuppression ?? true,
              autoGainControl: existing.autoGainControl ?? true
            };
            window.__gvDialerSelectedMic = selected.label || selected.deviceId;
          }
        } catch (error) {
          window.__gvDialerMicOverrideError = String(error?.message || error);
        }
      }
      return originalGetUserMedia(next);
    };
  })();`;
  (document.documentElement || document.head).appendChild(script);
  script.remove();
}

injectGoogleVoiceMicOverride();


function phoneFromUrl() {
  const url = new URL(location.href);
  const explicit = url.searchParams.get("gv_dial");
  if (explicit) {
    return explicit.replace(/[^\d+]/g, "");
  }

  const action = url.searchParams.get("a") || "";
  const match = action.match(/(?:^|,)\+?(\d{10,15})/);
  return match ? `+${match[1]}` : "";
}

function setNativeInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) {
    input.value = value;
  } else {
    setter.call(input, value);
  }
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function findDialInput() {
  return [...document.querySelectorAll("input")]
    .find((input) => input.placeholder === "Enter a name or number" || /name or number/i.test(input.getAttribute("aria-label") || ""));
}

function visible(element) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function buttonText(button) {
  return [
    button.innerText,
    button.textContent,
    button.getAttribute("aria-label"),
    button.getAttribute("title")
  ].filter(Boolean).join(" ").trim();
}

function findCallButton() {
  return [...document.querySelectorAll("button")]
    .find((button) => visible(button) && /^call$/i.test(buttonText(button)));
}

function findYesButton() {
  return [...document.querySelectorAll("button")]
    .find((button) => visible(button) && /^(yes|call)$/i.test(buttonText(button)));
}

function dispatchEnter(target) {
  for (const type of ["keydown", "keypress", "keyup"]) {
    target.dispatchEvent(new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13
    }));
  }
}

async function commitDialInput(input) {
  dispatchEnter(input);
  await new Promise((resolve) => setTimeout(resolve, 350));
}


function micStreamAlive() {
  return !!micWarmStream && micWarmStream.getAudioTracks().some((track) => track.readyState === "live");
}

async function ensureMicWarm(reason = "") {
  if (micStreamAlive()) {
    return true;
  }

  const now = Date.now();
  if (now - lastMicWarmAttempt < 1500) {
    return false;
  }
  lastMicWarmAttempt = now;

  try {
    micWarmStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    window.__gvDialerMicWarmStream = micWarmStream;
    showStatus("Google Voice microphone is active.");
    return true;
  } catch (error) {
    showStatus(`Google Voice microphone failed: ${error.name || error.message}`);
    return false;
  }
}

function findExplicitUnmuteButton() {
  return [...document.querySelectorAll("button,[role='button']")]
    .find((button) => {
      if (!visible(button)) return false;
      const text = buttonText(button).toLowerCase();
      if (!text) return false;
      return /\bunmute\b/.test(text)
        || /turn on (the )?(microphone|mic)/.test(text)
        || /(microphone|mic).*(off|muted)/.test(text);
    });
}

async function keepVoiceMicReady() {
  await ensureMicWarm("startup");
  const unmuteButton = findExplicitUnmuteButton();
  if (unmuteButton) {
    unmuteButton.click();
    await ensureMicWarm("unmute");
  }
}

function installVoiceMicGuard() {
  keepVoiceMicReady().catch(() => {});
  setInterval(() => {
    keepVoiceMicReady().catch(() => {});
  }, 2000);
  document.addEventListener("click", () => {
    setTimeout(() => keepVoiceMicReady().catch(() => {}), 250);
  }, true);
}

function installManualDialAssist() {
  let timer = null;

  document.addEventListener("input", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input !== findDialInput()) {
      return;
    }

    clearTimeout(timer);
    timer = setTimeout(async () => {
      const digits = input.value.replace(/\D/g, "");
      const callButton = findCallButton();
      if (digits.length >= 10 && callButton?.disabled) {
        await chrome.runtime.sendMessage({ type: "COMMIT_DIAL_INPUT" });
      }
    }, 500);
  }, true);
}

async function waitFor(predicate, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function showStatus(message) {
  let toast = document.getElementById("gv-auto-dial-status");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "gv-auto-dial-status";
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
      "box-shadow:0 6px 24px rgba(0,0,0,.22)"
    ].join(";");
    document.documentElement.appendChild(toast);
  }
  toast.textContent = message;
  setTimeout(() => toast.remove(), 3000);
}

async function autoDialFromUrl() {
  const url = new URL(location.href);
  if (url.searchParams.get("gv_auto") !== "1") {
    return;
  }

  const phone = phoneFromUrl();
  if (!phone) {
    return;
  }

  const onceKey = `gv-auto-dial:${phone}:${location.pathname}`;
  if (sessionStorage.getItem(onceKey) === "1") {
    return;
  }
  sessionStorage.setItem(onceKey, "1");

  const input = await waitFor(findDialInput);
  if (!input) {
    showStatus("Google Voice dialer input was not found");
    return;
  }

  input.focus();
  setNativeInputValue(input, phone);
  await ensureMicWarm("before-auto-dial");

  for (let attempts = 0; attempts < 4; attempts += 1) {
    const result = await chrome.runtime.sendMessage({ type: "PLACE_TRUSTED_CALL", phone });
    if (result?.ok) {
      showStatus("Placing call in Google Voice.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }

  showStatus("Could not place call in Google Voice.");
}

installVoiceMicGuard();
installManualDialAssist();
autoDialFromUrl().catch(() => {});

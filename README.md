# Google Voice Sheet Dialer for Linux Chrome

Unpacked Chrome extension for Linux Chrome that turns phone numbers in Google
Sheets or web pages into Google Voice calls.

What it does:

- Google Sheets: click a cell containing a phone number; if Sheets hides the
  value in its canvas UI, the extension falls back to copying the selected cell
  through Chrome's trusted keyboard path and reads the copied phone number.
- Google Voice: opens the call screen, fills the number, and uses Chrome's
  debugger input path to press the trusted call controls.
- Google Voice mic guard: injects at `document_start` and forces Voice
  WebRTC microphone requests away from AirPods/output monitor devices and onto
  the real Linux mic.
- Web pages: click phone-number text or links to dial through Google Voice.
- Linux audio watchdog: keeps Chrome output routed to AirPods when connected,
  keeps the browser microphone on the forced ALSA mic source, and moves active
  call streams back onto those devices if PipeWire/Chrome drifts.

The current local install is expected at:

```text
/home/iancbaer/google-voice-dialer-extension
```

The Chrome profile cache is expected to load version `1.3.4` from:

```text
~/.config/google-chrome/Default/Extensions/bmejbhdmhfmeegbilffhhpcaidihdkif/1.3.4_0
```

## Linux audio watchdog

The watchdog files are included in `linux/` for reproducibility:

```text
linux/google-voice-audio-fix.sh
linux/google-voice-audio-fix.service
```

Installed user-service locations:

```text
~/.local/bin/google-voice-audio-fix.sh
~/.config/systemd/user/google-voice-audio-fix.service
```

Useful checks:

```bash
systemctl --user status google-voice-audio-fix.service
pactl info | grep -E 'Default (Sink|Source)'
pactl list short sink-inputs
pactl list short source-outputs
```

Expected routing while AirPods are connected:

```text
Default Sink: bluez_output.9C_A9_C5_1B_DB_EF.1
Default Source: forced_alsa_mic
```

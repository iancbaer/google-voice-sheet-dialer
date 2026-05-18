# Google Voice Sheet Dialer for Linux Chrome

This unpacked Chrome extension is built for Chrome on Linux and dials phone
numbers through Google Voice.

Behavior:

- Toolbar popup: paste Google Sheet rows, load a queue, click `Call next`.
- Google Sheets: click a cell or selected text containing a phone number. The
  extension opens Google Voice and prepares the call.
- Context menu: highlight a phone number on a page, right-click, and choose `Call selected number with Google Voice`.
- Compliance step: Google Voice's final `Call` button is left for the user to click manually.

The browser-side calling fix in this repo is Linux-specific because it depends
on Chrome using the local Linux audio stack correctly.

Google Voice URL format:

```text
https://voice.google.com/u/0/calls?a=nc,%2B18005550111
```

Chrome must have the unpacked extension loaded from this folder:

```text
/home/iancbaer/google-voice-dialer-extension
```

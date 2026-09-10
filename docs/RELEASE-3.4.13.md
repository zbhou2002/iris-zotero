# Iris 3.4.13 — macOS dictation and composer fixes

- Move the recording cancel control next to the microphone and Send controls. Reserve full click targets and let the model label shrink or the toolbar wrap in a narrow sidebar.
- Run Mac recording through the bundled Iris Voice app, with its own microphone usage declaration and normal macOS consent prompt. Direct Python children previously inherited Zotero's microphone identity; Zotero 9.0.6 lacks a microphone usage declaration and macOS denied the request without showing a prompt.
- Keep microphone-denial instructions visible, allow retry after permission is enabled, and keep cancellation available while permission is pending.
- Wait for the helper to terminate its Python child when cancelling. Windows retains its existing direct Python recording path.
- Build the universal arm64/x86_64 helper from source in CI and include it in the same XPI. No Xcode or Homebrew is required on the user's Mac.

Validation: 77 JavaScript tests and 3 Python progress tests pass. On Apple Silicon with Zotero 9.0.6, the addon loads in an isolated profile; the three recording controls remain fully clickable at 180, 220, 260, 320 and 480 px widths. A synthetic Chinese recording transcribes correctly through the native helper without network access. A consented five-second microphone test completes normally and returns no transcript for silence. Intel is cross-compiled but has not been tested on hardware; Zotero versions other than 9.0.6 have not been retested.

Mac users: allow **Iris Voice** in **System Settings → Privacy & Security → Microphone**. This is local Whisper recognition, so Apple's Speech Recognition permission is not needed. No system permission resets or Zotero.app modifications are performed. The helper has an ad-hoc signature rather than Apple Developer ID notarization; a changed helper binary may require renewed microphone consent.

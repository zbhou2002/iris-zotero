# Iris · Installation and reference

[Product home](../README.md) · [中文使用说明](README.zh-CN.md)

## Install

1. Download `Iris-<version>.xpi` from [Releases](https://github.com/zbhou2002/iris-zotero/releases/latest).
2. In Zotero, open **Tools → Plugins** (called **Add-ons** in some versions).
3. Choose the gear menu → **Install Add-on From File…**, select the XPI, and restart Zotero.
4. Open a PDF and select Iris in the reader sidebar. Use the gear in Iris to connect your model service.

**Upgrading from AIdea or an earlier local Iris build:** install the XPI over the existing addon; do not uninstall first. Iris keeps the existing `aidea@visterainer` addon ID and preference namespace to preserve the migration path. Iris and AIdea therefore cannot be installed side by side. Back up your Zotero profile before migrating.

After this first formal installation, Zotero can retrieve future Iris releases through its addon updater. Copying an XPI directly into the profile folder may not update Zotero's registered addon metadata; use the plugin manager for the initial migration. Automatic updates also depend on Zotero's update preferences and GitHub network access.

## Compatibility and setup

The package declares Zotero **7–9** compatibility. Runtime checks have been performed on **Windows and Apple Silicon macOS with Zotero 9.0.6**; other Zotero versions and Intel Macs have not been fully validated. One XPI supports both platforms; the Mac microphone helper contains arm64 and x86_64 binaries. Optional local dictation includes Windows and macOS setup scripts; Linux automatic speech setup is not currently provided. Microphone access and a successful local runtime/model installation are still required.

Chat, translation, and AI highlights use the model provider you select. They are **not offline** just because dictation is local, and a provider account or API credentials may be required. Model accuracy, provider availability, and response time vary. Highlights are reading aids, not an objective ranking or a substitute for checking the paper. Scanned PDFs without usable text may need OCR first.

Dictation's first setup downloads Python dependencies and a Whisper model and can take time and disk space. Once setup is complete, the transcription helper blocks network access during recognition. Sending the resulting text as a chat message still sends that text to the selected model provider.

The mic checks local files when a composer opens and before each recording. If setup is missing or incomplete, click the outlined mic to install. While installing, the mic is gray and disabled; typing and chat remain available. The composer shows the current stage and elapsed time, or actual model-download bytes and a percentage when the total is known (including resumed bytes; not a timer-based estimate). Model verification must finish before recording is enabled. Click again to record; installation never starts recording automatically. Failed setup displays a reason and allows a deliberate retry. All panels share one installation, including when you switch settings or reopen the sidebar. Automatic setup currently has a 30-minute timeout; slow or interrupted connections may require retrying.

On macOS, dictation runs through the bundled **Iris Voice** helper so macOS can display its own microphone permission prompt. Allow **Iris Voice** in **System Settings → Privacy & Security → Microphone**. If access is denied, Iris shows a persistent explanation and you can retry after enabling it. The helper needs microphone access only; local Whisper transcription does not require Apple's Speech Recognition permission, Accessibility, or Full Disk Access. Iris does not modify Zotero.app or reset system permissions. The first recording click installs the bundled helper into the speech runtime folder; no Xcode or Homebrew is needed. If a later helper update changes its signature, macOS may ask for consent again.

## Build from source

Requires Node.js 22+ and Python 3.12+. The Iris packaging path uses only their standard libraries; no npm install is needed.

```sh
npm run check
python plugin/test-speech-progress.py
sh scripts/build-macos-voice.sh  # macOS only; CI builds the universal helper
python scripts/package.py
```

Packaging requires the helper archive built on macOS (or downloaded from the matching CI build).

The installer, update manifest, and checksum are written to `dist/`. The patch-based source layout and original upstream source are documented in [PROVENANCE](PROVENANCE.md). See [CONTRIBUTING](../CONTRIBUTING.md) for the release procedure.

## Privacy and license

Only source code, distributable assets, tests, and documentation belong in this repository. Zotero libraries, PDFs, conversations, recordings, credentials, and local runtime caches are not included. Review your model provider's data policy before sending paper text. Do not attach personal profiles or unredacted logs to public issues.

Iris retains the upstream **AGPL-3.0-or-later** license; see [LICENSE](../LICENSE), [third-party notices](../THIRD_PARTY_NOTICES.md), and [provenance](PROVENANCE.md). All original notices are retained. System fonts are used; proprietary OpenAI font files are not redistributed.

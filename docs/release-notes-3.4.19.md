# Iris 3.4.19

## Changes

- Enable Iris on Zotero 10. The installer and automatic-update metadata now declare Zotero 7.0 through 10.0.* compatibility.
- Fix a streaming-reply scroll race: wheel input immediately hands scrolling back to the reader, before a delayed native scroll event can allow the answer to pull the viewport back.
- Add regression coverage for Zotero 10's plural library-selection API, older Zotero fallback, release compatibility metadata and wheel input during streaming.

## Validation

- 92 JavaScript tests and 3 Python speech-progress tests pass.
- Windows / Zotero 10.0.5 isolated-profile checks pass: normal plugin-manager installation and persistence after restart, sidebar reopening, settings, chat history, streamed replies and reading position, PDF text extraction, localized passage references, external-link routing and manual selection translation.
- Model requests in these checks use a local synthetic response server. They do not validate external provider availability. Dictation state regressions pass; no real microphone recording or new model download was performed for this release.
- The same XPI includes the existing macOS support; CI rebuilds its universal voice helper. Zotero 10 on a physical Mac has not been tested in this release. Earlier Apple Silicon / Zotero 9.0.6 validation remains documented in the setup guide.

## Upgrade

Check for updates in Zotero's plugin manager, or download `Iris-3.4.19.xpi` and use **Install Add-on From File…**, then restart Zotero. Install over the existing Iris; do not uninstall or delete plugin data.

Zotero requires a tested major-version ceiling, so this release uses `10.0.*`, not an unlimited range. Zotero 10.0 patch updates are included; future major versions require renewed testing. [Official developer guidance](https://www.zotero.org/support/dev/zotero_10_for_developers).

## 中文

适配 Zotero 10，并修复流式回复期间手动滚动可能被拉回的问题。已在 Windows / Zotero 10.0.5 隔离环境验证安装、重启、侧栏、对话阅读位置、选文引用、链接和划词翻译。

在 Zotero 插件管理器检查更新，或下载 XPI 后通过“从文件安装”覆盖安装，再重启。不要先卸载 Iris 或删除数据。兼容上限为 `10.0.*`，包含该系列后续小版本；Zotero 官方不允许无限放开未来大版本。Mac 仍使用同一安装包，但本次没有进行 Mac / Zotero 10 实机验证。

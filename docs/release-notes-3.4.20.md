# Iris 3.4.20

## Dynamic Codex models

- Automatically refresh models on startup and when opening the chat or selection-translation model picker.
- Read the installed Codex client's official `model/list` interface, including pagination, display names, visibility, ordering and default-model metadata. Prefer the desktop bundle on supported installation paths, then the standalone/PATH installation.
- Remove the hard-coded Codex fallback list. Show discovery progress, actionable failures and a Refresh button; retain the last fetched list on temporary failures and clear Codex choices on detected sign-out.
- Share in-flight discovery between panels, enforce a timeout and clean up the discovery child process. No thread or inference request is started to refresh models.
- Preserve available selected models, unsent drafts, custom endpoints and other providers. Update open menus in place, including the translation picker.

Requires a local Codex installation signed in to ChatGPT. The catalog is provided by Codex and may be cached or bundled; listing a model is not an entitlement or successful-inference check. This release does not change the existing chat transport or provider authentication flow. [Official interface documentation](https://learn.chatgpt.com/docs/app-server#list-models-modellist).

## Validation

- 103 JavaScript tests and 3 Python speech-progress tests pass.
- Windows / Zotero 10.0.5 isolated-profile test reads the real installed Codex catalog and verifies startup refresh, both model menus, retained selection/draft/custom settings, language switching and settings return.
- macOS executable discovery is covered by automated tests; this release has not been tested on a physical Mac. The universal voice helper is rebuilt in CI.

## 中文

模型菜单改为自动跟随本机 Codex 的模型目录：启动时、打开聊天或划词翻译模型菜单时自动刷新，不再保留写死的旧模型兜底名单。支持刷新进度、失败提示和手动重试；保留仍可选择的已选模型、未发送草稿以及自定义 API 配置。

刷新只读取模型目录，不发送模型推理请求。Codex 自身可能返回缓存目录，模型出现在列表中不等于已验证账号调用权限。请在 Zotero 插件管理器检查更新，或覆盖安装 `Iris-3.4.20.xpi` 后重启，无需卸载旧版。

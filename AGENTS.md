## 项目定位

Pi Work 是 pi coding agent 的 Web UI。

## 开发要求

- 代码里不写注释，让符号命名、类型、测试用例等来解释「这段代码在做什么」，不依靠注释解释代码，如果有重要的决策与取舍，记在 `docs/adr/`。
- 在 UI 设计时，请避免不必要的次要标签和描述，让 UI 元素或布局本身来传达信息。
- 除非用户允许，否则永远不要损坏 `~/.pi` 或 `~/.pi-work` 的用户数据，特别注意避免「间接破坏」。
- 开发结束后，不要擅自重新构建 `pnpm run build` 或重启服务，也不要进行 Web 测试。
- 需要测试时，阅读 `tests/README.md`
## Agent skills

### Issue tracker

Issue 与 spec 记录在本地 `.scratch/<feature-slug>/` 下的 markdown 文件。详见 `docs/agents/issue-tracker.md`。

### Triage labels

沿用默认的五个分诊标签：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文（single-context）：根目录 `GLOSSARY.md` + `docs/adr/`。详见 `docs/agents/domain.md`。

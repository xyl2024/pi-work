---
name: commit
description: '当用户要求"提交当前改动"、"帮我 commit 一下"、"把这次改动提交了"时使用。'
---

# Commit Skill

把当前任务的代码改动整理成一个（或多个）符合项目惯例的 git commit。

## 何时使用

- 用户说"提交一下"、"commit 一下"、"把这次的改动提了"
- 用户说"做一个 commit"但没有指定 message，让 AI 根据本次任务总结

**不要**在没有本次任务改动时主动触发，也不要代替用户自己手动写的 commit。

## 工作流

### 1. 收集变更

```bash
git status
git diff --stat HEAD
```

只关注本次任务产生的改动。如果暂存区或工作区里已经有与本次任务无关的脏改动，**先停下来问用户**，不要自作主张塞进同一个 commit。

### 2. 安全审查

逐文件扫一遍 `git diff HEAD`（只看本次任务改动，不要扫老文件）。命中下列任一项就**停下来向用户报告，不要提交**：

- API key、token、secret、password、private key、ssh key
- 公司/客户内网 IP、内网域名、数据库连接串
- 真实邮箱、电话、姓名等 PII
- `.env*` 或配置文件里出现的真实凭证（如果是"新增 env 配置"这类纯结构改动、且已确认不含真实值，可继续）
- 调试日志/堆栈里夹带的敏感数据

### 3. 拆分判定

遇到以下情况**建议拆分**成多个 commit，先向用户确认拆分方案再继续：

- 多个互不相关的功能点（如"新增 A"+"顺手修了 B 的 bug"）
- 功能代码与无关的重构/格式化/注释清理
- 跨了多个改动区域（例如改动了 `lib/` 和 `components/` 各自独立的两套功能）

判断"是否相关"的标准：脱离 commit message 看，另一组改动是否还能独立解释清楚。能讲清就分；分不清就合并。

拆分方法：先 `git restore --staged <file>` 把要拆出去的文件撤出暂存区，再分批 `git add` + `git commit`。

### 4. 写 commit message

格式：

```
<type>(<scope>): <中文主题>

<可选：中文正文>
<可选：- 要点列表>
<空行>
Co-Authored-By: $PI_MODEL with Pi Work
```

| 字段 | 规则 |
| ---- | ---- |
| `type` | Conventional Commits：`feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` / `ci` / `chore` / `revert` |
| `scope` | 改动所在的模块或区域，中文。无明确范围可省略括号 |
| 主题行 | 中文，祈使句，不加句号。≤ 50 个汉字 / 72 字符 |
| 正文 | 中文，72 字符换行。需要时用 `-` 列表项 |
| Trailer | `Co-Authored-By: $PI_MODEL with Pi Work`，**总是**末尾追加；`$PI_MODEL` 取自环境变量 `PI_MODEL`，不要从其他来源推断 |

通用术语（`feat`、`fix`、`scope` 名、英文 API/库名等）保留英文。

#### 跟项目历史对齐

项目最近 commit 普遍长这样，提交前参考一下风格：

```
feat(右侧按钮列): 新增会话绑定按钮纵向对齐配置

- 在 RightSideBarConfig 中新增 session_bound_alignment 字段（top / bottom / inline），默认 bottom
- RightBarColumn bottom 模式下插入 flex:1 spacer，把会话绑定组推到列底部
- lib/i18n-dict.ts 补 5 条中英词条

Co-Authored-By: agnes-2.5-flash
```

要点：scope 中文；要点列表用 `-`，每条独立成行；以空行分隔正文和 trailer；trailer 末尾没有 `with Pi Work` 时补上。

#### 范例

```
feat(认证): 新增 OAuth 登录功能
fix(购物车): 修复数量更新异常问题
docs(README): 更新安装指南
refactor(右侧按钮列): 提取工具按钮为 useToolButtons hook
```

写完后在心里验证：脱离 diff 看，只看 commit message 也能复述改了什么。

### 5. 提交

> ⚠️ **`PI_MODEL` 必须从环境变量 `$PI_MODEL` 获取**（如 `PI_MODEL=MiniMax-M3`）。不要让用户口头报、不要从 `git config user.*` / 其他 env / 提交历史里推断。**环境变量为空或未设置时**，停下来问用户当前模型名，再继续；不要瞎编。

```bash
git add <files>             # 只 stage 本次任务相关的文件，绝不用 git add -A
git commit -m "主题" -m "正文可选" -m "Co-Authored-By: $PI_MODEL with Pi Work"
```

提交到**当前分支**，不切分支、不创建分支。除非用户明确要求，否则不要 `git push`、不要开 PR。

### 6. 反馈

提交完成后简短告诉用户：

- 提交了哪些文件
- 完整的 commit message
- 是否还有未提交的本次任务之外的脏改动

## 边界与陷阱

- **绝不**用 `git add -A` / `git add .` —— 会把用户自己的工作目录脏改动一起塞进去
- **绝不**动暂存区里与本次任务无关的文件 —— 如果有，先问
- **空提交**（`--allow-empty`）只在用户明确要求时使用
- **amend** 只在用户明确要求时使用，且只能改最近的、是自己写的 commit
- **force push / rebase 已推送分支** 一律需要用户明确确认
- 提交前如果改了 `package.json` / `package-lock.json`，提醒用户是否需要 `npm install`

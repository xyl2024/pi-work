# Tests

自动化测试架子（Vitest）：

| 层 | 框架 | 位置 | 运行 |
|---|---|---|---|
| 接口 / 单元 | Vitest | `tests/unit/**/*.test.ts` | `pnpm test` |

`tests/unit/` 下有两类测试：

- **接口测试**：用 `tests/unit/helpers.ts` 的 `api()` 打隔离实例的 HTTP 接口，
  如 `api-smoke.test.ts`、`settings.test.ts`。
- **纯单元测试**：直接 import `lib/shared` 等纯模块，不发请求、不用 cookie，
  如 `panel-tabs.test.ts`、`subagent-profiles.test.ts`。`electron-shell/window-rules.js`
  （外壳窗口的 URL 与「什么算离开应用」两条规则）也走这条路：
  `electron-shell-window-rules.test.ts`。外壳的服务端决策（`electron-shell/server-process.js`：
  是否由外壳拉起、用什么命令与环境、如何签名注入 cookie、如何结束进程树、何时算就绪）
  同理（`electron-shell-server-process.test.ts`），其中 cookie 名/TTL 与 token 格式这一条
  刻意跨到服务端：用 `lib/server/auth.ts` 的验证器验外壳签的 token。
- **服务端模块测试**：直接 import 服务端模块本身，用真实的 `Request` /
  `NextRequest` 驱动它，如 `auth-proxy.test.ts`（`proxy.ts`）、
  `auth-desktop.test.ts`（三个 auth session route handler 与 `lib/server/auth.ts`）。
  它存在的原因是**隔离实例无法被配置成另一种形态**：接口测试打的实例永远跑在服务器
  轨道（`PI_WORK_AUTH_*` + 登录页），而桌面轨道（`PI_WORK_DESKTOP`）的规则必须
  在进程内才能被驱动。断言仍只落在外部行为（状态码、响应体、重定向目标），
  不 mock 依赖袋、不断言内部调用次数。

## 隔离原则（红线）

测试只针对隔离实例（`pnpm run dev:isolated`，端口 30143，数据根 `~/.pi-work-dev`），
绝不接触生产实例和真实 `~/.pi` / `~/.pi-work` 数据。数据之外，**构建产物也完全隔离**：
`next.config.ts` 支持 `NEXT_DIST_DIR` 环境变量，测试实例构建到 `.next-test/`，
`dev:isolated` 构建到 `.next-isolated/`，生产实例正在使用的 `.next/` 永远不会被写入。

- **接口测试**：`tests/global-setup.ts` 先探测 `TEST_BASE_URL`（默认 30143）：
  已在运行则直接复用（测试结束后保持运行）；没在运行则自动启动
  `scripts/dev-isolated.mjs`，等待就绪后跑测试，结束时自动停掉。
- **纯单元测试**不访问实例，但 `vitest.config.ts` 的 `globalSetup` 对所有
  `tests/unit/**` 生效，所以 `pnpm test` 仍会先确保隔离实例可用（不会跳过）。
- 端口/地址冲突时可用 `PI_WORK_TEST_BASE_URL` 覆盖。
- **不测试生产环境**：不存在生产形态的测试路径，`tests/global-setup.ts` 只以
  `next dev` 启动隔离实例，没有 `next build` / `next start`，也没有
  `PI_WORK_TEST_PROD` 之类的开关。要验证生产形态请人工部署后手动验证，
  不要把它接回测试架子。

## 写新测试

- 接口测试：参考 `tests/unit/api-smoke.test.ts`，直接 `fetch(TEST_BASE_URL) + API 路径`。
- 纯单元测试：参考 `tests/unit/panel-tabs.test.ts`，直接 import 被测模块断言纯函数行为；
  放在 `lib/shared` 的逻辑必须能在无 React / DOM / 服务端依赖下被这样测试。
- 旧的 `scripts/test-*.ts` 脚本保留不动，后续按需迁移到本框架。

# Tests

自动化测试架子（Vitest）：

| 层 | 框架 | 位置 | 运行 |
|---|---|---|---|
| 接口 / 单元 | Vitest | `tests/unit/**/*.test.ts` | `npm test` |

## 隔离原则（红线）

测试只针对隔离实例（`npm run dev:isolated`，端口 30143，数据根 `~/.pi-work-dev`），
绝不接触生产实例和真实 `~/.pi` / `~/.pi-work` 数据。数据之外，**构建产物也完全隔离**：
`next.config.ts` 支持 `NEXT_DIST_DIR` 环境变量，测试实例构建到 `.next-test/`，
`dev:isolated` 构建到 `.next-isolated/`，生产实例正在使用的 `.next/` 永远不会被写入。

- **接口测试**：`tests/global-setup.ts` 先探测 `TEST_BASE_URL`（默认 30143）：
  已在运行则直接复用（测试结束后保持运行）；没在运行则自动启动
  `scripts/dev-isolated.mjs`，等待就绪后跑测试，结束时自动停掉。
- 端口/地址冲突时可用 `PI_WORK_TEST_BASE_URL` 覆盖。
- **生产模式冒烟**：`PI_WORK_TEST_PROD=1 npm test` 会先 `next build --webpack`（与
  `npm run build` 一致）再用 `next start` 起隔离实例（同一套 `~/.pi-work-dev`
  隔离数据），跑生产形态的接口测试；globalSetup 超时已放宽到 15 分钟以容纳构建。

## 写新测试

- 接口测试：参考 `tests/unit/api-smoke.test.ts`，直接 `fetch(TEST_BASE_URL) + API 路径`。
- 旧的 `scripts/test-*.ts` 脚本保留不动，后续按需迁移到本框架。

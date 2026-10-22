# docker-base-images

存放构建 Pi Work 相关 Docker 基础镜像的 Dockerfile。每个子目录是一个镜像定义，
目录名即 tag 后缀（`node24-dev/Dockerfile` → `piwork-base:node24-dev`），
`build.sh` 按目录名构建。

## 镜像清单

| 镜像 | Dockerfile | 说明 |
| --- | --- | --- |
| `piwork-base:node24-dev` | [`node24-dev/Dockerfile`](node24-dev/Dockerfile) | Node 24（bookworm-slim）+ Python 3 + Git + build-essential/cmake 等基础开发工具；可直接作为根目录 `Dockerfile` 的 `BASE_IMAGE` |

## 网络与代理（这台机器实测结论）

宿主机是 WSL2 + **Mirrored** 网络模式，代理只监听 `127.0.0.1:7897`：

- **镜像层拉取**由 Docker daemon 的代理配置负责（`docker info` 里已有 `HTTP Proxy`），一般不用管。
- **BuildKit 的 RUN 步骤**（apt、corepack 下载 pnpm）默认在 bridge 网络里，实测：
  - 直连 `deb.debian.org` / `registry.npmjs.org` / `nodejs.org` **超时不通**（只有 github.com 能通）；
  - `host.docker.internal`（= `172.17.0.1`）→ **Connection refused**，`--add-host=...:host-gateway` 同样不通。
- 唯一可用组合：**`--network host` + `http://127.0.0.1:7897`**。`build.sh` 已默认这样传；
  代理不在跑、或本来就能直连的机器上，用 `PROXY= NETWORK= ./build.sh xxx` 跑纯默认路径（不传代理也不传 `--network`）。

Dockerfile 只把代理声明成 `ARG HTTP_PROXY/HTTPS_PROXY/NO_PROXY`，不写进最终镜像的 `ENV`；
apt 代理临时写进 `/etc/apt/apt.conf.d/99-build-proxy` 并在同一层删除。

代理没在跑（或者换了机器）时：`PROXY=http://127.0.0.1:7890 ./build.sh node24-dev`。

## 用法

```bash
cd docker-base-images
./build.sh                 # 构建全部
./build.sh node24-dev      # 构建指定镜像
```

常用覆盖项（都是环境变量）：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PROXY` | `http://127.0.0.1:7897` | 传给构建的 `HTTP(S)_PROXY` |
| `NO_PROXY` | `localhost,127.0.0.1,::1` | 免代理地址 |
| `NETWORK` | `host` | BuildKit 容器网络，置空则用默认 bridge |
| `UPSTREAM_IMAGE` | 空（用 Dockerfile 里的 `node:24-bookworm-slim`） | 换上游基础镜像/镜像站 |
| `PNPM_VERSION` | 空（Dockerfile 里 `11.5.2`） | corepack 预热的 pnpm 版本 |
| `COREPACK_NPM_REGISTRY` / `NPM_REGISTRY` | 空（走 `registry.npmjs.org`） | 需手工补 `--build-arg`，只影响 corepack 预热层 |
| `PUSH` / `IMAGE_REGISTRY` | 空 | 构建后打 tag 并推送 |

忽略缓存全量重建：给 buildx 追加 `--no-cache`（或复制下面的手动命令）。

```bash
docker buildx build --no-cache --network host \
  --build-arg HTTP_PROXY=http://127.0.0.1:7897 \
  --build-arg HTTPS_PROXY=http://127.0.0.1:7897 \
  -t piwork-base:node24-dev -f node24-dev/Dockerfile node24-dev
```

## 用这些基础镜像构建 pi-work

根目录 `Dockerfile` 的三个阶段都吃 `BASE_IMAGE`，直接指过来即可：

```bash
cd /home/alone/p/pi-work
docker buildx build --network host \
  --build-arg HTTP_PROXY=http://127.0.0.1:7897 \
  --build-arg HTTPS_PROXY=http://127.0.0.1:7897 \
  --build-arg BASE_IMAGE=piwork-base:node24-dev \
  --build-arg COREPACK_HOME=/usr/local/corepack \
  -t pi-work:base .
```

代理参数照样要传：根目录 `Dockerfile` 没声明 `ARG HTTP_PROXY`，但 Docker 保留名会自动注入到 RUN 环境
（实测可用）；`--network host` 也必需，否则 corepack 下载 pnpm 会超时。

`COREPACK_HOME` 是新加的参数（默认 `/root/.cache/node/corepack`）：本基础镜像把 corepack 缓存固定在
`/usr/local/corepack`，要告诉根目录的 `Dockerfile` 去哪里修 `gyp_main.py` 的执行位。

走 compose 时，`docker-compose.yml` 里只映射了 `BASE_IMAGE`，代理要自己补进 `build.args`，
构建网络则通过 Compose 的 `build.network: host` 配置：

```yaml
    build:
      context: .
      network: host
      args:
        BASE_IMAGE: ${BASE_IMAGE:-node:24-bookworm-slim}
        COREPACK_HOME: ${COREPACK_HOME:-/root/.cache/node/corepack}
        HTTP_PROXY: ${HTTP_PROXY:-http://127.0.0.1:7897}
        HTTPS_PROXY: ${HTTPS_PROXY:-http://127.0.0.1:7897}
```

基础镜像已经满足根目录 `Dockerfile` 对 `BASE_IMAGE` 的两条硬性要求（Node >= 22 + corepack、
python3/make/g++），那几个阶段的 `apt-get install python3 make g++` 会因为依赖已满足直接跳过
（实测 21 秒 vs 裸镜像的几分钟）；额外提供的 git/curl/rg/vim 也方便在容器里直接排查问题。

已验证（本机制成的实物）：最新基础镜像及使用它的 `pi-work:base` 全量构建通过
（包括 better-sqlite3 / node-pty 源码编译、Next.js 编译和 TypeScript 检查）。
此前版本已验证容器内 `next start` 能启动并返回 307 → `/login`；
最新版本的容器启动冒烟命令被执行权限拒绝，尚未重新验证。
Shell 语法检查（`bash -n build.sh`）通过。默认 `node:24-bookworm-slim` 和 Compose 构建路径尚未重新验证。

只想起个开发容器时用：

```bash
docker run --rm -it --network host -v "$PWD":/app -w /app piwork-base:node24-dev bash
```

## 新增镜像的约定

1. 新建 `<name>/Dockerfile`，`build.sh` 会自动产出 `piwork-base:<name>`；目录就是构建上下文，
   只放该镜像需要的文件（不要往这里塞大文件，上下文即缓存 key）。
2. 上游镜像通过 `ARG UPSTREAM_IMAGE` 声明，方便换镜像站。
3. 需要外网的步骤只走 `ARG` 代理，不要硬编码 `127.0.0.1:7897` 到镜像内容里。
4. 最后一个 `RUN` 做自检（打印关键工具版本），构建成功即代表镜像可用。
5. 在本文件的「镜像清单」补一行。
6. `FROM` 之后的 `ARG` 位置会参与层缓存 key：把它插在一个已存在的 RUN 之前，那一层及其后续会全部重跑
   （apt 层实测代价：6 分钟 / 300MB）。需要新增可调参数时，尽量放在真正使用它的 RUN 前面，
   或者放到文件末尾／另一个阶段里。

## 体积与取舍

- `piwork-base:node24-dev` ≈ 1.25GB（上游 `node:24-bookworm-slim` 本身只占很小一部分，
  build-essential/cmake/vim-nox/python3-pip 这套开发工具链占了大头）。
- 用它当 `BASE_IMAGE` 构建出的 `pi-work:base` ≈ 2.59GB，比 `node:24-bookworm-slim` 直出的 `pi-work:slim`（≈1.67GB）大一圈——
  runtime 阶段继承了完整工具链。要出小镜像就继续用默认 `BASE_IMAGE`，要「跑起来就能排障」就用这个。
- 构建期 npm 大包（next / monaco-editor / echarts 等）经代理偶发 `error (23)` 重试，实测仍能在 6 分钟内装完；
  要更稳可以自己给 `pnpm install` 前补一条 npm registry 指向 npmmirror。

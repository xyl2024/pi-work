#
# piwork-base:node24-dev — Node 24 + Python3 + Git + 基础开发工具
#
# 定位：既能当 pi-work 的多阶段构建基础镜像（覆盖根目录 Dockerfile 的
# builder / prod-deps / runtime 三个阶段），也能当日常开发调试容器。
#
# 要求（与根目录 Dockerfile 的约定一致）：
#   - Node >= 22 + corepack（pi-work 用 package.json 的 packageManager 取 pnpm）
#   - python3 + make + g++（better-sqlite3 / node-pty 要源码编译原生模块）
#
# 构建（国内网络必须走宿主机 7897 代理，详见 ../README.md）：
#   ./build.sh node24-dev
# 手动等价命令：
#   docker buildx build --network host \
#     --build-arg HTTP_PROXY=http://127.0.0.1:7897 \
#     --build-arg HTTPS_PROXY=http://127.0.0.1:7897 \
#     -t piwork-base:node24-dev -f node24-dev/Dockerfile node24-dev
#
# 需要忽略缓存全量重建时追加：--no-cache

# 上游基础镜像。换镜像站时覆盖，例如：
#   --build-arg UPSTREAM_IMAGE=docker.m.daocloud.io/library/node:24-bookworm-slim
ARG UPSTREAM_IMAGE=node:24-bookworm-slim

FROM ${UPSTREAM_IMAGE}

# ---- 构建期代理（不进最终镜像 env，只有 apt 配置落盘且随后删除）----
# 小写形式同样声明：Docker/buildx 保留名字会注入大写形式，
# 不声明小写就拿不到宿主机的代理。
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ARG NO_PROXY
ARG no_proxy

LABEL org.opencontainers.image.title="piwork-base" \
      org.opencontainers.image.description="Node 24 + Python 3 + Git + build toolchain, ready for pi-work native modules" \
      org.opencontainers.image.source="pi-work/docker-base-images"

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Shanghai \
    LANG=C.UTF-8 \
    NEXT_TELEMETRY_DISABLED=1 \
    # 固定 corepack/pnpm 落盘位置：后续把缓存目录设成只读卷或换 HOME 时不会失效
    COREPACK_HOME=/usr/local/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1

# ============================================================
# 开发工具链
# ============================================================
# --no-install-recommends 只装显式列出的包，避免 apt 把 doc/依赖树拖进来；
# 失败时清理 apt 代理配置，方便重试。
RUN set -eux; \
    if [ -n "${HTTPS_PROXY}${HTTP_PROXY}${https_proxy}${http_proxy}" ]; then \
        printf 'Acquire::http::Proxy "%s";\nAcquire::https::Proxy "%s";\n' \
            "${HTTP_PROXY:-${http_proxy:-${HTTPS_PROXY:-$https_proxy}}}" "${HTTPS_PROXY:-${https_proxy:-${HTTP_PROXY:-$http_proxy}}}" \
            > /etc/apt/apt.conf.d/99-build-proxy; \
    fi; \
    trap 'rm -f /etc/apt/apt.conf.d/99-build-proxy' EXIT; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        gnupg \
        locales \
        tzdata \
        command-not-found \
        git \
        openssh-client \
        python3 \
        python3-pip \
        python3-venv \
        build-essential \
        pkg-config \
        make \
        cmake \
        g++ \
        patch \
        curl \
        wget \
        vim-nox \
        nano \
        less \
        procps \
        htop \
        iproute2 \
        iputils-ping \
        dnsutils \
        lsof \
        rsync \
        unzip \
        zip \
        jq \
        ripgrep \
        fd-find; \
    ln -sf /usr/bin/fdfind /usr/local/bin/fd; \
    localedef -i C -f UTF-8 C.UTF-8 || true; \
    rm -rf /var/lib/apt/lists/*

# ============================================================
# corepack / pnpm 预热
# ============================================================
# node 镜像自带 corepack，但不会自动 enable；enable 后 pnpm/yarn 版本仍按
# 各项目 package.json 的 "packageManager" 解析，所以这里只预热一个稳定版，
# 让无 packageManager 的场景和离线首跑也能直接用。
# published pnpm tarball 里 node-gyp 的 gyp_main.py 是 0644，node-gyp 重新生成
# Makefile 时会 "Permission denied"，这里一次性修好。
#
# 下面的 ARG 故意放在 apt 层之后：FROM 之后的 ARG 位置会参与层缓存 key，
# 改这些值只重跑 corepack 层，不会拖着重下 300MB apt 包。
# corepack prepare 只接受精确版本，不接受 10/11 这种 range。
ARG PNPM_VERSION=11.5.2
# npm 源：默认 registry.npmjs.org（经代理可达，但大包偶发重试）；网络差时覆盖成镜像站。
# 只在本次 RUN 里使用，npm config 写的 /root/.npm 随后删掉，不会留在镜像里。
ARG COREPACK_NPM_REGISTRY=https://registry.npmjs.org
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN set -eux; \
    export COREPACK_NPM_REGISTRY="${COREPACK_NPM_REGISTRY}"; \
    npm config set registry "${NPM_REGISTRY}"; \
    corepack enable; \
    corepack prepare "pnpm@${PNPM_VERSION}" --activate; \
    pnpm --version; \
    find /usr/local/corepack -path '*node-gyp/gyp/gyp_main.py' -exec chmod +x {} + ; \
    rm -rf /root/.cache /root/.npm /tmp/*

# ============================================================
# 自检
# ============================================================
RUN set -eux; \
    node --version; \
    python3 --version; \
    git --version; \
    g++ --version | head -1; \
    cmake --version | head -1; \
    jq --version; \
    rg --version | head -1; \
    fd --version; \
    pnpm --version

WORKDIR /app

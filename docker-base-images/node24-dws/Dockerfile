#
# piwork-base:node24-dws — node24-dev + DingTalk Workspace CLI (dws) + 其 Agent Skills
#
# 增量镜像：FROM piwork-base:node24-dev（见 ../node24-dev/Dockerfile）。
# 构造顺序（build.sh 按目录名顺序构建，node24-dev 先于 node24-dws）。
#
# 装了什么：
#   - dws 二进制 → /usr/local/bin/dws（官方 install.sh，linux/amd64 预编译包）
#   - Agent Skills（multi 布局，dingtalk-* 逐产品）→ /opt/dws-home/.agents/skills
#   - /usr/local/bin/piwork-entrypoint.sh：容器启动时把上面这套 skills 播种到 $HOME，
#     然后 exec 原始 CMD。
#
# 为什么要播种：pi-work 的运行容器把宿主机目录挂到 /root（HOME），镜像里放在
# /root/.agents/skills 的内容会被挂载点整个盖掉。所以 skills 在镜像里落在
# /opt/dws-home，运行时再由 entrypoint 补进 $HOME/.agents/skills（已存在的不覆盖）。
#
# 构建（国内网络必须走宿主机 7897 代理，详见 ../README.md）：
#   ./build.sh node24-dws

ARG BASE_IMAGE=piwork-base:node24-dev

FROM ${BASE_IMAGE}

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ARG NO_PROXY
ARG no_proxy

LABEL org.opencontainers.image.title="piwork-base" \
      org.opencontainers.image.description="node24-dev + DingTalk Workspace CLI (dws) with agent skills" \
      org.opencontainers.image.source="pi-work/docker-base-images"

# 安装器要用的可调参数，放在真正使用它的 RUN 之前。
# DWS_VERSION=latest 时随构建日期变化，需要可复现时传具体版本（如 v1.0.7）。
ARG DWS_VERSION=latest
ARG DWS_SKILL_MODE=multi
ARG DWS_INSTALL_SCRIPT_URL=https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.sh

# 独立 HOME：让 install.sh 把 skills/状态写在这里，而不是 /root，
# 也不会污染运行时的 $HOME 挂载卷。
ENV DWS_SKILLS_HOME=/opt/dws-home

RUN set -eux; \
    curl -fsSL "${DWS_INSTALL_SCRIPT_URL}" -o /tmp/dws-install.sh; \
    HOME="${DWS_SKILLS_HOME}" \
    DWS_INSTALL_DIR=/usr/local/bin \
    DWS_VERSION="${DWS_VERSION}" \
    DWS_SKILL_MODE="${DWS_SKILL_MODE}" \
    sh /tmp/dws-install.sh; \
    rm -f /tmp/dws-install.sh; \
    rm -rf "${DWS_SKILLS_HOME}"/.cache "${DWS_SKILLS_HOME}"/.npm

COPY entrypoint.sh /usr/local/bin/piwork-entrypoint.sh
RUN chmod +x /usr/local/bin/piwork-entrypoint.sh

# 自检：二进制可用 + skills 数量非零
RUN set -eux; \
    dws version; \
    count="$(find "${DWS_SKILLS_HOME}/.agents/skills" -maxdepth 2 -name SKILL.md | wc -l)"; \
    echo "dws skills: ${count}"; \
    [ "${count}" -gt 0 ]

WORKDIR /app

ENTRYPOINT ["/usr/local/bin/piwork-entrypoint.sh"]
CMD ["bash"]

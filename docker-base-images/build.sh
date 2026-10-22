#!/usr/bin/env bash
# 构建 docker-base-images 下的基础镜像。
#
#   ./build.sh                    # 构建全部
#   ./build.sh node24-dev         # 只构建某个（可给多个名字）
#   PUSH=1 ./build.sh             # 预留：构建后 push（需自己补 IMAGE_REGISTRY）
#
# 国内网络：容器内直连 deb.debian.org / registry.npmjs.org 不通，必须走宿主机的
# HTTP 代理；WSL2 是 Mirrored 网络模式，代理只在 127.0.0.1 上监听，所以 BuildKit
# 的 RUN 步骤要用 --network host 才能访问到它（host.docker.internal 走不通）。
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

PROXY="${PROXY-http://127.0.0.1:7897}"
NO_PROXY="${NO_PROXY-localhost,127.0.0.1,::1}"
NETWORK="${NETWORK-host}"          # 设成 NETWORK= 空值可跳过 --network host
UPSTREAM_IMAGE="${UPSTREAM_IMAGE:-}" # 需要换镜像站时填，如 docker.m.daocloud.io/library/node:24-bookworm-slim
PNPM_VERSION="${PNPM_VERSION:-}"     # 覆盖 corepack 预热的 pnpm 版本

build_one() {
  local name="$1" tag piargs=()
  tag="piwork-base:${name}"
  piargs=(--build-arg "HTTP_PROXY=${PROXY}" --build-arg "HTTPS_PROXY=${PROXY}"
          --build-arg "NO_PROXY=${NO_PROXY}")
  if [ -n "$UPSTREAM_IMAGE" ]; then piargs+=(--build-arg "UPSTREAM_IMAGE=${UPSTREAM_IMAGE}"); fi
  if [ -n "$PNPM_VERSION" ]; then piargs+=(--build-arg "PNPM_VERSION=${PNPM_VERSION}"); fi

  local netargs=()
  if [ -n "$NETWORK" ]; then netargs=(--network "$NETWORK"); fi

  echo "==> ${tag}  (proxy=${PROXY}, network=${NETWORK:-default})"
  docker buildx build "${netargs[@]}" "${piargs[@]}" \
    -t "$tag" -f "${name}/Dockerfile" "${name}"

  if [ "${PUSH:-0}" = "1" ]; then
    if [ -z "${IMAGE_REGISTRY:-}" ]; then echo "PUSH=1 需要设置 IMAGE_REGISTRY" >&2; exit 1; fi
    docker tag "$tag" "${IMAGE_REGISTRY}/${tag}"
    docker push "${IMAGE_REGISTRY}/${tag}"
  fi
}

if [ "$#" -gt 0 ]; then
  for n in "$@"; do
    [ -f "${n}/Dockerfile" ] || { echo "找不到 ${n}/Dockerfile" >&2; exit 1; }
    build_one "$n"
  done
else
  for d in */; do
    if [ -f "${d}Dockerfile" ]; then build_one "${d%/}"; fi
  done
fi

echo
docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}' | grep -E 'piwork-base|REPOSITORY' || true

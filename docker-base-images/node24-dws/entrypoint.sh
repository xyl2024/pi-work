#!/bin/sh
# 把镜像内置的 dws skills 播种到当前 $HOME，再 exec 原始 CMD。
# 目标目录里已存在的同名 skill 不会被覆盖（用户在运行时 `dws skill setup` 过的版本优先）。
set -e

SOURCE="${DWS_SKILLS_HOME:-/opt/dws-home}/.agents/skills"
TARGETS="${HOME:-/root}/.agents/skills ${HOME:-/root}/.pi/agent/skills"

if [ -d "$SOURCE" ]; then
  for target in $TARGETS; do
    mkdir -p "$target"
    for skill in "$SOURCE"/*; do
      [ -d "$skill" ] || continue
      name="$(basename "$skill")"
      [ -e "$target/$name" ] && continue
      cp -a "$skill" "$target/$name"
    done
  done
fi

exec "$@"

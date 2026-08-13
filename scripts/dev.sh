#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE=${EASYPIC_ENV_FILE:-"$ROOT_DIR/.env.local"}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "找不到本地配置文件：$ENV_FILE" >&2
  echo "请复制 .env.local.example 为 .env.local，并填写本地配置。" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

required_variables=(
  EASYPIC_DB
  EASYPIC_SESSION_SECRET
  EASYPIC_ADMIN_PASSWORD
)

for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "本地配置缺少必填项：$variable_name" >&2
    exit 1
  fi
done

if [[ "$EASYPIC_DB" != /* ]]; then
  EASYPIC_DB="$ROOT_DIR/$EASYPIC_DB"
fi
export EASYPIC_DB
export PORT=3000

mkdir -p "$(dirname "$EASYPIC_DB")"

cd "$ROOT_DIR"

echo "正在构建本地依赖…"
pnpm --filter @easypic/database build
pnpm --filter @easypic/ncp-parser build
pnpm --filter @easypic/image-engine build
pnpm --filter @easypic/api-server build

child_pids=()
cleaned_up=false

cleanup() {
  if [[ "$cleaned_up" == true ]]; then
    return
  fi
  cleaned_up=true
  trap - INT TERM EXIT

  if ((${#child_pids[@]} > 0)); then
    kill -TERM "${child_pids[@]}" 2>/dev/null || true
    wait "${child_pids[@]}" 2>/dev/null || true
  fi
}

trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM
trap cleanup EXIT

pnpm --filter @easypic/api-server start &
child_pids+=("$!")

pnpm --dir packages/web-app exec vite --host 127.0.0.1 --port 5173 &
child_pids+=("$!")

pnpm --dir packages/admin-app exec vite --host 127.0.0.1 --port 5174 &
child_pids+=("$!")

echo
echo "EasyPic 本地服务已启动："
echo "  API：http://127.0.0.1:3000/api/health"
echo "  公开站：http://127.0.0.1:5173/"
echo "  管理后台：http://127.0.0.1:5174/admin/"
echo "  SQLite：$EASYPIC_DB"
echo
echo "按 Ctrl+C 停止全部服务。"

set +e
wait -n "${child_pids[@]}"
status=$?
set -e

cleanup
exit "$status"

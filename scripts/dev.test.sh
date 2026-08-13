#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/easypic-dev-test.XXXXXX")

cleanup() {
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local file=$1
  local expected=$2
  grep -F "$expected" "$file" >/dev/null || fail "expected '$expected' in $file"
}

test_missing_env_file_fails() {
  local output="$TEST_DIR/missing-env.out"
  if EASYPIC_ENV_FILE="$TEST_DIR/missing.env" bash "$ROOT_DIR/scripts/dev.sh" >"$output" 2>&1; then
    fail "missing environment file should fail"
  fi
  assert_contains "$output" "找不到本地配置文件"
}

test_missing_required_variable_fails() {
  cat >"$TEST_DIR/incomplete.env" <<EOF
EASYPIC_DB=.data/test.sqlite
EASYPIC_SESSION_SECRET=test-session-secret
EOF
  local output="$TEST_DIR/missing-variable.out"
  if EASYPIC_ENV_FILE="$TEST_DIR/incomplete.env" bash "$ROOT_DIR/scripts/dev.sh" >"$output" 2>&1; then
    fail "missing required variable should fail"
  fi
  assert_contains "$output" "本地配置缺少必填项：EASYPIC_ADMIN_PASSWORD"
}

write_fake_pnpm() {
  mkdir -p "$TEST_DIR/bin"
  cat >"$TEST_DIR/bin/pnpm" <<'FAKE_PNPM'
#!/usr/bin/env bash
set -euo pipefail

echo "$*" >>"$PNPM_LOG"

run_service() {
  local name=$1
  echo "started:$name" >>"$SERVICE_LOG"
  trap 'echo "stopped:'"$name"'" >>"$SERVICE_LOG"; exit 0' TERM INT
  if [[ "${FAKE_EXIT_SERVICE:-}" == "$name" ]]; then
    sleep 0.2
    exit 7
  fi
  while :; do sleep 1; done
}

case "$*" in
  "--filter @easypic/database build"|\
  "--filter @easypic/ncp-parser build"|\
  "--filter @easypic/image-engine build"|\
  "--filter @easypic/api-server build")
    exit 0
    ;;
  "--filter @easypic/api-server start")
    printf '%s\n' "$EASYPIC_DB|$EASYPIC_SESSION_SECRET|$EASYPIC_ADMIN_USERNAME|$EASYPIC_ADMIN_PASSWORD|$EASYPIC_COOKIE_SECURE" >"$API_ENV_LOG"
    run_service api
    ;;
  "--dir packages/web-app exec vite --host 127.0.0.1 --port 5173")
    run_service web
    ;;
  "--dir packages/admin-app exec vite --host 127.0.0.1 --port 5174")
    run_service admin
    ;;
  *)
    echo "unexpected pnpm invocation: $*" >&2
    exit 64
    ;;
esac
FAKE_PNPM
  chmod +x "$TEST_DIR/bin/pnpm"
}

test_builds_starts_and_cleans_up_services() {
  write_fake_pnpm
  cat >"$TEST_DIR/local.env" <<EOF
EASYPIC_DB=.data/test.sqlite
EASYPIC_SESSION_SECRET=test-session-secret
EASYPIC_ADMIN_USERNAME=admin
EASYPIC_ADMIN_PASSWORD=test-password
EASYPIC_COOKIE_SECURE=false
EOF

  local output="$TEST_DIR/run.out"
  local pnpm_log="$TEST_DIR/pnpm.log"
  local service_log="$TEST_DIR/services.log"
  local api_env_log="$TEST_DIR/api-env.log"
  local status=0
  PATH="$TEST_DIR/bin:$PATH" \
    PNPM_LOG="$pnpm_log" \
    SERVICE_LOG="$service_log" \
    API_ENV_LOG="$api_env_log" \
    FAKE_EXIT_SERVICE=admin \
    EASYPIC_ENV_FILE="$TEST_DIR/local.env" \
    bash "$ROOT_DIR/scripts/dev.sh" >"$output" 2>&1 || status=$?

  [[ $status -eq 7 ]] || fail "expected failing service status 7, got $status"
  [[ -d "$ROOT_DIR/.data" ]] || fail "expected database directory to be created"

  local expected_builds="$TEST_DIR/expected-builds.log"
  cat >"$expected_builds" <<'EOF'
--filter @easypic/database build
--filter @easypic/ncp-parser build
--filter @easypic/image-engine build
--filter @easypic/api-server build
EOF
  head -n 4 "$pnpm_log" | cmp "$expected_builds" - || fail "build commands did not match"
  [[ "$(grep -Fxc -- '--filter @easypic/api-server start' "$pnpm_log")" -eq 1 ]] || fail "API was not started exactly once"
  [[ "$(grep -Fxc -- '--dir packages/web-app exec vite --host 127.0.0.1 --port 5173' "$pnpm_log")" -eq 1 ]] || fail "web app was not started exactly once"
  [[ "$(grep -Fxc -- '--dir packages/admin-app exec vite --host 127.0.0.1 --port 5174' "$pnpm_log")" -eq 1 ]] || fail "admin app was not started exactly once"
  [[ "$(cat "$api_env_log")" == "$ROOT_DIR/.data/test.sqlite|test-session-secret|admin|test-password|false" ]] || fail "API environment was not loaded or normalized"

  assert_contains "$service_log" "started:api"
  assert_contains "$service_log" "started:web"
  assert_contains "$service_log" "started:admin"
  assert_contains "$service_log" "stopped:api"
  assert_contains "$service_log" "stopped:web"
  assert_contains "$output" "公开站：http://127.0.0.1:5173/"
  assert_contains "$output" "管理后台：http://127.0.0.1:5174/admin/"
}

test_missing_env_file_fails
test_missing_required_variable_fails
test_builds_starts_and_cleans_up_services
echo "dev script tests passed"

#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${PROJECT_ROOT}/backend"
FRONTEND_DIR="${PROJECT_ROOT}/frontend"
RUNTIME_DIR="${PROJECT_ROOT}/.runtime"
LOG_DIR="${PROJECT_ROOT}/logs"
BACKEND_LOG="${LOG_DIR}/fams-backend.log"
FRONTEND_LOG="${LOG_DIR}/fams-frontend.log"
LAUNCHER_LOG="${LOG_DIR}/fams-launcher.log"
BACKEND_PID_FILE="${RUNTIME_DIR}/fams-backend.pid"
FRONTEND_PID_FILE="${RUNTIME_DIR}/fams-frontend.pid"
BACKEND_URL="http://127.0.0.1:4000/health"
FRONTEND_URL="http://127.0.0.1:3000/"
STARTUP_TIMEOUT_SECONDS=60
EXISTING_SERVICE_RETRY_SECONDS=12

mkdir -p "${RUNTIME_DIR}" "${LOG_DIR}"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S %z'
}

log() {
  local message="$1"
  printf '[%s] %s\n' "$(timestamp)" "${message}" | tee -a "${LAUNCHER_LOG}"
}

fail() {
  log "ERROR: $1"
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is missing: $1"
}

remove_stale_pid_file() {
  local pid_file="$1"
  local service_name="$2"
  local recorded_pid=""

  [[ -f "${pid_file}" ]] || return 0
  read -r recorded_pid <"${pid_file}" || true
  if [[ ! "${recorded_pid}" =~ ^[0-9]+$ ]] || ! kill -0 "${recorded_pid}" 2>/dev/null; then
    rm -f "${pid_file}"
    log "Removed stale ${service_name} PID file."
  fi
}

is_backend_healthy() {
  local response
  response="$(curl --silent --show-error --fail --max-time 3 "${BACKEND_URL}" 2>/dev/null)" || return 1
  grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' <<<"${response}" &&
    grep -Eq '"service"[[:space:]]*:[[:space:]]*"fams-backend"' <<<"${response}" &&
    grep -Eq '"schemaVersion"[[:space:]]*:[[:space:]]*"fams\.health\.v1"' <<<"${response}"
}

is_frontend_healthy() {
  local response
  response="$(curl --silent --show-error --fail --max-time 3 "${FRONTEND_URL}" 2>/dev/null)" || return 1
  grep -Fq 'id="root"' <<<"${response}" &&
    grep -Fq '<title>金融资产管理系统 - FAMS</title>' <<<"${response}"
}

is_port_listening() {
  local port="$1"
  ss -H -ltn "sport = :${port}" 2>/dev/null | grep -q .
}

wait_for_health() {
  local service_name="$1"
  local health_function="$2"
  local pid="$3"
  local deadline=$((SECONDS + STARTUP_TIMEOUT_SECONDS))

  while (( SECONDS < deadline )); do
    if "${health_function}"; then
      return 0
    fi
    if ! kill -0 "${pid}" 2>/dev/null; then
      log "${service_name} process exited before becoming healthy."
      return 1
    fi
    sleep 0.5
  done

  log "${service_name} did not become healthy within ${STARTUP_TIMEOUT_SECONDS} seconds."
  return 1
}

wait_for_existing_service_health() {
  local service_name="$1"
  local health_function="$2"
  local port="$3"
  local deadline=$((SECONDS + EXISTING_SERVICE_RETRY_SECONDS))

  log "${service_name} is listening on port ${port}, but its first health probe did not pass; retrying for up to ${EXISTING_SERVICE_RETRY_SECONDS} seconds."
  while (( SECONDS < deadline )); do
    if "${health_function}"; then
      log "${service_name} health check passed after retry; reusing it."
      return 0
    fi
    if ! is_port_listening "${port}"; then
      return 1
    fi
    sleep 0.5
  done

  return 1
}

terminate_process_group() {
  local pid="$1"
  local service_name="$2"

  if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
    log "Rolling back ${service_name} process group ${pid}."
    kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "${pid}" 2>/dev/null || true
    for _ in {1..20}; do
      kill -0 "${pid}" 2>/dev/null || return 0
      sleep 0.25
    done
    kill -KILL -- "-${pid}" 2>/dev/null || kill -KILL "${pid}" 2>/dev/null || true
  fi
}

new_backend_pid=""
new_frontend_pid=""

rollback_on_failure() {
  local exit_code=$?
  if (( exit_code != 0 )); then
    terminate_process_group "${new_frontend_pid}" "frontend"
    terminate_process_group "${new_backend_pid}" "backend"
    [[ -z "${new_frontend_pid}" ]] || rm -f "${FRONTEND_PID_FILE}"
    [[ -z "${new_backend_pid}" ]] || rm -f "${BACKEND_PID_FILE}"
  fi
}
trap rollback_on_failure EXIT

require_command curl
require_command flock
require_command node
require_command setsid
require_command ss

[[ -f "${BACKEND_DIR}/node_modules/tsx/dist/cli.mjs" ]] || fail "Backend dependencies are missing. Run npm install in ${BACKEND_DIR}."
[[ -f "${FRONTEND_DIR}/node_modules/vite/bin/vite.js" ]] || fail "Frontend dependencies are missing. Run npm install in ${FRONTEND_DIR}."

exec 9>"${RUNTIME_DIR}/fams-launcher.lock"
flock -w 130 9 || fail "Another FAMS startup is still running. Please try again later."

log "FAMS startup requested from ${PROJECT_ROOT}."
remove_stale_pid_file "${BACKEND_PID_FILE}" "backend"
remove_stale_pid_file "${FRONTEND_PID_FILE}" "frontend"

if is_backend_healthy; then
  log "Backend is already healthy on port 4000; reusing it."
else
  if is_port_listening 4000; then
    wait_for_existing_service_health "Backend" is_backend_healthy 4000 ||
      fail "Port 4000 is occupied by a service that does not pass the FAMS backend health check."
  else
    log "Starting backend on port 4000."
    (
      exec 9>&-
      cd "${BACKEND_DIR}"
      exec nohup setsid node node_modules/tsx/dist/cli.mjs src/index.ts >>"${BACKEND_LOG}" 2>&1 </dev/null
    ) &
    new_backend_pid=$!
    printf '%s\n' "${new_backend_pid}" >"${BACKEND_PID_FILE}"
    wait_for_health "Backend" is_backend_healthy "${new_backend_pid}" || fail "Backend startup failed. See ${BACKEND_LOG}."
    log "Backend health check passed."
  fi
fi

if is_frontend_healthy; then
  log "Frontend is already healthy on port 3000; reusing it."
else
  if is_port_listening 3000; then
    wait_for_existing_service_health "Frontend" is_frontend_healthy 3000 ||
      fail "Port 3000 is occupied by a service that does not pass the FAMS frontend health check."
  else
    log "Starting frontend on port 3000."
    (
      exec 9>&-
      cd "${FRONTEND_DIR}"
      exec nohup setsid node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3000 --strictPort >>"${FRONTEND_LOG}" 2>&1 </dev/null
    ) &
    new_frontend_pid=$!
    printf '%s\n' "${new_frontend_pid}" >"${FRONTEND_PID_FILE}"
    wait_for_health "Frontend" is_frontend_healthy "${new_frontend_pid}" || fail "Frontend startup failed. See ${FRONTEND_LOG}."
    log "Frontend health check passed."
  fi
fi

log "FAMS is ready at http://localhost:3000/."
trap - EXIT
exit 0

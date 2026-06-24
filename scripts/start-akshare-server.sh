#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/mnt/c/workSpace/financial-asset-manager"
PORT="8000"
LOG_DIR="$PROJECT_DIR/logs"
VENV_DIR="$PROJECT_DIR/.venv-akshare"

cd "$PROJECT_DIR"
mkdir -p "$LOG_DIR"

if ss -ltn "( sport = :$PORT )" | grep -q ":$PORT"; then
  echo "FAMS Akshare server already listening on port $PORT."
  exit 0
fi

PYTHON_BIN="python3"
if [ -x "$VENV_DIR/bin/python" ] && "$VENV_DIR/bin/python" -c "import uvicorn, fastapi, akshare" >/dev/null 2>&1; then
  PYTHON_BIN="$VENV_DIR/bin/python"
fi

"$PYTHON_BIN" -m uvicorn server:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  >> "$LOG_DIR/akshare-server-8000.log" 2>&1

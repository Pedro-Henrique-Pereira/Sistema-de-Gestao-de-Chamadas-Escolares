#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PYTHON="$APP_DIR/.venv/bin/python"

if [ ! -x "$PYTHON" ]; then
  echo "Ambiente virtual ausente. Execute $APP_DIR/instalar.sh."
  exit 1
fi

cd "$APP_DIR"
exec "$PYTHON" "$APP_DIR/main.py" "$@"

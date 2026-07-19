#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/lysimaco-automacao"
VENV_DIR="$APP_DIR/.venv"
DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_FILE="$DESKTOP_DIR/lysimaco-automacao.desktop"
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"

for command_name in python3 rsync; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Dependência ausente: $command_name"
    exit 1
  fi
done

mkdir -p "$APP_DIR" "$DESKTOP_DIR"
rsync -a \
  --exclude ".venv" \
  --exclude "__pycache__" \
  --exclude "*.pyc" \
  --exclude "logs/*.log" \
  --exclude "runtime/whatsapp-profile" \
  --exclude ".git" \
  "$SCRIPT_DIR/" "$APP_DIR/"

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install -r "$APP_DIR/requirements.txt"

sed "s|@APP_DIR@|$APP_DIR|g" "$APP_DIR/LysimacoAutomacao.desktop" > "$DESKTOP_FILE"
chmod u+x "$APP_DIR/launcher.sh" "$APP_DIR/instalar.sh" "$APP_DIR/desinstalar.sh" "$DESKTOP_FILE"
mkdir -p "$APP_DIR/logs" "$APP_DIR/runtime"
chmod -R u+rwX,go-rwx "$APP_DIR/logs" "$APP_DIR/runtime"

if [ -f "$APP_DIR/.env" ]; then
  chmod 600 "$APP_DIR/.env"
else
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "Configure $APP_DIR/.env antes de iniciar a automação."
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi

echo "Instalação concluída em $APP_DIR."
echo "O auto-start permanece desativado até ser habilitado pela interface."

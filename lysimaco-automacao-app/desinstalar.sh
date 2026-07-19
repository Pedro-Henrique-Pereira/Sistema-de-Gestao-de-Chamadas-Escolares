#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/lysimaco-automacao"
DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
AUTOSTART_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/lysimaco-automacao.desktop"

rm -rf -- "$APP_DIR"
rm -f -- "$DESKTOP_DIR/lysimaco-automacao.desktop" "$AUTOSTART_FILE"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi

echo "Lysímaco Automação removido do perfil atual."

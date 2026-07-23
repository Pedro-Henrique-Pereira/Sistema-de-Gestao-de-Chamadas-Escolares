#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${PRODUCTION_APP_DIR:-/opt/lysimaco/app}"
STATE_DIR="${LYSIMACO_STATE_DIR:-/opt/lysimaco/state}"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
TARGET_SHA="${1:-}"

mkdir -p "$STATE_DIR"
if [[ "${LYSIMACO_DEPLOY_LOCK_HELD:-0}" != "1" ]]; then
  exec 9>"$STATE_DIR/deploy.lock"
  if ! flock -n 9; then
    echo "Deploy ou rollback ja esta em andamento." >&2
    exit 1
  fi
fi

if [[ -z "$TARGET_SHA" && -f "$STATE_DIR/previous.sha" ]]; then
  TARGET_SHA="$(tr -d '[:space:]' < "$STATE_DIR/previous.sha")"
fi

if [[ -z "$TARGET_SHA" ]]; then
  echo "Informe o SHA de rollback ou mantenha $STATE_DIR/previous.sha." >&2
  exit 1
fi

cd "$APP_DIR"
git cat-file -e "$TARGET_SHA^{commit}"
git reset --hard "$TARGET_SHA"
docker compose -f "$COMPOSE_FILE" build
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

deadline=$((SECONDS + 240))
for service in mysql backend frontend; do
  status=""
  while (( SECONDS < deadline )); do
    container="$(docker compose -f "$COMPOSE_FILE" ps -q "$service")"
    if [[ -n "$container" ]]; then
      status="$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || true)"
      [[ "$status" == "healthy" ]] && break
      [[ "$status" == "unhealthy" ]] && break
    fi
    sleep 3
  done
  [[ "$status" == "healthy" ]] || {
    echo "Rollback subiu com $service sem saude confirmada." >&2
    exit 1
  }
done

printf '%s\n' "$TARGET_SHA" > "$STATE_DIR/current.sha"
rm -f "$STATE_DIR/pending.sha"
echo "Rollback concluido: $TARGET_SHA"

#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${PRODUCTION_APP_DIR:-/opt/lysimaco/app}"
STATE_DIR="${LYSIMACO_STATE_DIR:-/opt/lysimaco/state}"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
EXPECTED_SHA="${1:-}"

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/deploy.lock"
if ! flock -n 9; then
  echo "Outro deploy ja esta em andamento." >&2
  exit 1
fi

cd "$APP_DIR"
previous_sha="$(git rev-parse HEAD)"

git fetch --prune origin main
target_sha="$(git rev-parse origin/main)"

if [[ -n "$EXPECTED_SHA" && "$EXPECTED_SHA" != "$target_sha" ]]; then
  echo "O SHA recebido ($EXPECTED_SHA) difere de origin/main ($target_sha)." >&2
  exit 1
fi

printf '%s\n' "$previous_sha" > "$STATE_DIR/previous.sha"
printf '%s\n' "$target_sha" > "$STATE_DIR/pending.sha"

wait_for_health() {
  local service container status
  local deadline=$((SECONDS + 240))

  for service in mysql backend frontend; do
    status=""
    while (( SECONDS < deadline )); do
      container="$(docker compose -f "$COMPOSE_FILE" ps -q "$service")"
      if [[ -n "$container" ]]; then
        status="$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || true)"
        [[ "$status" == "healthy" ]] && break
        [[ "$status" == "unhealthy" ]] && return 1
      fi
      sleep 3
    done

    [[ "${status:-}" == "healthy" ]] || return 1
  done
}

deploy_target() {
  git reset --hard "$target_sha" || return 1
  docker compose -f "$COMPOSE_FILE" build --pull || return 1
  docker compose -f "$COMPOSE_FILE" up -d --remove-orphans || return 1
  wait_for_health || return 1
}

echo "Iniciando deploy de $previous_sha para $target_sha"
if ! deploy_target; then
  echo "Deploy falhou; iniciando rollback para $previous_sha." >&2
  LYSIMACO_DEPLOY_LOCK_HELD=1 bash "$APP_DIR/deploy/rollback.sh" "$previous_sha" || {
    echo "Rollback tambem falhou. Intervencao manual necessaria." >&2
    exit 2
  }
  exit 1
fi

printf '%s\n' "$target_sha" > "$STATE_DIR/current.sha"
rm -f "$STATE_DIR/pending.sha"
echo "Deploy concluido: $target_sha"

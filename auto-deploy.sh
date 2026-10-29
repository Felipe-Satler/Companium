#!/usr/bin/env bash
# Auto-deploy do companium: builda + publica quando o commit atual difere do último
# que foi deployado. Diferente da versão antiga (que comparava HEAD com origin/main e por isso
# NÃO enxergava commits feitos DENTRO deste checkout — HEAD já == origin), agora usa um marcador
# `.last-deployed`, então cobre tanto push externo quanto commit local aqui. Idempotente.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_TAG="companium-auto"
LOCK="/tmp/companium-auto-deploy.lock"
MARKER="$REPO_DIR/.last-deployed"
log() { logger -t "$LOG_TAG" "$*"; echo "$*"; }

exec 9>"$LOCK"
flock -n 9 || { log "another auto-deploy running, skipping"; exit 0; }

cd "$REPO_DIR"
git fetch --quiet origin main
LOCAL=$(git rev-parse HEAD)
ORIGIN=$(git rev-parse origin/main)

# Push externo -> sincroniza. Mas SÓ quando o origin está de fato À FRENTE do checkout,
# isto é, quando HEAD é ancestral de origin/main (um fast-forward). O `!=` sozinho também
# dispara quando é o LOCAL que está à frente (commit feito aqui, ainda não enviado) ou quando
# as duas pontas divergiram — nesses casos um `reset --hard` apagaria o commit local. Por isso
# checamos a ancestralidade antes de resetar.
if [[ "$LOCAL" != "$ORIGIN" ]]; then
  if git merge-base --is-ancestor "$LOCAL" "$ORIGIN"; then
    log "external push detected (fast-forward): $LOCAL -> $ORIGIN"
    git reset --hard origin/main
  else
    log "checkout local à frente/divergente do origin ($LOCAL vs $ORIGIN) — NÃO reseta, preservando commit local"
  fi
fi
TARGET=$(git rev-parse HEAD)

LAST=$(cat "$MARKER" 2>/dev/null || echo "none")
if [[ "$TARGET" == "$LAST" ]]; then
  exit 0
fi

log "deploy needed: $LAST -> $TARGET"
log "running deploy.sh"
./deploy.sh
echo "$TARGET" > "$MARKER"
log "auto-deploy done -> $TARGET"

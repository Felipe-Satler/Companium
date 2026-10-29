#!/usr/bin/env bash
# Deploy do companium para nginx local servindo companium.example.com.
# Idempotente, seguro para cron. Não pede senha (depende de /etc/sudoers.d/companium-deploy).
# Uso: ./deploy.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="/var/www/companium/dist"
BACKUP="/var/www/companium/dist.$(date -u +%Y%m%d-%H%M%S).bak"
LOG_TAG="companium-deploy"

log() { echo "==> $*"; logger -t "$LOG_TAG" "$*" || true; }

cd "$REPO_DIR"

# Credenciais Supabase: fonte ÚNICA = /etc/companium-supabase.env. Injetamos no build
# como VITE_* para que o frontend NÃO tenha chave hardcoded e sempre acompanhe a rotação
# feita naquele arquivo. Guard aborta o deploy se a config estiver ausente/vazia (nunca
# publicar um bundle sem chave -> site quebrado).
CENTRAL_ENV="/etc/companium-supabase.env"
if [[ -r "$CENTRAL_ENV" ]]; then
  set -a; # shellcheck disable=SC1090
  . "$CENTRAL_ENV"; set +a
  export VITE_SUPABASE_URL="${SUPABASE_URL:-}"
  export VITE_SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
  export VITE_SUPABASE_PUBLISHABLE_KEY="${SUPABASE_ANON_KEY:-}"
else
  log "AVISO: $CENTRAL_ENV não legível por $(id -un) — usando VITE_* do ambiente/.env"
fi
if [[ -z "${VITE_SUPABASE_URL:-}" || -z "${VITE_SUPABASE_ANON_KEY:-}" ]]; then
  log "ERRO: VITE_SUPABASE_URL/ANON ausentes (confira $CENTRAL_ENV) — abortando deploy"
  exit 1
fi

# npm ci neste ambiente às vezes deixa o node_modules INCOMPLETO (ex.: `vite: not found`,
# exit 127/144, ou o typescript sem suas libs → `lib.es2023.d.ts not found` no `tsc -b`).
# Tornamos robusto: retenta limpando o node_modules entre tentativas, valida que o build TODO
# está presente (vite E tsc E as libs do typescript — não só o vite), e cai em `npm install`
# como último recurso.
deps_complete() {
  [[ -x node_modules/.bin/vite ]] &&
    [[ -x node_modules/.bin/tsc ]] &&
    [[ -f node_modules/typescript/lib/lib.es2023.d.ts ]]
}
install_deps() {
  local attempt
  for attempt in 1 2 3; do
    log "npm ci (tentativa $attempt)"
    if npm ci --no-audit --no-fund && deps_complete; then
      return 0
    fi
    log "node_modules incompleto (vite/tsc/libs ausentes) — limpando e retentando"
    rm -rf node_modules
  done
  log "fallback: npm install"
  npm install --no-audit --no-fund
  deps_complete
}
install_deps || { log "ERRO: falha ao instalar dependências (vite ausente após retries)"; exit 1; }

log "npm run build"
npm run build

[[ -d "$REPO_DIR/dist" ]] || { log "build did not produce dist/"; exit 1; }

# Guard: um `vite build` interrompido às vezes grava TODOS os assets com 0 bytes,
# passa no rsync e derruba o site (tela azul: React não monta). Aborta se qualquer
# JS/CSS saiu vazio, e confirma que o entry referenciado no index.html tem conteúdo.
if find "$REPO_DIR/dist/assets" -maxdepth 1 -type f \( -name '*.js' -o -name '*.css' \) -size 0 | grep -q .; then
  log "ERRO: build gerou asset(s) JS/CSS com 0 bytes — build interrompido, abortando deploy"
  exit 1
fi
entry_js="$(grep -oE '/assets/[A-Za-z0-9_-]+\.js' "$REPO_DIR/dist/index.html" | head -1 || true)"
if [[ -z "$entry_js" || ! -s "$REPO_DIR/dist${entry_js}" ]]; then
  log "ERRO: entry JS ausente/vazio (${entry_js:-nenhum}) no index.html — abortando deploy"
  exit 1
fi

log "pre-compressing assets (.gz + .br)"
cd "$REPO_DIR/dist"
find . -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' -o -name '*.json' \) \
       ! -name '*.gz' ! -name '*.br' -print0 |
  while IFS= read -r -d '' f; do
    gzip   -kf -9    "$f"
    brotli -k  -f -q 11 "$f"
    touch -r "$f" "${f}.gz" "${f}.br"
  done
cd "$REPO_DIR"

log "backup current dist -> $BACKUP"
if [[ -d "$TARGET" ]]; then
  sudo cp -aT "$TARGET" "$BACKUP"
fi

log "rsync dist/ -> $TARGET"
sudo rsync -a --delete "$REPO_DIR/dist/" "$TARGET/"
sudo chown -R www-data:www-data "$TARGET/"

log "nginx -t && reload"
sudo nginx -t
sudo systemctl reload nginx

log "rotating old backups (keep last 5)"
sudo /usr/local/sbin/companium-backup-rotate.sh

log "done. https://companium.example.com/ now serves $(git rev-parse --short HEAD)"

#!/usr/bin/env bash
# Instala o gestao-proxy: unit systemd + location no nginx. Idempotente.
# Rodar como root:  sudo bash /home/deploy/companium/apps/gestao-proxy/install.sh
set -euo pipefail

APP=/home/deploy/companium/apps/gestao-proxy
NGINX_SITE=/etc/nginx/sites-available/companium.example.com
UNIT=/etc/systemd/system/gestao-proxy.service

echo "==> systemd unit"
install -m 644 "$APP/gestao-proxy.service" "$UNIT"
systemctl daemon-reload
systemctl enable --now gestao-proxy.service
sleep 2
systemctl --no-pager --full status gestao-proxy.service | head -4 || true
echo -n "   health local: "; curl -fs http://127.0.0.1:18911/api/gestao/health || echo "FALHOU"; echo

echo "==> nginx location /api/gestao/"
if grep -q "location \^~ /api/gestao/" "$NGINX_SITE"; then
  echo "   já configurado — pulando"
else
  cp -a "$NGINX_SITE" "$NGINX_SITE.bak.$(date -u +%Y%m%d-%H%M%S)"
  awk -v block="$(cat "$APP/companium.gestao.nginx.location")" '
    !ins && /^[[:space:]]*location \/ \{/ { print block; print ""; ins=1 }
    { print }
  ' "$NGINX_SITE" > "$NGINX_SITE.tmp"
  mv "$NGINX_SITE.tmp" "$NGINX_SITE"
  echo "   bloco inserido antes de 'location / {'"
fi
nginx -t
systemctl reload nginx
echo "==> OK. Teste: curl -s https://companium.example.com/api/gestao/health"

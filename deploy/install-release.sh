#!/usr/bin/env bash

set -euo pipefail

release_dir=${1:?Usage: install-release.sh /opt/easypic/releases/<release>}
case "$release_dir" in
  /opt/easypic/releases/*) ;;
  *) echo "Refusing unexpected release path: $release_dir" >&2; exit 64 ;;
esac
[[ -d "$release_dir" ]] || { echo "Release does not exist: $release_dir" >&2; exit 66; }

cd "$release_dir"
/usr/local/bin/pnpm install --frozen-lockfile
/usr/local/bin/pnpm --filter @easypic/database build
/usr/local/bin/pnpm --filter @easypic/ncp-parser build
/usr/local/bin/pnpm --filter @easypic/api-server build

install -d -m 750 /etc/easypic /var/lib/easypic /var/backups/easypic
if [[ ! -f /etc/easypic/easypic.env ]]; then
  session_secret=$(openssl rand -hex 32)
  admin_password=$(openssl rand -hex 18)
  umask 077
  {
    printf 'NODE_ENV=production\n'
    printf 'PORT=3010\n'
    printf 'EASYPIC_DB=/var/lib/easypic/easypic.sqlite\n'
    printf 'EASYPIC_SESSION_SECRET=%s\n' "$session_secret"
    printf 'EASYPIC_ADMIN_USERNAME=admin\n'
    printf 'EASYPIC_ADMIN_PASSWORD=%s\n' "$admin_password"
    printf 'EASYPIC_COOKIE_SECURE=true\n'
    printf 'EASYPIC_COOKIE_PATH=/easypic/\n'
  } > /etc/easypic/easypic.env
  {
    printf 'EasyPic initial administrator\n'
    printf 'Username: admin\n'
    printf 'Password: %s\n' "$admin_password"
  } > /root/easypic-initial-admin.txt
fi
chmod 600 /etc/easypic/easypic.env

set -a
# shellcheck disable=SC1091
source /etc/easypic/easypic.env
set +a
/usr/local/bin/pnpm --filter @easypic/database migrate

ln -sfn "$release_dir" /opt/easypic/current

install -d -m 755 /var/www/easypic
rsync -a --delete packages/web-app/dist/ /var/www/easypic/
install -d -m 755 /var/www/easypic/admin
rsync -a --delete packages/admin-app/dist/ /var/www/easypic/admin/

install -m 644 deploy/nginx/easypic-locations.conf /etc/nginx/snippets/easypic-locations.conf
default_site=/etc/nginx/sites-available/default
if ! grep -Fq 'include snippets/easypic-locations.conf;' "$default_site"; then
  cp -a "$default_site" "$default_site.easypic-predeploy"
  sed -i '/^[[:space:]]*location \/ {/i\    include snippets/easypic-locations.conf;' "$default_site"
fi

nginx -t

chmod 750 deploy/start-api.sh deploy/backup-database.sh
if /usr/local/bin/pm2 describe easypic-api >/dev/null 2>&1; then
  /usr/local/bin/pm2 restart easypic-api --update-env
else
  /usr/local/bin/pm2 start "$release_dir/deploy/start-api.sh" --name easypic-api --interpreter bash --time
fi
/usr/local/bin/pm2 startup systemd -u root --hp /root
/usr/local/bin/pm2 save

install -m 644 deploy/systemd/easypic-backup.service /etc/systemd/system/easypic-backup.service
install -m 644 deploy/systemd/easypic-backup.timer /etc/systemd/system/easypic-backup.timer
systemctl daemon-reload
systemctl enable --now easypic-backup.timer
systemctl reload nginx

for attempt in {1..20}; do
  if curl -fsS http://127.0.0.1:3010/api/health >/dev/null; then
    break
  fi
  if [[ "$attempt" -eq 20 ]]; then
    echo 'EasyPic API did not become healthy within 20 seconds' >&2
    exit 1
  fi
  sleep 1
done
curl -fsS http://127.0.0.1/easypic/api/health >/dev/null
systemctl start easypic-backup.service

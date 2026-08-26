#!/usr/bin/env bash

set -euo pipefail

set -a
# shellcheck disable=SC1091
source /etc/easypic/easypic.env
set +a

backup_dir=/var/backups/easypic
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
destination="$backup_dir/easypic-$timestamp.sqlite"

/usr/local/bin/node /opt/easypic/current/deploy/backup-database.mjs "$EASYPIC_DB" "$destination"
find "$backup_dir" -type f -name 'easypic-*.sqlite' -mtime +14 -delete

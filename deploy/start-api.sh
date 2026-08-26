#!/usr/bin/env bash

set -euo pipefail

set -a
# shellcheck disable=SC1091
source /etc/easypic/easypic.env
set +a

exec /usr/local/bin/node /opt/easypic/current/packages/api-server/dist/start.js

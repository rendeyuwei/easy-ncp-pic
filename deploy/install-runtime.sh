#!/usr/bin/env bash

set -euo pipefail

node_version=v22.23.2
archive="node-$node_version-linux-x64.tar.xz"
expected_sha256=d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307
install_dir="/opt/node-$node_version-linux-x64"
download_path="/tmp/$archive"

if [[ ! -x "$install_dir/bin/node" ]]; then
  curl -fsSL "https://nodejs.org/dist/$node_version/$archive" -o "$download_path"
  printf '%s  %s\n' "$expected_sha256" "$download_path" | sha256sum --check --status
  tar -xJf "$download_path" -C /opt
fi

ln -sfn "$install_dir/bin/node" /usr/local/bin/node
ln -sfn "$install_dir/bin/npm" /usr/local/bin/npm
ln -sfn "$install_dir/bin/npx" /usr/local/bin/npx

"$install_dir/bin/npm" install --global pnpm@9.12.1 pm2

for executable in pnpm pnpx pm2 pm2-dev pm2-docker pm2-runtime; do
  if [[ -x "$install_dir/bin/$executable" ]]; then
    ln -sfn "$install_dir/bin/$executable" "/usr/local/bin/$executable"
  fi
done

/usr/local/bin/node --version
/usr/local/bin/pnpm --version
/usr/local/bin/pm2 --version

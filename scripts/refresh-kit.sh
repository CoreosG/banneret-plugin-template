#!/usr/bin/env bash
set -euo pipefail
ref=${1:?Supply a Banneret Hub release tag or full commit SHA}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q
git -C "$tmp" fetch -q --depth 1 https://github.com/CoreosG/banneret-hub.git "$ref"
for path in src/{index,tasks,memory}.ts checker/{cli,checks}.mjs; do
  mkdir -p "$tmp/kit/$(dirname "$path")"
  git -C "$tmp" show "FETCH_HEAD:packages/banneret-plugin-kit/$path" > "$tmp/kit/$path"
done
git -C "$tmp" show FETCH_HEAD:LICENSE > "$tmp/kit/LICENSE"
git -C "$tmp" rev-parse FETCH_HEAD > "$tmp/kit/REVISION"
cp -R "$tmp/kit/." vendor/kit/

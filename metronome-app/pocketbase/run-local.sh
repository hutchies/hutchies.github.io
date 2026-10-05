#!/bin/sh
# Runs a PocketBase with the metronome sync hooks on this machine, also serving
# the built app, e.g. for a rehearsal room without internet. See README.md.
#
#   ./run-local.sh                    # http://127.0.0.1:8090
#   HTTP=0.0.0.0:8090 ./run-local.sh  # reachable from other devices (needs HTTPS, see README)
set -e
cd "$(dirname "$0")"
PB="${PB:-./pocketbase}"
if [ ! -x "$PB" ]; then
  echo "Put the PocketBase binary (v0.23 or later) here as ./pocketbase, or set PB=/path/to/pocketbase."
  echo "Downloads: https://pocketbase.io/docs/"
  exit 1
fi
(cd .. && npm run build)
exec "$PB" serve --http "${HTTP:-127.0.0.1:8090}" \
  --dir ./pb_data --hooksDir ./pb_hooks --migrationsDir ./pb_migrations --publicDir ../dist

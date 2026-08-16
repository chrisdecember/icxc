#!/bin/bash
# Keep-alive wrapper: the observer logger dies on unhandled ws errors —
# relaunch it forever, noting each restart.
cd "$(dirname "$0")"
while true; do
  echo "[keeper] $(date -u +%FT%TZ) starting metrics-logger" >> logs/metrics-keeper.log
  "$1" metrics-logger.ts gtking gtfingers gtpick gtnetter gttimber gtmule gthawker gtironmn gtarb gtscout gtrune gtvault gtninja1 gtninja2 gtninja3 >> logs/metrics-keeper.log 2>&1
  echo "[keeper] $(date -u +%FT%TZ) metrics-logger exited — restart in 60s" >> logs/metrics-keeper.log
  sleep 60
done

#!/usr/bin/env bash
# Swarm supervisor: keeps every bot's game client + brain alive for 24h ops.
# Checks every 90s; restarts anything dead; logs restarts to logs/supervisor.log.
set -u
BUN=/tmp/claude-0/-home-user-icxc/7e83b91d-3630-55e6-a41e-deeb40323f39/scratchpad/bun-latest/bin/bun
ROOT=/tmp/claude-0/-home-user-icxc/7e83b91d-3630-55e6-a41e-deeb40323f39/scratchpad/rs-sdk
BOTS_FILE=$ROOT/supervisor-bots.txt
LOG=$ROOT/logs/supervisor.log

log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }

log "supervisor started (bots from $BOTS_FILE)"

while true; do
  # Re-read roster each cycle so new bots can be added without restart
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    case "$name" in \#*) continue ;; esac

    if ! pgrep -f "lite/runner.ts $name" > /dev/null 2>&1; then
      log "RESTART client $name"
      ( cd "$ROOT/server/webclient" && nohup "$BUN" src/lite/runner.ts "$name" >> "$ROOT/logs/$name-client.log" 2>&1 & )
      sleep 8   # let the client log in before (re)starting the brain
    fi

    if ! pgrep -f "bots/$name/script.ts" > /dev/null 2>&1; then
      log "RESTART brain $name"
      ( cd "$ROOT" && nohup "$BUN" "bots/$name/script.ts" >> "$ROOT/logs/$name.log" 2>&1 & )
    fi
  done < "$BOTS_FILE"
  sleep 90
done

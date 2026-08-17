#!/bin/bash
# Golden Throne watchdog — relaunches any dead fleet component every 120s.
# Components and launch commands mirror the FIELD-MANUAL. Survives within
# a container's life; the pulse's ps-check remains the cross-restart net.
RS="/tmp/claude-0/-home-user-icxc/7e83b91d-3630-55e6-a41e-deeb40323f39/scratchpad/rs-sdk"
BUN="/tmp/claude-0/-home-user-icxc/7e83b91d-3630-55e6-a41e-deeb40323f39/scratchpad/bun-latest/bin/bun"
LOG="$RS/logs/watchdog.log"

note() { echo "$(date -u +%FT%TZ) $1" >> "$LOG"; }

ensure() { # ensure <grep-pattern> <label> <workdir> <cmd...>
  local pat="$1" label="$2" dir="$3"; shift 3
  if ! pgrep -f "$pat" > /dev/null 2>&1; then
    note "RESTART $label"
    ( cd "$dir" && BUN_OPTIONS=--smol nohup "$@" >> "$RS/logs/$label.log" 2>&1 & )
  fi
}

note "watchdog online"
while true; do
  ensure "lite/lawswarm.ts gtlaw" lawswarm "$RS/server/webclient" \
    "$BUN" src/lite/lawswarm.ts gtlaw02 gtlaw06 gtlaw03 gtlaw05 gtlaw08 gtlaw09 gtlaw10 gtlaw11 gtlaw12 gtlaw13
  ensure "lite/mankickers.ts mankicker" mankickers "$RS/server/webclient" \
    "$BUN" src/lite/mankickers.ts mankicker1 mankicker2 mankicker3 mankicker4 mankicker5 mankicker6 mankicker7 mankicker8 mankicker9 mankicker10 mankicker11 mankicker12 mankicker13 mankicker14
  ensure "runner.ts gtvault" gtvault-client "$RS/server/webclient" "$BUN" src/lite/runner.ts gtvault
  ensure "bots/gtvault/script.ts" gtvault "$RS" "$BUN" bots/gtvault/script.ts
  for u in gtlaw15 gtlaw07 gtlaw14 gtlaw01 gtlaw04 gtlaw16; do
    ensure "runner.ts $u" "$u-client" "$RS/server/webclient" "$BUN" src/lite/runner.ts "$u"
    ensure "bots/$u/script.ts" "$u" "$RS" "$BUN" "bots/$u/script.ts"
  done
  sleep 120
done

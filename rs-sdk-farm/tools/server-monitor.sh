#!/bin/bash
# Server recovery monitor — tests login server every 30s.
# When it comes back, kills fleet processes to force clean restart via watchdog.
RS="/tmp/claude-0/-home-user-icxc/7e83b91d-3630-55e6-a41e-deeb40323f39/scratchpad/rs-sdk"
BUN="/tmp/claude-0/-home-user-icxc/7e83b91d-3630-55e6-a41e-deeb40323f39/scratchpad/bun-latest/bin/bun"
LOG="$RS/logs/server-monitor.log"

note() { echo "$(date -u +%FT%TZ) $1" >> "$LOG"; }

note "server-monitor started — checking login server every 30s"

while true; do
    result=$(cd "$RS/server/webclient" && timeout 12 $BUN -e "
import { startSession } from './src/lite/session.js';
try {
  const s = await startSession({ username: 'gtprobe', password: 'gtprobe', host: 'rs-sdk-demo.fly.dev' });
  process.stdout.write('LOGINOK');
  s.stop();
} catch(e) {
  process.stdout.write('LOGINFAIL');
}
process.exit(0);
" 2>/dev/null | grep -o 'LOGIN[A-Z]*' | head -1)

    if [[ "$result" == "LOGINOK" ]]; then
        note "LOGIN SERVER BACK ONLINE — triggering fleet restart"
        pkill -f "lite/lawswarm.ts gtlaw" 2>/dev/null
        sleep 2
        pkill -f "lite/mankickers.ts mankicker" 2>/dev/null
        sleep 2
        pkill -f "runner.ts gt" 2>/dev/null
        sleep 2
        for u in gtlaw15 gtlaw07 gtlaw14 gtlaw01 gtlaw04 gtlaw16; do
            pkill -f "bots/$u/script.ts" 2>/dev/null
        done
        sleep 2
        pkill -f "bots/gtvault/script.ts" 2>/dev/null
        sleep 1
        pkill -f "bots/gticeprobe/script.ts" 2>/dev/null

        note "fleet processes killed — watchdog will relaunch in ~120s"
        note "server-monitor job done — exiting"
        exit 0
    else
        note "login server still down"
    fi
    sleep 30
done

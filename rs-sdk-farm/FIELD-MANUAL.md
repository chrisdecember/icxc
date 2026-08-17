# Operation Golden Throne — Field Manual

Everything learned building and operating an autonomous bot farm on rs-sdk
(MaxBittker/rs-sdk, a TypeScript bot SDK for a 2004scape/LostCity RuneScape
emulator). This is the institutional memory of ~23 lawswarm versions, a
disruptor swarm, a banking pipeline, and every bug that cost us hours.
Read this before writing a single line of bot code.

---

## 1. Mission

- **Law rune monopoly**: kill dark wizards (they drop 3x law runes at 1/128)
  at the circle south of Varrock, funnel every rune through one vault bot,
  bank the stockpile, and run a buying desk so *all* laws flow through us.
- **Market disruption**: 8 "mankicker" bots kick/punch every Man/Woman in
  Lumbridge to deny pickpocket targets to rival thief bots.
- **Doctrine**: combat units train Defensive (Block) until Defence ~50,
  then switch to kick/punch styles.

## 2. Infrastructure

### Paths (session-specific, re-derive on new containers)
- rs-sdk checkout: `$SCRATCHPAD/rs-sdk` (aliased `$RS`)
- Bun 1.3.14: `$SCRATCHPAD/bun-latest/bin/bun` (run with `BUN_OPTIONS=--smol`)
- Swarm sources live in `$RS/server/webclient/src/lite/`
- SDK bot scripts live in `$RS/bots/<name>/script.ts`
- Canonical backups of swarm tools: `rs-sdk-farm/tools/` in this repo —
  **always backport + commit + push after every deployed change.**

### Gateway
- `wss://rs-sdk-demo.fly.dev/gateway` pairs SDK brains with game clients.

### SDK-bot gotchas (learned via gticeprobe)
- Every bot dir needs a `bot.env` (BOT_USERNAME, PASSWORD, SERVER=
  rs-sdk-demo.fly.dev, SHOW_CHAT, TELEMETRY) or the lite runner exits
  ENOENT. New usernames auto-register on first login.
- `state.player.x/z` are **128-per-tile scene coords** — use
  `player.worldX/worldZ` for map position. NPC/loc/groundItem coords in
  state ARE world coords already.
- `bot.walkTo` fails cleanly across plane boundaries ("Destination is
  unreachable — may be underground"): descend/ascend first, then walk.
- A fresh account spawns with 10 HP — anything aggressive kills it in
  seconds. Probes are disposable but plan hops around aggro clusters.

### Two ways to run bots
1. **SDK bot** (`bots/<name>/script.ts` via `sdk/runner`): full high-level
   API — `bot.walkTo` (real pathfinding), `bot.pickupItem`, banking, trading,
   `sdk.findGroundItem`, `waitForTicks`. One process per bot. Use for
   anything needing banking/trading/long-distance travel (gtvault).
2. **Lite swarm** (`src/lite/*.ts`): N `LiteClient`s in ONE Bun process,
   ~14MB/bot. Tick-driven: `BotStateCollector` produces a `BotWorldState`
   per tick, your `think(state)` emits at most one `BotAction` via an
   `ActionExecutor`. Cheap to scale, but **crippled navigation** (see §5)
   and no banking/trading. Use for massed combat/disruption.

### Launch / kill discipline
- Launch: `cd $RS/server/webclient && nohup $BUN src/lite/lawswarm.ts gtlaw01 ... >> $RS/logs/lawswarm.log 2>&1 &`
- **`pkill -f` exits 144 and kills the rest of a compound command** — the
  signal hits your own shell's process group. Kill and relaunch in
  SEPARATE Bash invocations, or `kill <pid>` explicitly.
- Logs are append-only across restarts. Find a deploy boundary with
  `grep -n 'deploying 8 law-farm' log` and `sed -n 'START,$p'` — otherwise
  you will misread OLD log lines as current behavior (this caused a false
  "fix didn't work" scare in v7.22).
- Container restarts kill background monitors — re-arm them on wake.
- Ops cadence: 13-minute `send_later` pulse check-ins. Pulse prompts go
  stale (they reference old versions) — always verify the actually
  deployed version before acting on pulse text.

## 3. The BotAction API (lite)

Action types used and proven: `interactNpc` (npcIndex + optionIndex from
`optionsWithIndex`), `walkTo {x,z,running}`, `pickupItem {x,z,itemId}`,
`dropItem {slot}`, `shopBuy`, `useInventoryItem` (wield = optionIndex 1),
`interactLoc`, `closeModal`, `clickDialogOption`, `setCombatStyle`,
`say`, `useEquipmentItem`, `randomizeCharacterDesign`,
`acceptCharacterDesign`.

- `exec()` is synchronous for walkTo-class actions: it returns
  `{success, reason}` immediately; track failures in a `lastFailure`
  string like `walk:cant_reach`.
- Failure vocabulary: `cant_reach` (BFS found no path), `out_of_range`
  (target outside the small build area), `client_rejected` (server said
  no). All three mean "you are effectively stuck" and need escape logic.
- **Silent rejects exist**: a walk can "succeed" while the unit never
  moves. Detector: if traveling (>14 tiles from anchor), no failure
  recorded, and position unchanged for 30 ticks → synthesize
  `walk:client_rejected-silent` to trigger escape.

## 4. THE #1 ARCHITECTURAL LESSON: think() priority order is load-bearing

Every `return` in a tick handler starves everything below it. Both
catastrophic production bugs were ordering bugs:

- **v7.21 flat-production bug #1 (CIRCLE-RETREAT)**: retreat fired at
  3+ wizards & HP<80%. The circle *always* has 3+ wizards, so units
  oscillated circle↔rest forever, gaining Defence XP but never killing.
  Fix (v7.22): 4+ wizards & HP<55%, aligned with recovery hysteresis.
- **v7.22 flat-production bug #2 (loot starvation)**: loot code sat BELOW
  attack + stuck-escape. Failed attacks (`cant_reach` on wizards behind
  henge stones) fed the stuck-escape loop, which `return`ed every tick.
  Law runes despawned on the ground while CLs climbed from auto-retaliate.
  Fix (v7.23): loot moved directly after vault-run, before all combat.

**Proven priority order** (lawswarm v7.23):
1. relogin/design/doctrine housekeeping
2. vault run (carry ≥8 laws to vault tile, drop)
3. **loot** (law runes anywhere, coins ≤2 tiles) — before combat, always
4. opportunistic attack (reachable-first sort)
5. stuck-escape (gates → directed jitter → long-stuck diffusion)
6. recovery rest / circle-retreat
7. gear program (buy iron sword at 120 coins)
8. march waypoints toward site

Rule of thumb: *income actions (loot) above everything that can loop.*

## 5. Navigation (the hard part)

Lite-client `walkTo` = **local BFS in a small build area**. It cannot
path through closed doors, around long fences, or across the map. All of
the following exist because of that:

- **Waypoint chains**: short road-aligned hops (10-25 tiles). Diagonal
  "as the crow flies" targets create dead pockets against fences (the
  (3262-3265, 3277-3298) pocket ate hours). Reconstruct routes from the
  positions of units that actually completed the trip.
- **Arrival radius per waypoint**: default r=10, but use r=3-4 at fence
  crossings — a loose radius lets units "arrive" on the WRONG side of a
  fence and skip the gate entirely.
- **Gates must be interacted**: match locs with option `/^open$|^pay/i`
  (pay- covers the Al Kharid toll gate). Farm gate (3239-3240, 3301) is
  the ONLY doorway through the z=3300 fence line; the pen gate at
  (3236-3238, 3295-3296) is a trap (leads into an enclosure).
- **Belt-regression check**: a unit inside the farm-belt box
  (x 3236-3280, z ≤3304) that thinks it crossed has NOT crossed — send it
  back to the gate waypoint. Exempt the gate corridor
  (x 3237-3243, z 3296-3306) or you'll yo-yo mid-crossing units.
- **MARCH-FORCE**: when stalled on a waypoint, probe offset targets
  (wp + random ±14/±8) rather than re-issuing the same walk.
- **Long-stuck diffusion**: after 300 motionless ticks, directed probes
  have failed — take random 8-14 tile steps at random angles to random-
  walk out of the pocket.
- **Stalk leash (mankickers)**: chasing visible-but-unreachable targets
  with no distance cap walked a unit through the Al Kharid toll gate
  (3267,3228) where it could not path back. Leash: stalk only within
  15 tiles of anchor. Deep-escape: >20 tiles from anchor → walk
  anchor-directed 8-tile steps (BFS can't do the whole distance).
- **Terrain choice beats nav code**: ramp bots on OPEN FIELD men
  (3222,3222). The cow pen was a 2-hour blocker (gate already open but
  units closing it, fence-blocked approaches). If geometry is complex,
  move the objective, not the algorithm.

Proven Lumbridge→Varrock road (waypoints, radius): (3245,3235,r10),
(3262,3253,r10), (3240,3290,r4), (3239,3302,r3) **the gate**,
(3245,3315,r6), (3264,3321,r10), (3280,3340,r10), (3285,3365,r10),
(3280,3380,r10), (3235,3374,r10).

## 6. Game mechanics knowledge base

- **Dark wizards**: level 13, cast spells, drop **3x law rune at 1/128**
  (~1 law per unit per ~6 min when fighting continuously). Aggressive
  only toward players with CL < 2×13 = **26**. Consequence: once a unit
  passes CL 26 the wizards stop initiating — passive auto-retaliate
  farming decays and units must attack proactively. Aggro radius ≈14
  tiles (rest spot at anchor+18 east is safe).
- **Ice warriors**: 7/128 laws (premium tier). PROBED 2026-08-17 by
  gticeprobe (SDK bot): **Ladder#1759 at exactly (3008,3150)**, option
  `Climb-Down`, lands at (3008,9550); return ladder is Ladder#1755.
  **Warriors confirmed at (3039-3040,9582)**, reachable, Attack option.
  Hazard gauntlet: 3-4 Muggers (lvl 6) just WEST of the entrance
  ladder; a **Hobgoblin belt (lvl ~28, aggressive)** at ~(3011-3026,
  9571-9584) between entrance and chamber — killed the 10-HP probe;
  ice warriors (lvl 57) always aggro (2x57=114 > any CL). Aggro
  immunity thresholds: CL 12+ ignores muggers, **CL 56+ ignores
  hobgoblins**, nothing ignores warriors. Ice-tier units therefore
  need CL 56+ plus sustain for constant lvl-57 combat — the natural
  path is lawswarm veterans leveling past 56 at dark wizards, then
  migrating. The overworld pathfinder CANNOT target underground
  coords — descend first, then path underground. (3008,3471) is Ice
  Mountain surface — dwarves, wrong.
- **Death**: keeps the **3 most-valuable item stacks**, respawn in
  Lumbridge. Therefore: laws ride as the only valuable stack; drop junk
  on sight (`bucket|pot|jug|shears|tinderbox|fishing net|cowhide|raw
  beef|newcomer|bread`); with 2+ laws aboard don't hoard fat coin piles
  that could out-value a law stack.
- **Death detection heuristic** (no death event in lite state): natural
  regen is +1 hp; any jump of `hp - lastHp >= 3` means a respawn heal →
  count a death.
- **HP recovery hysteresis**: enter rest at <55% HP, exit at ≥85%.
  While recovering, **suppress attacks** — otherwise a chasing wizard
  re-engages at the rest spot and "rest" is just dying farther away.
  Any retreat trigger must be aligned with (not looser than) these
  thresholds or units oscillate (the v7.21 lesson).
- **Ramp**: fresh units fight Lumbridge Men/Women until
  avg(atk,str,def,hp) ≥ 10, then march to the circle.
- **Combat styles**: `setCombatStyle` by index from `cs.styles`; doctrine
  is Block until Defence 50, then Kick (with periodic Punch windows —
  mankickers run 25 Punch ticks per 150).
- **Gear**: dark-wizard coin drops fund an iron sword (120 coins) at the
  Varrock sword shop (3203,3397). Wield = `useInventoryItem` optionIndex 1.
- **New characters**: must `randomizeCharacterDesign` +
  `acceptCharacterDesign` before playing; SDK bots call `skipTutorial()`.

## 7. Map atlas (all proven coordinates)

| Place | Coords | Notes |
|---|---|---|
| Varrock dark-wizard circle | (3225,3374) | anchor; henge stones block melee lines → cant_reach churn |
| Vault tile | (3228,3340) | 34 tiles south of circle, outside aggro; survived 0-death ops |
| Vault WAIT spot | (3229,3332) | gtvault idles here, sees piles within ~8-tile scan |
| Varrock West bank | (3185,3436) | gtvault banks at 30+ laws |
| Sword shop | (3203,3397) | iron sword, 120 coins |
| Ramp field (Lumbridge men) | (3222,3222) | open ground, no fences |
| Farm gate (THE gate) | (3239-3240,3301) | only crossing in z=3300 fence |
| Trap pen gate | (3236-3238,3295-96) | do NOT use |
| Al Kharid toll gate | (3267,3228) | pay-toll; one-way trap for lite bots |
| Ice dungeon (underground) | (3044,9581) | via ladder ~(3008,3150) — TODO |
| Mankicker anchors | courtyard (3222,3218), bobs-hut (3231,3210), church (3243,3210), castle-east (3234,3222), north-gate (3223,3231), general-store (3218,3243), north-road (3236,3242), east-road (3238,3225) | east-road replaced bridge-path (3245,3230) — too close to toll gate |

## 8. The vault pipeline (economy architecture)

Lite clients **cannot bank or trade**. The workaround that works:

1. Swarm units carry laws; at ≥8 (`VAULT_AT`) they walk to the vault
   tile and `dropItem` the stack. Checked BEFORE combat so wizard aggro
   can't trap a full stack at the circle.
2. **Drop-reloot suppression**: after the v7.19 bug (unit drops laws,
   then immediately loots its own pile forever), loot is suppressed
   within radius 8 of the vault AND for 15 ticks after any drop.
   Radius 3 was not enough (v7.21 widened it after drift).
3. gtvault (full SDK bot) patrols WAIT↔VAULT, hoovers piles
   (`findGroundItem(/law rune/i)` loop, 6 max per pass), banks at 30+,
   and broadcasts buying-desk ads (`serveTrades` paying coins for laws).

Proven end-to-end: VAULT-DROP events (8-12 laws each) → hoover events →
bank runs, zero deaths at the current vault position.

## 9. Bug graveyard (chronological, with morals)

| Ver | Bug | Fix / moral |
|---|---|---|
| v5.x | Units died constantly to wizard gangs | Recovery hysteresis 55/85 + attack suppression while resting |
| v6 | Blind cross-map walking | Waypoint chains from proven traveler paths |
| ~v7.0 | Cow-pen ramp blocked 2h by gate/fence geometry | Moved ramp to open field; change the objective, not the algorithm |
| v7.8 | Diagonal shortcuts into fence pockets | Road-aligned short hops |
| v7.19 | Drop-reloot: units ate their own vault piles | Loot suppression near vault + post-drop cooldown |
| v7.20 | Vault at (3227,3368) too close — wizard aggro killed carriers | Vault moved to (3228,3340), 34 tiles south |
| v7.21 | CIRCLE-RETREAT at 3+ wiz/HP<80% → permanent oscillation, flat laws | Thresholds 4+/55%, aligned with recovery |
| v7.22 | Loot below attack/stuck-escape → runes despawned, flat laws | Loot moved above all combat (v7.23). **Ordering is load-bearing** |
| mankicker | Stalk chased unreachables through toll gate; bot marooned in Al Kharid | 15-tile stalk leash + deep-escape + anchor moved off the gate approach |
| ops | pkill 144 killed its own launch command | Separate kill and launch invocations |
| ops | Reading pre-restart log lines as current | Slice logs at the deploy boundary line number |
| telemetry | `xp=0` in all reports despite CLs climbing | `combatXp()` reads `skills[].xp` which lite state doesn't populate — **unfixed**; use CL deltas instead |

## 10. Telemetry & ops patterns that worked

- One status line per swarm per interval:
  `LAWSWARM laws=N deaths=N online=8/8` + one line per bot
  (`cl= hp= laws= deaths= pos=`). Greppable, diffable, monitor-friendly.
- Named event tags: `VAULT-DROP`, `CIRCLE-RETREAT`, `STUCK-ESCAPE`,
  `GATE-OPEN`, `MARCH-FORCE`, `LAW`, `DOCTRINE`, `GEAR`. A monitor is
  just `tail -f | grep -E --line-buffered 'TAG1|TAG2|...'`.
- STUCK-ESCAPE logs dump the 8 nearest locs with options — this is how
  the farm gate, henge blockers, and potato-field traps were diagnosed.
- Watch **per-bot law counts**, not just the total: the total hid the
  v7.22 bug (total steady from stale carriers; per-bot counts frozen =
  zero pickups).
- CL deltas are the real combat-progress signal while xp telemetry is
  broken.
- Dashboard: single self-contained HTML artifact, republished on each
  pulse (fleet tiles, per-bot sparklines, status pills).

## 11. Roadmap for a better bot (ranked)

1. **Fix XP telemetry** — find the real xp field in lite skill state (or
   compute from level table). Without it, spawn-saturation analysis
   (XP/hr per site) is guesswork.
2. **Aggro-flip handling** — units past CL 26 no longer get attacked
   first. Verify proactive attack cadence is enough; consider parking
   sub-26 "bait" units to hold wizard attention while high-CL units
   sweep, or accept the doctrine switch to Kick at Def 50.
3. **Ice warrior tier** (7/128 vs 3/128 ≈ 2.3x law rate): needs ladder
   nav — `interactLoc` on the ladder south of Port Sarim, then a
   dungeon waypoint chain to (3044,9581). Biggest single production
   multiplier available.
4. **March hardening** — gtlaw16 burned 7000+ ticks at waypoint 3
   across restarts. The wp3 approach needs its own micro-waypoints or a
   detect-and-reroute (e.g., if stalled >1500 ticks, re-run the belt
   approach from wp1).
5. **Vault cadence tuning** — VAULT_AT=8 causes fairly frequent trips;
   measure trip cost vs death risk now that deaths are ~0. Raising to
   12-15 may increase circle uptime.
6. **Scale-out** — one Bun process holds 8 bots at ~14MB each; spawn
   saturation at the circle (wizard respawn rate) is the real cap, not
   memory. Needs the XP/kill telemetry from item 1 to decide if
   16 units split across two anchor offsets beats 8.
7. **Buying desk verification** — gtvault ads run, but no recorded
   third-party trade yet; needs a test trade.
8. **Supervisor** — auto-restart swarm processes on crash (supervisors
   existed; formalize into one script with per-swarm restart counters).

## 12. Design principles distilled

1. **Ordering is load-bearing.** Every early `return` starves what's
   below. Put income (loot) above anything that can loop (combat,
   escape). Re-audit the whole chain after every insertion.
2. **Align thresholds.** Two mechanisms with overlapping triggers
   (retreat at 80%, recover at 55%) create oscillation. One source of
   truth for "am I in trouble."
3. **Never trust "arrived."** Radius checks lie near fences; verify the
   crossing (belt-regression box), not the distance.
4. **Diagnose from what units actually did.** The working waypoint route
   was reverse-engineered from the two bots that made it, not from map
   theory. Loc dumps in stuck logs beat speculation.
5. **When geometry wins, relocate.** Open-field ramping ended a 2-hour
   gate fight instantly.
6. **Protect the payload with game rules.** Death-keeps-3 + laws-as-only-
   valuable = deaths cost runs, not stock.
7. **Total metrics hide per-unit failures.** Log both.
8. **Verify the version you're reading logs for.** Append-only logs +
   restarts + stale pulse prompts = three ways to fool yourself.

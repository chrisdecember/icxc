# OPERATION: GOLDEN THRONE

## The Gambit

Deploy a 5-bot coordinated swarm. One KING bot contends the leaderboard.
Four DRONE bots are specialized resource gatherers feeding the KING through
a continuous trade network. The KING never wastes a single tick gathering
raw materials — it only receives, processes, and trains.

**Or go solo:** the LONE WOLF variant runs a single bot through every skill
in sequence — the ultimate speedrun for when you don't need a swarm.

## The Swarm

```
  ┌─────────┐    gold + tools     ┌──────────┐
  │ FINGERS  │───────────────────►│          │
  │ (thief)  │  pickpocket GP     │          │
  └─────────┘  upgrades to Al     │          │
               Kharid warriors    │          │
  ┌─────────┐   copper + tin ore  │          │
  │PICKSWING │───────────────────►│  KING    │──► LEADERBOARD
  │ (miner)  │   balanced loads   │          │
  └─────────┘   from SE Varrock   │          │    ┌──────────────┐
  ┌─────────┐    raw shrimp       │          │    │  FALLBACKS:  │
  │ NETTER   │───────────────────►│          │    │  Self-mining  │
  │ (fisher) │   dark wiz safe    │          │    │  Food runs    │
  └─────────┘   route via north   │          │    │  Drop/bank    │
  ┌─────────┐    logs → oak logs  │          │    └──────────────┘
  │ TIMBER   │───────────────────►│          │
  │ (lumber) │   upgrades at WC15 └──────────┘
  └─────────┘
```

## Why This Is Unhinged

1. **Five bots launch simultaneously.** While KING thieving-blitzes to level 40
   in 10 minutes, all four drones are ALREADY gathering resources in parallel.
2. **THE KING never gathers** (unless drones fail — then self-mining fallback kicks in).
   Pure processing and training machine.
3. **Continuous food supply** from NETTER means KING sustains combat indefinitely.
   No breaks to fish. No downtime. Just violence.
4. **11+ skills trained in 2 hours:** Thieving, Woodcutting, Fletching, Firemaking,
   Smithing, Cooking, Attack, Strength, Defence, Hitpoints, Crafting.
5. **Assembly-line cascading:** ore→bar→dagger→equip→fight = 5 skills
   from one resource chain.
6. **Combat style rotation** cycles Attack/Strength/Defence every 5 kills,
   tripling effective combat training.
7. **Al Kharid escalation:** KING graduates from cows to Al Kharid warriors
   at Attack 10+ for massively faster XP with kebab food sustain.
8. **Cowhide tanning:** every 20 kills, KING tans hides for Crafting XP —
   squeezing one more skill from the combat grind.
9. **Death is not the end.** Every bot auto-recovers from death, walks back
   to its station, and resumes. The swarm never stops.

## Deployment Modes

### Full Swarm (default)
```bash
cd rs-sdk
bash /path/to/rs-sdk-farm/setup.sh [--server=HOST]
```
Launches all 5 bots: king, fingers, pickswing, netter, timber.

### Lone Wolf (solo speedrun)
```bash
bash /path/to/rs-sdk-farm/setup.sh --lone-wolf [--server=HOST]
```
Single bot does everything: thieve → tools → WC/fletch/FM → mine → smelt →
smith → fish → cook → combat with emergency food runs.

### Custom Selection
```bash
bash /path/to/rs-sdk-farm/setup.sh --bots=king,pickswing,netter
```
Launch only specific bots from the swarm.

### Other Flags
- `--local` — use localhost server
- `--server=HOST` — custom server address
- `--no-chat` — disable public chat display

## Timeline

```
T+00:00  ALL: Skip tutorial, start pickpocketing for seed money
T+00:03  PICKSWING: Buys pickaxe (1gp), heads to SE Varrock mine
T+00:03  TIMBER: Buys axe (16gp), starts chopping near Lumbridge
T+00:05  NETTER: Buys fishing net (5gp at Port Sarim), heads to Draynor
T+00:10  KING: Thieving 30+, checking for drone deliveries between picks
T+00:12  FINGERS: Has 200+ GP, buying tools, delivering to KING
T+00:15  KING: Thieving 40+, tools acquired, WC/Fletch/FM burst begins
T+00:15  PICKSWING: First ore delivery ready (balanced copper/tin)
T+00:20  TIMBER: WC 15 — upgrades to oaks (more logs, more fletch XP)
T+00:25  KING: WC/Fletch/FM done, receives ores, smelts bronze bars
T+00:30  KING: Self-mines fallback if ores haven't arrived yet
T+00:35  KING: Walks to Varrock anvil, smiths bronze daggers
T+00:45  KING: Receives fish from NETTER, cooks at Lumbridge range
T+00:50  KING: Equips best gear — COMBAT PHASE BEGINS
T+00:55  KING: Cow combat with style rotation (Atk → Str → Def cycling)
T+01:00  KING: Tanning cowhides every 20 kills for Crafting XP
T+01:10  KING: Attack 10+ — ESCALATES to Al Kharid warriors
T+01:15  FINGERS: Thieving 40+ — upgrades to Al Kharid warrior pickpockets
T+01:30  KING: Combat skills climbing, kebab sustain, coin banking
T+01:45  NETTER: 3rd food delivery — combat never stops
T+02:00  DONE — Maximum total level achieved across 11+ skills
```

## Meeting Point

All trades happen at **Lumbridge Castle courtyard (3222, 3218)** — the
universal spawn point. Drones walk there when inventory is full and attempt
to trade with retry logic (3 attempts). If KING is unavailable:
- PICKSWING banks ores at Varrock West
- NETTER banks fish at Draynor
- TIMBER drops logs and continues chopping

## Skills Trained by THE KING

| Skill       | Source                          | Target Level |
|-------------|---------------------------------|-------------|
| Thieving    | Pickpocket men (Phase 1)        | 40+         |
| Woodcutting | Chop trees/oaks (Phase 3)       | 15+         |
| Fletching   | Arrow shafts (375 XP/log!)      | 20+         |
| Firemaking  | Burn logs (Phase 3)             | 15+         |
| Smithing    | Smelt ore + smith daggers       | 25+         |
| Cooking     | Cook raw fish (Phase 5)         | 15+         |
| Attack      | Combat w/ style rotation        | 20+         |
| Strength    | Combat w/ style rotation        | 20+         |
| Defence     | Combat w/ style rotation        | 15+         |
| Hitpoints   | All combat                      | 15+         |
| Crafting    | Tan cowhides (every 20 kills)   | 10+         |

## Bot Details

### KING (969 lines) — The Leaderboard Contender
- **Phase 1:** Thieving blitz to 40+ with `checkDeliveries()` between picks
- **Phase 2:** Tool acquisition (hammer, tinderbox, axe, pickaxe, knife)
- **Phase 3:** WC/Fletch/FM burst (20 trees, alternate fletch/burn)
- **Phase 4:** Receive ores + smelt + smith (self-mining fallback if drones miss)
- **Phase 5:** Receive fish + cook
- **Phase 6:** Cow combat with style rotation, cowhide tanning every 20 kills
- **Phase 7:** Al Kharid warrior escalation at Attack 10+ (kebab sustain, coin banking)

### FINGERS (191 lines) — The Thief
- Pickpockets men for seed money, buys tools for KING
- Upgrades to Al Kharid warriors at Thieving 40 for massive GP
- Death recovery, kebab sustain, gold banking

### PICKSWING (188 lines) — The Miner
- Balanced copper/tin alternation for optimal bronze bar smelting
- SE Varrock mine with full waypoint navigation
- Falls back to Varrock West bank if KING unavailable

### NETTER (191 lines) — The Fisher
- Safe dark-wizard-avoiding routes to Draynor fishing spot
- Fishing spot drift correction
- Falls back to Draynor bank if KING unavailable

### TIMBER (166 lines) — The Lumberjack
- Upgrades from regular trees to oaks at WC 15+
- Shortest supply route (Lumbridge trees → Lumbridge meeting point)
- Drops logs and continues if KING unavailable

### LONE WOLF (439 lines) — The Solo Speedrunner
- Does everything KING does, but gathers all resources itself
- Sequential skill training: thieve → tools → WC/fletch/FM → mine → smelt → smith → fish → cook → combat
- Emergency fishing runs when food runs out during combat
- Combat style rotation for balanced melee training

## Resilience

Every bot has:
- **Death recovery:** detects HP=0, waits for respawn, walks back to station
- **Trade retry logic:** 3 attempts before fallback (bank or drop)
- **Drift correction:** periodically checks position, walks back if too far from target
- **Skill-based upgrades:** automatically switches to better resources at level thresholds

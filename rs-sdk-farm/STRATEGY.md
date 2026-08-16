# OPERATION: GOLDEN THRONE

## The Gambit

Deploy a 5-bot coordinated swarm. One KING bot contends the leaderboard.
Four DRONE bots are specialized resource gatherers feeding the KING through
a continuous trade network. The KING never wastes a single tick gathering
raw materials — it only receives, processes, and trains.

## The Swarm

```
  ┌─────────┐    gold + tools     ┌──────────┐
  │ FINGERS  │───────────────────►│          │
  │ (thief)  │  pickpocket GP     │          │
  └─────────┘                     │          │
  ┌─────────┐   copper + tin ore  │          │
  │PICKSWING │───────────────────►│  KING    │──► LEADERBOARD
  │ (miner)  │   from SE Varrock  │          │
  └─────────┘                     │          │
  ┌─────────┐    raw shrimp       │          │
  │ NETTER   │───────────────────►│          │
  │ (fisher) │   from Draynor     │          │
  └─────────┘                     │          │
  ┌─────────┐    logs             │          │
  │ TIMBER   │───────────────────►│          │
  │ (lumber) │   from Lumbridge   └──────────┘
  └─────────┘
```

## Why This Is Unhinged

1. **Five bots launch simultaneously.** While KING thieving-blitzes to level 40
   in 10 minutes, all four drones are ALREADY gathering resources in parallel.
2. **THE KING never gathers.** Pure processing and training machine. Every tick
   is spent gaining XP, never walking to a mine or casting a net.
3. **Continuous food supply** from NETTER means KING sustains combat indefinitely.
   No breaks to fish. No downtime. Just violence.
4. **11+ skills trained in 2 hours:** Thieving, Woodcutting, Fletching, Firemaking,
   Smithing, Cooking, Attack, Strength, Defence, Hitpoints, Prayer.
5. **Assembly-line cascading:** ore→bar→dagger→equip→fight→bury bones = 5 skills
   from one resource chain.

## Timeline

```
T+00:00  ALL: Skip tutorial, start pickpocketing for seed money
T+00:03  PICKSWING: Buys pickaxe (1gp), heads to SE Varrock mine
T+00:03  TIMBER: Buys axe (16gp), starts chopping near Lumbridge
T+00:05  NETTER: Buys fishing net (5gp at Port Sarim), heads to Draynor
T+00:10  KING: Thieving 30+, still pickpocketing
T+00:12  FINGERS: Has 200+ GP, starts buying tools, delivers to KING
T+00:15  KING: Thieving 40+, buys own tools, starts WC/Fletch/FM burst
T+00:15  PICKSWING: First ore delivery ready, heading to meeting point
T+00:25  KING: WC/Fletch/FM done, heads to furnace for ore delivery
T+00:25  KING: Receives ores from PICKSWING, smelts bronze bars
T+00:35  KING: Walks to Varrock anvil, smiths bronze daggers
T+00:45  KING: Heads to Lumbridge range, receives fish from NETTER
T+00:50  KING: Cooks all fish, equips gear
T+00:55  KING: COMBAT PHASE BEGINS — cows, bones, blood
T+01:00  NETTER: Continuous food deliveries every ~15 minutes
T+01:30  KING: Combat skills climbing, prayer from buried bones
T+02:00  DONE — Maximum total level achieved
```

## Meeting Point

All trades happen at **Lumbridge Castle courtyard (3222, 3218)** — the
universal spawn point. KING announces position via chat when ready for
deliveries. Drones walk there when inventory is full.

## Skills Trained by THE KING

| Skill       | Source                         | Target Level |
|-------------|--------------------------------|-------------|
| Thieving    | Pickpocket men (Phase 1)       | 40+         |
| Woodcutting | Chop trees (Phase 3)           | 15+         |
| Fletching   | Arrow shafts from logs         | 20+         |
| Firemaking  | Burn logs                      | 15+         |
| Smithing    | Smelt ore + smith daggers      | 25+         |
| Cooking     | Cook raw shrimp                | 15+         |
| Attack      | Cow combat                     | 20+         |
| Strength    | Cow combat                     | 20+         |
| Defence     | Cow combat                     | 15+         |
| Hitpoints   | Cow combat                     | 15+         |
| Prayer      | Bury cow bones                 | 10+         |

## Setup

```bash
cd rs-sdk
bash /path/to/rs-sdk-farm/setup.sh
```

This creates all 5 bot accounts and launches them in parallel.
The KING's script orchestrates everything.

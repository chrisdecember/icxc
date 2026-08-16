import { appendFileSync } from "node:fs";
import { runScript } from "../../sdk/runner";

// FINGERS v5 — THE KNIGHT'S PURSE, sustainable edition. Thieving 99:
// Knights of Ardougne are the endgame pickpocket (~50gp/pick vs 3gp from
// men). No skillcape on this 2004 server; gem stall off-limits by order.
//
// The commute was the killer, not the market: the old coast waypoints ran
// through the hobgoblin peninsula (2900,3290) — death — and the restart
// repathed over White Wolf Mountain with no rest, at 2hp. Ardougne has
// exactly one land approach (Taverley -> White Wolf -> Catherby), so v5
// crosses it deliberately: rest to near-full at Taverley, sprint the wolf
// pass without stopping, recover at Catherby.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    // The real road. rest=true means: safe ground, wait for HP before the
    // next leg. The (2850,3487) pass tile is empirically walkable (metrics
    // caught us standing on it) — it's the wolf zone, never rest there.
    const ROUTE_WEST = [
      { x: 3092, z: 3245, rest: false }, // Draynor
      { x: 2965, z: 3335, rest: false }, // Falador south road (skirts hobgoblin peninsula)
      { x: 2895, z: 3455, rest: true },  // Taverley — rest hp AND energy before the pass
      // No mid-pass waypoint: field test showed stopping at (2850,3487) to
      // read state cost dwell time in wolf aggro — 10 of 12 hp in one leg.
      // Taverley -> Catherby as ONE leg; the pathfinder owns the crossing.
      { x: 2804, z: 3433, rest: true },  // Catherby — recover after the pass
      { x: 2661, z: 3305, rest: false }, // East Ardougne market
    ];
    const MARKET = { x: 2661, z: 3305 };
    const KNIGHT = /knight of ardougne|^knight$/i;

    let picks = 0;
    let startCoins = 0;

    async function isAlive() {
      const state = sdk.getState();
      if (!state?.player) return true;
      return state.player.hp > 0;
    }

    const ARDY_BANK = { x: 2657, z: 3283 };

    // Regen is ~1hp/min; a few minutes parked in Taverley beats a corpse
    // run from Lumbridge. Also waits on RUN ENERGY — crossing the pass at
    // walking speed is what let the wolves land 10 hits. Eats food first
    // if we happen to hold any.
    async function restUntilHp(frac: number, maxTicks = 900) {
      for (let t = 0; t < maxTicks; t += 20) {
        const st = sdk.getState()?.player;
        if (!st || st.hp <= 0) return;
        const e = (st as any).runEnergy ?? 0;
        const eMax = e > 100 ? 10000 : 100; // server uses 0-10000; tolerate 0-100
        if (st.hp >= st.maxHp * frac && e >= eMax * 0.6) return;
        const food = sdk.findInventoryItem(/cake|bread/i);
        if (food) {
          try { await bot.eatFood(food); } catch (_) {}
        }
        if (t === 0) console.log(`[FINGERS] Resting (${st.hp}/${st.maxHp} hp, energy ${e})`);
        await sdk.waitForTicks(20);
      }
    }

    // Returns false if we died on the road — caller restarts the march.
    async function walkWest(): Promise<boolean> {
      console.log("[FINGERS] Marching west (Falador road -> Taverley -> wolf pass -> Catherby)");
      for (const p of ROUTE_WEST) {
        const st = sdk.getState()?.player;
        if (!st || st.hp <= 0) return false;
        // Skip waypoints already east of us (fresh read each leg — the old
        // one-time read kept stale positions across a mid-march death).
        if (p.x > st.worldX + 30) continue;
        try { await bot.walkTo(p.x, p.z); } catch (e) {
          console.log(`[FINGERS] Leg to (${p.x},${p.z}) failed: ${(e as Error).message}`);
        }
        const now = sdk.getState()?.player;
        if (!now || now.hp <= 0) return false;
        console.log(`[FINGERS] waypoint (${now.worldX},${now.worldZ}) hp=${now.hp}`);
        if (p.rest) await restUntilHp(0.85);
      }
      return true;
    }

    // Coins do NOT survive death on this server (measured: the KING died
    // holding shopping money and kept only gear). The treasury banks at
    // Ardougne south — pocket change only on the street.
    async function bankTreasury(keepPocket = 200) {
      if (!nearArdougne()) return;
      const coins = sdk.countInventoryItems(/coins/i);
      if (coins <= keepPocket + 300) return;
      console.log(`[FINGERS] Banking treasury: ${coins}gp`);
      await bot.walkTo(ARDY_BANK.x, ARDY_BANK.z);
      try {
        await bot.openBank();
        await bot.depositItem(/coins/i, -1);
        // Intercepted traffic valuables (runes/gems) bank alongside.
        try { await bot.depositItem(/rune|gem|sapphire|emerald|ruby|diamond/i, -1); } catch (_) {}
        await bot.closeBank();
        console.log("[FINGERS] Treasury secured");
      } catch (e) {
        console.log(`[FINGERS] Bank failed: ${(e as Error).message}`);
      }
      await bot.walkTo(MARKET.x, MARKET.z);
    }

    // NO STALL THEFT. Field death #2: stealing the baker's stall aggroed
    // the East Ardougne guards, who beat FINGERS to death at full hp (the
    // Attack XP on the sample was auto-retaliate). Sustain comes from
    // resting OFF the square instead — slower than cake, but deathless.
    const REST_SPOT = { x: 2661, z: 3288 }; // south alley, out of aggro

    // Every helper must refuse to run far from Ardougne: after a death,
    // a helper's trailing walkTo(MARKET) from Lumbridge silently walks
    // the whole country (and the wolf pass) with no rest logic. Let the
    // main loop's death branch own the remarch instead.
    function nearArdougne() {
      const st = sdk.getState()?.player;
      if (!st) return false;
      return Math.abs(st.worldX - MARKET.x) + Math.abs(st.worldZ - MARKET.z) < 150;
    }

    async function eatOrRestIfLow() {
      const st = sdk.getState()?.player;
      if (!st || !nearArdougne()) return;
      const food = sdk.findInventoryItem(/cake|bread/i);
      if (st.hp < st.maxHp * 0.7 && food) {
        try { await bot.eatFood(food); } catch (_) {}
        return;
      }
      // Under half with no food: step off the square and regen. Knights
      // stun for 3 at worst; entering fights only above 80% keeps the
      // floor safe with maxHp this small.
      if (st.hp < st.maxHp * 0.5) {
        console.log(`[FINGERS] Low (${st.hp}/${st.maxHp}) — resting off-square`);
        await bot.walkTo(REST_SPOT.x, REST_SPOT.z);
        await restUntilHp(0.85);
        await bot.walkTo(MARKET.x, MARKET.z);
      }
    }

    // The knights square is the likeliest REAL trafficking hub on the
    // server — nick's 21-bot thieving fleet earns here, and drop-transfer
    // collector patterns dump coin stacks where the workers stand. We're
    // on this square all day anyway: log every >=100gp pile as traffic
    // intel and eat the coin piles (they stack — zero slot cost).
    const INTEL_PATH = new URL("../../logs/pile-intel.jsonl", import.meta.url).pathname;
    const seenPiles = new Set<string>();

    async function ardyPileWatch() {
      if (!nearArdougne()) return;
      const piles = (sdk.getGroundItems() as any[])
        .filter((g) => /coins|rune|gem|sapphire|emerald|ruby|diamond/i.test(g.name));
      for (const p of piles) {
        const n = p.count ?? 1;
        const est = /^coins$/i.test(p.name) ? n : n * 100;
        if (est < 100) continue;
        const key = `${p.name}@${p.x},${p.z}:${n}`;
        if (seenPiles.has(key)) continue;
        seenPiles.add(key);
        if (seenPiles.size > 400) seenPiles.clear();
        console.log(
          `[FINGERS] ARDY-TRAFFIC ${p.name} x${n} (~${est}gp) @ (${p.x},${p.z}) — collector pile on the knight square`
        );
        try {
          appendFileSync(INTEL_PATH, JSON.stringify({
            ts: new Date().toISOString(), region: "ardougne", event: "sight",
            traffic: true, zone: "knights-square", name: p.name, n, x: p.x, z: p.z, est,
          }) + "\n");
        } catch (_) {}
        try { await bot.pickupItem(p); } catch (_) {}
      }
    }

    // ═══════════════════════════════════════════════════════
    startCoins = sdk.countInventoryItems(/coins/i);
    console.log(
      `[FINGERS] v4: Knight's Purse expedition — departing with ${startCoins}gp`
    );
    await sdk.say("the mint rides west. knights of ardougne await");
    while (!(await walkWest())) {
      console.log("[FINGERS] Died on the road — waiting for respawn, remarching");
      await sdk.waitForTicks(10);
    }
    await bankTreasury(); // secure the war chest before the first pick

    while (true) {
      if (!(await isAlive())) {
        console.log("[FINGERS] Death — treasury is banked, only pocket change lost. Remarching");
        await sdk.waitForTicks(10);
        while (!(await walkWest())) {
          await sdk.waitForTicks(10);
        }
        continue;
      }

      const knight = sdk.findNearbyNpc(KNIGHT);
      if (knight) {
        try { await bot.pickpocketNpc(knight); } catch (_) {}
        await bot.dismissBlockingUI();
        picks++;
        if (picks % 10 === 0) await ardyPileWatch();
        if (picks % 50 === 0) {
          const coins = sdk.countInventoryItems(/coins/i);
          const cakes = sdk.countInventoryItems(/cake|bread/i);
          console.log(
            `[FINGERS] KNIGHT-PURSE ${picks} picks, ${coins}gp on hand, ${cakes} food`
          );
          await bankTreasury();
        }
      } else {
        await sdk.waitForTicks(3);
        await ardyPileWatch();
        const st = sdk.getState()?.player;
        if (
          st &&
          Math.abs(st.worldX - MARKET.x) + Math.abs(st.worldZ - MARKET.z) > 20
        ) {
          await bot.walkTo(MARKET.x, MARKET.z);
        }
      }

      await eatOrRestIfLow();
    }
  },
  { timeout: 86_400_000 }
);

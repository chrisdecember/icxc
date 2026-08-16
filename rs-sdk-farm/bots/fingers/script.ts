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
      { x: 2895, z: 3455, rest: true },  // Taverley — rest up before the pass
      { x: 2850, z: 3487, rest: false }, // White Wolf pass — KEEP MOVING
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
    // run from Lumbridge. Eats food first if we happen to hold any.
    async function restUntilHp(frac: number, maxTicks = 900) {
      for (let t = 0; t < maxTicks; t += 20) {
        const st = sdk.getState()?.player;
        if (!st || st.hp <= 0 || st.hp >= st.maxHp * frac) return;
        const food = sdk.findInventoryItem(/cake|bread/i);
        if (food) {
          try { await bot.eatFood(food); } catch (_) {}
        }
        if (t === 0) console.log(`[FINGERS] Resting (${st.hp}/${st.maxHp} hp)`);
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
      const coins = sdk.countInventoryItems(/coins/i);
      if (coins <= keepPocket + 300) return;
      console.log(`[FINGERS] Banking treasury: ${coins}gp`);
      await bot.walkTo(ARDY_BANK.x, ARDY_BANK.z);
      try {
        await bot.openBank();
        await bot.depositItem(/coins/i, -1);
        await bot.closeBank();
        console.log("[FINGERS] Treasury secured");
      } catch (e) {
        console.log(`[FINGERS] Bank failed: ${(e as Error).message}`);
      }
      await bot.walkTo(MARKET.x, MARKET.z);
    }

    // The baker's stall sits ON the market square (2654,3311) — at
    // Thieving 99 a stall theft always lands. Free cakes beat resting.
    const BAKER_STALL = { x: 2654, z: 3311 };

    async function stealCakes(count: number) {
      await bot.walkTo(BAKER_STALL.x, BAKER_STALL.z);
      for (let i = 0; i < count * 3; i++) {
        if (sdk.countInventoryItems(/cake|bread/i) >= count) break;
        const stall = sdk.findNearbyLoc(/stall/i, { withOption: /steal/i });
        if (!stall) { await sdk.waitForTicks(4); continue; }
        try { await bot.interactLoc(stall, /steal/i); } catch (_) {}
        await bot.dismissBlockingUI();
        await sdk.waitForTicks(2);
      }
      await bot.walkTo(MARKET.x, MARKET.z);
    }

    async function eatOrStealIfLow() {
      const st = sdk.getState()?.player;
      if (!st) return;
      // Sustainable farm rule: eat EARLY (70%) — knight stuns chip 3hp and
      // max HP here is tiny; waiting for 50% was the death-cycle.
      if (st.hp < st.maxHp * 0.7) {
        const food = sdk.findInventoryItem(/cake|bread/i);
        if (food) {
          try { await bot.eatFood(food); } catch (_) {}
        }
      }
      // Proactive stocking: never work the square with fewer than 2 cakes.
      if (sdk.countInventoryItems(/cake|bread/i) < 2) {
        console.log("[FINGERS] Restocking cakes from the baker's stall");
        await stealCakes(4);
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
        const st = sdk.getState()?.player;
        if (
          st &&
          Math.abs(st.worldX - MARKET.x) + Math.abs(st.worldZ - MARKET.z) > 20
        ) {
          await bot.walkTo(MARKET.x, MARKET.z);
        }
      }

      await eatOrStealIfLow();
    }
  },
  { timeout: 86_400_000 }
);

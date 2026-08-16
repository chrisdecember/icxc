import { runScript } from "../../sdk/runner";

// FINGERS v4 — THE KNIGHT'S PURSE. Thieving 99: Knights of Ardougne are
// the endgame pickpocket (~50gp/pick vs 3gp from men — 16x the mint
// rate, near-perfect success at 99). No skillcape exists on this 2004
// server (checked the item data), and the gem stall is off-limits by
// order — knights only.
//
// Coins stack as one slot and survive death (most-valuable-3 rule), so
// the war chest rides along. HP is tiny — rest-regen keeps the rare
// failed-pick stuns from adding up.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    // Coarse east->west hops; the pathfinder owns the details.
    const ROUTE_WEST = [
      { x: 3092, z: 3245 }, // Draynor
      { x: 3000, z: 3235 },
      { x: 2900, z: 3290 },
      { x: 2800, z: 3300 },
      { x: 2700, z: 3305 },
      { x: 2661, z: 3305 }, // East Ardougne market
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

    async function walkWest() {
      console.log("[FINGERS] Marching west to Ardougne");
      for (const p of ROUTE_WEST) {
        await bot.walkTo(p.x, p.z);
        const st = sdk.getState()?.player;
        if (st) console.log(`[FINGERS] waypoint (${st.worldX},${st.worldZ})`);
      }
    }

    async function restIfLow() {
      const st = sdk.getState()?.player;
      if (st && st.hp < st.maxHp * 0.5) {
        console.log("[FINGERS] Low HP — resting off the market square");
        await bot.walkTo(MARKET.x + 8, MARKET.z + 8);
        while (true) {
          const s = sdk.getState()?.player;
          if (!s || s.hp >= s.maxHp * 0.9) break;
          await sdk.waitForTicks(20);
        }
        await bot.walkTo(MARKET.x, MARKET.z);
      }
    }

    // ═══════════════════════════════════════════════════════
    startCoins = sdk.countInventoryItems(/coins/i);
    console.log(
      `[FINGERS] v4: Knight's Purse expedition — departing with ${startCoins}gp`
    );
    await sdk.say("the mint rides west. knights of ardougne await");
    await walkWest();

    while (true) {
      if (!(await isAlive())) {
        console.log(
          `[FINGERS] Death — coins survive (${sdk.countInventoryItems(/coins/i)}gp). Marching back west`
        );
        await sdk.waitForTicks(5);
        await walkWest();
        continue;
      }

      const knight = sdk.findNearbyNpc(KNIGHT);
      if (knight) {
        try { await bot.pickpocketNpc(knight); } catch (_) {}
        await bot.dismissBlockingUI();
        picks++;
        if (picks % 50 === 0) {
          const coins = sdk.countInventoryItems(/coins/i);
          console.log(
            `[FINGERS] KNIGHT-PURSE ${picks} picks, ${coins}gp (+${coins - startCoins} this expedition)`
          );
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

      await restIfLow();
    }
  },
  { timeout: 86_400_000 }
);

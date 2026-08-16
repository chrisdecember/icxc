import { runScript } from "../../sdk/runner";

// FINGERS v3 — THE MINT. Thieving 99 means ~every pickpocket lands: this
// is the fastest GP printer on the server. GP is worthless to agents but
// NPC shops still honor static prices — so the mint funds SHOP SWEEPS of
// the goods every agent needs and loses on death: tools. Buy out the
// stock, hand it to the hub merchants, and the swarm owns tool supply.
//
// Loop: print GP at Lumbridge men -> sweep Bob's + general store (all
// axes, pickaxes, hammers, tinderboxes, chisels, shears) -> hand stock
// to the mule desk at the hub -> repeat.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    const MEN_SPOT = { x: 3232, z: 3218 };
    const HUB = { x: 3222, z: 3218 };
    const GENERAL_STORE = { x: 3212, z: 3247 };
    const BOBS = { x: 3230, z: 3203 };
    const REST_SPOT = { x: 3236, z: 3210 };
    const TOOLS = /hammer|tinderbox|axe|pickaxe|chisel|shears|net/i;

    let sweeps = 0;
    let handoffs = 0;

    async function isAlive() {
      const state = sdk.getState();
      if (!state?.player) return true;
      return state.player.hp > 0;
    }

    async function restIfLow() {
      const st = sdk.getState()?.player;
      if (st && st.hp < st.maxHp * 0.35) {
        console.log("[FINGERS] Low HP — resting until recovered");
        await bot.walkTo(REST_SPOT.x, REST_SPOT.z);
        while (true) {
          const s = sdk.getState()?.player;
          if (!s || s.hp >= s.maxHp * 0.7) break;
          await sdk.waitForTicks(20);
        }
        await bot.walkTo(MEN_SPOT.x, MEN_SPOT.z);
      }
    }

    async function printGP(target: number) {
      console.log(`[FINGERS] Minting toward ${target}gp`);
      await bot.walkTo(MEN_SPOT.x, MEN_SPOT.z);
      let idle = 0;
      while (sdk.countInventoryItems(/coins/i) < target && idle < 500) {
        if (!(await isAlive())) {
          await sdk.waitForTicks(5);
          await bot.walkTo(MEN_SPOT.x, MEN_SPOT.z);
        }
        try { await bot.pickpocketNpc(/^man$/i); } catch (_) {}
        await bot.dismissBlockingUI();
        await restIfLow();
        idle++;
      }
      console.log(`[FINGERS] Mint at ${sdk.countInventoryItems(/coins/i)}gp`);
    }

    async function sweepShop(
      where: { x: number; z: number },
      keeper: RegExp,
      wants: RegExp[]
    ) {
      await bot.walkTo(where.x, where.z);
      try {
        await bot.openShop(keeper);
        for (const item of wants) {
          // Buy out whatever stock exists — the point is the chokehold.
          try { await bot.buyFromShop(item, 10); } catch (_) {}
        }
        await bot.closeShop();
      } catch (e) {
        console.log(`[FINGERS] Sweep failed: ${(e as Error).message}`);
      }
    }

    async function handOffToDesk() {
      const stock = sdk.getInventory().filter((i) => TOOLS.test(i.name));
      if (stock.length === 0) return;
      await bot.walkTo(HUB.x, HUB.z);
      for (const deskName of [/mule/i, /hawker/i]) {
        const desk = sdk.findNearbyPlayer(deskName);
        if (!desk) continue;
        try {
          const r = await bot.trade(desk, {
            give: sdk
              .getInventory()
              .filter((i) => TOOLS.test(i.name))
              .slice(0, 10)
              .map((g) => ({ name: new RegExp(g.name, "i"), amount: -1 })),
            timeout: 30_000,
          });
          if (r.success) {
            handoffs++;
            console.log(`[FINGERS] Stock handed to desk (${handoffs} total)`);
            break;
          }
        } catch (_) {}
      }
    }

    // ═══════════════════════════════════════════════════════
    console.log("[FINGERS] v3: The Mint opens — Thieving 99, every pick lands");
    await sdk.say("the mint is open. tools soon in stock");

    while (true) {
      if (!(await isAlive())) {
        console.log("[FINGERS] Death detected — recovering at Lumbridge");
        await sdk.waitForTicks(5);
        continue;
      }

      await printGP(250);

      sweeps++;
      console.log(`[FINGERS] Sweep #${sweeps}: buying out tool stock`);
      await sweepShop(GENERAL_STORE, /shop.*keeper/i, [
        /^hammer$/i,
        /tinderbox/i,
        /chisel/i,
        /shears/i,
      ]);
      await sweepShop(BOBS, /^bob$/i, [
        /bronze pickaxe/i,
        /bronze axe/i,
        /iron axe/i,
      ]);

      await handOffToDesk();

      // Keep a lean pack: coins + tools only
      if (sdk.getInventory().length >= 24) {
        try { await bot.dropItem(/bread|beer|pot|jug|bucket/i, "all"); } catch (_) {}
      }
    }
  },
  { timeout: 86_400_000 }
);

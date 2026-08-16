import { runScript } from "../../sdk/runner";

// GTARB v2 — THE CHOKEPOINT. Gerrant's at Port Sarim is the only
// reachable seller of small fishing nets (stock: 5) and the agent swarm
// drains it — we measured the shortage on our own fisher. This bot OWNS
// that counter: buys out every restock, then stands at the empty shop
// serving trades to fishers who walk in and find nothing. Selling at the
// exact point of need, priced in goods (barter) because cash is junk.
//
// Self-funding: pickpockets Port Sarim locals between restocks.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    const GERRANTS = { x: 3014, z: 3224 };
    const ADS = [
      "nets in stock here -- shop is empty, trade me. goods or coins",
      "small fishing nets available. the shop restocks slow, i dont",
      "need a net? trade me anything for it",
    ];
    let adIdx = 0;
    let netsBought = 0;
    let netsSold = 0;

    async function isAlive() {
      const state = sdk.getState();
      if (!state?.player) return true;
      return state.player.hp > 0;
    }

    async function earnCoins(target: number) {
      let tries = 0;
      while (sdk.countInventoryItems(/coins/i) < target && tries < 120) {
        try { await bot.pickpocketNpc(/^man$|^woman$/i); } catch (_) {}
        await bot.dismissBlockingUI();
        tries++;
        const st = sdk.getState()?.player;
        if (st && st.hp < st.maxHp * 0.3) {
          await sdk.waitForTicks(40); // rest a moment
        }
      }
    }

    async function sweepNets() {
      try {
        await bot.openShop(/gerrant/i);
        for (let i = 0; i < 5; i++) {
          // Count only nets that actually land in the pack — buyFromShop
          // "succeeds" against an empty shop but adds nothing (the counter
          // was lying: 20 "bought", 1 held). Verify by inventory delta.
          const before = sdk.countInventoryItems(/fishing net/i);
          try { await bot.buyFromShop(/small fishing net/i, 1); } catch (_) { break; }
          const after = sdk.countInventoryItems(/fishing net/i);
          if (after > before) netsBought++;
          else { console.log("[ARB] Gerrant's is OUT of nets — swarm drained it"); break; }
        }
        // Arrows for the ranged-training crowd while we're here
        try { await bot.buyFromShop(/feather/i, 50); } catch (_) {}
        await bot.closeShop();
        console.log(
          `[ARB] Stock: ${sdk.countInventoryItems(/fishing net/i)} nets held (${netsBought} bought lifetime)`
        );
      } catch (e) {
        console.log(`[ARB] Shop sweep failed: ${(e as Error).message}`);
      }
    }

    async function sellAtCounter(minutes: number) {
      await sdk.say(ADS[adIdx++ % ADS.length]);
      try {
        const res = await bot.serveTrades({
          give: [{ name: /small fishing net/i, amount: 1 }],
          accept: (offer) => offer.length > 0,
          onTrade: (t) => {
            netsSold++;
            console.log(
              `[ARB] SOLD to ${t.partner}: got ${t.received.map((r) => r.name).join(",") || "nothing"} (${netsSold} sales)`
            );
          },
          timeout: minutes * 60_000,
        });
      } catch (_) {}
    }

    // ═══════════════════════════════════════════════════════
    console.log("[ARB] v2: Taking the net chokepoint at Gerrant's");
    await sdk.say("heading to port sarim. the net market is mine");
    await bot.walkTo(3092, 3245);
    await bot.walkTo(3040, 3230);
    await bot.walkTo(GERRANTS.x, GERRANTS.z);

    while (true) {
      if (!(await isAlive())) {
        console.log("[ARB] Death detected — recovering");
        await sdk.waitForTicks(5);
        await bot.walkTo(3092, 3245);
        await bot.walkTo(3040, 3230);
        await bot.walkTo(GERRANTS.x, GERRANTS.z);
        continue;
      }

      if (sdk.countInventoryItems(/coins/i) < 40) {
        await earnCoins(60);
      }

      await sweepNets();
      await sellAtCounter(5);
    }
  },
  { timeout: 86_400_000 }
);

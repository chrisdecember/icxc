import { runScript } from "../../sdk/runner";

// MERCHANT-ARBITRAGEUR: THE FLETCHER'S FRIEND — cash-to-consumables arb.
// Server economics: cash is inflated junk to agents, but NPC shops still
// honor static prices. We print cash (pickpocketing), buy ranged-training
// consumables at Lowe's (bronze arrows 1gp, stock 2000), and barter them
// at the Lumbridge hub for real goods. Cornering the ammo niche.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    const LUMBRIDGE_HUB = { x: 3222, z: 3218 };
    const LOWES = { x: 3232, z: 3423 };
    const VARROCK_GUARDS = { x: 3207, z: 3381 };
    const XP_GOODS = /(ore$|^logs$|oak logs|^raw |bar$|^bones$)/i;

    const ADS = [
      "arrows for trade! bronze + iron arrows, want any goods",
      "ammo merchant: arrows and bows for your spare ores/logs/fish",
      "ranged training supplies -- barter only, cash is trash",
    ];
    let adIdx = 0;

    async function isAlive() {
      const state = sdk.getState();
      if (!state?.player) return true;
      return state.player.hp > 0;
    }

    async function printCash(targetCoins: number) {
      console.log(`[ARB] Printing cash toward ${targetCoins}gp`);
      const thiev = sdk.getSkill("Thieving")?.level ?? 1;
      const spot = thiev >= 40 ? VARROCK_GUARDS : LUMBRIDGE_HUB;
      const npc = thiev >= 40 ? /^guard$/i : /^man$/i;
      await bot.walkTo(spot.x, spot.z);
      let ticks = 0;
      while (sdk.countInventoryItems(/coins/i) < targetCoins && ticks < 400) {
        if (!(await isAlive())) {
          await sdk.waitForTicks(5);
          await bot.walkTo(spot.x, spot.z);
        }
        try { await bot.pickpocketNpc(npc); } catch (_) {}
        await bot.dismissBlockingUI();
        ticks++;
      }
      console.log(`[ARB] Cash on hand: ${sdk.countInventoryItems(/coins/i)}gp`);
    }

    async function buyStock() {
      console.log("[ARB] Restocking at Lowe's Archery Emporium");
      await bot.walkTo(LOWES.x, LOWES.z);
      try {
        await bot.openShop(/lowe/i);
        const coins = sdk.countInventoryItems(/coins/i);
        // Bronze arrows 1gp: spend up to half the cash; iron arrows with the rest
        try { await bot.buyFromShop(/bronze arrow/i, Math.min(200, Math.floor(coins / 2))); } catch (_) {}
        try { await bot.buyFromShop(/iron arrow/i, Math.min(50, Math.floor(coins / 6))); } catch (_) {}
        try { await bot.buyFromShop(/shortbow/i, 2); } catch (_) {}
        await bot.closeShop();
      } catch (e) {
        console.log(`[ARB] Shop failed: ${(e as Error).message}`);
      }
    }

    async function hawk(minutes: number) {
      await bot.walkTo(LUMBRIDGE_HUB.x, LUMBRIDGE_HUB.z);
      await sdk.say(ADS[adIdx++ % ADS.length]);
      try {
        const res = await bot.serveTrades({
          give: [
            { name: /bronze arrow/i, amount: 100 },
            { name: /shortbow/i, amount: 1 },
          ],
          accept: (offer) => offer.length > 0,
          onTrade: (t) =>
            console.log(
              `[ARB] TRADE with ${t.partner}: got ${t.received.map((r) => r.name).join(",") || "nothing"}`
            ),
          timeout: minutes * 60_000,
        });
        if (res.trades.length)
          console.log(`[ARB] ${res.trades.length} trades this cycle`);
      } catch (_) {}
    }

    async function deliverToKing() {
      const goods = sdk.getInventory().filter((i) => XP_GOODS.test(i.name));
      if (goods.length === 0) return;
      const king = sdk.findNearbyPlayer(/king/i);
      if (!king) return;
      console.log(`[ARB] Delivering ${goods.length} XP goods to the king`);
      try {
        await bot.trade(king, {
          give: goods.map((g) => ({ name: new RegExp(g.name, "i"), amount: -1 })),
          timeout: 30_000,
        });
      } catch (_) {}
    }

    // ═══════════════════════════════════════════════════════
    console.log("[ARB] The arbitrageur opens for business");
    await sdk.say("ammo merchant setting up shop");

    while (true) {
      if (!(await isAlive())) {
        console.log("[ARB] Death detected — recovering");
        await sdk.waitForTicks(5);
        continue;
      }

      if (!sdk.findInventoryItem(/arrow/i)) {
        await printCash(300);
        await buyStock();
      }
      await hawk(6);
      await deliverToKing();
    }
  },
  { timeout: 86_400_000 }
);

import { runScript } from "../../sdk/runner";

// DRONE: THE THIEF — pickpocket machine, GP generator, tool distributor
// Pickpockets men at Lumbridge, banks gold, delivers surplus to KING.
// Thieving 1→43 in ~10 min, 1→54 in ~15 min. Generates 200+ GP fast.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    await bot.skipTutorial();

    const MEETING_POINT = { x: 3222, z: 3218 };

    async function deliverToKing() {
      const king = sdk.findNearbyPlayer(/king/i);
      if (!king) return false;
      try {
        const result = await bot.trade(king, { timeout: 15_000 });
        return result.success;
      } catch (_) {
        return false;
      }
    }

    // ═══════════════════════════════════════════════════════
    //  PHASE 1: SEED MONEY — pickpocket men at Lumbridge
    // ═══════════════════════════════════════════════════════
    console.log("[FINGERS] Phase 1: Generating seed money");
    await sdk.say("fingers is on the job");
    await bot.walkTo(MEETING_POINT.x, MEETING_POINT.z);

    while (true) {
      const skill = sdk.getSkill("Thieving");
      if (skill && skill.level >= 25) break;

      try {
        await bot.pickpocketNpc(/^man$/i);
      } catch (_) {}
      await bot.dismissBlockingUI();
    }

    // ═══════════════════════════════════════════════════════
    //  PHASE 2: SHOPPING SPREE — buy tools for the swarm
    // ═══════════════════════════════════════════════════════
    console.log("[FINGERS] Phase 2: Buying tools for the swarm");

    await bot.walkTo(3212, 3247);
    await bot.openShop(/shop.*keeper/i);
    try { await bot.buyFromShop(/hammer/i, 1); } catch (_) {}
    try { await bot.buyFromShop(/tinderbox/i, 1); } catch (_) {}
    await bot.closeShop();

    await bot.walkTo(3230, 3203);
    await bot.openShop(/^bob$/i);
    try { await bot.buyFromShop(/bronze axe/i, 1); } catch (_) {}
    try { await bot.buyFromShop(/bronze pickaxe/i, 1); } catch (_) {}
    await bot.closeShop();

    await sdk.say("fingers has tools, heading to meeting point");
    await bot.walkTo(MEETING_POINT.x, MEETING_POINT.z);
    await deliverToKing();

    // ═══════════════════════════════════════════════════════
    //  PHASE 3: INFINITE PICKPOCKET LOOP
    //  Push thieving as high as possible, bank gold
    // ═══════════════════════════════════════════════════════
    console.log("[FINGERS] Phase 3: Infinite thieving loop");
    await sdk.say("fingers going infinite");

    let totalGP = 0;

    while (true) {
      const skill = sdk.getSkill("Thieving");

      // After Thieving 40, move to Al Kharid warriors for better GP
      if (skill && skill.level >= 40) {
        console.log("[FINGERS] Upgrading to Al Kharid warriors");
        await bot.walkTo(3268, 3228);
        // Pay toll
        try {
          await bot.interactLoc(/gate/i, /pay/i);
          await bot.navigateDialog([1]);
          await bot.waitForDialogClose();
        } catch (_) {
          await bot.walkTo(3277, 3227);
        }
        await bot.walkTo(3293, 3170);

        while (true) {
          try {
            await bot.pickpocketNpc(/al.kharid warrior/i);
          } catch (_) {}
          await bot.dismissBlockingUI();

          const state = sdk.getState();
          if (state?.player && state.player.hp < state.player.maxHp * 0.4) {
            await bot.walkTo(3273, 3180);
            const kebab = sdk.findNearbyNpc(/kebab/i);
            if (kebab) {
              await bot.openShop(kebab);
              try { await bot.buyFromShop(/kebab/i, 5); } catch (_) {}
              await bot.closeShop();
            }
            const food = sdk.findInventoryItem(/kebab/i);
            if (food) await bot.eatFood(food);
            await bot.walkTo(3293, 3170);
          }

          const coins = sdk.countInventoryItems(/coins/i);
          if (coins > 300) {
            await bot.walkTo(3269, 3167);
            await bot.openBank();
            await bot.depositItem(/coins/i, -1);
            await bot.closeBank();
            totalGP += coins;
            console.log(`[FINGERS] Banked ${coins} GP (total: ${totalGP})`);
            await bot.walkTo(3293, 3170);
          }
        }
      }

      // Pre-40: pickpocket men at Lumbridge
      try {
        await bot.pickpocketNpc(/^man$/i);
      } catch (_) {}
      await bot.dismissBlockingUI();

      if (sdk.getInventory().length >= 26) {
        await bot.walkTo(3092, 3243);
        await bot.openBank();
        await bot.depositItem(/coins/i, -1);
        await bot.closeBank();
        await bot.walkTo(MEETING_POINT.x, MEETING_POINT.z);
      }
    }
  },
  { timeout: 7_200_000 }
);

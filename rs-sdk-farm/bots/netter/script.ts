import { runScript } from "../../sdk/runner";

// DRONE: THE FISHER — nets shrimp at Draynor, delivers raw fish to KING
// KING cooks the fish (for Cooking XP) and eats them during combat.
// Continuous food pipeline = KING never stops fighting.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    await bot.skipTutorial();

    const MEETING_POINT = { x: 3222, z: 3218 };
    const DRAYNOR_FISH = { x: 3087, z: 3230 };
    const PORT_SARIM_SHOP = { x: 3014, z: 3224 };

    // Safe route from Lumbridge to Draynor (avoids Dark Wizards)
    const SAFE_TO_DRAYNOR = [
      { x: 3200, z: 3240 },
      { x: 3150, z: 3250 },
      { x: 3100, z: 3240 },
      { x: 3087, z: 3230 },
    ];

    const SAFE_TO_LUMBRIDGE = [
      { x: 3100, z: 3250 },
      { x: 3150, z: 3260 },
      { x: 3200, z: 3240 },
      { x: 3222, z: 3218 },
    ];

    async function walkWaypoints(points: { x: number; z: number }[]) {
      for (const p of points) {
        await bot.walkTo(p.x, p.z);
      }
    }

    async function deliverToKing() {
      await sdk.say("netter delivering fish");
      const king = sdk.findNearbyPlayer(/king/i);
      if (!king) {
        console.log("[NETTER] King not at meeting point, waiting...");
        const msg = await sdk.waitForChat({
          matching: /king.*(range|ready|here|food)/i,
          timeout: 45_000,
        });
        if (!msg) return false;
      }

      const kingPlayer = sdk.findNearbyPlayer(/king/i);
      if (!kingPlayer) return false;

      try {
        await bot.tradeWith(kingPlayer);
        const fish = sdk.getInventory().filter(
          (i) => /shrimps|anchovies|raw/i.test(i.name)
        );
        if (fish.length > 0) {
          await bot.offerTradeItems(
            fish.map((f) => ({ name: new RegExp(f.name, "i"), amount: f.stackSize }))
          );
          await bot.acceptTrade();
        }
        return true;
      } catch (_) {
        try { await bot.declineTrade(); } catch (_) {}
        return false;
      }
    }

    // ═══════════════════════════════════════════════════════
    //  PHASE 1: GET A FISHING NET — pickpocket, walk to Port Sarim
    // ═══════════════════════════════════════════════════════
    console.log("[NETTER] Phase 1: Acquiring fishing net");
    await sdk.say("netter gearing up");

    await bot.walkTo(MEETING_POINT.x, MEETING_POINT.z);

    for (let i = 0; i < 8; i++) {
      try { await bot.pickpocketNpc(/^man$/i); } catch (_) {}
      await bot.dismissBlockingUI();
    }

    console.log("[NETTER] Walking to Port Sarim for fishing net");
    await walkWaypoints(SAFE_TO_DRAYNOR);
    await bot.walkTo(3040, 3230);
    await bot.walkTo(PORT_SARIM_SHOP.x, PORT_SARIM_SHOP.z);

    await bot.openShop(/gerrant/i);
    await bot.buyFromShop(/small fishing net/i, 1);
    await bot.closeShop();

    // ═══════════════════════════════════════════════════════
    //  PHASE 2: FISH FOREVER — net shrimp at Draynor
    // ═══════════════════════════════════════════════════════
    console.log("[NETTER] Phase 2: Fishing loop at Draynor");
    await bot.walkTo(DRAYNOR_FISH.x, DRAYNOR_FISH.z);
    await sdk.say("netter fishing at draynor");

    let deliveries = 0;

    while (true) {
      const invCount = sdk.getInventory().length;

      if (invCount >= 27) {
        console.log(`[NETTER] Inventory full, delivery #${deliveries + 1}`);
        await walkWaypoints(SAFE_TO_LUMBRIDGE);

        let delivered = false;
        for (let attempt = 0; attempt < 3 && !delivered; attempt++) {
          delivered = await deliverToKing();
          if (!delivered) await sdk.waitForTicks(10);
        }

        if (!delivered) {
          console.log("[NETTER] King unavailable, banking at Draynor");
          await bot.walkTo(3092, 3243);
          await bot.openBank();
          await bot.depositItem(/shrimps/i, -1);
          await bot.depositItem(/anchovies/i, -1);
          await bot.depositItem(/raw/i, -1);
          await bot.closeBank();
        }

        deliveries++;
        await bot.walkTo(DRAYNOR_FISH.x, DRAYNOR_FISH.z);
        continue;
      }

      const spot = sdk.findNearbyNpc(/fishing\s*spot/i);
      if (spot) {
        try {
          await bot.interactNpc(spot, /net/i);
        } catch (_) {
          try { await bot.interactNpc(spot, 1); } catch (_) {}
        }
        await bot.dismissBlockingUI();
        await sdk.waitForTicks(3);
      } else {
        await sdk.waitForTicks(2);
      }

      const state = sdk.getState();
      const player = state?.player;
      if (player) {
        const dx = Math.abs(player.worldX - DRAYNOR_FISH.x);
        const dz = Math.abs(player.worldZ - DRAYNOR_FISH.z);
        if (dx + dz > 15) {
          await bot.walkTo(DRAYNOR_FISH.x, DRAYNOR_FISH.z);
        }
      }
    }
  },
  { timeout: 7_200_000 }
);

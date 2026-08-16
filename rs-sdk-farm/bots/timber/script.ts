import { runScript } from "../../sdk/runner";

// DRONE: THE LUMBERJACK — chops trees near Lumbridge, delivers logs to KING
// KING fletches the logs (for Fletching XP: 375 XP per log!) and burns some
// for Firemaking XP. Shortest supply route of all drones.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    await bot.skipTutorial();

    const MEETING_POINT = { x: 3222, z: 3218 };
    const TREE_AREA = { x: 3195, z: 3220 };

    async function deliverToKing() {
      await sdk.say("timber delivering logs");
      const king = sdk.findNearbyPlayer(/king/i);
      if (!king) {
        console.log("[TIMBER] King not found, waiting...");
        const msg = await sdk.waitForChat({
          matching: /king.*(chopping|ready|here|logs)/i,
          timeout: 30_000,
        });
        if (!msg) return false;
      }

      const kingPlayer = sdk.findNearbyPlayer(/king/i);
      if (!kingPlayer) return false;

      try {
        await bot.tradeWith(kingPlayer);
        const logs = sdk.getInventory().filter(
          (i) => /^(logs|oak logs|willow logs)$/i.test(i.name)
        );
        if (logs.length > 0) {
          await bot.offerTradeItems(
            logs.map((l) => ({ name: new RegExp(l.name, "i"), amount: l.stackSize }))
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
    //  PHASE 1: GET AN AXE
    // ═══════════════════════════════════════════════════════
    console.log("[TIMBER] Phase 1: Acquiring axe");
    await sdk.say("timber reporting in");

    await bot.walkTo(MEETING_POINT.x, MEETING_POINT.z);

    for (let i = 0; i < 8; i++) {
      try { await bot.pickpocketNpc(/^man$/i); } catch (_) {}
      await bot.dismissBlockingUI();
    }

    await bot.walkTo(3230, 3203);
    await bot.openShop(/^bob$/i);
    await bot.buyFromShop(/bronze axe/i, 1);
    await bot.closeShop();

    // ═══════════════════════════════════════════════════════
    //  PHASE 2: CHOP FOREVER
    // ═══════════════════════════════════════════════════════
    console.log("[TIMBER] Phase 2: Chopping loop");
    await sdk.say("timber chopping near lumbridge");
    await bot.walkTo(TREE_AREA.x, TREE_AREA.z);

    let deliveries = 0;

    while (true) {
      const invCount = sdk.getInventory().length;

      if (invCount >= 27) {
        console.log(`[TIMBER] Inventory full, delivery #${deliveries + 1}`);
        await bot.walkTo(MEETING_POINT.x, MEETING_POINT.z);

        let delivered = false;
        for (let attempt = 0; attempt < 3 && !delivered; attempt++) {
          delivered = await deliverToKing();
          if (!delivered) await sdk.waitForTicks(10);
        }

        if (!delivered) {
          console.log("[TIMBER] King unavailable, dropping logs");
          await bot.dropItem(/^logs$/i, "all");
        }

        deliveries++;
        await bot.walkTo(TREE_AREA.x, TREE_AREA.z);
        continue;
      }

      const tree = sdk.findNearbyLoc(/^tree$/i);
      if (tree) {
        try {
          await bot.chopTree(tree);
        } catch (_) {}
        await bot.dismissBlockingUI();
      } else {
        const oak = sdk.findNearbyLoc(/^oak$/i);
        if (oak) {
          try { await bot.chopTree(oak); } catch (_) {}
          await bot.dismissBlockingUI();
        } else {
          await sdk.waitForTicks(3);
        }
      }

      const state = sdk.getState();
      const player = state?.player;
      if (player) {
        const dx = Math.abs(player.worldX - TREE_AREA.x);
        const dz = Math.abs(player.worldZ - TREE_AREA.z);
        if (dx + dz > 15) {
          await bot.walkTo(TREE_AREA.x, TREE_AREA.z);
        }
      }
    }
  },
  { timeout: 7_200_000 }
);

import { runScript } from "../../sdk/runner";

// DRONE: THE MINER — mines copper + tin at SE Varrock, delivers ore to KING
// Alternates copper and tin to keep balanced loads for bronze bar smelting.
// Each delivery = 14 copper + 14 tin = 14 bronze bars for KING.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    await bot.skipTutorial();

    const MEETING_POINT = { x: 3222, z: 3218 };
    const MINE = { x: 3285, z: 3365 };
    const WAYPOINTS_TO_MINE = [
      { x: 3240, z: 3260 },
      { x: 3260, z: 3300 },
      { x: 3270, z: 3340 },
      { x: 3285, z: 3365 },
    ];
    const WAYPOINTS_TO_LUMBRIDGE = [
      { x: 3270, z: 3340 },
      { x: 3260, z: 3300 },
      { x: 3240, z: 3260 },
      { x: 3222, z: 3218 },
    ];

    async function walkWaypoints(points: { x: number; z: number }[]) {
      for (const p of points) {
        await bot.walkTo(p.x, p.z);
      }
    }

    async function deliverToKing() {
      await sdk.say("pickswing delivering ores");
      const king = sdk.findNearbyPlayer(/king/i);
      if (!king) {
        console.log("[PICKSWING] King not found, waiting...");
        await sdk.waitForChat({ matching: /king.*(furnace|ready|here)/i, timeout: 60_000 });
        return false;
      }
      try {
        await bot.tradeWith(king);
        const ores = sdk.getInventory().filter(
          (i) => /copper ore|tin ore/i.test(i.name)
        );
        if (ores.length > 0) {
          await bot.offerTradeItems(
            ores.map((o) => ({ name: new RegExp(o.name, "i"), amount: o.stackSize }))
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
    //  PHASE 1: GET A PICKAXE
    // ═══════════════════════════════════════════════════════
    console.log("[PICKSWING] Phase 1: Acquiring pickaxe");
    await sdk.say("pickswing reporting in");

    await bot.walkTo(MEETING_POINT.x, MEETING_POINT.z);
    for (let i = 0; i < 5; i++) {
      try { await bot.pickpocketNpc(/^man$/i); } catch (_) {}
      await bot.dismissBlockingUI();
    }

    await bot.walkTo(3230, 3203);
    await bot.openShop(/^bob$/i);
    await bot.buyFromShop(/bronze pickaxe/i, 1);
    await bot.closeShop();

    // ═══════════════════════════════════════════════════════
    //  PHASE 2: MINE FOREVER — alternating copper and tin
    // ═══════════════════════════════════════════════════════
    console.log("[PICKSWING] Phase 2: Mining loop");
    await sdk.say("pickswing heading to the mine");
    await walkWaypoints(WAYPOINTS_TO_MINE);

    let deliveries = 0;

    while (true) {
      const invCount = sdk.getInventory().length;

      if (invCount >= 27) {
        console.log(`[PICKSWING] Inventory full, delivery #${deliveries + 1}`);
        await walkWaypoints(WAYPOINTS_TO_LUMBRIDGE);

        let delivered = false;
        for (let attempt = 0; attempt < 3 && !delivered; attempt++) {
          delivered = await deliverToKing();
          if (!delivered) await sdk.waitForTicks(10);
        }

        if (!delivered) {
          console.log("[PICKSWING] King unavailable, banking instead");
          await bot.walkTo(3185, 3436);
          await bot.openBank();
          await bot.depositItem(/copper ore/i, -1);
          await bot.depositItem(/tin ore/i, -1);
          await bot.closeBank();
          await bot.walkTo(3185, 3436);
        }

        deliveries++;
        await walkWaypoints(WAYPOINTS_TO_MINE);
        continue;
      }

      const copperCount = sdk.countInventoryItems(/copper ore/i);
      const tinCount = sdk.countInventoryItems(/tin ore/i);
      const mineCopper = copperCount <= tinCount;

      const rockPattern = mineCopper ? /copper/i : /tin/i;
      const rock = sdk.findNearbyLoc(rockPattern, { withOption: /mine/i });

      if (rock) {
        await bot.interactLoc(rock, /mine/i);
        await bot.dismissBlockingUI();
      } else {
        const fallback = sdk.getNearbyLocs().find(
          (l) => l.options?.some((o) => /mine/i.test(o))
        );
        if (fallback) {
          await bot.interactLoc(fallback, /mine/i);
          await bot.dismissBlockingUI();
        } else {
          await sdk.waitForTicks(3);
        }
      }

      const state = sdk.getState();
      const player = state?.player;
      if (player) {
        const dx = Math.abs(player.worldX - MINE.x);
        const dz = Math.abs(player.worldZ - MINE.z);
        if (dx + dz > 20) {
          await bot.walkTo(MINE.x, MINE.z);
        }
      }
    }
  },
  { timeout: 7_200_000 }
);

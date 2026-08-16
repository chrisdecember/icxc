import { runScript } from "../../sdk/runner";

// DRONE: THE MINER — mines copper + tin at SE Varrock, delivers ore to KING
// Alternates copper and tin to keep balanced loads for bronze bar smelting.
// Each delivery = 14 copper + 14 tin = 14 bronze bars for KING.
// Enhanced: death recovery, bank fallback, ore balancing, drift correction.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    // Purge starter junk — dead slots shrink every haul.
    for (const junk of [/^bronze axe$/i, /tinderbox/i, /fishing net/i, /shrimps/i, /bucket/i, /^pot$/i, /bread/i, /bronze dagger/i, /bronze sword/i, /wooden shield/i, /shortbow/i, /arrow/i]) {
      try { await bot.dropItem(junk, "all"); } catch (_) {}
    }

    const MEETING_POINT = { x: 3222, z: 3218 };
    const MINE = { x: 3285, z: 3365 };
    const VARROCK_BANK = { x: 3185, z: 3436 };

    const WAYPOINTS_TO_MINE = [
      { x: 3240, z: 3260 },
      { x: 3260, z: 3300 },
      { x: 3270, z: 3340 },
      { x: 3285, z: 3365 },
    ];
    const WAYPOINTS_MINE_TO_LUMBRIDGE = [
      { x: 3270, z: 3340 },
      { x: 3250, z: 3300 },
      { x: 3240, z: 3260 },
      { x: 3222, z: 3218 },
    ];
    const WAYPOINTS_LUMBRIDGE_TO_MINE = WAYPOINTS_TO_MINE;

    let deliveries = 0;
    let oresMined = 0;

    async function walkWaypoints(points: { x: number; z: number }[]) {
      for (const p of points) {
        await bot.walkTo(p.x, p.z);
      }
    }

    async function isAlive() {
      const state = sdk.getState();
      if (!state?.player) return true; // state not loaded is not death
      return state.player.hp > 0;
    }

    async function recoverFromDeath() {
      console.log("[PICKSWING] Death detected — recovering");
      await sdk.waitForTicks(5);
      await bot.walkTo(MEETING_POINT.x, MEETING_POINT.z);
    }

    async function distToMine() {
      const state = sdk.getState();
      if (!state?.player) return 999;
      return (
        Math.abs(state.player.worldX - MINE.x) +
        Math.abs(state.player.worldZ - MINE.z)
      );
    }

    async function tryTradeToKing(): Promise<boolean> {
      await sdk.say("pickswing delivering ores");

      for (let attempt = 0; attempt < 3; attempt++) {
        const king = sdk.findNearbyPlayer(/king/i);
        if (!king) {
          await sdk.waitForTicks(5);
          continue;
        }
        try {
          await bot.tradeWith(king);
          const ores = sdk.getInventory().filter((i) =>
            /copper ore|tin ore/i.test(i.name)
          );
          if (ores.length > 0) {
            await bot.offerTradeItems(
              ores.map((o) => ({
                name: new RegExp(o.name, "i"),
                amount: o.stackSize,
              }))
            );
            await bot.acceptTrade();
          }
          return true;
        } catch (_) {
          try { await bot.declineTrade(); } catch (_) {}
        }
      }
      return false;
    }

    async function bankOres() {
      console.log("[PICKSWING] Banking ores at Varrock West");
      await bot.walkTo(VARROCK_BANK.x, VARROCK_BANK.z);
      try {
        await bot.openBank();
        await bot.depositItem(/copper ore/i, -1);
        await bot.depositItem(/tin ore/i, -1);
        await bot.closeBank();
      } catch (_) {}
    }

    async function mineOneOre() {
      const copperCount = sdk.countInventoryItems(/copper ore/i);
      const tinCount = sdk.countInventoryItems(/tin ore/i);
      const mineCopper = copperCount <= tinCount;

      const locs = sdk.getNearbyLocs().filter((l) =>
        l.options?.some((o) => /mine/i.test(o))
      );

      const target = mineCopper
        ? locs.find((l) => /copper/i.test(l.name))
        : locs.find((l) => /tin/i.test(l.name));

      const rock = target || locs[0];

      if (rock) {
        try {
          await bot.interactLoc(rock, /mine/i);
          oresMined++;
        } catch (_) {}
        await bot.dismissBlockingUI();
      } else {
        await sdk.waitForTicks(3);
      }
    }

    // ═══════════════════════════════════════════════════════
    //  PHASE 1: ACQUIRE PICKAXE
    // ═══════════════════════════════════════════════════════
    console.log("[PICKSWING] Phase 1: Acquiring pickaxe");
    await sdk.say("pickswing reporting in");
    await bot.walkTo(MEETING_POINT.x, MEETING_POINT.z);

    for (let i = 0; i < 5; i++) {
      try { await bot.pickpocketNpc(/^man$/i); } catch (_) {}
      await bot.dismissBlockingUI();
    }

    await bot.walkTo(3230, 3203);
    try {
      await bot.openShop(/^bob$/i);
      await bot.buyFromShop(/bronze pickaxe/i, 1);
      await bot.closeShop();
    } catch (_) {}

    // ═══════════════════════════════════════════════════════
    //  PHASE 2: MINE FOREVER — alternating copper and tin
    // ═══════════════════════════════════════════════════════
    console.log("[PICKSWING] Phase 2: Heading to SE Varrock mine");
    await sdk.say("pickswing heading to mine");
    await walkWaypoints(WAYPOINTS_TO_MINE);

    while (true) {
      if (!(await isAlive())) {
        await recoverFromDeath();
        await walkWaypoints(WAYPOINTS_LUMBRIDGE_TO_MINE);
        continue;
      }

      const invCount = sdk.getInventory().length;

      if (invCount >= 27) {
        console.log(
          `[PICKSWING] Inventory full (${oresMined} ores mined), delivery #${deliveries + 1}`
        );
        await walkWaypoints(WAYPOINTS_MINE_TO_LUMBRIDGE);

        const delivered = await tryTradeToKing();

        if (!delivered) {
          await bankOres();
        }

        deliveries++;
        await walkWaypoints(WAYPOINTS_LUMBRIDGE_TO_MINE);
        continue;
      }

      await mineOneOre();

      if ((await distToMine()) > 20) {
        await bot.walkTo(MINE.x, MINE.z);
      }
    }
  },
  { timeout: 86_400_000 }
);

import { runScript } from "../../sdk/runner";

// DRONE: THE LUMBERJACK — chops trees near Lumbridge, delivers logs to KING
// KING fletches the logs (Fletching XP: 375 XP per log!) and burns some
// for Firemaking XP. Shortest supply route of all drones.
// Enhanced: death recovery, oak upgrade at WC 15, tree drift correction.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    await bot.skipTutorial();

    const MEETING_POINT = { x: 3222, z: 3218 };
    const TREE_AREA = { x: 3195, z: 3220 };
    const OAK_AREA = { x: 3190, z: 3458 }; // Varrock oaks

    let deliveries = 0;
    let logsChopped = 0;
    let useOaks = false;

    async function isAlive() {
      const state = sdk.getState();
      return state?.player && state.player.hp > 0;
    }

    async function recoverFromDeath() {
      console.log("[TIMBER] Death detected — recovering");
      await sdk.waitForTicks(5);
      await bot.walkTo(MEETING_POINT.x, MEETING_POINT.z);
    }

    async function tryTradeToKing(): Promise<boolean> {
      await sdk.say("timber delivering logs");

      for (let attempt = 0; attempt < 3; attempt++) {
        const king = sdk.findNearbyPlayer(/king/i);
        if (!king) {
          await sdk.waitForTicks(5);
          continue;
        }
        try {
          await bot.tradeWith(king);
          const logs = sdk.getInventory().filter((i) =>
            /^(logs|oak logs|willow logs)$/i.test(i.name)
          );
          if (logs.length > 0) {
            await bot.offerTradeItems(
              logs.map((l) => ({
                name: new RegExp(l.name, "i"),
                amount: l.stackSize,
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

    async function chopOneTree() {
      const wc = sdk.getSkill("Woodcutting");
      if (wc && wc.level >= 15 && !useOaks) {
        console.log("[TIMBER] WC 15+ — upgrading to oaks");
        useOaks = true;
        await bot.walkTo(OAK_AREA.x, OAK_AREA.z);
      }

      const pattern = useOaks ? /^oak$/i : /^tree$/i;
      const tree = sdk.findNearbyLoc(pattern);

      if (tree) {
        try {
          await bot.chopTree(tree);
          logsChopped++;
        } catch (_) {}
        await bot.dismissBlockingUI();
      } else {
        // Fall back to any choppable tree
        const fallback = sdk.findNearbyLoc(/^tree$/i);
        if (fallback) {
          try {
            await bot.chopTree(fallback);
            logsChopped++;
          } catch (_) {}
          await bot.dismissBlockingUI();
        } else {
          await sdk.waitForTicks(3);
        }
      }
    }

    async function correctDrift() {
      const target = useOaks ? OAK_AREA : TREE_AREA;
      const state = sdk.getState();
      if (!state?.player) return;
      const dx = Math.abs(state.player.worldX - target.x);
      const dz = Math.abs(state.player.worldZ - target.z);
      if (dx + dz > 15) {
        await bot.walkTo(target.x, target.z);
      }
    }

    // ═══════════════════════════════════════════════════════
    //  PHASE 1: ACQUIRE AXE
    // ═══════════════════════════════════════════════════════
    console.log("[TIMBER] Phase 1: Acquiring axe");
    await sdk.say("timber reporting in");
    await bot.walkTo(MEETING_POINT.x, MEETING_POINT.z);

    for (let i = 0; i < 8; i++) {
      try { await bot.pickpocketNpc(/^man$/i); } catch (_) {}
      await bot.dismissBlockingUI();
    }

    await bot.walkTo(3230, 3203);
    try {
      await bot.openShop(/^bob$/i);
      await bot.buyFromShop(/bronze axe/i, 1);
      await bot.closeShop();
    } catch (_) {}

    // ═══════════════════════════════════════════════════════
    //  PHASE 2: CHOP FOREVER — regular trees, then oaks at 15
    // ═══════════════════════════════════════════════════════
    console.log("[TIMBER] Phase 2: Chopping at Lumbridge");
    await sdk.say("timber chopping near lumbridge");
    await bot.walkTo(TREE_AREA.x, TREE_AREA.z);

    while (true) {
      if (!(await isAlive())) {
        await recoverFromDeath();
        const target = useOaks ? OAK_AREA : TREE_AREA;
        await bot.walkTo(target.x, target.z);
        continue;
      }

      const invCount = sdk.getInventory().length;

      if (invCount >= 27) {
        console.log(
          `[TIMBER] Full (${logsChopped} chopped), delivery #${deliveries + 1}`
        );
        await bot.walkTo(MEETING_POINT.x, MEETING_POINT.z);

        const delivered = await tryTradeToKing();

        if (!delivered) {
          console.log("[TIMBER] King unavailable, dropping logs");
          try { await bot.dropItem(/logs/i, "all"); } catch (_) {}
        }

        deliveries++;
        const target = useOaks ? OAK_AREA : TREE_AREA;
        await bot.walkTo(target.x, target.z);
        continue;
      }

      await chopOneTree();
      await correctDrift();
    }
  },
  { timeout: 7_200_000 }
);

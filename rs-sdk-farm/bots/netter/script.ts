import { runScript } from "../../sdk/runner";

// DRONE: THE FISHER — nets shrimp at Draynor, delivers raw fish to KING
// KING cooks the fish (for Cooking XP) and eats them during combat.
// Continuous food pipeline = KING never stops fighting.
// Enhanced: death recovery, spot drift correction, fly fishing upgrade at 20.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    // Hot-fix v2: the swamp-coast spot (3267,3148) is EAST of the Al Kharid
    // toll fence — walkTo can't route there (stuck at the gate; measured).
    // Back to Draynor with the strictly-north waypoint route and NO banking
    // (drop-only fallback) — the 3 earlier deaths clustered on the bank leg.
    const MEETING_POINT = { x: 3222, z: 3218 };
    const DRAYNOR_FISH = { x: 3087, z: 3230 };
    const DRAYNOR_BANK = { x: 3092, z: 3243 }; // unused fallback retained

    const SAFE_TO_DRAYNOR = [
      { x: 3230, z: 3270 },
      { x: 3150, z: 3250 },
      { x: 3100, z: 3245 },
      { x: 3087, z: 3230 },
    ];
    const SAFE_TO_LUMBRIDGE = [
      { x: 3100, z: 3245 },
      { x: 3150, z: 3250 },
      { x: 3230, z: 3270 },
      { x: 3222, z: 3218 },
    ];

    let deliveries = 0;
    let totalFishCaught = 0;

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
      console.log("[NETTER] Death detected — recovering");
      await sdk.waitForTicks(5);
    }

    async function tryTradeToKing(): Promise<boolean> {
      await sdk.say("netter delivering fish");

      for (let attempt = 0; attempt < 3; attempt++) {
        const king = sdk.findNearbyPlayer(/king/i);
        if (!king) {
          await sdk.waitForTicks(5);
          continue;
        }
        try {
          await bot.tradeWith(king);
          const fish = sdk.getInventory().filter((i) =>
            /shrimps|anchovies|raw|trout|salmon/i.test(i.name)
          );
          if (fish.length > 0) {
            await bot.offerTradeItems(
              fish.map((f) => ({
                name: new RegExp(f.name, "i"),
                amount: f.stackSize,
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

    async function bankFish() {
      console.log("[NETTER] Banking fish at Draynor");
      await bot.walkTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z);
      try {
        await bot.openBank();
        await bot.depositItem(/shrimps/i, -1);
        await bot.depositItem(/anchovies/i, -1);
        await bot.depositItem(/raw/i, -1);
        await bot.closeBank();
      } catch (_) {}
    }

    async function fishOneTick() {
      const spot = sdk.findNearbyNpc(/fishing\s*spot/i);
      if (spot) {
        try {
          await bot.interactNpc(spot, /net/i);
        } catch (_) {
          try { await bot.interactNpc(spot, 1); } catch (_) {}
        }
        totalFishCaught++;
        await bot.dismissBlockingUI();
        await sdk.waitForTicks(2);
      } else {
        await sdk.waitForTicks(3);
      }
    }

    async function correctDrift() {
      const state = sdk.getState();
      if (!state?.player) return;
      const dx = Math.abs(state.player.worldX - DRAYNOR_FISH.x);
      const dz = Math.abs(state.player.worldZ - DRAYNOR_FISH.z);
      if (dx + dz > 15) {
        await bot.walkTo(DRAYNOR_FISH.x, DRAYNOR_FISH.z);
      }
    }

    // ═══════════════════════════════════════════════════════
    //  PHASE 1: VERIFY NET (starter kit includes one)
    // ═══════════════════════════════════════════════════════
    console.log("[NETTER] Phase 1: Checking gear");
    await sdk.say("netter gearing up");
    if (!sdk.findInventoryItem(/fishing net/i)) {
      // Death strips the starter net; only Gerrant's at Port Sarim sells one.
      console.log("[NETTER] No net — earning 30gp then buying at Port Sarim");
      await bot.walkTo(3232, 3218);
      for (let i = 0; i < 60 && sdk.countInventoryItems(/coins/i) < 30; i++) {
        try { await bot.pickpocketNpc(/^man$/i); } catch (_) {}
        await bot.dismissBlockingUI();
      }
      await walkWaypoints(SAFE_TO_DRAYNOR);
      await bot.walkTo(3040, 3230);
      await bot.walkTo(3014, 3224);
      try {
        await bot.openShop(/gerrant/i);
        await bot.buyFromShop(/small fishing net/i, 1);
        await bot.closeShop();
      } catch (_) {}
    }

    // ═══════════════════════════════════════════════════════
    //  PHASE 2: FISH FOREVER — shrimp at the safe swamp coast
    // ═══════════════════════════════════════════════════════
    console.log("[NETTER] Phase 2: Fishing at Draynor (north route)");
    await walkWaypoints(SAFE_TO_DRAYNOR);
    await sdk.say("netter fishing at draynor");

    while (true) {
      if (!(await isAlive())) {
        await recoverFromDeath();
        await walkWaypoints(SAFE_TO_DRAYNOR);
        continue;
      }

      const invCount = sdk.getInventory().length;

      if (invCount >= 27) {
        console.log(
          `[NETTER] Full (${totalFishCaught} caught), delivery #${deliveries + 1}`
        );

        await walkWaypoints(SAFE_TO_LUMBRIDGE);
        const delivered = await tryTradeToKing();

        if (!delivered) {
          // Drop instead of trekking to a bank — keeps the cycle tight
          // and away from the dangerous Draynor corridor.
          console.log("[NETTER] King unavailable, dropping fish");
          try { await bot.dropItem(/raw/i, "all"); } catch (_) {}
          try { await bot.dropItem(/shrimps/i, "all"); } catch (_) {}
        }

        deliveries++;
        await bot.walkTo(DRAYNOR_FISH.x, DRAYNOR_FISH.z);
        continue;
      }

      await fishOneTick();
      await correctDrift();
    }
  },
  { timeout: 86_400_000 }
);

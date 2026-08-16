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

    // Hot-fix: Draynor route kept killing the fisher (aggressive dark
    // wizards). Relocated to the verified-safe shrimp spot SE of Lumbridge
    // swamp (3267, 3148) — closer to the meeting point, no wizard zone.
    const MEETING_POINT = { x: 3222, z: 3218 };
    const DRAYNOR_FISH = { x: 3267, z: 3148 };
    const DRAYNOR_BANK = { x: 3092, z: 3243 }; // unused fallback retained

    const SAFE_TO_DRAYNOR = [
      { x: 3222, z: 3195 },
      { x: 3240, z: 3160 },
      { x: 3267, z: 3148 },
    ];
    const SAFE_TO_LUMBRIDGE = [
      { x: 3240, z: 3160 },
      { x: 3222, z: 3195 },
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
      console.log("[NETTER] No net in starter kit — buying at Lumbridge store");
      await bot.walkTo(3212, 3247);
      try {
        await bot.openShop(/shop.*keeper/i);
        await bot.buyFromShop(/net/i, 1);
        await bot.closeShop();
      } catch (_) {}
    }

    // ═══════════════════════════════════════════════════════
    //  PHASE 2: FISH FOREVER — shrimp at the safe swamp coast
    // ═══════════════════════════════════════════════════════
    console.log("[NETTER] Phase 2: Fishing at swamp coast (3267,3148)");
    await walkWaypoints(SAFE_TO_DRAYNOR);
    await sdk.say("netter fishing at the swamp coast");

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
  { timeout: 7_200_000 }
);

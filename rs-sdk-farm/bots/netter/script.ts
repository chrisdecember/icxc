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

    // Purge starter junk — dead slots shrink every haul (keep net + shrimps).
    for (const junk of [/^bronze axe$/i, /tinderbox/i, /bucket/i, /^pot$/i, /bread/i, /bronze dagger/i, /bronze sword/i, /wooden shield/i, /shortbow/i, /arrow/i, /pickaxe/i]) {
      try { await bot.dropItem(junk, "all"); } catch (_) {}
    }

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
    let lastPos = { x: 0, z: 0 };
    let lastNpcs: string[] = [];

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

    // Death strips the net — without this the fisher casts nothing forever.
    // Retries until a net is actually in the pack (a single silent shop
    // failure previously left it netless at the spot with an empty pack).
    async function ensureNet() {
      let tries = 0;
      while (!sdk.findInventoryItem(/fishing net/i) && tries < 8) {
        tries++;
        console.log(`[NETTER] No net — rebuy attempt ${tries} at Port Sarim`);
        // Gerrant's is the only reachable net source (stock 5) and the agent
        // swarm drains it. Earn Thieving XP at Lumbridge while it restocks —
        // ~4 minutes of pickpocketing between attempts, never a dead loop.
        await bot.walkTo(3232, 3218);
        for (let i = 0; i < (tries === 1 ? 60 : 130); i++) {
          if (sdk.countInventoryItems(/coins/i) >= 30 && tries === 1) break;
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
    }

    async function recoverFromDeath() {
      console.log(
        `[NETTER] Death detected — last seen at (${lastPos.x},${lastPos.z}) near [${lastNpcs.join(",")}] — recovering`
      );
      await sdk.waitForTicks(5);
      await ensureNet();
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
        let delivered = await tryTradeToKing();

        if (!delivered) {
          // KING lives at the cow field during the combat phase — bring the
          // food to the war instead of dropping it at an empty courtyard.
          await bot.walkTo(3253, 3266);
          await bot.walkTo(3253, 3290);
          delivered = await tryTradeToKing();
        }

        // Trust inventory, not trade status: a "successful" trade into a
        // full KING pack transfers nothing and loops the fisher forever.
        if (!delivered || sdk.getInventory().length >= 20) {
          console.log("[NETTER] Fish not offloaded — dropping to reset");
          try { await bot.dropItem(/raw/i, "all"); } catch (_) {}
          try { await bot.dropItem(/shrimps/i, "all"); } catch (_) {}
          try { await bot.dropItem(/anchovies/i, "all"); } catch (_) {}
        }

        deliveries++;
        await bot.walkTo(DRAYNOR_FISH.x, DRAYNOR_FISH.z);
        continue;
      }

      {
        const st = sdk.getState();
        if (st?.player) {
          lastPos = { x: st.player.worldX, z: st.player.worldZ };
          lastNpcs = [...new Set((st.nearbyNpcs ?? []).map((n: any) => n.name))].slice(0, 6) as string[];
        }
      }
      if (!sdk.findInventoryItem(/fishing net/i)) {
        await ensureNet();
        await walkWaypoints(SAFE_TO_DRAYNOR);
        continue;
      }
      // A Dark wizard wanders onto the fishing spot (forensics: died at the
      // spot with one in range). Dodge north and regen instead of dying —
      // a dodge costs ~2 min, a death costs ~8.
      {
        const st = sdk.getState();
        const wizardNear = (st?.nearbyNpcs ?? []).some((n: any) =>
          /dark wizard/i.test(n.name)
        );
        if (st?.player && wizardNear && st.player.hp <= 6) {
          console.log("[NETTER] Dark wizard close on low HP — dodging north");
          await bot.walkTo(3092, 3245);
          while (true) {
            const s = sdk.getState()?.player;
            if (!s || s.hp >= 9) break;
            await sdk.waitForTicks(20);
          }
          await bot.walkTo(DRAYNOR_FISH.x, DRAYNOR_FISH.z);
          continue;
        }
      }
      await fishOneTick();
      await correctDrift();
    }
  },
  { timeout: 86_400_000 }
);

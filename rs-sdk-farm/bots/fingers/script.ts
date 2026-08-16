import { runScript } from "../../sdk/runner";

// DRONE: THE THIEF — pickpocket machine, GP generator, tool distributor
// Pickpockets men at Lumbridge, banks gold, delivers surplus to KING.
// Thieving 1→43 in ~10 min, 1→54 in ~15 min. Generates 200+ GP fast.
// Enhanced: death recovery, kebab sustain loop, dual-phase thieving.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    const MEETING_POINT = { x: 3222, z: 3218 };
    const LUMBRIDGE_MEN = { x: 3222, z: 3218 };
    // Hot-fix: Al Kharid toll gate is impassable to walkTo (dialog toll).
    // Varrock guards are the proper Thieving-40 target and gate-free.
    const AL_KHARID_WARRIORS = { x: 3207, z: 3381 }; // Varrock south gate guards
    const AL_KHARID_BANK = { x: 3185, z: 3441 }; // Varrock West bank
    const KEBAB_SELLER = { x: 3273, z: 3180 };
    const DRAYNOR_BANK = { x: 3092, z: 3243 };

    let totalGP = 0;
    let inAlKharid = false;

    async function isAlive() {
      const state = sdk.getState();
      if (!state?.player) return true; // state not loaded is not death
      return state.player.hp > 0;
    }

    async function recoverFromDeath() {
      console.log("[FINGERS] Death detected — recovering at Lumbridge");
      await sdk.waitForTicks(5);
      inAlKharid = false;
      await bot.walkTo(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z);
    }

    async function eatIfLow(threshold = 0.4) {
      const state = sdk.getState();
      if (!state?.player) return;
      if (state.player.hp < state.player.maxHp * threshold) {
        const food =
          sdk.findInventoryItem(/kebab/i) ||
          sdk.findInventoryItem(/shrimps/i) ||
          sdk.findInventoryItem(/bread/i);
        if (food) await bot.eatFood(food);
      }
    }

    async function buyKebabs(count = 5) {
      await bot.walkTo(KEBAB_SELLER.x, KEBAB_SELLER.z);
      try {
        const seller =
          sdk.findNearbyNpc(/karim/i) || sdk.findNearbyNpc(/kebab/i);
        if (seller) {
          await bot.openShop(seller);
          await bot.buyFromShop(/kebab/i, count);
          await bot.closeShop();
        }
      } catch (_) {}
    }

    async function bankGold() {
      const bank = inAlKharid ? AL_KHARID_BANK : DRAYNOR_BANK;
      const coins = sdk.countInventoryItems(/coins/i);
      if (coins < 50) return;

      await bot.walkTo(bank.x, bank.z);
      try {
        await bot.openBank();
        await bot.depositItem(/coins/i, -1);
        await bot.closeBank();
        totalGP += coins;
        console.log(`[FINGERS] Banked ${coins} GP (total: ${totalGP})`);
      } catch (_) {}
    }

    async function deliverToKing() {
      const king = sdk.findNearbyPlayer(/king/i);
      if (!king) return false;
      try {
        const result = await bot.trade(king, { timeout: 15_000 });
        return result?.success ?? false;
      } catch (_) {
        return false;
      }
    }

    // ═══════════════════════════════════════════════════════
    //  PHASE 1: SEED MONEY — pickpocket men at Lumbridge
    // ═══════════════════════════════════════════════════════
    console.log("[FINGERS] Phase 1: Generating seed money");
    await sdk.say("fingers is on the job");
    await bot.walkTo(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z);

    while (true) {
      if (!(await isAlive())) {
        await recoverFromDeath();
        continue;
      }
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
    try {
      await bot.openShop(/shop.*keeper/i);
      try { await bot.buyFromShop(/hammer/i, 1); } catch (_) {}
      try { await bot.buyFromShop(/tinderbox/i, 1); } catch (_) {}
      await bot.closeShop();
    } catch (_) {}

    await bot.walkTo(3230, 3203);
    try {
      await bot.openShop(/^bob$/i);
      try { await bot.buyFromShop(/bronze axe/i, 1); } catch (_) {}
      try { await bot.buyFromShop(/bronze pickaxe/i, 1); } catch (_) {}
      await bot.closeShop();
    } catch (_) {}

    await sdk.say("fingers has tools heading to meeting point");
    await bot.walkTo(MEETING_POINT.x, MEETING_POINT.z);
    await deliverToKing();

    // ═══════════════════════════════════════════════════════
    //  PHASE 3: INFINITE PICKPOCKET LOOP
    //  Lumbridge men until 40, then Al Kharid warriors
    // ═══════════════════════════════════════════════════════
    console.log("[FINGERS] Phase 3: Infinite thieving loop");
    await sdk.say("fingers going infinite");

    while (true) {
      if (!(await isAlive())) {
        await recoverFromDeath();
        continue;
      }

      const skill = sdk.getSkill("Thieving");

      // Stranded-side detection: the toll fence at x=3268 is one-way for
      // walkTo. If we're already east of it (inside Al Kharid), work the
      // warriors there — never path west through the gate.
      const side = sdk.getState()?.player;
      const insideAlKharid = !!side && side.worldX >= 3269;
      const WORK = insideAlKharid
        ? { x: 3293, z: 3170, npc: /al.kharid warrior|warrior/i }
        : { x: AL_KHARID_WARRIORS.x, z: AL_KHARID_WARRIORS.z, npc: /^guard$/i };

      if (skill && skill.level >= 40 && !inAlKharid) {
        console.log(
          `[FINGERS] Upgrading to ${insideAlKharid ? "Al Kharid warriors (stranded east)" : "Varrock guards"}`
        );
        await bot.walkTo(WORK.x, WORK.z);
        inAlKharid = true;
        continue;
      }

      if (inAlKharid) {
        try {
          await bot.pickpocketNpc(WORK.npc);
        } catch (_) {}
        await bot.dismissBlockingUI();
        await eatIfLow(0.4);

        const st = sdk.getState();
        if (
          st?.player &&
          Math.abs(st.player.worldX - WORK.x) +
            Math.abs(st.player.worldZ - WORK.z) >
            25
        ) {
          await bot.walkTo(WORK.x, WORK.z);
        }

        if (sdk.countInventoryItems(/coins/i) > 300) {
          await bankGold();
          await bot.walkTo(AL_KHARID_WARRIORS.x, AL_KHARID_WARRIORS.z);
        }
      } else {
        try {
          await bot.pickpocketNpc(/^man$/i);
        } catch (_) {}
        await bot.dismissBlockingUI();

        if (sdk.getInventory().length >= 26) {
          await bankGold();
          await bot.walkTo(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z);
        }
      }
    }
  },
  { timeout: 86_400_000 }
);

import { runScript } from "../../sdk/runner";

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    await bot.skipTutorial();

    async function collectDeliveries(duration = 45_000) {
      console.log("[KING] Accepting deliveries...");
      try {
        await bot.serveTrades({ timeout: duration });
      } catch (_) {}
    }

    async function smeltAllBronze() {
      const furnaceLoc = (await sdk.scanFindNearbyLoc(/furnace/i)) ||
        sdk.findNearbyLoc(/furnace/i);
      if (!furnaceLoc) return;

      while (
        sdk.findInventoryItem(/copper ore/i) &&
        sdk.findInventoryItem(/tin ore/i)
      ) {
        const copper = sdk.findInventoryItem(/copper ore/i);
        if (copper) {
          await bot.useItemOnLoc(copper, furnaceLoc);
          await bot.dismissBlockingUI();
        }
      }
    }

    async function cookAllFish() {
      const range = sdk.findNearbyLoc(/^range$/i);
      if (!range) return;

      while (sdk.findInventoryItem(/raw shrimps/i)) {
        const raw = sdk.findInventoryItem(/raw shrimps/i);
        if (raw) {
          await bot.useItemOnLoc(raw, range);
          await bot.dismissBlockingUI();
        }
      }
    }

    // ═══════════════════════════════════════════════════════
    //  PHASE 1: THIEVING BLITZ — fastest skill in the game
    // ═══════════════════════════════════════════════════════
    console.log("[KING] Phase 1: Thieving blitz");
    await sdk.say("the king has arrived");
    await bot.walkTo(3222, 3218);

    while (true) {
      const skill = sdk.getSkill("Thieving");
      if (skill && skill.level >= 40) break;
      try {
        await bot.pickpocketNpc(/^man$/i);
      } catch (_) {}
      await bot.dismissBlockingUI();
    }
    console.log("[KING] Thieving 40+ achieved");

    // ═══════════════════════════════════════════════════════
    //  PHASE 2: TOOL ACQUISITION — spend that stolen gold
    // ═══════════════════════════════════════════════════════
    console.log("[KING] Phase 2: Shopping spree");

    await bot.walkTo(3212, 3247);
    await bot.openShop(/shop.*keeper/i);
    try { await bot.buyFromShop(/hammer/i, 1); } catch (_) {}
    try { await bot.buyFromShop(/tinderbox/i, 1); } catch (_) {}
    await bot.closeShop();

    await bot.walkTo(3230, 3203);
    await bot.openShop(/^bob$/i);
    try { await bot.buyFromShop(/bronze axe/i, 1); } catch (_) {}
    await bot.closeShop();

    await bot.walkTo(3224, 3202);
    await sdk.waitForTicks(5);
    const knife = sdk.findGroundItem(/knife/i) ||
      (await sdk.scanFindGroundItem(/knife/i));
    if (knife) await bot.pickupItem(knife);

    // ═══════════════════════════════════════════════════════
    //  PHASE 3: WOODCUTTING + FLETCHING + FIREMAKING BURST
    // ═══════════════════════════════════════════════════════
    console.log("[KING] Phase 3: WC / Fletch / Firemaking");
    await sdk.say("king chopping wood");
    await bot.walkTo(3195, 3220);

    for (let i = 0; i < 20; i++) {
      const tree = sdk.findNearbyLoc(/^tree$/i);
      if (!tree) {
        await sdk.waitForTicks(3);
        continue;
      }

      await bot.chopTree(tree);
      await bot.dismissBlockingUI();

      if (i % 2 === 1) {
        try { await bot.fletchLogs(); } catch (_) {}
        await bot.dismissBlockingUI();
      }
      if (i % 5 === 4) {
        try { await bot.burnLogs(); } catch (_) {}
        await bot.dismissBlockingUI();
      }

      if (sdk.getInventory().length >= 26) {
        while (sdk.findInventoryItem(/^logs$/i)) {
          try { await bot.fletchLogs(); } catch (_) {}
          await bot.dismissBlockingUI();
        }
        await bot.dropItem(/arrow shaft/i, "all");
      }
    }

    while (sdk.findInventoryItem(/^logs$/i)) {
      try { await bot.fletchLogs(); } catch (_) {}
      try { await bot.burnLogs(); } catch (_) {}
      await bot.dismissBlockingUI();
    }
    try { await bot.dropItem(/arrow shaft/i, "all"); } catch (_) {}

    // ═══════════════════════════════════════════════════════
    //  PHASE 4: RECEIVE ORES → SMELT → SMITH
    // ═══════════════════════════════════════════════════════
    console.log("[KING] Phase 4: Smelting & Smithing");
    await sdk.say("king at furnace bring ores now");

    try { await bot.dropItem(/arrow shaft/i, "all"); } catch (_) {}
    try { await bot.dropItem(/knife/i, "all"); } catch (_) {}

    await bot.walkTo(3225, 3256);
    await collectDeliveries(60_000);
    await smeltAllBronze();

    console.log("[KING] Walking to Varrock anvil");
    await bot.walkTo(3250, 3395);
    await bot.walkTo(3230, 3410);
    await bot.walkTo(3210, 3425);
    await bot.walkTo(3188, 3421);

    while (sdk.findInventoryItem(/bronze bar/i)) {
      try {
        await bot.smithAtAnvil("dagger");
      } catch (_) {}
      await bot.dismissBlockingUI();
    }

    // ═══════════════════════════════════════════════════════
    //  PHASE 5: RECEIVE FISH → COOK
    // ═══════════════════════════════════════════════════════
    console.log("[KING] Phase 5: Cooking");
    await sdk.say("king at range bring fish now");

    await bot.walkTo(3210, 3425);
    await bot.walkTo(3230, 3350);
    await bot.walkTo(3230, 3280);
    await bot.walkTo(3230, 3220);
    await bot.walkTo(3230, 3196);

    await collectDeliveries(60_000);
    await cookAllFish();

    // ═══════════════════════════════════════════════════════
    //  PHASE 6: THE WAR — equip, fight, pray, feast, repeat
    // ═══════════════════════════════════════════════════════
    console.log("[KING] Phase 6: COMBAT — the king rides to war");
    await sdk.say("the king rides to war");

    const weapon =
      sdk.findInventoryItem(/bronze dagger/i) ||
      sdk.findInventoryItem(/bronze sword/i);
    if (weapon) await bot.equipItem(weapon);

    await bot.walkTo(3253, 3266);
    await bot.walkTo(3253, 3290);

    let killsSinceResupply = 0;

    while (true) {
      const state = sdk.getState();
      if (!state?.player) {
        await sdk.waitForTicks(2);
        continue;
      }

      if (state.player.hp < state.player.maxHp * 0.5) {
        const food =
          sdk.findInventoryItem(/^shrimps$/i) ||
          sdk.findInventoryItem(/^anchovies$/i) ||
          sdk.findInventoryItem(/^cooked/i);
        if (food) {
          await bot.eatFood(food);
        } else if (killsSinceResupply > 10) {
          console.log("[KING] Out of food — resupply run");
          await sdk.say("king needs food deliver now");
          await bot.walkTo(3222, 3218);
          await collectDeliveries(45_000);

          await bot.walkTo(3230, 3196);
          await cookAllFish();

          await bot.walkTo(3253, 3266);
          await bot.walkTo(3253, 3290);
          killsSinceResupply = 0;
          continue;
        }
      }

      const cow = sdk.findNearbyNpc(/^cow$/i);
      if (cow) {
        try {
          await bot.attack(cow);
        } catch (_) {}
        await sdk.waitForTicks(4);
        killsSinceResupply++;
      } else {
        await sdk.waitForTicks(2);
      }

      const bones = sdk.findGroundItem(/^bones$/i);
      if (bones) {
        try {
          await bot.pickupItem(bones);
          const invBones = sdk.findInventoryItem(/^bones$/i);
          if (invBones) await sdk.sendUseItem(invBones.slot);
        } catch (_) {}
      }

      if (sdk.countInventoryItems(/cowhide/i) > 3) {
        try { await bot.dropItem(/cowhide/i, "all"); } catch (_) {}
      }

      await bot.dismissBlockingUI();
    }
  },
  { timeout: 7_200_000 }
);

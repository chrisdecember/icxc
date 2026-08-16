import { runScript } from "../../sdk/runner";

// THE LONE WOLF — single-bot total-level speedrun
// No drones, no trades, no coordination overhead. One bot does everything.
// Trains 11+ skills sequentially with maximum efficiency.
// The accelerated XP curve makes this viable against the full swarm.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    await bot.skipTutorial();

    const LUMBRIDGE_SPAWN = { x: 3222, z: 3218 };
    const LUMBRIDGE_TREES = { x: 3195, z: 3220 };
    const LUMBRIDGE_FURNACE = { x: 3225, z: 3256 };
    const LUMBRIDGE_RANGE = { x: 3230, z: 3196 };
    const SE_VARROCK_MINE = { x: 3285, z: 3365 };
    const VARROCK_ANVIL = { x: 3188, z: 3421 };
    const DRAYNOR_FISH = { x: 3087, z: 3230 };
    const PORT_SARIM_SHOP = { x: 3014, z: 3224 };
    const COW_FIELD = { x: 3253, z: 3290 };
    const COW_GATE = { x: 3253, z: 3266 };

    let totalKills = 0;
    let combatStyle = 0;

    function updateCombatStyle() {
      const newStyle = Math.floor(totalKills / 5) % 3;
      if (newStyle !== combatStyle) {
        combatStyle = newStyle;
        const name = ["Attack", "Strength", "Defence"][combatStyle];
        console.log(`[WOLF] Combat style -> ${name}`);
        sdk.sendSetCombatStyle(combatStyle);
      }
    }

    async function eatIfLow(threshold = 0.5): Promise<boolean> {
      const state = sdk.getState();
      if (!state?.player) return false;
      if (state.player.hp >= state.player.maxHp * threshold) return false;
      const food =
        sdk.findInventoryItem(/^shrimps$/i) ||
        sdk.findInventoryItem(/^anchovies$/i) ||
        sdk.findInventoryItem(/^cooked/i) ||
        sdk.findInventoryItem(/^kebab$/i);
      if (food) {
        await bot.eatFood(food);
        return true;
      }
      return false;
    }

    function logSkills(names: string[]) {
      for (const n of names) {
        const s = sdk.getSkill(n);
        if (s && s.level > 1) console.log(`[WOLF]   ${n}: ${s.level}`);
      }
    }

    // ═══════════════════════════════════════════════════════
    //  PHASE 1: THIEVING BLITZ (0-10 min)
    //  Pickpocket men → Level 40+, generates 200+ GP
    // ═══════════════════════════════════════════════════════
    console.log("[WOLF] Phase 1: Thieving blitz");
    await sdk.say("the lone wolf hunts alone");
    await bot.walkTo(LUMBRIDGE_SPAWN.x, LUMBRIDGE_SPAWN.z);

    while (true) {
      const skill = sdk.getSkill("Thieving");
      if (skill && skill.level >= 40) break;
      try { await bot.pickpocketNpc(/^man$/i); } catch (_) {}
      await bot.dismissBlockingUI();
    }
    console.log(`[WOLF] Thieving ${sdk.getSkill("Thieving")?.level}`);

    // ═══════════════════════════════════════════════════════
    //  PHASE 2: TOOL ACQUISITION (10-12 min)
    // ═══════════════════════════════════════════════════════
    console.log("[WOLF] Phase 2: Shopping");

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

    await bot.walkTo(3224, 3202);
    await sdk.waitForTicks(5);
    const knife = sdk.findGroundItem(/knife/i) ||
      (await sdk.scanFindGroundItem(/knife/i));
    if (knife) await bot.pickupItem(knife);

    // ═══════════════════════════════════════════════════════
    //  PHASE 3: WOODCUTTING + FLETCHING + FIREMAKING (12-22 min)
    //  Chop 20 trees. Fletch half → 375 XP/log. Burn rest.
    // ═══════════════════════════════════════════════════════
    console.log("[WOLF] Phase 3: WC / Fletch / FM");
    await bot.walkTo(LUMBRIDGE_TREES.x, LUMBRIDGE_TREES.z);

    for (let i = 0; i < 20; i++) {
      const tree = sdk.findNearbyLoc(/^tree$/i);
      if (!tree) { await sdk.waitForTicks(3); continue; }

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
        try { await bot.dropItem(/arrow shaft/i, "all"); } catch (_) {}
      }
    }

    while (sdk.findInventoryItem(/^logs$/i)) {
      try { await bot.fletchLogs(); } catch (_) {}
      try { await bot.burnLogs(); } catch (_) {}
      await bot.dismissBlockingUI();
    }
    try { await bot.dropItem(/arrow shaft/i, "all"); } catch (_) {}
    try { await bot.dropItem(/knife/i, "all"); } catch (_) {}

    logSkills(["Woodcutting", "Fletching", "Firemaking"]);

    // ═══════════════════════════════════════════════════════
    //  PHASE 4: MINING (22-35 min)
    //  Walk to SE Varrock mine. Mine 14 copper + 14 tin.
    // ═══════════════════════════════════════════════════════
    console.log("[WOLF] Phase 4: Mining at SE Varrock");
    await bot.walkTo(3240, 3260);
    await bot.walkTo(3260, 3300);
    await bot.walkTo(3270, 3340);
    await bot.walkTo(SE_VARROCK_MINE.x, SE_VARROCK_MINE.z);

    while (
      sdk.countInventoryItems(/copper ore/i) < 14 ||
      sdk.countInventoryItems(/tin ore/i) < 14
    ) {
      const copperCount = sdk.countInventoryItems(/copper ore/i);
      const tinCount = sdk.countInventoryItems(/tin ore/i);
      const needCopper = copperCount < 14;
      const needTin = tinCount < 14;
      const mineCopper = needCopper && (!needTin || copperCount <= tinCount);

      const locs = sdk.getNearbyLocs().filter((l) =>
        l.options?.some((o: string) => /mine/i.test(o))
      );
      const target = mineCopper
        ? locs.find((l) => /copper/i.test(l.name))
        : locs.find((l) => /tin/i.test(l.name));
      const rock = target || locs[0];

      if (rock) {
        try { await bot.interactLoc(rock, /mine/i); } catch (_) {}
        await bot.dismissBlockingUI();
      } else {
        await sdk.waitForTicks(3);
      }

      const state = sdk.getState();
      if (state?.player) {
        const dx = Math.abs(state.player.worldX - SE_VARROCK_MINE.x);
        const dz = Math.abs(state.player.worldZ - SE_VARROCK_MINE.z);
        if (dx + dz > 20) await bot.walkTo(SE_VARROCK_MINE.x, SE_VARROCK_MINE.z);
      }
    }

    console.log(
      `[WOLF] Mined ${sdk.countInventoryItems(/copper ore/i)} copper, ` +
      `${sdk.countInventoryItems(/tin ore/i)} tin`
    );

    // ═══════════════════════════════════════════════════════
    //  PHASE 5: SMELTING + SMITHING (35-45 min)
    //  Smelt at Lumbridge furnace, smith at Varrock anvil.
    // ═══════════════════════════════════════════════════════
    console.log("[WOLF] Phase 5: Smelting & Smithing");

    await bot.walkTo(3270, 3340);
    await bot.walkTo(3260, 3300);
    await bot.walkTo(3240, 3260);
    await bot.walkTo(LUMBRIDGE_FURNACE.x, LUMBRIDGE_FURNACE.z);

    const furnace = (await sdk.scanFindNearbyLoc(/furnace/i)) ||
      sdk.findNearbyLoc(/furnace/i);

    let smelted = 0;
    while (
      sdk.findInventoryItem(/copper ore/i) &&
      sdk.findInventoryItem(/tin ore/i)
    ) {
      const copper = sdk.findInventoryItem(/copper ore/i);
      if (copper && furnace) {
        await bot.useItemOnLoc(copper, furnace);
        await bot.dismissBlockingUI();
        smelted++;
      }
    }
    console.log(`[WOLF] Smelted ${smelted} bronze bars`);

    await bot.walkTo(3250, 3395);
    await bot.walkTo(3230, 3410);
    await bot.walkTo(3210, 3425);
    await bot.walkTo(VARROCK_ANVIL.x, VARROCK_ANVIL.z);

    let smithed = 0;
    while (sdk.findInventoryItem(/bronze bar/i)) {
      try { await bot.smithAtAnvil("dagger"); smithed++; } catch (_) {}
      await bot.dismissBlockingUI();
    }
    console.log(`[WOLF] Smithed ${smithed} daggers`);
    logSkills(["Mining", "Smithing"]);

    // ═══════════════════════════════════════════════════════
    //  PHASE 6: FISHING (45-55 min)
    //  Walk to Port Sarim for net, fish at Draynor.
    // ═══════════════════════════════════════════════════════
    console.log("[WOLF] Phase 6: Fishing");

    const weapon = sdk.findInventoryItem(/bronze dagger/i);
    if (weapon) await bot.equipItem(weapon);

    await bot.walkTo(3210, 3425);
    await bot.walkTo(3200, 3400);
    await bot.walkTo(3150, 3350);
    await bot.walkTo(3100, 3300);
    await bot.walkTo(3100, 3250);
    await bot.walkTo(3087, 3230);
    await bot.walkTo(3040, 3230);
    await bot.walkTo(PORT_SARIM_SHOP.x, PORT_SARIM_SHOP.z);

    try {
      await bot.openShop(/gerrant/i);
      await bot.buyFromShop(/small fishing net/i, 1);
      await bot.closeShop();
    } catch (_) {
      try {
        const shopkeeper = sdk.findNearbyNpc(/shop/i);
        if (shopkeeper) {
          await bot.openShop(shopkeeper);
          await bot.buyFromShop(/net/i, 1);
          await bot.closeShop();
        }
      } catch (_) {}
    }

    await bot.walkTo(DRAYNOR_FISH.x, DRAYNOR_FISH.z);

    let fishCaught = 0;
    while (fishCaught < 26) {
      const spot = sdk.findNearbyNpc(/fishing\s*spot/i);
      if (spot) {
        try { await bot.interactNpc(spot, /net/i); } catch (_) {
          try { await bot.interactNpc(spot, 1); } catch (_) {}
        }
        fishCaught++;
        await bot.dismissBlockingUI();
        await sdk.waitForTicks(2);
      } else {
        await sdk.waitForTicks(3);
      }

      const state = sdk.getState();
      if (state?.player) {
        const dx = Math.abs(state.player.worldX - DRAYNOR_FISH.x);
        const dz = Math.abs(state.player.worldZ - DRAYNOR_FISH.z);
        if (dx + dz > 15) await bot.walkTo(DRAYNOR_FISH.x, DRAYNOR_FISH.z);
      }
    }
    console.log(`[WOLF] Caught ${fishCaught} fish`);

    // ═══════════════════════════════════════════════════════
    //  PHASE 7: COOKING (55-60 min)
    //  Walk to Lumbridge range, cook everything.
    // ═══════════════════════════════════════════════════════
    console.log("[WOLF] Phase 7: Cooking");

    await bot.walkTo(3100, 3250);
    await bot.walkTo(3150, 3260);
    await bot.walkTo(3200, 3240);
    await bot.walkTo(LUMBRIDGE_RANGE.x, LUMBRIDGE_RANGE.z);

    const range = sdk.findNearbyLoc(/^range$/i);
    let cooked = 0;

    while (sdk.findInventoryItem(/raw shrimps/i)) {
      const raw = sdk.findInventoryItem(/raw shrimps/i);
      if (raw && range) {
        await bot.useItemOnLoc(raw, range);
        await bot.dismissBlockingUI();
        cooked++;
      }
    }
    while (sdk.findInventoryItem(/raw anchovies/i)) {
      const raw = sdk.findInventoryItem(/raw anchovies/i);
      if (raw && range) {
        await bot.useItemOnLoc(raw, range);
        await bot.dismissBlockingUI();
        cooked++;
      }
    }
    console.log(`[WOLF] Cooked ${cooked} fish`);
    logSkills(["Fishing", "Cooking"]);

    // ═══════════════════════════════════════════════════════
    //  PHASE 8: COMBAT GRIND (60-120 min)
    //  Fight cows with style rotation. Bury bones. Eat food.
    // ═══════════════════════════════════════════════════════
    console.log("[WOLF] Phase 8: COMBAT — the wolf hunts");
    await sdk.say("the lone wolf hunts");

    sdk.sendSetCombatStyle(combatStyle);
    await bot.walkTo(COW_GATE.x, COW_GATE.z);
    await bot.walkTo(COW_FIELD.x, COW_FIELD.z);

    while (true) {
      const state = sdk.getState();
      if (!state?.player) { await sdk.waitForTicks(2); continue; }

      if (state.player.hp <= 0) {
        console.log("[WOLF] Death! Recovering...");
        await sdk.waitForTicks(10);
        const reWeapon = sdk.findInventoryItem(/bronze dagger/i);
        if (reWeapon) await bot.equipItem(reWeapon);
        await bot.walkTo(COW_GATE.x, COW_GATE.z);
        await bot.walkTo(COW_FIELD.x, COW_FIELD.z);
        continue;
      }

      await eatIfLow(0.5);

      const cow = sdk.findNearbyNpc(/^cow$/i);
      if (cow) {
        try { await bot.attack(cow); } catch (_) {}
        await sdk.waitForTicks(4);
        totalKills++;
        updateCombatStyle();
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

      // Out of food? Quick fishing run then come back.
      const hasFood =
        sdk.findInventoryItem(/shrimps/i) ||
        sdk.findInventoryItem(/anchovies/i) ||
        sdk.findInventoryItem(/cooked/i);

      if (!hasFood && totalKills > 20 && state.player.hp < state.player.maxHp * 0.6) {
        console.log("[WOLF] Emergency fishing run");

        await bot.walkTo(3200, 3240);
        await bot.walkTo(3150, 3250);
        await bot.walkTo(3100, 3240);
        await bot.walkTo(DRAYNOR_FISH.x, DRAYNOR_FISH.z);

        let emergency = 0;
        while (emergency < 20) {
          const spot = sdk.findNearbyNpc(/fishing\s*spot/i);
          if (spot) {
            try { await bot.interactNpc(spot, /net/i); } catch (_) {
              try { await bot.interactNpc(spot, 1); } catch (_) {}
            }
            emergency++;
            await bot.dismissBlockingUI();
            await sdk.waitForTicks(2);
          } else {
            await sdk.waitForTicks(3);
          }
        }

        await bot.walkTo(3100, 3250);
        await bot.walkTo(3150, 3260);
        await bot.walkTo(3200, 3240);
        await bot.walkTo(LUMBRIDGE_RANGE.x, LUMBRIDGE_RANGE.z);

        const range2 = sdk.findNearbyLoc(/^range$/i);
        while (sdk.findInventoryItem(/raw shrimps/i)) {
          const raw = sdk.findInventoryItem(/raw shrimps/i);
          if (raw && range2) {
            await bot.useItemOnLoc(raw, range2);
            await bot.dismissBlockingUI();
          }
        }

        await bot.walkTo(COW_GATE.x, COW_GATE.z);
        await bot.walkTo(COW_FIELD.x, COW_FIELD.z);
        continue;
      }

      if (totalKills % 50 === 0 && totalKills > 0) {
        const atk = sdk.getSkill("Attack")?.level ?? 0;
        const str = sdk.getSkill("Strength")?.level ?? 0;
        const def = sdk.getSkill("Defence")?.level ?? 0;
        const hp = sdk.getSkill("Hitpoints")?.level ?? 0;
        const pray = sdk.getSkill("Prayer")?.level ?? 0;
        console.log(
          `[WOLF] Kills: ${totalKills} | ` +
          `Atk ${atk} / Str ${str} / Def ${def} / HP ${hp} / Pray ${pray}`
        );
      }
    }
  },
  { timeout: 7_200_000 }
);

import { runScript } from "../../sdk/runner";

// THE LONE WOLF — single-bot speedrun that trains every skill sequentially.
// No drones, no trades, no coordination. One bot, maximum efficiency.
// Exploits the accelerated XP curve to blitz each skill in sequence.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    // ─── Constants ───────────────────────────────────────
    const LUMBRIDGE_SPAWN = { x: 3222, z: 3218 };
    const LUMBRIDGE_TREES = { x: 3195, z: 3220 };
    const LUMBRIDGE_FURNACE = { x: 3225, z: 3256 };
    const LUMBRIDGE_RANGE = { x: 3230, z: 3196 };
    const COW_FIELD = { x: 3253, z: 3290 };
    const COW_GATE = { x: 3253, z: 3266 };
    const SE_VARROCK_MINE = { x: 3285, z: 3365 };
    const VARROCK_ANVIL = { x: 3188, z: 3421 };
    const DRAYNOR_FISH = { x: 3087, z: 3230 };
    const PORT_SARIM_SHOP = { x: 3014, z: 3224 };

    const WAYPOINTS_TO_MINE = [
      { x: 3240, z: 3260 },
      { x: 3260, z: 3300 },
      { x: 3270, z: 3340 },
      { x: 3285, z: 3365 },
    ];

    const WAYPOINTS_MINE_TO_FURNACE = [
      { x: 3270, z: 3340 },
      { x: 3260, z: 3300 },
      { x: 3240, z: 3260 },
      { x: 3225, z: 3256 },
    ];

    const WAYPOINTS_TO_VARROCK_ANVIL = [
      { x: 3250, z: 3395 },
      { x: 3230, z: 3410 },
      { x: 3210, z: 3425 },
      { x: 3188, z: 3421 },
    ];

    const WAYPOINTS_ANVIL_TO_LUMBRIDGE = [
      { x: 3210, z: 3425 },
      { x: 3230, z: 3350 },
      { x: 3230, z: 3280 },
      { x: 3230, z: 3220 },
    ];

    // Safe route avoiding dark wizards near (3220, 3220)
    const SAFE_TO_DRAYNOR = [
      { x: 3200, z: 3240 },
      { x: 3150, z: 3250 },
      { x: 3100, z: 3240 },
      { x: 3087, z: 3230 },
    ];

    const SAFE_TO_LUMBRIDGE = [
      { x: 3100, z: 3250 },
      { x: 3150, z: 3260 },
      { x: 3200, z: 3240 },
      { x: 3222, z: 3218 },
    ];

    let totalKills = 0;
    let combatStyle = 0;

    // ─── Helpers ─────────────────────────────────────────

    async function walkWaypoints(points: { x: number; z: number }[]) {
      for (const p of points) {
        await bot.walkTo(p.x, p.z);
      }
    }

    /** Eat available food if HP is low. Returns true if food was eaten. */
    async function eatIfLow(threshold = 0.5): Promise<boolean> {
      const state = sdk.getState();
      if (!state?.player) return false;
      if (state.player.hp >= state.player.maxHp * threshold) return false;

      const food =
        sdk.findInventoryItem(/^shrimps$/i) ||
        sdk.findInventoryItem(/^anchovies$/i) ||
        sdk.findInventoryItem(/^cooked/i);
      if (food) {
        await bot.eatFood(food);
        return true;
      }
      return false;
    }

    /** Update combat style based on kill count (rotates every 5 kills). */
    function updateCombatStyle() {
      const newStyle = Math.floor(totalKills / 5) % 3;
      if (newStyle !== combatStyle) {
        combatStyle = newStyle;
        const styleName = ["Attack", "Strength", "Defence"][combatStyle];
        console.log(
          `[WOLF] Combat style -> ${styleName} (style ${combatStyle})`
        );
        sdk.sendSetCombatStyle(combatStyle);
      }
    }

    /** Log current levels for a set of skills. */
    function logSkills(names: string[]) {
      for (const name of names) {
        const s = sdk.getSkill(name);
        if (s && s.level > 1) {
          console.log(`[WOLF]   ${name}: ${s.level}`);
        }
      }
    }

    /** Mine ores at SE Varrock. Returns when targets are met. */
    async function mineOres(copperTarget: number, tinTarget: number) {
      while (
        sdk.countInventoryItems(/copper ore/i) < copperTarget ||
        sdk.countInventoryItems(/tin ore/i) < tinTarget
      ) {
        const copperCount = sdk.countInventoryItems(/copper ore/i);
        const tinCount = sdk.countInventoryItems(/tin ore/i);

        const needCopper = copperCount < copperTarget;
        const needTin = tinCount < tinTarget;
        const mineCopper = needCopper && (!needTin || copperCount <= tinCount);
        const rockPattern = mineCopper ? /copper/i : /tin/i;

        const rock = sdk.findNearbyLoc(rockPattern, { withOption: /mine/i });
        if (rock) {
          await bot.interactLoc(rock, /mine/i);
          await bot.dismissBlockingUI();
        } else {
          // Try any mineable rock as fallback
          const fallback = sdk
            .getNearbyLocs()
            .find((l) => l.options?.some((o: string) => /mine/i.test(o)));
          if (fallback) {
            await bot.interactLoc(fallback, /mine/i);
            await bot.dismissBlockingUI();
          } else {
            await sdk.waitForTicks(3);
          }
        }

        // Stay near the mine
        const state = sdk.getState();
        if (state?.player) {
          const dx = Math.abs(state.player.worldX - SE_VARROCK_MINE.x);
          const dz = Math.abs(state.player.worldZ - SE_VARROCK_MINE.z);
          if (dx + dz > 20) {
            await bot.walkTo(SE_VARROCK_MINE.x, SE_VARROCK_MINE.z);
          }
        }
      }
    }

    /** Smelt all copper+tin pairs into bronze bars. Must be near furnace. */
    async function smeltAllBronze(): Promise<number> {
      const furnaceLoc =
        (await sdk.scanFindNearbyLoc(/furnace/i)) ||
        sdk.findNearbyLoc(/furnace/i);
      if (!furnaceLoc) {
        console.log("[WOLF] No furnace found nearby");
        return 0;
      }

      let count = 0;
      while (
        sdk.findInventoryItem(/copper ore/i) &&
        sdk.findInventoryItem(/tin ore/i)
      ) {
        const copper = sdk.findInventoryItem(/copper ore/i);
        if (copper) {
          await bot.useItemOnLoc(copper, furnaceLoc);
          await bot.dismissBlockingUI();
          count++;
        }
      }
      return count;
    }

    /** Cook all raw fish. Must be near a range. */
    async function cookAllFish(): Promise<number> {
      const range = sdk.findNearbyLoc(/^range$/i);
      if (!range) {
        console.log("[WOLF] No range found nearby");
        return 0;
      }

      let count = 0;
      // Cook raw shrimps
      while (sdk.findInventoryItem(/raw shrimps/i)) {
        const raw = sdk.findInventoryItem(/raw shrimps/i);
        if (raw) {
          await bot.useItemOnLoc(raw, range);
          await bot.dismissBlockingUI();
          count++;
        }
      }
      // Cook raw anchovies
      while (sdk.findInventoryItem(/raw anchovies/i)) {
        const raw = sdk.findInventoryItem(/raw anchovies/i);
        if (raw) {
          await bot.useItemOnLoc(raw, range);
          await bot.dismissBlockingUI();
          count++;
        }
      }
      return count;
    }

    /** Fish at Draynor until target count or inventory full. */
    async function fishAtDraynor(target: number): Promise<number> {
      let interactions = 0;
      while (interactions < target && sdk.getInventory().length < 27) {
        const spot = sdk.findNearbyNpc(/fishing\s*spot/i);
        if (spot) {
          try {
            await bot.interactNpc(spot, /net/i);
          } catch (_) {
            try {
              await bot.interactNpc(spot, 1);
            } catch (_) {}
          }
          await bot.dismissBlockingUI();
          await sdk.waitForTicks(3);
          interactions++;
        } else {
          await sdk.waitForTicks(2);
        }

        // Stay near fishing area
        const state = sdk.getState();
        if (state?.player) {
          const dx = Math.abs(state.player.worldX - DRAYNOR_FISH.x);
          const dz = Math.abs(state.player.worldZ - DRAYNOR_FISH.z);
          if (dx + dz > 15) {
            await bot.walkTo(DRAYNOR_FISH.x, DRAYNOR_FISH.z);
          }
        }
      }
      return interactions;
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 1: THIEVING BLITZ (0-10 min)
    //  Pickpocket men at Lumbridge for XP and GP
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[WOLF] Phase 1: Thieving blitz");
      await sdk.say("the lone wolf hunts alone");
      await bot.walkTo(LUMBRIDGE_SPAWN.x, LUMBRIDGE_SPAWN.z);

      while (true) {
        const skill = sdk.getSkill("Thieving");
        if (skill && skill.level >= 40) break;

        try {
          await bot.pickpocketNpc(/^man$/i);
        } catch (_) {}
        await bot.dismissBlockingUI();
      }

      const thievingLevel = sdk.getSkill("Thieving")?.level ?? 0;
      console.log(`[WOLF] Thieving ${thievingLevel} achieved`);
    } catch (err) {
      console.log(`[WOLF] Phase 1 error: ${err}`);
      await sdk.waitForTicks(5);
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 2: SHOPPING (10-12 min)
    //  Buy all tools needed for every skill
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[WOLF] Phase 2: Tool acquisition");

      // General store: hammer + tinderbox
      await bot.walkTo(3212, 3247);
      await bot.openShop(/shop.*keeper/i);
      try {
        await bot.buyFromShop(/hammer/i, 1);
      } catch (_) {}
      try {
        await bot.buyFromShop(/tinderbox/i, 1);
      } catch (_) {}
      await bot.closeShop();

      // Bob's Axes: bronze axe + bronze pickaxe
      await bot.walkTo(3230, 3203);
      await bot.openShop(/^bob$/i);
      try {
        await bot.buyFromShop(/bronze axe/i, 1);
      } catch (_) {}
      try {
        await bot.buyFromShop(/bronze pickaxe/i, 1);
      } catch (_) {}
      await bot.closeShop();

      // Knife spawn on the ground
      await bot.walkTo(3224, 3202);
      await sdk.waitForTicks(5);
      const knife =
        sdk.findGroundItem(/knife/i) ||
        (await sdk.scanFindGroundItem(/knife/i));
      if (knife) {
        await bot.pickupItem(knife);
        console.log("[WOLF] Picked up knife");
      }

      console.log("[WOLF] All tools acquired");
    } catch (err) {
      console.log(`[WOLF] Phase 2 error: ${err}`);
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 3: WOODCUTTING + FLETCHING + FIREMAKING (12-22 min)
    //  Chop 20 trees, fletch half (375 XP/log), burn the rest
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[WOLF] Phase 3: Woodcutting / Fletching / Firemaking");
      await bot.walkTo(LUMBRIDGE_TREES.x, LUMBRIDGE_TREES.z);

      let logsChopped = 0;
      let logsFletched = 0;
      let logsBurned = 0;

      for (let i = 0; i < 20; i++) {
        const tree = sdk.findNearbyLoc(/^tree$/i);
        if (!tree) {
          await sdk.waitForTicks(3);
          continue;
        }

        await bot.chopTree(tree);
        await bot.dismissBlockingUI();
        logsChopped++;

        // Fletch every other log (375 XP/log = massive Fletching gains)
        if (i % 2 === 1) {
          try {
            await bot.fletchLogs();
            logsFletched++;
          } catch (_) {}
          await bot.dismissBlockingUI();
        }

        // Burn every 5th log for Firemaking
        if (i % 5 === 4) {
          try {
            await bot.burnLogs();
            logsBurned++;
          } catch (_) {}
          await bot.dismissBlockingUI();
        }

        // If inventory fills up, fletch remaining logs then drop shafts
        if (sdk.getInventory().length >= 26) {
          while (sdk.findInventoryItem(/^logs$/i)) {
            try {
              await bot.fletchLogs();
              logsFletched++;
            } catch (_) {}
            await bot.dismissBlockingUI();
          }
          try {
            await bot.dropItem(/arrow shaft/i, "all");
          } catch (_) {}
        }
      }

      // Process any remaining logs
      while (sdk.findInventoryItem(/^logs$/i)) {
        try {
          await bot.fletchLogs();
          logsFletched++;
        } catch (_) {}
        try {
          await bot.burnLogs();
          logsBurned++;
        } catch (_) {}
        await bot.dismissBlockingUI();
      }
      try {
        await bot.dropItem(/arrow shaft/i, "all");
      } catch (_) {}

      // Drop knife and other junk for inventory space
      try {
        await bot.dropItem(/knife/i, "all");
      } catch (_) {}

      console.log(
        `[WOLF] WC done: ${logsChopped} chopped, ` +
          `${logsFletched} fletched, ${logsBurned} burned`
      );
      logSkills(["Woodcutting", "Fletching", "Firemaking"]);
    } catch (err) {
      console.log(`[WOLF] Phase 3 error: ${err}`);
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 4: MINING (22-35 min)
    //  Walk to SE Varrock mine, mine 14 copper + 14 tin
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[WOLF] Phase 4: Mining at SE Varrock");
      await walkWaypoints(WAYPOINTS_TO_MINE);

      await mineOres(14, 14);

      console.log(
        `[WOLF] Mined ${sdk.countInventoryItems(/copper ore/i)} copper, ` +
          `${sdk.countInventoryItems(/tin ore/i)} tin`
      );
      logSkills(["Mining"]);
    } catch (err) {
      console.log(`[WOLF] Phase 4 error: ${err}`);
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 5: SMELTING + SMITHING (35-45 min)
    //  Smelt 14 bronze bars at Lumbridge furnace, smith at Varrock anvil
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[WOLF] Phase 5: Smelting & Smithing");

      // Walk from mine to Lumbridge furnace
      await walkWaypoints(WAYPOINTS_MINE_TO_FURNACE);

      const smelted = await smeltAllBronze();
      console.log(`[WOLF] Smelted ${smelted} bronze bars`);

      // Walk to Varrock anvil
      await bot.walkTo(3240, 3260);
      await walkWaypoints(WAYPOINTS_TO_VARROCK_ANVIL);

      // Smith daggers
      let smithed = 0;
      while (sdk.findInventoryItem(/bronze bar/i)) {
        try {
          await bot.smithAtAnvil("dagger");
          smithed++;
        } catch (_) {}
        await bot.dismissBlockingUI();
      }

      // Equip a dagger for combat later
      const dagger = sdk.findInventoryItem(/bronze dagger/i);
      if (dagger) {
        await bot.equipItem(dagger);
        console.log("[WOLF] Equipped bronze dagger");
      }

      console.log(`[WOLF] Smithed ${smithed} daggers`);
      logSkills(["Smithing"]);
    } catch (err) {
      console.log(`[WOLF] Phase 5 error: ${err}`);
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 6: FISHING (45-55 min)
    //  Walk to Port Sarim for net, fish ~25 shrimp at Draynor
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[WOLF] Phase 6: Fishing");

      // Walk from Varrock anvil area to Lumbridge first
      await walkWaypoints(WAYPOINTS_ANVIL_TO_LUMBRIDGE);

      // Then take safe route to Draynor (avoid dark wizards)
      await walkWaypoints(SAFE_TO_DRAYNOR);

      // Continue to Port Sarim to buy a fishing net
      console.log("[WOLF] Buying fishing net at Port Sarim");
      await bot.walkTo(3040, 3230);
      await bot.walkTo(PORT_SARIM_SHOP.x, PORT_SARIM_SHOP.z);

      try {
        await bot.openShop(/gerrant/i);
        await bot.buyFromShop(/small fishing net/i, 1);
        await bot.closeShop();
      } catch (_) {
        // Fallback: try any nearby shop
        try {
          const shopkeeper = sdk.findNearbyNpc(/shop/i);
          if (shopkeeper) {
            await bot.openShop(shopkeeper);
            await bot.buyFromShop(/net/i, 1);
            await bot.closeShop();
          }
        } catch (_) {}
      }

      // Walk back to Draynor fishing spot
      await bot.walkTo(3040, 3230);
      await bot.walkTo(DRAYNOR_FISH.x, DRAYNOR_FISH.z);

      console.log("[WOLF] Fishing ~25 shrimp at Draynor");
      const interactions = await fishAtDraynor(25);

      const fishCount =
        sdk.countInventoryItems(/raw shrimps/i) +
        sdk.countInventoryItems(/raw anchovies/i);
      console.log(
        `[WOLF] ${interactions} fishing attempts, ${fishCount} raw fish in inventory`
      );
      logSkills(["Fishing"]);
    } catch (err) {
      console.log(`[WOLF] Phase 6 error: ${err}`);
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 7: COOKING (55-60 min)
    //  Walk to Lumbridge range, cook all raw fish
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[WOLF] Phase 7: Cooking");

      // Walk from Draynor back to Lumbridge via safe route
      await walkWaypoints(SAFE_TO_LUMBRIDGE);

      // Walk to the range
      await bot.walkTo(LUMBRIDGE_RANGE.x, LUMBRIDGE_RANGE.z);

      const cooked = await cookAllFish();

      // Drop the fishing net to free a slot
      try {
        await bot.dropItem(/small fishing net/i, "all");
      } catch (_) {}

      console.log(`[WOLF] Cooked ${cooked} fish`);
      logSkills(["Cooking"]);
    } catch (err) {
      console.log(`[WOLF] Phase 7 error: ${err}`);
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 8: COMBAT GRIND (60-110 min)
    //  Fight cows with style rotation, eat food, bury bones
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[WOLF] Phase 8: Combat at cow field");
      await sdk.say("the wolf stalks its prey");

      // Make sure weapon is equipped
      const weapon =
        sdk.findInventoryItem(/bronze dagger/i) ||
        sdk.findInventoryItem(/bronze sword/i);
      if (weapon) await bot.equipItem(weapon);

      // Set initial combat style
      sdk.sendSetCombatStyle(combatStyle);

      // Walk to cow field
      await bot.walkTo(COW_GATE.x, COW_GATE.z);
      await bot.walkTo(COW_FIELD.x, COW_FIELD.z);

      const combatStartTime = Date.now();

      while (true) {
        const state = sdk.getState();
        if (!state?.player) {
          await sdk.waitForTicks(2);
          continue;
        }

        // Death recovery
        if (state.player.hp <= 0) {
          console.log("[WOLF] Died in combat! Recovering...");
          await sdk.waitForTicks(10);
          const reWeapon =
            sdk.findInventoryItem(/bronze dagger/i) ||
            sdk.findInventoryItem(/bronze sword/i);
          if (reWeapon) await bot.equipItem(reWeapon);
          sdk.sendSetCombatStyle(combatStyle);
          await bot.walkTo(COW_GATE.x, COW_GATE.z);
          await bot.walkTo(COW_FIELD.x, COW_FIELD.z);
          continue;
        }

        // Eat food when HP drops below 50%
        await eatIfLow(0.5);

        // Find and attack a cow
        const cow = sdk.findNearbyNpc(/^cow$/i);
        if (cow) {
          try {
            await bot.attack(cow);
          } catch (_) {}
          await sdk.waitForTicks(4);
          totalKills++;

          // Rotate combat style every 5 kills
          updateCombatStyle();
        } else {
          await sdk.waitForTicks(2);
        }

        // Pick up and bury bones for Prayer XP
        const bones = sdk.findGroundItem(/^bones$/i);
        if (bones) {
          try {
            await bot.pickupItem(bones);
            const invBones = sdk.findInventoryItem(/^bones$/i);
            if (invBones) await sdk.sendUseItem(invBones.slot);
          } catch (_) {}
        }

        // Drop cowhides to keep inventory open
        if (sdk.countInventoryItems(/cowhide/i) > 3) {
          try {
            await bot.dropItem(/cowhide/i, "all");
          } catch (_) {}
        }

        await bot.dismissBlockingUI();

        // Periodic status report every 25 kills
        if (totalKills % 25 === 0 && totalKills > 0) {
          const atk = sdk.getSkill("Attack")?.level ?? 0;
          const str = sdk.getSkill("Strength")?.level ?? 0;
          const def = sdk.getSkill("Defence")?.level ?? 0;
          const hp = sdk.getSkill("Hitpoints")?.level ?? 0;
          const prayer = sdk.getSkill("Prayer")?.level ?? 0;
          console.log(
            `[WOLF] ${totalKills} kills | ` +
              `Atk ${atk} / Str ${str} / Def ${def} / ` +
              `HP ${hp} / Prayer ${prayer}`
          );
        }

        // After ~50 minutes of combat, break for resupply
        const elapsedCombatMin =
          (Date.now() - combatStartTime) / (1000 * 60);

        // Check if out of food and it has been a while
        const hasFood =
          sdk.findInventoryItem(/^shrimps$/i) ||
          sdk.findInventoryItem(/^anchovies$/i) ||
          sdk.findInventoryItem(/^cooked/i);

        if (elapsedCombatMin >= 50 || (!hasFood && totalKills > 20)) {
          console.log(
            `[WOLF] Combat phase 1 complete: ${totalKills} kills in ` +
              `${elapsedCombatMin.toFixed(0)} min`
          );
          break;
        }
      }

      logSkills(["Attack", "Strength", "Defence", "Hitpoints", "Prayer"]);
    } catch (err) {
      console.log(`[WOLF] Phase 8 error: ${err}`);
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 9: SECOND MINING + SMITHING RUN (110-120 min)
    //  Quick trip for more bars; smith better gear if level allows
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[WOLF] Phase 9: Second mining + smithing run");

      // Drop junk to make inventory space
      try {
        await bot.dropItem(/cowhide/i, "all");
      } catch (_) {}
      try {
        await bot.dropItem(/^bones$/i, "all");
      } catch (_) {}

      // Walk from cow field to mine
      await bot.walkTo(COW_GATE.x, COW_GATE.z);
      await bot.walkTo(3260, 3300);
      await bot.walkTo(3270, 3340);
      await bot.walkTo(SE_VARROCK_MINE.x, SE_VARROCK_MINE.z);

      // Mine 14 copper + 14 tin
      await mineOres(14, 14);

      console.log(
        `[WOLF] Round 2: mined ${sdk.countInventoryItems(/copper ore/i)} ` +
          `copper, ${sdk.countInventoryItems(/tin ore/i)} tin`
      );

      // Walk to Lumbridge furnace to smelt
      await walkWaypoints(WAYPOINTS_MINE_TO_FURNACE);

      const smelted = await smeltAllBronze();
      console.log(`[WOLF] Round 2: smelted ${smelted} bronze bars`);

      // Walk to Varrock anvil for smithing
      await bot.walkTo(3240, 3260);
      await walkWaypoints(WAYPOINTS_TO_VARROCK_ANVIL);

      // Check smithing level to see what we can make
      const smithLevel = sdk.getSkill("Smithing")?.level ?? 1;
      let product = "dagger";
      if (smithLevel >= 9) {
        product = "sword";
      } else if (smithLevel >= 7) {
        product = "mace";
      } else if (smithLevel >= 4) {
        product = "dagger";
      }

      console.log(
        `[WOLF] Smithing ${product}s (Smithing level ${smithLevel})`
      );

      let smithed = 0;
      while (sdk.findInventoryItem(/bronze bar/i)) {
        try {
          await bot.smithAtAnvil(product);
          smithed++;
        } catch (_) {
          // Fall back to dagger if chosen product fails
          if (product !== "dagger") {
            product = "dagger";
            try {
              await bot.smithAtAnvil(product);
              smithed++;
            } catch (_) {}
          }
        }
        await bot.dismissBlockingUI();
      }

      // Equip best available weapon
      const sword = sdk.findInventoryItem(/bronze sword/i);
      const mace = sdk.findInventoryItem(/bronze mace/i);
      const dagger2 = sdk.findInventoryItem(/bronze dagger/i);
      const bestWeapon = sword || mace || dagger2;
      if (bestWeapon) {
        await bot.equipItem(bestWeapon);
        console.log(`[WOLF] Equipped ${bestWeapon.name}`);
      }

      console.log(`[WOLF] Round 2: smithed ${smithed} ${product}s`);
      logSkills(["Mining", "Smithing"]);
    } catch (err) {
      console.log(`[WOLF] Phase 9 error: ${err}`);
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 10: FISHING + COOKING RESUPPLY
    //  Catch more food for extended combat
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[WOLF] Phase 10: Fishing + cooking resupply");

      // Walk from Varrock anvil to Lumbridge then to Draynor
      await walkWaypoints(WAYPOINTS_ANVIL_TO_LUMBRIDGE);
      await walkWaypoints(SAFE_TO_DRAYNOR);

      // Make sure we have a fishing net
      if (!sdk.findInventoryItem(/small fishing net/i)) {
        console.log("[WOLF] Buying another fishing net");
        await bot.walkTo(3040, 3230);
        await bot.walkTo(PORT_SARIM_SHOP.x, PORT_SARIM_SHOP.z);
        try {
          await bot.openShop(/gerrant/i);
          await bot.buyFromShop(/small fishing net/i, 1);
          await bot.closeShop();
        } catch (_) {}
        await bot.walkTo(3040, 3230);
        await bot.walkTo(DRAYNOR_FISH.x, DRAYNOR_FISH.z);
      }

      // Fish until inventory is close to full
      const interactions = await fishAtDraynor(30);
      console.log(`[WOLF] Resupply: ${interactions} fishing attempts`);

      // Walk back to Lumbridge to cook
      await walkWaypoints(SAFE_TO_LUMBRIDGE);
      await bot.walkTo(LUMBRIDGE_RANGE.x, LUMBRIDGE_RANGE.z);

      const cooked = await cookAllFish();

      // Drop fishing net
      try {
        await bot.dropItem(/small fishing net/i, "all");
      } catch (_) {}

      console.log(`[WOLF] Resupply: cooked ${cooked} fish`);
    } catch (err) {
      console.log(`[WOLF] Phase 10 error: ${err}`);
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 11: EXTENDED COMBAT (remaining time)
    //  Continue fighting with fresh food supply until timeout
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[WOLF] Phase 11: Extended combat grind");
      await sdk.say("the wolf returns to the hunt");

      // Make sure weapon is equipped
      const weapon =
        sdk.findInventoryItem(/bronze sword/i) ||
        sdk.findInventoryItem(/bronze mace/i) ||
        sdk.findInventoryItem(/bronze dagger/i);
      if (weapon) await bot.equipItem(weapon);

      sdk.sendSetCombatStyle(combatStyle);

      // Walk to cow field
      await bot.walkTo(COW_GATE.x, COW_GATE.z);
      await bot.walkTo(COW_FIELD.x, COW_FIELD.z);

      while (true) {
        const state = sdk.getState();
        if (!state?.player) {
          await sdk.waitForTicks(2);
          continue;
        }

        // Death recovery
        if (state.player.hp <= 0) {
          console.log("[WOLF] Died! Recovering...");
          await sdk.waitForTicks(10);
          const reWeapon =
            sdk.findInventoryItem(/bronze sword/i) ||
            sdk.findInventoryItem(/bronze mace/i) ||
            sdk.findInventoryItem(/bronze dagger/i);
          if (reWeapon) await bot.equipItem(reWeapon);
          sdk.sendSetCombatStyle(combatStyle);
          await bot.walkTo(COW_GATE.x, COW_GATE.z);
          await bot.walkTo(COW_FIELD.x, COW_FIELD.z);
          continue;
        }

        // Eat food when low
        await eatIfLow(0.5);

        // Attack cows
        const cow = sdk.findNearbyNpc(/^cow$/i);
        if (cow) {
          try {
            await bot.attack(cow);
          } catch (_) {}
          await sdk.waitForTicks(4);
          totalKills++;
          updateCombatStyle();
        } else {
          await sdk.waitForTicks(2);
        }

        // Bury bones for Prayer
        const bones = sdk.findGroundItem(/^bones$/i);
        if (bones) {
          try {
            await bot.pickupItem(bones);
            const invBones = sdk.findInventoryItem(/^bones$/i);
            if (invBones) await sdk.sendUseItem(invBones.slot);
          } catch (_) {}
        }

        // Drop hides
        if (sdk.countInventoryItems(/cowhide/i) > 3) {
          try {
            await bot.dropItem(/cowhide/i, "all");
          } catch (_) {}
        }

        await bot.dismissBlockingUI();

        // Status report every 25 kills
        if (totalKills % 25 === 0 && totalKills > 0) {
          const atk = sdk.getSkill("Attack")?.level ?? 0;
          const str = sdk.getSkill("Strength")?.level ?? 0;
          const def = sdk.getSkill("Defence")?.level ?? 0;
          const hp = sdk.getSkill("Hitpoints")?.level ?? 0;
          const prayer = sdk.getSkill("Prayer")?.level ?? 0;
          console.log(
            `[WOLF] ${totalKills} total kills | ` +
              `Atk ${atk} / Str ${str} / Def ${def} / ` +
              `HP ${hp} / Prayer ${prayer}`
          );
        }

        // Emergency fishing run if out of food and HP is getting low
        const hasFood =
          sdk.findInventoryItem(/^shrimps$/i) ||
          sdk.findInventoryItem(/^anchovies$/i) ||
          sdk.findInventoryItem(/^cooked/i);

        if (
          !hasFood &&
          totalKills > 20 &&
          state.player.hp < state.player.maxHp * 0.6
        ) {
          console.log("[WOLF] Emergency fishing run");

          // Safe route to Draynor
          await walkWaypoints(SAFE_TO_DRAYNOR);

          await fishAtDraynor(20);

          // Safe route back to Lumbridge
          await walkWaypoints(SAFE_TO_LUMBRIDGE);
          await bot.walkTo(LUMBRIDGE_RANGE.x, LUMBRIDGE_RANGE.z);

          await cookAllFish();

          // Return to cows
          await bot.walkTo(COW_GATE.x, COW_GATE.z);
          await bot.walkTo(COW_FIELD.x, COW_FIELD.z);
          continue;
        }

        // Stay near cows
        const dx = Math.abs(state.player.worldX - COW_FIELD.x);
        const dz = Math.abs(state.player.worldZ - COW_FIELD.z);
        if (dx + dz > 15) {
          await bot.walkTo(COW_FIELD.x, COW_FIELD.z);
        }
      }
    } catch (err) {
      console.log(`[WOLF] Phase 11 error: ${err}`);
    }

    // ─── Final Stats ─────────────────────────────────────
    const skills = [
      "Attack",
      "Strength",
      "Defence",
      "Hitpoints",
      "Prayer",
      "Thieving",
      "Woodcutting",
      "Fletching",
      "Firemaking",
      "Mining",
      "Smithing",
      "Fishing",
      "Cooking",
    ];
    console.log("[WOLF] === FINAL STATS ===");
    for (const name of skills) {
      const s = sdk.getSkill(name);
      if (s && s.level > 1) {
        console.log(`[WOLF]   ${name}: ${s.level}`);
      }
    }
    console.log(`[WOLF] Total kills: ${totalKills}`);
    console.log("[WOLF] The lone wolf's journey is complete.");
  },
  { timeout: 7_200_000 }
);

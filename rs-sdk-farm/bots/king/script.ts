import { runScript } from "../../sdk/runner";

// THE KING v2 — Enhanced swarm commander with death recovery, combat style
// rotation, interleaved trade acceptance, self-sufficient mining fallback,
// Al Kharid warrior escalation, and cowhide crafting side-quest.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    // ─── Constants ───────────────────────────────────────
    const LUMBRIDGE_SPAWN = { x: 3222, z: 3218 };
    const LUMBRIDGE_FURNACE = { x: 3225, z: 3256 };
    const LUMBRIDGE_RANGE = { x: 3230, z: 3196 };
    const LUMBRIDGE_TREES = { x: 3195, z: 3220 };
    const COW_FIELD = { x: 3253, z: 3290 };
    const COW_GATE = { x: 3253, z: 3266 };
    const VARROCK_ANVIL = { x: 3188, z: 3421 };
    const SE_VARROCK_MINE = { x: 3285, z: 3365 };
    const AL_KHARID_TOLL = { x: 3268, z: 3228 };
    const AL_KHARID_WARRIORS = { x: 3293, z: 3170 };
    const AL_KHARID_BANK = { x: 3269, z: 3167 };

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

    const WAYPOINTS_ANVIL_TO_RANGE = [
      { x: 3210, z: 3425 },
      { x: 3230, z: 3350 },
      { x: 3230, z: 3280 },
      { x: 3230, z: 3220 },
      { x: 3230, z: 3196 },
    ];

    let totalKills = 0;
    let combatStyle = 0;
    let phaseStartTime = Date.now();

    // ─── Helpers ─────────────────────────────────────────

    async function walkWaypoints(points: { x: number; z: number }[]) {
      for (const p of points) {
        await bot.walkTo(p.x, p.z);
      }
    }

    /** Check if we died and respawned at Lumbridge unexpectedly. */
    function detectDeath(): boolean {
      const state = sdk.getState();
      if (!state?.player) return false;
      if (state.player.hp <= 0) return true;
      const dx = Math.abs(state.player.worldX - LUMBRIDGE_SPAWN.x);
      const dz = Math.abs(state.player.worldZ - LUMBRIDGE_SPAWN.z);
      return dx + dz < 5;
    }

    /** Quick check for incoming trade deliveries from drones. */
    async function checkDeliveries(): Promise<boolean> {
      try {
        const trade = await sdk.waitForTradeRequest({ timeout: 2000 });
        if (trade) {
          await bot.acceptTrade();
          console.log("[KING] Accepted a drone delivery mid-action");
          return true;
        }
      } catch (_) {}
      return false;
    }

    /** Accept deliveries for a longer period (used between phases). */
    async function collectDeliveries(duration = 45_000) {
      console.log(`[KING] Accepting deliveries for ${duration / 1000}s...`);
      try {
        await bot.serveTrades({ timeout: duration });
      } catch (_) {}
    }

    /** Smelt all copper+tin pairs into bronze bars at current location. */
    async function smeltAllBronze() {
      const furnaceLoc =
        (await sdk.scanFindNearbyLoc(/furnace/i)) ||
        sdk.findNearbyLoc(/furnace/i);
      if (!furnaceLoc) {
        console.log("[KING] No furnace found nearby");
        return;
      }

      let smelted = 0;
      while (
        sdk.findInventoryItem(/copper ore/i) &&
        sdk.findInventoryItem(/tin ore/i)
      ) {
        const copper = sdk.findInventoryItem(/copper ore/i);
        if (copper) {
          await bot.useItemOnLoc(copper, furnaceLoc);
          await bot.dismissBlockingUI();
          smelted++;
        }
        await checkDeliveries();
      }
      console.log(`[KING] Smelted ${smelted} bronze bars`);
    }

    /** Cook all raw fish at a range. */
    async function cookAllFish() {
      const range = sdk.findNearbyLoc(/^range$/i);
      if (!range) {
        console.log("[KING] No range found nearby");
        return;
      }

      let cooked = 0;
      while (sdk.findInventoryItem(/raw shrimps/i)) {
        const raw = sdk.findInventoryItem(/raw shrimps/i);
        if (raw) {
          await bot.useItemOnLoc(raw, range);
          await bot.dismissBlockingUI();
          cooked++;
        }
      }
      // Also cook any raw anchovies
      while (sdk.findInventoryItem(/raw anchovies/i)) {
        const raw = sdk.findInventoryItem(/raw anchovies/i);
        if (raw) {
          const range2 = sdk.findNearbyLoc(/^range$/i);
          if (range2) {
            await bot.useItemOnLoc(raw, range2);
            await bot.dismissBlockingUI();
            cooked++;
          }
        }
      }
      console.log(`[KING] Cooked ${cooked} fish`);
    }

    /** Eat available food if HP is low. Returns true if food was eaten. */
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

    /** Mine copper and tin ore at SE Varrock mine (self-sufficiency fallback). */
    async function selfMineOres(copperTarget = 14, tinTarget = 14) {
      console.log(
        `[KING] Self-mining: ${copperTarget} copper + ${tinTarget} tin`
      );
      await walkWaypoints(WAYPOINTS_TO_MINE);

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
          const fallback = sdk.getNearbyLocs().find((l) =>
            l.options?.some((o: string) => /mine/i.test(o))
          );
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

      console.log(
        `[KING] Mined ${sdk.countInventoryItems(/copper ore/i)} copper, ` +
          `${sdk.countInventoryItems(/tin ore/i)} tin`
      );
    }

    /** Update combat style based on kill count. Rotates every 5 kills. */
    function updateCombatStyle() {
      const newStyle = Math.floor(totalKills / 5) % 3;
      if (newStyle !== combatStyle) {
        combatStyle = newStyle;
        const styleName = ["Attack", "Strength", "Defence"][combatStyle];
        console.log(
          `[KING] Switching combat style to ${styleName} (style ${combatStyle})`
        );
        sdk.sendSetCombatStyle(combatStyle);
      }
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 1: THIEVING BLITZ — fastest skill, generates GP
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[KING] Phase 1: Thieving blitz");
      await sdk.say("the king has arrived");
      await bot.walkTo(LUMBRIDGE_SPAWN.x, LUMBRIDGE_SPAWN.z);

      while (true) {
        const skill = sdk.getSkill("Thieving");
        if (skill && skill.level >= 40) break;

        try {
          await bot.pickpocketNpc(/^man$/i);
        } catch (_) {}
        await bot.dismissBlockingUI();
        await checkDeliveries();
      }

      const thievingLevel = sdk.getSkill("Thieving")?.level ?? 0;
      console.log(`[KING] Thieving ${thievingLevel} achieved`);
    } catch (err) {
      console.log(`[KING] Phase 1 error: ${err}`);
      if (detectDeath()) {
        console.log("[KING] Detected death during thieving, recovering...");
        await sdk.waitForTicks(5);
      }
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 2: TOOL ACQUISITION — spend that stolen gold
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[KING] Phase 2: Shopping spree");

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

      await checkDeliveries();

      // Bob's Axes: axe + pickaxe
      await bot.walkTo(3230, 3203);
      await bot.openShop(/^bob$/i);
      try {
        await bot.buyFromShop(/bronze axe/i, 1);
      } catch (_) {}
      try {
        await bot.buyFromShop(/bronze pickaxe/i, 1);
      } catch (_) {}
      await bot.closeShop();

      await checkDeliveries();

      // Knife spawn
      await bot.walkTo(3224, 3202);
      await sdk.waitForTicks(5);
      const knife =
        sdk.findGroundItem(/knife/i) ||
        (await sdk.scanFindGroundItem(/knife/i));
      if (knife) await bot.pickupItem(knife);

      console.log("[KING] Tools acquired");
    } catch (err) {
      console.log(`[KING] Phase 2 error: ${err}`);
      if (detectDeath()) {
        console.log("[KING] Detected death during shopping, recovering...");
        await bot.walkTo(LUMBRIDGE_SPAWN.x, LUMBRIDGE_SPAWN.z);
        await sdk.waitForTicks(5);
      }
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 3: WOODCUTTING + FLETCHING + FIREMAKING BURST
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[KING] Phase 3: WC / Fletch / Firemaking");
      await sdk.say("king chopping wood");
      await bot.walkTo(LUMBRIDGE_TREES.x, LUMBRIDGE_TREES.z);

      for (let i = 0; i < 20; i++) {
        const tree = sdk.findNearbyLoc(/^tree$/i);
        if (!tree) {
          await sdk.waitForTicks(3);
          continue;
        }

        await bot.chopTree(tree);
        await bot.dismissBlockingUI();

        // Fletch every other log for massive Fletching XP (375 XP/log)
        if (i % 2 === 1) {
          try {
            await bot.fletchLogs();
          } catch (_) {}
          await bot.dismissBlockingUI();
        }

        // Burn every 5th for Firemaking XP
        if (i % 5 === 4) {
          try {
            await bot.burnLogs();
          } catch (_) {}
          await bot.dismissBlockingUI();
        }

        // Accept deliveries between chops
        await checkDeliveries();

        // Clear inventory if full
        if (sdk.getInventory().length >= 26) {
          while (sdk.findInventoryItem(/^logs$/i)) {
            try {
              await bot.fletchLogs();
            } catch (_) {}
            await bot.dismissBlockingUI();
          }
          try {
            await bot.dropItem(/arrow shaft/i, "all");
          } catch (_) {}
        }
      }

      // Process remaining logs
      while (sdk.findInventoryItem(/^logs$/i)) {
        try {
          await bot.fletchLogs();
        } catch (_) {}
        try {
          await bot.burnLogs();
        } catch (_) {}
        await bot.dismissBlockingUI();
      }
      try {
        await bot.dropItem(/arrow shaft/i, "all");
      } catch (_) {}

      const wcLevel = sdk.getSkill("Woodcutting")?.level ?? 0;
      const fletchLevel = sdk.getSkill("Fletching")?.level ?? 0;
      const fmLevel = sdk.getSkill("Firemaking")?.level ?? 0;
      console.log(
        `[KING] WC ${wcLevel} / Fletch ${fletchLevel} / FM ${fmLevel}`
      );
    } catch (err) {
      console.log(`[KING] Phase 3 error: ${err}`);
      if (detectDeath()) {
        console.log("[KING] Detected death during woodcutting, recovering...");
        await sdk.waitForTicks(5);
      }
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 4: RECEIVE ORES -> SMELT -> SMITH (with fallback)
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[KING] Phase 4: Smelting & Smithing");
      await sdk.say("king at furnace bring ores now");

      // Drop junk to make inventory space
      try {
        await bot.dropItem(/arrow shaft/i, "all");
      } catch (_) {}
      try {
        await bot.dropItem(/knife/i, "all");
      } catch (_) {}

      // Walk to Lumbridge furnace and wait for ore deliveries
      await bot.walkTo(LUMBRIDGE_FURNACE.x, LUMBRIDGE_FURNACE.z);
      await collectDeliveries(60_000);

      // Check if we received ores
      const hasCopper = sdk.findInventoryItem(/copper ore/i);
      const hasTin = sdk.findInventoryItem(/tin ore/i);

      if (!hasCopper || !hasTin) {
        // ── SELF-SUFFICIENCY FALLBACK: mine our own ores ──
        console.log("[KING] No ores delivered -- mining our own!");
        await sdk.say("king mining own ores, drones are slacking");

        // Drop non-essentials to make space
        try {
          await bot.dropItem(/^logs$/i, "all");
        } catch (_) {}

        await selfMineOres(14, 14);

        // Walk back to furnace
        await walkWaypoints(WAYPOINTS_MINE_TO_FURNACE);
      }

      // Smelt all bronze
      await smeltAllBronze();

      // Walk to Varrock anvil
      console.log("[KING] Walking to Varrock anvil");
      await walkWaypoints(WAYPOINTS_TO_VARROCK_ANVIL);

      // Smith daggers (and check for deliveries between smithing)
      let smithed = 0;
      while (sdk.findInventoryItem(/bronze bar/i)) {
        try {
          await bot.smithAtAnvil("dagger");
          smithed++;
        } catch (_) {}
        await bot.dismissBlockingUI();

        if (smithed % 3 === 0) {
          await checkDeliveries();
        }
      }

      const smithLevel = sdk.getSkill("Smithing")?.level ?? 0;
      console.log(`[KING] Smithed ${smithed} daggers, Smithing ${smithLevel}`);
    } catch (err) {
      console.log(`[KING] Phase 4 error: ${err}`);
      if (detectDeath()) {
        console.log("[KING] Detected death during smithing, recovering...");
        await bot.walkTo(LUMBRIDGE_SPAWN.x, LUMBRIDGE_SPAWN.z);
        await sdk.waitForTicks(5);
      }
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 5: RECEIVE FISH -> COOK
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[KING] Phase 5: Cooking");
      await sdk.say("king at range bring fish now");

      // Walk from anvil area back to Lumbridge range
      await walkWaypoints(WAYPOINTS_ANVIL_TO_RANGE);

      await collectDeliveries(60_000);
      await cookAllFish();

      const cookLevel = sdk.getSkill("Cooking")?.level ?? 0;
      console.log(`[KING] Cooking level ${cookLevel}`);
    } catch (err) {
      console.log(`[KING] Phase 5 error: ${err}`);
      if (detectDeath()) {
        console.log("[KING] Detected death during cooking, recovering...");
        await bot.walkTo(LUMBRIDGE_SPAWN.x, LUMBRIDGE_SPAWN.z);
        await sdk.waitForTicks(5);
      }
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 6: COW COMBAT — style rotation + hide collection
    // ═════════════════════════════════════════════════════════
    try {
      console.log("[KING] Phase 6: COMBAT -- the king rides to war");
      await sdk.say("the king rides to war");

      // Equip best weapon
      const weapon =
        sdk.findInventoryItem(/bronze dagger/i) ||
        sdk.findInventoryItem(/bronze sword/i);
      if (weapon) await bot.equipItem(weapon);

      // Set initial combat style
      sdk.sendSetCombatStyle(combatStyle);

      // Walk to cow field
      await bot.walkTo(COW_GATE.x, COW_GATE.z);
      await bot.walkTo(COW_FIELD.x, COW_FIELD.z);

      let killsSinceResupply = 0;
      let hidesSinceTanning = 0;
      phaseStartTime = Date.now();

      while (true) {
        const state = sdk.getState();
        if (!state?.player) {
          await sdk.waitForTicks(2);
          continue;
        }

        // Death recovery
        if (state.player.hp <= 0) {
          console.log("[KING] Died during cow combat! Recovering...");
          await sdk.waitForTicks(10);
          // Re-equip and return to cows
          const reWeapon =
            sdk.findInventoryItem(/bronze dagger/i) ||
            sdk.findInventoryItem(/bronze sword/i);
          if (reWeapon) await bot.equipItem(reWeapon);
          await bot.walkTo(COW_GATE.x, COW_GATE.z);
          await bot.walkTo(COW_FIELD.x, COW_FIELD.z);
          continue;
        }

        // Eat food when HP drops below 50%
        const ate = await eatIfLow(0.5);
        if (!ate && state.player.hp < state.player.maxHp * 0.5) {
          // No food left
          if (killsSinceResupply > 10) {
            console.log("[KING] Out of food -- resupply run");
            await sdk.say("king needs food deliver now");
            await bot.walkTo(LUMBRIDGE_SPAWN.x, LUMBRIDGE_SPAWN.z);
            await collectDeliveries(45_000);

            // Cook any raw fish received
            await bot.walkTo(LUMBRIDGE_RANGE.x, LUMBRIDGE_RANGE.z);
            await cookAllFish();

            // Return to cows
            await bot.walkTo(COW_GATE.x, COW_GATE.z);
            await bot.walkTo(COW_FIELD.x, COW_FIELD.z);
            killsSinceResupply = 0;
            continue;
          }
        }

        // Fight a cow
        const cow = sdk.findNearbyNpc(/^cow$/i);
        if (cow) {
          try {
            await bot.attack(cow);
          } catch (_) {}
          await sdk.waitForTicks(4);
          totalKills++;
          killsSinceResupply++;
          hidesSinceTanning++;

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

        // Pick up cowhides (keep them for tanning side-quest)
        const hideOnGround = sdk.findGroundItem(/cowhide/i);
        if (hideOnGround && sdk.countInventoryItems(/cowhide/i) < 10) {
          try {
            await bot.pickupItem(hideOnGround);
          } catch (_) {}
        }

        // Drop excess hides if inventory is getting full
        if (sdk.getInventory().length >= 26) {
          const hideCount = sdk.countInventoryItems(/cowhide/i);
          if (hideCount > 10) {
            try {
              await bot.dropItem(/cowhide/i, hideCount - 10);
            } catch (_) {}
          }
        }

        // ── Cowhide tanning side-quest DISABLED: the Al Kharid toll gate
        //    is impassable to walkTo (dialog toll) and risks stranding KING.
        if (false && hidesSinceTanning >= 20 && sdk.countInventoryItems(/cowhide/i) >= 5) {
          const atkLevel = sdk.getSkill("Attack")?.level ?? 0;
          // Only attempt if we have enough combat level to survive the walk
          if (atkLevel >= 5) {
            try {
              console.log("[KING] Tanning cowhides at Al Kharid");
              await bot.walkTo(COW_GATE.x, COW_GATE.z);
              await bot.walkTo(AL_KHARID_TOLL.x, AL_KHARID_TOLL.z);

              // Pay the 10gp toll
              try {
                await bot.interactLoc(/gate/i, /pay/i);
                await bot.dismissBlockingUI();
              } catch (_) {
                await bot.walkTo(3277, 3227);
              }

              // Walk to tanner
              await bot.walkTo(3275, 3192);
              const tanner = sdk.findNearbyNpc(/tanner|ellis/i);
              if (tanner) {
                await bot.interactNpc(tanner, /trade/i);
                await bot.dismissBlockingUI();
              }

              // Try to craft leather items if we have leather
              const leather = sdk.findInventoryItem(/^leather$/i);
              if (leather) {
                console.log("[KING] Crafting leather items");
                // Attempt leather crafting if we have a needle/thread
              }

              hidesSinceTanning = 0;

              // Return to cows
              await bot.walkTo(AL_KHARID_TOLL.x, AL_KHARID_TOLL.z);
              await bot.walkTo(COW_GATE.x, COW_GATE.z);
              await bot.walkTo(COW_FIELD.x, COW_FIELD.z);
            } catch (err) {
              console.log(`[KING] Tanning trip failed: ${err}`);
              // Navigate back to cow field
              try {
                await bot.walkTo(COW_GATE.x, COW_GATE.z);
                await bot.walkTo(COW_FIELD.x, COW_FIELD.z);
              } catch (_) {
                await bot.walkTo(LUMBRIDGE_SPAWN.x, LUMBRIDGE_SPAWN.z);
                await bot.walkTo(COW_GATE.x, COW_GATE.z);
                await bot.walkTo(COW_FIELD.x, COW_FIELD.z);
              }
              hidesSinceTanning = 0;
            }
          } else {
            // Not high enough level, just drop excess hides
            if (sdk.countInventoryItems(/cowhide/i) > 5) {
              try {
                await bot.dropItem(/cowhide/i, "all");
              } catch (_) {}
            }
            hidesSinceTanning = 0;
          }
        }

        // Check for drone deliveries periodically
        if (totalKills % 8 === 0) {
          await checkDeliveries();
        }

        await bot.dismissBlockingUI();

        // Check elapsed time -- after ~30 min of combat, consider Al Kharid
        const elapsedCombatMin =
          (Date.now() - phaseStartTime) / (1000 * 60);
        const atkLevel = sdk.getSkill("Attack")?.level ?? 0;
        // Al Kharid escalation DISABLED: toll gate is impassable to walkTo.
        // Cows + zero downtime + close deliveries beats warriors + overhead.
        if (false && elapsedCombatMin >= 30 && atkLevel >= 10) {
          break;
        }
      }
    } catch (err) {
      console.log(`[KING] Phase 6 error: ${err}`);
      if (detectDeath()) {
        console.log("[KING] Detected death during combat, recovering...");
        await sdk.waitForTicks(10);
      }
    }

    // ═════════════════════════════════════════════════════════
    //  PHASE 7: AL KHARID WARRIORS — advanced combat grind
    // ═════════════════════════════════════════════════════════
    try {
      const atkLevel = sdk.getSkill("Attack")?.level ?? 0;
      if (atkLevel < 10) {
        console.log(
          "[KING] Attack level too low for Al Kharid, " +
            "continuing cow combat indefinitely"
        );
        // Fall back to infinite cow combat
        await bot.walkTo(COW_GATE.x, COW_GATE.z);
        await bot.walkTo(COW_FIELD.x, COW_FIELD.z);

        while (true) {
          const state = sdk.getState();
          if (!state?.player) {
            await sdk.waitForTicks(2);
            continue;
          }

          if (state.player.hp <= 0) {
            await sdk.waitForTicks(10);
            const reWeapon =
              sdk.findInventoryItem(/bronze dagger/i) ||
              sdk.findInventoryItem(/bronze sword/i);
            if (reWeapon) await bot.equipItem(reWeapon);
            await bot.walkTo(COW_GATE.x, COW_GATE.z);
            await bot.walkTo(COW_FIELD.x, COW_FIELD.z);
            continue;
          }

          await eatIfLow(0.5);

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

          const bones = sdk.findGroundItem(/^bones$/i);
          if (bones) {
            try {
              await bot.pickupItem(bones);
              const invBones = sdk.findInventoryItem(/^bones$/i);
              if (invBones) await sdk.sendUseItem(invBones.slot);
            } catch (_) {}
          }

          if (sdk.countInventoryItems(/cowhide/i) > 5) {
            try {
              await bot.dropItem(/cowhide/i, "all");
            } catch (_) {}
          }

          if (totalKills % 8 === 0) {
            await checkDeliveries();
          }

          await bot.dismissBlockingUI();
        }
      }

      console.log("[KING] Phase 7: Al Kharid warriors -- advanced combat");
      await sdk.say("the king conquers al kharid");

      // Walk to Al Kharid
      await bot.walkTo(COW_GATE.x, COW_GATE.z);
      await bot.walkTo(AL_KHARID_TOLL.x, AL_KHARID_TOLL.z);

      // Pay the 10gp toll
      try {
        await bot.interactLoc(/gate/i, /pay/i);
        await bot.dismissBlockingUI();
      } catch (_) {
        // Try walking through if toll fails
        await bot.walkTo(3277, 3227);
      }

      // Buy kebabs for food
      console.log("[KING] Buying kebabs for combat food");
      await bot.walkTo(3273, 3180);
      try {
        const kebabSeller = sdk.findNearbyNpc(/kebab/i);
        if (kebabSeller) {
          await bot.openShop(kebabSeller);
          try {
            await bot.buyFromShop(/kebab/i, 10);
          } catch (_) {}
          await bot.closeShop();
        }
      } catch (_) {}

      // Head to warrior area
      await bot.walkTo(AL_KHARID_WARRIORS.x, AL_KHARID_WARRIORS.z);

      let alKharidKills = 0;

      while (true) {
        const state = sdk.getState();
        if (!state?.player) {
          await sdk.waitForTicks(2);
          continue;
        }

        // Death recovery -- respawn at Lumbridge then walk back
        if (state.player.hp <= 0) {
          console.log("[KING] Died at Al Kharid! Recovering...");
          await sdk.waitForTicks(10);

          // Re-equip weapon
          const reWeapon =
            sdk.findInventoryItem(/bronze dagger/i) ||
            sdk.findInventoryItem(/bronze sword/i);
          if (reWeapon) await bot.equipItem(reWeapon);

          // Walk back to Al Kharid
          await bot.walkTo(AL_KHARID_TOLL.x, AL_KHARID_TOLL.z);
          try {
            await bot.interactLoc(/gate/i, /pay/i);
            await bot.dismissBlockingUI();
          } catch (_) {
            await bot.walkTo(3277, 3227);
          }

          // Rebuy kebabs
          await bot.walkTo(3273, 3180);
          try {
            const kebabSeller = sdk.findNearbyNpc(/kebab/i);
            if (kebabSeller) {
              await bot.openShop(kebabSeller);
              try {
                await bot.buyFromShop(/kebab/i, 10);
              } catch (_) {}
              await bot.closeShop();
            }
          } catch (_) {}

          await bot.walkTo(AL_KHARID_WARRIORS.x, AL_KHARID_WARRIORS.z);
          continue;
        }

        // Eat kebabs when low HP
        if (state.player.hp < state.player.maxHp * 0.4) {
          const food =
            sdk.findInventoryItem(/^kebab$/i) ||
            sdk.findInventoryItem(/^shrimps$/i) ||
            sdk.findInventoryItem(/^cooked/i);
          if (food) {
            await bot.eatFood(food);
          } else {
            // Out of food -- buy more kebabs
            console.log("[KING] Restocking kebabs");
            await bot.walkTo(3273, 3180);
            try {
              const kebabSeller = sdk.findNearbyNpc(/kebab/i);
              if (kebabSeller) {
                await bot.openShop(kebabSeller);
                try {
                  await bot.buyFromShop(/kebab/i, 10);
                } catch (_) {}
                await bot.closeShop();
              }
            } catch (_) {}
            await bot.walkTo(
              AL_KHARID_WARRIORS.x,
              AL_KHARID_WARRIORS.z
            );
            continue;
          }
        }

        // Find and attack Al Kharid warriors
        const warrior = sdk.findNearbyNpc(/al.kharid warrior/i);
        if (warrior) {
          try {
            await bot.attack(warrior);
          } catch (_) {}
          await sdk.waitForTicks(6);
          totalKills++;
          alKharidKills++;
          updateCombatStyle();
        } else {
          await sdk.waitForTicks(3);
        }

        // Pick up and bury bones
        const bones = sdk.findGroundItem(/^bones$/i);
        if (bones) {
          try {
            await bot.pickupItem(bones);
            const invBones = sdk.findInventoryItem(/^bones$/i);
            if (invBones) await sdk.sendUseItem(invBones.slot);
          } catch (_) {}
        }

        // Bank coins periodically
        const coins = sdk.countInventoryItems(/coins/i);
        if (coins > 200) {
          console.log(`[KING] Banking ${coins} coins`);
          await bot.walkTo(AL_KHARID_BANK.x, AL_KHARID_BANK.z);
          try {
            await bot.openBank();
            await bot.depositItem(/coins/i, -1);
            await bot.closeBank();
          } catch (_) {}
          await bot.walkTo(AL_KHARID_WARRIORS.x, AL_KHARID_WARRIORS.z);
        }

        // Check deliveries periodically
        if (alKharidKills % 10 === 0 && alKharidKills > 0) {
          await checkDeliveries();
        }

        await bot.dismissBlockingUI();

        // Periodic status report
        if (alKharidKills % 25 === 0 && alKharidKills > 0) {
          const atk = sdk.getSkill("Attack")?.level ?? 0;
          const str = sdk.getSkill("Strength")?.level ?? 0;
          const def = sdk.getSkill("Defence")?.level ?? 0;
          console.log(
            `[KING] Al Kharid kills: ${alKharidKills} ` +
              `(total: ${totalKills}) | ` +
              `Atk ${atk} / Str ${str} / Def ${def}`
          );
        }

        // Stay near warriors
        const dx = Math.abs(state.player.worldX - AL_KHARID_WARRIORS.x);
        const dz = Math.abs(state.player.worldZ - AL_KHARID_WARRIORS.z);
        if (dx + dz > 15) {
          await bot.walkTo(AL_KHARID_WARRIORS.x, AL_KHARID_WARRIORS.z);
        }
      }
    } catch (err) {
      console.log(`[KING] Phase 7 error: ${err}`);
      if (detectDeath()) {
        console.log("[KING] Detected death at Al Kharid, recovering...");
        await sdk.waitForTicks(10);
      }
    }

    // Final stats
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
      "Cooking",
      "Crafting",
    ];
    console.log("[KING] === FINAL STATS ===");
    for (const name of skills) {
      const s = sdk.getSkill(name);
      if (s && s.level > 1) {
        console.log(`[KING]   ${name}: ${s.level}`);
      }
    }
    console.log(`[KING] Total kills: ${totalKills}`);
    console.log("[KING] The king's reign is complete.");
  },
  { timeout: 7_200_000 }
);

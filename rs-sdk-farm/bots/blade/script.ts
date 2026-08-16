import { runScript } from "../../sdk/runner";

// BLADE — law-rune combat farmer. Wizards drop law runes (1/128) and a
// spread of other runes; a pair of blades compounding kills is the
// fleet's sustainable law source until runecrafting is proven. Ramp:
// cows until combat ~20 (fast on the accelerated curve), then park at
// the wizard spawn west of Lumbridge (3148,3200) forever: kill, loot
// every rune, bury bones, rest-regen when low, bank laws at Draynor.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    const COW_FIELD = { x: 3253, z: 3290 };
    const COW_GATE = { x: 3253, z: 3266 };
    const WIZARDS = { x: 3148, z: 3200 };
    const DRAYNOR_BANK = { x: 3092, z: 3243 };

    let kills = 0;
    let combatStyle = 0;
    let lawsBanked = 0;

    async function isAlive() {
      const state = sdk.getState();
      if (!state?.player) return true;
      return state.player.hp > 0;
    }

    function rotateStyle() {
      if (kills % 5 === 0) {
        const CYCLE = [0, 1, 3, 2]; // all four styles, Defence included
        const next = CYCLE[Math.floor(kills / 5) % CYCLE.length];
        if (next !== combatStyle) {
          combatStyle = next;
          try { sdk.sendSetCombatStyle(combatStyle); } catch (_) {}
        }
      }
    }

    function combatLevelIsh(): number {
      const a = sdk.getSkill("Attack")?.level ?? 1;
      const s = sdk.getSkill("Strength")?.level ?? 1;
      const d = sdk.getSkill("Defence")?.level ?? 1;
      const h = sdk.getSkill("Hitpoints")?.level ?? 10;
      return Math.floor((a + s + d + h) / 4);
    }

    async function equipGear() {
      const sword = sdk.findInventoryItem(/sword|dagger|scimitar/i);
      if (sword) { try { await bot.equipItem(sword); } catch (_) {} }
      const shield = sdk.findInventoryItem(/shield/i);
      if (shield) { try { await bot.equipItem(shield); } catch (_) {} }
    }

    async function restIfLow(anchor: { x: number; z: number }) {
      const st = sdk.getState()?.player;
      if (st && st.hp < st.maxHp * 0.35) {
        await bot.walkTo(anchor.x + 12, anchor.z - 8);
        while (true) {
          const s = sdk.getState()?.player;
          if (!s || s.hp >= s.maxHp * 0.8) break;
          await sdk.waitForTicks(20);
        }
        await bot.walkTo(anchor.x, anchor.z);
      }
    }

    async function lootAndBury() {
      const rune = sdk.findGroundItem(/rune$/i) ?? sdk.findGroundItem(/coins/i);
      if (rune) {
        try { await bot.pickupItem(rune); } catch (_) {}
      }
      const bones = sdk.findGroundItem(/^bones$/i);
      if (bones) {
        try {
          await bot.pickupItem(bones);
          const inv = sdk.findInventoryItem(/^bones$/i);
          if (inv) await sdk.sendUseItem(inv.slot);
        } catch (_) {}
      }
    }

    async function bankLaws() {
      const laws = sdk.countInventoryItems(/law rune/i);
      if (laws < 5 && sdk.getInventory().length < 24) return;
      console.log(`[BLADE] Banking loot (${laws} laws on hand)`);
      await bot.walkTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z);
      try {
        await bot.openBank();
        await bot.depositItem(/law rune/i, -1);
        await bot.depositItem(/rune$/i, -1);
        await bot.depositItem(/coins/i, -1);
        await bot.closeBank();
        lawsBanked += laws;
        console.log(`[BLADE] LAW-VAULT total banked: ${lawsBanked}`);
      } catch (_) {}
      await bot.walkTo(WIZARDS.x, WIZARDS.z);
    }

    // ═══════════════════════════════════════════════════════
    console.log("[BLADE] Law-farm blade reporting");
    await sdk.say("blade up. laws for the fleet");

    for (const junk of [
      /tinderbox/i, /fishing net/i, /bucket/i, /^pot$/i, /pickaxe/i, /^bronze axe$/i,
    ]) {
      try { await bot.dropItem(junk, "all"); } catch (_) {}
    }
    await equipGear();

    while (true) {
      if (!(await isAlive())) {
        console.log("[BLADE] Death — recovering");
        await sdk.waitForTicks(5);
        await equipGear();
        continue;
      }

      const cl = combatLevelIsh();
      const onWizards = cl >= 18;
      const anchor = onWizards ? WIZARDS : COW_FIELD;
      const prey = onWizards ? /^wizard$/i : /^cow$/i;

      const st = sdk.getState()?.player;
      if (
        st &&
        Math.abs(st.worldX - anchor.x) + Math.abs(st.worldZ - anchor.z) > 25
      ) {
        if (!onWizards) await bot.walkTo(COW_GATE.x, COW_GATE.z);
        await bot.walkTo(anchor.x, anchor.z);
        if (onWizards) console.log("[BLADE] On station at the wizard spawn");
      }

      const target = sdk.findNearbyNpc(prey);
      if (target) {
        try { await bot.attack(target); } catch (_) {}
        await sdk.waitForTicks(4);
        kills++;
        rotateStyle();
      } else {
        await sdk.waitForTicks(3);
      }

      await lootAndBury();
      if (onWizards) await bankLaws();
      await restIfLow(anchor);

      if (sdk.getInventory().length >= 26) {
        try { await bot.dropItem(/cowhide|raw beef/i, "all"); } catch (_) {}
      }
    }
  },
  { timeout: 86_400_000 }
);

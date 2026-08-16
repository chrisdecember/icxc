import { runScript } from "../../sdk/runner";

// BLADE — law-rune combat farmer. Dark wizards drop 3x law runes at
// 1/128 (the fleet's primary law source). Pipeline: men until cl>=25,
// then dark wizards at the Varrock south circle (3225,3374). Laws
// banked at Varrock East. Ramp target changed from cows to Lumbridge
// men (open field, no fences — cow pen gate was a blocker).

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    const RAMP_AREA = { x: 3236, z: 3240 };
    const DARK_WIZARDS = { x: 3225, z: 3374 };
    const VARROCK_BANK = { x: 3253, z: 3420 };
    const RAMP_THRESHOLD = 25;

    let kills = 0;
    let combatStyle = 0;
    let lawsBanked = 0;
    let lastHp = -1;

    async function isAlive() {
      const state = sdk.getState();
      if (!state?.player) return true;
      return state.player.hp > 0;
    }

    function rotateStyle() {
      if (kills % 5 === 0) {
        const CYCLE = [0, 1, 3, 2];
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
      await bot.walkTo(VARROCK_BANK.x, VARROCK_BANK.z);
      try {
        await bot.openBank();
        await bot.depositItem(/law rune/i, -1);
        await bot.depositItem(/rune$/i, -1);
        await bot.depositItem(/coins/i, -1);
        await bot.closeBank();
        lawsBanked += laws;
        console.log(`[BLADE] LAW-VAULT total banked: ${lawsBanked}`);
      } catch (_) {}
      await bot.walkTo(DARK_WIZARDS.x, DARK_WIZARDS.z);
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
      const st = sdk.getState()?.player;
      const hp = st?.hp ?? 0;
      const maxHp = st?.maxHp ?? 10;

      // Death detection: HP jumps up significantly = respawn
      if (lastHp > 0 && hp > 0 && hp - lastHp >= 5) {
        console.log(`[BLADE] Death detected (hp ${lastHp} -> ${hp}). Recovering.`);
        await equipGear();
      }
      if (hp > 0) lastHp = hp;

      if (!(await isAlive())) {
        console.log("[BLADE] Death — recovering");
        await sdk.waitForTicks(5);
        await equipGear();
        continue;
      }

      const cl = combatLevelIsh();
      const onDarkWiz = cl >= RAMP_THRESHOLD;
      const anchor = onDarkWiz ? DARK_WIZARDS : RAMP_AREA;
      const prey = onDarkWiz ? /^dark wizard$/i : /^man$|^woman$/i;

      // Status log every 100 kills
      if (kills > 0 && kills % 100 === 0) {
        console.log(`[BLADE] STATUS cl=${cl} kills=${kills} laws-banked=${lawsBanked} at=${onDarkWiz ? 'dark-wizards' : 'ramp-men'}`);
      }

      if (
        st &&
        Math.abs(st.worldX - anchor.x) + Math.abs(st.worldZ - anchor.z) > 25
      ) {
        await bot.walkTo(anchor.x, anchor.z);
        if (onDarkWiz) console.log("[BLADE] On station at dark wizard circle");
        else console.log(`[BLADE] Heading to ramp area (cl=${cl})`);
      }

      const target = sdk.findNearbyNpc(prey, { withOption: /attack/i });
      if (target) {
        try { await bot.attack(target); } catch (_) {}
        await sdk.waitForTicks(4);
        kills++;
        rotateStyle();
        if (kills % 20 === 0) {
          console.log(`[BLADE] ${kills} kills, cl=${cl}, hp=${hp}/${maxHp}, target=${onDarkWiz ? 'dark-wizards' : 'men'}`);
        }
      } else {
        await sdk.waitForTicks(3);
      }

      await lootAndBury();
      if (onDarkWiz) await bankLaws();
      await restIfLow(anchor);

      if (sdk.getInventory().length >= 26) {
        try { await bot.dropItem(/cowhide|raw beef/i, "all"); } catch (_) {}
      }
    }
  },
  { timeout: 86_400_000 }
);

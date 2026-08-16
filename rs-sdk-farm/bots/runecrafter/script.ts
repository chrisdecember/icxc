import { runScript } from "../../sdk/runner";

// GTRUNE v1 — RUNECRAFT RECON. The endgame is law runes for fleet-wide
// teleports, but this 2004-era server may only partially implement
// runecrafting (no wiki page for the skill; talismans exist as drops).
// This bot GATHERS EVIDENCE while stockpiling: Aubury's essence-mine
// teleport -> mine rune essence -> return -> scout the air-altar ruins
// candidates and LOG what locs/options actually exist there. Every
// finding lands in the log with a RECON tag for the operator.
//
// Also farms Lumbridge goblins between cycles for the air talisman
// (1/128 drop) that altar entry will need.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    const AUBURY = { x: 3253, z: 3402 };
    const GOBLINS = { x: 3245, z: 3235 }; // east of Lumbridge, river side
    const RUINS_CANDIDATES = [
      { name: "air-ruins-falador-south", x: 2985, z: 3292 },
      { name: "air-ruins-varrock-alt", x: 3127, z: 3405 },
    ];

    let essenceMined = 0;
    let goblinKills = 0;
    let reconDone = false;

    async function isAlive() {
      const state = sdk.getState();
      if (!state?.player) return true;
      return state.player.hp > 0;
    }

    function logNearby(tag: string) {
      const st = sdk.getState();
      const locs = [...new Set(((st?.nearbyLocs ?? []) as any[]).map(
        (l) => `${l.name}[${(l.options ?? []).join("/")}]`
      ))].slice(0, 12);
      const npcs = [...new Set(((st?.nearbyNpcs ?? []) as any[]).map((n) => n.name))].slice(0, 8);
      console.log(`[RUNE] RECON ${tag} @ (${st?.player?.worldX},${st?.player?.worldZ})`);
      console.log(`[RUNE] RECON locs: ${locs.join(" | ") || "none"}`);
      console.log(`[RUNE] RECON npcs: ${npcs.join(", ") || "none"}`);
    }

    async function essenceRun() {
      await bot.walkTo(AUBURY.x, AUBURY.z);
      const aubury = sdk.findNearbyNpc(/aubury/i);
      if (!aubury) {
        console.log("[RUNE] RECON aubury-not-found");
        return;
      }
      try {
        await bot.interactNpc(aubury, /teleport/i);
        await sdk.waitForTicks(6);
      } catch (e) {
        console.log(`[RUNE] RECON teleport-failed: ${(e as Error).message}`);
        return;
      }
      logNearby("essence-mine-arrival");

      let swings = 0;
      while (sdk.getInventory().length < 26 && swings < 120) {
        const rock =
          sdk.findNearbyLoc(/essence/i, { withOption: /mine/i }) ??
          sdk
            .getNearbyLocs()
            .filter((l: any) => l.options?.some((o: string) => /mine/i.test(o)))[0];
        if (rock) {
          try { await bot.interactLoc(rock, /mine/i); } catch (_) {}
          await bot.dismissBlockingUI();
        } else {
          await sdk.waitForTicks(3);
        }
        swings++;
      }
      essenceMined += sdk.countInventoryItems(/essence/i);
      console.log(`[RUNE] Essence stockpile: ${essenceMined} lifetime`);

      const portal = sdk.findNearbyLoc(/portal/i);
      if (portal) {
        try { await bot.interactLoc(portal, /use|enter|exit/i); } catch (_) {}
        await sdk.waitForTicks(6);
      } else {
        console.log("[RUNE] RECON no-portal-found — logging surroundings");
        logNearby("essence-mine-stuck");
      }
    }

    async function ruinsRecon() {
      for (const cand of RUINS_CANDIDATES) {
        console.log(`[RUNE] Scouting ${cand.name}`);
        try { await bot.walkTo(cand.x, cand.z); } catch (_) {}
        logNearby(cand.name);
        const ruins = sdk.findNearbyLoc(/ruins|altar/i);
        if (ruins) {
          console.log(`[RUNE] RECON FOUND: ${ruins.name} at (${ruins.x},${ruins.z}) opts=[${(ruins as any).options}]`);
          // Try entering with whatever we have (expected to fail sans talisman)
          try { await bot.interactLoc(ruins, /enter|use/i); } catch (_) {}
          await sdk.waitForTicks(6);
          logNearby(`${cand.name}-after-enter-attempt`);
        }
      }
      reconDone = true;
    }

    async function goblinFarm(kills: number) {
      await bot.walkTo(GOBLINS.x, GOBLINS.z);
      for (let i = 0; i < kills; i++) {
        if (!(await isAlive())) {
          await sdk.waitForTicks(5);
          await bot.walkTo(GOBLINS.x, GOBLINS.z);
        }
        const gob = sdk.findNearbyNpc(/^goblin$/i);
        if (gob) {
          try { await bot.attack(gob); } catch (_) {}
          await sdk.waitForTicks(4);
          goblinKills++;
        } else {
          await sdk.waitForTicks(3);
        }
        const tali = sdk.findGroundItem(/talisman/i);
        if (tali) {
          try {
            await bot.pickupItem(tali);
            console.log("[RUNE] RECON TALISMAN ACQUIRED!");
          } catch (_) {}
        }
        const st = sdk.getState()?.player;
        if (st && st.hp < st.maxHp * 0.35) {
          await bot.walkTo(GOBLINS.x - 15, GOBLINS.z - 10);
          while (true) {
            const s = sdk.getState()?.player;
            if (!s || s.hp >= s.maxHp * 0.8) break;
            await sdk.waitForTicks(20);
          }
          await bot.walkTo(GOBLINS.x, GOBLINS.z);
        }
      }
    }

    // ═══════════════════════════════════════════════════════
    console.log("[RUNE] Runecraft recon reporting");
    await sdk.say("scouting the rune trade");

    // Purge starter junk, keep nothing but a weapon
    for (const junk of [
      /tinderbox/i, /fishing net/i, /shrimps/i, /bucket/i, /^pot$/i,
      /bread/i, /wooden shield/i, /shortbow/i, /arrow/i, /^bronze axe$/i, /pickaxe/i,
    ]) {
      try { await bot.dropItem(junk, "all"); } catch (_) {}
    }
    const sword = sdk.findInventoryItem(/sword|dagger/i);
    if (sword) { try { await bot.equipItem(sword); } catch (_) {} }

    while (true) {
      if (!(await isAlive())) {
        console.log("[RUNE] Death — recovering");
        await sdk.waitForTicks(5);
        continue;
      }

      await essenceRun();
      if (!reconDone) await ruinsRecon();
      await goblinFarm(40);
    }
  },
  { timeout: 86_400_000 }
);

import { runScript } from "../../sdk/runner";

// GTLAW15 — ICE PILOT. First veteran transferred from the lite swarm to
// an SDK brain to open the 7/128 law tier (2.3x the dark-wizard rate).
// Route + hazards from gticeprobe: Ladder#1759(3008,3150) Climb-Down ->
// (3008,9550); muggers west of entrance (harmless at CL 50+); hobgoblin
// belt mid-route (aggros under CL 56 — tanky enough to walk through);
// ice warriors lvl 57 at (3040,9582), always aggro. No food: the ladder
// is the recovery valve — warriors cannot follow through a climb.
// Laws bank at Draynor. Death costs a walk, not the stack (keep-3).

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    const LADDER_DOWN = { x: 3008, z: 3150 };
    const UNDER_LADDER = { x: 3008, z: 9550 };
    const HOPS = [
      { x: 3016, z: 9554 }, { x: 3024, z: 9560 }, { x: 3032, z: 9566 },
      { x: 3040, z: 9573 }, { x: 3044, z: 9581 },
    ];
    const DRAYNOR_BANK = { x: 3092, z: 3243 };
    const BANK_AT = 12;
    const RETREAT_FRAC = 0.4;
    const RESUME_FRAC = 0.8;

    const p = () => sdk.getState()?.player as any;
    const under = () => (p()?.worldZ ?? 0) > 6000;
    const pos = () => { const q = p(); return q ? `(${q.worldX},${q.worldZ})` : "(?)"; };
    const hpFrac = () => { const q = p(); return q && q.maxHp > 0 ? q.hp / q.maxHp : 1; };
    const laws = () => sdk.countInventoryItems(/law rune/i);
    let banked = 0, kills = 0;

    async function climbDown() {
      const l = sdk.findNearbyLoc(/^ladder$/i);
      if (!l) return false;
      try { await bot.interactLoc(l, /climb[- ]?down/i); } catch (_) {}
      await sdk.waitForTicks(3);
      return under();
    }
    async function climbUp() {
      const l = sdk.findNearbyLoc(/^ladder$/i);
      if (!l) return false;
      try { await bot.interactLoc(l, /climb[- ]?up/i); } catch (_) {}
      await sdk.waitForTicks(3);
      return !under();
    }

    console.log(`[ICE] pilot online at ${pos()} laws=${laws()}`);

    while (true) {
      const st = sdk.getState();
      if (!st?.player) { await sdk.waitForTicks(4); continue; }

      if (!under()) {
        // Surface logic: bank, rest, or head down.
        if (laws() >= BANK_AT) {
          console.log(`[ICE] BANK-RUN with ${laws()} laws from ${pos()}`);
          try { await bot.walkTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 3); } catch (_) {}
          try {
            await bot.openBank();
            await bot.depositItem(/law rune/i, -1);
            await bot.closeBank();
            banked += 1;
            console.log(`[ICE] BANKED at Draynor — run #${banked}, inventory now ${laws()} laws`);
          } catch (e) { console.log(`[ICE] bank failed: ${e}`); }
          continue;
        }
        const nearLadder = Math.hypot((p()?.worldX ?? 0) - LADDER_DOWN.x, (p()?.worldZ ?? 0) - LADDER_DOWN.z) <= 6;
        if (nearLadder && hpFrac() < RESUME_FRAC) {
          await sdk.waitForTicks(16); // surface rest — nothing aggros here
          continue;
        }
        if (!nearLadder) {
          try { await bot.walkTo(LADDER_DOWN.x, LADDER_DOWN.z, 3); } catch (e) { console.log(`[ICE] surface walk err: ${e}`); await sdk.waitForTicks(8); }
          continue;
        }
        if (!(await climbDown())) { await sdk.waitForTicks(6); continue; }
        console.log(`[ICE] descended at ${pos()} hp=${p()?.hp}/${p()?.maxHp}`);
        continue;
      }

      // Underground logic.
      if (hpFrac() < RETREAT_FRAC) {
        console.log(`[ICE] RETREAT hp=${p()?.hp}/${p()?.maxHp} laws=${laws()} at ${pos()}`);
        try { await bot.walkTo(UNDER_LADDER.x, UNDER_LADDER.z, 3); } catch (_) {}
        await climbUp();
        continue;
      }
      if (laws() >= BANK_AT) {
        try { await bot.walkTo(UNDER_LADDER.x, UNDER_LADDER.z, 3); } catch (_) {}
        await climbUp();
        continue;
      }

      // Loot first — law piles are the entire point.
      const pile = sdk.findGroundItem(/law rune/i);
      if (pile) {
        try { await bot.pickupItem(pile); console.log(`[ICE] LOOT laws -> ${laws()}`); } catch (_) {}
        await sdk.waitForTicks(2);
        continue;
      }

      // Fight: nearest ice warrior.
      const warrior = sdk.findNearbyNpc(/ice warrior/i);
      if (warrior) {
        try {
          const r = await bot.attack(warrior, 8000);
          kills++;
          if (kills % 5 === 0) console.log(`[ICE] ~${kills} engagements, laws=${laws()}, hp=${p()?.hp}/${p()?.maxHp}`);
        } catch (_) {}
        await sdk.waitForTicks(2);
        continue;
      }

      // No warrior in view: push along the hop chain toward the chamber.
      const q = p();
      const next = HOPS.find(h => Math.hypot(h.x - q.worldX, h.z - q.worldZ) > 4) ?? HOPS.at(-1)!;
      try { await bot.walkTo(next.x, next.z, 3); } catch (_) {}
      await sdk.waitForTicks(2);
    }
  },
  { timeout: 86_400_000 }
);

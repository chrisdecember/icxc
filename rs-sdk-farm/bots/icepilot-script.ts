import { runScript } from "../../sdk/runner";

// GTLAW15 — ICE PILOT v3: reliable emergency + sustain doctrine.
//
// v2 lesson: warriors ALWAYS aggro and walk to us, so the pilot never
// needs to reach the chamber — it fights ANCHORED 2 tiles from the
// under-ladder escape hatch. Three sustain layers:
//   1. LEASH   — never fight >8 tiles from the ladder; bait east and
//                fall back when no warrior is in view.
//   2. FOOD    — bananas from Wydin's (Port Sarim); eat under 70% hp.
//   3. ESCAPE  — retreat at 50%; under 30% EMERGENCY: interactLoc the
//                ladder directly (walks + climbs in one call), retried
//                until surfaced. Warriors cannot follow a climb.
// Laws bank at Draynor at 12+. Death keeps the law stack (keep-3).

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    const LADDER_DOWN = { x: 3008, z: 3150 };
    const UNDER_LADDER = { x: 3008, z: 9550 };
    const BAIT_SPOT = { x: 3018, z: 9556 };
    const COMBAT_LEASH = 8;
    const DRAYNOR_BANK = { x: 3092, z: 3243 };
    const WYDIN = { x: 3014, z: 3205 };
    const BANK_AT = 12;
    const EAT_FRAC = 0.7;
    const RETREAT_FRAC = 0.5;
    const EMERGENCY_FRAC = 0.3;
    const RESUME_FRAC = 0.8;
    const FOOD_BUY = 16;
    const FOOD = /banana|bread|cake|meat|anchovies|shrimp/i;

    const p = () => sdk.getState()?.player as any;
    const under = () => (p()?.worldZ ?? 0) > 6000;
    const pos = () => { const q = p(); return q ? `(${q.worldX},${q.worldZ})` : "(?)"; };
    const hpFrac = () => { const q = p(); return q && q.maxHp > 0 ? q.hp / q.maxHp : 1; };
    const laws = () => sdk.countInventoryItems(/law rune/i);
    const food = () => sdk.countInventoryItems(FOOD);
    const distLadder = () => { const q = p(); return q ? Math.hypot(q.worldX - UNDER_LADDER.x, q.worldZ - UNDER_LADDER.z) : 99; };
    let banked = 0, kills = 0, retreats = 0, emergencies = 0;

    async function surfaceViaLadder(emergency: boolean) {
      for (let i = 0; i < 8 && under(); i++) {
        if (!emergency && distLadder() > 2) {
          try { await bot.walkTo(UNDER_LADDER.x, UNDER_LADDER.z, 2); } catch (_) {}
        }
        const l = sdk.findNearbyLoc(/^ladder$/i);
        if (l) { try { await bot.interactLoc(l, /climb[- ]?up/i); } catch (_) {} }
        await sdk.waitForTicks(3);
      }
      return !under();
    }

    console.log(`[ICE] pilot v3 online at ${pos()} laws=${laws()} food=${food()}`);

    while (true) {
      const st = sdk.getState();
      if (!st?.player) { await sdk.waitForTicks(4); continue; }

      if (!under()) {
        // Bank leg.
        if (laws() >= BANK_AT) {
          console.log(`[ICE] BANK-RUN with ${laws()} laws`);
          try { await bot.walkTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 3); } catch (_) {}
          try {
            await bot.openBank();
            await bot.depositItem(/law rune/i, -1);
            await bot.closeBank();
            banked += 1;
            console.log(`[ICE] BANKED at Draynor — run #${banked}`);
          } catch (e) { console.log(`[ICE] bank failed: ${e}`); }
          continue;
        }
        // Provision leg: restock bananas when dry (bananas ~2gp at Wydin's).
        if (food() === 0 && sdk.countInventoryItems(/^coins$/i) >= 50) {
          console.log(`[ICE] PROVISION run to Wydin's`);
          try {
            await bot.walkTo(WYDIN.x, WYDIN.z, 3);
            await bot.openShop(/wydin/i);
            await bot.buyFromShop(/banana/i, FOOD_BUY);
            console.log(`[ICE] provisioned ${food()} food`);
          } catch (e) { console.log(`[ICE] provision failed (continuing without): ${e}`); }
        }
        // Rest near the surface ladder until healthy, then descend.
        const nearLadder = Math.hypot((p()?.worldX ?? 0) - LADDER_DOWN.x, (p()?.worldZ ?? 0) - LADDER_DOWN.z) <= 6;
        if (nearLadder && hpFrac() < RESUME_FRAC) { await sdk.waitForTicks(16); continue; }
        if (!nearLadder) {
          try { await bot.walkTo(LADDER_DOWN.x, LADDER_DOWN.z, 3); } catch (e) { await sdk.waitForTicks(8); }
          continue;
        }
        const l = sdk.findNearbyLoc(/^ladder$/i);
        if (l) { try { await bot.interactLoc(l, /climb[- ]?down/i); } catch (_) {} }
        await sdk.waitForTicks(3);
        if (under()) console.log(`[ICE] descended at ${pos()} hp=${p()?.hp}/${p()?.maxHp} food=${food()}`);
        continue;
      }

      // ---- underground ----
      // Layer 3: escape. Emergency skips the walk — interactLoc paths for us.
      if (hpFrac() < EMERGENCY_FRAC) {
        emergencies++;
        console.log(`[ICE] EMERGENCY hp=${p()?.hp}/${p()?.maxHp} at ${pos()} — direct ladder`);
        await surfaceViaLadder(true);
        continue;
      }
      if (hpFrac() < RETREAT_FRAC) {
        retreats++;
        console.log(`[ICE] RETREAT hp=${p()?.hp}/${p()?.maxHp} laws=${laws()} (#${retreats})`);
        await surfaceViaLadder(false);
        continue;
      }
      // Layer 2: food.
      if (hpFrac() < EAT_FRAC && food() > 0) {
        try { await bot.eatFood(FOOD); } catch (_) {}
        await sdk.waitForTicks(2);
        continue;
      }
      if (laws() >= BANK_AT) { await surfaceViaLadder(false); continue; }

      // Loot law piles first.
      const pile = sdk.findGroundItem(/law rune/i);
      if (pile) {
        try { await bot.pickupItem(pile); console.log(`[ICE] LOOT laws -> ${laws()}`); } catch (_) {}
        await sdk.waitForTicks(2);
        continue;
      }

      // Layer 1: leash — fall back to the anchor before fighting farther out.
      if (distLadder() > COMBAT_LEASH) {
        try { await bot.walkTo(UNDER_LADDER.x + 2, UNDER_LADDER.z + 1, 2); } catch (_) {}
        await sdk.waitForTicks(2);
        continue;
      }

      // v4: RIDE THE FIGHT TO THE KILL. The 8s attack timeout resolved
      // mid-fight (lvl-57 kills take 30-60s); the loop re-targeted, the
      // wounded warrior regenerated, and hours of chip damage produced
      // ZERO completed kills — hence zero 7/128 drops. Stay engaged with
      // the same npc until combat drops, eating and emergency-checking
      // mid-fight.
      const warrior = sdk.findNearbyNpc(/ice warrior/i);
      if (warrior) {
        try { await bot.attack(warrior, 8000); } catch (_) {}
        const targetIdx = (warrior as any).index;
        for (let t = 0; t < 40; t++) { // ~96s cap
          await sdk.waitForTicks(4);
          const c = (sdk.getState()?.player as any)?.combat;
          if (!c?.inCombat || (c.targetIndex !== targetIdx && c.targetIndex !== -1)) break;
          if (hpFrac() < EMERGENCY_FRAC) break; // outer loop handles the escape
          if (hpFrac() < EAT_FRAC && food() > 0) { try { await bot.eatFood(FOOD); } catch (_) {} }
        }
        kills++;
        if (kills % 5 === 0) console.log(`[ICE] ~${kills} fights ridden, laws=${laws()}, hp=${p()?.hp}/${p()?.maxHp}, food=${food()}`);
        await sdk.waitForTicks(2);
        continue;
      }

      // No warrior in view: bait east briefly, then return to the anchor.
      try { await bot.walkTo(BAIT_SPOT.x, BAIT_SPOT.z, 3); } catch (_) {}
      await sdk.waitForTicks(6);
      try { await bot.walkTo(UNDER_LADDER.x + 2, UNDER_LADDER.z + 1, 2); } catch (_) {}
      await sdk.waitForTicks(2);
    }
  },
  { timeout: 86_400_000 }
);

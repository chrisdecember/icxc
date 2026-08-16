import { runScript } from "../../sdk/runner";

// GTNINJA v2 — PILE HOOVER. The lesson from the hiscores: you can't ID
// collector bots by name (bkoaza is rank-1 thieving, faster than nick's
// whole fleet, and matches no naming pattern). So don't try. The collector
// pattern's signature isn't the NAME — it's the DROP PILES. Worker bots
// pickpocket and drop coins in place for a collector to sweep; we camp the
// pickpocket clusters and hoover every coin/rune/valuable pile that isn't
// ours, getting there before their collector. Ground items are fair game.
//
// The bot-handle detection stays, but only as INTEL (logging which fleets
// work which cluster) — never as a gate on what we grab.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    // Drop zones: where collector fleets pickpocket, so where piles appear.
    const DROP_ZONES = [
      { name: "lumbridge-men", x: 3231, z: 3218 },
      { name: "barbarian-village", x: 3082, z: 3420 },
      { name: "edgeville", x: 3088, z: 3242 },
      { name: "draynor", x: 3092, z: 3243 },
      { name: "varrock-square", x: 3213, z: 3423 },
    ];
    const LOOT = /coins|rune|ore|bar|essence|gem|sapphire|emerald|ruby|diamond/i;
    const BANK = { x: 3185, z: 3436 }; // Varrock West

    let grabbed = 0;
    let gpGrabbed = 0;
    let zoneIdx = 0;

    async function isAlive() {
      const state = sdk.getState();
      if (!state?.player) return true;
      return state.player.hp > 0;
    }

    // Intel only: log which fleets are working this zone. Never gates grabs.
    function logFleetIntel(zone: string) {
      const players = (sdk.getNearbyPlayers() as any[])
        .filter((p) => !/^gt/i.test(p.name));
      if (players.length === 0) return;
      const suspects = players.filter(
        (p) => /^nicksthief/i.test(p.name) || /\d/.test(p.name) || p.combatLevel <= 5
      );
      if (suspects.length > 0) {
        console.log(
          `[NINJA] FLEET-INTEL ${zone}: ${suspects.length} suspects [${suspects
            .slice(0, 6)
            .map((p) => p.name)
            .join(",")}]`
        );
      }
    }

    async function hooverZone(zone: { name: string; x: number; z: number }, ticks: number) {
      let dry = 0;
      for (let t = 0; t < ticks; t++) {
        if (!(await isAlive())) return;
        // Any valuable pile not sitting under one of our own bots.
        const piles = (sdk.getGroundItems() as any[])
          .filter((g) => LOOT.test(g.name))
          .sort((a, b) => {
            const st = sdk.getState()?.player;
            if (!st) return 0;
            return (
              Math.abs(a.x - st.worldX) + Math.abs(a.z - st.worldZ) -
              (Math.abs(b.x - st.worldX) + Math.abs(b.z - st.worldZ))
            );
          });
        const pile = piles[0];
        if (!pile) {
          if (++dry > 6) return; // zone quiet — rotate
          // Drift around the cluster to catch piles at its edges.
          await bot.walkTo(zone.x, zone.z);
          await sdk.waitForTicks(2);
          continue;
        }
        dry = 0;
        const before = sdk.countInventoryItems(/coins/i);
        try { await bot.pickupItem(pile); } catch (_) {}
        const after = sdk.countInventoryItems(/coins/i);
        if (after > before || pile.name && !/coins/i.test(pile.name)) {
          grabbed++;
          gpGrabbed += Math.max(0, after - before);
          console.log(
            `[NINJA] HOOVER ${pile.name} @ (${pile.x},${pile.z}) — ${grabbed} piles, ${gpGrabbed}gp intercepted`
          );
        }
        // Bank when the pack fills so a ninja death doesn't gift it back.
        if (sdk.getInventory().length >= 26) {
          await bot.walkTo(BANK.x, BANK.z);
          try {
            await bot.openBank();
            await bot.depositItem(/coins/i, -1);
            await bot.depositItem(/rune|ore|bar|gem/i, -1);
            await bot.closeBank();
          } catch (_) {}
          await bot.walkTo(zone.x, zone.z);
        }
      }
    }

    // ═══════════════════════════════════════════════════════
    console.log("[NINJA] v2: Pile-hoover active — camping the drop zones");

    while (true) {
      if (!(await isAlive())) {
        await sdk.waitForTicks(5);
        continue;
      }
      const zone = DROP_ZONES[zoneIdx++ % DROP_ZONES.length];
      await bot.walkTo(zone.x, zone.z);
      await sdk.waitForTicks(3);
      logFleetIntel(zone.name);
      await hooverZone(zone, 60); // work the zone ~60 ticks, then rotate
    }
  },
  { timeout: 86_400_000 }
);

import { runScript } from "../../sdk/runner";

// MERCHANT-MINER: THE IRON BARON — corners iron ore at SE Varrock.
// Iron is the smithing input every leveling agent wants and the rocks are
// contested (limited respawn). Copper to Mining 15, then iron forever.
// Full loads go to the KING (smelting XP) or get hawked at Lumbridge.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    const MEETING_POINT = { x: 3222, z: 3218 };
    const MINE = { x: 3285, z: 3365 };
    const WAYPOINTS_TO_MINE = [
      { x: 3240, z: 3260 },
      { x: 3260, z: 3300 },
      { x: 3270, z: 3340 },
      { x: 3285, z: 3365 },
    ];
    const WAYPOINTS_TO_LUMBRIDGE = [
      { x: 3270, z: 3340 },
      { x: 3260, z: 3300 },
      { x: 3240, z: 3260 },
      { x: 3222, z: 3218 },
    ];

    let deliveries = 0;
    let lastPos = { x: 0, z: 0 };
    let lastNpcs: string[] = [];
    // Iron rocks are heavily contested (measured: 8+ min zero XP while
    // camped by other agents). Verify iron pays; else join copper/tin.
    let ironFallback = false;
    let ironXpMark = -1;
    let ironAttempts = 0;

    async function walkWaypoints(points: { x: number; z: number }[]) {
      for (const p of points) await bot.walkTo(p.x, p.z);
    }

    async function isAlive() {
      const state = sdk.getState();
      if (!state?.player) return true;
      return state.player.hp > 0;
    }

    // Scarcity ladder capped at iron: the coal rung (Al Kharid mine) was
    // measured fatal — scorpions killed the baron 4x at (3301,3285) with
    // 10 HP and no armor. Iron at SE Varrock is the survivable frontier.
    function currentSite() {
      return MINE;
    }

    async function mineOne() {
      // Rocks are all named "Rocks" — name patterns can never target an ore
      // (learnings/mining.md). Mine any rock with a Mine option, like the
      // proven PICKSWING loop; the mine's spawn mix decides the ore.
      const rock = sdk
        .getNearbyLocs()
        .filter((l) => l.options?.some((o: string) => /mine/i.test(o)))
        .sort((a: any, b: any) => (a.distance ?? 0) - (b.distance ?? 0))[0];
      if (rock) {
        try {
          await bot.interactLoc(rock, /mine/i);
        } catch (_) {}
        await bot.dismissBlockingUI();
      } else {
        await sdk.waitForTicks(3);
      }
      const st = sdk.getState();
      const site = currentSite();
      if (st?.player) {
        const d =
          Math.abs(st.player.worldX - site.x) +
          Math.abs(st.player.worldZ - site.z);
        if (d > 20) await bot.walkTo(site.x, site.z);
      }
    }

    async function unload() {
      console.log(`[IRONMN] Full load, delivery #${++deliveries}`);
      await walkWaypoints(WAYPOINTS_TO_LUMBRIDGE);
      await sdk.say("iron baron: iron ore for trade, goods only");

      // Offer to the KING first (smelting XP), else hawk briefly, else drop copper/tin
      let delivered = false;
      const king = sdk.findNearbyPlayer(/king/i);
      if (king) {
        try {
          const r = await bot.trade(king, {
            give: [{ name: /ore/i, amount: -1 }],
            timeout: 30_000,
          });
          delivered = r.success;
        } catch (_) {}
      }
      if (!delivered) {
        // KING may be at the furnace smelting rather than the courtyard.
        await bot.walkTo(3225, 3256);
        const kingAtFurnace = sdk.findNearbyPlayer(/king/i);
        if (kingAtFurnace) {
          try {
            const r = await bot.trade(kingAtFurnace, {
              give: [{ name: /ore/i, amount: -1 }],
              timeout: 30_000,
            });
            delivered = r.success;
          } catch (_) {}
        }
      }
      if (!delivered) {
        await bot.walkTo(MEETING_POINT.x, MEETING_POINT.z);
        try {
          await bot.serveTrades({
            give: [{ name: /iron ore/i, amount: -1 }],
            accept: (offer) => offer.length > 0,
            timeout: 90_000,
            maxTrades: 3,
          });
        } catch (_) {}
        try { await bot.dropItem(/copper ore/i, "all"); } catch (_) {}
        try { await bot.dropItem(/tin ore/i, "all"); } catch (_) {}
        // No buyers: shed iron down to a small hawking reserve so the pack
        // never stays full — a full pack means zero mining forever.
        while (sdk.countInventoryItems(/iron ore/i) > 10) {
          try { await bot.dropItem(/iron ore/i, 1); } catch (_) { break; }
        }
      }
      await walkWaypoints(WAYPOINTS_TO_MINE);
    }

    // ═══════════════════════════════════════════════════════
    console.log("[IRONMN] The Iron Baron rides for SE Varrock");
    await sdk.say("iron baron heading to the mines");

    // Purge starter-kit junk — every dead slot is ~30s of extra walking per
    // cycle. Keep only the pickaxe.
    for (const junk of [
      /^bronze axe$/i, /tinderbox/i, /fishing net/i, /shrimps/i, /bucket/i,
      /^pot$/i, /bread/i, /bronze dagger/i, /bronze sword/i, /wooden shield/i,
      /shortbow/i, /arrow/i,
    ]) {
      try { await bot.dropItem(junk, "all"); } catch (_) {}
    }
    console.log(`[IRONMN] Pack purged, ${28 - sdk.getInventory().length} free slots`);
    await walkWaypoints(WAYPOINTS_TO_MINE);

    while (true) {
      if (!(await isAlive())) {
        console.log(
          `[IRONMN] Death detected — last seen at (${lastPos.x},${lastPos.z}) near [${lastNpcs.join(",")}] — recovering`
        );
        await sdk.waitForTicks(5);
        await walkWaypoints(WAYPOINTS_TO_MINE);
        continue;
      }
      {
        const st = sdk.getState();
        if (st?.player) {
          lastPos = { x: st.player.worldX, z: st.player.worldZ };
          lastNpcs = [...new Set((st.nearbyNpcs ?? []).map((n: any) => n.name))].slice(0, 6) as string[];
        }
      }
      if (sdk.getInventory().length >= 27) {
        await unload();
        continue;
      }
      await mineOne();
    }
  },
  { timeout: 86_400_000 }
);

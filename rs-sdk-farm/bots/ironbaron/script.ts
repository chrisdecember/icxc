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

    async function walkWaypoints(points: { x: number; z: number }[]) {
      for (const p of points) await bot.walkTo(p.x, p.z);
    }

    async function isAlive() {
      const state = sdk.getState();
      if (!state?.player) return true;
      return state.player.hp > 0;
    }

    // Scarcity ladder: copper/tin → iron (15) → coal at Al Kharid mine (30).
    // The Al Kharid mine (3295,3287) sits NORTH of the toll gate — no toll.
    const AL_KHARID_MINE = { x: 3295, z: 3287 };

    function currentSite() {
      const level = sdk.getSkill("Mining")?.level ?? 1;
      return level >= 30 ? AL_KHARID_MINE : MINE;
    }

    async function mineOne() {
      const level = sdk.getSkill("Mining")?.level ?? 1;
      const pattern =
        level >= 30 ? /coal|iron/i : level >= 15 ? /iron/i : /copper|tin/i;
      const rock = sdk.findNearbyLoc(pattern, { withOption: /mine/i });
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
      }
      await walkWaypoints(WAYPOINTS_TO_MINE);
    }

    // ═══════════════════════════════════════════════════════
    console.log("[IRONMN] The Iron Baron rides for SE Varrock");
    await sdk.say("iron baron heading to the mines");
    await walkWaypoints(WAYPOINTS_TO_MINE);

    while (true) {
      if (!(await isAlive())) {
        console.log("[IRONMN] Death detected — recovering");
        await sdk.waitForTicks(5);
        await walkWaypoints(WAYPOINTS_TO_MINE);
        continue;
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

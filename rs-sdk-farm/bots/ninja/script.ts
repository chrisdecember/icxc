import { runScript } from "../../sdk/runner";

// GTNINJA — drop-pile interceptor. nick's fleet runs the collector
// pattern: worker bots pickpocket and DROP their coins in place for a
// collector to sweep. Ground items are fair game — so the ninja shadows
// a suspected worker and hoovers its hand-off piles before the collector
// arrives. Pure intel + interception PoC; nothing here touches Jagex or
// breaks a rule, it just gets to the loot first.
//
// Target ID: nick's bots carry auto-generated handles — 8-10 chars, all
// lowercase alphanumeric, with digits mixed in (e.g. "9mvy2gmh1"). Real
// players read as words with capitals ("Thanatos"). The heuristic is
// logged with every lock so we can audit false positives.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    // Pickpocket hubs where collector fleets cluster (from scout intel).
    // The actual worker clusters (men pickpocket spots), from scout intel —
    // not plaza centers where the drops don't happen.
    const HUNTING_GROUNDS = [
      { name: "lumbridge-men", x: 3231, z: 3218 },
      { name: "barbarian-village", x: 3082, z: 3420 },
      { name: "edgeville", x: 3088, z: 3242 },
      { name: "varrock-square", x: 3213, z: 3423 },
      { name: "draynor", x: 3092, z: 3243 },
    ];

    let grabbed = 0;
    let gpGrabbed = 0;
    let currentMark: string | null = null;

    // nick's confirmed fleet roster from the hiscores — literal names, not a
    // guess. These are PRIORITY marks (their collector runs the coin pipeline).
    const NICK_ROSTER = /^nicksthief\d*$/i;

    function markPriority(name: string): number {
      if (!name || /^gt/i.test(name)) return 0; // never shadow our own bots
      if (NICK_ROSTER.test(name)) return 3; // nick's fleet — top priority
      // Other collector fleets: 8-12 alphanumeric with 2+ digits (case-ins).
      if (/^[a-z0-9]{8,12}$/i.test(name) && (name.match(/[0-9]/g) ?? []).length >= 2) {
        return 2;
      }
      // Bot-ish single-digit handles (nicksthief-style variants elsewhere).
      if (/bot|thief|rune|coin|swarm/i.test(name) && /\d/.test(name)) return 1;
      return 0;
    }

    async function isAlive() {
      const state = sdk.getState();
      if (!state?.player) return true;
      return state.player.hp > 0;
    }

    async function grabPilesNear(cx: number, cz: number) {
      // Coins first (the hand-off), then anything else valuable dropped.
      for (let i = 0; i < 4; i++) {
        const items = sdk.getGroundItems();
        const pile = items
          .filter((g: any) => /coins|rune|ore|bar|law/i.test(g.name))
          .filter((g: any) => Math.abs(g.x - cx) + Math.abs(g.z - cz) <= 4)
          .sort((a: any, b: any) => Math.abs(a.x - cx) - Math.abs(b.x - cx))[0];
        if (!pile) break;
        const before = sdk.countInventoryItems(/coins/i);
        try { await bot.pickupItem(pile); } catch (_) {}
        const after = sdk.countInventoryItems(/coins/i);
        grabbed++;
        gpGrabbed += Math.max(0, after - before);
        console.log(
          `[NINJA] INTERCEPT ${pile.name} @ (${pile.x},${pile.z}) — ${grabbed} grabs, ${gpGrabbed}gp lifted from marks`
        );
        await sdk.waitForTicks(1);
      }
    }

    function pickMark(): { name: string; x: number; z: number; index: number } | null {
      const players = sdk.getNearbyPlayers() as any[];
      const marks = players
        .map((p) => ({ p, pri: markPriority(p.name) }))
        .filter((m) => m.pri > 0);
      if (marks.length === 0) return null;
      // Stick with the current mark if still in view.
      if (currentMark) {
        const still = marks.find((m) => m.p.name === currentMark);
        if (still) return still.p;
      }
      // Highest priority (nick's fleet first), then nearest.
      marks.sort((a, b) => b.pri - a.pri || a.p.distance - b.p.distance);
      return marks[0].p;
    }

    // ═══════════════════════════════════════════════════════
    console.log("[NINJA] Shadow protocol active — hunting collector fleets");
    await sdk.say(""); // stay quiet; ninjas don't advertise

    let groundIdx = 0;
    while (true) {
      if (!(await isAlive())) {
        console.log("[NINJA] Death — recovering");
        await sdk.waitForTicks(5);
        currentMark = null;
        continue;
      }

      const mark = pickMark();

      if (!mark) {
        // No marks here — rotate to the next hunting ground.
        currentMark = null;
        const g = HUNTING_GROUNDS[groundIdx++ % HUNTING_GROUNDS.length];
        console.log(`[NINJA] No marks — repositioning to ${g.name}`);
        await bot.walkTo(g.x, g.z);
        await sdk.waitForTicks(6);
        continue;
      }

      if (mark.name !== currentMark) {
        currentMark = mark.name;
        console.log(
          `[NINJA] LOCK on "${mark.name}" (bot-handle, cl ${mark.combatLevel ?? "?"}) at (${mark.x},${mark.z})`
        );
      }

      // Shadow: close to ~2 tiles, then grab whatever it drops.
      const st = sdk.getState()?.player;
      if (st) {
        const dist = Math.abs(st.worldX - mark.x) + Math.abs(st.worldZ - mark.z);
        if (dist > 3) {
          await bot.walkTo(mark.x, mark.z);
        }
      }
      await grabPilesNear(mark.x, mark.z);

      // Bank overflow so a ninja death doesn't gift it all back.
      if (sdk.getInventory().length >= 26) {
        try { await bot.dropItem(/bones|cowhide|raw/i, "all"); } catch (_) {}
      }

      await sdk.waitForTicks(1);
    }
  },
  { timeout: 86_400_000 }
);

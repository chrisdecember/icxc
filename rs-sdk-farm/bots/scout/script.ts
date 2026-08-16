import { runScript } from "../../sdk/runner";

// GTSCOUT — the fleet's eyes. Tours every major area on loop, logging
// player density, active chat, and any law-rune sellers; also recons
// the ice-warrior candidate sites so the swarm's ice tier can unlock
// on evidence. SCOUT lines are the market map.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    const TOUR = [
      { name: "lumbridge", x: 3222, z: 3218 },
      { name: "draynor", x: 3092, z: 3243 },
      { name: "falador-center", x: 2965, z: 3380 },
      { name: "barbarian-village", x: 3082, z: 3420 },
      { name: "edgeville", x: 3088, z: 3242 },
      { name: "varrock-west", x: 3185, z: 3436 },
      { name: "varrock-center", x: 3213, z: 3428 },
      { name: "alkharid-gate", x: 3263, z: 3227 },
    ];
    const ICE_RECON = [
      { name: "ice-mountain", x: 3008, z: 3471 },
      { name: "white-wolf-approach", x: 2847, z: 3514 },
    ];

    async function isAlive() {
      const state = sdk.getState();
      if (!state?.player) return true;
      return state.player.hp > 0;
    }

    function report(tag: string) {
      const st = sdk.getState();
      const players = st?.nearbyPlayers?.length ?? 0;
      const names = (st?.nearbyPlayers ?? []).slice(0, 8).map((p: any) => p.name).join(",");
      const npcs = [...new Set((st?.nearbyNpcs ?? []).map((n: any) => n.name))].slice(0, 8).join(",");
      console.log(`[SCOUT] ${tag}: players=${players} [${names}] npcs=[${npcs}]`);
    }

    let lap = 0;
    console.log("[SCOUT] Eyes up — touring the realm");
    await sdk.say("scout on patrol");

    while (true) {
      if (!(await isAlive())) {
        await sdk.waitForTicks(5);
        continue;
      }
      lap++;
      for (const stop of TOUR) {
        try { await bot.walkTo(stop.x, stop.z); } catch (_) {}
        await sdk.waitForTicks(4);
        report(stop.name);
        // Listen briefly for law-market chatter
        const msg = await sdk.waitForChat({ matching: /law|rune|sell|buy/i, timeout: 8_000 }).catch(() => null);
        if (msg) console.log(`[SCOUT] MARKET-CHATTER at ${stop.name}: ${JSON.stringify(msg).slice(0, 160)}`);
      }
      // Ice recon every 3rd lap — it's a long walk.
      if (lap % 3 === 1) {
        for (const site of ICE_RECON) {
          console.log(`[SCOUT] Ice recon: ${site.name}`);
          try { await bot.walkTo(site.x, site.z); } catch (_) {}
          await sdk.waitForTicks(4);
          report(`ICE:${site.name}`);
        }
      }
    }
  },
  { timeout: 86_400_000 }
);

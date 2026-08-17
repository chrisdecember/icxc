import { runScript } from "../../sdk/runner";

// GTICEPROBE v2 — scout the Asgarnian Ice Dungeon warrior chamber.
// v1 intel: Ladder#1759(3008,3150) Climb-Down works; entrance lands at
// (3008,9550) with 3x lvl-6 Muggers just WEST of the ladder; probe died
// to them and the overworld pathfinder cannot target underground coords.
// v2: expedition loop — die, respawn, march back, try again. Underground
// movement is short EAST hops away from the mugger cluster toward the
// warrior chamber (~3044,9581), scanning at every hop. Recon only.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    const LADDER_DOWN = { x: 3008, z: 3150 };
    // Short hops east-northeast, hugging away from the muggers at ~(3000,9545).
    const HOPS = [
      { x: 3016, z: 9554 },
      { x: 3024, z: 9560 },
      { x: 3032, z: 9566 },
      { x: 3040, z: 9573 },
      { x: 3044, z: 9581 },
      { x: 3050, z: 9585 },
    ];

    // player.x/z are 128-per-tile SCENE coords — worldX/worldZ are the real
    // map coordinates (v2 bug: under() read scene z and misfired in Lumbridge).
    const p = () => sdk.getState()?.player as any;
    const under = () => (p()?.worldZ ?? 0) > 6000;
    const posStr = () => { const q = p(); return q ? `(${q.worldX},${q.worldZ})` : "(?)"; };

    const scan = (tag: string) => {
      const s = sdk.getState();
      if (!s) return;
      const npcs = (s.nearbyNpcs ?? []).slice(0, 10)
        .map((n: any) => `${n.name}(${n.x},${n.z})d${n.distance}${n.reachable === false ? "!" : ""}`)
        .join(" ");
      const laws = (s.groundItems ?? []).filter((g: any) => /law rune/i.test(g.name)).length;
      console.log(`[PROBE:${tag}] ${posStr()} hp=${s.player?.hp}/${s.player?.maxHp} laws-on-ground=${laws} npcs: ${npcs || "none"}`);
    };

    for (let expedition = 1; expedition <= 5; expedition++) {
      console.log(`[PROBE] === expedition ${expedition} from ${posStr()} ===`);

      // Overworld leg: march to the ladder and descend.
      if (!under()) {
        try { await bot.walkTo(LADDER_DOWN.x, LADDER_DOWN.z, 3); } catch (e) { console.log(`[PROBE] march threw: ${e}`); }
        if (!under()) {
          const ladder = sdk.findNearbyLoc(/^ladder$/i);
          if (!ladder) { console.log(`[PROBE] no ladder at ${posStr()} — retrying`); continue; }
          try { await bot.interactLoc(ladder, /climb[- ]?down/i); } catch (e) { console.log(`[PROBE] climb threw: ${e}`); }
          await sdk.waitForTicks(4);
        }
        if (!under()) { console.log(`[PROBE] descent failed at ${posStr()}`); continue; }
        console.log(`[PROBE] UNDERGROUND at ${posStr()}`);
        scan("entrance");
      }

      // Underground leg: short hops east toward the warrior chamber.
      let died = false;
      for (const hop of HOPS) {
        try { await bot.walkTo(hop.x, hop.z, 3); } catch (e) { console.log(`[PROBE] hop(${hop.x},${hop.z}) threw: ${e}`); }
        await sdk.waitForTicks(2);
        if (!under()) { console.log(`[PROBE] DIED mid-hop — respawned at ${posStr()}`); died = true; break; }
        scan(`hop(${hop.x},${hop.z})`);
        const warriors = (sdk.getState()?.nearbyNpcs ?? []).filter((n: any) => /ice warrior/i.test(n.name));
        if (warriors.length) {
          const w = warriors[0] as any;
          console.log(`[PROBE] *** ICE WARRIORS SIGHTED: ${warriors.length} — first at (${w.x},${w.z}) reachable=${w.reachable} opts=[${(w.optionsWithIndex ?? []).map((o: any) => o.text).join("/")}] ***`);
        }
      }
      if (died) continue;

      // Loiter: hold position and stream scans while we live.
      for (let i = 0; i < 30; i++) {
        await sdk.waitForTicks(10);
        if (!under()) { console.log(`[PROBE] DIED loitering — respawned at ${posStr()}`); break; }
        const s = sdk.getState();
        const warriors = (s?.nearbyNpcs ?? []).filter((n: any) => /ice warrior/i.test(n.name));
        const giants = (s?.nearbyNpcs ?? []).filter((n: any) => /ice giant/i.test(n.name));
        const laws = (s?.groundItems ?? []).filter((g: any) => /law rune/i.test(g.name)).length;
        console.log(`[PROBE:hold${i}] ${posStr()} hp=${s?.player?.hp}/${s?.player?.maxHp} warriors=${warriors.length} giants=${giants.length} lawPiles=${laws}`);
      }
      if (under()) { console.log(`[PROBE] survey complete — mission success`); break; }
    }
    console.log(`[PROBE] v2 mission end at ${posStr()}`);
  },
  { timeout: 3_600_000 }
);

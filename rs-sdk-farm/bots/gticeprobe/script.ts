import { runScript } from "../../sdk/runner";

// GTICEPROBE — scout the Asgarnian Ice Dungeon for the law monopoly's
// tier-2 source: ice warriors drop laws at 7/128 (vs dark wizards' 3x
// at 1/128). Mission: find the ladder south of Port Sarim (~3008,3150),
// climb down, walk to the warrior chamber (~3044,9581), and report
// everything — ladder loc id/options, underground route, warrior count,
// levels, aggro behavior, hazards. Pure recon: fight nothing on purpose.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    const LADDER_AREA = { x: 3008, z: 3150 };
    const WARRIOR_CHAMBER = { x: 3044, z: 9581 };

    const pos = () => {
      const p = sdk.getState()?.player;
      return p ? `(${p.x},${p.z} lvl=${(p as any).level ?? '?'})` : "(?)";
    };

    const scan = (tag: string) => {
      const s = sdk.getState();
      if (!s) return;
      const npcs = (s.nearbyNpcs ?? []).slice(0, 12)
        .map((n: any) => `${n.name}[lvl?${n.combatLevel ?? "?"}](${n.x},${n.z})d${n.distance}${n.reachable === false ? " UNREACH" : ""} opts=[${(n.optionsWithIndex ?? []).map((o: any) => o.text).join("/")}]`)
        .join(" ");
      const locs = (s.nearbyLocs ?? []).filter((l: any) => /ladder|stair|rope|entrance|trapdoor/i.test(l.name))
        .map((l: any) => `${l.name}#${l.id}(${l.x},${l.z}) opts=[${(l.optionsWithIndex ?? []).map((o: any) => o.text).join("/")}]`)
        .join(" ");
      console.log(`[PROBE:${tag}] at ${pos()} hp=${s.player?.hp}/${s.player?.maxHp}`);
      if (locs) console.log(`[PROBE:${tag}] climbables: ${locs}`);
      console.log(`[PROBE:${tag}] npcs: ${npcs || "none"}`);
    };

    console.log(`[PROBE] mission start at ${pos()}`);

    // Leg 1: overworld march to the ladder area south of Port Sarim.
    scan("start");
    try {
      const r = await bot.walkTo(LADDER_AREA.x, LADDER_AREA.z, 4);
      console.log(`[PROBE] leg1 walk result: ${JSON.stringify(r).slice(0, 200)}`);
    } catch (e) {
      console.log(`[PROBE] leg1 walk threw: ${e}`);
    }
    scan("ladder-area");

    // Leg 2: find + descend the ladder. Try exact spot first, then sweep
    // south along the coast if it's not in view.
    let descended = false;
    for (let attempt = 0; attempt < 6 && !descended; attempt++) {
      const ladder = sdk.findNearbyLoc(/ladder|trapdoor/i);
      if (ladder) {
        console.log(`[PROBE] ladder candidate: ${(ladder as any).name}#${(ladder as any).id} at (${(ladder as any).x},${(ladder as any).z}) opts=[${((ladder as any).optionsWithIndex ?? []).map((o: any) => o.text).join("/")}]`);
        try {
          const r = await bot.interactLoc(ladder, /climb[- ]?down|climb/i);
          console.log(`[PROBE] climb result: ${JSON.stringify(r).slice(0, 200)}`);
        } catch (e) {
          console.log(`[PROBE] climb threw: ${e}`);
        }
        await sdk.waitForTicks(4);
        const p = sdk.getState()?.player;
        if (p && p.z > 6000) {
          descended = true;
          console.log(`[PROBE] UNDERGROUND at ${pos()}`);
          break;
        }
      } else {
        // Sweep south along the coastline toward the known entrance.
        const p = sdk.getState()?.player;
        const sz = (p?.z ?? 3160) - 8;
        console.log(`[PROBE] no ladder in view at ${pos()}, sweeping south to z=${sz}`);
        try { await bot.walkTo(LADDER_AREA.x, sz, 3); } catch (_) {}
      }
      scan(`sweep${attempt}`);
    }

    if (!descended) {
      console.log(`[PROBE] FAILED to descend — final ${pos()}. Dumping wide loc scan:`);
      const s = sdk.getState();
      for (const l of (s?.nearbyLocs ?? []).slice(0, 20)) {
        console.log(`[PROBE] loc ${(l as any).name}#${(l as any).id}(${(l as any).x},${(l as any).z}) opts=[${((l as any).optionsWithIndex ?? []).map((o: any) => o.text).join("/")}]`);
      }
      return;
    }

    // Leg 3: underground — walk to the warrior chamber, scanning as we go.
    scan("under-start");
    try {
      const r = await bot.walkTo(WARRIOR_CHAMBER.x, WARRIOR_CHAMBER.z, 6);
      console.log(`[PROBE] leg3 walk result: ${JSON.stringify(r).slice(0, 200)}`);
    } catch (e) {
      console.log(`[PROBE] leg3 walk threw: ${e}`);
    }
    scan("chamber");

    // Leg 4: loiter and report — 20 scans, 10s apart. Count ice warriors,
    // watch whether anything aggros us, note law-rune ground drops.
    for (let i = 0; i < 20; i++) {
      await sdk.waitForTicks(16);
      const s = sdk.getState();
      const warriors = (s?.nearbyNpcs ?? []).filter((n: any) => /ice warrior/i.test(n.name));
      const hazards = (s?.nearbyNpcs ?? []).filter((n: any) => !/ice warrior/i.test(n.name));
      const laws = (s?.groundItems ?? []).filter((g: any) => /law rune/i.test(g.name)).length;
      console.log(`[PROBE:loiter${i}] ${pos()} hp=${s?.player?.hp}/${s?.player?.maxHp} warriors=${warriors.length} lawPiles=${laws} others=${hazards.slice(0, 5).map((n: any) => n.name).join(",")}`);
      if (i === 0 && warriors.length) {
        const w = warriors[0] as any;
        console.log(`[PROBE] warrior detail: ${w.name}(${w.x},${w.z}) opts=[${(w.optionsWithIndex ?? []).map((o: any) => o.text).join("/")}] reachable=${w.reachable}`);
      }
      if ((s?.player?.hp ?? 99) < 10) {
        console.log(`[PROBE] LOW HP — retreating up the ladder`);
        const ladder = sdk.findNearbyLoc(/ladder/i);
        if (ladder) { try { await bot.interactLoc(ladder, /climb[- ]?up|climb/i); } catch (_) {} }
        break;
      }
    }
    console.log(`[PROBE] mission complete at ${pos()}`);
  },
  { timeout: 3_600_000 }
);

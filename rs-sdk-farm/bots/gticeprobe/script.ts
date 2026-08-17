import { runScript } from "../../sdk/runner";

// GTICEPROBE v4 — law-supply recon, two stops:
//  1. Aubury's rune shop (Varrock ~3253,3401): dump full stock — if law
//     runes are purchasable, thief-bot gold becomes a supply stream.
//  2. Wizards' Tower (~3109,3162): survey lvl-9 wizards (law droppers)
//     — spawn count, reachability, hazards — as a candidate site.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    const AUBURY = { x: 3253, z: 3401 };
    const TOWER = { x: 3109, z: 3162 };
    const p = () => sdk.getState()?.player as any;
    const pos = () => { const q = p(); return q ? `(${q.worldX},${q.worldZ})` : "(?)"; };

    // Stop 1: Aubury stock dump.
    console.log(`[PROBE4] to Aubury from ${pos()}`);
    try { await bot.walkTo(AUBURY.x, AUBURY.z, 3); } catch (e) { console.log(`[PROBE4] aubury walk: ${e}`); }
    try {
      await bot.openShop(/aubury/i);
      await sdk.waitForTicks(3);
      const shop = (sdk.getState() as any)?.shop;
      if (shop?.items?.length) {
        for (const it of shop.items) {
          console.log(`[PROBE4] AUBURY STOCK: ${it.name} x${it.count ?? it.amount ?? "?"} price=${it.price ?? "?"}`);
        }
      } else {
        console.log(`[PROBE4] AUBURY: shop state empty`);
      }
      try { await (bot as any).closeShop?.(); } catch (_) {}
    } catch (e) { console.log(`[PROBE4] aubury shop failed: ${e}`); }

    // Stop 2: Wizards' Tower survey.
    console.log(`[PROBE4] to Wizards' Tower from ${pos()}`);
    try { await bot.walkTo(TOWER.x, TOWER.z, 4); } catch (e) { console.log(`[PROBE4] tower walk: ${e}`); }
    for (let i = 0; i < 12; i++) {
      const s = sdk.getState();
      const wiz = (s?.nearbyNpcs ?? []).filter((n: any) => /^wizard$/i.test(n.name));
      const others = (s?.nearbyNpcs ?? []).filter((n: any) => !/^wizard$/i.test(n.name)).slice(0, 6);
      console.log(`[PROBE4] TOWER scan${i} ${pos()} wizards=${wiz.length} ${wiz.map((w: any) => `(${w.x},${w.z})${w.reachable === false ? "!" : ""}`).join(" ")} others=${others.map((n: any) => n.name).join(",")}`);
      if (i === 0) {
        const doors = (s?.nearbyLocs ?? []).filter((l: any) => /door|stair|ladder/i.test(l.name)).slice(0, 8);
        console.log(`[PROBE4] TOWER locs: ${doors.map((l: any) => `${l.name}#${l.id}(${l.x},${l.z})[${(l.optionsWithIndex ?? []).map((o: any) => o.text).join("/")}]`).join(" ")}`);
      }
      await sdk.waitForTicks(12);
    }
    console.log(`[PROBE4] recon complete at ${pos()}`);
  },
  { timeout: 3_600_000 }
);

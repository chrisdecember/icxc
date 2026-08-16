import { appendFileSync, mkdirSync } from "node:fs";
import { runScript } from "../../sdk/runner";

// NINJA CORE v3 — DYNAMIC PILE INTERCEPTION, region-partitioned fleet.
//
// v2's flaws, both fixed here:
//   1. Banking triggered at 26 inventory SLOTS — but coins stack into one
//      slot, so a coin diet never banked and every death donated the haul
//      back. Now banks by GP THRESHOLD or slot count, whichever first.
//   2. Five hardcoded zones, visited round-robin blind. Now each ninja
//      owns a REGION of hotspots, scores every zone by observed gp, and
//      spends most trips on the richest corridors (weighted pick) with a
//      forced explore visit every 4th hop so new traffic gets discovered.
//
// Every pile sighted or taken is recorded to logs/pile-intel.jsonl —
// the map of where the server's drop trafficking actually happens.

// A pile >= this estimated gp is a TRAFFIC candidate — a worker bot's
// dumped stack for a collector — vs combat-leftover scrap. The first
// 93-pile haul averaged 8gp/pile: pure scrap. Trafficking piles are
// deliberate transfers and run 100s-1000s gp, at pickpocket/gathering
// clusters (no corpses), not at combat camps where drops are just deaths.
const TRAFFIC_MIN = 100;

type Zone = { name: string; x: number; z: number; gp: number; trafficGp: number; visits: number; last: number };
type Region = {
  banks: Array<{ x: number; z: number }>;
  zones: Array<{ name: string; x: number; z: number }>;
};

const REGIONS: Record<string, Region> = {
  varrock: {
    banks: [{ x: 3185, z: 3436 }, { x: 3253, z: 3420 }],
    zones: [
      { name: "varrock-square", x: 3213, z: 3423 },
      { name: "west-bank-lane", x: 3185, z: 3436 },
      { name: "east-bank-lane", x: 3253, z: 3420 },
      { name: "south-gate", x: 3210, z: 3382 },
      { name: "se-mine", x: 3283, z: 3367 },
    ],
  },
  lumbridge: {
    banks: [{ x: 3092, z: 3243 }],
    zones: [
      { name: "lumbridge-men", x: 3231, z: 3218 },
      { name: "lumbridge-general", x: 3211, z: 3247 },
      { name: "draynor-market", x: 3082, z: 3249 },
      { name: "draynor-bank-lane", x: 3092, z: 3243 },
      { name: "port-sarim-docks", x: 3027, z: 3218 },
    ],
  },
  falador: {
    banks: [{ x: 3013, z: 3355 }, { x: 3094, z: 3491 }],
    zones: [
      { name: "falador-east-bank", x: 3013, z: 3355 },
      { name: "falador-park", x: 2996, z: 3378 },
      { name: "barbarian-village", x: 3082, z: 3420 },
      { name: "edgeville-bank", x: 3094, z: 3491 },
      { name: "dwarven-mine-top", x: 3016, z: 3448 },
    ],
  },
};

// Never feed on our own operation: the lawswarm drops stacks at the vault
// tile for GTVAULT to collect. Piles inside these circles are OURS.
const OWN_TURF = [
  { x: 3227, z: 3368, r: 25 }, // Varrock wizard circle / vault drop
];

const LOOT = /coins|rune|ore|bar|essence|gem|sapphire|emerald|ruby|diamond|arrow|hide|bones/i;

// Rough 2004 unit values for scoring zones. Unknowns count a token 5gp.
const VALUES: Array<[RegExp, number]> = [
  [/^coins$/i, 1],
  [/law rune/i, 250], [/nature rune/i, 200], [/death rune/i, 180],
  [/chaos rune/i, 90], [/cosmic rune/i, 100], [/blood rune/i, 400],
  [/mind rune|air rune|water rune|earth rune|fire rune|body rune/i, 4],
  [/rune essence/i, 20],
  [/diamond/i, 2000], [/ruby/i, 1000], [/emerald/i, 500], [/sapphire/i, 250],
  [/adamantite/i, 200], [/gold ore/i, 150], [/mithril/i, 80],
  [/coal/i, 45], [/iron ore/i, 25], [/silver ore/i, 75],
  [/bar$/i, 120], [/arrow/i, 2], [/hide/i, 30], [/bones/i, 3],
];

function unitValue(name: string): number {
  for (const [re, v] of VALUES) if (re.test(name)) return v;
  return 5;
}

const INTEL_PATH = new URL("../../logs/pile-intel.jsonl", import.meta.url).pathname;

export function runNinja(regionKey: keyof typeof REGIONS) {
  const region = REGIONS[regionKey];
  const TAG = `[NINJA:${regionKey}]`;
  try { mkdirSync(new URL("../../logs", import.meta.url).pathname, { recursive: true }); } catch (_) {}

  return runScript(
    async (ctx) => {
      const { bot, sdk } = ctx;
      try { await sdk.waitForReady(120_000); } catch (_) {}
      await bot.skipTutorial();

      const zones: Zone[] = region.zones.map((z) => ({ ...z, gp: 0, trafficGp: 0, visits: 0, last: 0 }));
      let hop = 0;
      let grabbed = 0;
      let gpTaken = 0;
      let gpBanked = 0;

      const intel = (rec: Record<string, unknown>) => {
        try { appendFileSync(INTEL_PATH, JSON.stringify({ ts: new Date().toISOString(), region: regionKey, ...rec }) + "\n"); } catch (_) {}
      };

      function onOwnTurf(x: number, z: number) {
        return OWN_TURF.some((t) => Math.abs(x - t.x) + Math.abs(z - t.z) <= t.r);
      }

      async function alive() {
        const st = sdk.getState();
        if (!st?.player) return true;
        return st.player.hp > 0;
      }

      // Exploit rich corridors, but force the stalest zone every 4th hop
      // so a corridor that turns hot gets noticed within minutes.
      function pickZone(): Zone {
        hop++;
        if (hop % 4 === 0) {
          return zones.slice().sort((a, b) => a.last - b.last)[0]!;
        }
        // Traffic value drives targeting 8x harder than scrap value — we
        // are hunting collector routes, not tidying battlefields.
        const weights = zones.map((z) => (z.trafficGp * 8 + z.gp) / Math.max(1, z.visits) + 80);
        let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
        for (let i = 0; i < zones.length; i++) {
          roll -= weights[i]!;
          if (roll <= 0) return zones[i]!;
        }
        return zones[0]!;
      }

      async function bankSpoils() {
        const st = sdk.getState()?.player;
        if (!st) return;
        const nearest = region.banks
          .slice()
          .sort((a, b) =>
            Math.abs(a.x - st.worldX) + Math.abs(a.z - st.worldZ) -
            (Math.abs(b.x - st.worldX) + Math.abs(b.z - st.worldZ)))[0]!;
        const coins = sdk.countInventoryItems(/coins/i);
        await bot.walkTo(nearest.x, nearest.z);
        try {
          await bot.openBank();
          await bot.depositItem(/coins/i, -1);
          await bot.depositItem(LOOT, -1);
          await bot.closeBank();
          gpBanked += coins;
          console.log(`${TAG} SPOILS-SECURED ~${gpBanked}gp banked lifetime (${grabbed} piles)`);
          intel({ event: "bank", gp: coins, lifetimeGp: gpBanked });
        } catch (e) {
          console.log(`${TAG} bank failed: ${(e as Error).message}`);
        }
      }

      async function workZone(zone: Zone, ticks: number) {
        zone.visits++;
        zone.last = Date.now();
        let dry = 0;
        for (let t = 0; t < ticks; t++) {
          if (!(await alive())) return;
          const st = sdk.getState()?.player;
          const piles = (sdk.getGroundItems() as any[])
            .filter((g) => LOOT.test(g.name) && !onOwnTurf(g.x, g.z))
            .sort((a, b) =>
              !st ? 0 :
              Math.abs(a.x - st.worldX) + Math.abs(a.z - st.worldZ) -
              (Math.abs(b.x - st.worldX) + Math.abs(b.z - st.worldZ)));
          const pile = piles[0];
          if (!pile) {
            if (++dry > 6) return;
            await bot.walkTo(zone.x, zone.z);
            await sdk.waitForTicks(2);
            continue;
          }
          dry = 0;
          const before = sdk.countInventoryItems(/coins/i);
          try { await bot.pickupItem(pile); } catch (_) { continue; }
          const after = sdk.countInventoryItems(/coins/i);
          const n = (pile as any).count ?? 1;
          const est = /^coins$/i.test(pile.name) ? Math.max(0, after - before) : unitValue(pile.name) * n;
          const traffic = est >= TRAFFIC_MIN;
          grabbed++;
          gpTaken += est;
          zone.gp += est;
          if (traffic) {
            zone.trafficGp += est;
            console.log(`${TAG} TRAFFIC-INTERCEPT ${pile.name} x${n} (~${est}gp) @ (${pile.x},${pile.z}) ${zone.name} — collector route suspected here`);
          } else {
            console.log(`${TAG} scavenge ${pile.name} (~${est}gp) @ (${pile.x},${pile.z}) ${zone.name} — lifetime ~${gpTaken}gp/${grabbed}`);
          }
          intel({ event: "take", traffic, zone: zone.name, name: pile.name, n, x: pile.x, z: pile.z, est });

          // Bank by VALUE, not just slots — coins stack into one slot and
          // v2's slot-only trigger meant the haul rode into every death.
          if (sdk.countInventoryItems(/coins/i) >= 400 || sdk.getInventory().length >= 20) {
            await bankSpoils();
            await bot.walkTo(zone.x, zone.z);
          }
        }
      }

      // ═══════════════════════════════════════════════════════
      console.log(`${TAG} v3 online — dynamic interception, ${zones.length} zones, banks by gp`);

      while (true) {
        if (!(await alive())) {
          await sdk.waitForTicks(10);
          continue;
        }
        const zone = pickZone();
        await bot.walkTo(zone.x, zone.z);
        await sdk.waitForTicks(2);
        await workZone(zone, 60);
        if (hop % 8 === 0) {
          const top = zones.slice().sort((a, b) => (b.trafficGp * 8 + b.gp) - (a.trafficGp * 8 + a.gp)).slice(0, 3)
            .map((z) => `${z.name} traffic:${z.trafficGp}gp scrap:${z.gp}gp/${z.visits}v`).join(", ");
          console.log(`${TAG} INTEL top: ${top}`);
          intel({ event: "summary", zones: zones.map((z) => ({ n: z.name, gp: z.gp, traffic: z.trafficGp, v: z.visits })) });
        }
      }
    },
    { timeout: 86_400_000 }
  );
}

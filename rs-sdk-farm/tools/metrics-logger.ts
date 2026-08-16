// Evidence pipeline: samples every bot's XP/pos/nearby-player-count via
// observer connections every SAMPLE_MS, appends JSONL to logs/metrics.jsonl,
// and prints ALERT lines (stdout) when a bot gains zero XP across two
// consecutive samples — the signature of a stuck bot.
import { BotSDK, deriveGatewayUrl } from "./sdk/index";
import { readFileSync, appendFileSync } from "fs";

const BOTS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["gtking", "gtfingers", "gtpick", "gtnetter", "gttimber"];
const SAMPLE_MS = 4 * 60 * 1000;
const OUT = "logs/metrics.jsonl";

function loadEnv(name: string) {
  const txt = readFileSync(`bots/${name}/bot.env`, "utf-8");
  const get = (k: string) => txt.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "";
  return { user: get("BOT_USERNAME"), pass: get("PASSWORD"), server: get("SERVER") };
}

type Sample = { totalXp: number; ts: number };
const prev: Record<string, Sample[]> = {};

async function sampleBot(name: string) {
  const { user, pass, server } = loadEnv(name);
  const sdk = new BotSDK({
    botUsername: user,
    password: pass,
    gatewayUrl: deriveGatewayUrl(server),
    connectionMode: "observe",
    autoLaunchBrowser: false,
    autoReconnect: false,
    showChat: false,
  });
  try {
    await sdk.connect();
    await new Promise((r) => setTimeout(r, 2500));
    const st = sdk.getState();
    if (!st?.player) return null;
    const skills = sdk.getSkills();
    const xp: Record<string, number> = {};
    let totalXp = 0;
    let totalLvl = 0;
    for (const s of skills) {
      const sxp = sdk.getSkillXp(s.name) ?? 0;
      if (sxp > 0) xp[s.name] = sxp;
      totalXp += sxp;
      totalLvl += s.level;
    }
    const rec = {
      ts: new Date().toISOString(),
      bot: name,
      totalLvl,
      totalXp,
      hp: st.player.hp,
      pos: [st.player.worldX, st.player.worldZ],
      nearbyPlayers: st.nearbyPlayers?.length ?? 0,
      inv: sdk.getInventory().length,
      xp,
    };
    appendFileSync(OUT, JSON.stringify(rec) + "\n");

    const hist = (prev[name] ??= []);
    hist.push({ totalXp, ts: Date.now() });
    if (hist.length > 3) hist.shift();
    // Merchants trade instead of grinding — zero XP is their normal state.
    const MERCHANTS = /^(gtmule|gthawker|gtarb)$/;
    if (hist.length >= 3 && !MERCHANTS.test(name)) {
      const [a, , c] = hist;
      if (c.totalXp - a.totalXp === 0) {
        console.log(
          `ALERT ${name} zero XP gain for ${Math.round((c.ts - a.ts) / 60000)}min at (${rec.pos}) inv=${rec.inv} hp=${rec.hp}`
        );
      }
    }
    return rec;
  } catch (e) {
    console.log(`ALERT ${name} probe failed: ${(e as Error).message}`);
    return null;
  } finally {
    try { sdk.disconnect(); } catch (_) {}
  }
}

console.log(`metrics-logger sampling ${BOTS.join(",")} every ${SAMPLE_MS / 60000}min`);
while (true) {
  const t0 = Date.now();
  const line: string[] = [];
  for (const b of BOTS) {
    const r = await sampleBot(b);
    if (r) line.push(`${b}:${r.totalLvl}`);
  }
  console.log(`SAMPLE ${line.join(" ")}`);
  const wait = Math.max(10_000, SAMPLE_MS - (Date.now() - t0));
  await new Promise((r) => setTimeout(r, wait));
}

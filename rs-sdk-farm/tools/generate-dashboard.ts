// Renders the Golden Throne live-ops dashboard from telemetry on disk:
//   logs/metrics.jsonl   — per-bot XP/level time series (observer samples)
//   logs/supervisor.log  — process restarts
//   logs/*.log           — trade + hub-survey + delivery events
// Output: ../golden-throne-live.html (stable path — republished hourly).
import { readFileSync, existsSync, writeFileSync, statSync } from "fs";

const ROOT = import.meta.dir;
const OUT = `${ROOT}/../golden-throne-live.html`;

type Rec = {
  ts: string; bot: string; totalLvl: number; totalXp: number; hp: number;
  pos: [number, number]; nearbyPlayers: number; inv: number; xp: Record<string, number>;
};

const ROLES: Record<string, string> = {
  gtking: "the crown — processes everything",
  gtfingers: "thief — guards @ varrock",
  gtpick: "miner — bronze chain",
  gtnetter: "fisher — swamp coast",
  gttimber: "lumberjack — oaks",
  gtmule: "merchant — hub barter",
  gthawker: "merchant — hub barter",
  gtironmn: "iron baron — scarce ores",
  gtarb: "arbitrageur — ammo niche",
};

function readLines(p: string): string[] {
  return existsSync(p) ? readFileSync(p, "utf-8").split("\n").filter(Boolean) : [];
}

// Freshness = file mtime age. Logs are append-on-activity, so mtime is a
// truthful liveness signal even when the observer pipeline is down.
function ageMin(p: string): number {
  try { return (Date.now() - statSync(p).mtimeMs) / 60000; } catch { return Infinity; }
}
function ageChip(p: string): string {
  const a = ageMin(p);
  const label = a === Infinity ? "no data" : a < 1 ? "live" : `${Math.round(a)}m ago`;
  const cls = a < 6 ? "live" : a < 20 ? "warn" : "down";
  return `<span class="pill ${cls}">${label}</span>`;
}

const recs: Rec[] = readLines(`${ROOT}/logs/metrics.jsonl`)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean) as Rec[];

const byBot = new Map<string, Rec[]>();
for (const r of recs) {
  if (!byBot.has(r.bot)) byBot.set(r.bot, []);
  byBot.get(r.bot)!.push(r);
}

const restarts = readLines(`${ROOT}/logs/supervisor.log`).filter((l) => l.includes("RESTART"));
const trades: string[] = [];
const surveys: string[] = [];
let deliveries = 0;
for (const bot of Object.keys(ROLES)) {
  for (const l of readLines(`${ROOT}/logs/${bot}.log`)) {
    if (/TRADE with/.test(l)) trades.push(`${bot}: ${l.replace(/^\[\w+\] /, "")}`);
    if (/HUB-SURVEY/.test(l)) surveys.push(l.replace(/^\[\w+\] /, ""));
    if (/delivery #(\d+)/.test(l)) deliveries = Math.max(deliveries, 0), deliveries++;
  }
}

const now = Date.now();
function spark(series: Rec[]): string {
  if (series.length < 2) return "";
  const w = 180, h = 36, pad = 2;
  const xs = series.map((r) => new Date(r.ts).getTime());
  const ys = series.map((r) => r.totalLvl);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (t: number) => pad + ((t - x0) / Math.max(1, x1 - x0)) * (w - 2 * pad);
  const Y = (v: number) => h - pad - ((v - y0) / Math.max(1, y1 - y0)) * (h - 2 * pad);
  const pts = series.map((r, i) => `${X(xs[i]).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join(" ");
  const lastX = X(xs[xs.length - 1]).toFixed(1), lastY = Y(ys[ys.length - 1]).toFixed(1);
  return `<svg viewBox="0 0 ${w} ${h}" class="spark" role="img" aria-label="total level trend">
    <polyline points="${pts}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${lastX}" cy="${lastY}" r="3" fill="var(--gold-hi)"/></svg>`;
}

function botCard(bot: string): string {
  const series = byBot.get(bot) ?? [];
  const last = series[series.length - 1];
  const role = ROLES[bot] ?? "unknown";
  if (!last) {
    return `<div class="bot"><div class="bot-hd"><span class="pill down">NO DATA</span><b>${bot}</b></div>
      <div class="role">${role}</div></div>`;
  }
  const obsAge = (now - new Date(last.ts).getTime()) / 60000;
  const logAge = ageMin(`${ROOT}/logs/${bot}.log`);
  const first = series[0];
  const hours = Math.max(0.05, (new Date(last.ts).getTime() - new Date(first.ts).getTime()) / 3600000);
  const lvlPerHr = series.length > 1 ? ((last.totalLvl - first.totalLvl) / hours).toFixed(1) : "–";
  const stalled =
    series.length >= 3 &&
    last.totalXp - series[series.length - 3].totalXp === 0;
  // Liveness comes from the bot's OWN log activity; observer age is shown
  // separately so a dead sampler can't paint a working fleet as stale.
  const pill = logAge > 20
    ? `<span class="pill down">SILENT ${Math.round(logAge)}m</span>`
    : stalled && obsAge < 10
      ? `<span class="pill warn">STALLED</span>`
      : `<span class="pill live">LIVE</span>`;
  const obsNote = obsAge > 10 ? ` · obs ${Math.round(obsAge)}m old` : "";
  const skills = Object.entries(last.xp)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, v]) => `${k.slice(0, 5)} ${Math.round(v).toLocaleString()}xp`)
    .join(" · ");
  return `<div class="bot">
    <div class="bot-hd">${pill}<b>${bot}</b><span class="lvl">${last.totalLvl}<small> total</small></span></div>
    <div class="role">${role}</div>
    ${spark(series)}
    <div class="meta">+${lvlPerHr} lvl/hr · hp ${last.hp} · inv ${last.inv} · (${last.pos[0]},${last.pos[1]}) · ${last.nearbyPlayers} nearby${obsNote}</div>
    <div class="skills">${skills || "no xp yet"}</div>
  </div>`;
}

const fleet = Object.keys(ROLES);
const lastSamples = fleet.map((b) => byBot.get(b)?.slice(-1)[0]).filter(Boolean) as Rec[];
const fleetTotal = lastSamples.reduce((a, r) => a + r.totalLvl, 0);
const liveCount = lastSamples.filter((r) => (now - new Date(r.ts).getTime()) / 60000 < 10).length;

// Hub survey tallies (market intel)
const hubTally = new Map<string, number[]>();
for (const s of surveys) {
  const m = s.match(/HUB-SURVEY ([\w-]+): (\d+)/);
  if (m) {
    if (!hubTally.has(m[1])) hubTally.set(m[1], []);
    hubTally.get(m[1])!.push(Number(m[2]));
  }
}
const hubRows = [...hubTally.entries()]
  .map(([hub, counts]) => {
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    return { hub, avg, n: counts.length, last: counts[counts.length - 1] };
  })
  .sort((a, b) => b.avg - a.avg);

// Swarm status: last status block from each swarm log (header + indented rows).
function lastStatusBlock(log: string, header: RegExp, row: RegExp): string[] {
  const lines = readLines(`${ROOT}/logs/${log}`);
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (header.test(lines[i])) { start = i; break; }
  }
  if (start < 0) return [];
  const block = [lines[start]];
  for (let i = start + 1; i < lines.length && row.test(lines[i]); i++) block.push(lines[i]);
  return block.map((l) => l.replace(/^\[\w+\] /, ""));
}
const lawBlock = lastStatusBlock("lawswarm.log", /\[lawswarm\] LAWSWARM /, /^\[lawswarm\] {3}/);
const kickBlock = lastStatusBlock("mankickers.log", /\[mankickers\] DISRUPTION /, /^\[mankickers\] {3}/);
const lawsHeld = Number(lawBlock[0]?.match(/laws=(\d+)/)?.[1] ?? 0);
const kicksThrown = Number(kickBlock[0]?.match(/kicks=(\d+)/)?.[1] ?? 0);

// March progress per law unit: how far along Lumbridge->circle each one is.
const CIRCLE = { x: 3225, z: 3374 };
const MARCH_LEN = Math.hypot(3222 - CIRCLE.x, 3222 - CIRCLE.z); // spawn to circle
const lawRows = lawBlock.slice(1).map((l) => {
  const m = l.match(/(gtlaw\d+) cl=(\d+) hp=(\d+) laws=(\d+) xp=\d+ deaths=(\d+) pos=\((\d+),(\d+)\)\s*(\S*)/);
  if (!m) return null;
  const d = Math.hypot(Number(m[6]) - CIRCLE.x, Number(m[7]) - CIRCLE.z);
  const pct = Math.max(0, Math.min(100, Math.round((1 - d / MARCH_LEN) * 100)));
  return { bot: m[1], cl: m[2], hp: m[3], laws: m[4], deaths: m[5], x: m[6], z: m[7], fail: m[8] ?? "", d: Math.round(d), pct };
}).filter(Boolean) as { bot: string; cl: string; hp: string; laws: string; deaths: string; x: string; z: string; fail: string; d: number; pct: number }[];

// Attack rate: delta between the last two DISRUPTION headers (60s apart).
const kickHeaders = readLines(`${ROOT}/logs/mankickers.log`)
  .filter((l) => /DISRUPTION kicks=/.test(l)).slice(-2)
  .map((l) => Number(l.match(/kicks=(\d+)/)?.[1] ?? 0) + Number(l.match(/punches=(\d+)/)?.[1] ?? 0));
const attacksPerMin = kickHeaders.length === 2 ? kickHeaders[1] - kickHeaders[0] : 0;
const kickRows = kickBlock.slice(1).map((l) => {
  const m = l.match(/(mankicker\d+) cl=(\d+) hp=(\d+) style=(\S+) kicks=(\d+) punches=(\d+) xp=\d+ deaths=(\d+) pos=\((\d+),(\d+)\) @(\S+)/);
  return m ? { bot: m[1], cl: m[2], hp: m[3], style: m[4], kicks: Number(m[5]), punches: Number(m[6]), deaths: m[7], post: m[10] } : null;
}).filter(Boolean) as { bot: string; cl: string; hp: string; style: string; kicks: number; punches: number; deaths: string; post: string }[];
const maxKicks = Math.max(1, ...kickRows.map((r) => r.kicks + r.punches));

const obsAgeMin = ageMin(`${ROOT}/logs/metrics.jsonl`);
const obsBanner = obsAgeMin > 10
  ? `<div class="banner">observer sampler last wrote ${Math.round(obsAgeMin)}m ago — bot cards may lag; liveness pills use each bot's own log activity</div>`
  : "";
const fingersLine = readLines(`${ROOT}/logs/gtfingers.log`).filter((l) => /KNIGHT-PURSE/.test(l)).slice(-1)[0] ?? "";
const fingersPicks = Number(fingersLine.match(/(\d+) picks/)?.[1] ?? 0);
const ninjaLines = ["gtninja1", "gtninja2", "gtninja3"].map((n) => {
  const last = readLines(`${ROOT}/logs/${n}.log`).filter((l) => /lifetime ~/.test(l)).slice(-1)[0] ?? "";
  const m = last.match(/\[NINJA:(\w+)\].*lifetime ~(\d+)gp\/(\d+)/);
  return m ? `${n} (${m[1]}): ~${m[2]}gp over ${m[3]} piles` : `${n}: no data`;
});

const html = `<title>Golden Throne Live Ops</title>
<style>
:root{--ground:#090b12;--surface:#0d0f17;--border:#1b1e2a;--gold:#c9a84c;--gold-hi:#e8cc5a;--gold-lo:#7a6530;
--text:#ccc8bb;--text-hi:#e8e4d8;--text-lo:#55524a;--live:#5a9e6d;--warn:#c9a84c;--down:#c45a5a;}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:ui-monospace,'Cascadia Code',Menlo,Consolas,monospace;background:var(--ground);color:var(--text);
line-height:1.5;font-variant-numeric:tabular-nums;padding:1rem;max-width:1180px;margin:0 auto}
h1{font-size:1.15rem;letter-spacing:.18em;color:var(--gold);margin:.4rem 0 .1rem}
.sub{font-size:.62rem;color:var(--text-lo);letter-spacing:.12em;text-transform:uppercase;margin-bottom:1rem}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.5rem;margin-bottom:1rem}
.tile{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--gold-lo);padding:.6rem .7rem;text-align:center}
.tile b{display:block;font-size:1.5rem;color:var(--gold-hi)}
.tile span{font-size:.52rem;letter-spacing:.16em;text-transform:uppercase;color:var(--text-lo)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.6rem;margin-bottom:1rem}
.bot{background:var(--surface);border:1px solid var(--border);border-top:2px solid var(--gold-lo);padding:.7rem .8rem}
.bot-hd{display:flex;align-items:center;gap:.5rem}
.bot-hd b{color:var(--text-hi);font-size:.8rem}
.lvl{margin-left:auto;color:var(--gold-hi);font-size:1.05rem;font-weight:700}
.lvl small{color:var(--text-lo);font-size:.55rem;font-weight:400}
.role{font-size:.6rem;color:var(--text-lo);margin:.15rem 0 .35rem}
.spark{width:100%;height:36px;display:block;margin:.2rem 0}
.meta{font-size:.58rem;color:var(--text-lo)}
.skills{font-size:.58rem;color:var(--text);margin-top:.25rem}
.pill{font-size:.5rem;letter-spacing:.1em;padding:.1rem .4rem;border-radius:2px;font-weight:700}
.pill.live{background:rgba(90,158,109,.15);color:var(--live)}
.pill.warn{background:rgba(201,168,76,.15);color:var(--warn)}
.pill.down{background:rgba(196,90,90,.15);color:var(--down)}
h2{font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin:.9rem 0 .4rem}
table{width:100%;border-collapse:collapse;font-size:.62rem}
td,th{padding:.28rem .5rem;border-bottom:1px solid var(--border);text-align:left}
th{color:var(--text-lo);font-size:.52rem;letter-spacing:.14em;text-transform:uppercase}
.log{background:var(--surface);border:1px solid var(--border);padding:.5rem .7rem;font-size:.58rem;
color:var(--text-lo);max-height:180px;overflow-y:auto;white-space:pre-wrap}
.wrap{overflow-x:auto}
.banner{background:rgba(196,90,90,.12);border:1px solid var(--down);color:var(--down);
padding:.45rem .7rem;font-size:.6rem;letter-spacing:.06em;margin-bottom:.8rem}
.bar{background:var(--border);height:6px;min-width:70px;position:relative}
.bar i{position:absolute;inset:0 auto 0 0;background:var(--gold);display:block}
.hdr-row{display:flex;align-items:center;gap:.5rem}
.hdr-row h2{margin:0}
</style>
<h1>OPERATION GOLDEN THRONE — LIVE OPS</h1>
<div class="sub">updated ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC · 13-min pulse · ${recs.length} samples on record</div>
${obsBanner}
<div class="tiles">
  <div class="tile"><b>${fleetTotal}</b><span>fleet total level</span></div>
  <div class="tile"><b>${liveCount}/${fleet.length}</b><span>bots live</span></div>
  <div class="tile"><b>${deliveries}</b><span>deliveries logged</span></div>
  <div class="tile"><b>${trades.length}</b><span>market trades</span></div>
  <div class="tile"><b>${restarts.length}</b><span>auto-restarts</span></div>
  <div class="tile"><b>${lawsHeld}</b><span>law runes held</span></div>
  <div class="tile"><b>${kicksThrown.toLocaleString()}</b><span>men kicked</span></div>
  <div class="tile"><b>${fingersPicks.toLocaleString()}</b><span>knight picks</span></div>
</div>
<div class="grid">${fleet.map(botCard).join("\n")}</div>
<h2>Market Intel — hub density (players, avg over ${surveys.length} surveys)</h2>
<div class="wrap"><table><tr><th>hub</th><th>avg players</th><th>last</th><th>surveys</th></tr>
${hubRows.map((h) => `<tr><td>${h.hub}</td><td>${h.avg.toFixed(1)}</td><td>${h.last}</td><td>${h.n}</td></tr>`).join("")}
</table></div>
<div class="hdr-row"><h2>Law swarm — march to the dark wizard circle</h2>${ageChip(`${ROOT}/logs/lawswarm.log`)}</div>
<div class="wrap"><table>
<tr><th>unit</th><th>march progress</th><th>to circle</th><th>cl</th><th>hp</th><th>laws</th><th>deaths</th><th>pos</th><th>last failure</th></tr>
${lawRows.map((r) => `<tr><td>${r.bot}</td>
<td><div class="bar"><i style="width:${r.pct}%"></i></div></td>
<td>${r.d} tiles</td><td>${r.cl}</td><td>${r.hp}</td><td>${r.laws}</td><td>${r.deaths}</td>
<td>(${r.x},${r.z})</td><td>${r.fail || "—"}</td></tr>`).join("")}
</table></div>
<div class="hdr-row"><h2>Mankicker disruptors — Lumbridge pickpocket denial (${attacksPerMin}/min)</h2>${ageChip(`${ROOT}/logs/mankickers.log`)}</div>
<div class="wrap"><table>
<tr><th>unit</th><th>attacks</th><th>kicks</th><th>punches</th><th>style</th><th>cl</th><th>hp</th><th>deaths</th><th>post</th></tr>
${kickRows.map((r) => `<tr><td>${r.bot}</td>
<td><div class="bar"><i style="width:${Math.round(((r.kicks + r.punches) / maxKicks) * 100)}%"></i></div></td>
<td>${r.kicks}</td><td>${r.punches}</td><td>${r.style}</td><td>${r.cl}</td><td>${r.hp}</td><td>${r.deaths}</td><td>${r.post}</td></tr>`).join("")}
</table></div>
<div class="hdr-row"><h2>Thief &amp; ninja fleet</h2>${ageChip(`${ROOT}/logs/gtfingers.log`)}</div>
<div class="log">${[fingersLine.replace(/^\[\w+\] /, ""), ...ninjaLines].filter(Boolean).join("\n") || "no data"}</div>
<h2>Recent trades</h2>
<div class="log">${trades.slice(-12).join("\n") || "no trades yet"}</div>
<h2>Supervisor restarts</h2>
<div class="log">${restarts.slice(-10).join("\n") || "no restarts — all processes original"}</div>
`;

writeFileSync(OUT, html);
console.log(`dashboard written: ${OUT} (${(html.length / 1024).toFixed(1)}KB, ${recs.length} samples, ${trades.length} trades)`);

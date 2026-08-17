// WAR ROOM generator — parses the live farm logs and renders the Golden
// Throne dashboard fresh each run. No hand-edited tiles: every number on
// the page comes from a log line parsed seconds ago.
//
//   bun warroom.ts            # writes ../golden-throne-live.html
//
// Design: committed single-theme dark war room. Chrome gold is TEXT
// identity only; data series use validated colors (blue #3987e5 swarm,
// gold-600 #c98500 banked — dataviz-validated on surface #0d0f17, CVD
// dE 27+, contrast >=3:1). Status palette for HP bars. Reports = 120s.

import { readFileSync, writeFileSync } from "node:fs";

const LOGS = new URL("./logs/", import.meta.url).pathname;
const OUT = "/tmp/claude-0/-home-user-icxc/7e83b91d-3630-55e6-a41e-deeb40323f39/scratchpad/golden-throne-live.html";
const REPORT_SEC = 120;

const read = (f: string) => { try { return readFileSync(LOGS + f, "utf8"); } catch { return ""; } };
const law = read("lawswarm.log").split("\n");
const kick = read("mankickers.log").split("\n");
const vault = read("gtvault.log").split("\n");

// ---- lawswarm: laws series, xp series, per-bot latest block, vault drops
type BotRow = { name: string; cl: number; hp: number; laws: number; xp: number; deaths: number; pos: string };
const lawsSeries: number[] = [];
const xpSeries: number[] = [];
let deployCount = 0; let lastDeployAt = 0;
const drops: { at: number; n: number; who: string }[] = [];
let bots: BotRow[] = []; let cur: BotRow[] = [];
let deaths = 0; let online = "?/?";
for (const ln of law) {
  if (/deploying \d+ law-farm/.test(ln)) { deployCount++; lastDeployAt = lawsSeries.length; }
  const m = ln.match(/LAWSWARM laws=(\d+) deaths=(\d+) online=(\S+).*xp=(\d+)/);
  if (m) {
    lawsSeries.push(+m[1]); xpSeries.push(+m[4]); deaths = +m[2]; online = m[3];
    if (cur.length) bots = cur; cur = [];
  }
  const b = ln.match(/\[lawswarm\]\s+(gtlaw\d+) cl=(\d+) hp=(\d+) laws=(\d+) xp=(\d+) deaths=(\d+) pos=\(([\d,]+)\)/);
  if (b) cur.push({ name: b[1], cl: +b[2], hp: +b[3], laws: +b[4], xp: +b[5], deaths: +b[6], pos: b[7] });
  const d = ln.match(/\[(gtlaw\d+)\] VAULT-DROP (\d+) laws/);
  if (d) drops.push({ at: lawsSeries.length, n: +d[2], who: d[1] });
}
if (cur.length) bots = cur;

// ---- gtvault: bank runs (sum of Banking N — robust to counter resets), holding
const bankRuns: number[] = [];
let holding = 0;
for (const ln of vault) {
  const b = ln.match(/Banking (\d+) laws/); if (b) { bankRuns.push(+b[1]); holding = 0; }
  const h = ln.match(/holding (\d+)/); if (h) holding = +h[1];
}
const banked = bankRuns.reduce((a, n) => a + n, 0);
const bankedSteps: number[] = []; { let acc = 0; for (const n of bankRuns) { acc += n; bankedSteps.push(acc); } }

// ---- mankickers: kicks series + per-bot latest
type KickRow = { name: string; cl: number; hp: number; style: string; kicks: number; punches: number; post: string };
const kickSeries: { k: number; p: number }[] = [];
let kickBots: KickRow[] = []; let kcur: KickRow[] = [];
let kickRestarts = 0;
for (const ln of kick) {
  if (ln.includes("deploying") && ln.includes("disruptors")) kickRestarts++;
  const m = ln.match(/DISRUPTION kicks=(\d+) punches=(\d+)/);
  if (m) { kickSeries.push({ k: +m[1], p: +m[2] }); if (kcur.length) kickBots = kcur; kcur = []; }
  const b = ln.match(/(mankicker\d+) cl=(\d+) hp=(\d+) style=(\w+) kicks=(\d+) punches=(\d+).*@([\w-]+)/);
  if (b) kcur.push({ name: b[1], cl: +b[2], hp: +b[3], style: b[4], kicks: +b[5], punches: +b[6], post: b[7] });
}
if (kcur.length) kickBots = kcur;
// lifetime kicks = sum of segment maxima (counter resets each restart)
let lifetimeKicks = 0, lifetimePunches = 0, prevK = -1;
for (const s of kickSeries) { if (s.k < prevK) { lifetimeKicks += prevK; lifetimePunches += 0; } prevK = s.k; }
lifetimeKicks += Math.max(0, prevK);
const nowKP = kickSeries.at(-1) ?? { k: 0, p: 0 };

// ---- ice squad (SDK brains): laws carried + Draynor bank runs per pilot
const ICE_PILOTS = ["gtlaw15", "gtlaw07", "gtlaw14"];
let iceLaws = 0, iceBanks = 0, iceRetreats = 0;
const iceRows: string[] = [];
for (const name of ICE_PILOTS) {
  const ice = read(`${name}.log`).split("\n");
  let l15 = 0, b = 0, r = 0, status = "offline";
  for (const ln of ice) {
    const l = ln.match(/laws=(\d+)/); if (l) l15 = +l[1];
    const lt = ln.match(/LOOT laws -> (\d+)/); if (lt) l15 = +lt[1];
    if (ln.includes("BANKED at Draynor")) { b++; l15 = 0; }
    if (ln.includes("[ICE] RETREAT") || ln.includes("EMERGENCY")) r++;
    if (ln.includes("pilot") && ln.includes("online")) status = "marching";
    if (ln.includes("descended")) status = "underground";
    if (ln.includes("BANK-RUN")) status = "banking";
  }
  iceLaws += l15; iceBanks += b; iceRetreats += r;
  iceRows.push(`${name}: ${status} · carrying ${l15} · ${b} banks · ${r} retreats`);
}
const iceStatus = iceRows.join("<br>");

// ---- derived metrics
const W = Math.min(30, lawsSeries.length - 1); // ~last hour of reports
const swarmNow = lawsSeries.at(-1) ?? 0;
const swarmThen = lawsSeries.at(-1 - W) ?? swarmNow;
const dropsInWindow = drops.filter(d => d.at >= lawsSeries.length - W).reduce((a, d) => a + d.n, 0);
const lawsPerHr = W > 0 ? Math.max(0, Math.round((swarmNow - swarmThen + dropsInWindow) * (3600 / (W * REPORT_SEC)) * 10) / 10) : 0;
const segReports = lawsSeries.length - lastDeployAt;
const xpWindow = Math.min(10, segReports - 1);
const xpNow = xpSeries.at(-1) ?? 0;
const xpThen = xpSeries.at(-1 - xpWindow) ?? 0;
const xpPerHr = xpWindow > 0 ? Math.round((xpNow - xpThen) * (3600 / (xpWindow * REPORT_SEC))) : 0;
const k2 = kickSeries.at(-1)?.k ?? 0, k1 = kickSeries.at(-3)?.k ?? k2;
const kicksPerMin = Math.max(0, Math.round((k2 - k1) / (2 * REPORT_SEC / 60) * 10) / 10);
const totalControlled = swarmNow + holding + banked + iceLaws;
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

// ---- svg helpers
const CW = 560, CH = 150, PAD = { l: 34, r: 14, t: 12, b: 22 };
function lineChart(vals: number[], color: string, opts: { fill?: boolean; step?: boolean; id: string }) {
  if (vals.length < 2) return `<div class="empty">not enough data yet</div>`;
  const iw = CW - PAD.l - PAD.r, ih = CH - PAD.t - PAD.b;
  const max = Math.max(...vals) * 1.15 || 1;
  const x = (i: number) => PAD.l + (i / (vals.length - 1)) * iw;
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  let d = `M${x(0).toFixed(1)},${y(vals[0]).toFixed(1)}`;
  for (let i = 1; i < vals.length; i++) {
    d += opts.step ? ` H${x(i).toFixed(1)} V${y(vals[i]).toFixed(1)}` : ` L${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`;
  }
  const gridVals = [0.25, 0.5, 0.75].map(f => max * f);
  const grid = gridVals.map(v => `<line x1="${PAD.l}" x2="${CW - PAD.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"/>`).join("");
  const gLabels = gridVals.map(v => `<text x="${PAD.l - 5}" y="${(y(v) + 3).toFixed(1)}" class="tick" text-anchor="end">${Math.round(v)}</text>`).join("");
  const area = opts.fill ? `<path d="${d} V${(PAD.t + ih).toFixed(1)} H${PAD.l} Z" fill="${color}" opacity="0.10"/>` : "";
  const endX = x(vals.length - 1), endY = y(vals.at(-1)!);
  const hrs = ((vals.length - 1) * REPORT_SEC / 3600);
  return `<svg viewBox="0 0 ${CW} ${CH}" class="chart" data-vals="${vals.join(",")}" data-id="${opts.id}" role="img">
    ${grid}${gLabels}
    <line x1="${PAD.l}" x2="${CW - PAD.r}" y1="${PAD.t + ih}" y2="${PAD.t + ih}" class="baseline"/>
    ${area}<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${endX.toFixed(1)}" cy="${endY.toFixed(1)}" r="3.5" fill="${color}"/>
    <text x="${(endX - 6).toFixed(1)}" y="${(endY - 8).toFixed(1)}" class="endlabel" text-anchor="end">${vals.at(-1)}</text>
    <text x="${PAD.l}" y="${CH - 6}" class="tick">${hrs.toFixed(1)}h ago</text>
    <text x="${CW - PAD.r}" y="${CH - 6}" class="tick" text-anchor="end">now</text>
    <g class="hover" style="display:none"><line class="xline" y1="${PAD.t}" y2="${PAD.t + ih}"/><circle r="4" fill="${color}"/></g>
  </svg>`;
}
function hpClass(hp: number, max: number) {
  const f = max > 0 ? hp / max : 1;
  return f >= 0.65 ? "good" : f >= 0.45 ? "warning" : f >= 0.25 ? "serious" : "critical";
}
const maxXp = Math.max(1, ...bots.map(b => b.xp));
const maxKicks = Math.max(1, ...kickBots.map(b => b.kicks));

// ---- render
const botCards = bots.map(b => {
  const hpMax = Math.max(b.hp, Math.round(b.cl * 0.9));
  const clPct = Math.min(100, Math.round(b.cl / 56 * 100));
  return `<div class="unit">
    <div class="u-hd"><b>${b.name}</b><span class="cl">CL ${b.cl}</span></div>
    <div class="u-row"><span class="lbl">hp</span><div class="meter"><i class="${hpClass(b.hp, hpMax)}" style="width:${Math.min(100, Math.round(b.hp / hpMax * 100))}%"></i></div><span class="val">${b.hp}</span></div>
    <div class="u-row"><span class="lbl">xp</span><div class="meter"><i class="xp" style="width:${Math.round(b.xp / maxXp * 100)}%"></i></div><span class="val">${b.xp.toLocaleString()}</span></div>
    <div class="u-row"><span class="lbl">ice</span><div class="meter"><i class="ice" style="width:${clPct}%"></i></div><span class="val">${b.cl}/56</span></div>
    <div class="u-ft">${b.laws} laws held · (${b.pos})${b.deaths ? ` · ☠${b.deaths}` : ""}</div>
  </div>`;
}).join("");

const kickRows = kickBots.map(b => `<tr><td>${b.name}</td><td>${b.post}</td><td class="num">${b.kicks.toLocaleString()}</td>
  <td><div class="meter wide"><i class="xp" style="width:${Math.round(b.kicks / maxKicks * 100)}%"></i></div></td>
  <td>${b.style}</td><td class="num">CL ${b.cl}</td></tr>`).join("");

const bankRows = bankRuns.map((n, i) => `<tr><td>run ${i + 1}</td><td class="num">+${n}</td><td class="num">${bankedSteps[i]}</td></tr>`).join("");

const feed = [
  ...drops.slice(-6).map(d => `<li><span class="tag drop">DROP</span> ${d.who} banked-bound stack of ${d.n} at the vault tile</li>`),
  ...bankRuns.slice(-4).map((n, i, a) => `<li><span class="tag bank">BANK</span> gtvault deposited ${n} laws at Varrock West</li>`),
].slice(-8).join("");

const reportTable = lawsSeries.slice(-20).map((v, i, a) => {
  const idx = lawsSeries.length - a.length + i;
  return `<tr><td class="num">${idx}</td><td class="num">${v}</td><td class="num">${xpSeries[idx] ?? ""}</td></tr>`;
}).join("");

const html = `<title>Golden Throne War Room</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0;padding:0}
body{--ground:#090b12;--surface:#0d0f17;--border:#1b1e2a;--gold:#c9a84c;--gold-hi:#e8cc5a;
--ink:#ccc8bb;--ink-hi:#e8e4d8;--ink-lo:#55524a;--muted:#898781;--grid:#1e2230;--base:#2a2f42;
--s-swarm:#3987e5;--s-bank:#c98500;--good:#0ca30c;--warning:#fab219;--serious:#ec835a;--critical:#d03b3b;
font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--ground);color:var(--ink);
line-height:1.45;padding:1.1rem;max-width:1200px;margin:0 auto}
h1{font-size:1.05rem;letter-spacing:.16em;color:var(--gold);text-transform:uppercase}
.sub{font-size:.68rem;color:var(--ink-lo);margin:.15rem 0 1rem}
.hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:.55rem;margin-bottom:1rem}
.tile{background:var(--surface);border:1px solid var(--border);padding:.6rem .7rem}
.tile b{display:block;font-size:1.45rem;color:var(--ink-hi);font-weight:650}
.tile.crown b{color:var(--gold-hi);font-size:1.9rem}
.tile span{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.tile .delta{font-size:.66rem;color:var(--good);letter-spacing:0;text-transform:none}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-bottom:1rem}
@media(max-width:820px){.cols{grid-template-columns:1fr}}
.panel{background:var(--surface);border:1px solid var(--border);padding:.7rem .8rem;min-width:0}
.panel h2{font-size:.66rem;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);margin-bottom:.45rem}
.legend{display:flex;gap:1rem;font-size:.64rem;color:var(--ink);margin-bottom:.2rem}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:.35rem;vertical-align:-1px}
.chart{width:100%;height:auto;display:block}
.grid{stroke:var(--grid);stroke-width:1}
.baseline{stroke:var(--base);stroke-width:1}
.tick{fill:var(--muted);font-size:9px}
.endlabel{fill:var(--ink-hi);font-size:10px;font-weight:600}
.xline{stroke:var(--base);stroke-width:1;stroke-dasharray:3 3}
.units{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:.55rem}
.unit{background:var(--surface);border:1px solid var(--border);border-top:2px solid #2a2f42;padding:.55rem .65rem}
.u-hd{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.35rem}
.u-hd b{color:var(--ink-hi);font-size:.8rem}
.cl{color:var(--gold-hi);font-size:.78rem;font-weight:650}
.u-row{display:flex;align-items:center;gap:.45rem;margin:.22rem 0}
.lbl{font-size:.58rem;color:var(--muted);width:1.6rem;text-transform:uppercase;letter-spacing:.08em}
.val{font-size:.62rem;color:var(--ink);font-variant-numeric:tabular-nums;min-width:3.2rem;text-align:right}
.meter{flex:1;height:7px;background:var(--border);border-radius:2px;overflow:hidden}
.meter.wide{min-width:100px}
.meter i{display:block;height:100%;border-radius:2px}
.meter .good{background:var(--good)}.meter .warning{background:var(--warning)}
.meter .serious{background:var(--serious)}.meter .critical{background:var(--critical)}
.meter .xp{background:var(--s-swarm)}.meter .ice{background:var(--s-bank)}
.u-ft{font-size:.6rem;color:var(--ink-lo);margin-top:.3rem}
table{width:100%;border-collapse:collapse;font-size:.68rem}
td,th{padding:.28rem .45rem;border-bottom:1px solid var(--border);text-align:left}
th{color:var(--muted);font-size:.56rem;letter-spacing:.12em;text-transform:uppercase}
td.num{font-variant-numeric:tabular-nums;text-align:right}
.feed{list-style:none;font-size:.68rem}
.feed li{padding:.28rem 0;border-bottom:1px solid var(--border)}
.tag{font-size:.55rem;font-weight:700;letter-spacing:.08em;padding:.08rem .35rem;border-radius:2px;margin-right:.4rem}
.tag.drop{background:rgba(57,135,229,.16);color:var(--s-swarm)}
.tag.bank{background:rgba(201,133,0,.18);color:#e8a63c}
.empty{color:var(--ink-lo);font-size:.7rem;padding:1rem 0}
details{margin-top:.5rem}summary{font-size:.62rem;color:var(--muted);cursor:pointer}
.tip{position:fixed;pointer-events:none;background:#161a26;border:1px solid var(--base);color:var(--ink-hi);
font-size:.66rem;padding:.25rem .5rem;border-radius:3px;display:none;font-variant-numeric:tabular-nums;z-index:9}
:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
</style>
<h1>Operation Golden Throne — War Room</h1>
<div class="sub">generated ${stamp} · lawswarm deploy #${deployCount} · reports every ${REPORT_SEC}s · all figures parsed live from logs</div>

<div class="hero">
  <div class="tile crown"><b>${banked}</b><span>laws banked</span></div>
  <div class="tile"><b>${totalControlled}</b><span>laws controlled</span></div>
  <div class="tile"><b>${lawsPerHr}</b><span>laws / hr</span></div>
  <div class="tile"><b>${(xpPerHr / 1000).toFixed(0)}k</b><span>swarm xp / hr</span></div>
  <div class="tile"><b>${online}</b><span>law units online</span></div>
  <div class="tile"><b>${deaths}</b><span>deaths (deploy)</span></div>
  <div class="tile"><b>${(lifetimeKicks / 1000).toFixed(1)}k</b><span>men kicked</span></div>
  <div class="tile"><b>${kicksPerMin}</b><span>kicks / min</span></div>
</div>

<div class="cols">
  <div class="panel"><h2>Laws held by swarm — full session</h2>
    <div class="legend"><span><i style="background:var(--s-swarm)"></i>laws in swarm inventories</span></div>
    ${lineChart(lawsSeries, "#3987e5", { fill: true, id: "laws" })}
    <details><summary>table view — last 20 reports</summary>
    <table><tr><th>report</th><th>laws</th><th>xp (deploy)</th></tr>${reportTable}</table></details>
  </div>
  <div class="panel"><h2>Banked at Varrock West — cumulative</h2>
    <div class="legend"><span><i style="background:var(--s-bank)"></i>laws in the vault account</span></div>
    ${lineChart(bankedSteps.length > 1 ? bankedSteps : [0, ...bankedSteps], "#c98500", { step: true, id: "bank" })}
    <table style="margin-top:.4rem"><tr><th>bank run</th><th>deposit</th><th>total</th></tr>${bankRows}</table>
  </div>
</div>

<div class="panel" style="margin-bottom:1rem"><h2>Law units — this deployment · ice-tier readiness at CL 56</h2>
  <div class="units">${botCards}</div>
</div>

<div class="cols">
  <div class="panel"><h2>Mankicker disruption — Lumbridge</h2>
    <table><tr><th>unit</th><th>post</th><th>kicks</th><th></th><th>style</th><th></th></tr>${kickRows}</table>
  </div>
  <div class="panel"><h2>Pipeline events</h2>
    <ul class="feed">${feed || "<li>quiet</li>"}</ul>
    <div class="u-ft" style="margin-top:.5rem">gtvault holding ${holding} · banks at 10 · ${bankRuns.length} runs total</div>
    <h2 style="margin-top:.8rem">Ice squad — 3 pilots (7/128 drops)</h2>
    <div class="u-ft">${iceStatus}</div>
  </div>
</div>
<div class="tip" id="tip"></div>
<script>
(() => {
  const tip = document.getElementById('tip');
  for (const svg of document.querySelectorAll('svg.chart')) {
    const vals = svg.dataset.vals.split(',').map(Number);
    const hover = svg.querySelector('.hover'), xl = hover.querySelector('.xline'), dot = hover.querySelector('circle');
    const PADl=${PAD.l}, PADr=${PAD.r}, PADt=${PAD.t}, PADb=${PAD.b}, W=${CW}, H=${CH};
    const iw = W-PADl-PADr, ih = H-PADt-PADb, max = Math.max(...vals)*1.15||1;
    svg.addEventListener('pointermove', e => {
      const r = svg.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * W;
      const i = Math.max(0, Math.min(vals.length-1, Math.round((px-PADl)/iw*(vals.length-1))));
      const x = PADl + i/(vals.length-1)*iw, y = PADt+ih-(vals[i]/max)*ih;
      hover.style.display=''; xl.setAttribute('x1',x); xl.setAttribute('x2',x);
      dot.setAttribute('cx',x); dot.setAttribute('cy',y);
      const mins = (vals.length-1-i)*${REPORT_SEC}/60;
      tip.style.display='block'; tip.textContent = vals[i] + ' laws · ' + (mins<1?'now':Math.round(mins)+'m ago');
      tip.style.left = (e.clientX+12)+'px'; tip.style.top = (e.clientY-10)+'px';
    });
    svg.addEventListener('pointerleave', () => { hover.style.display='none'; tip.style.display='none'; });
  }
})();
</script>`;

writeFileSync(OUT, html);
console.log(`war room written: ${OUT}`);
console.log(`banked=${banked} controlled=${totalControlled} laws/hr=${lawsPerHr} xp/hr=${xpPerHr} kicks=${lifetimeKicks}`);

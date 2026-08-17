// Disruptor swarm: N lite clients that kick (and occasionally punch) every
// Man/Woman in Lumbridge, denying pickpocket targets to rival thieves.
//
//   cd server/webclient
//   bun src/lite/mankickers.ts mankicker1 mankicker2 ... [--minutes=N]
//
// Each unit holds a patrol anchor in a fan around Lumbridge castle and
// attacks any Man/Woman on sight. Combat style stays on Kick (aggressive);
// a short Punch window rolls around periodically for variety. Dead men
// can't be pickpocketed — that is the entire mission. Loot stays on the
// ground for gtninja2 (the Lumbridge hoover) to collect.

import './dom-shim.js';
import { startSession, type LiteSession, type SessionEnd } from './session.js';
import { BotStateCollector } from '#/bot/StateCollector.js';
import { ActionExecutor } from '#/bot/ActionExecutor.js';
import type { BotAction, BotWorldState } from '#/bot/types.js';
import type { Client } from '#/client/Client.js';
import type { LiteClient } from './LiteClient.js';

const PREY = /^man$|^woman$/i;
// v2.1: 2-tick attack gate — a courtyard Man must be engaged within
// ~1.2s of appearing. Reaction speed IS the product.
const ATTACK_RETRY_TICKS = 2;
const RELOGIN_MS = 5_000;
const RELOGIN_MAX_MS = 60_000;
// Punch window: ~25 ticks of Punch out of every 150 (kick-heavy, per spec).
const PUNCH_PERIOD = 150;
const PUNCH_WINDOW = 25;

// v2 TOTAL DENIAL: static posts left coverage gaps rivals farmed. Each
// unit now walks a patrol LOOP; loops interlock to blanket every Man
// spawn on the Lumbridge ground level. Units attack while moving —
// zero idle ticks — and any Man standing beside a rival PLAYER (a
// pickpocket in progress) is priority target #1.
const ROUTES: { name: string; wps: { x: number; z: number }[] }[] = [
    { name: 'courtyard', wps: [{ x: 3222, z: 3218 }, { x: 3217, z: 3225 }, { x: 3225, z: 3227 }, { x: 3227, z: 3219 }] },
    { name: 'courtyard-ccw', wps: [{ x: 3227, z: 3219 }, { x: 3225, z: 3227 }, { x: 3217, z: 3225 }, { x: 3222, z: 3218 }] },
    { name: 'castle-south', wps: [{ x: 3216, z: 3211 }, { x: 3210, z: 3214 }, { x: 3221, z: 3208 }] },
    { name: 'church', wps: [{ x: 3243, z: 3210 }, { x: 3247, z: 3215 }, { x: 3240, z: 3216 }, { x: 3246, z: 3206 }] },
    { name: 'bobs-hut', wps: [{ x: 3231, z: 3210 }, { x: 3228, z: 3204 }, { x: 3236, z: 3206 }] },
    { name: 'north-gate', wps: [{ x: 3223, z: 3231 }, { x: 3218, z: 3238 }, { x: 3228, z: 3236 }] },
    { name: 'general-store', wps: [{ x: 3218, z: 3243 }, { x: 3212, z: 3246 }, { x: 3222, z: 3248 }] },
    { name: 'mill-road', wps: [{ x: 3236, z: 3242 }, { x: 3230, z: 3246 }, { x: 3240, z: 3248 }] },
    { name: 'east-road', wps: [{ x: 3238, z: 3225 }, { x: 3233, z: 3228 }, { x: 3243, z: 3221 }] },
    { name: 'roam-west', wps: [{ x: 3211, z: 3214 }, { x: 3216, z: 3230 }, { x: 3214, z: 3244 }, { x: 3222, z: 3234 }, { x: 3218, z: 3220 }] },
    { name: 'roam-east', wps: [{ x: 3240, z: 3212 }, { x: 3243, z: 3222 }, { x: 3237, z: 3235 }, { x: 3232, z: 3222 }, { x: 3235, z: 3211 }] },
    { name: 'courtyard-orbit', wps: [{ x: 3214, z: 3222 }, { x: 3220, z: 3230 }, { x: 3229, z: 3224 }, { x: 3224, z: 3214 }, { x: 3216, z: 3214 }] },
    { name: 'roam-core', wps: [{ x: 3222, z: 3215 }, { x: 3230, z: 3218 }, { x: 3238, z: 3218 }, { x: 3230, z: 3226 }, { x: 3222, z: 3226 }] },
    { name: 'sweep-cw', wps: [{ x: 3218, z: 3212 }, { x: 3240, z: 3212 }, { x: 3242, z: 3226 }, { x: 3236, z: 3244 }, { x: 3218, z: 3244 }, { x: 3216, z: 3226 }] },
    { name: 'sweep-ccw', wps: [{ x: 3216, z: 3226 }, { x: 3218, z: 3244 }, { x: 3236, z: 3244 }, { x: 3242, z: 3226 }, { x: 3240, z: 3212 }, { x: 3218, z: 3212 }] },
];

// Dynamic taunt engine: 20 templates filled with live context (kick
// count, route, CL, target) and rotated without repeats per unit.
const TAUNT_TEMPLATES: ((c: { n: number; route: string; cl: number; target: string }) => string)[] = [
    c => `${c.n} men kicked and counting`,
    c => `no purses on ${c.route} today`,
    c => `the ${c.route} beat is protected`,
    c => `that ${c.target.toLowerCase()} is spoken for`,
    c => `cl ${c.cl} feet move faster than your fingers`,
    c => `pickpockets report to lumbridge for disappointment`,
    c => `we kick so you cannot thieve`,
    c => `${c.target.toLowerCase()} liberated from your greed`,
    c => `stat check: ${c.n} kicks, zero mercy`,
    c => `the golden throne taxes in bruises`,
    c => `try draynor. actually dont, we are expanding`,
    c => `this ${c.target.toLowerCase()} belongs to the kick economy`,
    c => `${c.route} patrol: all men accounted for`,
    c => `your thieving xp just flatlined`,
    c => `fastest feet on ${c.route}`,
    c => `kick ${c.n} dedicated to slow thieves`,
    c => `men of lumbridge sleep safe. unconscious, but safe`,
    c => `apply for a thieving licence elsewhere`,
    c => `deterrence is a full time job`,
    c => `${c.cl} combat levels of no`,
];
const TAUNT_COOLDOWN = 500; // ticks (~5 min per unit; a taunt somewhere every ~20s fleet-wide)

class KickBot {
    private session: LiteSession | null = null;
    private client: LiteClient | null = null;
    private collector: BotStateCollector | null = null;
    private executor: ActionExecutor | null = null;

    private tick = 0;
    private waitTicks = 0;
    private lastHp = 0;
    private seenHp = false;
    private lastAttackTick = -99;
    private busy = false;
    private xpBase = -1;
    private designTicks = 0;
    private lastFailure = '';
    private escapeTries = 0;
    private lastStyleCheck = -99;
    private lastTaunt = -9999;

    xpGained = 0;
    deaths = 0;
    relogins = 0;
    kicks = 0;
    punches = 0;
    cl = 1;
    hp = 10;
    px = 0;
    pz = 0;
    styleNow = '?';

    private wpIdx = 0;
    private tauntIdx = Math.floor(Math.random() * TAUNT_TEMPLATES.length);
    private lockIndex = -1;
    private lockSince = 0;
    interrupts = 0;

    constructor(
        readonly name: string,
        readonly route: { name: string; wps: { x: number; z: number }[] }
    ) {}

    // Current patrol waypoint — the moving "anchor" all leash/escape
    // logic measures against.
    get anchor(): { name: string; x: number; z: number } {
        const wp = this.route.wps[this.wpIdx % this.route.wps.length];
        return { name: this.route.name, x: wp.x, z: wp.z };
    }

    private advanceWp(px: number, pz: number): void {
        const wp = this.route.wps[this.wpIdx % this.route.wps.length];
        if (Math.hypot(px - wp.x, pz - wp.z) <= 3) {
            this.wpIdx = (this.wpIdx + 1) % this.route.wps.length;
        }
    }

    get online(): boolean {
        return this.client !== null && this.client.isInGame();
    }

    attach(session: LiteSession): void {
        this.session = session;
        this.client = session.client;
        const asClient = this.client as unknown as Client;
        this.collector = new BotStateCollector(asClient);
        this.executor = new ActionExecutor(asClient);
        this.executor.setScanProvider(this.collector);
        this.tick = 0;
        this.waitTicks = 0;
        this.seenHp = false;
        this.lastAttackTick = -99;
        this.busy = false;
        this.client.setOnGameTickCallback(() => {
            this.tick++;
            this.onTick().catch(e => console.error(`[${this.name}] tick error:`, e));
        });
    }

    stop(): void {
        this.client?.setOnGameTickCallback(null);
        this.session?.stop();
        this.session = null;
        this.client = null;
    }

    private exec(action: BotAction): void {
        if (!this.executor) return;
        const res = this.executor.execute(action);
        if (!(res instanceof Promise)) {
            this.lastFailure = res.success ? '' : `${action.type}:${res.reason ?? res.message}`;
        }
        if (res instanceof Promise) {
            this.busy = true;
            res.catch(() => undefined).finally(() => { this.busy = false; });
        }
    }

    private combatXp(state: BotWorldState): number {
        // StateCollector publishes `experience`, not `.xp` (same fix as lawswarm v7.24).
        let xp = 0;
        for (const s of state.skills) {
            if (/attack|strength|defence|hitpoint/i.test(s.name)) xp += (s as any).experience ?? 0;
        }
        return xp;
    }

    private async onTick(): Promise<void> {
        if (!this.client || !this.collector) return;
        if (this.busy) return;
        if (this.waitTicks > 0) { this.waitTicks--; return; }

        const state = this.collector.collectState(this.tick, true) as BotWorldState | null;
        if (!state?.player) return;

        if (this.client.isDialogOpen()) {
            const opts = (state as any).dialog?.options ?? [];
            const best =
                opts.find((o: any) => /skip|complete|finish/i.test(o.text)) ??
                opts.find((o: any) => /yes|continue|proceed/i.test(o.text)) ??
                opts.find((o: any) => /confirm|accept|agree|ok/i.test(o.text)) ??
                opts[0];
            this.exec({ type: 'clickDialogOption', optionIndex: best?.index ?? 0, reason: 'dialog' });
            return;
        }
        if (this.client.isModalOpen()) {
            this.designTicks++;
            if (this.designTicks === 1) {
                this.exec({ type: 'randomizeCharacterDesign', reason: 'design' });
            } else if (this.designTicks <= 4) {
                this.exec({ type: 'acceptCharacterDesign', reason: 'design' });
            } else {
                this.exec({ type: 'closeModal', reason: 'unblock' });
                this.designTicks = 0;
            }
            return;
        }

        const hp = state.skills.find(s => /hitpoint/i.test(s.name))?.level ?? 0;
        const maxHp = (state.skills.find(s => /hitpoint/i.test(s.name)) as any)?.baseLevel ?? hp;
        this.hp = hp;
        const atk = state.skills.find(s => /^attack/i.test(s.name))?.level ?? 1;
        const str = state.skills.find(s => /strength/i.test(s.name))?.level ?? 1;
        const def = state.skills.find(s => /defence/i.test(s.name))?.level ?? 1;
        if (hp > 0) this.cl = Math.max(this.cl, Math.floor((atk + str + def + (maxHp || 10)) / 4));

        const xp = this.combatXp(state);
        if (this.xpBase < 0 && xp > 0) this.xpBase = xp;
        if (this.xpBase >= 0) this.xpGained = xp - this.xpBase;

        if (this.seenHp && hp - this.lastHp >= 3) {
            this.deaths++;
            console.log(`[${this.name}] death #${this.deaths} — respawned on station`);
        }
        this.lastHp = hp;
        if (hp > 0) this.seenHp = true;

        const px = state.player.worldX;
        const pz = state.player.worldZ;
        this.px = px; this.pz = pz;

        // Tutorial Island: talk to the guide, dialog handler picks skip.
        if (px < 3170 && pz < 3145) {
            const guide = state.nearbyNpcs.find(n =>
                /runescape guide|guide|instructor|tutorial/i.test(n.name));
            const talk = guide?.optionsWithIndex.find(o => /talk/i.test(o.text));
            if (guide && talk) {
                this.exec({ type: 'interactNpc', npcIndex: guide.index, optionIndex: talk.opIndex, reason: 'skip-tutorial' });
                this.waitTicks = 3;
            } else {
                this.waitTicks = 5;
            }
            return;
        }

        // Style discipline: Kick (aggressive) with a periodic Punch window.
        const punchTime = this.tick % PUNCH_PERIOD < PUNCH_WINDOW;
        const cs = (state as any).combatStyle;
        if (cs?.styles?.length && this.tick - this.lastStyleCheck >= 8) {
            this.lastStyleCheck = this.tick;
            const want = punchTime
                ? cs.styles.find((s: any) => /punch/i.test(s.name))
                : cs.styles.find((s: any) => /kick/i.test(s.name));
            if (want && cs.currentStyle !== want.index) {
                this.exec({ type: 'setCombatStyle', style: want.index, reason: want.name });
                this.styleNow = want.name;
                console.log(`[${this.name}] STYLE -> ${want.name}`);
                this.waitTicks = 1;
                return;
            }
            if (want) this.styleNow = want.name;
        }

        // Rest when low — dead kickers respawn on station anyway, but resting
        // keeps uptime higher than corpse-running.
        if (maxHp > 0 && hp > 0 && hp < Math.max(4, maxHp * 0.3)) {
            this.waitTicks = 15;
            return;
        }

        const toAnchor = Math.hypot(px - this.anchor.x, pz - this.anchor.z);

        // Stuck-escape: open a reachable closed door/gate, else jitter.
        if (/client_rejected|out_of_range|cant_reach/.test(this.lastFailure)) {
            this.escapeTries++;
            if (this.escapeTries > 16) {
                this.lastFailure = '';
                this.escapeTries = 0;
            }
            const closed = (state.nearbyLocs ?? []).filter(l =>
                /door|gate/i.test(l.name) &&
                l.reachable === true &&
                l.optionsWithIndex.some(o => /^open$|^pay/i.test(o.text)))
                .sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz))[0];
            if (closed) {
                const opt = closed.optionsWithIndex.find(o => /^open$|^pay/i.test(o.text))!;
                this.exec({ type: 'interactLoc', x: closed.x, z: closed.z, locId: closed.id, optionIndex: opt.opIndex, reason: 'door-escape' });
                this.lastFailure = '';
                this.escapeTries = 0;
                this.waitTicks = 4;
                return;
            }
            // Far from anchor: walk toward it in steps instead of random jitter.
            if (toAnchor > 20) {
                const mag = 8;
                const adx = this.anchor.x - px, adz = this.anchor.z - pz;
                const len = Math.hypot(adx, adz) || 1;
                this.exec({ type: 'walkTo', x: Math.round(px + adx / len * mag), z: Math.round(pz + adz / len * mag), running: true, reason: 'deep-escape' });
                this.waitTicks = 4;
                return;
            }
            const dx = (1 + (this.tick + this.escapeTries) % 5) * ((this.tick + this.escapeTries) % 2 === 0 ? 1 : -1);
            const dz = (1 + (this.tick * 7 + this.escapeTries) % 5) * ((this.tick >> 1) % 2 === 0 ? 1 : -1);
            this.exec({ type: 'walkTo', x: px + dx, z: pz + dz, reason: 'escape-jitter' });
            this.waitTicks = 2;
            return;
        }
        this.escapeTries = 0;

        // Hunt: any Man/Woman with an Attack option. Priority #1 is prey
        // standing beside a rival PLAYER — that adjacency IS a pickpocket
        // in progress; kicking that Man out of their hands is the mission.
        const players = state.nearbyPlayers ?? [];
        const beingRobbed = (n: { x: number; z: number }) =>
            players.some(pl => Math.hypot((pl as any).x - n.x, (pl as any).z - n.z) <= 1.5);
        const preyAll = state.nearbyNpcs
            .filter(n => PREY.test(n.name))
            .filter(n => n.optionsWithIndex.some(o => /attack/i.test(o.text)))
            .sort((a, b) => {
                const ai = beingRobbed(a) ? 0 : 1, bi = beingRobbed(b) ? 0 : 1;
                if (ai !== bi) return ai - bi;
                const ar = a.reachable !== false ? 0 : 1;
                const br = b.reachable !== false ? 0 : 1;
                return ar - br || a.distance - b.distance;
            });
        // FINISH THE KILL: once engaged, stay on that exact npc until it
        // dies (index vanishes) or a 40-tick lock expires — re-targeting
        // every gate tick made units ping-pong between wandering Men and
        // finish nothing. While actively trading blows with the locked
        // target, do NOT re-click or walk; let the fight resolve. Only a
        // live pickpocket interdiction may preempt a lock.
        const locked = this.lockIndex >= 0
            ? state.nearbyNpcs.find(n => n.index === this.lockIndex && PREY.test(n.name))
            : undefined;
        if (!locked || this.tick - this.lockSince > 40) this.lockIndex = -1;
        const combat = (state.player as any).combat;
        if (locked && this.lockIndex >= 0 && combat?.inCombat && combat.targetIndex === this.lockIndex) {
            this.waitTicks = 2;
            return;
        }
        const interdiction = preyAll.find(n => beingRobbed(n) && n.reachable !== false);
        const target = interdiction
            ?? (locked && this.lockIndex >= 0 && locked.reachable !== false ? locked : undefined)
            ?? preyAll.find(n => n.reachable !== false);
        const visible = preyAll[0];

        if (target && this.tick - this.lastAttackTick >= ATTACK_RETRY_TICKS) {
            const opt = target.optionsWithIndex.find(o => /attack/i.test(o.text))!;
            this.exec({ type: 'interactNpc', npcIndex: target.index, optionIndex: opt.opIndex, reason: punchTime ? 'punch' : 'KICK' });
            this.lastAttackTick = this.tick;
            if (this.lockIndex !== target.index) { this.lockIndex = target.index; this.lockSince = this.tick; }
            if (!this.lastFailure) {
                if (punchTime) this.punches++; else this.kicks++;
                const robbed = beingRobbed(target);
                if (robbed) {
                    this.interrupts++;
                    if (this.interrupts % 10 === 1) console.log(`[${this.name}] INTERRUPT #${this.interrupts} — kicked a Man out of a rival's hands at (${target.x},${target.z})`);
                }
                // Dynamic taunt rotation: always on an interdiction, else
                // every 40th kick — cooldown-gated per unit.
                if (this.tick - this.lastTaunt > TAUNT_COOLDOWN && (robbed || (this.kicks + this.punches) % 40 === 0)) {
                    this.lastTaunt = this.tick;
                    const make = TAUNT_TEMPLATES[this.tauntIdx++ % TAUNT_TEMPLATES.length];
                    this.exec({ type: 'say', message: make({ n: this.kicks + this.punches, route: this.route.name, cl: this.cl, target: target.name }), reason: 'taunt' });
                }
            }
            return;
        }

        // Stalk a visible-but-unreachable target, but only near the route —
        // chasing beyond leash distance traps bots at gates/walls (mankicker8).
        if (!target && visible && toAnchor <= 15) {
            this.exec({ type: 'walkTo', x: visible.x, z: visible.z, running: true, reason: 'stalk' });
            this.waitTicks = 1;
            return;
        }

        // No target: PATROL. Advance the loop and keep moving — the route
        // network IS the coverage; a standing kicker is mission failure.
        this.advanceWp(px, pz);
        const wp = this.anchor;
        this.exec({ type: 'walkTo', x: wp.x, z: wp.z, running: toAnchor > 6, reason: 'patrol' });
        this.waitTicks = 1;
    }
}

// ------------------------------------------------------------------ entry

const argv = process.argv.slice(2);
const names = argv.filter(a => !a.startsWith('-'));
if (names.length === 0) {
    console.error('Usage: bun src/lite/mankickers.ts <bot> [<bot>...]');
    process.exit(1);
}
const minutes = Number(argv.find(a => a.startsWith('--minutes='))?.slice('--minutes='.length) ?? 0);
const repoRoot = new URL('../../../../', import.meta.url).pathname;

async function readEnv(bot: string): Promise<Record<string, string>> {
    const text = await Bun.file(`${repoRoot}bots/${bot}/bot.env`).text();
    return Object.fromEntries(
        text.split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
            .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
    );
}

let shuttingDown = false;
const bots: KickBot[] = names.map((n, i) => new KickBot(n, ROUTES[i % ROUTES.length]));

async function login(bot: KickBot): Promise<void> {
    const env = await readEnv(bot.name);
    const session = await startSession({
        host: env.SERVER || 'localhost',
        username: env.BOT_USERNAME!,
        password: env.PASSWORD!,
        quiet: true,
        onEnd: (end: SessionEnd) => onSessionEnd(bot, end),
    });
    bot.attach(session);
}

function onSessionEnd(bot: KickBot, end: SessionEnd): void {
    if (shuttingDown || end.reason === 'stopped') return;
    console.warn(`[mankickers] ${bot.name} lost session (${end.reason}) - re-login`);
    void relogin(bot);
}

async function relogin(bot: KickBot): Promise<void> {
    let delay = RELOGIN_MS;
    while (!shuttingDown) {
        await Bun.sleep(delay);
        if (shuttingDown) return;
        try {
            await login(bot);
            bot.relogins++;
            return;
        } catch {
            delay = Math.min(delay * 2, RELOGIN_MAX_MS);
        }
    }
}

console.log(`[mankickers] deploying ${bots.length} disruptors across ${Math.min(bots.length, ROUTES.length)} Lumbridge patrol routes`);
for (const bot of bots) {
    try {
        await login(bot);
        console.log(`[mankickers] ${bot.name} online -> route ${bot.route.name} (${bot.route.wps.length} wps)`);
    } catch (e) {
        console.error(`[mankickers] ${bot.name} failed login: ${(e as Error).message} - background retry`);
        void relogin(bot);
    }
    await Bun.sleep(1500);
}

const report = setInterval(() => {
    const totalKicks = bots.reduce((a, b) => a + b.kicks, 0);
    const totalPunches = bots.reduce((a, b) => a + b.punches, 0);
    const totalXp = bots.reduce((a, b) => a + b.xpGained, 0);
    const totalInts = bots.reduce((a, b) => a + b.interrupts, 0);
    const online = bots.filter(b => b.online).length;
    // ~37 combat xp per Man (7hp x 4/dmg + hp share) — estimate, not a count.
    const estKills = Math.round(totalXp / 37);
    console.log(
        `[mankickers] DISRUPTION kicks=${totalKicks} punches=${totalPunches} interrupts=${totalInts} xp=${totalXp} ~kills=${estKills} online=${online}/${bots.length}`
    );
    for (const b of bots) {
        console.log(
            `[mankickers]   ${b.name} cl=${b.cl} hp=${b.hp} style=${b.styleNow} kicks=${b.kicks} punches=${b.punches} ints=${b.interrupts} xp=${b.xpGained} deaths=${b.deaths} pos=(${b.px},${b.pz}) @${b.route.name} ${b.online ? '' : 'OFFLINE'}`
        );
    }
}, 60_000);

if (minutes > 0) {
    setTimeout(() => {
        shuttingDown = true;
        clearInterval(report);
        for (const b of bots) b.stop();
        process.exit(0);
    }, minutes * 60_000);
}

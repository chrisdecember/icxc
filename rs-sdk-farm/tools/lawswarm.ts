// Law-rune combat swarm: N lite clients in one process (fork of swarm.ts).
//
//   cd server/webclient
//   bun src/lite/lawswarm.ts gtlaw01 gtlaw02 ... [--minutes=N]
//
// Dark wizards drop 3x law runes at 1/128 and stand in two circles we can
// reach: south of Varrock (3225,3374) and the Lumbridge zone (3220,3220).
// Each bot ramps on cows until its melee holds, then works its assigned
// circle: attack, loot law runes (and adjacent coins), rest when low.
// Per-bot XP-rate telemetry reveals spawn saturation per site — the data
// that decides how far past 16 units the swarm scales.
//
// Laws ride as the only valuable stack so the death-keeps-3 rule protects
// them. Junk is dropped on sight.

import './dom-shim.js';
import { startSession, type LiteSession, type SessionEnd } from './session.js';
import { BotStateCollector } from '#/bot/StateCollector.js';
import { ActionExecutor } from '#/bot/ActionExecutor.js';
import type { BotAction, BotWorldState } from '#/bot/types.js';
import type { Client } from '#/client/Client.js';
import type { LiteClient } from './LiteClient.js';

const COWS = { x: 3253, z: 3290 };
const SITES = [
    { name: 'varrock-circle', x: 3225, z: 3374 },
    { name: 'lumbridge-zone', x: 3220, z: 3222 },
];
const RAMP_UNTIL = 16; // avg(atk,str,def,hp) before leaving the cows
const ATTACK_RETRY_TICKS = 8;
const RELOGIN_MS = 5_000;
const RELOGIN_MAX_MS = 60_000;
const JUNK = /bucket|^pot$|jug|shears|tinderbox|fishing net|cowhide|raw beef|newcomer|bread/i;

class LawBot {
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
    lastFailure = '';

    laws = 0;
    xpGained = 0;
    deaths = 0;
    relogins = 0;
    cl = 1;
    hp = 10;

    constructor(
        readonly name: string,
        readonly site: { name: string; x: number; z: number }
    ) {}

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
        if (!(res instanceof Promise) && !res.success) {
            this.lastFailure = `${action.type}:${res.reason ?? res.message}`;
        }
        if (res instanceof Promise) {
            this.busy = true;
            res.catch(() => undefined).finally(() => { this.busy = false; });
        }
    }

    private combatXp(state: BotWorldState): number {
        let xp = 0;
        for (const s of state.skills) {
            if (/attack|strength|defence|hitpoint/i.test(s.name)) xp += (s as any).xp ?? 0;
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
            this.exec({ type: 'clickDialogOption', optionIndex: 0, reason: 'dismiss' });
            return;
        }
        if (this.client.isModalOpen()) {
            this.exec({ type: 'acceptCharacterDesign', reason: 'first login' });
            this.exec({ type: 'closeModal', reason: 'unblock' });
            return;
        }

        const hp = state.skills.find(s => /hitpoint/i.test(s.name))?.level ?? 0;
        const maxHp = (state.skills.find(s => /hitpoint/i.test(s.name)) as any)?.baseLevel ?? hp;
        this.hp = hp;

        const atk = state.skills.find(s => /^attack/i.test(s.name))?.level ?? 1;
        const str = state.skills.find(s => /strength/i.test(s.name))?.level ?? 1;
        const def = state.skills.find(s => /defence/i.test(s.name))?.level ?? 1;
        this.cl = Math.floor((atk + str + def + (maxHp || 10)) / 4);

        const xp = this.combatXp(state);
        if (this.xpBase < 0 && xp > 0) this.xpBase = xp;
        if (this.xpBase >= 0) this.xpGained = xp - this.xpBase;

        if (this.seenHp && hp - this.lastHp >= 3) {
            this.deaths++;
            console.log(`[${this.name}] death #${this.deaths} (laws held: ${this.laws})`);
        }
        this.lastHp = hp;
        if (hp > 0) this.seenHp = true;

        this.laws = state.inventory
            .filter(i => /law rune/i.test(i.name))
            .reduce((a, i) => a + i.count, 0);

        // Junk discipline: laws must stay the top-value stack we hold.
        const junk = state.inventory.find(i => JUNK.test(i.name));
        if (junk) {
            this.exec({ type: 'dropItem', slot: junk.slot, reason: 'junk' });
            this.waitTicks = 1;
            return;
        }

        const px = state.player.worldX;
        const pz = state.player.worldZ;
        const ramping = this.cl < RAMP_UNTIL;
        const anchor = ramping ? COWS : this.site;

        // Rest when low: step off the circle and let regen work.
        if (maxHp > 0 && hp > 0 && hp < Math.max(4, maxHp * 0.4)) {
            if (Math.hypot(px - (anchor.x + 14), pz - (anchor.z - 10)) > 4) {
                this.exec({ type: 'walkTo', x: anchor.x + 14, z: anchor.z - 10, running: true, reason: 'rest' });
            }
            this.waitTicks = 40;
            return;
        }

        // Loot law runes always; coins only when adjacent.
        const lawPile = state.groundItems.find(g => /law rune/i.test(g.name));
        if (lawPile) {
            this.exec({ type: 'pickupItem', x: lawPile.x, z: lawPile.z, itemId: lawPile.id, reason: 'LAW' });
            this.waitTicks = 3;
            return;
        }
        const coinPile = state.groundItems.find(
            g => /^coins$/i.test(g.name) && Math.hypot(g.x - px, g.z - pz) <= 2
        );
        if (coinPile) {
            this.exec({ type: 'pickupItem', x: coinPile.x, z: coinPile.z, itemId: coinPile.id, reason: 'coins' });
            this.waitTicks = 2;
            return;
        }

        if (Math.hypot(px - anchor.x, pz - anchor.z) > 14) {
            this.exec({ type: 'walkTo', x: anchor.x, z: anchor.z, running: true, reason: 'station' });
            this.waitTicks = 5;
            return;
        }

        if (this.tick - this.lastAttackTick < ATTACK_RETRY_TICKS) return;

        const prey = ramping ? /^cow$/i : /^dark wizard$/i;
        const target = state.nearbyNpcs
            .filter(n => prey.test(n.name))
            .filter(n => n.optionsWithIndex.some(o => /attack/i.test(o.text)))
            .filter(n => n.reachable !== false)
            .sort((a, b) => a.distance - b.distance)[0];
        if (!target) {
            this.waitTicks = 6;
            return;
        }
        const opt = target.optionsWithIndex.find(o => /attack/i.test(o.text))!;
        this.exec({ type: 'interactNpc', npcIndex: target.index, optionIndex: opt.opIndex, reason: 'attack' });
        this.lastAttackTick = this.tick;
    }
}

// ------------------------------------------------------------------ entry

const argv = process.argv.slice(2);
const names = argv.filter(a => !a.startsWith('-'));
if (names.length === 0) {
    console.error('Usage: bun src/lite/lawswarm.ts <bot> [<bot>...]');
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
const bots: LawBot[] = names.map((n, i) => new LawBot(n, SITES[i % SITES.length]));

async function login(bot: LawBot): Promise<void> {
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

function onSessionEnd(bot: LawBot, end: SessionEnd): void {
    if (shuttingDown || end.reason === 'stopped') return;
    console.warn(`[lawswarm] ${bot.name} lost session (${end.reason}) - re-login`);
    void relogin(bot);
}

async function relogin(bot: LawBot): Promise<void> {
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

console.log(`[lawswarm] deploying ${bots.length} law-farm units across ${SITES.length} circles`);
for (const bot of bots) {
    try {
        await login(bot);
        console.log(`[lawswarm] ${bot.name} online -> ${bot.site.name}`);
    } catch (e) {
        console.error(`[lawswarm] ${bot.name} failed login: ${(e as Error).message} - background retry`);
        void relogin(bot);
    }
    await Bun.sleep(1500);
}

const report = setInterval(() => {
    const totalLaws = bots.reduce((a, b) => a + b.laws, 0);
    const totalDeaths = bots.reduce((a, b) => a + b.deaths, 0);
    const online = bots.filter(b => b.online).length;
    const perSite = SITES.map(s => {
        const members = bots.filter(b => b.site.name === s.name);
        const xph = members.reduce((a, b) => a + b.xpGained, 0);
        return `${s.name}: ${members.length} units xp=${xph}`;
    }).join(' | ');
    console.log(
        `[lawswarm] LAWSWARM laws=${totalLaws} deaths=${totalDeaths} online=${online}/${bots.length} :: ${perSite}`
    );
    for (const b of bots) {
        console.log(
            `[lawswarm]   ${b.name} cl=${b.cl} hp=${b.hp} laws=${b.laws} xp=${b.xpGained} deaths=${b.deaths} ${b.online ? '' : 'OFFLINE'}`
        );
    }
}, 120_000);

if (minutes > 0) {
    setTimeout(() => {
        shuttingDown = true;
        clearInterval(report);
        for (const b of bots) b.stop();
        process.exit(0);
    }, minutes * 60_000);
}

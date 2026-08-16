// Law-rune combat swarm: N lite clients in one process (fork of swarm.ts).
//
//   cd server/webclient
//   bun src/lite/lawswarm.ts gtlaw01 gtlaw02 ... [--minutes=N]
//
// Dark wizards drop 3x law runes at 1/128 and stand in two circles we can
// reach: south of Varrock (3225,3374) and the Lumbridge zone (3220,3220).
// Each bot ramps on Lumbridge men until its melee holds, then works its assigned
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

// RAMP on Lumbridge men (open field, no fences — the cow pen gate was
// a 2-hour blocker: gate already open but units closing it, east fence
// blocking west approach, geometry too complex for blind navigation).
const RAMP = { x: 3236, z: 3240 };
// Lumbridge-zone removed: no dark wizards spawn there (only men/rats).
// All graduated units converge on the Varrock circle.
const SITES = [
    { name: 'varrock-circle', x: 3225, z: 3374 },
];
// All laws flow through the vault: units drop their stacks here and the
// gtvault SDK bot hoovers + banks them. (Lite clients cannot player-trade
// or bank — the drop-pile pattern is the collector mechanism.)
const VAULT = { x: 3227, z: 3368 };
const VAULT_AT = 8; // laws held before a vault run
// Ice-warrior tier (7/128 laws — premium source). REAL location is the
// Asgarnian Ice Dungeon, UNDERGROUND at (3044,9581) — reached by the
// ladder south of Port Sarim (surface entrance ~3008,3150). My earlier
// (3008,3471) was the Ice Mountain surface (wrong — dwarves, not warriors).
// Gated behind ICE=1 AND ladder-descent nav, which is a TODO: units must
// walk to the entrance, interact the ladder to go underground, then path
// to the warriors. Until that nav exists, ice tier stays off.
const ICE_ENABLED = process.env.ICE === '1';
const ICE_ENTRANCE = { x: 3008, z: 3150 };
const ICE_SITE = { name: 'asgarnian-ice-dungeon', x: 3044, z: 9581 };
const SWORDSHOP = { x: 3203, z: 3397 };
const RAMP_UNTIL = 16; // avg(atk,str,def,hp) before graduating to dark wizards
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
    private designTicks = 0;
    lastFailure = '';
    private escapeTries = 0;

    laws = 0;
    xpGained = 0;
    deaths = 0;
    relogins = 0;
    cl = 1;
    hp = 10;
    px = 0;
    pz = 0;

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
        if (!(res instanceof Promise)) {
            // Clear on success — a sticky failure string would trap units in
            // the stuck-escape branch forever after one bad walk.
            this.lastFailure = res.success ? '' : `${action.type}:${res.reason ?? res.message}`;
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

    private walkToward(px: number, pz: number, tx: number, tz: number, reason: string): void {
        const dx = tx - px, dz = tz - pz;
        const dist = Math.hypot(dx, dz);
        const STEP = 10; // lite BFS build-area is bounded; hop in short steps
        if (dist <= STEP) {
            this.exec({ type: 'walkTo', x: tx, z: tz, running: true, reason });
        } else {
            const nx = Math.round(px + (dx / dist) * STEP);
            const nz = Math.round(pz + (dz / dist) * STEP);
            this.exec({ type: 'walkTo', x: nx, z: nz, running: true, reason: reason + '-hop' });
        }
    }

    private async onTick(): Promise<void> {
        if (!this.client || !this.collector) return;
        if (this.busy) return;
        if (this.waitTicks > 0) { this.waitTicks--; return; }

        const state = this.collector.collectState(this.tick, true) as BotWorldState | null;
        if (!state?.player) return;

        if (this.client.isDialogOpen()) {
            // Smart selection (ported from sdk skipTutorial): prefer the
            // skip/yes/confirm option so the tutorial-guide dialog actually
            // skips instead of whatever sits at index 0.
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
            const modalState = this.collector.collectState(this.tick, true) as any;
            const shopOpen = !!modalState?.shop?.items?.length;
            if (!shopOpen) {
                // Character-design (interface 3559) needs randomize THEN accept
                // on SEPARATE ticks — firing both together never dismisses it,
                // which froze the whole swarm at creation (cl=3, 0 xp).
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
        this.px = px; this.pz = pz;

        // Tutorial Island (x<3170, z<3145): the lite path never ported
        // bot.skipTutorial(), so every unit froze here — mainland walkTo is
        // out_of_range from the island. ROOT CAUSE of the stuck swarm.
        // Talk to the guide; the dialog handler above picks skip/yes.
        if (px < 3170 && pz < 3145) {
            const guide = state.nearbyNpcs.find(n =>
                /runescape guide|guide|instructor|tutorial/i.test(n.name));
            const talk = guide?.optionsWithIndex.find(o => /talk/i.test(o.text));
            if (guide && talk) {
                this.exec({ type: 'interactNpc', npcIndex: guide.index, optionIndex: talk.opIndex, reason: 'skip-tutorial' });
                this.waitTicks = 3;
            } else {
                this.lastFailure = 'tutorial:no-guide-in-range';
                this.waitTicks = 5;
            }
            return;
        }

        const ramping = this.cl < RAMP_UNTIL;
        const iceTier = ICE_ENABLED && this.cl >= 45;
        const anchor = ramping ? RAMP : iceTier ? ICE_SITE : this.site;

        // Opportunistic attack: check for attackable targets BEFORE stuck-
        // escape — a unit jittering near men can still train combat.
        const prey = ramping ? /^man$|^woman$/i : iceTier ? /^ice warrior$/i : /^dark wizard$/i;
        if (this.tick - this.lastAttackTick >= ATTACK_RETRY_TICKS) {
            const nearbyPrey = state.nearbyNpcs
                .filter(n => prey.test(n.name) && n.reachable !== false)
                .filter(n => n.optionsWithIndex.some(o => /attack/i.test(o.text)))
                .sort((a, b) => a.distance - b.distance);
            const opportunistic = nearbyPrey[0];
            if (opportunistic) {
                const opt = opportunistic.optionsWithIndex.find(o => /attack/i.test(o.text))!;
                this.exec({ type: 'interactNpc', npcIndex: opportunistic.index, optionIndex: opt.opIndex, reason: 'attack' });
                this.lastAttackTick = this.tick;
                this.lastFailure = '';
                this.escapeTries = 0;
                return;
            }
        }

        // Stuck-escape: open closed doors/gates if reachable, otherwise jitter.
        if (/client_rejected/.test(this.lastFailure)) {
            this.escapeTries++;
            if (this.escapeTries > 30) {
                this.lastFailure = '';
                this.escapeTries = 0;
            }
            if (this.escapeTries % 12 === 1) {
                const locs = (state.nearbyLocs ?? []).slice(0, 8)
                    .map(l => `${l.name}(${l.x},${l.z})${l.reachable === true ? '✓' : ''}[${l.optionsWithIndex.map(o => o.text).join(',')}]`).join(' ');
                console.log(`[${this.name}] STUCK-ESCAPE at (${px},${pz}); locs: ${locs || 'none'}`);
            }

            const closedGates = (state.nearbyLocs ?? []).filter(l =>
                /door|gate/i.test(l.name) &&
                l.optionsWithIndex.some(o => /^open$/i.test(o.text)));
            const reachableClosed = closedGates.find(g => g.reachable === true);
            if (reachableClosed) {
                const opt = reachableClosed.optionsWithIndex.find(o => /^open$/i.test(o.text))!;
                this.exec({ type: 'interactLoc', x: reachableClosed.x, z: reachableClosed.z, locId: reachableClosed.id, optionIndex: opt.opIndex, reason: 'gate-open' });
                console.log(`[${this.name}] GATE-OPEN at (${reachableClosed.x},${reachableClosed.z})`);
                this.waitTicks = 3;
                return;
            }

            const dx = (1 + (this.tick + this.escapeTries) % 5) * ((this.tick + this.escapeTries) % 2 === 0 ? 1 : -1);
            const dz = (1 + (this.tick * 7 + this.escapeTries) % 5) * ((this.tick >> 1) % 2 === 0 ? 1 : -1);
            this.exec({ type: 'walkTo', x: px + dx, z: pz + dz, reason: 'escape-jitter' });
            this.waitTicks = 2;
            return;
        }
        this.escapeTries = 0;

        // Rest when low: step off the circle and let regen work.
        if (maxHp > 0 && hp > 0 && hp < Math.max(4, maxHp * 0.4)) {
            if (Math.hypot(px - (anchor.x + 14), pz - (anchor.z - 10)) > 4) {
                this.walkToward(px, pz, anchor.x + 14, anchor.z - 10, 'rest');
            }
            this.waitTicks = 40;
            return;
        }

        // Vault run: carry the stack to the drop tile; gtvault banks it.
        if (this.laws >= VAULT_AT) {
            if (Math.hypot(px - VAULT.x, pz - VAULT.z) > 2) {
                this.exec({ type: 'walkTo', x: VAULT.x, z: VAULT.z, running: true, reason: 'vault run' });
                this.waitTicks = 5;
                return;
            }
            const slot = state.inventory.find(i => /law rune/i.test(i.name))?.slot;
            if (slot !== undefined) {
                this.exec({ type: 'dropItem', slot, reason: 'VAULT-DROP' });
                console.log(`[${this.name}] VAULT-DROP ${this.laws} laws`);
                this.waitTicks = 3;
                return;
            }
        }

        // Gear program: dark-wizard coins buy an iron sword next door.
        const hasBetterSword = state.inventory.concat((state as any).equipment ?? [])
            .some(i => /iron sword|steel sword|scimitar/i.test(i.name));
        const coinsHeld = state.inventory.filter(i => /^coins$/i.test(i.name)).reduce((a, i) => a + i.count, 0);
        if (!ramping && !hasBetterSword && coinsHeld >= 120) {
            if (Math.hypot(px - SWORDSHOP.x, pz - SWORDSHOP.z) > 3) {
                this.exec({ type: 'walkTo', x: SWORDSHOP.x, z: SWORDSHOP.z, running: true, reason: 'gear up' });
                this.waitTicks = 5;
                return;
            }
            const shop = (state as any).shop;
            if (!shop || !shop.items?.length) {
                const keeper = state.nearbyNpcs.find(n => /shop keeper/i.test(n.name));
                const tradeOpt = keeper?.optionsWithIndex.find(o => /trade/i.test(o.text));
                if (keeper && tradeOpt) {
                    this.exec({ type: 'interactNpc', npcIndex: keeper.index, optionIndex: tradeOpt.opIndex, reason: 'open shop' });
                }
                this.waitTicks = 4;
                return;
            }
            const sword = shop.items.find((it: any) => /iron sword/i.test(it.name));
            if (sword) {
                this.exec({ type: 'shopBuy', slot: sword.slot, amount: 1, reason: 'buy iron sword' });
                this.waitTicks = 3;
            }
            this.exec({ type: 'closeShop', reason: 'done' });
            return;
        }
        const newSword = state.inventory.find(i => /iron sword|steel sword|scimitar/i.test(i.name));
        if (newSword) {
            // Wield option is the weapon's first inventory option.
            this.exec({ type: 'useInventoryItem', slot: newSword.slot, optionIndex: 1, reason: 'GEAR wield' });
            console.log(`[${this.name}] GEAR wielding ${newSword.name}`);
            this.waitTicks = 2;
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

        if (this.tick - this.lastAttackTick < ATTACK_RETRY_TICKS) return;

        const preyAll = state.nearbyNpcs
            .filter(n => prey.test(n.name))
            .filter(n => n.optionsWithIndex.some(o => /attack/i.test(o.text)))
            .sort((a, b) => a.distance - b.distance);
        const target = preyAll.filter(n => n.reachable !== false)[0];
        const visible = preyAll[0];
        if (!target && visible) {
            this.walkToward(px, pz, visible.x, visible.z, 'stalk');
            this.waitTicks = 3;
            return;
        }
        if (!target && Math.hypot(px - anchor.x, pz - anchor.z) > 14) {
            this.walkToward(px, pz, anchor.x, anchor.z, 'station');
            this.waitTicks = 4;
            return;
        }
        if (!target) {
            if (this.tick % 50 === 0) {
                const npcs = state.nearbyNpcs.slice(0, 6).map(n => `${n.name}(${n.distance}t)`).join(', ');
                console.log(`[${this.name}] NO-TARGET at (${px},${pz}) prey=${prey} npcs=[${npcs || 'none'}]`);
            }
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
            `[lawswarm]   ${b.name} cl=${b.cl} hp=${b.hp} laws=${b.laws} xp=${b.xpGained} deaths=${b.deaths} pos=(${b.px},${b.pz}) ${b.lastFailure || ''} ${b.online ? '' : 'OFFLINE'}`
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

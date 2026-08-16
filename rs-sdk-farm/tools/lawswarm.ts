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
import { appendFileSync } from 'node:fs';
import { startSession, type LiteSession, type SessionEnd } from './session.js';
import { BotStateCollector } from '#/bot/StateCollector.js';
import { ActionExecutor } from '#/bot/ActionExecutor.js';
import type { BotAction, BotWorldState } from '#/bot/types.js';
import type { Client } from '#/client/Client.js';
import type { LiteClient } from './LiteClient.js';

// RAMP on Lumbridge men (open field, no fences — the cow pen gate was
// a 2-hour blocker: gate already open but units closing it, east fence
// blocking west approach, geometry too complex for blind navigation).
const RAMP = { x: 3222, z: 3222 };
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
const TRACE_FILE = new URL('../../../../logs/lawtrace.jsonl', import.meta.url).pathname;
const ICE_ENTRANCE = { x: 3008, z: 3150 };
const ICE_SITE = { name: 'asgarnian-ice-dungeon', x: 3044, z: 9581 };
const SWORDSHOP = { x: 3203, z: 3397 };
const RAMP_UNTIL = 10; // avg(atk,str,def,hp) before graduating to dark wizards
const ATTACK_RETRY_TICKS = 8;
const RELOGIN_MS = 5_000;
const RELOGIN_MAX_MS = 60_000;
const JUNK = /bucket|^pot$|jug|shears|tinderbox|fishing net|cowhide|raw beef|newcomer|bread/i;

// Waypoint chain: the Lumbridge->Varrock ROAD, reconstructed from the two
// units that actually completed the trip (gtlaw14 crossed the farm belt at
// x~3250 z3300-3320 twice; gtlaw04 at x~3265 z3303). Short road-aligned
// hops keep BFS bearings on walkable ground instead of aiming diagonally
// across fenced fields — the diagonal is what created the (3262-3265,
// 3277-3298) dead pocket.
// r: arrival radius. The two farm-belt crossing WPs use a tight radius —
// the default 10 let units "arrive" from the wrong side of the fence.
const MARCH_WAYPOINTS = [
    { x: 3245, z: 3235, r: 10 },  // NE of Lumbridge, open ground
    { x: 3262, z: 3253, r: 10 },  // junction west of cow fence (proven)
    { x: 3252, z: 3280, r: 5 },   // road north between fields
    { x: 3253, z: 3308, r: 5 },   // farm-belt crossing (gtlaw14's proven gap)
    { x: 3264, z: 3321, r: 10 },  // road bend NE past the fields
    { x: 3280, z: 3340, r: 10 },  // open ground (proven)
    { x: 3285, z: 3365, r: 10 },  // North (proven)
    { x: 3280, z: 3380, r: 10 },  // North past barriers (proven)
    { x: 3235, z: 3374, r: 10 },  // West approach to circle
];
// South face of the farm-belt fence: any unit that thinks it is past the
// crossing but still sits in this box has NOT crossed — send it back to
// the road approach instead of letting it grind north into the fence.
const BELT = { x0: 3248, x1: 3280, z1: 3304, backTo: 2 };

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
    private staleX = -1;
    private staleZ = -1;
    private staleSince = 0;
    private marchWp = -1;
    private marchWpSince = 0;
    private forceCount = 0;

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

    get stale(): boolean {
        return this.tick - this.staleSince > 500 && this.staleSince > 0;
    }

    resetRoute(): void {
        this.marchWp = -1;
    }

    forceDisconnect(): void {
        this.client?.setOnGameTickCallback(null);
        this.session?.stop();
        this.session = null;
        this.client = null;
        this.collector = null;
        this.executor = null;
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

    private walkToward(px: number, pz: number, tx: number, tz: number, reason: string): boolean {
        const dx = tx - px, dz = tz - pz;
        const dist = Math.hypot(dx, dz);
        if (dist < 1) return true;
        const STEP = Math.min(5, Math.max(2, Math.floor(dist)));
        const ndx = dx / dist, ndz = dz / dist;
        // Try direct, then rotated angles (±23°, ±45°, ±68°, ±90°, reverse)
        const angles = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, Math.PI / 2, -Math.PI / 2];
        for (const angle of angles) {
            const cos = Math.cos(angle), sin = Math.sin(angle);
            const rx = ndx * cos - ndz * sin;
            const rz = ndx * sin + ndz * cos;
            const nx = Math.round(px + rx * STEP);
            const nz = Math.round(pz + rz * STEP);
            if (nx === px && nz === pz) continue;
            this.exec({ type: 'walkTo', x: nx, z: nz, running: true, reason });
            if (!this.lastFailure) return true;
        }
        return false;
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
        if (hp > 0) {
            this.cl = Math.max(this.cl, Math.floor((atk + str + def + (maxHp || 10)) / 4));
        }

        const xp = this.combatXp(state);
        if (this.xpBase < 0 && xp > 0) this.xpBase = xp;
        if (this.xpBase >= 0) this.xpGained = xp - this.xpBase;

        if (this.seenHp && hp - this.lastHp >= 3) {
            this.deaths++;
            this.marchWp = -1;
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
        if (px !== this.staleX || pz !== this.staleZ) {
            this.staleX = px; this.staleZ = pz; this.staleSince = this.tick;
            // Breadcrumb tracer: every successful traversal becomes route data.
            // A completed run's trace gets baked into MARCH_WAYPOINTS.
            if (this.tick % 5 === 0) {
                try {
                    appendFileSync(TRACE_FILE, JSON.stringify({ n: this.name, t: this.tick, x: px, z: pz, wp: this.marchWp }) + '\n');
                } catch { /* tracing is best-effort */ }
            }
        }

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

        // Silent-reject detector: BFS can accept a walk the server rejects,
        // leaving lastFailure empty while the bot stands still forever
        // (gtlaw02 at the windmill fence, gtlaw07 in the cabbage patch).
        // A unit that is traveling but hasn't moved a tile in 30 ticks is
        // stuck no matter what the executor reported — synthesize a failure
        // so the gate-open/escape machinery engages.
        const resting = maxHp > 0 && hp > 0 && hp < Math.max(4, maxHp * 0.4);
        const traveling = Math.hypot(px - anchor.x, pz - anchor.z) > 14;
        if (traveling && !resting && !this.lastFailure && this.tick - this.staleSince > 30 && this.staleSince > 0) {
            this.lastFailure = 'walk:client_rejected-silent';
        }

        // Opportunistic attack: check for attackable targets BEFORE stuck-
        // escape — a unit jittering near men can still train combat.
        // Non-ramping units target dark wizards AND men — units stuck far from
        // the circle still gain combat XP by fighting men in Lumbridge. There
        // are no men near the dark-wizard circle so circle units auto-target
        // dark wizards. Ramping units (cl<10) fight men only.
        const farFromCircle = Math.hypot(px - this.site.x, pz - this.site.z) > 30;
        const prey = ramping ? /^man$|^woman$/i
            : iceTier ? /^ice warrior$/i
            : farFromCircle ? /^dark wizard$/i
            : /^dark wizard$|^man$|^woman$/i;
        if (this.tick - this.lastAttackTick >= ATTACK_RETRY_TICKS) {
            if (ramping && this.tick % 40 === 0) {
                const men = state.nearbyNpcs.filter(n => prey.test(n.name)).slice(0, 3);
                if (men.length > 0) {
                    const detail = men.map(m => `${m.name}(${m.distance}t,reach=${m.reachable},opts=[${m.optionsWithIndex.map(o=>o.text).join(',')}])`).join(' ');
                    console.log(`[${this.name}] RAMP-SCAN at (${px},${pz}) prey: ${detail}`);
                }
            }
            const nearbyPrey = state.nearbyNpcs
                .filter(n => prey.test(n.name))
                .filter(n => n.optionsWithIndex.some(o => /attack/i.test(o.text)))
                .sort((a, b) => {
                    const ar = a.reachable !== false ? 0 : 1;
                    const br = b.reachable !== false ? 0 : 1;
                    return ar - br || a.distance - b.distance;
                });
            const opportunistic = nearbyPrey[0];
            if (opportunistic) {
                const savedFailure = this.lastFailure;
                const opt = opportunistic.optionsWithIndex.find(o => /attack/i.test(o.text))!;
                this.exec({ type: 'interactNpc', npcIndex: opportunistic.index, optionIndex: opt.opIndex, reason: 'attack' });
                this.lastAttackTick = this.tick;
                if (!this.lastFailure) {
                    this.escapeTries = 0;
                    return;
                }
                if (/cant_reach/.test(this.lastFailure)) {
                    this.lastFailure = savedFailure;
                }
            }
        }

        // Stuck-escape: open closed doors/gates if reachable, otherwise jitter.
        // out_of_range = BFS build-area too small to reach target; needs jitter too.
        if (/client_rejected|out_of_range|cant_reach/.test(this.lastFailure)) {
            this.escapeTries++;
            if (this.escapeTries > 20) {
                this.lastFailure = '';
                this.escapeTries = 0;
            }
            if (this.escapeTries % 30 === 1) {
                const locs = (state.nearbyLocs ?? []).slice(0, 8)
                    .map(l => `${l.name}(${l.x},${l.z})${l.reachable === true ? '✓' : ''}[${l.optionsWithIndex.map(o => o.text).join(',')}]`).join(' ');
                console.log(`[${this.name}] STUCK-ESCAPE at (${px},${pz}); locs: ${locs || 'none'}`);
            }

            const inLumbridge = !ramping && px < 3240 && pz > 3150 && pz < 3345;

            // Lumbridge-zone escape: prioritize walking east over opening doors
            // (castle doors lead deeper; east walk escapes the building zone)
            if (inLumbridge) {
                const moved = this.walkToward(px, pz, 3255, Math.max(pz, 3240), 'stuck-east');
                if (moved) {
                    if (this.escapeTries % 8 === 1) {
                        console.log(`[${this.name}] STUCK-EAST at (${px},${pz}) try=${this.escapeTries}`);
                    }
                    this.marchWp = -1;
                    this.waitTicks = 2;
                    return;
                }
            }

            const atTollGate = px >= 3264 && px <= 3272 && pz >= 3224 && pz <= 3232;
            if (atTollGate) {
                this.exec({ type: 'walkTo', x: 3250, z: 3240, running: true, reason: 'tollgate-escape' });
                this.lastFailure = '';
                this.escapeTries = 0;
                this.marchWp = -1;
                this.waitTicks = 3;
                return;
            }

            const closedGates = (state.nearbyLocs ?? []).filter(l =>
                /door|gate/i.test(l.name) &&
                l.optionsWithIndex.some(o => /^open$/i.test(o.text)));
            const reachableClosed = closedGates
                .filter(g => g.reachable === true)
                .filter(g => !(g.x >= 3267 && g.x <= 3269 && g.z >= 3226 && g.z <= 3229))
                .sort((a, b) => {
                    if (inLumbridge) {
                        const aEast = a.x >= px ? 0 : 1;
                        const bEast = b.x >= px ? 0 : 1;
                        if (aEast !== bEast) return aEast - bEast;
                    }
                    return Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz);
                })[0];
            if (reachableClosed) {
                const opt = reachableClosed.optionsWithIndex.find(o => /^open$/i.test(o.text))!;
                this.exec({ type: 'interactLoc', x: reachableClosed.x, z: reachableClosed.z, locId: reachableClosed.id, optionIndex: opt.opIndex, reason: 'gate-open' });
                console.log(`[${this.name}] GATE-OPEN at (${reachableClosed.x},${reachableClosed.z}) d=${Math.round(Math.hypot(reachableClosed.x - px, reachableClosed.z - pz))}`);
                this.waitTicks = 5;
                this.lastFailure = '';
                this.escapeTries = 0;
                const gx = reachableClosed.x + Math.sign(reachableClosed.x - px);
                const gz = reachableClosed.z + Math.sign(reachableClosed.z - pz);
                this.exec({ type: 'walkTo', x: gx, z: gz, running: true, reason: 'gate-through' });
                return;
            }

            if (inLumbridge && this.escapeTries > 15) {
                this.lastFailure = '';
                this.escapeTries = 0;
            }

            // Use waypoint target for escape direction when marching
            const wpIdx = this.marchWp >= 0 && this.marchWp < MARCH_WAYPOINTS.length
                ? this.marchWp : -1;
            const escTarget = wpIdx >= 0 ? MARCH_WAYPOINTS[wpIdx] : anchor;
            const toDist = Math.hypot(escTarget.x - px, escTarget.z - pz);
            let dx: number, dz: number;
            if (!ramping && toDist > 5) {
                const step = 3 + this.escapeTries % 4;
                const nx = (escTarget.x - px) / toDist, nz = (escTarget.z - pz) / toDist;
                const wobblePhase = this.escapeTries % 7;
                const wobble = (wobblePhase - 3) * 0.5;
                dx = Math.round((nx + wobble * nz) * step);
                dz = Math.round((nz - wobble * nx) * step);
            } else {
                dx = (1 + (this.tick + this.escapeTries) % 5) * ((this.tick + this.escapeTries) % 2 === 0 ? 1 : -1);
                dz = (1 + (this.tick * 7 + this.escapeTries) % 5) * ((this.tick >> 1) % 2 === 0 ? 1 : -1);
            }
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
        const reachedCircle = this.marchWp >= MARCH_WAYPOINTS.length ||
            Math.hypot(px - anchor.x, pz - anchor.z) < 16;
        if (!ramping && !hasBetterSword && coinsHeld >= 120 && reachedCircle) {
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
            this.exec({ type: 'closeModal', reason: 'done' });
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
            .sort((a, b) => {
                const ar = a.reachable !== false ? 0 : 1;
                const br = b.reachable !== false ? 0 : 1;
                return ar - br || a.distance - b.distance;
            });
        const target = preyAll.find(n => n.reachable !== false);
        const visible = preyAll[0];
        const marching = this.marchWp >= 0 && Math.hypot(px - anchor.x, pz - anchor.z) > 14;
        if (!target && visible && !marching) {
            this.walkToward(px, pz, visible.x, visible.z, 'stalk');
            this.waitTicks = 3;
            return;
        }
        if (!target && !ramping && Math.hypot(px - anchor.x, pz - anchor.z) > 14) {
            // Lumbridge-escape: bots trapped in buildings/cabbage (west of x=3240,
            // south of z=3260) force-walk east before following waypoints.
            if (px < 3240 && pz > 3150 && pz < 3345) {
                // Fred's farm / cabbage patch (west of x=3228, north of z=3265)
                // is fenced on its east side — the only exit is SOUTH along the
                // sheep pen back to the road junction, then east as normal.
                const inCabbage = px < 3228 && pz > 3265;
                const eastTarget = inCabbage
                    ? { x: 3216, z: 3247 }
                    : { x: 3255, z: Math.max(pz, 3240) };
                if (this.tick % 60 === 0) {
                    console.log(`[${this.name}] LUMBRIDGE-ESCAPE (${px},${pz}) -> ${inCabbage ? 'south (cabbage exit)' : 'east'}`);
                }
                this.walkToward(px, pz, eastTarget.x, eastTarget.z, 'lumbridge-escape');
                this.marchWp = -1;
                this.waitTicks = 2;
                return;
            }
            // Waypoint-based march: follow a tested route east of obstacles.
            if (this.marchWp < 0) {
                let bestDist = Infinity, bestIdx = 0;
                for (let i = 0; i < MARCH_WAYPOINTS.length; i++) {
                    const d = Math.hypot(px - MARCH_WAYPOINTS[i].x, pz - MARCH_WAYPOINTS[i].z);
                    if (d < bestDist) { bestDist = d; bestIdx = i; }
                }
                this.marchWp = bestDist < 12 ? Math.min(bestIdx + 1, MARCH_WAYPOINTS.length) : bestIdx;
                this.marchWpSince = this.tick;
            }
            // Crossing regression guard: claiming to be past the farm-belt
            // crossing while still south of the fence means the arrival check
            // lied — go back to the road approach and cross for real.
            if (this.marchWp >= BELT.backTo + 2 && this.marchWp < MARCH_WAYPOINTS.length &&
                px >= BELT.x0 && px <= BELT.x1 && pz <= BELT.z1 && pz >= 3285) {
                this.marchWp = BELT.backTo;
                this.marchWpSince = this.tick;
                console.log(`[${this.name}] MARCH-REGRESS at (${px},${pz}) — south of belt fence, back to wp${BELT.backTo}`);
            }

            const wpIdx = Math.min(this.marchWp, MARCH_WAYPOINTS.length - 1);
            const wp = this.marchWp >= MARCH_WAYPOINTS.length ? anchor : MARCH_WAYPOINTS[wpIdx];
            const distToWp = Math.hypot(px - wp.x, pz - wp.z);

            if (distToWp < ((wp as any).r ?? 10) && this.marchWp < MARCH_WAYPOINTS.length) {
                this.marchWp++;
                this.marchWpSince = this.tick;
                console.log(`[${this.name}] WAYPOINT ${this.marchWp}/${MARCH_WAYPOINTS.length} reached at (${px},${pz})`);
            }

            const wpStall = this.tick - this.marchWpSince;
            const distToSite = Math.round(Math.hypot(px - anchor.x, pz - anchor.z));
            if (this.tick % 60 === 0) {
                console.log(`[${this.name}] MARCH (${px},${pz}) d=${distToSite} wp=${this.marchWp}/${MARCH_WAYPOINTS.length} stall=${wpStall}`);
            }

            if (wpStall > 120 && this.marchWp < MARCH_WAYPOINTS.length) {
                // Direction-agnostic advance: if the NEXT waypoint is about as
                // close as the current one, we're past the current one — stop
                // fighting geometry we've already cleared.
                const nxt = this.marchWp + 1 >= MARCH_WAYPOINTS.length
                    ? anchor : MARCH_WAYPOINTS[this.marchWp + 1];
                if (Math.hypot(px - nxt.x, pz - nxt.z) < distToWp + 4) {
                    this.marchWp++;
                    this.marchWpSince = this.tick;
                    console.log(`[${this.name}] MARCH-ADVANCE (past wp) at (${px},${pz}) -> wp=${this.marchWp}`);
                }
            }
            if (wpStall > 240) {
                // Force-toward-WP: offset the target around the waypoint's
                // bearing instead of shoving blind east (blind east is what
                // built the dead pocket at x=3262-3265). Inside the farm belt
                // probe WEST first — the road crossing is west, east is the
                // pocket. Elsewhere cycle W/direct/N.
                const inBelt = px >= BELT.x0 && px <= BELT.x1 && pz >= 3285 && pz <= BELT.z1;
                const OFFSETS = inBelt
                    ? [{ dx: -10, dz: -2 }, { dx: -14, dz: 4 }, { dx: -6, dz: 8 }]
                    : [{ dx: 0, dz: 0 }, { dx: -8, dz: 0 }, { dx: 0, dz: 8 }];
                const o = OFFSETS[Math.floor(wpStall / 40) % OFFSETS.length];
                const fx = wp.x + o.dx, fz = wp.z + o.dz;
                // Step at most ~12 tiles from here toward the offset target.
                const fd = Math.hypot(fx - px, fz - pz) || 1;
                const step = Math.min(12, fd);
                const tx = Math.round(px + ((fx - px) / fd) * step);
                const tz = Math.round(pz + ((fz - pz) / fd) * step);
                this.exec({ type: 'walkTo', x: tx, z: tz, running: true, reason: 'march-force' });
                this.lastFailure = '';
                this.forceCount++;
                if (this.forceCount % 15 === 1) {
                    console.log(`[${this.name}] MARCH-FORCE stall=${wpStall} at (${px},${pz}) -> (${tx},${tz}) [wp${this.marchWp}+(${o.dx},${o.dz})]`);
                }
                this.waitTicks = 3;
                return;
            }

            const wpIdx2 = Math.min(this.marchWp, MARCH_WAYPOINTS.length - 1);
            const curWp = this.marchWp >= MARCH_WAYPOINTS.length ? anchor : MARCH_WAYPOINTS[wpIdx2];
            const moved = this.walkToward(px, pz, curWp.x, curWp.z, 'march');
            if (!moved) {
                this.lastFailure = 'march:cant_reach';
            }
            this.waitTicks = 2;
            return;
        }
        if (!target && ramping) {
            // Location-free ramp: random-walk to scout for men instead of
            // walking to a fixed anchor (which hits buildings/doors).
            const dx = (3 + this.tick % 7) * ((this.tick + Math.floor(px)) % 2 === 0 ? 1 : -1);
            const dz = (3 + (this.tick * 3) % 7) * ((this.tick + Math.floor(pz)) % 2 === 0 ? 1 : -1);
            this.exec({ type: 'walkTo', x: px + dx, z: pz + dz, running: true, reason: 'ramp-scout' });
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
    for (const bot of bots) {
        if (bot.stale && bot.online) {
            console.warn(`[lawswarm] ${bot.name} STALE at (${bot.px},${bot.pz}) — route reset`);
            bot.resetRoute();
        }
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

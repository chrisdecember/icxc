import { runScript } from "../../sdk/runner";

// GTVAULT — the law monopoly's clearing house. Swarm units drop law
// stacks at the vault tile (3227,3368) by the Varrock circle; this bot
// hoovers every pile, banks at Varrock West when holding enough, and
// runs the BUYING DESK: standing ads + serveTrades paying coins for any
// law runes other agents bring. All laws flow through us.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    // v2 two-stop patrol: the Varrock circle vault banks at Varrock
    // West; the wizard-tower vault banks at Draynor next door.
    const STOPS = [
      { name: "varrock", vault: { x: 3228, z: 3340 }, wait: { x: 3229, z: 3332 }, bank: { x: 3185, z: 3436 } },
      { name: "tower", vault: { x: 3105, z: 3158 }, wait: { x: 3107, z: 3155 }, bank: { x: 3092, z: 3243 } },
    ];
    let stopIdx = 0;
    let VAULT = STOPS[0].vault, WAIT = STOPS[0].wait, BANK = STOPS[0].bank;
    // Bank at 10: proves the deposit loop quickly and keeps the exposed
    // inventory stack small (was 30 — never reached, so the pipeline's
    // final leg had never actually run).
    const BANK_AT = 10;
    const ADS = [
      "BUYING LAW RUNES — paying coins. trade me",
      "law runes wanted. instant coin payment at the wizard circle",
      "sell your laws here — best (only) buyer on the server",
    ];
    let adIdx = 0;
    let lawsBanked = 0;
    let loopN = 0;

    async function isAlive() {
      const state = sdk.getState();
      if (!state?.player) return true;
      return state.player.hp > 0;
    }

    async function hooverPiles() {
      let dashed = false;
      for (let i = 0; i < 6; i++) {
        const pile = sdk.findGroundItem(/law rune/i);
        if (!pile) break;
        dashed = true;
        try {
          await bot.pickupItem(pile);
          console.log(
            `[VAULT] Hoovered a law pile — holding ${sdk.countInventoryItems(/law rune/i)}`
          );
        } catch (_) {}
        await sdk.waitForTicks(2);
      }
      if (dashed) await bot.walkTo(WAIT.x, WAIT.z);
    }

    async function patrolVault() {
      console.log("[VAULT] Patrol — checking vault tile for law piles");
      try { await bot.walkTo(VAULT.x, VAULT.z); } catch (_) {}
      await sdk.waitForTicks(3);
      await hooverPiles();
    }

    async function bankIfFull() {
      const laws = sdk.countInventoryItems(/law rune/i);
      if (laws < BANK_AT) return;
      console.log(`[VAULT] Banking ${laws} laws`);
      await bot.walkTo(BANK.x, BANK.z);
      try {
        await bot.openBank();
        await bot.depositItem(/law rune/i, -1);
        await bot.closeBank();
        lawsBanked += laws;
        console.log(`[VAULT] LAW-MONOPOLY banked total: ${lawsBanked}`);
      } catch (_) {}
      await bot.walkTo(WAIT.x, WAIT.z);
    }

    async function buyingDesk(minutes: number) {
      await sdk.say(ADS[adIdx++ % ADS.length]);
      try {
        await bot.serveTrades({
          give: [{ name: /coins/i, amount: 200 }],
          accept: (offer) => offer.some((o) => /law rune/i.test(o.name)),
          onTrade: (t) =>
            console.log(
              `[VAULT] BOUGHT laws from ${t.partner}: ${t.received
                .map((r) => r.name)
                .join(",")}`
            ),
          timeout: minutes * 60_000,
        });
      } catch (_) {}
    }

    // ═══════════════════════════════════════════════════════
    console.log("[VAULT] Clearing house opens at the wizard circle");
    await sdk.say("the law exchange is open");
    await bot.walkTo(WAIT.x, WAIT.z);

    while (true) {
      if (!(await isAlive())) {
        console.log("[VAULT] Death — recovering");
        await sdk.waitForTicks(5);
        await bot.walkTo(WAIT.x, WAIT.z);
        continue;
      }
      // Manual research finding: there's no meaningful merch area besides
      // (maybe) Lumbridge spawn — agents don't trade at the wizard circle.
      // So the buying desk here was dead weight. The monopoly is a
      // PRODUCTION monopoly: we collect everything WE farm and bank it.
      // Pure collect + bank now; a light buy presence lives on the
      // Lumbridge mules where the only traffic actually is.
      await hooverPiles();
      await bankIfFull();
      if (!sdk.findGroundItem(/law rune/i)) {
        await patrolVault();
      }
      await sdk.waitForTicks(4);
      // Rotate stops every ~8 loops (~5 min per site).
      if (++loopN % 8 === 0) {
        stopIdx = (stopIdx + 1) % STOPS.length;
        VAULT = STOPS[stopIdx].vault; WAIT = STOPS[stopIdx].wait; BANK = STOPS[stopIdx].bank;
        console.log(`[VAULT] rotating patrol -> ${STOPS[stopIdx].name}`);
        try { await bot.walkTo(WAIT.x, WAIT.z); } catch (_) {}
      }
    }
  },
  { timeout: 86_400_000 }
);

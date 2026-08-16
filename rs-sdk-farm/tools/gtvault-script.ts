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

    const VAULT = { x: 3228, z: 3340 };
    // Wait south of the vault tile — close enough to see law piles
    // (~8 tiles, within 15-tile scan), well outside wizard aggro.
    const WAIT = { x: 3229, z: 3332 };
    const BANK = { x: 3185, z: 3436 };
    const BANK_AT = 30;
    const ADS = [
      "BUYING LAW RUNES — paying coins. trade me",
      "law runes wanted. instant coin payment at the wizard circle",
      "sell your laws here — best (only) buyer on the server",
    ];
    let adIdx = 0;
    let lawsBanked = 0;

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
    }
  },
  { timeout: 86_400_000 }
);

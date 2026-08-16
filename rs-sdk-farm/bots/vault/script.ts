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

    const VAULT = { x: 3227, z: 3368 };
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

    async function earnFloat(target: number) {
      // Coin float for the buying desk — Varrock-center men are close.
      if (sdk.countInventoryItems(/coins/i) >= target) return;
      console.log("[VAULT] Building coin float");
      await bot.walkTo(3213, 3428);
      for (let i = 0; i < 120 && sdk.countInventoryItems(/coins/i) < target; i++) {
        try { await bot.pickpocketNpc(/^man$/i); } catch (_) {}
        await bot.dismissBlockingUI();
      }
      await bot.walkTo(VAULT.x, VAULT.z);
    }

    async function hooverPiles() {
      for (let i = 0; i < 6; i++) {
        const pile = sdk.findGroundItem(/law rune/i);
        if (!pile) break;
        try {
          await bot.pickupItem(pile);
          console.log(
            `[VAULT] Hoovered a law pile — holding ${sdk.countInventoryItems(/law rune/i)}`
          );
        } catch (_) {}
        await sdk.waitForTicks(2);
      }
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
      await bot.walkTo(VAULT.x, VAULT.z);
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
    await bot.walkTo(VAULT.x, VAULT.z);

    while (true) {
      if (!(await isAlive())) {
        console.log("[VAULT] Death — recovering");
        await sdk.waitForTicks(5);
        await bot.walkTo(VAULT.x, VAULT.z);
        continue;
      }
      await hooverPiles();
      await bankIfFull();
      await earnFloat(400);
      await buyingDesk(3);
    }
  },
  { timeout: 86_400_000 }
);

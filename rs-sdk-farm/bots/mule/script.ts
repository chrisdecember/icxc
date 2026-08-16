import { runScript } from "../../sdk/runner";

// MERCHANT MULE — barter-economy arbitrage minion.
// Server economics (observed): labor is free so commodities are abundant,
// cash is inflated junk, and the scarce thing is *inputs at the right place*.
// The mule turns our waste stream (cowhides, bones the KING drops) into
// XP-dense inputs (ores, logs, raw fish, bars) by hawking barter trades at
// whichever hub actually has agents in it — measured, not assumed.
//
// Loop: scavenge cow field drops -> tour hubs counting players (evidence)
// -> park at densest -> advertise + serve barter trades -> deliver any
// XP-dense goods to the KING at the meeting point -> repeat.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    const MEETING_POINT = { x: 3222, z: 3218 };
    const COW_FIELD = { x: 3253, z: 3290 };
    const HUBS = [
      { name: "lumbridge", x: 3222, z: 3218 },
      { name: "varrock-west-bank", x: 3185, z: 3436 },
      { name: "varrock-center", x: 3213, z: 3428 },
    ];
    // What we hawk (our abundant waste stream)
    const STOCK = /cowhide|bones|raw beef|beer|feather/i;
    // What the KING can convert to XP (smith/fletch/cook/bury)
    const XP_GOODS = /(ore$|^logs$|oak logs|willow logs|^raw |bar$|^bones$|big bones)/i;

    const ADS = [
      "trading cowhides and bones -- want any ore / logs / raw fish",
      "free hides for your spare ores! barter only, no coins",
      "mule open for business: goods for goods, anything considered",
    ];
    let adIdx = 0;

    async function isAlive() {
      const state = sdk.getState();
      if (!state?.player) return true;
      return state.player.hp > 0;
    }

    async function scavenge(minItems: number, maxTicks: number) {
      console.log("[MULE] Scavenging cow field drops");
      await bot.walkTo(COW_FIELD.x, COW_FIELD.z);
      let ticks = 0;
      while (sdk.getInventory().length < minItems && ticks < maxTicks) {
        const loot =
          sdk.findGroundItem(/cowhide/i) ||
          sdk.findGroundItem(/^bones$/i) ||
          sdk.findGroundItem(/raw beef/i);
        if (loot) {
          try { await bot.pickupItem(loot); } catch (_) {}
        } else {
          await sdk.waitForTicks(4);
        }
        ticks++;
        await bot.dismissBlockingUI();
      }
      console.log(`[MULE] Scavenged, inv=${sdk.getInventory().length}`);
    }

    async function surveyHubs(): Promise<{ name: string; x: number; z: number }> {
      let best = HUBS[0];
      let bestCount = -1;
      for (const hub of HUBS) {
        await bot.walkTo(hub.x, hub.z);
        await sdk.waitForTicks(4);
        const n = sdk.getState()?.nearbyPlayers?.length ?? 0;
        console.log(`[MULE] HUB-SURVEY ${hub.name}: ${n} players`);
        if (n > bestCount) {
          bestCount = n;
          best = hub;
        }
      }
      console.log(`[MULE] Parking at ${best.name} (${bestCount} players)`);
      return best;
    }

    async function hawk(minutes: number) {
      const stock = sdk
        .getInventory()
        .filter((i) => STOCK.test(i.name))
        .map((i) => ({ name: new RegExp(i.name, "i"), amount: -1 }));

      await sdk.say(ADS[adIdx++ % ADS.length]);

      const res = await bot.serveTrades({
        give: stock,
        accept: (theirOffer) => theirOffer.length > 0, // any goods beat junk
        onTrade: (t) =>
          console.log(
            `[MULE] TRADE with ${t.partner}: gave ${t.gave.length} items, got ${t.received
              .map((r) => r.name)
              .join(",") || "nothing"}`
          ),
        timeout: minutes * 60_000,
      });
      if (res.trades.length)
        console.log(`[MULE] ${res.trades.length} trades completed this cycle`);
    }

    async function deliverToKing() {
      const goods = sdk.getInventory().filter((i) => XP_GOODS.test(i.name));
      if (goods.length === 0) return;
      console.log(`[MULE] Delivering ${goods.length} XP goods to the king`);
      await bot.walkTo(MEETING_POINT.x, MEETING_POINT.z);
      try {
        await bot.trade(/king/i, {
          give: goods.map((g) => ({ name: new RegExp(g.name, "i"), amount: -1 })),
          timeout: 45_000,
        });
      } catch (_) {}
    }

    // ═══════════════════════════════════════════════════════
    console.log("[MULE] Merchant minion reporting for duty");
    await sdk.say("the merchant guild is open");

    let hub = await surveyHubs();
    let cycles = 0;

    while (true) {
      if (!(await isAlive())) {
        console.log("[MULE] Death detected — recovering");
        await sdk.waitForTicks(5);
        continue;
      }

      if (sdk.countInventoryItems(STOCK) < 5) {
        await scavenge(20, 120);
      }

      await bot.walkTo(hub.x, hub.z);
      await hawk(6);

      await deliverToKing();

      cycles++;
      if (cycles % 4 === 0) hub = await surveyHubs(); // re-measure the market
    }
  },
  { timeout: 7_200_000 }
);

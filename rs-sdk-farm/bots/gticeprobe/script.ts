import { runScript } from "../../sdk/runner";

// GTICEPROBE v5 — LISTENING POST. Recon complete (ice route, tower,
// Aubury); the account now stands in Lumbridge courtyard — the busiest
// square on the server — as the empire's ear. SHOW_CHAT=true routes all
// public chat into this brain's log ("> " lines); the war room and chat
// digests read from here. Rotates through three high-traffic spots so
// the 15-tile chat radius sweeps the whole town core.

await runScript(
  async (ctx) => {
    const { bot, sdk } = ctx;
    try { await sdk.waitForReady(120_000); } catch (_) {}
    await bot.skipTutorial();

    const POSTS = [
      { name: "courtyard", x: 3222, z: 3218 },
      { name: "north-gate", x: 3222, z: 3232 },
      { name: "church", x: 3243, z: 3212 },
    ];
    let i = 0;
    console.log(`[EAR] listening post online`);
    while (true) {
      const post = POSTS[i++ % POSTS.length];
      try { await bot.walkTo(post.x, post.z, 3); } catch (_) {}
      console.log(`[EAR] on station: ${post.name}`);
      // Hold each post ~5 minutes; chat streams into the log passively.
      for (let t = 0; t < 30; t++) await sdk.waitForTicks(16);
    }
  },
  { timeout: 86_400_000 }
);

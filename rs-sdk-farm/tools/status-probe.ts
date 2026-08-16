// Observer-mode telemetry probe: reads each bot's live state without
// preempting its controlling script (observers coexist with controllers).
import { BotSDK } from "./sdk/index";
import { deriveGatewayUrl } from "./sdk/index";
import { readFileSync } from "fs";

const bots = ["gtking", "gtfingers", "gtpick", "gtnetter", "gttimber"];

function loadEnv(name: string): { user: string; pass: string; server: string } {
  const txt = readFileSync(`bots/${name}/bot.env`, "utf-8");
  const get = (k: string) => txt.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "";
  return { user: get("BOT_USERNAME"), pass: get("PASSWORD"), server: get("SERVER") };
}

for (const name of bots) {
  const { user, pass, server } = loadEnv(name);
  const sdk = new BotSDK({
    botUsername: user,
    password: pass,
    gatewayUrl: deriveGatewayUrl(server),
    connectionMode: "observe",
    autoLaunchBrowser: false,
    autoReconnect: false,
    showChat: false,
  });
  try {
    await sdk.connect();
    await new Promise((r) => setTimeout(r, 2500));
    const st = sdk.getState();
    if (!st?.player) {
      console.log(`${name}: no state`);
    } else {
      const skills = sdk.getSkills();
      const total = skills.reduce((a, s) => a + s.level, 0);
      const nonDefault = skills
        .filter((s) => (s.name === "Hitpoints" ? s.level > 10 : s.level > 1))
        .map((s) => `${s.name.slice(0, 5)}:${s.level}`)
        .join(" ");
      const inv = sdk.getInventory();
      const invSummary = inv
        .slice(0, 8)
        .map((i) => `${i.name}x${i.stackSize}`)
        .join(",");
      console.log(
        `${name}: total=${total} pos=(${st.player.worldX},${st.player.worldZ}) hp=${st.player.hp} | ${nonDefault}`
      );
      console.log(`   inv(${inv.length}): ${invSummary}${inv.length > 8 ? "..." : ""}`);
    }
  } catch (e) {
    console.log(`${name}: ERR ${(e as Error).message}`);
  }
  try { sdk.disconnect(); } catch (_) {}
}
process.exit(0);

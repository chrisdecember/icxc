// One-shot observer: dump nearby NPCs a bot can see. Usage: bun npc-probe.ts <name>
import { BotSDK, deriveGatewayUrl } from "./sdk/index";
import { readFileSync } from "fs";
const name = process.argv[2]!;
const env = readFileSync(`bots/${name}/bot.env`, "utf8");
const get = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
const sdk = new BotSDK({
  botUsername: get("BOT_USERNAME") || name,
  password: get("PASSWORD"),
  gatewayUrl: deriveGatewayUrl(get("SERVER") || "rs-sdk-demo.fly.dev"),
  connectionMode: "observe",
  autoLaunchBrowser: false,
  autoReconnect: false,
  showChat: false,
});
await sdk.connect();
await new Promise((r) => setTimeout(r, 3000));
const st = sdk.getState();
console.log("pos:", st?.player?.worldX, st?.player?.worldZ, "hp:", st?.player?.hp);
const npcs = (sdk.getNearbyNpcs() as any[]).slice(0, 20);
console.log("npcs:", npcs.length);
for (const n of npcs) console.log(`  "${n.name}" cl=${n.combatLevel} @(${n.x},${n.z}) reach=${n.reachable} opts=[${(n.optionsWithIndex||[]).map((o:any)=>o.text).join(",")}]`);
try { sdk.disconnect(); } catch (_) {}
process.exit(0);

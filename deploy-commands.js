// deploy-commands.js
import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./slash-commands.js";

// --- Env ---
const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID || "1435400983856414740";
const guildId = process.env.DISCORD_GUILD_ID;

if (!token) {
  console.error("❌ Missing environment variable: DISCORD_BOT_TOKEN");
  process.exit(1);
}
if (!clientId) {
  console.error("❌ Missing environment variable: DISCORD_CLIENT_ID");
  process.exit(1);
}
if (!guildId) {
  console.error("❌ Missing environment variable: DISCORD_GUILD_ID");
  process.exit(1);
}

// If commands are SlashCommandBuilder objects, convert them to JSON
const payload = Array.isArray(commands)
  ? commands.map((c) => (typeof c?.toJSON === "function" ? c.toJSON() : c))
  : [];

if (!Array.isArray(commands) || payload.length === 0) {
  console.error("❌ No commands found to register. Check your slash-commands.js export.");
  process.exit(1);
}

// --- REST client ---
const rest = new REST({ version: "10" }).setToken(token);

// --- Register guild commands (fast propagation) ---
(async () => {
  try {
    console.log("🔄 Registering guild-specific slash commands…");
    console.log(`📋 Client ID: ${clientId}`);
    console.log(`🏰 Guild ID: ${guildId}`);
    console.log(`🧩 Total commands: ${payload.length}`);

    const data = await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: payload },
    );

    console.log(`✅ Successfully registered ${data.length} guild slash commands!`);
    for (const cmd of data) console.log(`  • /${cmd.name}`);
    console.log("\n✨ Guild commands update instantly.");
  } catch (err) {
    console.error("\n❌ Failed to register slash commands!");
    // Try to surface Discord API validation errors clearly
    if (err?.rawError) {
      console.error(JSON.stringify(err.rawError, null, 2));
    } else if (err?.response?.data) {
      console.error(JSON.stringify(err.response.data, null, 2));
    } else {
      console.error(err);
    }
    process.exit(1);
  }
})();

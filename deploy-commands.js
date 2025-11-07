// deploy-commands.js
import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./slash-commands.js";

// Validate environment variables
const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID || "1435400983856414740";
const guildId = process.env.DISCORD_GUILD_ID;

if (!token) {
  console.error("❌ Missing DISCORD_BOT_TOKEN");
  process.exit(1);
}
if (!clientId) {
  console.error("❌ Missing DISCORD_CLIENT_ID");
  process.exit(1);
}
if (!guildId) {
  console.error("❌ Missing DISCORD_GUILD_ID");
  process.exit(1);
}

// Ensure commands are JSON compatible
const payload = commands.map(cmd => 
  typeof cmd.toJSON === "function" ? cmd.toJSON() : cmd
);

// Setup REST client
const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("🔄 Registering commands for guild:", guildId);
    const data = await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: payload }
    );

    console.log(`✅ Successfully registered ${data.length} commands:`);
    for (const cmd of data) console.log(`  • /${cmd.name}`);
  } catch (error) {
    console.error("❌ Failed to register commands.");
    console.error(error?.rawError ?? error);
  }
})();

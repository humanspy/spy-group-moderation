import { REST, Routes } from 'discord.js';
import { commands } from './slash-commands.js';

// Load environment variables
const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID || '1435400983856414740';
const guildId = process.env.DISCORD_GUILD_ID;

if (!token) {
  console.error('❌ Missing environment variable: DISCORD_BOT_TOKEN');
  process.exit(1);
}

if (!clientId) {
  console.error('❌ Missing environment variable: DISCORD_CLIENT_ID');
  process.exit(1);
}

if (!guildId) {
  console.error('❌ Missing environment variable: DISCORD_GUILD_ID');
  process.exit(1);
}

// Initialize REST API
const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('🔄 Registering guild-specific slash commands...');
    console.log(`📋 Client ID: ${clientId}`);
    console.log(`🏰 Guild ID: ${guildId}`);
    console.log(`🧩 Total commands: ${commands.length}`);

    // Register commands for specific guild (instant updates!)
    const data = await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );

    console.log(`✅ Successfully registered ${data.length} guild-specific slash commands!`);
    console.log('📜 Registered commands:');
    data.forEach(cmd => console.log(`  • /${cmd.name}`));

    console.log('\n✨ Guild commands update instantly - no waiting required!');
  } catch (error) {
    console.error('\n❌ Failed to register slash commands!');
    if (error.response) {
      console.error('Response:', error.response);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
})();

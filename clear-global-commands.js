import { REST, Routes } from 'discord.js';

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID || '1435400983856414740';

if (!token) {
  console.error('❌ Missing environment variable: DISCORD_BOT_TOKEN');
  process.exit(1);
}

if (!clientId) {
  console.error('❌ Missing environment variable: DISCORD_CLIENT_ID');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('🔄 Checking for global commands...');
    
    const globalCommands = await rest.get(
      Routes.applicationCommands(clientId)
    );
    
    if (globalCommands.length === 0) {
      console.log('✅ No global commands found - nothing to clear!');
      return;
    }
    
    console.log(`📋 Found ${globalCommands.length} global commands:`);
    globalCommands.forEach(cmd => console.log(`  • /${cmd.name}`));
    
    console.log('\n🗑️  Deleting all global commands...');
    
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: [] }
    );
    
    console.log('✅ Successfully deleted all global commands!');
    console.log('📝 Only guild-specific commands remain (instant updates)');
  } catch (error) {
    console.error('❌ Failed to clear global commands!');
    console.error(error);
    process.exit(1);
  }
})();

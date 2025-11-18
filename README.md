# Discord Moderation Bot

A Discord moderation bot with manual moderation tools including warnings tracking, message purging, and moderator commands.

## Features

✅ **Warning System**
- Track warning counts per user
- View warning history with timestamps
- Clear warnings when appropriate
- Manually warn users with custom reasons

✅ **Moderation Commands**
- Message purging (bulk delete)
- User warning management
- Role-based permission system

✅ **Moderator Commands** (Slash Commands)
- `/warn @user <reason>` - Manually warn a user with a custom reason
- `/warnings` - View top 10 users by warning count
- `/warnings @user` - Check a specific user's warnings
- `/clearwarnings @user` - Clear warnings for a user
- `/purge <amount>` - Delete up to 100 messages at once
- `/help` - Display all commands with descriptions

*Note: Legacy prefix command `!purge <amount>` is still supported for backwards compatibility.*

## Setup Instructions

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to the "Bot" section in the left sidebar
4. Click "Add Bot"
5. Under "Privileged Gateway Intents", enable:
   - **Message Content Intent** (required)
   - **Server Members Intent** (required)
6. Copy your bot token

### 2. Add Bot Token to Replit

You'll need to add your Discord bot token as a secret in Replit. The bot will ask for this when you run it.

### 3. Invite Bot to Your Server

1. In Discord Developer Portal, go to "OAuth2" → "URL Generator"
2. Select these scopes:
   - `bot`
   - `applications.commands` (for slash commands)
3. Select these bot permissions:
   - Read Messages/View Channels
   - Send Messages
   - Manage Messages
   - Read Message History
4. Copy the generated URL and open it in your browser
5. Select your server and authorize the bot

### 4. Deploy Slash Commands

After inviting the bot, register the slash commands by running:
```bash
npm run deploy
```

This will register all slash commands globally. They may take up to 1 hour to appear in all servers, but will appear immediately in servers where the bot is already present.

### 5. Configure Your Server

1. Create moderator roles named "Moderator" and/or "Admin"
2. Give the bot permissions to manage messages for the purge command to work

### 6. Customize Settings

Edit `config.json` to customize:
- Moderator role names
- Exempt role IDs (roles that bypass moderation commands if needed)
- Purge settings (max messages, confirmation timeout)

## Configuration

The `config.json` file contains bot settings:

```json
{
  "moderatorRoles": ["Moderator", "Admin"],
  "exemptRoles": [],
  "purge": {
    "maxMessages": 500,
    "confirmationTimeout": 10000
  }
}
```

## How It Works

1. **Slash Commands**: Moderators use slash commands to manage warnings and messages
2. **Permission System**: Only users with configured moderator roles can use commands
3. **Warning Tracking**: Warnings are recorded with timestamps and reasons
4. **Bulk Delete**: Purge command allows deletion of up to 100 messages at a time

## Warning System

- Warnings are manually tracked for each user
- Moderators can add warnings with custom reasons
- Moderators can view warning history with timestamps
- Moderators can clear warnings when appropriate
- Warning data is stored in `warnings.json`

## Tech Stack

- Node.js 20
- Discord.js v14
- File-based storage for warnings and configuration

## Support

For issues or questions, check:
- Discord.js documentation: https://discord.js.org/
- Discord Developer Portal: https://discord.com/developers/

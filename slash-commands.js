import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('clearwarnings')
    .setDescription('Clear all warnings for a user')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to clear warnings for')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(null),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user with optional timeout')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to warn')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('The reason for the warning')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('severity')
        .setDescription('Warning severity level')
        .setRequired(false)
        .addChoices(
          { name: '⚠️ Minor', value: 'minor' },
          { name: '🔶 Moderate', value: 'moderate' },
          { name: '🔴 Severe', value: 'severe' }
        )
    )
    .addIntegerOption(option =>
      option
        .setName('timeout')
        .setDescription('Timeout duration in minutes (optional)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(40320)
    )
    .addBooleanOption(option =>
      option
        .setName('silent')
        .setDescription('Skip sending DM to user (default: false)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(null),

  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete multiple messages at once')
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Number of messages to delete (1-1000)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1000)
    )
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Only delete messages from this user (optional)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(null),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available moderation commands'),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a user without warning')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to timeout')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('duration')
        .setDescription('Timeout duration in minutes')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('The reason for the timeout')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(null),

  new SlashCommandBuilder()
    .setName('case')
    .setDescription('Search cases by number, user, or severity')
    .addIntegerOption(option =>
      option
        .setName('number')
        .setDescription('Case number')
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to search cases for')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('severity')
        .setDescription('Filter by severity')
        .setRequired(false)
        .addChoices(
          { name: '⚠️ Minor', value: 'minor' },
          { name: '🔶 Moderate', value: 'moderate' },
          { name: '🔴 Severe', value: 'severe' }
        )
    )
    .setDefaultMemberPermissions(null),

  new SlashCommandBuilder()
    .setName('deletecase')
    .setDescription('Delete a case and optionally revert the warning')
    .addIntegerOption(option =>
      option
        .setName('number')
        .setDescription('Case number to delete')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName('revert_warn')
        .setDescription('Revert the warning count for this user (default: false)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(null),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a user from the server')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to kick')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('The reason for the kick')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(null),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from the server')
    .addStringOption(option =>
      option
        .setName('target')
        .setDescription('User to ban (@mention or User ID)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('The reason for the ban')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName('hackban')
        .setDescription('Enable hackban mode (ban user not in server)')
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName('delete_days')
        .setDescription('Delete message history (0-7 days, default: 0)')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(7)
    )
    .addStringOption(option =>
      option
        .setName('override_code')
        .setDescription('Override code (for Trial Moderators/Moderators)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(null),

  new SlashCommandBuilder()
    .setName('generatebancode')
    .setDescription('Generate a one-time ban override code for Trial Moderators/Moderators')
    .setDefaultMemberPermissions(null),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user from the server')
    .addStringOption(option =>
      option
        .setName('user_id')
        .setDescription('User ID to unban (leave empty to see banned list)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for unbanning')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('override_code')
        .setDescription('Override code (for Trial Moderators/Moderators)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(null),
].map(command => command.toJSON());

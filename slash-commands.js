import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a user")
    .addUserOption((o) => o.setName("user").setDescription("User to warn").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true))
    .addStringOption((o) => o.setName("severity").setDescription("minor / moderate / severe"))
    .addIntegerOption((o) => o.setName("timeout").setDescription("Timeout in minutes"))
    .addBooleanOption((o) => o.setName("silent").setDescription("Don't send DM")),

  new SlashCommandBuilder()
    .setName("case")
    .setDescription("Lookup cases")
    .addIntegerOption((o) => o.setName("number").setDescription("Case number"))
    .addUserOption((o) => o.setName("user").setDescription("Search by user"))
    .addStringOption((o) => o.setName("severity").setDescription("minor / moderate / severe")),

  new SlashCommandBuilder()
    .setName("clearwarnings")
    .setDescription("Clear all warnings for a user")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete messages")
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setRequired(true))
    .addUserOption((o) => o.setName("user").setDescription("Only remove messages from this user")),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a user")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true)),

  // timeout now uses fixed-choice duration strings (registered choices) and uses Discord's Moderate Members permission by default
  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a user")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("duration")
        .setDescription("Duration (choose one)")
        .setRequired(true)
        .addChoices(
          { name: "1 minute", value: "1min" },
          { name: "5 minutes", value: "5min" },
          { name: "10 minutes", value: "10min" },
          { name: "1 hour", value: "1hour" },
          { name: "1 day", value: "1day" },
          { name: "1 week", value: "1week" }
        )
    )
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a user")
    .addStringOption((o) => o.setName("target").setDescription("User mention or ID").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true))
    .addBooleanOption((o) => o.setName("hackban").setDescription("Ban by ID (even if not in server)"))
    .addIntegerOption((o) => o.setName("delete_days").setDescription("Delete message history (0-7)"))
    .addStringOption((o) => o.setName("override_code").setDescription("Override code")),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user")
    .addStringOption((o) => o.setName("user_id").setDescription("User ID"))
    .addStringOption((o) => o.setName("reason").setDescription("Reason"))
    .addStringOption((o) => o.setName("override_code").setDescription("Override code")),

  new SlashCommandBuilder()
    .setName("deletecase")
    .setDescription("Delete a case by number")
    .addIntegerOption((o) => o.setName("number").setDescription("Case number").setRequired(true))
    .addBooleanOption((o) => o.setName("revert_warn").setDescription("Undo the warning?")),

  new SlashCommandBuilder()
    .setName("generatebancode")
    .setDescription("Generate a one-time ban override code for Trial Moderators/Moderators")
    .setDefaultMemberPermissions(null),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all available moderation commands"),
].map((cmd) => cmd.toJSON());

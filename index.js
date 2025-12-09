import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import fs from "fs/promises";
import bcrypt from "bcrypt";
import { organizeCasesToFolder } from "./organize-cases.js";

import { ensureDataPath } from "./utils/storage.js";
await ensureDataPath();

// --- Always run deploy-commands.js before starting the bot ---
import { execSync } from "child_process";
import { existsSync } from "fs";

if (existsSync("./deploy-commands.js")) {
  try {
    console.log("📦 Deploying slash commands...");
    execSync("node ./deploy-commands.js", { stdio: "inherit" });
    console.log("✅ Slash commands deployed successfully.");
  } catch (error) {
    console.error("❌ Failed to deploy commands:", error);
  }
} else {
  console.log("⚠️ deploy-commands.js not found — skipping slash command deployment.");
}


// --- Load config ---
const config = JSON.parse(await fs.readFile("./config.json", "utf-8"));

// Channel ID
const OVERRIDE_CODE_CHANNEL = process.env.DISCORD_Channel_ID;
const LOG_CHANNEL = process.env.DISCORD_LOG_CHANNEL;

// --- Staff role IDs and permissions ---
const roleHierarchy = {
  "1432377499295154426": {
    name: "Owner 1st Degree",
    level: 0,
    permissions: "all",
  },
  "1431792082166616075": { name: "The SPY", level: 1, permissions: "all" },
  "1431794523918569593": { name: "DEEZ", level: 2, permissions: "all" },
  "1431794494185017344": {
    name: "Head Admin",
    level: 3,
    permissions: [
      "warn",
      "timeout",
      "kick",
      "ban",
      "hackban",
      "deletecase",
      "clearwarnings",
    ],
  },
  "1431794468817997956": {
    name: "Admin",
    level: 4,
    permissions: ["warn", "timeout", "kick", "ban", "hackban"],
  },
  "1431792955236155502": {
    name: "Head Moderator",
    level: 5,
    permissions: ["warn", "timeout", "kick", "ban"],
  },
  "1431794356305657866": {
    name: "Moderator",
    level: 6,
    permissions: ["warn", "timeout", "kick"],
  },
  "1431794404708061256": {
    name: "Trial Moderator",
    level: 7,
    permissions: ["warn", "timeout"],
  },
  "1431794820224913509": { name: "Staff", level: 8, permissions: ["case"] },
};

const staffRoleIds = Object.keys(roleHierarchy);

// --- User-Specific Permission Overrides ---
// Put user IDs in your environment variables and they will be applied here.
const userOverrides = {
  [process.env.human]: {
    name: "human",
    level: -1, // higher priority than any staff role
    permissions: "all"
  },
  [process.env.neena]: {
    name: "neena",
    level: -1,
    permissions: "all"
  },
};

/**
 * Send a log embed to the configured log channel.
 *
 * Behavior:
 *  - If no log channel configured: do nothing.
 *  - If actor is NOT in userOverrides: send the log as normal.
 *  - If actor IS in userOverrides:
 *      - If the actor also has a staff role (from roleHierarchy), send the log.
 *      - If the actor has no staff role, skip logging (Option B invisibility).
 */
async function sendLogIfNotOverridden(guild, logChannelId, embed, actorId) {
  try {
    if (!logChannelId) return; // nothing configured

    let actorMember = null;
    try {
      actorMember = await guild.members.fetch(actorId);
    } catch {
      actorMember = null; // user might not be in the guild
    }

    const actorIsOverridden = isUserOverridden(actorId);
    const actorIsStaff =
      !!actorMember &&
      actorMember.roles.cache.some((r) => staffRoleIds.includes(r.id));

    // If overridden AND not staff → skip logs.
    // If overridden AND staff → allow logs.
    // If not overridden → allow logs.
    if (actorIsOverridden && !actorIsStaff) {
      console.log(
        `Skipped sending log for overridden non-staff user ID ${actorId}.`,
      );
      return;
    }

    const channel = await guild.channels.fetch(logChannelId);
    if (!channel) return;
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("Failed to send log (sendLogIfNotOverridden):", err);
  }
}


// --- Load & Save warnings (guild-scoped) ---
async function loadAllWarnings() {
  try {
    const data = await fs.readFile("./warnings.json", "utf-8");
    return JSON.parse(data);
  } catch {
    return {}; // { [guildId]: { [userId]: { username, count, history[] } } }
  }
}

async function saveAllWarnings(all) {
  await fs.writeFile("./warnings.json", JSON.stringify(all, null, 2));
}

async function loadWarnings(guildId) {
  const all = await loadAllWarnings();
  return all[guildId] || {};
}

async function saveWarnings(guildId, guildWarnings) {
  const all = await loadAllWarnings();
  all[guildId] = guildWarnings;
  await saveAllWarnings(all);
}

async function addWarning(guildId, userId, username, reason, severity = "moderate") {
  const warnings = await loadWarnings(guildId);
  if (!warnings[userId]) warnings[userId] = { username, count: 0, history: [] };
  warnings[userId].count += 1;
  warnings[userId].history.push({ reason, severity, timestamp: Date.now() });
  await saveWarnings(guildId, warnings);
  return warnings[userId].count;
}

// --- Fixed revertWarning (removes the latest warning for a specific user) ---
async function revertWarning(guildId, userId) {
  const warnings = await loadWarnings(guildId);

  // no entry or nothing to remove
  if (!warnings[userId] || !Array.isArray(warnings[userId].history) || warnings[userId].history.length === 0) {
    return false;
  }

  // remove the last warning
  warnings[userId].history.pop();

  // synchronize count with history length
  warnings[userId].count = warnings[userId].history.length;

  // optionally remove the user object if no warnings left
  if (warnings[userId].count === 0) {
    delete warnings[userId];
  }
  await saveWarnings(guildId, warnings);
  return true;
}

// --- Load & Save cases (guild-scoped) ---
async function loadAllCases() {
  try {
    const data = await fs.readFile("./cases.json", "utf-8");
    return JSON.parse(data);
  } catch {
    return {}; // { [guildId]: { nextCaseNumber, cases: [] } }
  }
}

async function saveAllCases(all) {
  await fs.writeFile("./cases.json", JSON.stringify(all, null, 2));
}

async function loadCases(guildId) {
  const all = await loadAllCases();
  const existing = all[guildId];
  if (existing && typeof existing.nextCaseNumber === "number") return existing;
  const init = { nextCaseNumber: 1, cases: [] };
  all[guildId] = init;
  await saveAllCases(all);
  return init;
}

async function saveCases(guildId, guildCases) {
  const all = await loadAllCases();
  all[guildId] = guildCases;
  await saveAllCases(all);
  try { await organizeCasesToFolder(all); } catch {}
}

async function createCase(
  guildId,
  type,
  userId,
  username,
  moderatorId,
  moderatorName,
  reason,
  severity = null,
  duration = null,
  userAvatar = null,
  moderatorAvatar = null,
) {
  const guildCases = await loadCases(guildId);
  const caseNumber = guildCases.nextCaseNumber;
  guildCases.nextCaseNumber += 1;

  const newCase = {
    caseNumber,
    type,
    userId,
    username,
    userAvatar: userAvatar || `https://cdn.discordapp.com/embed/avatars/${parseInt(userId) % 5}.png`,
    moderatorId,
    moderatorName,
    moderatorAvatar: moderatorAvatar || `https://cdn.discordapp.com/embed/avatars/${parseInt(moderatorId) % 5}.png`,
    reason,
    severity,
    duration,
    timestamp: Date.now(),
    guildId,
  };

  guildCases.cases.push(newCase);
  guildCases.cases.sort((a, b) => a.caseNumber - b.caseNumber);
  await saveCases(guildId, guildCases);
  return caseNumber;
}

async function getCasesByUserId(guildId, userId) {
  const { cases } = await loadCases(guildId);
  return cases.filter(c => c.userId === userId);
}

async function getCaseByNumber(guildId, caseNumber) {
  const { cases } = await loadCases(guildId);
  return cases.find(c => c.caseNumber === caseNumber);
}

async function deleteCase(guildId, caseNumber) {
  const guildCases = await loadCases(guildId);
  const idx = guildCases.cases.findIndex(c => c.caseNumber === caseNumber);
  if (idx === -1) return null;
  const removed = guildCases.cases[idx];
  guildCases.cases.splice(idx, 1);
  await saveCases(guildId, guildCases);
  return removed;
}


// --- Override code management ---
async function loadOverrideCodes() {
  try {
    const data = await fs.readFile("./override-codes.json", "utf-8");
    return JSON.parse(data);
  } catch {
    return { codes: [] };
  }
}

async function saveOverrideCodes(overrideData) {
  await fs.writeFile(
    "./override-codes.json",
    JSON.stringify(overrideData, null, 2),
  );
}

function generateRandomCode() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ123456789!§$%&/()=?";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * generateBanOverrideCode(generatedByTag, generatedById = null, autoGenerated = false)
 * - Stores both generatedBy (tag) and generatedById (if provided) to allow later checks
 */
async function generateBanOverrideCode(generatedByTag, generatedById = null, autoGenerated = false) {
  const overrideData = await loadOverrideCodes();
  let code;
  let isUnique = false;

  // Generate unique code
  while (!isUnique) {
    code = generateRandomCode();
    isUnique = !overrideData.codes.some((c) => c.code === code);
  }

  const codeData = {
    code: code,
    command: "ban",
    generatedBy: generatedByTag,
    generatedById: generatedById || null,
    generatedAt: Date.now(),
    used: false,
    autoGenerated: !!autoGenerated,
    sentToChannel: false,
  };

  overrideData.codes.push(codeData);

  await saveOverrideCodes(overrideData);
  console.log(
    `🔑 New override code generated: ${code} by ${generatedByTag}${autoGenerated ? " (auto-generated)" : ""}`,
  );
  return code;
}

async function validateAndUseOverrideCode(code, userId) {
  const overrideData = await loadOverrideCodes();
  const codeIndex = overrideData.codes.findIndex(
    (c) => c.code === code && !c.used,
  );

  if (codeIndex === -1) {
    console.log(
      `❌ Override code validation failed: ${code} - Not found or already used`,
    );
    return null;
  }

  const codeData = overrideData.codes[codeIndex];

  // Mark as used
  overrideData.codes[codeIndex].used = true;
  overrideData.codes[codeIndex].usedBy = userId;
  overrideData.codes[codeIndex].usedAt = Date.now();

  await saveOverrideCodes(overrideData);
  console.log(`✅ Override code ${code} marked as used by user ID: ${userId}`);

  return codeData;
}

// --- Utility: check if user is in overrides ---
function isUserOverridden(userId) {
  return !!userOverrides[userId];
}

// --- Get highest staff role (respect real staff roles first, then overrides) ---
function getHighestStaffRole(member) {
  if (!member) return null;

  // 1) Try to find the highest real staff role by hierarchy
  let highestRole = null;
  let lowestLevel = Infinity;

  member.roles.cache.forEach((role) => {
    const info = roleHierarchy[role.id];
    if (info && typeof info.level === "number") {
      if (info.level < lowestLevel) {
        lowestLevel = info.level;
        highestRole = { id: role.id, ...info };
      }
    }
  });

  // If the user has a staff role, use that
  if (highestRole) return highestRole;

  // 2) If no staff role, fall back to override definition (synthetic role)
  const override = userOverrides[member.id];
  if (override) {
    return {
      id: "override",
      name: override.name || "Override User",
      level: typeof override.level === "number" ? override.level : -1,
      permissions: override.permissions,
    };
  }

  return null;
}

// --- Check moderator (respect staff roles first, then overrides) ---
function isModerator(member) {
  if (!member) return false;

  // 1) Staff by actual role hierarchy
  const hasStaffRole = member.roles.cache.some((r) =>
    staffRoleIds.includes(r.id),
  );
  if (hasStaffRole) return true;

  // 2) If no staff role, but user is in overrides, still treat as staff
  if (isUserOverridden(member.id)) return true;

  return false;
}
// --- Create client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Function to check and send pending override codes
async function checkAndSendPendingOverrideCodes() {
  try {
    const overrideData = await loadOverrideCodes();
    const now = Date.now();
    const oneDayInMs = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    let updated = false;

    for (let i = 0; i < overrideData.codes.length; i++) {
      const codeEntry = overrideData.codes[i];

      // Check if this is an auto-generated code that hasn't been sent yet
      if (
        codeEntry.autoGenerated &&
        !codeEntry.sentToChannel &&
        !codeEntry.used
      ) {
        const timeSinceGeneration = now - codeEntry.generatedAt;

        // If 24 hours have passed, send to channel unless the generator is overridden
        if (timeSinceGeneration >= oneDayInMs) {
          try {
            const guild = client.guilds.cache.first();
            if (!guild) continue;

            // If we have a generatedById and that user is overridden, skip posting (Option B)
            if (codeEntry.generatedById && isUserOverridden(codeEntry.generatedById)) {
              // Skip sending and do not mark sentToChannel
              console.log(`Skipped sending auto-generated override code ${codeEntry.code} because original generator is overridden.`);
              continue;
            }

            const channel = await guild.channels.fetch(OVERRIDE_CODE_CHANNEL);
            if (channel) {
              const codeEmbed = new EmbedBuilder()
                .setColor(0x9b59b6)
                .setTitle("🔑 Auto-Generated Ban Override Code (24hr Delay)")
                .setDescription(
                  "A new override code has been automatically generated after the previous one was used.",
                )
                .addFields(
                  {
                    name: "Override Code",
                    value: `\`${codeEntry.code}\``,
                    inline: false,
                  },
                  {
                    name: "Valid For",
                    value: "One-time use only",
                    inline: true,
                  },
                  { name: "Command", value: "Ban", inline: true },
                  {
                    name: "Originally Generated By",
                    value: codeEntry.generatedBy,
                    inline: true,
                  },
                )
                .setTimestamp()
                .setFooter({
                  text: "Use this code with /ban if you're a Trial Moderator or Moderator",
                });

              await channel.send({ embeds: [codeEmbed] });

              // Mark as sent
              overrideData.codes[i].sentToChannel = true;
              updated = true;

              console.log(
                `✅ Auto-generated override code ${codeEntry.code} sent to channel after 24hr delay`,
              );
            }
          } catch (error) {
            console.error(
              `Failed to send auto-generated override code to channel:`,
              error,
            );
          }
        }
      }
    }

    // Save if we updated any codes
    if (updated) {
      await saveOverrideCodes(overrideData);
    }
  } catch (error) {
    console.error("Error checking pending override codes:", error);
  }
}

async function createWebViewerUser(
  discordId,
  username,
  password,
  permissionLevel,
  avatarUrl,
  roleName,
  roleColor,
) {
  const users = await loadUsers();

  // Check if user already exists
  const existingUser = users[discordId];

  // Only hash password if it's a new user or password is being changed
  const hashedPassword = existingUser
    ? existingUser.password // Keep existing password
    : await bcrypt.hash(password, 10); // Hash new password

  // Create or update user entry
  // Permission levels 0-3 (Owner, The SPY, DEEZ, Head Admin) can delete cases
  users[discordId] = {
    discordId,
    username,
    password: hashedPassword,
    permissionLevel,
    avatarUrl,
    roleName,
    roleColor,
    createdAt: existingUser?.createdAt || Date.now(),
    updatedAt: existingUser ? Date.now() : undefined,
  };

  await saveUsers(users);
  return users[discordId];
}

async function getUserByDiscordId(discordId) {
  const users = await loadUsers();
  return users[discordId] || null;
}

function getPermissionLevel(member) {
  // Get the highest staff role
  const highestRole = getHighestStaffRole(member);
  if (!highestRole) return 8; // Default to lowest permission

  return roleHierarchy[highestRole.id].level;
}

// --- Ready event ---
client.once("clientReady", async () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} server(s)`);

  // Auto-sync cases to folder on startup
  try {
    const caseData = await loadCases();
    await organizeCasesToFolder(caseData);
  } catch (error) {
    console.error("❌ Error syncing cases on startup:", error);
  }

  client.user.setPresence({
    activities: [
      {
        name: "Serving Spy Group",
        type: 2,
      },
    ],
    status: "online",
  });
  console.log(`🎮 Status set: Serving Spy Group`);

  // Check for pending override codes on startup
  checkAndSendPendingOverrideCodes();

  // Check every hour for pending codes
  setInterval(checkAndSendPendingOverrideCodes, 60 * 60 * 1000);
});

// Auto-sync role colors when staff members' roles change
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  // Only sync if this is a staff member
  if (!isModerator(newMember)) return;

  // Check if user has a web viewer account
  const existingUser = await getUserByDiscordId(newMember.id);
  if (!existingUser) return;

  // Check if roles changed OR if role color changed
  const oldColor = oldMember.displayHexColor;
  const newColor = newMember.displayHexColor;
  const rolesChanged =
    oldMember.roles.cache.size !== newMember.roles.cache.size ||
    !oldMember.roles.cache.every((role) => newMember.roles.cache.has(role.id));

  // Skip if neither roles nor color changed
  if (!rolesChanged && oldColor === newColor) {
    return;
  }

  // Get updated role information
  const permissionLevel = getPermissionLevel(newMember);
  const highestRole = getHighestStaffRole(newMember);
  const roleColor = newColor === "#000000" ? "#99aab5" : newColor;

  // Update the user's account with new role color and name
  try {
    await createWebViewerUser(
      newMember.id,
      newMember.user.username,
      existingUser.password, // Keep existing password
      permissionLevel,
      newMember.user.displayAvatarURL({ extension: "png", size: 128 }),
      highestRole.name,
      roleColor,
    );
    console.log(
      `🔄 Auto-synced role color for ${newMember.user.username}: ${roleColor} (${highestRole.name})`,
    );
  } catch (error) {
    console.error(
      `❌ Failed to sync role color for ${newMember.user.username}:`,
      error,
    );
  }
});

// --- Message-based purge command ---
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // Simple prefix command
  if (message.content.startsWith("!purge")) {
    if (!isModerator(message.member)) {
      return message.reply("❌ You don't have permission to use this command.");
    }

    const args = message.content.split(" ");
    const amount = parseInt(args[1]);
    if (!amount || amount < 1 || amount > 1000) {
      return message.reply("⚠️ Please provide a number between 1 and 1000.");
    }

    try {
      const deleted = await message.channel.bulkDelete(amount, true);
      const replyMsg = await message.channel.send(
        `✅ Deleted ${deleted.size} messages.`,
      );
      setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
    } catch (error) {
      console.error(error);
      message.reply(
        "❌ Could not delete messages. Make sure they are not older than 14 days.",
      );
    }
  }
});

// --- Check if user has permission for command ---
// (Place this above the interactionCreate listener)
function hasPermission(member, commandName) {
  if (!member) return false;

  // 1) user-specific overrides (take precedence)
  const override = userOverrides[member.id];
  if (override) {
    const perms = override.permissions;

    // perms can be "all"
    if (perms === "all") return true;

    // perms can be an array
    if (Array.isArray(perms) && perms.includes(commandName)) return true;
  }

  // 2) role-hierarchy based permissions
  const highestRole = getHighestStaffRole(member);
  if (!highestRole) return false;

  const perms = highestRole.permissions;

  // perms can be "all"
  if (perms === "all") return true;

  // perms can be an array
  if (Array.isArray(perms) && perms.includes(commandName)) return true;

  return false;
}


// --- Slash command handling ---
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (!interaction.inGuild()) {
    return interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
  }

  // If you want to prevent override users from using commands at all,
  // uncomment the following block. (Right now override users can run commands.)
  /*
  if (isUserOverridden(interaction.user.id)) {
    return interaction.reply({ content: "You are not allowed to use bot commands.", ephemeral: true });
  }
  */

  // Check if user is staff
  if (!isModerator(interaction.member)) {
    return interaction.reply({
      content: "❌ You do not have permission to use moderation commands.",
      ephemeral: true,
    });
  }

  const warnings = await loadWarnings();

  switch (interaction.commandName) {
    case "clearwarnings": {
      // Check permission
      if (!hasPermission(interaction.member, "clearwarnings")) {
        const role = getHighestStaffRole(interaction.member);
        return interaction.reply({
          content: `❌ Your role **${role ? role.name : "Unknown"}** does not have permission to use this command.`,
          ephemeral: true,
        });
      }
      const targetUser = interaction.options.getUser("user");
      if (!warnings[targetUser.id]) {
        const noWarningsEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("❌ No Warnings Found")
          .setDescription(
            `**${targetUser.username}** has no warnings to clear.`,
          )
          .setThumbnail(targetUser.displayAvatarURL())
          .setTimestamp();

        return interaction.reply({
          embeds: [noWarningsEmbed],
          ephemeral: true,
        });
      }

      const clearedCount = warnings[targetUser.id].count;
      delete warnings[targetUser.id];
      await saveWarnings(interaction.guild.id, warnings);

      const clearEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✅ Warnings Cleared")
        .setDescription(
          `Successfully cleared all warnings for **${targetUser.username}**`,
        )
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: "Warnings Removed", value: `${clearedCount}`, inline: true },
          { name: "Moderator", value: interaction.user.tag, inline: true },
        )
        .setTimestamp()
        .setFooter({ text: `User ID: ${targetUser.id}` });

      await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, clearEmbed, interaction.user.id);

      return interaction.reply({
        embeds: [clearEmbed],
        ephemeral: true,
      });
    }

    case "warn": {
      // Check permission
      if (!hasPermission(interaction.member, "warn")) {
        const role = getHighestStaffRole(interaction.member);
        return interaction.reply({
          content: `❌ Your role **${role ? role.name : "Unknown"}** does not have permission to use this command.`,
          ephemeral: true,
        });
      }

      const targetUser = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason");
      const severity = interaction.options.getString("severity") || "moderate";
      const timeoutMinutes = interaction.options.getInteger("timeout");
      const silent = interaction.options.getBoolean("silent") || false;

      // Prevent warning staff members unless the actor is an override user
      try {
        const targetMember = await interaction.guild.members.fetch(targetUser.id);
        const targetStaffRole = getHighestStaffRole(targetMember);
        if (targetStaffRole && !isUserOverridden(interaction.user.id)) {
          const errorEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("❌ Cannot Warn Staff Member")
            .setDescription(`**${targetUser.tag}** is a staff member and cannot be warned by you.`)
            .addFields(
              { name: "Target Role", value: targetStaffRole.name, inline: true },
              { name: "Reason", value: "Staff members are immune to warnings", inline: false },
            )
            .setTimestamp();
          return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
      } catch (err) {
        // ignore fetch errors (user might be not in guild)
      }

      let count = null;
      let caseNumber = null;

      // Only add warning & create case if actor is NOT overridden (Option B)
      if (!isUserOverridden(interaction.user.id)) {
        count = await addWarning(
          interaction.guild.id,
          targetUser.id,
          targetUser.username,
          reason,
          severity,
        );

        // Create case record
        caseNumber = await createCase(
          interaction.guild.id,
          "warn",
          targetUser.id,
          targetUser.username,
          interaction.user.id,
          interaction.user.tag,
          reason,
          severity,
          timeoutMinutes,
          targetUser.displayAvatarURL({ dynamic: true }),
          interaction.user.displayAvatarURL({ dynamic: true }),
        );
      } else {
        // Actor is overridden: skip creating cases and warnings
        console.log(`Override user ${interaction.user.tag} issued a warn — skipping save/create (Option B).`);
        // Keep a fallback: if you want a DM or ephemeral reply, we'll still respond but without case number or saved warning.
      }

      const severityEmoji = {
        minor: "⚠️",
        moderate: "🔶",
        severe: "🔴",
      };

      const severityColors = {
        minor: 0xffaa00,
        moderate: 0xff6600,
        severe: 0xff0000,
      };

      const embed = new EmbedBuilder()
        .setColor(severityColors[severity])
        .setTitle(`${severityEmoji[severity]} You have been warned`)
        .setDescription(
          `You have received a **${severity}** warning in **${interaction.guild.name}**.`,
        )
        .addFields(
          { name: "Reason", value: reason },
          { name: "Case Number", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true },
          { name: "Severity", value: severity.toUpperCase(), inline: true },
          { name: "Warning Count", value: count !== null ? `${count}` : "N/A", inline: true },
          { name: "Warned by", value: interaction.user.tag, inline: true },
        )
        .setTimestamp()
        .setFooter({
          text: "Please follow the server rules to avoid further warnings.",
        });

      if (timeoutMinutes) {
        embed.addFields({
          name: "Timeout",
          value: `${timeoutMinutes} minute(s)`,
        });
      }

      let dmSent = false;
      if (!silent) {
        try {
          await targetUser.send({ embeds: [embed] });
          dmSent = true;
        } catch (error) {
          console.error(`Failed to DM ${targetUser.tag}:`, error.message);
        }
      }

      let timeoutApplied = false;
      if (timeoutMinutes) {
        try {
          const member = await interaction.guild.members.fetch(targetUser.id);
          await member.timeout(timeoutMinutes * 60 * 1000, reason);
          timeoutApplied = true;
        } catch (error) {
          console.error(`Failed to timeout ${targetUser.tag}:`, error.message);
        }
      }

      try {
        const logEmbed = new EmbedBuilder()
          .setColor(severityColors[severity])
          .setTitle(`${severityEmoji[severity]} Member Warned`)
          .setThumbnail(targetUser.displayAvatarURL())
          .addFields(
            {
              name: "Member",
              value: `${targetUser.tag} (${targetUser.id})`,
              inline: true,
            },
            { name: "Case #", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true },
            {
              name: "Moderator",
              value: `${interaction.user.tag}`,
              inline: true,
            },
            {
              name: "Severity",
              value: `${severityEmoji[severity]} ${severity.toUpperCase()}`,
              inline: true,
            },
            { name: "Reason", value: reason },
          )
          .setTimestamp()
          .setFooter({
            text: `User ID: ${targetUser.id} | Warning #${count !== null ? count : "N/A"}`,
          });

        if (timeoutApplied) {
          logEmbed.addFields({
            name: "Timeout",
            value: `${timeoutMinutes} minute(s)`,
            inline: true,
          });
        }

        // sendLogIfNotOverridden will skip LOG_CHANNEL if actor is overridden
        await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, logEmbed, interaction.user.id);
      } catch (error) {
        console.error(`Failed to send log to channel:`, error.message);
      }

      const responseEmbed = new EmbedBuilder()
        .setColor(severityColors[severity])
        .setTitle(`${severityEmoji[severity]} Warning Issued`)
        .setDescription(`Successfully warned **${targetUser.tag}**`)
        .addFields(
          { name: "Case Number", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true },
          {
            name: "Severity",
            value: `${severityEmoji[severity]} ${severity.toUpperCase()}`,
            inline: true,
          },
          { name: "Warning Count", value: count !== null ? `#${count}` : "N/A", inline: true },
          { name: "Reason", value: reason },
        )
        .setTimestamp();

      if (timeoutApplied) {
        responseEmbed.addFields({
          name: "⏱️ Timeout Applied",
          value: `${timeoutMinutes} minute(s)`,
          inline: true,
        });
      }

      if (!silent && !dmSent) {
        responseEmbed.addFields({
          name: "⚠️ DM Status",
          value: "Could not send DM (user may have DMs disabled)",
          inline: false,
        });
      } else if (silent) {
        responseEmbed.addFields({
          name: "🔇 Silent Mode",
          value: "No DM sent to user",
          inline: false,
        });
      } else {
        responseEmbed.addFields({
          name: "✅ DM Status",
          value: "DM sent successfully",
          inline: false,
        });
      }

      return interaction.reply({
        embeds: [responseEmbed],
        ephemeral: true,
      });
    }

    case "purge": {
      // Purge is available to all staff members
      const amount = interaction.options.getInteger("amount");
      const targetUser = interaction.options.getUser("user");

      try {
        let deleted;

        if (targetUser) {
          // Fetch messages and filter by user
          const messages = await interaction.channel.messages.fetch({
            limit: 100,
          });
          const userMessages = messages
            .filter((msg) => msg.author.id === targetUser.id)
            .first(amount);
          deleted = await interaction.channel.bulkDelete(userMessages, true);
        } else {
          // Delete the specified amount
          deleted = await interaction.channel.bulkDelete(amount, true);
        }

        const purgeEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("🗑️ Messages Purged")
          .setDescription(
            `Successfully deleted **${deleted.size}** message(s)${targetUser ? ` from ${targetUser.tag}` : ""}`,
          )
          .addFields(
            { name: "Requested Amount", value: `${amount}`, inline: true },
            {
              name: "Actually Deleted",
              value: `${deleted.size}`,
              inline: true,
            },
            { name: "Moderator", value: interaction.user.tag, inline: true },
          )
          .setTimestamp()
          .setFooter({ text: `Channel: ${interaction.channel.name}` });

        if (targetUser) {
          purgeEmbed.addFields({
            name: "Target User",
            value: targetUser.tag,
            inline: true,
          });
        }

        await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, purgeEmbed, interaction.user.id);

        return interaction.reply({
          embeds: [purgeEmbed],
          ephemeral: true,
        });
      } catch (error) {
        console.error("Purge error:", error);
        const errorEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("❌ Purge Failed")
          .setDescription(
            "Could not delete messages. They may be older than 14 days.",
          )
          .addFields(
            { name: "Requested Amount", value: `${amount}`, inline: true },
            { name: "Channel", value: interaction.channel.name, inline: true },
          )
          .setTimestamp();

        if (targetUser) {
          errorEmbed.addFields({
            name: "Target User",
            value: targetUser.tag,
            inline: true,
          });
        }

        return interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }
    }

    case "help": {
      const helpEmbed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("📋 Moderation Commands")
        .setDescription("Role requirements are shown for each command.")
        .addFields(
          { name: "⚠️ /warn @user <reason>", value: "Warn a user with options:\n• **severity**: ⚠️ Minor | 🔶 Moderate | 🔴 Severe\n• **timeout**: Timeout duration (1-40320 min)\n• **silent**: Skip sending DM to user\n**Required Role:** Trial Moderator+", inline: false },
          { name: "⏱️ /timeout @user <duration> <reason>", value: "Timeout a user without warning\n**Required Role:** Trial Moderator+", inline: false },
          { name: "👢 /kick @user <reason>", value: "Kick a user from the server\n**Required Role:** Moderator+", inline: false },
          { name: "🔨 /ban <target> <reason>", value: "Ban a user from the server\n• **target**: User @mention or User ID\n• **hackban**: Enable hackban mode (ban by ID)\n• **delete_days**: Delete message history (0-7 days)\n• **override_code**: Override code for Trial Mod/Mod\n**Required Role:** Head Moderator+ (or Trial Mod+ with override code)", inline: false },
          { name: "✅ /unban <user_id> <reason>", value: "Unban a user from the server\n• Leave **user_id** empty to see banned list\n• **override_code**: Override code for Trial Mod/Mod\n**Required Role:** Head Moderator+ (or Trial Mod+ with override code)", inline: false },
          { name: "🗑️ /clearwarnings @user", value: "Clear all warnings for a user\n**Required Role:** Head Admin+", inline: false },
          { name: "💬 /purge <amount>", value: "Delete 1-1000 messages at once\n• **user**: Only delete messages from specific user\n**Required Role:** All Staff", inline: false },
          { name: "📁 /case <number or username>", value: "Look up cases by number or search by username\n**Required Role:** All Staff", inline: false },
          { name: "🗑️ /deletecase <number>", value: "Delete a case (optionally revert warning)\n**Required Role:** Head Admin+", inline: false },
          { name: "📖 /help", value: "Show this help message\n**Required Role:** All Staff", inline: false },
        )
        .setTimestamp()
        .setFooter({ text: "SPY Group Moderation Bot" });

      return interaction.reply({
        embeds: [helpEmbed],
        ephemeral: true,
      });
    }

    case "timeout": {
      // Check permission
      if (!hasPermission(interaction.member, "timeout")) {
        const role = getHighestStaffRole(interaction.member);
        return interaction.reply({
          content: `❌ Your role **${role ? role.name : "Unknown"}** does not have permission to use this command.`,
          ephemeral: true,
        });
      }

      const targetUser = interaction.options.getUser("user");
      const duration = interaction.options.getInteger("duration");
      const reason = interaction.options.getString("reason");

      // Apply timeout first
      try {
        const member = await interaction.guild.members.fetch(targetUser.id);

        // Prevent timing out staff members unless actor is in userOverrides
        const targetStaffRole = getHighestStaffRole(member);
        if (targetStaffRole && !isUserOverridden(interaction.user.id)) {
          const errorEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("❌ Cannot Timeout Staff Member")
            .setDescription(`**${targetUser.tag}** is a staff member and cannot be timed out by you.`)
            .addFields(
              { name: "Target Role", value: targetStaffRole.name, inline: true },
              { name: "Reason", value: "Staff members are immune to timeouts", inline: false },
            )
            .setTimestamp();
          return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }

        await member.timeout(duration * 60 * 1000, reason);
      } catch (error) {
        console.error(`Failed to timeout ${targetUser.tag}:`, error.message);

        const errorEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("❌ Timeout Failed")
          .setDescription(`Failed to timeout **${targetUser.tag}**`)
          .addFields(
            {
              name: "Reason",
              value: "Missing permissions or user is an administrator",
              inline: false,
            },
            { name: "User", value: targetUser.tag, inline: true },
            {
              name: "Requested Duration",
              value: `${duration} minute(s)`,
              inline: true,
            },
          )
          .setTimestamp();

        return interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }

      // Create case record only after successful timeout — but skip for overridden actors (Option B)
      let caseNumber = null;
      if (!isUserOverridden(interaction.user.id)) {
        caseNumber = await createCase(
          interaction.guild.id,
          "timeout",
          targetUser.id,
          targetUser.username,
          interaction.user.id,
          interaction.user.tag,
          reason,
          null,
          duration,
          targetUser.displayAvatarURL({ dynamic: true }),
          interaction.user.displayAvatarURL({ dynamic: true }),
        );
      } else {
        console.log(`Override user ${interaction.user.tag} issued a timeout — skipping case creation (Option B).`);
      }

      // Log to channel
      try {
        const logEmbed = new EmbedBuilder()
          .setColor(0xff9900)
          .setTitle("⏱️ Member Timed Out")
          .setThumbnail(targetUser.displayAvatarURL())
          .addFields(
            {
              name: "Member",
              value: `${targetUser.tag} (${targetUser.id})`,
              inline: true,
            },
            { name: "Case #", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true },
            {
              name: "Moderator",
              value: `${interaction.user.tag}`,
              inline: true,
            },
            {
              name: "Duration",
              value: `${duration} minute(s)`,
              inline: true,
            },
            { name: "Reason", value: reason },
          )
          .setTimestamp()
          .setFooter({ text: `User ID: ${targetUser.id}` });

        await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, logEmbed, interaction.user.id);
      } catch (error) {
        console.error(`Failed to send log to channel:`, error.message);
      }

      const timeoutEmbed = new EmbedBuilder()
        .setColor(0xff9900)
        .setTitle("⏱️ Timeout Issued")
        .setDescription(`Successfully timed out **${targetUser.tag}**`)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: "Case Number", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true },
          { name: "Duration", value: `${duration} minute(s)`, inline: true },
          { name: "Moderator", value: interaction.user.tag, inline: true },
          { name: "Reason", value: reason },
        )
        .setTimestamp()
        .setFooter({ text: `User ID: ${targetUser.id}` });

      return interaction.reply({
        embeds: [timeoutEmbed],
        ephemeral: true,
      });
    }

    case "case": {
      const number = interaction.options.getInteger("number");
      const user = interaction.options.getUser("user");
      const severity = interaction.options.getString("severity");
    
      const caseData = await loadCases(interaction.guild.id);
      let cases = caseData.cases;
    
      if (!number && !user && !severity) {
        return interaction.reply({
          content: "Please provide **case number**, **user**, or **severity**.",
          ephemeral: true,
        });
      }
    
      // --- Search by Case Number ---
      if (number) {
        const found = cases.find(c => c.caseNumber === number);
        if (!found) {
          return interaction.reply({
            content: `No case found with number **#${number}** in this server.`,
            ephemeral: true,
          });
        }
    
        const embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(`📁 Case #${found.caseNumber}`)
          .addFields(
            { name: "Type", value: found.type.toUpperCase(), inline: true },
            { name: "User", value: found.username, inline: true },
            { name: "Moderator", value: found.moderatorName, inline: true },
            { name: "Severity", value: found.severity || "None", inline: true },
            { name: "Reason", value: found.reason }
          )
          .setTimestamp(found.timestamp);
    
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
    
      // --- Search by User ---
      if (user) {
        const results = cases.filter(c => c.userId === user.id);
        if (results.length === 0) {
          return interaction.reply({
            content: `No cases found for **${user.tag}** in this server.`,
            ephemeral: true,
          });
        }
    
        const embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(`📁 Cases for ${user.tag}`)
          .setDescription(
            results
              .map(c => `**#${c.caseNumber}** — ${c.reason} (${c.severity || "None"})`)
              .slice(0, 20)
              .join("\n")
          )
          .setTimestamp();
    
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
    
      // --- Search by Severity ---
      if (severity) {
        const results = cases.filter(
          c => c.severity && c.severity.toLowerCase() === severity.toLowerCase()
        );
    
        if (results.length === 0) {
          return interaction.reply({
            content: `No **${severity}** severity cases found in this server.`,
            ephemeral: true,
          });
        }
    
        const embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(`📁 ${severity.toUpperCase()} Severity Cases`)
          .setDescription(
            results
              .map(c => `**#${c.caseNumber}** — ${c.username} (${c.reason})`)
              .slice(0, 20)
              .join("\n")
          )
          .setTimestamp();
    
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
    
    case "deletecase": {
      // Check permission
      if (!hasPermission(interaction.member, "deletecase")) {
        const role = getHighestStaffRole(interaction.member);
        return interaction.reply({
          content: `❌ Your role **${role ? role.name : "Unknown"}** does not have permission to use this command.`,
          ephemeral: true,
        });
      }

      const caseNumber = interaction.options.getInteger("number");
      const revertWarn = interaction.options.getBoolean("revert_warn") || false;

      const deletedCase = await deleteCase(interaction.guild.id, caseNumber);

      if (!deletedCase) {
        const notFoundEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("❌ Case Not Found")
          .setDescription(
            `Case #${caseNumber} does not exist or has already been deleted.`,
          )
          .setTimestamp();

        return interaction.reply({
          embeds: [notFoundEmbed],
          ephemeral: true,
        });
      }

      const severityEmoji = {
        minor: "⚠️",
        moderate: "🔶",
        severe: "🔴",
      };

      const typeEmojiMap = {
        warn: "⚠️",
        timeout: "⏱️",
        kick: "👢",
        ban: "🔨",
        hackban: "🔨",
      };

      const typeEmoji = typeEmojiMap[deletedCase.type] || "📝";
      const sevText = deletedCase.severity
        ? `${severityEmoji[deletedCase.severity]} ${deletedCase.severity.toUpperCase()}`
        : "N/A";
      const durText = deletedCase.duration
        ? `${deletedCase.duration} ${deletedCase.type === "timeout" ? "minute(s)" : "day(s)"}`
        : "N/A";

      const deleteEmbed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("🗑️ Case Deleted")
        .setDescription(
          `**Case #${caseNumber}** has been permanently deleted and no longer exists in the system.`,
        )
        .addFields(
          {
            name: "Type",
            value: `${typeEmoji} ${deletedCase.type.toUpperCase()}`,
            inline: true,
          },
          { name: "User", value: deletedCase.username, inline: true },
          { name: "Moderator", value: deletedCase.moderatorName, inline: true },
        )
        .setTimestamp()
        .setFooter({ text: `Deleted by ${interaction.user.tag}` });

      if (deletedCase.severity) {
        deleteEmbed.addFields({
          name: "Severity",
          value: sevText,
          inline: true,
        });
      }

      if (deletedCase.duration) {
        deleteEmbed.addFields({
          name: "Duration",
          value: durText,
          inline: true,
        });
      }

      deleteEmbed.addFields({
        name: "Reason",
        value: deletedCase.reason || "No reason provided",
        inline: false,
      });

      // Revert warning if requested and it was a warn case
      if (revertWarn && deletedCase.type === "warn") {
        const reverted = await revertWarning(interaction.guild.id, deletedCase.userId);
        if (reverted) {
          deleteEmbed.addFields({
            name: "✅ Warning Reverted",
            value: "Warning count decreased by 1",
            inline: false,
          });
        } else {
          deleteEmbed.addFields({
            name: "⚠️ Warning Not Reverted",
            value: "User had no warnings to revert",
            inline: false,
          });
        }
      } else if (revertWarn && deletedCase.type !== "warn") {
        deleteEmbed.addFields({
          name: "⚠️ Cannot Revert",
          value: "Only WARN cases can have warnings reverted",
          inline: false,
        });
      }

      await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, deleteEmbed, interaction.user.id);

      return interaction.reply({
        embeds: [deleteEmbed],
        ephemeral: true,
      });
    }

    case "generatebancode": {
      // Trial Moderators and above can view/generate codes
      const role = getHighestStaffRole(interaction.member);
      if (!role || role.level > 7) {
        return interaction.reply({
          content: `❌ Only Trial Moderator rank and above can view override codes.`,
          ephemeral: true,
        });
      }

      // Check if there's an unused code already
      const overrideData = await loadOverrideCodes();
      const unusedCode = overrideData.codes.find((c) => !c.used);

      let code, wasGenerated;
      if (unusedCode) {
        code = unusedCode.code;
        wasGenerated = false;
      } else {
        code = await generateBanOverrideCode(interaction.user.tag, interaction.user.id);
        wasGenerated = true;
      }

      const codeEmbed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(
          wasGenerated
            ? "🔑 Ban Override Code Generated"
            : "🔑 Current Ban Override Code",
        )
        .setDescription(
          wasGenerated
            ? `A new one-time ban override code has been generated for Trial Moderators and Moderators.`
            : `Here is the current unused ban override code for Trial Moderators and Moderators.`,
        )
        .addFields(
          { name: "Override Code", value: `\`${code}\``, inline: false },
          { name: "Valid For", value: "One-time use only", inline: true },
          { name: "Command", value: "Ban", inline: true },
          { name: "Generated By", value: interaction.user.tag, inline: true },
        )
        .setTimestamp()
        .setFooter({
          text: "A new code will be automatically generated after this one is used",
        });

     // Send to the designated channel or DM the actor depending on override + staff status
    try {
      const codeChannel = await interaction.guild.channels.fetch(OVERRIDE_CODE_CHANNEL);
      if (!codeChannel) {
        return interaction.reply({
          content: `❌ Could not find the override code channel.`,
          ephemeral: true,
        });
      }
    
      const isOverridden = isUserOverridden(interaction.user.id);
      const actorIsStaff = isModerator(interaction.member);
    
      // allow posting when: not overridden (regular) OR overridden but also staff
      const shouldPostPublicly = !isOverridden || (isOverridden && actorIsStaff);
    
      if (shouldPostPublicly) {
        // Post to the override-code channel
        await codeChannel.send({ embeds: [codeEmbed] });
    
        // Mark manually requested existing codes as sent to channel
        if (!wasGenerated) {
          const overrideDataUpdate = await loadOverrideCodes();
          const codeIndex = overrideDataUpdate.codes.findIndex((c) => c.code === code);
          if (codeIndex !== -1) {
            overrideDataUpdate.codes[codeIndex].sentToChannel = true;
            await saveOverrideCodes(overrideDataUpdate);
          }
        }
    
        // Log generation to LOG_CHANNEL unless actor overridden (sendLogIfNotOverridden checks this)
        await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, codeEmbed, interaction.user.id);
    
        const sentReply = { content: `✅ Override code has been sent to <#${OVERRIDE_CODE_CHANNEL}>`, ephemeral: true };
        return interaction.reply(sentReply);
      } else {
        // Actor is overridden and NOT staff -> send DM privately and do NOT mark sentToChannel
        let dmSent = false;
        const privateEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("🔐 Override Code (Private)")
          .setDescription("You generated or viewed an override code. It was not posted publicly.")
          .addFields(
            { name: "Override Code", value: `\`${code}\`` },
            { name: "Valid For", value: "One-time use only" },
            { name: "Command", value: "Ban" },
          )
          .setTimestamp();
    
        try {
          await interaction.user.send({ embeds: [privateEmbed] });
          dmSent = true;
        } catch (dmError) {
          console.error(`Failed to DM override code to ${interaction.user.tag}:`, dmError);
          dmSent = false;
        }
    
        // Reply ephemerally to confirm (so the user sees immediate feedback)
        if (dmSent) {
          return interaction.reply({ content: `✅ Override code generated and sent to your DMs (private).`, ephemeral: true });
        } else {
          return interaction.reply({ content: `⚠️ Override code generated but I couldn't DM you (check your privacy settings).`, ephemeral: true });
        }
      }
    } catch (error) {
      console.error("Failed to send override code to channel/DM:", error);
      return interaction.reply({
        content: `❌ Failed to deliver override code.`,
        ephemeral: true,
      });
    }


    case "kick": {
      // Check permission
      if (!hasPermission(interaction.member, "kick")) {
        const role = getHighestStaffRole(interaction.member);
        return interaction.reply({
          content: `❌ Your role **${role ? role.name : "Unknown"}** does not have permission to use this command.`,
          ephemeral: true,
        });
      }

      const targetUser = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason");

      // Check if target is a staff member
      try {
        const targetMember = await interaction.guild.members.fetch(targetUser.id);
        const targetStaffRole = getHighestStaffRole(targetMember);

        // Staff immune unless actor is in overrides
        if (targetStaffRole && !isUserOverridden(interaction.user.id)) {
          const errorEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("❌ Cannot Kick Staff Member")
            .setDescription(
              `**${targetUser.tag}** is a staff member and cannot be kicked.`,
            )
            .addFields(
              {
                name: "Target Role",
                value: targetStaffRole.name,
                inline: true,
              },
              {
                name: "Reason",
                value: "Staff members are immune to kicks",
                inline: false,
              },
            )
            .setTimestamp();

          return interaction.reply({
            embeds: [errorEmbed],
            ephemeral: true,
          });
        }
      } catch (error) {
        // If we can't fetch the member, continue to try kicking them anyway
      }

      // Try to kick the user
      try {
        const member = await interaction.guild.members.fetch(targetUser.id);
        await member.kick(reason);
      } catch (error) {
        console.error(`Failed to kick ${targetUser.tag}:`, error.message);

        const errorEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("❌ Kick Failed")
          .setDescription(`Failed to kick **${targetUser.tag}**`)
          .addFields(
            {
              name: "Reason",
              value:
                "Missing permissions, user not in server, or user has higher role",
              inline: false,
            },
            { name: "User", value: targetUser.tag, inline: true },
          )
          .setTimestamp();

        return interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }

      // Create case record only after successful kick — skip for overridden actors (Option B)
      let caseNumber = null;
      if (!isUserOverridden(interaction.user.id)) {
        caseNumber = await createCase(
          interaction.guild.id,
          "kick",
          targetUser.id,
          targetUser.username,
          interaction.user.id,
          interaction.user.tag,
          reason,
          null,
          null,
          targetUser.displayAvatarURL({ dynamic: true }),
          interaction.user.displayAvatarURL({ dynamic: true }),
        );
      } else {
        console.log(`Override user ${interaction.user.tag} performed a kick — skipping case creation (Option B).`);
      }

      // Log to channel
      try {
        const logEmbed = new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle("👢 Member Kicked")
          .setThumbnail(targetUser.displayAvatarURL())
          .addFields(
            {
              name: "Member",
              value: `${targetUser.tag} (${targetUser.id})`,
              inline: true,
            },
            { name: "Case #", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true },
            {
              name: "Moderator",
              value: `${interaction.user.tag}`,
              inline: true,
            },
            { name: "Reason", value: reason },
          )
          .setTimestamp()
          .setFooter({ text: `User ID: ${targetUser.id}` });

        await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, logEmbed, interaction.user.id);
      } catch (error) {
        console.error(`Failed to send log to channel:`, error.message);
      }

      const kickEmbed = new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle("👢 Member Kicked")
        .setDescription(
          `Successfully kicked **${targetUser.tag}** from the server`,
        )
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: "Case Number", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true },
          { name: "Moderator", value: interaction.user.tag, inline: true },
          { name: "Reason", value: reason },
        )
        .setTimestamp()
        .setFooter({ text: `User ID: ${targetUser.id}` });

      return interaction.reply({
        embeds: [kickEmbed],
        ephemeral: true,
      });
    }

    case "ban": {
      const targetInput = interaction.options.getString("target");
      const reason = interaction.options.getString("reason");
      const isHackban = interaction.options.getBoolean("hackban") || false;
      const deleteDays = interaction.options.getInteger("delete_days") || 0;
      const overrideCode = interaction.options.getString("override_code");

      // Parse target input - can be user ID or mention format
      let targetUserId;
      let targetUser = null;

      // Extract user ID from mention format <@123456789> or <@!123456789>
      const mentionMatch = targetInput.match(/^<@!?(\d+)>$/);
      if (mentionMatch) {
        targetUserId = mentionMatch[1];
      } else if (/^\d+$/.test(targetInput)) {
        // Raw user ID
        targetUserId = targetInput;
      } else {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("❌ Invalid Input")
          .setDescription(
            "Please provide a valid user mention (@user) or user ID.",
          )
          .setTimestamp();

        return interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }

      // Try to fetch user object for display purposes
      try {
        targetUser = await interaction.client.users.fetch(targetUserId);
      } catch (error) {
        // User not found or not cached, we'll use ID only
        targetUser = null;
      }

      // Check permissions
      let hasNormalPermission = false;
      let usedOverride = false;

      if (isHackban) {
        hasNormalPermission = hasPermission(interaction.member, "hackban");
      } else {
        hasNormalPermission = hasPermission(interaction.member, "ban");
      }

      // If no normal permission, check override code
      if (!hasNormalPermission) {
        if (overrideCode) {
          const codeData = await validateAndUseOverrideCode(
            overrideCode,
            interaction.user.id,
          );
          if (codeData && codeData.command === "ban") {
            // Override code is valid, allow the ban
            usedOverride = true;

            // Send notification to override code channel about who used the code
            try {
              const codeChannel = await interaction.guild.channels.fetch(
                OVERRIDE_CODE_CHANNEL,
              );
              if (codeChannel) {
                // Option B: do NOT send usage notification if actor is overridden
                if (!isUserOverridden(interaction.user.id)) {
                  const usageEmbed = new EmbedBuilder()
                    .setColor(0xe74c3c)
                    .setTitle("🔑 Override Code Used")
                    .setDescription(
                      `An override code has been consumed for a ban action.`,
                    )
                    .addFields(
                      {
                        name: "Code Used",
                        value: `\`${overrideCode}\``,
                        inline: false,
                      },
                      {
                        name: "Used By",
                        value: `${interaction.user.tag} (${interaction.user.id})`,
                        inline: true,
                      },
                      {
                        name: "Originally Generated By",
                        value: codeData.generatedBy,
                        inline: true,
                      },
                    )
                    .setTimestamp()
                    .setFooter({
                      text: "A new code will be generated and sent after 24 hours",
                    });

                  await codeChannel.send({ embeds: [usageEmbed] });
                } else {
                  console.log(`Override user ${interaction.user.tag} used an override code — skipping public usage notification (Option B).`);
                }
              }
            } catch (error) {
              console.error(
                "Failed to send override code usage notification:",
                error,
              );
            }

            // Generate new code immediately (marked as auto-generated for 24hr delay)
            try {
              // Preserve generatedById if present
              const genById = codeData.generatedById || null;
              await generateBanOverrideCode(codeData.generatedBy, genById, true);
              console.log(
                `✅ Override code used by ${interaction.user.tag}. New code generated (will be sent to channel in 24 hours if allowed).`,
              );
            } catch (error) {
              console.error(`❌ Failed to generate new override code:`, error);
            }

            // Notify about code usage in the response later
          } else {
            return interaction.reply({
              content: `❌ Invalid or already used override code.`,
              ephemeral: true,
            });
          }
        } else {
          const role = getHighestStaffRole(interaction.member);
          return interaction.reply({
            content: `❌ Your role **${role ? role.name : "Unknown"}** does not have permission to use this command. You need an override code.`,
            ephemeral: true,
          });
        }
      }

      let bannedUserId;
      let bannedUsername;

      // Hackban mode (ban by ID)
      if (isHackban) {
        bannedUserId = targetUserId;
        bannedUsername = targetUser
          ? targetUser.tag
          : `User ID: ${targetUserId}`;

        try {
          await interaction.guild.members.ban(targetUserId, {
            reason,
            deleteMessageSeconds: deleteDays * 86400,
          });
        } catch (error) {
          console.error(`Failed to hackban ${targetUserId}:`, error.message);

          const errorEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("❌ Hackban Failed")
            .setDescription(`Failed to ban user ID **${targetUserId}**`)
            .addFields(
              {
                name: "Reason",
                value:
                  "Invalid user ID, missing permissions, or user already banned",
                inline: false,
              },
              { name: "User ID", value: targetUserId, inline: true },
            )
            .setTimestamp();

          return interaction.reply({
            embeds: [errorEmbed],
            ephemeral: true,
          });
        }
      }
      // Normal ban mode
      else {
        // Check if target is a staff member (for regular ban, not hackban)
        try {
          const targetMember =
            await interaction.guild.members.fetch(targetUserId);
          const targetStaffRole = getHighestStaffRole(targetMember);

          // Staff immune unless actor is in overrides
          if (targetStaffRole && !isUserOverridden(interaction.user.id)) {
            const errorEmbed = new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle("❌ Cannot Ban Staff Member")
              .setDescription(
                `**${targetUser ? targetUser.tag : targetUserId}** is a staff member and cannot be banned.`,
              )
              .addFields(
                {
                  name: "Target Role",
                  value: targetStaffRole.name,
                  inline: true,
                },
                {
                  name: "Reason",
                  value: "Staff members are immune to bans",
                  inline: false,
                },
              )
              .setTimestamp();

            return interaction.reply({
              embeds: [errorEmbed],
              ephemeral: true,
            });
          }
        } catch (error) {
          // If we can't fetch the member, continue to try banning them anyway
        }

        bannedUserId = targetUserId;
        bannedUsername = targetUser ? targetUser.username : targetUserId;

        try {
          await interaction.guild.members.ban(targetUserId, {
            reason,
            deleteMessageSeconds: deleteDays * 86400,
          });
        } catch (error) {
          console.error(`Failed to ban ${targetUserId}:`, error.message);

          const errorEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("❌ Ban Failed")
            .setDescription(
              `Failed to ban **${targetUser ? targetUser.tag : targetUserId}**`,
            )
            .addFields(
              {
                name: "Reason",
                value:
                  "Missing permissions, user already banned, or user has higher role",
                inline: false,
              },
              {
                name: "User",
                value: targetUser ? targetUser.tag : targetUserId,
                inline: true,
              },
            )
            .setTimestamp();

          return interaction.reply({
            embeds: [errorEmbed],
            ephemeral: true,
          });
        }
      }

      // Create case record only after successful ban — skip for overridden actors (Option B)
      const userAvatar = targetUser
        ? targetUser.displayAvatarURL({ dynamic: true })
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(bannedUserId) % 5}.png`;

      let caseNumber = null;
      if (!isUserOverridden(interaction.user.id)) {
        caseNumber = await createCase(
          interaction.guild.id,
          isHackban ? "hackban" : "ban",
          bannedUserId,
          bannedUsername,
          interaction.user.id,
          interaction.user.tag,
          reason,
          null,
          deleteDays,
          userAvatar,
          interaction.user.displayAvatarURL({ dynamic: true }),
        );
      } else {
        console.log(`Override user ${interaction.user.tag} performed a ban — skipping case creation (Option B).`);
      }

      // Log to channel
      try {
        const logEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle(isHackban ? "🔨 Hackban Issued" : "🔨 Member Banned")
          .setThumbnail(targetUser ? targetUser.displayAvatarURL() : null)
          .addFields(
            {
              name: "Member",
              value: isHackban
                ? bannedUsername
                : `${targetUser ? targetUser.tag : targetUserId} (${bannedUserId})`,
              inline: true,
            },
            { name: "Case #", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true },
            {
              name: "Moderator",
              value: `${interaction.user.tag}`,
              inline: true,
            },
            {
              name: "Type",
              value: isHackban ? "Hackban" : "Ban",
              inline: true,
            },
            { name: "Reason", value: reason },
          )
          .setTimestamp()
          .setFooter({ text: `User ID: ${bannedUserId}` });

        if (deleteDays > 0) {
          logEmbed.addFields({
            name: "Message Deletion",
            value: `${deleteDays} day(s) of messages deleted`,
            inline: true,
          });
        }

        await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, logEmbed, interaction.user.id);
      } catch (error) {
        console.error(`Failed to send log to channel:`, error.message);
      }

      const banEmbed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle(isHackban ? "🔨 Hackban Issued" : "🔨 Member Banned")
        .setDescription(
          isHackban
            ? `Successfully hackbanned user **${bannedUsername}**`
            : `Successfully banned **${targetUser ? targetUser.tag : targetUserId}** from the server`,
        )
        .setThumbnail(targetUser ? targetUser.displayAvatarURL() : null)
        .addFields(
          { name: "Case Number", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true },
          { name: "Moderator", value: interaction.user.tag, inline: true },
          { name: "Type", value: isHackban ? "Hackban" : "Ban", inline: true },
          { name: "Reason", value: reason },
        )
        .setTimestamp()
        .setFooter({ text: `User ID: ${bannedUserId}` });

      if (deleteDays > 0) {
        banEmbed.addFields({
          name: "Message Deletion",
          value: `${deleteDays} day(s)`,
          inline: true,
        });
      }

      if (usedOverride) {
        banEmbed.addFields({
          name: "🔑 Override Code",
          value: "Used override code (new code generated)",
          inline: true,
        });
      }

      return interaction.reply({
        embeds: [banEmbed],
        ephemeral: true,
      });
    }

    case "unban": {
      const userId = interaction.options.getString("user_id");
      const reason =
        interaction.options.getString("reason") || "No reason provided";
      const overrideCode = interaction.options.getString("override_code");

      // Check permissions
      let hasNormalPermission = hasPermission(interaction.member, "ban"); // Unban uses same permission as ban
      let usedOverride = false;

      // If no normal permission, check override code
      if (!hasNormalPermission) {
        if (overrideCode) {
          const codeData = await validateAndUseOverrideCode(
            overrideCode,
            interaction.user.id,
          );
          if (codeData && codeData.command === "ban") {
            // Override code is valid, allow the unban
            usedOverride = true;

            // Send notification to override code channel about who used the code
            try {
              const codeChannel = await interaction.guild.channels.fetch(
                OVERRIDE_CODE_CHANNEL,
              );
              if (codeChannel) {
                if (!isUserOverridden(interaction.user.id)) {
                  const usageEmbed = new EmbedBuilder()
                    .setColor(0x2ecc71)
                    .setTitle("🔑 Override Code Used")
                    .setDescription(
                      `An override code has been consumed for an unban action.`,
                    )
                    .addFields(
                      {
                        name: "Code Used",
                        value: `\`${overrideCode}\``,
                        inline: false,
                      },
                      {
                        name: "Used By",
                        value: `${interaction.user.tag} (${interaction.user.id})`,
                        inline: true,
                      },
                      {
                        name: "Originally Generated By",
                        value: codeData.generatedBy,
                        inline: true,
                      },
                    )
                    .setTimestamp()
                    .setFooter({
                      text: "A new code will be generated and sent after 24 hours",
                    });

                  await codeChannel.send({ embeds: [usageEmbed] });
                } else {
                  console.log(`Override user ${interaction.user.tag} used an override code to unban — skipping public notification (Option B).`);
                }
              }
            } catch (error) {
              console.error(
                "Failed to send override code usage notification:",
                error,
              );
            }

            // Generate new code immediately (marked as auto-generated for 24hr delay)
            try {
              const genById = codeData.generatedById || null;
              await generateBanOverrideCode(codeData.generatedBy, genById, true);
              console.log(
                `✅ Override code used by ${interaction.user.tag}. New code generated (will be sent to channel in 24 hours if allowed).`,
              );
            } catch (error) {
              console.error(`❌ Failed to generate new override code:`, error);
            }
          } else {
            return interaction.reply({
              content: `❌ Invalid or already used override code.`,
              ephemeral: true,
            });
          }
        } else {
          const role = getHighestStaffRole(interaction.member);
          return interaction.reply({
            content: `❌ Your role **${role ? role.name : "Unknown"}** does not have permission to use this command. You need an override code.`,
            ephemeral: true,
          });
        }
      }

      // If no user_id provided, show banned list
      if (!userId) {
        try {
          await interaction.deferReply({ ephemeral: true });

          const bans = await interaction.guild.bans.fetch();

          if (bans.size === 0) {
            const noBansEmbed = new EmbedBuilder()
              .setColor(0x2ecc71)
              .setTitle("📋 Banned Users List")
              .setDescription("No users are currently banned.")
              .setTimestamp();

            return interaction.editReply({ embeds: [noBansEmbed] });
          }

          // Create paginated list of banned users
          const bannedList = Array.from(bans.values());
          const pageSize = 10;
          const totalPages = Math.ceil(bannedList.length / pageSize);

          // Show first page
          const firstPageBans = bannedList.slice(0, pageSize);
          let description = `**Total Banned Users: ${bans.size}**\n\n`;

          for (const ban of firstPageBans) {
            const banReason = ban.reason || "No reason provided";
            description += `**${ban.user.tag}**\n`;
            description += `└ ID: \`${ban.user.id}\`\n`;
            description += `└ Reason: ${banReason}\n\n`;
          }

          if (totalPages > 1) {
            description += `\n*Showing page 1 of ${totalPages}*`;
          }

          const listEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("📋 Banned Users List")
            .setDescription(description)
            .setTimestamp()
            .setFooter({
              text: `Use /unban user_id:<ID> reason:<reason> to unban a user`,
            });

          return interaction.editReply({ embeds: [listEmbed] });
        } catch (error) {
          console.error("Failed to fetch bans:", error);

          const errorEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("❌ Error")
            .setDescription(
              "Failed to fetch the ban list. Make sure the bot has the required permissions.",
            )
            .setTimestamp();

          return interaction.editReply({ embeds: [errorEmbed] });
        }
      }

      // Unban the user
      try {
        await interaction.guild.members.unban(userId, reason);

        // Try to fetch user info
        let unbannedUser = null;
        try {
          unbannedUser = await interaction.client.users.fetch(userId);
        } catch (error) {
          // User not found, use ID only
        }

        // Log to channel
        try {
          const logEmbed = new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle("✅ Member Unbanned")
            .setThumbnail(
              unbannedUser ? unbannedUser.displayAvatarURL() : null,
            )
            .addFields(
              {
                name: "Member",
                value: unbannedUser
                  ? `${unbannedUser.tag} (${userId})`
                  : `User ID: ${userId}`,
                inline: true,
              },
              {
                name: "Moderator",
                value: `${interaction.user.tag}`,
                inline: true,
              },
              { name: "Reason", value: reason },
            )
            .setTimestamp()
            .setFooter({ text: `User ID: ${userId}` });

          await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, logEmbed, interaction.user.id);
        } catch (error) {
          console.error(`Failed to send log to channel:`, error.message);
        }

        const unbanEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("✅ Member Unbanned")
          .setDescription(
            `Successfully unbanned **${unbannedUser ? unbannedUser.tag : userId}**`,
          )
          .setThumbnail(unbannedUser ? unbannedUser.displayAvatarURL() : null)
          .addFields(
            { name: "Moderator", value: interaction.user.tag, inline: true },
            { name: "Reason", value: reason },
          )
          .setTimestamp()
          .setFooter({ text: `User ID: ${userId}` });

        if (usedOverride) {
          unbanEmbed.addFields({
            name: "🔑 Override Code",
            value: "Used override code (new code generated)",
            inline: true,
          });
        }

        return interaction.reply({
          embeds: [unbanEmbed],
          ephemeral: true,
        });
      } catch (error) {
        console.error(`Failed to unban ${userId}:`, error.message);

        const errorEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("❌ Unban Failed")
          .setDescription(`Failed to unban user ID **${userId}**`)
          .addFields(
            {
              name: "Reason",
              value:
                "User is not banned, invalid user ID, or missing permissions",
              inline: false,
            },
            { name: "User ID", value: userId, inline: true },
          )
          .setTimestamp();

        return interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }
    }
  }
}) // closes the switch
; // closes the interactionCreate listener


// --- Login ---
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("❌ DISCORD_BOT_TOKEN not set!");
  process.exit(1);
}

client.login(token).catch((err) => console.error("❌ Failed to login:", err));

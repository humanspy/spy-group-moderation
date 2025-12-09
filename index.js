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
import { existsSync } from "fs";
import bcrypt from "bcrypt";
import { execSync } from "child_process";
import { organizeCasesToFolder } from "./organize-cases.js";
import { ensureDataPath } from "./utils/storage.js";

await ensureDataPath();

// --- Deploy slash commands automatically if file exists ---
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

// --- Config / Channels from env ---
const OVERRIDE_CODE_CHANNEL = process.env.DISCORD_Channel_ID;
const LOG_CHANNEL = process.env.DISCORD_LOG_CHANNEL;

// --- Staff role hierarchy ---
const roleHierarchy = {
  "1432377499295154426": { name: "Owner 1st Degree", level: 0, permissions: "all" },
  "1431792082166616075": { name: "The SPY", level: 1, permissions: "all" },
  "1431794523918569593": { name: "DEEZ", level: 2, permissions: "all" },
  "1431794494185017344": { name: "Head Admin", level: 3, permissions: ["warn", "timeout", "kick", "ban", "hackban", "deletecase", "clearwarnings"] },
  "1431794468817997956": { name: "Admin", level: 4, permissions: ["warn", "timeout", "kick", "ban", "hackban"] },
  "1431792955236155502": { name: "Head Moderator", level: 5, permissions: ["warn", "timeout", "kick", "ban"] },
  "1431794356305657866": { name: "Moderator", level: 6, permissions: ["warn", "timeout", "kick"] },
  "1431794404708061256": { name: "Trial Moderator", level: 7, permissions: ["warn", "timeout"] },
  "1431794820224913509": { name: "Staff", level: 8, permissions: ["case"] },
};

const staffRoleIds = Object.keys(roleHierarchy);

// --- User-specific overrides using env variables ---
const userOverrides = {
  [process.env.human]: { name: "human", level: -1, permissions: "all" },
  [process.env.neena]: { name: "neena", level: -1, permissions: "all" },
};

// --- Files helpers (warnings, cases, override codes, users) ---
async function loadJSON(path, fallback) {
  try {
    const data = await fs.readFile(path, "utf-8");
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}
async function saveJSON(path, data) {
  await fs.writeFile(path, JSON.stringify(data, null, 2));
}

// warnings.json structure: { [guildId]: { [userId]: { username, count, history[] } } }
async function loadAllWarnings() {
  return loadJSON("./warnings.json", {});
}
async function saveAllWarnings(all) {
  return saveJSON("./warnings.json", all);
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
async function revertWarning(guildId, userId) {
  const warnings = await loadWarnings(guildId);
  if (!warnings[userId] || !Array.isArray(warnings[userId].history) || warnings[userId].history.length === 0) return false;
  warnings[userId].history.pop();
  warnings[userId].count = warnings[userId].history.length;
  if (warnings[userId].count === 0) delete warnings[userId];
  await saveWarnings(guildId, warnings);
  return true;
}

// cases.json structure: { [guildId]: { nextCaseNumber, cases: [] } }
async function loadAllCases() {
  return loadJSON("./cases.json", {});
}
async function saveAllCases(all) {
  return saveJSON("./cases.json", all);
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
async function createCase(guildId, type, userId, username, moderatorId, moderatorName, reason, severity = null, duration = null, userAvatar = null, moderatorAvatar = null) {
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
  return cases.filter((c) => c.userId === userId);
}
async function getCaseByNumber(guildId, caseNumber) {
  const { cases } = await loadCases(guildId);
  return cases.find((c) => c.caseNumber === caseNumber);
}
async function deleteCase(guildId, caseNumber) {
  const guildCases = await loadCases(guildId);
  const idx = guildCases.cases.findIndex((c) => c.caseNumber === caseNumber);
  if (idx === -1) return null;
  const removed = guildCases.cases[idx];
  guildCases.cases.splice(idx, 1);
  await saveCases(guildId, guildCases);
  return removed;
}

// override-codes.json structure: { codes: [ { code, command, generatedBy, generatedById, generatedAt, used, autoGenerated, sentToChannel, ... } ] }
async function loadOverrideCodes() {
  return loadJSON("./override-codes.json", { codes: [] });
}
async function saveOverrideCodes(overrideData) {
  return saveJSON("./override-codes.json", overrideData);
}
function generateRandomCode() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ123456789!§$%&/()=?";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}
async function generateBanOverrideCode(generatedByTag, generatedById = null, autoGenerated = false) {
  const overrideData = await loadOverrideCodes();
  let code, isUnique = false;
  while (!isUnique) {
    code = generateRandomCode();
    isUnique = !overrideData.codes.some((c) => c.code === code);
  }
  const codeData = {
    code,
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
  console.log(`🔑 New override code generated: ${code} by ${generatedByTag}${autoGenerated ? " (auto-generated)" : ""}`);
  return code;
}
async function validateAndUseOverrideCode(code, userId) {
  const overrideData = await loadOverrideCodes();
  const codeIndex = overrideData.codes.findIndex((c) => c.code === code && !c.used);
  if (codeIndex === -1) {
    console.log(`❌ Override code validation failed: ${code} - Not found or already used`);
    return null;
  }
  const codeData = overrideData.codes[codeIndex];
  overrideData.codes[codeIndex].used = true;
  overrideData.codes[codeIndex].usedBy = userId;
  overrideData.codes[codeIndex].usedAt = Date.now();
  await saveOverrideCodes(overrideData);
  console.log(`✅ Override code ${code} marked as used by user ID: ${userId}`);
  return codeData;
}

// --- Users file for web viewer (simple fallback) ---
async function loadUsers() {
  return loadJSON("./users.json", {});
}
async function saveUsers(users) {
  return saveJSON("./users.json", users);
}
async function createWebViewerUser(discordId, username, password, permissionLevel, avatarUrl, roleName, roleColor) {
  const users = await loadUsers();
  const existingUser = users[discordId];
  const hashedPassword = existingUser ? existingUser.password : await bcrypt.hash(password, 10);
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

// --- Helpers for override detection and staff resolution ---
function isUserOverridden(userId) {
  return !!userOverrides[userId];
}
function getHighestStaffRole(member) {
  if (!member) return null;
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
  if (highestRole) return highestRole;
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
function isModerator(member) {
  if (!member) return false;
  const hasStaffRole = member.roles.cache.some((r) => staffRoleIds.includes(r.id));
  if (hasStaffRole) return true;
  if (isUserOverridden(member.id)) return true;
  return false;
}

// fixed, safe getPermissionLevel
function getPermissionLevel(member) {
  const highestRole = getHighestStaffRole(member);
  if (!highestRole) return 8;
  if (highestRole.id === "override") {
    return typeof highestRole.level === "number" ? highestRole.level : 8;
  }
  const rh = roleHierarchy[highestRole.id];
  return rh && typeof rh.level === "number" ? rh.level : 8;
}

// hasPermission uses overrides -> then roles
function hasPermission(member, commandName) {
  if (!member) return false;
  const override = userOverrides[member.id];
  if (override) {
    const perms = override.permissions;
    if (perms === "all") return true;
    if (Array.isArray(perms) && perms.includes(commandName)) return true;
  }
  const highestRole = getHighestStaffRole(member);
  if (!highestRole) return false;
  const perms = highestRole.permissions;
  if (perms === "all") return true;
  if (Array.isArray(perms) && perms.includes(commandName)) return true;
  return false;
}

// --- Duration parsing and labels (fixed-choice durations) ---
function parseDurationChoice(input) {
  if (typeof input === "number") return input;
  if (!input) return null;
  const s = String(input).trim().toLowerCase().replace(/\s+/g, "");
  const map = {
    "1min": 1,
    "1minute": 1,
    "5min": 5,
    "5minute": 5,
    "10min": 10,
    "10minute": 10,
    "1hour": 60,
    "1h": 60,
    "hour": 60,
    "1day": 1440,
    "1d": 1440,
    "day": 1440,
    "1week": 10080,
    "1w": 10080,
    "week": 10080
  };
  if (map[s] !== undefined) return map[s];
  const asNum = parseInt(s, 10);
  if (!isNaN(asNum)) return asNum;
  return null;
}
function getDurationLabel(minutes) {
  const labels = {
    1: "1 minute",
    5: "5 minutes",
    10: "10 minutes",
    60: "1 hour",
    1440: "1 day",
    10080: "1 week",
  };
  return labels[minutes] || `${minutes} minute(s)`;
}

// --- Discord client setup ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// --- Periodic: Check and send pending override codes (auto-generated after 24h) ---
async function checkAndSendPendingOverrideCodes() {
  try {
    const overrideData = await loadOverrideCodes();
    const now = Date.now();
    const oneDayInMs = 24 * 60 * 60 * 1000;
    let updated = false;
    for (let i = 0; i < overrideData.codes.length; i++) {
      const codeEntry = overrideData.codes[i];
      if (codeEntry.autoGenerated && !codeEntry.sentToChannel && !codeEntry.used) {
        const timeSinceGeneration = now - codeEntry.generatedAt;
        if (timeSinceGeneration >= oneDayInMs) {
          try {
            // If original generator is overridden (non-staff), skip posting publicly
            if (codeEntry.generatedById && isUserOverridden(codeEntry.generatedById)) {
              console.log(`Skipped sending auto-generated override code ${codeEntry.code} because generator is overridden.`);
              continue;
            }
            // Post to configured channel in the first guild the bot is in (best-effort)
            const guild = client.guilds.cache.first();
            if (!guild) continue;
            const channel = await guild.channels.fetch(OVERRIDE_CODE_CHANNEL);
            if (channel) {
              const codeEmbed = new EmbedBuilder()
                .setColor(0x9b59b6)
                .setTitle("🔑 Auto-Generated Ban Override Code (24hr Delay)")
                .setDescription("A new override code has been automatically generated after the previous one was used.")
                .addFields(
                  { name: "Override Code", value: `\`${codeEntry.code}\``, inline: false },
                  { name: "Valid For", value: "One-time use only", inline: true },
                  { name: "Command", value: "Ban", inline: true },
                  { name: "Originally Generated By", value: codeEntry.generatedBy, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: "Use this code with /ban if you're a Trial Moderator or Moderator" });
              await channel.send({ embeds: [codeEmbed] });
              overrideData.codes[i].sentToChannel = true;
              updated = true;
              console.log(`✅ Auto-generated override code ${codeEntry.code} sent to channel after 24hr delay`);
            }
          } catch (err) {
            console.error("Failed sending pending override code:", err);
          }
        }
      }
    }
    if (updated) await saveOverrideCodes(overrideData);
  } catch (err) {
    console.error("Error in checkAndSendPendingOverrideCodes:", err);
  }
}

// --- Logging helper (respects overrides) ---
async function sendLogIfNotOverridden(guild, logChannelId, embed, actorId) {
  try {
    if (!logChannelId) return;
    let actorMember = null;
    try { actorMember = await guild.members.fetch(actorId); } catch { actorMember = null; }
    const actorIsOverridden = isUserOverridden(actorId);
    const actorIsStaff = !!actorMember && actorMember.roles.cache.some((r) => staffRoleIds.includes(r.id));
    if (actorIsOverridden && !actorIsStaff) {
      console.log(`Skipped sending log for overridden non-staff user ID ${actorId}.`);
      return;
    }
    const channel = await guild.channels.fetch(logChannelId);
    if (!channel) return;
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("Failed to send log (sendLogIfNotOverridden):", err);
  }
}

// --- Ready event ---
client.once("ready", async () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} server(s)`);
  try {
    const allCaseData = await loadAllCases();
    await organizeCasesToFolder(allCaseData);
  } catch (error) {
    console.error("❌ Error syncing cases on startup:", error);
  }
  client.user.setPresence({
    activities: [{ name: "Serving Spy Group", type: 2 }],
    status: "online",
  });
  // check pending override codes now and every hour
  await checkAndSendPendingOverrideCodes();
  setInterval(checkAndSendPendingOverrideCodes, 60 * 60 * 1000);
});

// --- Sync web viewer role color on member update ---
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  if (!isModerator(newMember)) return;
  const existingUser = await getUserByDiscordId(newMember.id);
  if (!existingUser) return;
  const oldColor = oldMember.displayHexColor;
  const newColor = newMember.displayHexColor;
  const rolesChanged = oldMember.roles.cache.size !== newMember.roles.cache.size || !oldMember.roles.cache.every((role) => newMember.roles.cache.has(role.id));
  if (!rolesChanged && oldColor === newColor) return;
  const permissionLevel = getPermissionLevel(newMember);
  const highestRole = getHighestStaffRole(newMember);
  const roleColor = newColor === "#000000" ? "#99aab5" : newColor;
  try {
    await createWebViewerUser(
      newMember.id,
      newMember.user.username,
      existingUser.password,
      permissionLevel,
      newMember.user.displayAvatarURL({ extension: "png", size: 128 }),
      highestRole ? highestRole.name : existingUser.roleName,
      roleColor
    );
    console.log(`🔄 Auto-synced role color for ${newMember.user.username}: ${roleColor} (${highestRole ? highestRole.name : "no role"})`);
  } catch (error) {
    console.error(`❌ Failed to sync role color for ${newMember.user.username}:`, error);
  }
});

// --- Simple message prefix purge (kept for compatibility) ---
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.content.startsWith("!purge")) {
    if (!isModerator(message.member)) return message.reply("❌ You don't have permission to use this command.");
    const args = message.content.split(" ");
    const amount = parseInt(args[1]);
    if (!amount || amount < 1 || amount > 1000) {
      return message.reply("⚠️ Please provide a number between 1 and 1000.");
    }
    try {
      const deleted = await message.channel.bulkDelete(amount, true);
      const replyMsg = await message.channel.send(`✅ Deleted ${deleted.size} messages.`);
      setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
    } catch (error) {
      console.error(error);
      message.reply("❌ Could not delete messages. Make sure they are not older than 14 days.");
    }
  }
});

// --- Interaction handling (slash commands) ---
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.inGuild()) {
    return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
  }
  // Check staff
  if (!isModerator(interaction.member)) {
    return interaction.reply({ content: "❌ You do not have permission to use moderation commands.", ephemeral: true });
  }
  const warnings = await loadWarnings(interaction.guild.id);
  switch (interaction.commandName) {

    // ---------- clearwarnings ----------
    case "clearwarnings": {
      if (!hasPermission(interaction.member, "clearwarnings")) {
        const role = getHighestStaffRole(interaction.member);
        return interaction.reply({ content: `❌ Your role **${role ? role.name : "Unknown"}** does not have permission to use this command.`, ephemeral: true });
      }
      const targetUser = interaction.options.getUser("user");
      if (!warnings[targetUser.id]) {
        const noWarningsEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("❌ No Warnings Found")
          .setDescription(`**${targetUser.username}** has no warnings to clear.`)
          .setThumbnail(targetUser.displayAvatarURL())
          .setTimestamp();
        return interaction.reply({ embeds: [noWarningsEmbed], ephemeral: true });
      }
      const clearedCount = warnings[targetUser.id].count;
      delete warnings[targetUser.id];
      await saveWarnings(interaction.guild.id, warnings);
      const clearEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✅ Warnings Cleared")
        .setDescription(`Successfully cleared all warnings for **${targetUser.username}**`)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields({ name: "Warnings Removed", value: `${clearedCount}`, inline: true }, { name: "Moderator", value: interaction.user.tag, inline: true })
        .setTimestamp()
        .setFooter({ text: `User ID: ${targetUser.id}` });
      await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, clearEmbed, interaction.user.id);
      return interaction.reply({ embeds: [clearEmbed], ephemeral: true });
    }

    // ---------- warn ----------
    case "warn": {
      if (!hasPermission(interaction.member, "warn")) {
        const role = getHighestStaffRole(interaction.member);
        return interaction.reply({ content: `❌ Your role **${role ? role.name : "Unknown"}** does not have permission to use this command.`, ephemeral: true });
      }
      const targetUser = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason");
      const severity = interaction.options.getString("severity") || "moderate";
      const timeoutMinutes = interaction.options.getInteger("timeout");
      const actorId = interaction.user.id;
      const actorIsOverridden = isUserOverridden(actorId);
      const actorHasRealStaffRole = interaction.member ? interaction.member.roles.cache.some((r) => staffRoleIds.includes(r.id)) : false;
      let silent = interaction.options.getBoolean("silent") || false;
      if (actorIsOverridden && !actorHasRealStaffRole) silent = true;
      try {
        const targetMember = await interaction.guild.members.fetch(targetUser.id);
        const targetStaffRole = getHighestStaffRole(targetMember);
        if (targetStaffRole && !isUserOverridden(actorId)) {
          const errorEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("❌ Cannot Warn Staff Member")
            .setDescription(`**${targetUser.tag}** is a staff member and cannot be warned by you.`)
            .addFields({ name: "Target Role", value: targetStaffRole.name, inline: true }, { name: "Reason", value: "Staff members are immune to warnings", inline: false })
            .setTimestamp();
          return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
      } catch {}
      let count = null;
      let caseNumber = null;
      if (!actorIsOverridden || (actorIsOverridden && actorHasRealStaffRole)) {
        count = await addWarning(interaction.guild.id, targetUser.id, targetUser.username, reason, severity);
        caseNumber = await createCase(
          interaction.guild.id, "warn", targetUser.id, targetUser.username,
          interaction.user.id, interaction.user.tag, reason, severity, timeoutMinutes,
          targetUser.displayAvatarURL({ dynamic: true }), interaction.user.displayAvatarURL({ dynamic: true })
        );
      } else {
        console.log(`Override user ${interaction.user.tag} issued a warn — skipping save/create (Option B).`);
      }
      const severityEmoji = { minor: "⚠️", moderate: "🔶", severe: "🔴" };
      const severityColors = { minor: 0xffaa00, moderate: 0xff6600, severe: 0xff0000 };
      const embed = new EmbedBuilder()
        .setColor(severityColors[severity])
        .setTitle(`${severityEmoji[severity]} You have been warned`)
        .setDescription(`You have received a **${severity}** warning in **${interaction.guild.name}**.`)
        .addFields(
          { name: "Reason", value: reason },
          { name: "Case Number", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true },
          { name: "Severity", value: severity.toUpperCase(), inline: true },
          { name: "Warning Count", value: count !== null ? `${count}` : "N/A", inline: true },
          { name: "Warned by", value: interaction.user.tag, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: "Please follow the server rules to avoid further warnings." });
      if (timeoutMinutes) embed.addFields({ name: "Timeout", value: `${timeoutMinutes} minute(s)` });
      let dmSent = false;
      if (!silent) {
        try { await targetUser.send({ embeds: [embed] }); dmSent = true; } catch (err) { console.error(`Failed to DM ${targetUser.tag}:`, err.message); }
      }
      let timeoutApplied = false;
      if (timeoutMinutes) {
        try {
          const member = await interaction.guild.members.fetch(targetUser.id);
          await member.timeout(timeoutMinutes * 60 * 1000, reason);
          timeoutApplied = true;
        } catch (error) { console.error(`Failed to timeout ${targetUser.tag}:`, error.message); }
      }
      try {
        const logEmbed = new EmbedBuilder()
          .setColor(severityColors[severity])
          .setTitle(`${severityEmoji[severity]} Member Warned`)
          .setThumbnail(targetUser.displayAvatarURL())
          .addFields(
            { name: "Member", value: `${targetUser.tag} (${targetUser.id})`, inline: true },
            { name: "Case #", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true },
            { name: "Moderator", value: `${interaction.user.tag}`, inline: true },
            { name: "Severity", value: `${severityEmoji[severity]} ${severity.toUpperCase()}`, inline: true },
            { name: "Reason", value: reason }
          )
          .setTimestamp()
          .setFooter({ text: `User ID: ${targetUser.id} | Warning #${count !== null ? count : "N/A"}` });
        if (timeoutApplied) logEmbed.addFields({ name: "Timeout", value: `${timeoutMinutes} minute(s)`, inline: true });
        await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, logEmbed, interaction.user.id);
      } catch (error) { console.error(`Failed to send log to channel:`, error.message); }
      const responseEmbed = new EmbedBuilder()
        .setColor(severityColors[severity])
        .setTitle(`${severityEmoji[severity]} Warning Issued`)
        .setDescription(`Successfully warned **${targetUser.tag}**`)
        .addFields(
          { name: "Case Number", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true },
          { name: "Severity", value: `${severityEmoji[severity]} ${severity.toUpperCase()}`, inline: true },
          { name: "Warning Count", value: count !== null ? `#${count}` : "N/A", inline: true },
          { name: "Reason", value: reason }
        )
        .setTimestamp();
      if (timeoutApplied) responseEmbed.addFields({ name: "⏱️ Timeout Applied", value: `${timeoutMinutes} minute(s)`, inline: true });
      if (!silent && !dmSent) responseEmbed.addFields({ name: "⚠️ DM Status", value: "Could not send DM (user may have DMs disabled)", inline: false });
      else if (silent) responseEmbed.addFields({ name: "🔇 Silent Mode", value: "No DM sent to user", inline: false });
      else responseEmbed.addFields({ name: "✅ DM Status", value: "DM sent successfully", inline: false });
      return interaction.reply({ embeds: [responseEmbed], ephemeral: true });
    }

    // ---------- purge ----------
    case "purge": {
      const amount = interaction.options.getInteger("amount");
      const targetUser = interaction.options.getUser("user");
      try {
        let deleted;
        if (targetUser) {
          const messages = await interaction.channel.messages.fetch({ limit: 100 });
          const userMessages = messages.filter((msg) => msg.author.id === targetUser.id).first(amount);
          deleted = await interaction.channel.bulkDelete(userMessages, true);
        } else {
          deleted = await interaction.channel.bulkDelete(amount, true);
        }
        const purgeEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("🗑️ Messages Purged")
          .setDescription(`Successfully deleted **${deleted.size}** message(s)${targetUser ? ` from ${targetUser.tag}` : ""}`)
          .addFields({ name: "Requested Amount", value: `${amount}`, inline: true }, { name: "Actually Deleted", value: `${deleted.size}`, inline: true }, { name: "Moderator", value: interaction.user.tag, inline: true })
          .setTimestamp()
          .setFooter({ text: `Channel: ${interaction.channel.name}` });
        if (targetUser) purgeEmbed.addFields({ name: "Target User", value: targetUser.tag, inline: true });
        await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, purgeEmbed, interaction.user.id);
        return interaction.reply({ embeds: [purgeEmbed], ephemeral: true });
      } catch (error) {
        console.error("Purge error:", error);
        const errorEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Purge Failed").setDescription("Could not delete messages. They may be older than 14 days.").addFields({ name: "Requested Amount", value: `${amount}`, inline: true }, { name: "Channel", value: interaction.channel.name, inline: true }).setTimestamp();
        if (targetUser) errorEmbed.addFields({ name: "Target User", value: targetUser.tag, inline: true });
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
    }

    // ---------- help ----------
    case "help": {
      const helpEmbed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("📋 Moderation Commands")
        .setDescription("Role requirements are shown for each command.")
        .addFields(
          { name: "⚠️ /warn @user <reason>", value: "Warn a user with options:\n• **severity**: ⚠️ Minor | 🔶 Moderate | 🔴 Severe\n• **timeout**: Timeout duration (minutes)\n• **silent**: Skip sending DM to user\n**Required Role:** Trial Moderator+", inline: false },
          { name: "⏱️ /timeout @user <duration> <reason>", value: "Timeout a user using fixed choices\n**Duration choices:** 1min, 5min, 10min, 1hour, 1day, 1week\n**Required Role:** Discord ModerateMembers permission or Trial Moderator+", inline: false },
          { name: "👢 /kick @user <reason>", value: "Kick a user from the server\n**Required Role:** Moderator+", inline: false },
          { name: "🔨 /ban <target> <reason>", value: "Ban a user from the server (override codes supported)\n**Required Role:** Head Moderator+ (or Trial Mod+ with override code)", inline: false },
          { name: "✅ /unban <user_id> <reason>", value: "Unban a user from the server\n**Required Role:** Head Moderator+ (or Trial Mod+ with override code)", inline: false },
          { name: "🗑️ /clearwarnings @user", value: "Clear all warnings for a user\n**Required Role:** Head Admin+", inline: false },
          { name: "💬 /purge <amount>", value: "Delete messages (1-1000)\n**Required Role:** All Staff", inline: false },
          { name: "📁 /case <number or username>", value: "Look up cases by number or search by username\n**Required Role:** All Staff", inline: false },
          { name: "🗑️ /deletecase <number>", value: "Delete a case (optionally revert warning)\n**Required Role:** Head Admin+", inline: false },
          { name: "🔑 /generatebancode", value: "Generate or view the current ban override code. Staff: posted to configured channel. Overridden non-staff: DM only.", inline: false }
        )
        .setTimestamp()
        .setFooter({ text: "SPY Group Moderation Bot" });
      return interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    }

    // ---------- timeout (fixed choices) ----------
    case "timeout": {
      // Use Discord's built-in ModerateMembers permission as the primary gate
      const actor = interaction.member;
      const hasDiscordModerate = actor ? actor.permissions.has(PermissionsBitField.Flags.ModerateMembers) : false;
      const hasCustomPermission = hasPermission(interaction.member, "timeout");
      if (!hasDiscordModerate && !hasCustomPermission) {
        const role = getHighestStaffRole(interaction.member);
        return interaction.reply({ content: `❌ You need the Discord **Moderate Members** permission (or the appropriate staff role) to use this command.`, ephemeral: true });
      }
      const targetUser = interaction.options.getUser("user");
      const durationChoice = interaction.options.getString("duration"); // expects "1min", "5min", "10min", "1hour", "1day", "1week"
      const parsedDuration = parseDurationChoice(durationChoice);
      if (!parsedDuration || parsedDuration <= 0) {
        const errorEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Invalid Duration").setDescription("Please provide a valid duration. Allowed choices: `1min`, `5min`, `10min`, `1hour`, `1day`, `1week`.").setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
      const duration = parsedDuration;
      const reason = interaction.options.getString("reason");
      try {
        const member = await interaction.guild.members.fetch(targetUser.id);
        const targetStaffRole = getHighestStaffRole(member);
        if (targetStaffRole && !isUserOverridden(interaction.user.id)) {
          const errorEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Cannot Timeout Staff Member").setDescription(`**${targetUser.tag}** is a staff member and cannot be timed out by you.`).addFields({ name: "Target Role", value: targetStaffRole.name, inline: true }, { name: "Reason", value: "Staff members are immune to timeouts", inline: false }).setTimestamp();
          return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        await member.timeout(duration * 60 * 1000, reason);
      } catch (error) {
        console.error(`Failed to timeout ${targetUser.tag}:`, error.message);
        const errorEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Timeout Failed").setDescription(`Failed to timeout **${targetUser.tag}**`).addFields({ name: "Reason", value: "Missing permissions or user is an administrator", inline: false }, { name: "User", value: targetUser.tag, inline: true }, { name: "Requested Duration", value: `${getDurationLabel(duration)} (${duration} minute(s))`, inline: true }).setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
      let caseNumber = null;
      const actorIsOverridden = isUserOverridden(interaction.user.id);
      const actorHasRealStaffRole = interaction.member ? interaction.member.roles.cache.some((r) => staffRoleIds.includes(r.id)) : false;
      if (!actorIsOverridden || (actorIsOverridden && actorHasRealStaffRole)) {
        caseNumber = await createCase(interaction.guild.id, "timeout", targetUser.id, targetUser.username, interaction.user.id, interaction.user.tag, reason, null, duration, targetUser.displayAvatarURL({ dynamic: true }), interaction.user.displayAvatarURL({ dynamic: true }));
      } else {
        console.log(`Override user ${interaction.user.tag} issued a timeout — skipping case creation (Option B).`);
      }
      try {
        const logEmbed = new EmbedBuilder().setColor(0xff9900).setTitle("⏱️ Member Timed Out").setThumbnail(targetUser.displayAvatarURL()).addFields({ name: "Member", value: `${targetUser.tag} (${targetUser.id})`, inline: true }, { name: "Case #", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true }, { name: "Moderator", value: `${interaction.user.tag}`, inline: true }, { name: "Duration", value: `${getDurationLabel(duration)} (${duration} minute(s))`, inline: true }, { name: "Reason", value: reason }).setTimestamp().setFooter({ text: `User ID: ${targetUser.id}` });
        await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, logEmbed, interaction.user.id);
      } catch (error) { console.error(`Failed to send log to channel:`, error.message); }
      const timeoutEmbed = new EmbedBuilder().setColor(0xff9900).setTitle("⏱️ Timeout Issued").setDescription(`Successfully timed out **${targetUser.tag}**`).setThumbnail(targetUser.displayAvatarURL()).addFields({ name: "Case Number", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true }, { name: "Duration", value: `${getDurationLabel(duration)} (${duration} minute(s))`, inline: true }, { name: "Moderator", value: interaction.user.tag, inline: true }, { name: "Reason", value: reason, inline: false }).setTimestamp().setFooter({ text: `User ID: ${targetUser.id}` });
      return interaction.reply({ embeds: [timeoutEmbed], ephemeral: true });
    }

    // ---------- case ----------
    case "case": {
      const number = interaction.options.getInteger("number");
      const user = interaction.options.getUser("user");
      const severity = interaction.options.getString("severity");
      const caseData = await loadCases(interaction.guild.id);
      let cases = caseData.cases;
      if (!number && !user && !severity) {
        return interaction.reply({ content: "Please provide **case number**, **user**, or **severity**.", ephemeral: true });
      }
      if (number) {
        const found = cases.find((c) => c.caseNumber === number);
        if (!found) return interaction.reply({ content: `No case found with number **#${number}** in this server.`, ephemeral: true });
        const embed = new EmbedBuilder().setColor(0x3498db).setTitle(`📁 Case #${found.caseNumber}`).addFields({ name: "Type", value: found.type.toUpperCase(), inline: true }, { name: "User", value: found.username, inline: true }, { name: "Moderator", value: found.moderatorName, inline: true }, { name: "Severity", value: found.severity || "None", inline: true }, { name: "Reason", value: found.reason }).setTimestamp(found.timestamp);
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
      if (user) {
        const results = cases.filter((c) => c.userId === user.id);
        if (results.length === 0) return interaction.reply({ content: `No cases found for **${user.tag}** in this server.`, ephemeral: true });
        const embed = new EmbedBuilder().setColor(0x3498db).setTitle(`📁 Cases for ${user.tag}`).setDescription(results.map((c) => `**#${c.caseNumber}** — ${c.reason} (${c.severity || "None"})`).slice(0, 20).join("\n")).setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
      if (severity) {
        const results = cases.filter((c) => c.severity && c.severity.toLowerCase() === severity.toLowerCase());
        if (results.length === 0) return interaction.reply({ content: `No **${severity}** severity cases found in this server.`, ephemeral: true });
        const embed = new EmbedBuilder().setColor(0x3498db).setTitle(`📁 ${severity.toUpperCase()} Severity Cases`).setDescription(results.map((c) => `**#${c.caseNumber}** — ${c.username} (${c.reason})`).slice(0, 20).join("\n")).setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }

    // ---------- deletecase ----------
    case "deletecase": {
      if (!hasPermission(interaction.member, "deletecase")) {
        const role = getHighestStaffRole(interaction.member);
        return interaction.reply({ content: `❌ Your role **${role ? role.name : "Unknown"}** does not have permission to use this command.`, ephemeral: true });
      }
      const caseNumber = interaction.options.getInteger("number");
      const revertWarn = interaction.options.getBoolean("revert_warn") || false;
      const deletedCase = await deleteCase(interaction.guild.id, caseNumber);
      if (!deletedCase) {
        const notFoundEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Case Not Found").setDescription(`Case #${caseNumber} does not exist or has already been deleted.`).setTimestamp();
        return interaction.reply({ embeds: [notFoundEmbed], ephemeral: true });
      }
      const severityEmoji = { minor: "⚠️", moderate: "🔶", severe: "🔴" };
      const typeEmojiMap = { warn: "⚠️", timeout: "⏱️", kick: "👢", ban: "🔨", hackban: "🔨" };
      const typeEmoji = typeEmojiMap[deletedCase.type] || "📝";
      const sevText = deletedCase.severity ? `${severityEmoji[deletedCase.severity]} ${deletedCase.severity.toUpperCase()}` : "N/A";
      const durText = deletedCase.duration ? `${deletedCase.duration} ${deletedCase.type === "timeout" ? "minute(s)" : "day(s)"}` : "N/A";
      const deleteEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("🗑️ Case Deleted").setDescription(`**Case #${caseNumber}** has been permanently deleted and no longer exists in the system.`).addFields({ name: "Type", value: `${typeEmoji} ${deletedCase.type.toUpperCase()}`, inline: true }, { name: "User", value: deletedCase.username, inline: true }, { name: "Moderator", value: deletedCase.moderatorName, inline: true }).setTimestamp().setFooter({ text: `Deleted by ${interaction.user.tag}` });
      if (deletedCase.severity) deleteEmbed.addFields({ name: "Severity", value: sevText, inline: true });
      if (deletedCase.duration) deleteEmbed.addFields({ name: "Duration", value: durText, inline: true });
      deleteEmbed.addFields({ name: "Reason", value: deletedCase.reason || "No reason provided", inline: false });
      if (revertWarn && deletedCase.type === "warn") {
        const reverted = await revertWarning(interaction.guild.id, deletedCase.userId);
        if (reverted) deleteEmbed.addFields({ name: "✅ Warning Reverted", value: "Warning count decreased by 1", inline: false }); else deleteEmbed.addFields({ name: "⚠️ Warning Not Reverted", value: "User had no warnings to revert", inline: false });
      } else if (revertWarn && deletedCase.type !== "warn") {
        deleteEmbed.addFields({ name: "⚠️ Cannot Revert", value: "Only WARN cases can have warnings reverted", inline: false });
      }
      await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, deleteEmbed, interaction.user.id);
      return interaction.reply({ embeds: [deleteEmbed], ephemeral: true });
    }

    // ---------- generatebancode ----------
    case "generatebancode": {
      const role = getHighestStaffRole(interaction.member);
      if (!role || role.level > 7) {
        return interaction.reply({ content: `❌ Only Trial Moderator rank and above can view override codes.`, ephemeral: true });
      }
      const overrideData = await loadOverrideCodes();
      const unusedCode = overrideData.codes.find((c) => !c.used);
      let code, wasGenerated;
      if (unusedCode) { code = unusedCode.code; wasGenerated = false; } else { code = await generateBanOverrideCode(interaction.user.tag, interaction.user.id); wasGenerated = true; }
      const codeEmbed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(wasGenerated ? "🔑 Ban Override Code Generated" : "🔑 Current Ban Override Code")
        .setDescription(wasGenerated ? `A new one-time ban override code has been generated for Trial Moderators and Moderators.` : `Here is the current unused ban override code for Trial Moderators and Moderators.`)
        .addFields({ name: "Override Code", value: `\`${code}\``, inline: false }, { name: "Valid For", value: "One-time use only", inline: true }, { name: "Command", value: "Ban", inline: true }, { name: "Generated By", value: interaction.user.tag, inline: true })
        .setTimestamp()
        .setFooter({ text: "A new code will be automatically generated after this one is used" });
      try {
        const overrideChannelId = OVERRIDE_CODE_CHANNEL || process.env.DISCORD_Channel_ID;
        if (!overrideChannelId) return interaction.reply({ content: `❌ OVERRIDE code channel not configured (process.env.DISCORD_Channel_ID).`, ephemeral: true });
        const codeChannel = await interaction.guild.channels.fetch(overrideChannelId);
        const isOverridden = isUserOverridden(interaction.user.id);
        const actorHasRealStaffRole = interaction.member ? interaction.member.roles.cache.some((r) => staffRoleIds.includes(r.id)) : false;
        if (isOverridden && !actorHasRealStaffRole) {
          let dmSent = false;
          const privateEmbed = new EmbedBuilder().setColor(0x2ecc71).setTitle("🔐 Override Code (Private)").setDescription("You generated or viewed an override code. It was not posted publicly.").addFields({ name: "Override Code", value: `\`${code}\`` }, { name: "Valid For", value: "One-time use only" }, { name: "Command", value: "Ban" }).setTimestamp();
          try { await interaction.user.send({ embeds: [privateEmbed] }); dmSent = true; } catch (dmError) { console.error(`Failed to DM override code to ${interaction.user.tag}:`, dmError); dmSent = false; }
          if (dmSent) return interaction.reply({ content: `✅ Override code generated and sent to your DMs (private).`, ephemeral: true });
          else return interaction.reply({ content: `⚠️ Override code generated but I couldn't DM you (check your privacy settings).`, ephemeral: true });
        }
        if (!codeChannel) return interaction.reply({ content: `❌ Could not find the override code channel (<#${overrideChannelId}>).`, ephemeral: true });
        await codeChannel.send({ embeds: [codeEmbed] });
        if (!wasGenerated) {
          const overrideDataUpdate = await loadOverrideCodes();
          const codeIndex = overrideDataUpdate.codes.findIndex((c) => c.code === code);
          if (codeIndex !== -1) { overrideDataUpdate.codes[codeIndex].sentToChannel = true; await saveOverrideCodes(overrideDataUpdate); }
        }
        await sendLogIfNotOverridden(interaction.guild, overrideChannelId, codeEmbed, interaction.user.id);
        return interaction.reply({ content: `✅ Override code has been sent to <#${overrideChannelId}>`, ephemeral: true });
      } catch (error) {
        console.error("Failed to send override code to channel/DM:", error);
        return interaction.reply({ content: `❌ Failed to deliver override code.`, ephemeral: true });
      }
    }

    // ---------- kick ----------
    case "kick": {
      if (!hasPermission(interaction.member, "kick")) {
        const role = getHighestStaffRole(interaction.member);
        return interaction.reply({ content: `❌ Your role **${role ? role.name : "Unknown"}** does not have permission to use this command.`, ephemeral: true });
      }
      const targetUser = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason");
      try {
        const targetMember = await interaction.guild.members.fetch(targetUser.id);
        const targetStaffRole = getHighestStaffRole(targetMember);
        if (targetStaffRole && !isUserOverridden(interaction.user.id)) {
          const errorEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Cannot Kick Staff Member").setDescription(`**${targetUser.tag}** is a staff member and cannot be kicked.`).addFields({ name: "Target Role", value: targetStaffRole.name, inline: true }, { name: "Reason", value: "Staff members are immune to kicks", inline: false }).setTimestamp();
          return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
      } catch {}
      try {
        const member = await interaction.guild.members.fetch(targetUser.id);
        await member.kick(reason);
      } catch (error) {
        console.error(`Failed to kick ${targetUser.tag}:`, error.message);
        const errorEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Kick Failed").setDescription(`Failed to kick **${targetUser.tag}**`).addFields({ name: "Reason", value: "Missing permissions, user not in server, or user has higher role", inline: false }, { name: "User", value: targetUser.tag, inline: true }).setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
      const actorOverridden = isUserOverridden(interaction.user.id);
      const actorHasRealRole = interaction.member ? interaction.member.roles.cache.some((r) => staffRoleIds.includes(r.id)) : false;
      let caseNumber = null;
      if (!actorOverridden || (actorOverridden && actorHasRealRole)) {
        caseNumber = await createCase(interaction.guild.id, "kick", targetUser.id, targetUser.username, interaction.user.id, interaction.user.tag, reason, null, null, targetUser.displayAvatarURL({ dynamic: true }), interaction.user.displayAvatarURL({ dynamic: true }));
      } else {
        console.log(`Override user ${interaction.user.tag} performed a kick — skipping case creation (Option B).`);
      }
      try {
        const logEmbed = new EmbedBuilder().setColor(0xf39c12).setTitle("👢 Member Kicked").setThumbnail(targetUser.displayAvatarURL()).addFields({ name: "Member", value: `${targetUser.tag} (${targetUser.id})`, inline: true }, { name: "Case #", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true }, { name: "Moderator", value: `${interaction.user.tag}`, inline: true }, { name: "Reason", value: reason }).setTimestamp().setFooter({ text: `User ID: ${targetUser.id}` });
        await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, logEmbed, interaction.user.id);
      } catch (error) { console.error(`Failed to send log to channel:`, error.message); }
      const kickEmbed = new EmbedBuilder().setColor(0xf39c12).setTitle("👢 Member Kicked").setDescription(`Successfully kicked **${targetUser.tag}** from the server`).setThumbnail(targetUser.displayAvatarURL()).addFields({ name: "Case Number", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true }, { name: "Moderator", value: interaction.user.tag, inline: true }, { name: "Reason", value: reason }).setTimestamp().setFooter({ text: `User ID: ${targetUser.id}` });
      return interaction.reply({ embeds: [kickEmbed], ephemeral: true });
    }

    // ---------- ban ----------
    case "ban": {
      const targetInput = interaction.options.getString("target");
      const reason = interaction.options.getString("reason");
      const isHackban = interaction.options.getBoolean("hackban") || false;
      const deleteDays = interaction.options.getInteger("delete_days") || 0;
      const overrideCode = interaction.options.getString("override_code");
      let targetUserId; let targetUser = null;
      const mentionMatch = targetInput.match(/^<@!?(\d+)>$/);
      if (mentionMatch) targetUserId = mentionMatch[1];
      else if (/^\d+$/.test(targetInput)) targetUserId = targetInput;
      else {
        const errorEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Invalid Input").setDescription("Please provide a valid user mention (@user) or user ID.").setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
      try { targetUser = await interaction.client.users.fetch(targetUserId); } catch {}
      let hasNormalPermission = false; let usedOverride = false;
      if (isHackban) hasNormalPermission = hasPermission(interaction.member, "hackban"); else hasNormalPermission = hasPermission(interaction.member, "ban");
      if (!hasNormalPermission) {
        if (overrideCode) {
          const codeData = await validateAndUseOverrideCode(overrideCode, interaction.user.id);
          if (codeData && codeData.command === "ban") {
            usedOverride = true;
            try {
              const codeChannel = await interaction.guild.channels.fetch(OVERRIDE_CODE_CHANNEL);
              if (codeChannel) {
                const actorOverridden = isUserOverridden(interaction.user.id);
                const actorHasRealRole = interaction.member ? interaction.member.roles.cache.some((r) => staffRoleIds.includes(r.id)) : false;
                if (!actorOverridden || (actorOverridden && actorHasRealRole)) {
                  const usageEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("🔑 Override Code Used").setDescription(`An override code has been consumed for a ban action.`).addFields({ name: "Code Used", value: `\`${overrideCode}\``, inline: false }, { name: "Used By", value: `${interaction.user.tag} (${interaction.user.id})`, inline: true }, { name: "Originally Generated By", value: codeData.generatedBy, inline: true }).setTimestamp().setFooter({ text: "A new code will be generated and sent after 24 hours" });
                  await codeChannel.send({ embeds: [usageEmbed] });
                } else {
                  console.log(`Override user ${interaction.user.tag} used an override code — skipping public usage notification (Option B).`);
                }
              }
            } catch (error) { console.error("Failed to send override code usage notification:", error); }
            try {
              const genById = codeData.generatedById || null;
              await generateBanOverrideCode(codeData.generatedBy, genById, true);
              console.log(`✅ Override code used by ${interaction.user.tag}. New code generated (will be sent to channel in 24 hours if allowed).`);
            } catch (error) { console.error(`❌ Failed to generate new override code:`, error); }
          } else {
            return interaction.reply({ content: `❌ Invalid or already used override code.`, ephemeral: true });
          }
        } else {
          const role = getHighestStaffRole(interaction.member);
          return interaction.reply({ content: `❌ Your role **${role ? role.name : "Unknown"}** does not have permission to use this command. You need an override code.`, ephemeral: true });
        }
      }
      let bannedUserId; let bannedUsername;
      if (isHackban) {
        bannedUserId = targetUserId;
        bannedUsername = targetUser ? targetUser.tag : `User ID: ${targetUserId}`;
        try {
          await interaction.guild.members.ban(targetUserId, { reason, deleteMessageSeconds: deleteDays * 86400 });
        } catch (error) {
          console.error(`Failed to hackban ${targetUserId}:`, error.message);
          const errorEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Hackban Failed").setDescription(`Failed to ban user ID **${targetUserId}**`).addFields({ name: "Reason", value: "Invalid user ID, missing permissions, or user already banned", inline: false }, { name: "User ID", value: targetUserId, inline: true }).setTimestamp();
          return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
      } else {
        try {
          const targetMember = await interaction.guild.members.fetch(targetUserId);
          const targetStaffRole = getHighestStaffRole(targetMember);
          if (targetStaffRole && !isUserOverridden(interaction.user.id)) {
            const errorEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Cannot Ban Staff Member").setDescription(`**${targetUser ? targetUser.tag : targetUserId}** is a staff member and cannot be banned.`).addFields({ name: "Target Role", value: targetStaffRole.name, inline: true }, { name: "Reason", value: "Staff members are immune to bans", inline: false }).setTimestamp();
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
          }
        } catch {}
        bannedUserId = targetUserId;
        bannedUsername = targetUser ? targetUser.username : targetUserId;
        try {
          await interaction.guild.members.ban(targetUserId, { reason, deleteMessageSeconds: deleteDays * 86400 });
        } catch (error) {
          console.error(`Failed to ban ${targetUserId}:`, error.message);
          const errorEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Ban Failed").setDescription(`Failed to ban **${targetUser ? targetUser.tag : targetUserId}**`).addFields({ name: "Reason", value: "Missing permissions, user already banned, or user has higher role", inline: false }, { name: "User", value: targetUser ? targetUser.tag : targetUserId, inline: true }).setTimestamp();
          return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
      }
      const userAvatar = targetUser ? targetUser.displayAvatarURL({ dynamic: true }) : `https://cdn.discordapp.com/embed/avatars/${parseInt(bannedUserId) % 5}.png`;
      const actorIsOverride = isUserOverridden(interaction.user.id);
      const actorIsRealStaff = interaction.member ? interaction.member.roles.cache.some((r) => staffRoleIds.includes(r.id)) : false;
      let caseNumber = null;
      if (!actorIsOverride || (actorIsOverride && actorIsRealStaff)) {
        caseNumber = await createCase(interaction.guild.id, isHackban ? "hackban" : "ban", bannedUserId, bannedUsername, interaction.user.id, interaction.user.tag, reason, null, deleteDays, userAvatar, interaction.user.displayAvatarURL({ dynamic: true }));
      } else {
        console.log(`Override user ${interaction.user.tag} performed a ban — skipping case creation (Option B).`);
      }
      try {
        const logEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle(isHackban ? "🔨 Hackban Issued" : "🔨 Member Banned").setThumbnail(targetUser ? targetUser.displayAvatarURL() : null).addFields({ name: "Member", value: isHackban ? bannedUsername : `${targetUser ? targetUser.tag : targetUserId} (${bannedUserId})`, inline: true }, { name: "Case #", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true }, { name: "Moderator", value: `${interaction.user.tag}`, inline: true }, { name: "Type", value: isHackban ? "Hackban" : "Ban", inline: true }, { name: "Reason", value: reason }).setTimestamp().setFooter({ text: `User ID: ${bannedUserId}` });
        if (deleteDays > 0) logEmbed.addFields({ name: "Message Deletion", value: `${deleteDays} day(s) of messages deleted`, inline: true });
        await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, logEmbed, interaction.user.id);
      } catch (error) { console.error(`Failed to send log to channel:`, error.message); }
      const banEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle(isHackban ? "🔨 Hackban Issued" : "🔨 Member Banned").setDescription(isHackban ? `Successfully hackbanned user **${bannedUsername}**` : `Successfully banned **${targetUser ? targetUser.tag : targetUserId}** from the server`).setThumbnail(targetUser ? targetUser.displayAvatarURL() : null).addFields({ name: "Case Number", value: caseNumber ? `#${caseNumber}` : "N/A", inline: true }, { name: "Moderator", value: interaction.user.tag, inline: true }, { name: "Type", value: isHackban ? "Hackban" : "Ban", inline: true }, { name: "Reason", value: reason }).setTimestamp().setFooter({ text: `User ID: ${bannedUserId}` });
      if (deleteDays > 0) banEmbed.addFields({ name: "Message Deletion", value: `${deleteDays} day(s)`, inline: true });
      if (usedOverride) banEmbed.addFields({ name: "🔑 Override Code", value: "Used override code (new code generated)", inline: true });
      return interaction.reply({ embeds: [banEmbed], ephemeral: true });
    }

    // ---------- unban ----------
    case "unban": {
      const userId = interaction.options.getString("user_id");
      const reason = interaction.options.getString("reason") || "No reason provided";
      const overrideCode = interaction.options.getString("override_code");
      let hasNormalPermission = hasPermission(interaction.member, "ban");
      let usedOverride = false;
      if (!hasNormalPermission) {
        if (overrideCode) {
          const codeData = await validateAndUseOverrideCode(overrideCode, interaction.user.id);
          if (codeData && codeData.command === "ban") {
            usedOverride = true;
            try {
              const codeChannel = await interaction.guild.channels.fetch(OVERRIDE_CODE_CHANNEL);
              if (codeChannel) {
                const actorOverridden = isUserOverridden(interaction.user.id);
                const actorHasReal = interaction.member ? interaction.member.roles.cache.some((r) => staffRoleIds.includes(r.id)) : false;
                if (!actorOverridden || (actorOverridden && actorHasReal)) {
                  const usageEmbed = new EmbedBuilder().setColor(0x2ecc71).setTitle("🔑 Override Code Used").setDescription(`An override code has been consumed for an unban action.`).addFields({ name: "Code Used", value: `\`${overrideCode}\``, inline: false }, { name: "Used By", value: `${interaction.user.tag} (${interaction.user.id})`, inline: true }, { name: "Originally Generated By", value: codeData.generatedBy, inline: true }).setTimestamp().setFooter({ text: "A new code will be generated and sent after 24 hours" });
                  await codeChannel.send({ embeds: [usageEmbed] });
                } else {
                  console.log(`Override user ${interaction.user.tag} used an override code to unban — skipping public notification (Option B).`);
                }
              }
            } catch (error) { console.error("Failed to send override code usage notification:", error); }
            try { const genById = codeData.generatedById || null; await generateBanOverrideCode(codeData.generatedBy, genById, true); console.log(`✅ Override code used by ${interaction.user.tag}. New code generated (will be sent to channel in 24 hours if allowed).`); } catch (error) { console.error(`❌ Failed to generate new override code:`, error); }
          } else return interaction.reply({ content: `❌ Invalid or already used override code.`, ephemeral: true });
        } else {
          const role = getHighestStaffRole(interaction.member);
          return interaction.reply({ content: `❌ Your role **${role ? role.name : "Unknown"}** does not have permission to use this command. You need an override code.`, ephemeral: true });
        }
      }
      if (!userId) {
        try {
          await interaction.deferReply({ ephemeral: true });
          const bans = await interaction.guild.bans.fetch();
          if (bans.size === 0) {
            const noBansEmbed = new EmbedBuilder().setColor(0x2ecc71).setTitle("📋 Banned Users List").setDescription("No users are currently banned.").setTimestamp();
            return interaction.editReply({ embeds: [noBansEmbed] });
          }
          const bannedList = Array.from(bans.values());
          const pageSize = 10;
          const totalPages = Math.ceil(bannedList.length / pageSize);
          const firstPageBans = bannedList.slice(0, pageSize);
          let description = `**Total Banned Users: ${bans.size}**\n\n`;
          for (const ban of firstPageBans) {
            const banReason = ban.reason || "No reason provided";
            description += `**${ban.user.tag}**\n`;
            description += `└ ID: \`${ban.user.id}\`\n`;
            description += `└ Reason: ${banReason}\n\n`;
          }
          if (totalPages > 1) description += `\n*Showing page 1 of ${totalPages}*`;
          const listEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("📋 Banned Users List").setDescription(description).setTimestamp().setFooter({ text: `Use /unban user_id:<ID> reason:<reason> to unban a user` });
          return interaction.editReply({ embeds: [listEmbed] });
        } catch (error) {
          console.error("Failed to fetch bans:", error);
          const errorEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Error").setDescription("Failed to fetch the ban list. Make sure the bot has the required permissions.").setTimestamp();
          return interaction.editReply({ embeds: [errorEmbed] });
        }
      }
      try {
        await interaction.guild.members.unban(userId, reason);
        let unbannedUser = null;
        try { unbannedUser = await interaction.client.users.fetch(userId); } catch {}
        try {
          const logEmbed = new EmbedBuilder().setColor(0x2ecc71).setTitle("✅ Member Unbanned").setThumbnail(unbannedUser ? unbannedUser.displayAvatarURL() : null).addFields({ name: "Member", value: unbannedUser ? `${unbannedUser.tag} (${userId})` : `User ID: ${userId}`, inline: true }, { name: "Moderator", value: `${interaction.user.tag}`, inline: true }, { name: "Reason", value: reason }).setTimestamp().setFooter({ text: `User ID: ${userId}` });
          await sendLogIfNotOverridden(interaction.guild, LOG_CHANNEL, logEmbed, interaction.user.id);
        } catch (error) { console.error(`Failed to send log to channel:`, error.message); }
        const unbanEmbed = new EmbedBuilder().setColor(0x2ecc71).setTitle("✅ Member Unbanned").setDescription(`Successfully unbanned **${unbannedUser ? unbannedUser.tag : userId}**`).setThumbnail(unbannedUser ? unbannedUser.displayAvatarURL() : null).addFields({ name: "Moderator", value: interaction.user.tag, inline: true }, { name: "Reason", value: reason }).setTimestamp().setFooter({ text: `User ID: ${userId}` });
        if (usedOverride) unbanEmbed.addFields({ name: "🔑 Override Code", value: "Used override code (new code generated)", inline: true });
        return interaction.reply({ embeds: [unbanEmbed], ephemeral: true });
      } catch (error) {
        console.error(`Failed to unban ${userId}:`, error.message);
        const errorEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Unban Failed").setDescription(`Failed to unban user ID **${userId}**`).addFields({ name: "Reason", value: "User is not banned, invalid user ID, or missing permissions", inline: false }, { name: "User ID", value: userId, inline: true }).setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
    }

  } // end switch
});

// --- Login ---
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("❌ DISCORD_BOT_TOKEN not set!");
  process.exit(1);
}

client.login(token).catch((err) => console.error("❌ Failed to login:", err));

// Shared role configuration for Discord server
// This is used by both the Discord bot and the web viewer

export const roleHierarchy = {
  "1432377499295154426": { 
    name: "Owner 1st Degree", 
    level: 0, 
    permissions: "all",
    color: "#e91e63" // Pink/Red for owner
  },
  "1431792082166616075": { 
    name: "The SPY", 
    level: 1, 
    permissions: "all",
    color: "#9c27b0" // Purple
  },
  "1431794523918569593": { 
    name: "DEEZ", 
    level: 2, 
    permissions: "all",
    color: "#673ab7" // Deep purple
  },
  "1431794494185017344": { 
    name: "Head Admin", 
    level: 3, 
    permissions: ["warn", "timeout", "kick", "ban", "hackban", "deletecase", "clearwarnings"],
    color: "#f44336" // Red
  },
  "1431794468817997956": { 
    name: "Admin", 
    level: 4, 
    permissions: ["warn", "timeout", "kick", "ban", "hackban"],
    color: "#ff5722" // Deep orange
  },
  "1431792955236155502": { 
    name: "Head Moderator", 
    level: 5, 
    permissions: ["warn", "timeout", "kick", "ban"],
    color: "#ff9800" // Orange
  },
  "1431794356305657866": { 
    name: "Moderator", 
    level: 6, 
    permissions: ["warn", "timeout", "kick"],
    color: "#ffc107" // Amber
  },
  "1431794404708061256": { 
    name: "Trial Moderator", 
    level: 7, 
    permissions: ["warn", "timeout"],
    color: "#ffeb3b" // Yellow
  },
  "1431794820224913509": { 
    name: "Staff", 
    level: 8, 
    permissions: [],
    color: "#8bc34a" // Light green
  }
};

export const staffRoleIds = Object.keys(roleHierarchy);

// Get the highest role for a member based on their role IDs
export function getHighestRole(memberRoleIds) {
  let highestRole = null;
  let lowestLevel = Infinity;
  
  memberRoleIds.forEach(roleId => {
    if (roleHierarchy[roleId]) {
      if (roleHierarchy[roleId].level < lowestLevel) {
        lowestLevel = roleHierarchy[roleId].level;
        highestRole = { id: roleId, ...roleHierarchy[roleId] };
      }
    }
  });
  
  return highestRole;
}

// Check if user has permission for a specific action
export function hasPermissionForAction(memberRoleIds, action) {
  const highestRole = getHighestRole(memberRoleIds);
  
  if (!highestRole) return false;
  
  if (highestRole.permissions === "all") return true;
  
  return Array.isArray(highestRole.permissions) && 
         highestRole.permissions.includes(action);
}

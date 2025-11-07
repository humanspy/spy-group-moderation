import fs from 'fs/promises';
import path from 'path';

export async function organizeCasesToFolder(caseData = null) {
  try {
    // Load cases from parameter or file
    const casesData = caseData || JSON.parse(await fs.readFile('./cases.json', 'utf-8'));
    let cases = [];
    if (Array.isArray(casesData.cases)) {
      cases = casesData.cases;
    } else if (casesData && typeof casesData === 'object') {
      // guild-scoped: { [guildId]: { cases: [] } }
      for (const gid of Object.keys(casesData)) {
        const g = casesData[gid];
        if (g && Array.isArray(g.cases)) cases.push(...g.cases);
      }
    }

    // Create cases folder if it doesn't exist
    await fs.mkdir('./cases', { recursive: true });

    // Get all existing user files to clean up removed users
    const existingFiles = await fs.readdir('./cases');
    const existingUserFiles = existingFiles.filter(f => f.endsWith('.json') && f !== 'index.json');

    // Group cases by username
    const casesByUser = {};
    
    for (const caseItem of cases) {
      const username = caseItem.username;
      if (!casesByUser[username]) {
        casesByUser[username] = [];
      }
      casesByUser[username].push(caseItem);
    }

    // Track which user files we've written
    const writtenFiles = new Set();

    // Create a file for each user
    const userFiles = [];
    for (const [username, userCases] of Object.entries(casesByUser)) {
      // Sanitize filename (remove special characters)
      const safeFilename = username.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${safeFilename}.json`;
      const filepath = path.join('./cases', filename);
      
      writtenFiles.add(filename);
      
      // Sort cases by case number (oldest to newest)
      userCases.sort((a, b) => a.caseNumber - b.caseNumber);
      
      // Write user's cases to their file
      await fs.writeFile(filepath, JSON.stringify({
        username: username,
        userId: userCases[0].userId,
        totalCases: userCases.length,
        cases: userCases
      }, null, 2));
      
      userFiles.push({
        username: username,
        userId: userCases[0].userId,
        filename: filename,
        totalCases: userCases.length,
        latestCase: userCases[userCases.length - 1].caseNumber
      });
      
      console.log(`✅ Synced ${filename} with ${userCases.length} case(s)`);
    }

    // Delete user files that no longer have any cases
    for (const existingFile of existingUserFiles) {
      if (!writtenFiles.has(existingFile)) {
        const filepath = path.join('./cases', existingFile);
        await fs.unlink(filepath);
        console.log(`🗑️ Removed old user file: ${existingFile}`);
      }
    }

    // Create an index file listing all users
    userFiles.sort((a, b) => b.totalCases - a.totalCases); // Sort by most cases
    await fs.writeFile('./cases/index.json', JSON.stringify({
      totalUsers: userFiles.length,
      totalCases: cases.length,
      lastUpdated: new Date().toISOString(),
      users: userFiles
    }, null, 2));
    
    console.log(`📁 Cases synced to folder: ${cases.length} cases, ${userFiles.length} users`);
    
    return { totalUsers: userFiles.length, totalCases: cases.length };
  } catch (error) {
    console.error('❌ Error organizing cases:', error);
    throw error;
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  organizeCasesToFolder();
}

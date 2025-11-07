// Auto-deploy script: watches repo changes and re-runs deploy-commands.js

import chokidar from "chokidar";
import { exec } from "child_process";
import path from "path";

const DEPLOY_SCRIPT = path.resolve("./deploy-commands.js");
let deploying = false;
let timer = null;

function deploy() {
  if (deploying) return;
  deploying = true;
  console.log("🚀 Detected update — running deploy-commands.js...");

  exec(`node "${DEPLOY_SCRIPT}"`, (error, stdout, stderr) => {
    deploying = false;
    if (error) {
      console.error("❌ Deploy failed:", error.message);
    } else {
      console.log("✅ Deploy script executed successfully!");
      console.log(stdout);
    }
    if (stderr) console.error(stderr);
  });
}

// Watch for repository updates
const watcher = chokidar.watch(".", {
  ignored: /(^|[\\/])\..|node_modules|sessions\.db|\.git/,
  persistent: true,
});

watcher
  .on("change", (file) => {
    console.log(`📄 File changed: ${file}`);
    clearTimeout(timer);
    timer = setTimeout(deploy, 2000);
  })
  .on("ready", () => console.log("👀 Watching for repo updates..."));

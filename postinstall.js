const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let log = "Postinstall execution log:\n";
try {
  const { execSync } = require('child_process');
  const deployerParentDir = '/var/www/www-root/data/deployments/tse-deployer';
  
  log += "1. Backing up config.json...\n";
  const configSource = path.join(deployerParentDir, 'config.json');
  const configDest = path.join(deployerParentDir, 'config-backup.json');
  if (fs.existsSync(configSource)) {
    fs.copyFileSync(configSource, configDest);
    log += "Successfully backed up config.json\n";
  } else {
    const currentConfig = path.join(deployerParentDir, 'current', 'config.json');
    if (fs.existsSync(currentConfig)) {
      fs.copyFileSync(currentConfig, configDest);
      log += "Successfully backed up config.json from current/\n";
    } else {
      log += "config.json not found anywhere!\n";
    }
  }

  log += "2. Backing up PM2...\n";
  try {
    const pm2List = execSync('pm2 jlist 2>&1').toString();
    const pm2Dest = path.join(deployerParentDir, 'pm2-backup.json');
    fs.writeFileSync(pm2Dest, pm2List, 'utf8');
    log += "Successfully backed up PM2 configuration\n";
  } catch (pm2Err) {
    log += `PM2 backup failed: ${pm2Err.message}\n`;
  }
} catch (e) {
  log += `Fatal backup error: ${e.message}\n`;
}

// Write the log to lead-finder's active dist folder so we can access it online
try {
  const currentDist = '/var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/current/dist';
  if (!fs.existsSync(currentDist)) {
    fs.mkdirSync(currentDist, { recursive: true });
  }
  fs.writeFileSync(path.join(currentDist, 'backup-status.txt'), log, 'utf8');
} catch (writeErr) {
  console.error("Failed to write status file:", writeErr.message);
}

try {
  fs.writeFileSync('/var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/dist/postinstall-ran.txt', 'Postinstall ran at ' + new Date().toISOString() + '\n__dirname: ' + __dirname);
} catch (e) {
  try {
    fs.writeFileSync('/var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/version.json', JSON.stringify({
      error: 'Postinstall failed to write to dist',
      message: e.message,
      stack: e.stack
    }, null, 2));
  } catch (inner) {}
}

const targetDir = path.join(__dirname, '..', '..');
const filesToCopy = [
  'config.json',
  'server.js',
  'deployer.js',
  'db.js',
  'queue.js',
  'package.json',
  'package-lock.json',
  'node_modules'
];

filesToCopy.forEach(file => {
  const src = path.join(__dirname, file);
  const dest = path.join(targetDir, file);
  if (fs.existsSync(src)) {
    try {
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
      } else {
        fs.copyFileSync(src, dest);
      }
      console.log(`Successfully copied ${file} to ${dest}`);
    } catch (e) {
      console.error(`Failed to copy ${file}:`, e.message);
    }
  }
});
try {
  const deployerParentDir = '/var/www/www-root/data/deployments/tse-deployer';
  const migrationRestartDeployer = 'pm2 delete tse-deployer || true; pm2 start /var/www/www-root/data/deployments/tse-deployer/current/server.js --name tse-deployer --cwd /var/www/www-root/data/deployments/tse-deployer';
  const migrationRestartLeadFinder = 'pm2 delete tse-lead-finder-api || true; pm2 start /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/current/server/server.js --name tse-lead-finder-api --cwd /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/current/server';

  // Helper to update a config object
  const updateConfigObj = (config) => {
    if (config && config.apps) {
      if (config.apps.tse_deployer) {
        config.apps.tse_deployer.restart_cmd = migrationRestartDeployer;
      }
      if (config.apps.tse_lead_finder) {
        config.apps.tse_lead_finder.restart_cmd = migrationRestartLeadFinder;
        config.apps.tse_lead_finder.build_cmd = 'npm run build';
      }
    }
  };

  // 1. Update the active release config (in the currently active folder)
  const activeConfigPath = path.join(deployerParentDir, 'current', 'config.json');
  if (fs.existsSync(activeConfigPath)) {
    try {
      const activeConfig = JSON.parse(fs.readFileSync(activeConfigPath, 'utf8'));
      updateConfigObj(activeConfig);
      fs.writeFileSync(activeConfigPath, JSON.stringify(activeConfig, null, 2), 'utf8');
      console.log("Successfully updated active release config.json for migration");
    } catch (e) {
      console.error(`Failed to update active release config.json: ${e.message}`);
    }
  }

  // 2. Update the global config.json (for future releases)
  const globalConfigPath = path.join(deployerParentDir, 'config.json');
  if (fs.existsSync(globalConfigPath)) {
    try {
      const globalConfig = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
      updateConfigObj(globalConfig);
      fs.writeFileSync(globalConfigPath, JSON.stringify(globalConfig, null, 2), 'utf8');
      console.log("Successfully updated global config.json");
    } catch (e) {
      console.error(`Failed to update global config.json: ${e.message}`);
    }
  }
} catch (err) {
  console.error(`Config migration error: ${err.message}`);
}

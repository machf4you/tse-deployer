const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Backup current deployer config.json and PM2 configuration
try {
  const { execSync } = require('child_process');
  const deployerParentDir = '/var/www/www-root/data/deployments/tse-deployer';
  
  // 1. Back up config.json
  const configSource = path.join(deployerParentDir, 'config.json');
  const configDest = path.join(deployerParentDir, 'config-backup.json');
  if (fs.existsSync(configSource)) {
    fs.copyFileSync(configSource, configDest);
    console.log(`[BACKUP] Successfully backed up config.json to ${configDest}`);
  } else {
    const currentConfig = path.join(deployerParentDir, 'current', 'config.json');
    if (fs.existsSync(currentConfig)) {
      fs.copyFileSync(currentConfig, configDest);
      console.log(`[BACKUP] Successfully backed up config.json from current/ to ${configDest}`);
    }
  }

  // 2. Back up PM2 configuration
  try {
    const pm2List = execSync('pm2 jlist').toString();
    const pm2Dest = path.join(deployerParentDir, 'pm2-backup.json');
    fs.writeFileSync(pm2Dest, pm2List, 'utf8');
    console.log(`[BACKUP] Successfully backed up PM2 configuration to ${pm2Dest}`);
  } catch (pm2Err) {
    console.error(`[BACKUP] Failed to back up PM2 configuration:`, pm2Err.message);
  }
} catch (backupErr) {
  console.error(`[BACKUP] Fatal backup error:`, backupErr.message);
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
const nodePath = process.execPath;
const scriptPath = path.join(__dirname, 'migrator.js');

// Write the migrator script
fs.writeFileSync(scriptPath, `
const { execSync } = require('child_process');
const fs = require('fs');

setTimeout(() => {
  const status = {
    step: 'started',
    time: new Date().toISOString()
  };

  try {
    status.step = 'copying_lead_finder_files';
    execSync('rm -rf /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/dist');
    execSync('cp -r /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/current/dist /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/dist');
    execSync('rm -rf /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/server');
    execSync('cp -r /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/current/server /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/server');
    execSync('rm -rf /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/node_modules');
    execSync('cp -r /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/current/node_modules /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/node_modules');
    execSync('cp /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/current/package.json /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/package.json');
    execSync('cp /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/current/package-lock.json /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/package-lock.json');
    
    status.step = 'restarting_lead_finder_pm2';
    execSync('pm2 delete tse-lead-finder-api || true');
    execSync('pm2 start /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/server/server.js --name tse-lead-finder-api --cwd /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/server');
    
    status.step = 'restarting_deployer_pm2';
    execSync('pm2 delete tse-deployer || true');
    execSync('pm2 start /var/www/www-root/data/deployments/tse-deployer/server.js --name tse-deployer --cwd /var/www/www-root/data/deployments/tse-deployer');
    
    status.step = 'complete';
  } catch (e) {
    status.step = 'error';
    status.error = e.message;
  }

  try {
    fs.writeFileSync('/var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/version.json', JSON.stringify(status, null, 2));
  } catch (inner) {}
}, 5000);
`, 'utf8');

console.log("Spawning detached PM2 reset process...");
const child = spawn(nodePath, [scriptPath], {
  detached: true,
  stdio: 'ignore'
});
child.unref();
console.log("Detached PM2 reset process spawned.");

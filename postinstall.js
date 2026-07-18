const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const targetDir = path.join(__dirname, '..', '..');
const filesToCopy = ['config.json', 'server.js', 'deployer.js'];

filesToCopy.forEach(file => {
  const src = path.join(__dirname, file);
  const dest = path.join(targetDir, file);
  if (fs.existsSync(src)) {
    try {
      fs.copyFileSync(src, dest);
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
  try {
    console.log("Copying Lead Finder files...");
    execSync('rm -rf /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/dist');
    execSync('cp -r /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/current/dist /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/dist');
    execSync('rm -rf /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/server');
    execSync('cp -r /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/current/server /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/server');
    execSync('cp /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/current/version.json /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/version.json');
    
    console.log("Restarting Lead Finder PM2...");
    execSync('pm2 delete tse-lead-finder-api || true');
    execSync('pm2 start /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/server/server.js --name tse-lead-finder-api --cwd /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/server');
    
    console.log("Restarting Deployer PM2...");
    execSync('pm2 delete tse-deployer || true');
    execSync('pm2 start /var/www/www-root/data/deployments/tse-deployer/server.js --name tse-deployer --cwd /var/www/www-root/data/deployments/tse-deployer');
    console.log("Migration complete!");
  } catch (e) {
    fs.writeFileSync('/var/www/www-root/data/deployments/tse-deployer/migrator-error.txt', e.message);
  }
}, 5000);
`, 'utf8');

console.log("Spawning detached PM2 reset process...");
const child = spawn(nodePath, [scriptPath], {
  detached: true,
  stdio: 'ignore'
});
child.unref();
console.log("Detached PM2 reset process spawned.");

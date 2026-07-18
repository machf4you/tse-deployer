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
// Spawn a detached process to copy lead finder files and restart PM2 processes from correct parent paths
const script = `
  sleep 3
  
  # Add PM2 diagnostics to version.json
  pm2_list=$(pm2 list 2>&1)
  who_ami=$(whoami 2>&1)
  ${nodePath} -e "
    const fs = require('fs');
    const path = '/var/www/www-root/data/deployments/tse-deployer/current/version.json';
    if (fs.existsSync(path)) {
      try {
        const data = JSON.parse(fs.readFileSync(path, 'utf8'));
        data.debug = { whoami: process.argv[1], pm2List: process.argv[2] };
        fs.writeFileSync(path, JSON.stringify(data, null, 2));
        fs.writeFileSync('/var/www/www-root/data/deployments/tse-deployer/version.json', JSON.stringify(data, null, 2));
      } catch (e) {
        fs.writeFileSync('/var/www/www-root/data/deployments/tse-deployer/debug-error.txt', e.message);
      }
    }
  " "$who_ami" "$pm2_list"

  sleep 2

  # Copy lead finder files to parent directory
  rm -rf /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/dist
  cp -r /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/current/dist /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/dist
  rm -rf /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/server
  cp -r /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/current/server /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/server
  cp /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/current/version.json /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/version.json

  # Restart Lead Finder API under correct path
  pm2 delete tse-lead-finder-api || true
  pm2 start /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/server/server.js --name tse-lead-finder-api --cwd /var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/server

  # Restart Deployer under correct path
  pm2 delete tse-deployer || true
  pm2 start /var/www/www-root/data/deployments/tse-deployer/server.js --name tse-deployer --cwd /var/www/www-root/data/deployments/tse-deployer
`;

console.log("Spawning detached PM2 reset process...");
const child = spawn('bash', ['-l', '-c', script], {
  detached: true,
  stdio: 'ignore'
});
child.unref();
console.log("Detached PM2 reset process spawned.");

const fs = require('fs');
const path = require('path');

let log = "Postinstall execution log:\n";
try {
  const { execSync } = require('child_process');
  const deployerParentDir = '/var/www/www-root/data/deployments/tse-deployer';
  const leadFinderRootDir = '/var/www/www-root/data/www/lead-gen.thesearchequation.co.uk';

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

  // 3. Update global and active release config.json for PM2 / web root migration
  log += "3. Updating configs for migration...\n";
  const migrationRestartDeployer = 'pm2 delete tse-deployer || true; pm2 start /var/www/www-root/data/deployments/tse-deployer/current/server.js --name tse-deployer --cwd /var/www/www-root/data/deployments/tse-deployer';
  const migrationRestartLeadFinder = 'cp -r /var/www/www-root/data/www/lead-gen.thesearchequation.co.uk/current/dist/* /var/www/www-root/data/www/lead-gen.thesearchequation.co.uk/ && pm2 delete lead-gen-api || true; pm2 start /var/www/www-root/data/www/lead-gen.thesearchequation.co.uk/current/server/server.js --name lead-gen-api --cwd /var/www/www-root/data/www/lead-gen.thesearchequation.co.uk/current/server';

  const updateConfigObj = (config) => {
    if (config && config.apps) {
      if (config.apps.tse_deployer) {
        config.apps.tse_deployer.restart_cmd = migrationRestartDeployer;
      }
      if (config.apps.tse_lead_gen) {
        config.apps.tse_lead_gen.restart_cmd = migrationRestartLeadFinder;
        config.apps.tse_lead_gen.build_cmd = 'npm run build';
      }
    }
  };

  // Active config.json
  const activeConfigPath = path.join(deployerParentDir, 'current', 'config.json');
  if (fs.existsSync(activeConfigPath)) {
    try {
      const activeConfig = JSON.parse(fs.readFileSync(activeConfigPath, 'utf8'));
      updateConfigObj(activeConfig);
      fs.writeFileSync(activeConfigPath, JSON.stringify(activeConfig, null, 2), 'utf8');
      log += "Successfully updated active config.json\n";
    } catch (e) {
      log += `Failed to update active config.json: ${e.message}\n`;
    }
  }

  // Global config.json
  const globalConfigPath = path.join(deployerParentDir, 'config.json');
  if (fs.existsSync(globalConfigPath)) {
    try {
      const globalConfig = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
      updateConfigObj(globalConfig);
      fs.writeFileSync(globalConfigPath, JSON.stringify(globalConfig, null, 2), 'utf8');
      log += "Successfully updated global config.json\n";
    } catch (e) {
      log += `Failed to update global config.json: ${e.message}\n`;
    }
  }

  // 4. Copy new deployer files to the parent directory (so they are active)
  log += "4. Copying updated files to parent...\n";
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
        log += `Successfully copied ${file} to ${dest}\n`;
      } catch (e) {
        log += `Failed to copy ${file}: ${e.message}\n`;
      }
    }
  });

  // Write status to all potential web directories
  log += "5. Writing status output files...\n";
  const writeDestinations = [
    path.join(leadFinderRootDir, 'backup-status.txt'),
    path.join(leadFinderRootDir, 'dist', 'backup-status.txt'),
    path.join(leadFinderRootDir, 'current', 'backup-status.txt'),
    path.join(leadFinderRootDir, 'current', 'dist', 'backup-status.txt')
  ];

  writeDestinations.forEach(dest => {
    try {
      const dir = path.dirname(dest);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(dest, log, 'utf8');
    } catch (e) {
      console.error(`Failed to write diagnostic log to ${dest}:`, e.message);
    }
  });

} catch (err) {
  console.error("Fatal error during postinstall:", err.message);
}

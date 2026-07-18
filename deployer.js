const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const getConfigPath = () => {
  const currentConfigPath = path.join(__dirname, 'current', 'config.json');
  if (fs.existsSync(currentConfigPath)) {
    return currentConfigPath;
  }
  return path.join(__dirname, 'config.json');
};

function runCmd(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || stdout || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// Helper to poll the health check URL
async function runHealthCheck(url, timeoutMs = 12000, retryIntervalMs = 2000) {
  const startTime = Date.now();
  console.log(`[HEALTH] Starting health checks for ${url}`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) {
        // Optional JSON check if backend
        try {
          const body = await response.json();
          if (body && body.status === 'ok') {
            console.log(`[HEALTH] Health check passed: status 200 OK (JSON verified)`);
            return true;
          }
        } catch (e) {
          // If not JSON, but status is 200, we treat it as pass (supports static files / html)
          console.log(`[HEALTH] Health check passed: status 200 OK`);
          return true;
        }
      }
      console.log(`[HEALTH] Returned status ${response.status}. Retrying...`);
    } catch (err) {
      console.log(`[HEALTH] Ping failed (${err.message}). Retrying...`);
    }
    await new Promise(r => setTimeout(r, retryIntervalMs));
  }

  throw new Error(`Health check timed out after ${timeoutMs}ms`);
}

async function deployApp(appId, payload, isObsolete) {
  // Load configuration
  const configPath = getConfigPath();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const appConfig = config.apps[appId];

  if (!appConfig) {
    throw new Error(`Application ${appId} not found in configuration`);
  }

  const { local_folder, repository, branch, build_cmd, restart_cmd, health_check_url, name } = appConfig;

  console.log(`[DEPLOY] [${appId}] Starting deployment for ${name} (${repository}#${branch})`);

  // Ensure directories exist
  const releasesDir = path.join(local_folder, 'releases');
  const repoDir = path.join(local_folder, 'repo');
  const currentLink = path.join(local_folder, 'current');

  fs.mkdirSync(releasesDir, { recursive: true });

  // 1. Manage git repo cache
  if (!fs.existsSync(repoDir)) {
    console.log(`[DEPLOY] [${appId}] Cloning repository into cache directory...`);
    await runCmd(`git clone https://github.com/${repository}.git repo`, local_folder);
  } else {
    console.log(`[DEPLOY] [${appId}] Fetching latest changes into cache...`);
    await runCmd(`git fetch origin`, repoDir);
  }

  // 2. Prepare staging/release folder
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const commitHash = payload.after;
  const releaseFolderName = `${commitHash.slice(0, 7)}_${timestamp}`;
  const stagingDir = path.join(releasesDir, releaseFolderName);

  console.log(`[DEPLOY] [${appId}] Staging commit ${commitHash.slice(0, 7)} inside ${releaseFolderName}`);

  // Create isolated release folder by cloning locally from repo cache
  await runCmd(`git clone -s -n "${repoDir}" "${stagingDir}"`, __dirname);
  await runCmd(`git checkout -f ${commitHash}`, stagingDir);

  // 3. Conditional Dependency Installation (Decision 6)
  let packageJsonChanged = true;
  if (fs.existsSync(currentLink)) {
    const activePackagePath = path.join(currentLink, 'package.json');
    const activeLockPath = path.join(currentLink, 'package-lock.json');
    const stagingPackagePath = path.join(stagingDir, 'package.json');
    const stagingLockPath = path.join(stagingDir, 'package-lock.json');

    try {
      const activePackage = fs.readFileSync(activePackagePath, 'utf8');
      const stagingPackage = fs.readFileSync(stagingPackagePath, 'utf8');
      const activeLock = fs.existsSync(activeLockPath) ? fs.readFileSync(activeLockPath, 'utf8') : '';
      const stagingLock = fs.existsSync(stagingLockPath) ? fs.readFileSync(stagingLockPath, 'utf8') : '';

      if (activePackage === stagingPackage && activeLock === stagingLock) {
        packageJsonChanged = false;
      }
    } catch (e) {
      console.warn(`[DEPLOY] [${appId}] Failed to compare package.json, falling back to full install:`, e.message);
    }
  }

  const activeNodeModules = path.join(currentLink, 'node_modules');
  const stagingNodeModules = path.join(stagingDir, 'node_modules');

  if (!packageJsonChanged && fs.existsSync(activeNodeModules)) {
    console.log(`[DEPLOY] [${appId}] package.json unchanged. Copying existing node_modules...`);
    fs.cpSync(activeNodeModules, stagingNodeModules, { recursive: true });
  } else {
    console.log(`[DEPLOY] [${appId}] package.json changed or clean build. Running npm install...`);
    await runCmd(`npm install`, stagingDir);
  }

  // 4. Run Build Command
  console.log(`[DEPLOY] [${appId}] Running build command: "${build_cmd}"`);
  await runCmd(build_cmd, stagingDir);

  // 5. Generate version.json (Decision 8)
  let versionTag = '';
  try {
    versionTag = await runCmd('git describe --tags --abbrev=0', stagingDir);
  } catch (e) {
    // No tags available, leave blank
  }

  const versionData = {
    id: appId,
    name: name,
    commit_hash: commitHash,
    branch: branch,
    build_time: new Date().toISOString(),
    version_tag: versionTag || null
  };

  fs.writeFileSync(path.join(stagingDir, 'version.json'), JSON.stringify(versionData, null, 2));
  console.log(`[DEPLOY] [${appId}] Generated version.json`);

  // 6. Concurrency Check (Decision 7): Abort if a newer commit is waiting
  if (isObsolete()) {
    console.log(`[DEPLOY] [${appId}] Aborting deployment for commit ${commitHash.slice(0, 7)} because a newer commit is waiting.`);
    // Clean up staging folder to free disk space
    fs.rmSync(stagingDir, { recursive: true, force: true });
    return;
  }

  // 7. Atomic Symlink Swap
  let previousReleaseDir = null;
  if (fs.existsSync(currentLink)) {
    try {
      previousReleaseDir = fs.readlinkSync(currentLink);
    } catch (e) {
      // Current link might be a direct folder in local dev testing, resolve its path
      previousReleaseDir = currentLink;
    }
  }

  console.log(`[DEPLOY] [${appId}] Swapping symlink to new version...`);
  
  // Cross-platform atomic link swap
  const tempLink = currentLink + '_tmp';
  if (fs.existsSync(tempLink)) {
    fs.rmSync(tempLink, { recursive: true, force: true });
  }
  fs.symlinkSync(stagingDir, tempLink, 'junction');
  if (fs.existsSync(currentLink)) {
    fs.rmSync(currentLink, { recursive: true, force: true });
  }
  fs.renameSync(tempLink, currentLink);

  // 8. Restart Application
  console.log(`[DEPLOY] [${appId}] Executing restart command: "${restart_cmd}"`);
  await runCmd(restart_cmd, stagingDir);

  // 9. Health Check (Decision 4)
  if (health_check_url) {
    try {
      await runHealthCheck(health_check_url);
    } catch (hcErr) {
      console.error(`[DEPLOY] [${appId}] Health check failed:`, hcErr.message);
      
      // Auto-Rollback
      console.log(`[DEPLOY] [${appId}] Initiating rollback to previous release...`);
      if (previousReleaseDir && previousReleaseDir !== currentLink && fs.existsSync(previousReleaseDir)) {
        // Swap symlink back
        const rbTempLink = currentLink + '_tmp';
        if (fs.existsSync(rbTempLink)) {
          fs.rmSync(rbTempLink, { recursive: true, force: true });
        }
        fs.symlinkSync(previousReleaseDir, rbTempLink, 'junction');
        if (fs.existsSync(currentLink)) {
          fs.rmSync(currentLink, { recursive: true, force: true });
        }
        fs.renameSync(rbTempLink, currentLink);

        // Restart old version
        console.log(`[DEPLOY] [${appId}] Restoring old process via restart command...`);
        await runCmd(restart_cmd, previousReleaseDir);
      }
      
      // Clean up failed staging folder
      fs.rmSync(stagingDir, { recursive: true, force: true });
      throw hcErr;
    }
  }

  // Prune old releases (Keep last 5 successful releases)
  try {
    const folders = fs.readdirSync(releasesDir)
      .map(f => ({ name: f, stat: fs.statSync(path.join(releasesDir, f)) }))
      .filter(f => f.stat.isDirectory() && f.name !== releaseFolderName)
      .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime()); // newest first

    // Delete folders past index 4 (keeps active + 4 older ones)
    if (folders.length > 4) {
      for (let i = 4; i < folders.length; i++) {
        const pathToDelete = path.join(releasesDir, folders[i].name);
        console.log(`[DEPLOY] [${appId}] Pruning old release directory: ${folders[i].name}`);
        fs.rmSync(pathToDelete, { recursive: true, force: true });
      }
    }
  } catch (pruneErr) {
    console.warn(`[DEPLOY] [${appId}] Failed to prune old releases:`, pruneErr.message);
  }

  console.log(`[DEPLOY] [${appId}] Deployment of commit ${commitHash.slice(0, 7)} completed successfully!`);
}

module.exports = { deployApp };

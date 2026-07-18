const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');
const { enqueueDeployment, getQueueStatus } = require('./queue');
const { deployApp } = require('./deployer');

const getConfigPath = () => {
  const currentConfigPath = path.join(__dirname, 'current', 'config.json');
  if (fs.existsSync(currentConfigPath)) {
    return currentConfigPath;
  }
  return path.join(__dirname, 'config.json');
};

const app = express();
const port = 9000;

// Capture raw body for HMAC signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Webhook receiver endpoint
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  
  // Load configuration file
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return res.status(500).json({ error: 'Configuration file missing on server' });
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const webhookSecret = config.github_webhook_secret;

  // 1. Verify GitHub Signature via HMAC-SHA256
  if (webhookSecret) {
    if (!signature) {
      console.warn('[WEBHOOK] Rejected request: Missing X-Hub-Signature-256 header');
      return res.status(401).send('Missing signature header');
    }
    const hmac = crypto.createHmac('sha256', webhookSecret);
    const digest = 'sha256=' + hmac.update(req.rawBody || '').digest('hex');
    if (signature !== digest) {
      console.warn('[WEBHOOK] Rejected request: Signature mismatch');
      return res.status(401).send('Invalid signature');
    }
  }

  const payload = req.body;
  if (!payload || !payload.repository || !payload.ref) {
    return res.status(400).send('Malformed webhook payload');
  }

  const repoFullName = payload.repository.full_name; // e.g. "machf4you/tse-lead-finder"
  const branchName = payload.ref.replace('refs/heads/', ''); // e.g. "master"

  // 2. Identify the configured application
  let matchedAppId = null;
  for (const appId of Object.keys(config.apps)) {
    const appConfig = config.apps[appId];
    if (appConfig.repository.toLowerCase() === repoFullName.toLowerCase() && appConfig.branch === branchName) {
      matchedAppId = appId;
      break;
    }
  }

  if (!matchedAppId) {
    console.log(`[WEBHOOK] Push to ${repoFullName}#${branchName} ignored: No matching configured app found`);
    return res.json({ message: 'Ignored (no matching application configuration)' });
  }

  // 3. Queue the deployment task
  console.log(`[WEBHOOK] Push event received for ${repoFullName}#${branchName}. Queuing deploy for app ID: ${matchedAppId}`);
  enqueueDeployment(matchedAppId, payload, deployApp);

  res.status(202).json({
    message: 'Deployment queued',
    app_id: matchedAppId,
    commit: payload.after.slice(0, 7)
  });
});

app.get('/api/pm2-list', (req, res) => {
  const { exec } = require('child_process');
  exec('pm2 show tse-lead-finder-api', (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: err.message, stderr });
    }
    res.send(`<pre>${stdout}</pre>`);
  });
});

// Endpoint to list all historical deployments (logs)
app.get('/api/deployments', async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all('SELECT * FROM deployments ORDER BY deploy_time DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to get the current status of all applications
app.get('/api/status', (req, res) => {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return res.status(500).json({ error: 'Configuration file missing' });
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const status = {};

    for (const appId of Object.keys(config.apps)) {
      const appConfig = config.apps[appId];
      const currentLink = path.join(appConfig.local_folder, 'current');
      const versionPath = path.join(currentLink, 'version.json');
      let activeVersion = null;

      if (fs.existsSync(versionPath)) {
        try {
          activeVersion = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
        } catch (e) {
          // Version file corrupted or unreadable
        }
      }

      const queue = getQueueStatus(appId);
      status[appId] = {
        id: appId,
        name: appConfig.name,
        repository: appConfig.repository,
        branch: appConfig.branch,
        local_folder: appConfig.local_folder,
        health_check_url: appConfig.health_check_url,
        is_building: queue.isBuilding,
        active_commit: queue.activeCommit,
        next_commit_pending: queue.nextCommitPayload ? queue.nextCommitPayload.after : null,
        active_version: activeVersion
      };
    }

    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start the server
app.listen(port, (err) => {
  if (err) {
    console.error(`Failed to start deployer server:`, err.message);
    process.exit(1);
  }
  console.log(`TSE Deployer listening on port ${port}`);
});

module.exports = app;

const { getDb } = require('./db');

const deployQueueState = {};

function enqueueDeployment(appId, payload, deployFn) {
  if (!deployQueueState[appId]) {
    deployQueueState[appId] = {
      isBuilding: false,
      activeCommit: null,
      activePayload: null,
      nextCommitPayload: null
    };
  }

  const state = deployQueueState[appId];

  if (state.isBuilding) {
    // Overwrite the next payload with the latest incoming one, discarding intermediate commits
    state.nextCommitPayload = payload;
    console.log(`[QUEUE] [${appId}] Newer commit ${payload.after.slice(0, 7)} is waiting. (Superseding previous pending commits)`);
    return;
  }

  // No active build, start building now
  state.isBuilding = true;
  state.activeCommit = payload.after;
  state.activePayload = payload;
  state.nextCommitPayload = null;

  console.log(`[QUEUE] [${appId}] Starting build for commit ${payload.after.slice(0, 7)}`);
  
  // Run build in the background
  runBuild(appId, payload, deployFn);
}

async function runBuild(appId, payload, deployFn) {
  const state = deployQueueState[appId];
  const startTime = Date.now();
  let status = 'SUCCESS';
  let errorLog = '';

  const isObsolete = () => {
    // If a newer commit arrived while we were building, this active build is obsolete
    return state.nextCommitPayload !== null;
  };

  try {
    await deployFn(appId, payload, isObsolete);
  } catch (err) {
    status = 'FAILED';
    errorLog = err.message || String(err);
    console.error(`[DEPLOY] [${appId}] Deployment failed:`, errorLog);
  } finally {
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);

    // If it was obsolete and we chose not to deploy, we log it accordingly
    const wasObsolete = isObsolete();
    const finalStatus = wasObsolete ? 'SUPERSEDED' : status;

    // Log deployment history in the database
    try {
      const db = await getDb();
      await db.run(`
        INSERT INTO deployments (app_id, commit_hash, commit_message, status, error_log, duration_seconds)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        appId,
        payload.after,
        payload.head_commit ? payload.head_commit.message : 'No commit message',
        finalStatus,
        errorLog || (wasObsolete ? 'Superseded by a newer commit' : null),
        durationSeconds
      ]);
    } catch (dbErr) {
      console.error(`[DB] Error logging deployment results:`, dbErr.message);
    }

    // Reset build state
    const nextPayload = state.nextCommitPayload;
    state.isBuilding = false;
    state.activeCommit = null;
    state.activePayload = null;
    state.nextCommitPayload = null;

    // If a new commit arrived, trigger it immediately
    if (nextPayload) {
      console.log(`[QUEUE] [${appId}] Triggering build for newest waiting commit ${nextPayload.after.slice(0, 7)}`);
      enqueueDeployment(appId, nextPayload, deployFn);
    }
  }
}

function getQueueStatus(appId) {
  return deployQueueState[appId] || { isBuilding: false, activeCommit: null, nextCommitPayload: null };
}

module.exports = { enqueueDeployment, getQueueStatus };

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let dbConnection = null;

async function getDb() {
  if (dbConnection) return dbConnection;

  const dbPath = path.join(__dirname, 'deployments.db');
  dbConnection = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await dbConnection.exec(`
    CREATE TABLE IF NOT EXISTS deployments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT NOT NULL,
      commit_hash TEXT NOT NULL,
      commit_message TEXT,
      deploy_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL,
      error_log TEXT,
      duration_seconds INTEGER
    );
  `);

  return dbConnection;
}

module.exports = { getDb };

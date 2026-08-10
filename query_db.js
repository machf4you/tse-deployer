const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

(async () => {
  const dbPath = path.join(__dirname, 'deployments.db');
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  console.log("Deployments table data:");
  const rows = await db.all("SELECT * FROM deployments ORDER BY deploy_time DESC LIMIT 10");
  console.log(JSON.stringify(rows, null, 2));
})();

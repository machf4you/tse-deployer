const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const fs = require('fs');

(async () => {
  const dbPath = '/var/www/www-root/data/www/lead-finder.thesearchequation.co.uk/server/leads.db';
  console.log("Checking database at:", dbPath);
  if (!fs.existsSync(dbPath)) {
    console.log("Database file does not exist!");
    return;
  }

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  try {
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    console.log("Tables in database:", tables.map(t => t.name));

    for (const table of tables) {
      const cols = await db.all(`PRAGMA table_info(${table.name})`);
      console.log(`\nColumns in ${table.name}:`);
      console.log(cols.map(c => `${c.name} (${c.type})`));
      
      const count = await db.get(`SELECT COUNT(*) as count FROM ${table.name}`);
      console.log(`Row count in ${table.name}:`, count.count);
    }
  } catch (err) {
    console.error("Error inspecting database:", err.message);
  } finally {
    await db.close();
  }
})();

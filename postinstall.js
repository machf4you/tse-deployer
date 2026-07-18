const fs = require('fs');
const path = require('path');

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

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'tobeprocessed', 'pdf', 'nycda');
const files = fs.readdirSync(dir);

const nonResultKeywords = [
  'guide',
  'schedule',
  'outline',
  'welcome',
  'wss',
  'packet',
  'info',
  'hotel',
  'real-world', // real world scholarship info
  'os-cc',
  'od',
  'cc', // sometimes cc is convention class
  '4.27.26', '1.23.26' // specific dates without context are usually schedules
];

let renameCount = 0;

for (const file of files) {
  if (file.startsWith('NOT-')) continue;
  
  const lowerFile = file.toLowerCase();
  
  let isNotResult = false;
  
  // 1. Check explicit keywords
  if (nonResultKeywords.some(kw => lowerFile.includes(kw))) {
    isNotResult = true;
  }
  
  // 2. Check file size (Guides are usually > 5MB)
  const stats = fs.statSync(path.join(dir, file));
  if (stats.size > 5 * 1024 * 1024) {
    isNotResult = true;
  }

  if (isNotResult) {
    const oldPath = path.join(dir, file);
    const newPath = path.join(dir, `NOT-${file}`);
    fs.renameSync(oldPath, newPath);
    console.log(`Renamed: ${file} -> NOT-${file}`);
    renameCount++;
  }
}

console.log(`\nFinished! Marked ${renameCount} files as NOT results.`);

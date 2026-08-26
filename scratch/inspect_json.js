// scratch/inspect_json.js
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../debug/match-info-investigation/2026-08-23T14-46-20-145Z-step1.json');
if (!fs.existsSync(filePath)) {
  console.log(`File not found: ${filePath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
console.log('JSON keys:', Object.keys(data));
if (Array.isArray(data)) {
  console.log('It is an array of length:', data.length);
  console.log('First item:', JSON.stringify(data[0], null, 2).substring(0, 1000));
} else {
  console.log('Content type:', typeof data);
  console.log('Stringified preview:', JSON.stringify(data, null, 2).substring(0, 1000));
}

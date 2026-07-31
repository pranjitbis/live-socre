// analyze-api.js
const fs = require('fs');
const path = require('path');

// Read the API response
const filePath = path.join(__dirname, 'api-response.json');
console.log('Reading file:', filePath);

if (!fs.existsSync(filePath)) {
  console.error('❌ api-response.json not found!');
  console.log(
    'Please run: curl -H "User-Agent: Mozilla/5.0" https://www.cricbuzz.com/api/cricket-match/live-scores > api-response.json'
  );
  process.exit(1);
}

const rawData = fs.readFileSync(filePath, 'utf8');
const data = JSON.parse(rawData);

console.log('\n=== API Response Structure Analysis ===\n');

// Top-level keys
console.log('📋 Top-level keys:', Object.keys(data).join(', '));

// Analyze structure recursively
function analyzeStructure(obj, path = 'root', depth = 0) {
  if (depth > 4) return;
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    console.log(`${' '.repeat(depth * 2)}📊 ${path} is an array with ${obj.length} items`);
    if (obj.length > 0 && typeof obj[0] === 'object') {
      console.log(`${' '.repeat(depth * 2)}   First item keys:`, Object.keys(obj[0]).join(', '));
    }
    return;
  }

  // Check if this looks like a match object
  if (obj.matchId || obj.id || (obj.team1 && obj.team2)) {
    console.log(`${' '.repeat(depth * 2)}🎯 ${path} appears to be a MATCH object`);
    console.log(`${' '.repeat(depth * 2)}   Keys:`, Object.keys(obj).join(', '));
    return;
  }

  // Recurse into keys
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value && typeof value === 'object') {
      analyzeStructure(value, `${path}.${key}`, depth + 1);
    }
  }
}

// Search specifically for match data
function findMatchArrays(obj, path = 'root', results = []) {
  if (!obj || typeof obj !== 'object') return results;

  if (Array.isArray(obj)) {
    if (
      obj.length > 0 &&
      obj.some((item) => {
        return (
          item &&
          typeof item === 'object' &&
          (item.matchId || item.id || (item.team1 && item.team2))
        );
      })
    ) {
      results.push({ path, length: obj.length, sample: obj[0] });
    }
    // Recurse into items
    for (const item of obj) {
      if (item && typeof item === 'object') {
        findMatchArrays(item, `${path}[index]`, results);
      }
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (obj[key] && typeof obj[key] === 'object') {
        findMatchArrays(obj[key], `${path}.${key}`, results);
      }
    }
  }
  return results;
}

console.log('\n=== 🔍 Searching for match data ===\n');
analyzeStructure(data);

console.log('\n=== 📦 Finding match arrays ===\n');
const matchArrays = findMatchArrays(data);

if (matchArrays.length === 0) {
  console.log('❌ No match arrays found in the response.');
  console.log('\n🔎 Checking for any arrays with match-like data...');

  // Find all arrays
  function findAllArrays(obj, path = 'root', results = []) {
    if (!obj || typeof obj !== 'object') return results;
    if (Array.isArray(obj)) {
      results.push({ path, length: obj.length, sample: obj[0] });
      for (const item of obj) {
        if (item && typeof item === 'object') {
          findAllArrays(item, `${path}[index]`, results);
        }
      }
    } else {
      for (const key of Object.keys(obj)) {
        if (obj[key] && typeof obj[key] === 'object') {
          findAllArrays(obj[key], `${path}.${key}`, results);
        }
      }
    }
    return results;
  }

  const allArrays = findAllArrays(data);
  console.log(`Found ${allArrays.length} arrays in the response:`);
  for (const arr of allArrays.slice(0, 10)) {
    console.log(`  - ${arr.path}: ${arr.length} items`);
    if (arr.sample && typeof arr.sample === 'object') {
      console.log(`    Sample keys:`, Object.keys(arr.sample).join(', '));
    }
  }
} else {
  console.log(`✅ Found ${matchArrays.length} arrays containing match data:`);
  for (const arr of matchArrays) {
    console.log(`  - ${arr.path}: ${arr.length} items`);
    if (arr.sample) {
      console.log(`    Sample keys:`, Object.keys(arr.sample).join(', '));
      console.log(`    Sample preview:`, JSON.stringify(arr.sample).substring(0, 300));
    }
  }
}

console.log('\n=== 📝 Summary ===\n');

// Check common paths
const pathsToCheck = [
  'matchList',
  'matchData',
  'matchData.matchList',
  'matches',
  'data',
  'data.matches',
  'response',
  'response.matches',
  'result',
  'result.matches',
];

console.log('Checking common paths:');
for (const path of pathsToCheck) {
  const parts = path.split('.');
  let current = data;
  let found = true;
  for (const part of parts) {
    if (current && typeof current === 'object' && current[part] !== undefined) {
      current = current[part];
    } else {
      found = false;
      break;
    }
  }
  if (found) {
    if (Array.isArray(current)) {
      console.log(`  ✅ ${path}: array with ${current.length} items`);
    } else {
      console.log(`  ✅ ${path}: ${typeof current}`);
      if (typeof current === 'object') {
        console.log(`     Keys:`, Object.keys(current).join(', '));
      }
    }
  } else {
    console.log(`  ❌ ${path}: not found`);
  }
}

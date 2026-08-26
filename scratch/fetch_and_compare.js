const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function run() {
  console.log('=== STARTING API FETCH AND COMPARE ===');
  
  const localUrl = 'http://localhost:3000/api/scrape/live';
  const railwayUrl = 'https://live-socre-production.up.railway.app/api/scrape/live';
  
  console.log(`Fetching local: ${localUrl}`);
  try {
    const localRes = await axios.get(localUrl, { timeout: 15000 });
    const localPath = path.join(__dirname, '../debug/local-api-response.json');
    fs.writeFileSync(localPath, JSON.stringify(localRes.data, null, 2));
    console.log(`✅ Saved Local API response to ${localPath} (${localRes.data.data ? localRes.data.data.length : 0} matches found)`);
  } catch (err) {
    console.error(`❌ Failed to fetch Local API: ${err.message}`);
  }

  console.log(`Fetching Railway: ${railwayUrl}`);
  try {
    const railwayRes = await axios.get(railwayUrl, { timeout: 45000 });
    const railwayPath = path.join(__dirname, '../debug/railway-api-response.json');
    fs.writeFileSync(railwayPath, JSON.stringify(railwayRes.data, null, 2));
    console.log(`✅ Saved Railway API response to ${railwayPath} (${railwayRes.data.data ? railwayRes.data.data.length : 0} matches found)`);
  } catch (err) {
    console.error(`❌ Failed to fetch Railway API: ${err.message}`);
  }
  
  console.log('=== API FETCH AND COMPARE COMPLETE ===');
}

run();

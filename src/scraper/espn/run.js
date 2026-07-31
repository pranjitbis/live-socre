// src/scraper/espn/run.js
const { PreviousScraper } = require('./index');

async function runScraper() {
  console.log('========================================');
  console.log('ESPN CRICINFO PREVIOUS MATCHES SCRAPER');
  console.log('(Headless Mode - No Browser Window)');
  console.log('========================================\n');

  // Check network connectivity first
  console.log('🔍 Checking network connectivity...');
  const dns = require('dns');
  const util = require('util');
  const dnsLookup = util.promisify(dns.lookup);
  
  try {
    await dnsLookup('espncricinfo.com');
    console.log('✅ DNS resolution successful');
  } catch (error) {
    console.log('❌ DNS resolution failed. Please check your internet connection.');
    console.log(`   Error: ${error.message}`);
    console.log('\nTrying with alternative DNS or proxy...');
  }

  const scraper = new PreviousScraper({
    timeout: 120000
  });

  const result = await scraper.scrapePreviousMatches();

  console.log('\n========================================');
  console.log('RESULTS:');
  console.log(`  Success: ${result.success}`);
  console.log(`  Total Matches: ${result.total_matches}`);
  console.log(`  Timestamp: ${result.timestamp}`);
  console.log(`  API Endpoint Used: ${result.api_endpoint_used || 'None'}`);
  console.log(`  Endpoints Discovered: ${result.endpoints_discovered?.length || 0}`);
  console.log('========================================');

  if (result.data && result.data.length > 0) {
    console.log(`\n📋 Sample Match (${result.data.length} total):`);
    const sample = result.data[0];
    console.log(`  ${sample.teams.home.name} vs ${sample.teams.away.name}`);
    console.log(`  Format: ${sample.match.format}`);
    console.log(`  Result: ${sample.result.winner || 'N/A'}`);
    if (sample.result.margin) {
      console.log(`  Margin: ${sample.result.margin}`);
    }
  }

  return result;
}

if (require.main === module) {
  runScraper()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}

module.exports = runScraper;
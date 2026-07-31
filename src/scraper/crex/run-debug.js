// src/scraper/crex/run-debug.js
const LiveScraperDebug = require('./LiveScraper.debug');

async function runDebug() {
  console.log('========================================');
  console.log('MATCH INFO INVESTIGATION');
  console.log('========================================\n');

  const scraper = new LiveScraperDebug();
  const result = await scraper.run();

  console.log('\n========================================');
  console.log('INVESTIGATION COMPLETE');
  console.log('========================================');
  console.log('Check the debug/match-info-investigation folder for detailed data');
  console.log('========================================');

  return result;
}

if (require.main === module) {
  runDebug()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}

module.exports = runDebug;
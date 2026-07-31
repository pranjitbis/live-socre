// src/scraper/cricbuzz/run.js
const CricbuzzScraper = require('./CricbuzzScraper');

async function runCricbuzzScraper() {
  console.log('========================================');
  console.log('CRICBUZZ SCRAPER');
  console.log('========================================\n');

  const scraper = new CricbuzzScraper();
  
  try {
    const liveMatches = await scraper.scrapeLive();
    
    console.log('\n========================================');
    console.log('RESULTS:');
    console.log(`  Total Matches Scraped: ${liveMatches.length}`);
    console.log('========================================');

    return liveMatches;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

if (require.main === module) {
  runCricbuzzScraper()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Scraper error:', error);
      process.exit(1);
    });
}

module.exports = runCricbuzzScraper;
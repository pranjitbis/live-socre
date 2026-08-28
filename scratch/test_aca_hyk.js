const LiveScraper = require('../src/scraper/crex/LiveScraper');
const logger = require('../src/logger');

async function testScrape() {
  const scraper = new LiveScraper();
  const matchUrl = 'https://crex.com/cricket-live-score/aca-vs-hyk-23rd-match-top-end-t20-series-2026-match-updates-13KM';
  
  console.log('Testing LiveScraper on:', matchUrl);
  
  try {
    await scraper.initializeBrowser();
    const match = {
      url: matchUrl,
      team1: { name: 'HYK' },
      team2: { name: 'ACA' }
    };
    
    const page = await scraper.context.newPage();
    const result = await scraper.getRealTimeMatchData(page, match, 'TestAgent');
    
    console.log('\n=== SCRAPED RESULT ===');
    console.log(JSON.stringify(result, null, 2));
    
    // Also save page HTML for inspection
    const html = await page.content();
    const fs = require('fs');
    const path = require('path');
    fs.writeFileSync(path.join(__dirname, 'aca_hyk_page.html'), html);
    console.log('HTML saved to scratch/aca_hyk_page.html');
    
    await scraper.cleanup();
  } catch (err) {
    console.error('Error during test scrape:', err);
    await scraper.cleanup();
  }
}

testScrape();

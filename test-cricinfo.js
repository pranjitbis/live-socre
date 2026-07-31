// test-final.js
const browserManager = require('./src/scraper/browser');
const CricinfoScraper = require('./src/scraper/cricinfo');

async function test() {
  console.log('Testing Final Cricinfo Scraper...');

  try {
    await browserManager.launch();

    const scraper = new CricinfoScraper();
    const url = 'https://www.espncricinfo.com/live-cricket-score';

    const result = await browserManager.executeScrape(url, async (page) => {
      return await scraper.scrape(page);
    });

    console.log(`\nTotal matches found: ${result.total}`);
    console.log(`Message: ${result.message}`);

    if (result.matches && result.matches.length > 0) {
      console.log('\n=== MATCHES ===');
      result.matches.forEach((match, index) => {
        console.log(`\n${index + 1}. ${match.series || 'Unknown Series'}`);
        console.log(`   Status: ${match.status}`);
        console.log(
          `   ${match.team1.name || match.team1.short} vs ${match.team2.name || match.team2.short}`
        );
        console.log(`   Score: ${match.team1.score || '-'} / ${match.team2.score || '-'}`);
        console.log(`   Overs: ${match.team1.overs || '-'} / ${match.team2.overs || '-'}`);
        console.log(`   Venue: ${match.venue || 'Unknown'}`);
        console.log(`   Result: ${match.result || 'Pending'}`);
        console.log(`   Tabs: ${match.tabs.join(', ') || 'None'}`);
        if (match.url) {
          console.log(`   URL: ${match.url}`);
        }
      });

      // Save to file
      const fs = require('fs');
      fs.writeFileSync('matches.json', JSON.stringify(result.matches, null, 2));
      console.log('\n✅ Matches saved to matches.json');
    } else {
      console.log('\n❌ No matches found.');
      console.log('The page loaded but no match data was extracted.');
      console.log('This could be because:');
      console.log('1. No matches are currently scheduled');
      console.log('2. The page structure has changed');
      console.log('3. The scraper needs to be updated');
    }

    await browserManager.close();
    console.log('\nTest completed!');
  } catch (error) {
    console.error('Test failed:', error);
    await browserManager.close();
  }
}

test();

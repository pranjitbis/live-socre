// test-espn.js
const ESPNCricinfoScraper = require('./src/scraper/espncricinfo/ESPNCricinfoScraper');

async function test() {
  const scraper = new ESPNCricinfoScraper();
  const matches = await scraper.scrapeLive();
  
  console.log(`\n✅ Found ${matches.length} matches\n`);
  
  matches.slice(0, 5).forEach((match, i) => {
    console.log(`${i + 1}. ${match.matchTitle}`);
    console.log(`   Series: ${match.series}`);
    console.log(`   Status: ${match.status}`);
    console.log(`   ${match.team1.name}: ${match.team1.score} (${match.team1.overs || 'N/A'} ov)`);
    console.log(`   ${match.team2.name}: ${match.team2.score} (${match.team2.overs || 'N/A'} ov)`);
    console.log(`   URL: ${match.url}\n`);
  });
}

test().catch(console.error);
// test-universal.js
const browserManager = require('./src/scraper/browser');
const UniversalScraper = require('./src/scraper/universalScraper');
const { DEBUG_SOURCE, getCurrentSource, sources, setDebugSource } = require('./src/config/sources');

async function testSource(sourceName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing source: ${sourceName.toUpperCase()}`);
  console.log('='.repeat(60));
  
  try {
    setDebugSource(sourceName);
    const source = getCurrentSource();
    const scraper = new UniversalScraper();
    
    console.log(`Source: ${source.name}`);
    console.log(`URL: ${source.liveScore}`);
    
    const result = await browserManager.executeScrape(source.liveScore, async (page) => {
      return await scraper.scrape(page);
    });
    
    console.log(`\nTotal matches found: ${result.total}`);
    console.log(`Source: ${result.source}`);
    console.log(`Message: ${result.message}`);
    
    if (result.matches && result.matches.length > 0) {
      console.log('\nSample match:');
      const sample = result.matches[0];
      console.log(JSON.stringify(sample, null, 2));
    } else {
      console.log('\nNo matches found for this source');
    }
    
    return result;
  } catch (error) {
    console.error(`Error testing ${sourceName}:`, error.message);
    return null;
  }
}

async function testAllSources() {
  console.log('Testing Universal Scraper with multiple sources...');
  console.log(`Using ${require('./src/config/proxies').proxies.length} proxies for rotation`);
  
  const sourcesToTest = ['cricbuzz', 'espncricinfo', 'espn'];
  
  for (const source of sourcesToTest) {
    await testSource(source);
    await new Promise(resolve => setTimeout(resolve, 3000)); // Delay between tests
  }
  
  // Test switching
  console.log('\n' + '='.repeat(60));
  console.log('Testing source switching...');
  console.log('='.repeat(60));
  
  // Test switching via API
  const sourceInfo = await fetch('http://localhost:3000/api/source').then(r => r.json());
  console.log('Current source:', sourceInfo);
  
  console.log('\nTest completed!');
  process.exit(0);
}

// Run tests
testAllSources().catch(console.error);
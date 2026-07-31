// debug-cricinfo.js - Updated version
const browserManager = require('./src/scraper/browser');

async function debugPage() {
  console.log('Debugging Cricinfo page with enhanced stealth mode...');

  try {
    await browserManager.launch();

    const urls = ['https://www.espncricinfo.com/live-cricket-score'];

    for (const url of urls) {
      console.log(`\n=== Testing: ${url} ===`);

      const result = await browserManager.executeScrape(url, async (page) => {
        console.log('Page loaded, analyzing content...');

        // Get page content
        const html = await page.content();
        const cheerio = require('cheerio');
        const $ = cheerio.load(html);
        const text = $('body').text();

        console.log('\n=== PAGE ANALYSIS ===');
        console.log(`Page title: ${await page.title()}`);
        console.log(`Body text length: ${text.length}`);
        console.log(`Has Access Denied: ${text.includes('Access Denied')}`);
        console.log(
          `Has Consent Page: ${text.includes('Privacy Preference Center') || text.includes('cookie')}`
        );

        // Check all links
        console.log('\n1. MATCH LINKS FOUND:');
        const matchLinks = $('a[href*="/match/"]');
        console.log(`Total match links: ${matchLinks.length}`);
        matchLinks.each((i, el) => {
          const href = $(el).attr('href');
          const linkText = $(el).text().trim();
          console.log(`  ${i + 1}. ${href || 'no href'} - "${linkText.substring(0, 50)}..."`);
        });

        // Check team images
        console.log('\n2. TEAM IMAGES FOUND:');
        const images = $('img[alt]');
        console.log(`Total images with alt: ${images.length}`);
        images.each((i, el) => {
          const alt = $(el).attr('alt');
          const src = $(el).attr('src');
          console.log(`  ${i + 1}. alt="${alt}" src="${src?.substring(0, 50) || 'no src'}"`);
        });

        // Check for scores
        console.log('\n3. SCORES FOUND:');
        const scorePatterns = text.match(/\d{1,3}\/\d{1,2}/g);
        if (scorePatterns) {
          console.log(`Scores found: ${scorePatterns.slice(0, 10).join(', ')}`);
        } else {
          console.log('No scores found');
        }

        // Check for overs
        console.log('\n4. OVERS FOUND:');
        const oversPatterns = text.match(/\((\d+\.?\d*)\s*ov\)/g);
        if (oversPatterns) {
          console.log(`Overs found: ${oversPatterns.slice(0, 5).join(', ')}`);
        } else {
          console.log('No overs found');
        }

        // Check status indicators
        console.log('\n5. STATUS INDICATORS:');
        const statusWords = ['LIVE', 'UPCOMING', 'RESULT', 'STUMPS'];
        for (const word of statusWords) {
          const count = (text.match(new RegExp(word, 'gi')) || []).length;
          if (count > 0) {
            console.log(`  "${word}" found ${count} times`);
          }
        }

        // Try to find match cards
        console.log('\n6. MATCH CARDS:');
        const cards = $('div, section, article').filter((i, el) => {
          const $el = $(el);
          const elText = $el.text();
          const hasStatus = /UPCOMING|RESULT|LIVE/i.test(elText);
          const hasTeams = /[A-Z]{2,4}\s+(?:vs|v)\s+[A-Z]{2,4}/i.test(elText);
          const hasScore = /\d{1,3}\/\d{1,2}/.test(elText);
          return hasStatus && (hasTeams || hasScore);
        });
        console.log(`Found ${cards.length} potential match cards`);

        return {
          matchLinkCount: matchLinks.length,
          imageCount: images.length,
          scoresFound: scorePatterns || [],
          title: await page.title(),
          bodyLength: text.length,
          hasAccessDenied: text.includes('Access Denied'),
          hasConsentPage: text.includes('Privacy Preference Center') || text.includes('cookie'),
          pageUrl: page.url(),
          matchCardCount: cards.length,
          sampleText: text.substring(0, 500),
        };
      });

      console.log('\n=== SUMMARY ===');
      console.log(JSON.stringify(result, null, 2));

      if (result.hasAccessDenied) {
        console.log('\n⚠️ Access Denied - The site is blocking the scraper.');
      } else if (result.hasConsentPage) {
        console.log('\n⚠️ Consent/Cookie page detected.');
        console.log('The browser tried to accept but may have failed.');
        console.log('Check if the page loaded correctly in the browser.');
      } else if (result.matchLinkCount === 0 && result.matchCardCount === 0) {
        console.log('\n⚠️ No matches found on the page.');
        console.log('This could mean:');
        console.log('1. No matches are currently scheduled');
        console.log('2. The page structure has changed');
        console.log('3. Content is loaded dynamically with JavaScript');
      } else {
        console.log('\n✅ Page loaded successfully with match data!');
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    await browserManager.close();
    console.log('\nDebug completed!');
  } catch (error) {
    console.error('Debug failed:', error);
    await browserManager.close();
  }
}

debugPage();

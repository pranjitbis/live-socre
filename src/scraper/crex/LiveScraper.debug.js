// src/scraper/crex/LiveScraper.debug.js
const BaseCrexScraper = require('./BaseCrexScraper');
const LIVE_SELECTORS = require('./selectors/liveSelectors');
const logger = require('../../logger');
const fs = require('fs');
const path = require('path');

class LiveScraperDebug extends BaseCrexScraper {
  constructor() {
    super();
    this.selectors = LIVE_SELECTORS;
    this.debugDir = path.join(process.cwd(), 'debug', 'match-info-investigation');
  }

  // ============================================================
  // DEBUG: INVESTIGATE MATCH INFO NAVIGATION
  // ============================================================
  async investigateMatchInfo(matchUrl) {
    logger.info('🔍 Starting Match Info Navigation Investigation');
    logger.info(`📌 Target URL: ${matchUrl}`);

    try {
      await this.initializeBrowser();

      // ============================================================
      // STEP 1: Open the live match URL
      // ============================================================
      logger.info('\n' + '═'.repeat(80));
      logger.info('STEP 1: Opening live match URL');
      logger.info('═'.repeat(80));

      await this.page.goto(matchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      await this.page.waitForTimeout(5000);

      // Get current page info
      const currentUrl = this.page.url();
      const pageTitle = await this.page.title();
      const pageHtml = await this.page.content();

      logger.info(`✅ Current URL: ${currentUrl}`);
      logger.info(`✅ Page Title: ${pageTitle}`);
      logger.info(`✅ HTML Length: ${pageHtml.length} characters`);

      // Save step 1 debug data
      await this.saveDebugData('step1', {
        url: currentUrl,
        title: pageTitle,
        html: pageHtml
      });

      await this.page.screenshot({
        path: path.join(this.debugDir, 'step1-live-page.png'),
        fullPage: true
      });
      logger.info(`💾 Screenshot saved: step1-live-page.png`);

      // ============================================================
      // STEP 2: Find all tabs on the page
      // ============================================================
      logger.info('\n' + '═'.repeat(80));
      logger.info('STEP 2: Finding all tabs on the page');
      logger.info('═'.repeat(80));

      const tabs = await this.findAllTabs();
      
      logger.info(`📊 Found ${tabs.length} tabs:`);
      tabs.forEach((tab, index) => {
        logger.info(`\n  Tab ${index + 1}:`);
        logger.info(`    Text: "${tab.text}"`);
        logger.info(`    href: "${tab.href}"`);
        logger.info(`    data-route: "${tab.dataRoute}"`);
        logger.info(`    onclick: "${tab.onclick}"`);
        logger.info(`    aria-label: "${tab.ariaLabel}"`);
        logger.info(`    class: "${tab.className}"`);
        logger.info(`    data-testid: "${tab.dataTestId}"`);
        logger.info(`    role: "${tab.role}"`);
        logger.info(`    id: "${tab.id}"`);
      });

      // Save tabs data
      await this.saveDebugData('step2-tabs', tabs);

      // ============================================================
      // STEP 3: Check if Match Info exists and click it
      // ============================================================
      logger.info('\n' + '═'.repeat(80));
      logger.info('STEP 3: Checking for Match Info tab');
      logger.info('═'.repeat(80));

      const matchInfoTab = tabs.find(tab => 
        tab.text.toLowerCase().includes('match info') ||
        tab.text.toLowerCase().includes('info') ||
        tab.text.includes('Info')
      );

      if (matchInfoTab) {
        logger.info(`✅ Match Info tab found: "${matchInfoTab.text}"`);
        logger.info(`   href: ${matchInfoTab.href}`);
        logger.info(`   data-route: ${matchInfoTab.dataRoute}`);
        
        // Click the Match Info tab
        logger.info('\n🔘 Clicking Match Info tab...');
        
        try {
          // Try to find the element and click it
          const tabSelectors = [
            `a:has-text("${matchInfoTab.text}")`,
            `button:has-text("${matchInfoTab.text}")`,
            `[data-route="${matchInfoTab.dataRoute}"]`,
            `a[href="${matchInfoTab.href}"]`,
            `.${matchInfoTab.className.split(' ')[0]}`
          ];

          let clicked = false;
          for (const selector of tabSelectors) {
            try {
              const element = await this.page.$(selector);
              if (element) {
                await element.click();
                clicked = true;
                logger.info(`✅ Clicked with selector: ${selector}`);
                break;
              }
            } catch (e) {
              // Continue to next selector
            }
          }

          if (!clicked) {
            // Try clicking by text
            await this.page.click(`text="${matchInfoTab.text}"`);
            logger.info(`✅ Clicked by text: "${matchInfoTab.text}"`);
          }

          // Wait for navigation
          await this.page.waitForTimeout(3000);

          // Get the new URL
          const newUrl = this.page.url();
          const newTitle = await this.page.title();
          const newHtml = await this.page.content();

          logger.info(`\n✅ After clicking Match Info:`);
          logger.info(`   URL: ${newUrl}`);
          logger.info(`   Title: ${newTitle}`);
          logger.info(`   HTML Length: ${newHtml.length}`);

          // Save step 3 debug data
          await this.saveDebugData('step3-after-click', {
            url: newUrl,
            title: newTitle,
            html: newHtml,
            clickedTab: matchInfoTab
          });

          await this.page.screenshot({
            path: path.join(this.debugDir, 'step3-after-click.png'),
            fullPage: true
          });
          logger.info(`💾 Screenshot saved: step3-after-click.png`);

        } catch (error) {
          logger.error(`❌ Failed to click Match Info tab: ${error.message}`);
        }
      } else {
        logger.warn('❌ Match Info tab NOT found!');
        logger.info('Available tabs:', tabs.map(t => t.text).join(', '));
        
        // Save that Match Info was not found
        await this.saveDebugData('step3-no-match-info', {
          tabs: tabs.map(t => t.text),
          error: 'Match Info tab not found'
        });
      }

      // ============================================================
      // STEP 4: Search for match-date element
      // ============================================================
      logger.info('\n' + '═'.repeat(80));
      logger.info('STEP 4: Searching for match-date element');
      logger.info('═'.repeat(80));

      const currentHtml = await this.page.content();
      
      // Search for match-date
      const matchDateMatches = currentHtml.match(/<[^>]*match-date[^>]*>.*?<\/[^>]*>/gi);
      
      if (matchDateMatches && matchDateMatches.length > 0) {
        logger.info(`✅ Found ${matchDateMatches.length} match-date elements:`);
        matchDateMatches.forEach((html, index) => {
          logger.info(`\n  Element ${index + 1}:`);
          logger.info(`  ${html.substring(0, 500)}${html.length > 500 ? '...' : ''}`);
        });
        
        // Save the outerHTML
        await this.saveDebugData('step4-match-date', {
          count: matchDateMatches.length,
          elements: matchDateMatches
        });
      } else {
        logger.warn('❌ match-date NOT FOUND');
        
        // Search for any date-like elements
        const dateMatches = currentHtml.match(/<[^>]*date[^>]*>.*?<\/[^>]*>/gi);
        if (dateMatches && dateMatches.length > 0) {
          logger.info(`Found ${dateMatches.length} date-related elements`);
          await this.saveDebugData('step4-date-elements', dateMatches);
        }
      }

      // ============================================================
      // STEP 5: Search for weekdays
      // ============================================================
      logger.info('\n' + '═'.repeat(80));
      logger.info('STEP 5: Searching for weekdays in HTML');
      logger.info('═'.repeat(80));

      const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const weekdayMatches = [];

      for (const day of weekdays) {
        const regex = new RegExp(`<[^>]*>[^<]*${day}[^<]*</[^>]*>`, 'gi');
        const matches = currentHtml.match(regex);
        if (matches && matches.length > 0) {
          weekdayMatches.push({ day, matches });
        }
      }

      if (weekdayMatches.length > 0) {
        logger.info(`✅ Found weekday elements:`);
        weekdayMatches.forEach(({ day, matches }) => {
          logger.info(`\n  ${day}:`);
          matches.forEach(match => {
            logger.info(`    ${match.substring(0, 200)}${match.length > 200 ? '...' : ''}`);
          });
        });
        
        await this.saveDebugData('step5-weekdays', weekdayMatches);
      } else {
        logger.warn('❌ No weekdays found in HTML');
      }

      // ============================================================
      // STEP 6: Search for other match metadata
      // ============================================================
      logger.info('\n' + '═'.repeat(80));
      logger.info('STEP 6: Searching for match metadata');
      logger.info('═'.repeat(80));

      const metadata = {
        venue: currentHtml.match(/[Vv]enue[^<]*/g),
        toss: currentHtml.match(/[Tt]oss[^<]*/g),
        matchNumber: currentHtml.match(/[Mm]atch\s*(?:no|number)[^<]*/g),
        format: currentHtml.match(/[Ff]ormat[^<]*/g),
        startTime: currentHtml.match(/[Ss]tart\s*[Tt]ime[^<]*/g)
      };

      let hasMetadata = false;
      for (const [key, value] of Object.entries(metadata)) {
        if (value && value.length > 0) {
          logger.info(`✅ ${key}: found ${value.length} matches`);
          value.forEach(m => logger.info(`   ${m.substring(0, 100)}`));
          hasMetadata = true;
        } else {
          logger.info(`❌ ${key}: not found`);
        }
      }

      await this.saveDebugData('step6-metadata', metadata);

      // ============================================================
      // STEP 7: Final report
      // ============================================================
      logger.info('\n' + '═'.repeat(80));
      logger.info('STEP 7: FINAL INVESTIGATION REPORT');
      logger.info('═'.repeat(80));

      const report = {
        timestamp: new Date().toISOString(),
        url: this.page.url(),
        title: await this.page.title(),
        matchInfoFound: !!matchInfoTab,
        matchInfoClicked: !!matchInfoTab,
        matchDateFound: matchDateMatches && matchDateMatches.length > 0,
        weekdaysFound: weekdayMatches.length > 0,
        metadataFound: Object.values(metadata).some(v => v && v.length > 0),
        tabs: tabs.map(t => t.text),
        matchInfoTab: matchInfoTab ? {
          text: matchInfoTab.text,
          href: matchInfoTab.href,
          dataRoute: matchInfoTab.dataRoute
        } : null,
        nextSteps: []
      };

      if (!matchInfoTab) {
        report.nextSteps.push('Match Info tab not found - check if the page has a different structure');
      }

      if (!matchDateFound) {
        report.nextSteps.push('match-date element not found - the Match Info page may not contain this element');
      }

      if (!weekdaysFound) {
        report.nextSteps.push('No weekdays found - the start time may be in a different format or location');
      }

      if (!hasMetadata) {
        report.nextSteps.push('No match metadata found - the page may not contain match information in the expected format');
      }

      // Save the final report
      await this.saveDebugData('final-report', report);

      // Print the report
      logger.info('\n📋 FINAL REPORT:');
      logger.info(JSON.stringify(report, null, 2));

      await this.closeBrowser();

      return report;

    } catch (error) {
      logger.error(`❌ Investigation failed: ${error.message}`);
      await this.closeBrowser();
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // ============================================================
  // FIND ALL TABS ON THE PAGE - FIXED
  // ============================================================
  async findAllTabs() {
    return await this.page.evaluate(() => {
      const tabs = [];
      
      // Look for tab elements
      const tabSelectors = [
        'a[href*="tab"]',
        'a[href*="info"]',
        'a[href*="scorecard"]',
        'a[href*="commentary"]',
        'button[role="tab"]',
        '[role="tab"]',
        '.tab',
        '.tab-item',
        '.nav-tab',
        '.tab-link',
        '.nav-item a',
        '.navbar a',
        '.tabs a',
        '.tab-nav a'
      ];

      const elements = document.querySelectorAll(tabSelectors.join(', '));
      
      elements.forEach(el => {
        const text = el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
        if (text.length > 0 && text.length < 50) {
          tabs.push({
            text: text,
            href: el.getAttribute('href') || '',
            dataRoute: el.getAttribute('data-route') || '',
            onclick: el.getAttribute('onclick') || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            className: el.className || '',
            dataTestId: el.getAttribute('data-testid') || '',
            role: el.getAttribute('role') || '',
            id: el.id || ''
          });
        }
      });

      // Also look for tab-like elements by searching all elements with text
      const allElements = document.querySelectorAll('a, button, [role="tab"], [role="button"]');
      const labels = ['Scorecard', 'Commentary', 'Match Info', 'Info', 'Squads', 'Points', 'Stats', 'Preview', 'News'];
      
      allElements.forEach(el => {
        const text = el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
        // Check if the text contains any of the labels
        if (text.length > 0 && text.length < 50) {
          const matchedLabel = labels.find(label => text.includes(label));
          if (matchedLabel) {
            // Check if this element isn't already in the tabs array
            const exists = tabs.some(t => t.text === text);
            if (!exists) {
              tabs.push({
                text: text,
                href: el.getAttribute('href') || '',
                dataRoute: el.getAttribute('data-route') || '',
                onclick: el.getAttribute('onclick') || '',
                ariaLabel: el.getAttribute('aria-label') || '',
                className: el.className || '',
                dataTestId: el.getAttribute('data-testid') || '',
                role: el.getAttribute('role') || '',
                id: el.id || ''
              });
            }
          }
        }
      });

      // Remove duplicates
      const uniqueTabs = [];
      const seenTexts = new Set();
      tabs.forEach(tab => {
        if (!seenTexts.has(tab.text)) {
          seenTexts.add(tab.text);
          uniqueTabs.push(tab);
        }
      });

      return uniqueTabs;
    });
  }

  // ============================================================
  // SAVE DEBUG DATA
  // ============================================================
  async saveDebugData(name, data) {
    try {
      if (!fs.existsSync(this.debugDir)) {
        fs.mkdirSync(this.debugDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}-${name}.json`;
      const filepath = path.join(this.debugDir, filename);

      let content = data;
      if (typeof data === 'string') {
        content = data;
      } else {
        content = JSON.stringify(data, null, 2);
      }

      fs.writeFileSync(filepath, content);
      logger.debug(`💾 Debug data saved: ${filename}`);
    } catch (error) {
      logger.warn(`⚠️ Failed to save debug data: ${error.message}`);
    }
  }

  // ============================================================
  // RUN INVESTIGATION
  // ============================================================
  async run() {
    // Use a specific match URL from the discovered matches
    const matchUrl = 'https://crex.com/cricket-live-score/lhq-vs-sfu-9th-match-global-super-league-2026-match-updates-11SR';
    
    const result = await this.investigateMatchInfo(matchUrl);
    
    console.log('\n' + '═'.repeat(80));
    console.log('🔍 INVESTIGATION COMPLETE');
    console.log('═'.repeat(80));
    console.log(JSON.stringify(result, null, 2));
    
    return result;
  }
}

module.exports = LiveScraperDebug;
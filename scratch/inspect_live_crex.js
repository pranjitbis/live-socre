// scratch/inspect_live_crex.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

async function run() {
  console.log('Starting CREX DOM Inspection...');
  const logFile = path.join(__dirname, 'crex_live_inspection.txt');
  const fd = fs.openSync(logFile, 'w');

  function log(msg) {
    console.log(msg);
    fs.writeSync(fd, msg + '\n');
  }

  log('============================================================');
  log('CREX LIVE SCORE DOM DIAGNOSTICS & SELECTOR MAPPING');
  log('============================================================\n');

  // PART 1: Inspect local debug/live-page.html
  log('--- PART 1: Analyzing Local Cached live-page.html ---');
  const localHtmlPath = path.join(__dirname, '../debug/live-page.html');
  if (fs.existsSync(localHtmlPath)) {
    const localHtml = fs.readFileSync(localHtmlPath, 'utf8');
    analyzeHtmlContent(localHtml, 'Local Saved live-page.html', log);
  } else {
    log('Local saved live-page.html not found.');
  }

  // PART 2: Inspect live pages via Playwright
  log('\n--- PART 2: Launching Playwright for Live CREX Inspection ---');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    log('Navigating to https://crex.com/cricket-live-score ...');
    await page.goto('https://crex.com/cricket-live-score', { waitUntil: 'networkidle', timeout: 60000 });
    
    // Take screenshot of list page
    const listScreenshotPath = path.join(__dirname, 'live_list.png');
    await page.screenshot({ path: listScreenshotPath });
    log(`Saved live list page screenshot to: ${listScreenshotPath}`);

    // Extract match links
    const matchLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/cricket-live-score/"]'));
      return links.map(a => ({
        href: a.href,
        text: a.textContent.trim().replace(/\s+/g, ' ')
      })).filter((v, i, self) => self.findIndex(t => t.href === v.href) === i);
    });

    log(`Found ${matchLinks.length} match links on live page:`);
    matchLinks.forEach((l, idx) => {
      log(`  [${idx}] ${l.text} -> ${l.href}`);
    });

    if (matchLinks.length > 0) {
      // Let's inspect up to 3 matches
      const maxInspect = Math.min(matchLinks.length, 3);
      for (let i = 0; i < maxInspect; i++) {
        const match = matchLinks[i];
        log(`\nVisiting Match [${i}]: ${match.text} (${match.href})`);
        try {
          await page.goto(match.href, { waitUntil: 'networkidle', timeout: 45000 });
          // Wait a bit for dynamic content
          await page.waitForTimeout(3000);

          const matchHtml = await page.content();
          analyzeHtmlContent(matchHtml, `Live Match [${i}] - ${match.text}`, log);

          // Let's check if there is a scorecard tab and click it to inspect full scorecard
          log('Checking for Scorecard tab...');
          const clicked = await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('a, div, span, li')).filter(el => {
              const text = el.textContent.trim().toLowerCase();
              return text === 'scorecard' || text === 'full scorecard' || text.includes('scorecard');
            });
            if (tabs.length > 0) {
              const tab = tabs[0];
              tab.click();
              return true;
            }
            return false;
          });

          if (clicked) {
            log('Clicked Scorecard tab, waiting 2s...');
            await page.waitForTimeout(2000);
            const scorecardHtml = await page.content();
            analyzeScorecardTab(scorecardHtml, `Live Match [${i}] Scorecard Tab`, log);
          } else {
            log('No Scorecard tab found/clicked.');
          }

          // Save page screenshot
          const matchScreenshotPath = path.join(__dirname, `live_match_${i}.png`);
          await page.screenshot({ path: matchScreenshotPath });
          log(`Saved match screenshot to: ${matchScreenshotPath}`);
        } catch (err) {
          log(`Error visiting match ${match.href}: ${err.message}`);
        }
      }
    } else {
      log('No live match links found to visit.');
    }
  } catch (err) {
    log(`Playwright error: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  fs.closeSync(fd);
  console.log(`Inspection completed! Results written to ${logFile}`);
}

function analyzeHtmlContent(html, sourceName, log) {
  const $ = cheerio.load(html);
  log(`\n========================================`);
  log(`ANALYSIS FOR: ${sourceName}`);
  log(`========================================`);

  // Helper function to print elements and their context
  function inspectElement(name, selector, testFn = null) {
    const el = $(selector);
    log(`\nFIELD: ${name}`);
    log(`SELECTOR SEARCHED: "${selector}"`);
    log(`COUNT FOUND: ${el.length}`);
    if (el.length > 0) {
      el.slice(0, 3).each((idx, elem) => {
        const text = $(elem).text().trim().replace(/\s+/g, ' ');
        const parentTag = $(elem).parent().prop('tagName');
        const parentClass = $(elem).parent().attr('class') || '';
        log(`  [Match ${idx + 1}] Tag: <${elem.tagName} class="${$(elem).attr('class') || ''}">`);
        log(`    Parent: <${parentTag} class="${parentClass}">`);
        log(`    Text: "${text.substring(0, 300)}"`);
        if (testFn) {
          testFn($(elem), log);
        }
      });
    } else {
      log('  Not found');
    }
  }

  // 1. Match Number
  inspectElement('Match Number', '.match-number, .match-desc, .match-desc-info, .match-header .match-desc');

  // 2. Format
  inspectElement('Format', '.format-badge, .badge, .match-info .format, .series-name');

  // 3. Start Time
  inspectElement('Start Time', '.start-time, .schedule-time, [datetime], time');

  // 4. Venue
  inspectElement('Venue', '.venue, .match-venue, .venue-name, .location, .stadium, .venue-info');

  // 5. Teams
  inspectElement('Teams Wrapper/Names', '.team-name, .name, .team-title, .team-label');

  // 6. Batting Team & Score
  inspectElement('Score runs/overs', '.runs, .team-score, .runs.f-runs, .team-score .runs');

  // 7. Team Inning Containers
  inspectElement('Team Inning / Score Card', '.team-innig, .team-result, .team-inning-card');

  // 8. Current Batsmen
  inspectElement('Current Batsmen Wrapper', '.batsmen-info-wrapper, .batsman-item, .batsman-row', (el, log) => {
    log(`    Batsman details inside:`);
    el.find('*').each((i, c) => {
      const tag = c.tagName;
      const cls = $(c).attr('class') || '';
      const txt = $(c).text().trim().replace(/\s+/g, ' ');
      if (txt) {
        log(`      <${tag} class="${cls}"> text: "${txt}"`);
      }
    });
  });

  // 9. Current Bowler
  inspectElement('Current Bowler Wrapper', '.bowler-info, .current-bowler, .bowler', (el, log) => {
    log(`    Bowler details inside:`);
    el.find('*').each((i, c) => {
      const tag = c.tagName;
      const cls = $(c).attr('class') || '';
      const txt = $(c).text().trim().replace(/\s+/g, ' ');
      if (txt) {
        log(`      <${tag} class="${cls}"> text: "${txt}"`);
      }
    });
  });

  // 10. Current Ball
  inspectElement('Current Ball / Overs Count', '.current-ball, .ball-number, .active-ball, .over-ball.current');

  // 11. Over container and balls
  inspectElement('Over Containers (timeline)', '.over-container, .overs-slide, .over-item, .ml-over-card', (el, log) => {
    log(`    Over details inside:`);
    el.find('*').each((i, c) => {
      const tag = c.tagName;
      const cls = $(c).attr('class') || '';
      const txt = $(c).text().trim().replace(/\s+/g, ' ');
      if (txt) {
        log(`      <${tag} class="${cls}"> text: "${txt}"`);
      }
    });
  });

  // 12. Ball values and events
  inspectElement('Individual balls inside timeline', '.over-ball, .ball, .ml-o-b-1');

  // 13. Wicket/event text
  inspectElement('Wicket/Event Elements', '.font3, .event-text, .ball-detail, .wicket-tag');

  // 14. Commentary
  inspectElement('Commentary Rows', '.comm-item, .commentary-item, .comment-item, .ml-comm-row, .match-updates-item', (el, log) => {
    log(`    Commentary details inside:`);
    el.find('*').each((i, c) => {
      const tag = c.tagName;
      const cls = $(c).attr('class') || '';
      const txt = $(c).text().trim().replace(/\s+/g, ' ');
      if (txt) {
        log(`      <${tag} class="${cls}"> text: "${txt}"`);
      }
    });
  });

  // 15. Toss
  inspectElement('Toss Details', '.toss, .toss-info, .toss-detail, .toss-wrap, .match-toss');

  // 16. Projected Score
  inspectElement('Projected Score Section', '.projected-score, .projected-card, .proj-score-wrapper');

  // General text search for "Projected Score" or "Proj. Score"
  log('\n--- Searching for Projected Score in page text ---');
  $('div, p, span, tr').each((i, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if ((text.includes('Projected') || text.includes('Proj.')) && text.length < 200 && $(el).children().length <= 2) {
      log(`Found text "${text}" in <${el.tagName} class="${$(el).attr('class') || ''}">`);
      log(`  Parent HTML: ${$(el).parent().html().substring(0, 300).replace(/\s+/g, ' ')}`);
    }
  });
}

function analyzeScorecardTab(html, sourceName, log) {
  const $ = cheerio.load(html);
  log(`\n========================================`);
  log(`SCORECARD TAB ANALYSIS: ${sourceName}`);
  log(`========================================`);

  // Inspect Scorecard Table and elements
  const tables = $('.scorecard-table, .scorecard, table, .batting-table, .match-scorecard');
  log(`Found scorecard containers count: ${tables.length}`);
  tables.each((tIdx, t) => {
    log(`  [Table ${tIdx}] class: "${$(t).attr('class') || ''}"`);
    const rows = $(t).find('tr, .row, .batting-row, .bowler-row');
    log(`    Row count: ${rows.length}`);
    rows.slice(0, 10).each((rIdx, r) => {
      const cells = $(r).find('td, th, .cell');
      const cellTexts = [];
      cells.each((cIdx, c) => {
        cellTexts.push($(c).text().trim().replace(/\s+/g, ' '));
      });
      log(`      [Row ${rIdx}] class: "${$(r).attr('class') || ''}" -> [${cellTexts.join(' | ')}]`);
    });
  });
}

run();

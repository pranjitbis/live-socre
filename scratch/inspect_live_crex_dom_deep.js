// scratch/inspect_live_crex_dom_deep.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function inspectLiveCrex() {
  console.log('Starting Deep CREX DOM Inspection...');
  const logFile = path.join(__dirname, 'deep_dom_inspection_log.txt');
  const fd = fs.openSync(logFile, 'w');

  function log(msg) {
    console.log(msg);
    fs.writeSync(fd, msg + '\n');
  }

  log('============================================================');
  log('CREX LIVE MATCH DEEP DOM INSPECTION REPORT');
  log('============================================================\n');

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    log('Navigating to CREX Live Score list: https://crex.com/cricket-live-score ...');
    await page.goto('https://crex.com/cricket-live-score', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    const matchLinks = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/cricket-live-score/"]'));
      return anchors
        .map(a => ({ href: a.href, text: a.textContent.trim().replace(/\s+/g, ' ') }))
        .filter((item, index, self) => item.href.includes('-updates-') && self.findIndex(t => t.href === item.href) === index);
    });

    log(`Discovered ${matchLinks.length} live match updates links:`);
    matchLinks.forEach((m, idx) => log(`  [${idx}] ${m.text} -> ${m.href}`));

    if (matchLinks.length === 0) {
      log('⚠️ No live match links found with "-updates-". Finding all match cards...');
      const fallbackLinks = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href*="/cricket-live-score/"]'));
        return anchors
          .map(a => ({ href: a.href, text: a.textContent.trim().replace(/\s+/g, ' ') }))
          .filter((item, index, self) => self.findIndex(t => t.href === item.href) === index);
      });
      fallbackLinks.forEach((m, idx) => log(`  [Fallback ${idx}] ${m.text} -> ${m.href}`));
      matchLinks.push(...fallbackLinks);
    }

    const matchesToInspect = matchLinks.slice(0, 3);
    for (let i = 0; i < matchesToInspect.length; i++) {
      const match = matchesToInspect[i];
      log(`\n============================================================`);
      log(`INSPECTING LIVE MATCH [${i + 1}/${matchesToInspect.length}]: ${match.text}`);
      log(`URL: ${match.href}`);
      log(`============================================================\n`);

      try {
        await page.goto(match.href, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(4000);

        const inspectionData = await page.evaluate(() => {
          const report = {};

          // Helper to get element dump
          function dumpEl(el) {
            if (!el) return null;
            return {
              tag: el.tagName.toLowerCase(),
              className: el.className || '',
              id: el.id || '',
              text: el.textContent.trim().replace(/\s+/g, ' '),
              outerHTML: el.outerHTML ? el.outerHTML.substring(0, 500) : '',
              childrenCount: el.children.length
            };
          }

          // 1. Header & Meta
          report.matchHeader = dumpEl(document.querySelector('.match-header, .match-info, .match-desc-info, .head-container'));
          report.matchNumber = dumpEl(document.querySelector('.match-number, .match-desc, .match-series'));
          report.seriesName = dumpEl(document.querySelector('.series-name, .snameTag, .match-series-name'));
          report.venue = dumpEl(document.querySelector('.venue, .venue-name, .stadium, .location, .stadium-name'));
          report.matchStatus = dumpEl(document.querySelector('.status, .match-status, .live-status, .font3'));

          // 2. Scoreboard Section
          const sbContainers = Array.from(document.querySelectorAll('.team-innig, .team-result, .scoreboard, .live-card, .team-inning-card, [class*="team-inning"]'));
          report.scoreboardContainers = sbContainers.map(el => ({
            className: el.className,
            parentClass: el.parentElement ? el.parentElement.className : '',
            text: el.textContent.trim().replace(/\s+/g, ' '),
            htmlSnippet: el.outerHTML.substring(0, 600),
            teamName: dumpEl(el.querySelector('.team-name, .name, .team-title, .team-label')),
            runsScore: dumpEl(el.querySelector('.runs, .f-runs, .score, .team-score')),
            spansInsideScore: Array.from(el.querySelectorAll('.runs span, .score span, .f-runs span')).map(s => ({
              className: s.className,
              text: s.textContent.trim()
            }))
          }));

          // 3. Current Batsmen Section
          const batsmenItems = Array.from(document.querySelectorAll('.batsmen-info-wrapper, .batsman-item, .player-card, [class*="batsmen"]'));
          report.currentBatsmen = batsmenItems.map(el => ({
            className: el.className,
            parentClass: el.parentElement ? el.parentElement.className : '',
            text: el.textContent.trim().replace(/\s+/g, ' '),
            htmlSnippet: el.outerHTML.substring(0, 500),
            nameEl: dumpEl(el.querySelector('.batsmen-name, .player-name, .name, a p, p')),
            scoreEl: dumpEl(el.querySelector('.batsmen-score, .score, .runs')),
            strikerIndicators: Array.from(el.querySelectorAll('.circle-strike-icon, .striker, .highlight, [class*="strike"]')).map(s => s.className)
          }));

          // 4. Current Bowler Section
          const bowlerItems = Array.from(document.querySelectorAll('.bowler-info, .current-bowler, .bowler, [class*="bowler"]'));
          report.currentBowler = bowlerItems.map(el => ({
            className: el.className,
            parentClass: el.parentElement ? el.parentElement.className : '',
            text: el.textContent.trim().replace(/\s+/g, ' '),
            htmlSnippet: el.outerHTML.substring(0, 500),
            nameEl: dumpEl(el.querySelector('.bowler-name, .player-name, .name')),
            figuresEl: dumpEl(el.querySelector('.bowler-score, .figures, .runs, .overs'))
          }));

          // 5. Overs / Ball-by-ball Section
          const overCards = Array.from(document.querySelectorAll('.over-container, .overs-slide, .over-item, .ml-over-card, [class*="over"]'));
          report.overContainers = overCards.slice(0, 4).map(el => ({
            className: el.className,
            text: el.textContent.trim().replace(/\s+/g, ' '),
            htmlSnippet: el.outerHTML.substring(0, 500),
            balls: Array.from(el.querySelectorAll('.over-ball, .ball, [class*="over-ball"]')).map(b => ({
              className: b.className,
              text: b.textContent.trim(),
              font1: dumpEl(b.querySelector('.font1')),
              font2: dumpEl(b.querySelector('.font2')),
              font3: dumpEl(b.querySelector('.font3'))
            }))
          }));

          // 6. Inspection of .font1, .font2, .font3 across document
          report.fontElements = {
            font1: Array.from(document.querySelectorAll('.font1')).slice(0, 10).map(el => ({
              parentTag: el.parentElement ? el.parentElement.tagName : '',
              parentClass: el.parentElement ? el.parentElement.className : '',
              text: el.textContent.trim()
            })),
            font2: Array.from(document.querySelectorAll('.font2')).slice(0, 10).map(el => ({
              parentTag: el.parentElement ? el.parentElement.tagName : '',
              parentClass: el.parentElement ? el.parentElement.className : '',
              text: el.textContent.trim()
            })),
            font3: Array.from(document.querySelectorAll('.font3')).slice(0, 10).map(el => ({
              parentTag: el.parentElement ? el.parentElement.tagName : '',
              parentClass: el.parentElement ? el.parentElement.className : '',
              text: el.textContent.trim()
            }))
          };

          // 7. Commentary Section
          const commItems = Array.from(document.querySelectorAll('.comm-card, .commentary-card, .comm-item, .commentary-item, .match-updates-item, [class*="comm"]'));
          report.commentaryRows = commItems.slice(0, 5).map(el => ({
            className: el.className,
            parentClass: el.parentElement ? el.parentElement.className : '',
            text: el.textContent.trim().replace(/\s+/g, ' '),
            htmlSnippet: el.outerHTML.substring(0, 500)
          }));

          // 8. Toss & Projected Score Section
          report.toss = dumpEl(document.querySelector('.toss, .toss-info, .toss-detail, .toss-wrap'));
          report.projectedScore = dumpEl(document.querySelector('.projected-score, .projected-card, .proj-score-wrapper'));

          return report;
        });

        log(JSON.stringify(inspectionData, null, 2));
      } catch (err) {
        log(`Error inspecting match ${match.href}: ${err.message}`);
      }
    }
  } catch (err) {
    log(`Playwright main execution error: ${err.message}`);
  } finally {
    if (browser) await browser.close();
    fs.closeSync(fd);
    console.log(`Inspection completed! Results written to ${logFile}`);
  }
}

inspectLiveCrex();

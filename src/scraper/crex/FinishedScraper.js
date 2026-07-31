// src/scraper/crex/FinishedScraper.js
const BaseCrexScraper = require('./BaseCrexScraper');
const FINISHED_SELECTORS = require('./selectors/finishedSelectors');
const logger = require('../../logger');

class FinishedScraper extends BaseCrexScraper {
  constructor() {
    super();
    this.selectors = FINISHED_SELECTORS;
    this.stats = {
      downloaded: 0,
      parsed: 0,
      returned: 0,
    };
  }

  // ============================================================
  // MAIN SCRAPE METHOD
  // ============================================================
  async scrapeFinished() {
    const url = this.selectors.PAGE_URL;
    logger.info(`FinishedScraper: Discovering finished matches from ${url}`);

    try {
      await this.initializeBrowser();

      await this.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await this.waitForPage();

      // Wait for finished matches
      try {
        await this.page.waitForSelector(this.selectors.MATCH_CARD, { timeout: 10000 });
        logger.info('✅ Finished matches found');
      } catch (e) {
        logger.warn('⚠️ No finished matches found');
        await this.closeBrowser();
        return [];
      }

      // Extract matches
      const matches = await this.extractMatches();
      this.stats.returned = matches.length;

      await this.closeBrowser();
      this.logStatistics();
      return matches;
    } catch (error) {
      logger.error(`FinishedScraper error: ${error.message}`);
      await this.closeBrowser();
      return [];
    }
  }

  // ============================================================
  // EXTRACT MATCHES
  // ============================================================
  async extractMatches() {
    logger.info('Extracting finished matches...');

    const result = await this.page.evaluate((selectors) => {
      const logs = [];
      const matches = [];

      // Helper functions
      const getText = (element) => {
        if (!element) return '';
        return element.textContent ? element.textContent.replace(/\s+/g, ' ').trim() : '';
      };

      const cleanText = (text) => {
        if (!text) return '';
        return text.replace(/\s+/g, ' ').trim();
      };

      const query = (element, selector) => {
        try {
          return element.querySelector(selector);
        } catch (e) {
          return null;
        }
      };

      const queryAll = (element, selector) => {
        try {
          return element.querySelectorAll(selector);
        } catch (e) {
          return [];
        }
      };

      // Find all match cards
      const matchCards = queryAll(document, selectors.MATCH_CARD);
      logs.push({
        selector: '.match-card count',
        found: true,
        value: `${matchCards.length} found`,
      });

      for (const card of matchCards) {
        const match = {
          matchId: '',
          url: '',
          series: '',
          matchTitle: '',
          matchNumber: '',
          status: 'COMPLETED',
          venue: '',
          result: '',
          winningTeam: '',
          margin: '',
          marginType: '',
          team1: { name: '', short: '', flag: '', score: '', wickets: '', overs: '' },
          team2: { name: '', short: '', flag: '', score: '', wickets: '', overs: '' },
          playerOfMatch: { name: '', image: '', profileUrl: '' },
          toss: { winner: '', decision: '' },
          officials: { umpires: [], thirdUmpire: '', matchReferee: '' },
          currentBatters: [],
          currentBowler: {},
          oversTimeline: [],
        };

        // Extract result
        const resultEl = query(card, selectors.RESULT);
        if (resultEl) {
          const resultText = cleanText(getText(resultEl));
          const matchResult = resultText.match(
            /([A-Za-z\s]+)\s+won by\s+(\d+)\s+(wkts|runs|wickets?)/i
          );
          if (matchResult) {
            match.result = matchResult[0];
            match.winningTeam = cleanText(matchResult[1]);
            match.margin = matchResult[2];
            match.marginType = matchResult[3];
          }
        }

        // Extract player of match
        const pomEl = query(card, selectors.PLAYER_OF_MATCH);
        if (pomEl) {
          const nameEl = query(pomEl, selectors.PLAYER_NAME);
          if (nameEl) {
            match.playerOfMatch.name = cleanText(getText(nameEl));
          }
          const imgEl = query(pomEl, selectors.PLAYER_IMAGE);
          if (imgEl) {
            match.playerOfMatch.image = imgEl.getAttribute('src') || '';
          }
        }

        // Extract teams
        const teamInnings = queryAll(card, selectors.TEAM_INNING);
        if (teamInnings.length >= 2) {
          // Team 1
          const t1 = teamInnings[0];
          const t1Name = query(t1, selectors.TEAM_NAME);
          if (t1Name) {
            match.team1.name = cleanText(getText(t1Name));
            match.team1.short = this.getShortName(match.team1.name);
          }
          const t1Flag = query(t1, selectors.TEAM_FLAG);
          if (t1Flag) {
            match.team1.flag = t1Flag.getAttribute('src') || '';
          }
          const t1Score = query(t1, selectors.SCORE_FIRST);
          if (t1Score) {
            const scoreText = cleanText(getText(t1Score));
            const scoreMatch = scoreText.match(/(\d+)[-/](\d+)/);
            if (scoreMatch) {
              match.team1.score = scoreMatch[1];
              match.team1.wickets = scoreMatch[2];
            }
          }

          // Team 2
          const t2 = teamInnings[1];
          const t2Name = query(t2, selectors.TEAM_NAME);
          if (t2Name) {
            match.team2.name = cleanText(getText(t2Name));
            match.team2.short = this.getShortName(match.team2.name);
          }
          const t2Flag = query(t2, selectors.TEAM_FLAG);
          if (t2Flag) {
            match.team2.flag = t2Flag.getAttribute('src') || '';
          }
          const t2Score = query(t2, selectors.SCORE_FIRST);
          if (t2Score) {
            const scoreText = cleanText(getText(t2Score));
            const scoreMatch = scoreText.match(/(\d+)[-/](\d+)/);
            if (scoreMatch) {
              match.team2.score = scoreMatch[1];
              match.team2.wickets = scoreMatch[2];
            }
          }
        }

        // Extract batsmen
        const batsmenContainer = query(card, selectors.BATSMEN);
        if (batsmenContainer) {
          const batsmanEls = queryAll(batsmenContainer, selectors.BATSMAN);
          for (const el of batsmanEls) {
            const nameEl = query(el, selectors.BATSMAN_NAME);
            const scoreEls = queryAll(el, selectors.BATSMAN_SCORE);

            const batsman = {
              name: nameEl ? cleanText(getText(nameEl)) : '',
              runs: scoreEls.length > 0 ? cleanText(getText(scoreEls[0])) : '',
              balls: scoreEls.length > 1 ? cleanText(getText(scoreEls[1])) : '',
            };

            if (batsman.name) {
              match.currentBatters.push(batsman);
            }
          }
        }

        // Extract bowler
        const bowlerContainer = query(card, selectors.BOWLER);
        if (bowlerContainer) {
          const nameEl = query(bowlerContainer, selectors.BOWLER_NAME);
          if (nameEl) {
            match.currentBowler.name = cleanText(getText(nameEl));
          }
          const stats = getText(bowlerContainer);
          const statsMatch = stats.match(
            /([\d.]+)\s+ov\s+(\d+)\s+m\s+(\d+)\s+r\s+(\d+)\s+w\s+([\d.]+)/i
          );
          if (statsMatch) {
            match.currentBowler.overs = statsMatch[1];
            match.currentBowler.maidens = statsMatch[2];
            match.currentBowler.runs = statsMatch[3];
            match.currentBowler.wickets = statsMatch[4];
            match.currentBowler.economy = statsMatch[5];
          }
        }

        // Extract overs timeline
        const timelineContainer = query(card, selectors.TIMELINE);
        if (timelineContainer) {
          const overEls = queryAll(timelineContainer, selectors.OVER);
          for (const el of overEls) {
            const overNumberEl = query(el, selectors.OVER_NUMBER);
            const balls = [];
            const ballEls = queryAll(el, selectors.BALL);
            for (const ballEl of ballEls) {
              const text = cleanText(getText(ballEl));
              if (text) balls.push(text);
            }
            if (overNumberEl || balls.length > 0) {
              match.oversTimeline.push({
                over: overNumberEl ? cleanText(getText(overNumberEl)) : '',
                balls: balls,
              });
            }
          }
        }

        // Series
        const seriesEl = query(card, selectors.SERIES);
        if (seriesEl) {
          match.series = cleanText(getText(seriesEl));
        }

        // Match title
        const titleEl = query(card, selectors.TITLE);
        if (titleEl) {
          match.matchTitle = cleanText(getText(titleEl));
        }

        // Venue
        const venueEl = query(card, selectors.VENUE);
        if (venueEl) {
          match.venue = cleanText(getText(venueEl));
        }

        // Generate match ID
        match.matchId = `finished_${Date.now()}_${matches.length}`;
        match.url = window.location.href;

        if (match.team1.name && match.team2.name) {
          matches.push(match);
          logs.push({
            selector: 'match extracted',
            found: true,
            value: `${match.team1.name} vs ${match.team2.name}`,
          });
        }
      }

      return { matches, logs };
    }, this.selectors);

    // Log results
    if (result.logs) {
      for (const log of result.logs) {
        if (log.found) {
          logger.debug(`  ✅ ${log.selector}: ${log.value}`);
        } else {
          logger.debug(`  ❌ ${log.selector}: ${log.value}`);
        }
      }
    }

    logger.info(`✅ Extracted ${result.matches.length} finished matches`);
    return result.matches;
  }
}

module.exports = FinishedScraper;

const BaseScraper = require('./base');
const logger = require('../logger');

class LiveScoreScraper extends BaseScraper {
  constructor(config = {}) {
    super(config);
    this.selectors = {
      // Updated selectors for ESPNcricinfo current site structure
      scoreContainer: config.selectors?.scoreContainer || '.ds-flex.ds-flex-col.ds-mt-2',
      battingTeam: config.selectors?.battingTeam || '.ds-text-tight-m.ds-font-bold.ds-capitalize',
      bowlingTeam: config.selectors?.bowlingTeam || '.ds-text-tight-m.ds-font-bold.ds-capitalize',
      currentScore: config.selectors?.currentScore || '.ds-text-title-m.ds-font-bold',
      overs: config.selectors?.overs || '.ds-text-tight-m',
      runRate: config.selectors?.runRate || '.ds-text-tight-m',
      batsmen: config.selectors?.batsmen || '.ds-flex.ds-flex-col',
      batsmanName: config.selectors?.batsmanName || '.ds-text-tight-s.ds-font-bold',
      batsmanRuns: config.selectors?.batsmanRuns || '.ds-text-tight-s.ds-font-medium',
      batsmanBalls: config.selectors?.batsmanBalls || '.ds-text-tight-s',
      bowler: config.selectors?.bowler || '.ds-flex.ds-flex-col',
      bowlerName: config.selectors?.bowlerName || '.ds-text-tight-s.ds-font-bold',
      bowlerStats: config.selectors?.bowlerStats || '.ds-text-tight-s.ds-font-medium',
      partnership: config.selectors?.partnership || '.ds-flex.ds-items-center',
      partnershipRuns: config.selectors?.partnershipRuns || '.ds-text-tight-m.ds-font-bold',
      partnershipBalls: config.selectors?.partnershipBalls || '.ds-text-tight-s',
      matchStatus: config.selectors?.matchStatus || '.ds-text-tight-m.ds-font-regular',
      // Alternative selectors if above don't work
      altScore: config.selectors?.altScore || '.ci-scorecard .score',
      altTeam: config.selectors?.altTeam || '.ci-team',
      altBatsmen: config.selectors?.altBatsmen || '.ci-batsmen',
    };
  }

  async scrape(page) {
    try {
      // Wait for dynamic content to load
      await page
        .waitForSelector('.ds-flex.ds-flex-col.ds-mt-2', { timeout: 10000 })
        .catch(() => {});

      const html = await this.getHtml(page);
      const $ = this.parseHtml(html);

      // Try multiple selector strategies
      let liveScore = await this.tryPrimarySelectors($, page);

      // If primary selectors fail, try alternative selectors
      if (!liveScore.currentScore.batting.score) {
        liveScore = await this.tryAlternativeSelectors($, page);
      }

      // If still empty, try to extract from common patterns
      if (!liveScore.currentScore.batting.score) {
        liveScore = await this.extractFromText($, page);
      }

      const sanitizedScore = this.sanitizeData(liveScore);
      logger.info(`Live score scraped for match: ${sanitizedScore.matchId}`);
      return sanitizedScore;
    } catch (error) {
      logger.error('LiveScore scraping failed:', error);
      throw error;
    }
  }

  async tryPrimarySelectors($, page) {
    try {
      // Extract batting and bowling teams
      const teams = $(this.selectors.battingTeam)
        .map((i, el) => $(el).text().trim())
        .get();
      const bowlingTeam = $(this.selectors.bowlingTeam)
        .map((i, el) => $(el).text().trim())
        .get();

      // Extract score
      const scoreText = $(this.selectors.currentScore).first().text().trim();
      const oversText = $(this.selectors.overs).first().text().trim();
      const runRateText = $(this.selectors.runRate).first().text().trim();

      // Extract batsmen
      const batsmen = await this.extractBatsmenPrimary($);

      // Extract bowler
      const bowler = await this.extractBowlerPrimary($);

      // Extract partnership
      const partnership = await this.extractPartnershipPrimary($);

      return {
        matchId: this.extractMatchId(page.url()),
        currentScore: {
          batting: {
            team: teams[0] || '',
            score: scoreText || '',
            overs: oversText || '',
            runRate: runRateText || '',
          },
          bowling: {
            team: teams[1] || bowlingTeam[0] || '',
            score: scoreText || '',
            overs: oversText || '',
            runRate: runRateText || '',
          },
        },
        currentBatsmen: batsmen,
        currentBowler: bowler,
        partnership: partnership,
        lastBall: '',
        status: $(this.selectors.matchStatus).first().text().trim(),
        timestamp: new Date().toISOString(),
        url: page.url(),
      };
    } catch (error) {
      logger.warn('Primary selectors failed:', error);
      return null;
    }
  }

  async tryAlternativeSelectors($, page) {
    try {
      // Alternative selectors for ESPNcricinfo
      const scoreText = $('.ds-text-title-m.ds-font-bold').first().text().trim();
      const teamTexts = $('.ds-text-tight-m.ds-font-bold.ds-capitalize')
        .map((i, el) => $(el).text().trim())
        .get();

      // Try to get batsmen from the scorecard
      const batsmen = [];
      $('.ds-flex.ds-flex-col.ds-gap-1').each((i, el) => {
        const name = $(el).find('.ds-text-tight-s.ds-font-bold').first().text().trim();
        const runs = $(el).find('.ds-text-tight-s.ds-font-medium').first().text().trim();
        if (name) {
          batsmen.push({
            name,
            runs: runs || '0',
            balls: '',
            fours: '',
            sixes: '',
            strikeRate: '',
            isOnStrike: i === 0,
          });
        }
      });

      return {
        matchId: this.extractMatchId(page.url()),
        currentScore: {
          batting: {
            team: teamTexts[0] || '',
            score: scoreText || '',
            overs: '',
            runRate: '',
          },
          bowling: {
            team: teamTexts[1] || '',
            score: scoreText || '',
            overs: '',
            runRate: '',
          },
        },
        currentBatsmen: batsmen,
        currentBowler: {
          name: '',
          overs: '',
          runs: '',
          wickets: '',
          economy: '',
        },
        partnership: {
          runs: '',
          balls: '',
          currentRate: '',
        },
        lastBall: '',
        status: $('.ds-text-tight-m.ds-font-regular').first().text().trim(),
        timestamp: new Date().toISOString(),
        url: page.url(),
      };
    } catch (error) {
      logger.warn('Alternative selectors failed:', error);
      return null;
    }
  }

  async extractFromText($, page) {
    try {
      // Try to extract score from page text using regex
      const pageText = $('body').text();
      const scoreMatch = pageText.match(/(\d+)\/(\d+)/);
      const teamMatch = pageText.match(/([A-Z][a-z]+)\s+(\d+)\/(\d+)/);

      return {
        matchId: this.extractMatchId(page.url()),
        currentScore: {
          batting: {
            team: teamMatch ? teamMatch[1] : '',
            score: scoreMatch ? `${scoreMatch[1]}/${scoreMatch[2]}` : '',
            overs: '',
            runRate: '',
          },
          bowling: {
            team: '',
            score: '',
            overs: '',
            runRate: '',
          },
        },
        currentBatsmen: [],
        currentBowler: {
          name: '',
          overs: '',
          runs: '',
          wickets: '',
          economy: '',
        },
        partnership: {
          runs: '',
          balls: '',
          currentRate: '',
        },
        lastBall: '',
        status: '',
        timestamp: new Date().toISOString(),
        url: page.url(),
      };
    } catch (error) {
      logger.warn('Text extraction failed:', error);
      return null;
    }
  }

  async extractBatsmenPrimary($) {
    try {
      const batsmen = [];
      const elements = $(this.selectors.batsmen);

      elements.each((index, element) => {
        const $el = $(element);
        const name = $el.find(this.selectors.batsmanName).first().text().trim();
        const runs = $el.find(this.selectors.batsmanRuns).first().text().trim();
        const balls = $el.find(this.selectors.batsmanBalls).first().text().trim();

        if (name) {
          batsmen.push({
            name,
            runs: runs || '0',
            balls: balls || '0',
            fours: '',
            sixes: '',
            strikeRate: '',
            isOnStrike: index === 0,
          });
        }
      });

      return batsmen;
    } catch (error) {
      logger.warn('Extract batsmen failed:', error);
      return [];
    }
  }

  async extractBowlerPrimary($) {
    try {
      const $el = $(this.selectors.bowler).first();
      const name = $el.find(this.selectors.bowlerName).first().text().trim();
      const stats = $el.find(this.selectors.bowlerStats).first().text().trim();

      // Parse stats (format: "4-0-25-1")
      const parts = stats.split('-');

      return {
        name: name || '',
        overs: parts[0] || '',
        runs: parts[2] || '',
        wickets: parts[3] || '',
        economy: '',
      };
    } catch (error) {
      logger.warn('Extract bowler failed:', error);
      return { name: '', overs: '', runs: '', wickets: '', economy: '' };
    }
  }

  async extractPartnershipPrimary($) {
    try {
      const $el = $(this.selectors.partnership).first();
      const runs = $el.find(this.selectors.partnershipRuns).first().text().trim();
      const balls = $el.find(this.selectors.partnershipBalls).first().text().trim();

      return {
        runs: runs || '',
        balls: balls || '',
        currentRate: '',
      };
    } catch (error) {
      logger.warn('Extract partnership failed:', error);
      return { runs: '', balls: '', currentRate: '' };
    }
  }

  extractMatchId(url) {
    const matchIdMatch = url.match(/(?:match|series)\/([a-f0-9-]+)/i);
    return matchIdMatch ? matchIdMatch[1] : 'current';
  }
}

module.exports = LiveScoreScraper;

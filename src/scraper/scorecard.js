const BaseScraper = require('./base');
const logger = require('../logger');

class ScorecardScraper extends BaseScraper {
  constructor(config = {}) {
    super(config);
    this.selectors = {
      inningsContainer: config.selectors?.inningsContainer || '.innings-container',
      battingTable: config.selectors?.battingTable || '.batting-table',
      bowlingTable: config.selectors?.bowlingTable || '.bowling-table',
      inningsTotal: config.selectors?.inningsTotal || '.innings-total',
      battingRow: config.selectors?.battingRow || '.batting-row',
      bowlingRow: config.selectors?.bowlingRow || '.bowling-row',
      playerName: config.selectors?.playerName || '.player-name',
      runs: config.selectors?.runs || '.runs',
      balls: config.selectors?.balls || '.balls',
      fours: config.selectors?.fours || '.fours',
      sixes: config.selectors?.sixes || '.sixes',
      strikeRate: config.selectors?.strikeRate || '.strike-rate',
      wickets: config.selectors?.wickets || '.wickets',
      overs: config.selectors?.overs || '.overs',
      economy: config.selectors?.economy || '.economy',
      extras: config.selectors?.extras || '.extras',
    };
  }

  async scrape(page) {
    try {
      const html = await this.getHtml(page);
      const $ = this.parseHtml(html);

      const scorecard = {
        matchId: this.extractMatchId(page.url()),
        innings: await this.extractInnings($),
        timestamp: new Date().toISOString(),
        url: page.url(),
      };

      const sanitizedScorecard = this.sanitizeData(scorecard);
      logger.info(`Scorecard scraped for match: ${sanitizedScorecard.matchId}`);
      return sanitizedScorecard;
    } catch (error) {
      logger.error('Scorecard scraping failed:', error);
      throw error;
    }
  }

  async extractInnings($) {
    try {
      const innings = [];
      const elements = $(this.selectors.inningsContainer);
      
      elements.each((index, element) => {
        const $el = $(element);
        const batting = this.extractBatting($el);
        const bowling = this.extractBowling($el);
        const total = $el.find(this.selectors.inningsTotal).text().trim();
        const extras = $el.find(this.selectors.extras).text().trim();

        innings.push({
          innings: index + 1,
          batting,
          bowling,
          total,
          extras,
        });
      });

      return innings;
    } catch (error) {
      logger.warn('Extract innings failed:', error);
      return [];
    }
  }

  extractBatting($container) {
    try {
      const batsmen = [];
      const rows = $container.find(this.selectors.battingRow);
      
      rows.each((index, row) => {
        const $row = $(row);
        const name = $row.find(this.selectors.playerName).text().trim();
        const runs = $row.find(this.selectors.runs).text().trim();
        const balls = $row.find(this.selectors.balls).text().trim();
        const fours = $row.find(this.selectors.fours).text().trim();
        const sixes = $row.find(this.selectors.sixes).text().trim();
        const strikeRate = $row.find(this.selectors.strikeRate).text().trim();

        if (name) {
          batsmen.push({
            name,
            runs: runs || '0',
            balls: balls || '0',
            fours: fours || '0',
            sixes: sixes || '0',
            strikeRate: strikeRate || '0.00',
          });
        }
      });

      return batsmen;
    } catch (error) {
      logger.warn('Extract batting failed:', error);
      return [];
    }
  }

  extractBowling($container) {
    try {
      const bowlers = [];
      const rows = $container.find(this.selectors.bowlingRow);
      
      rows.each((index, row) => {
        const $row = $(row);
        const name = $row.find(this.selectors.playerName).text().trim();
        const overs = $row.find(this.selectors.overs).text().trim();
        const runs = $row.find(this.selectors.runs).text().trim();
        const wickets = $row.find(this.selectors.wickets).text().trim();
        const economy = $row.find(this.selectors.economy).text().trim();

        if (name) {
          bowlers.push({
            name,
            overs: overs || '0',
            runs: runs || '0',
            wickets: wickets || '0',
            economy: economy || '0.00',
          });
        }
      });

      return bowlers;
    } catch (error) {
      logger.warn('Extract bowling failed:', error);
      return [];
    }
  }

  extractMatchId(url) {
    const matchIdMatch = url.match(/(?:match|series)\/([a-f0-9-]+)/i);
    return matchIdMatch ? matchIdMatch[1] : `match_${Date.now()}`;
  }
}

module.exports = ScorecardScraper;
const BaseScraper = require('./base');
const logger = require('../logger');

class MatchDetailsScraper extends BaseScraper {
  constructor(config = {}) {
    super(config);
    this.selectors = {
      matchInfo: config.selectors?.matchInfo || '.match-info',
      matchTitle: config.selectors?.matchTitle || '.match-title',
      matchStatus: config.selectors?.matchStatus || '.match-status',
      venue: config.selectors?.venue || '.venue',
      series: config.selectors?.series || '.series-name',
      toss: config.selectors?.toss || '.toss-info',
      umpires: config.selectors?.umpires || '.umpires',
      referee: config.selectors?.referee || '.referee',
      matchDate: config.selectors?.matchDate || '.match-date',
      teamLineups: config.selectors?.teamLineups || '.lineups',
    };
  }

  async scrape(page) {
    try {
      const html = await this.getHtml(page);
      const $ = this.parseHtml(html);

      const details = {
        matchId: this.extractMatchId(page.url()),
        title: this.extractText($, this.selectors.matchTitle),
        status: this.extractText($, this.selectors.matchStatus),
        venue: this.extractText($, this.selectors.venue),
        series: this.extractText($, this.selectors.series),
        toss: await this.extractTossInfo($),
        umpires: await this.extractUmpires($),
        referee: this.extractText($, this.selectors.referee),
        matchDate: this.extractText($, this.selectors.matchDate),
        lineups: await this.extractLineups($),
        url: page.url(),
      };

      const sanitizedDetails = this.sanitizeData(details);
      logger.info(`Match details scraped for: ${sanitizedDetails.matchId}`);
      return sanitizedDetails;
    } catch (error) {
      logger.error('MatchDetails scraping failed:', error);
      throw error;
    }
  }

  async extractTossInfo($) {
    try {
      const $el = $(this.selectors.toss);
      return {
        winner: $el.find('.toss-winner').text().trim(),
        decision: $el.find('.toss-decision').text().trim(),
        description: $el.text().trim(),
      };
    } catch (error) {
      logger.warn('Extract toss info failed:', error);
      return null;
    }
  }

  async extractUmpires($) {
    try {
      const umpires = [];
      const elements = $(this.selectors.umpires);
      elements.each((index, element) => {
        umpires.push($(element).text().trim());
      });
      return umpires;
    } catch (error) {
      logger.warn('Extract umpires failed:', error);
      return [];
    }
  }

  async extractLineups($) {
    try {
      const lineups = {};
      const elements = $(this.selectors.teamLineups);
      
      elements.each((index, element) => {
        const $el = $(element);
        const team = $el.find('.team-name').text().trim();
        const players = $el.find('.player').map((i, player) => {
          return $(player).text().trim();
        }).get();
        
        lineups[team] = players;
      });

      return lineups;
    } catch (error) {
      logger.warn('Extract lineups failed:', error);
      return {};
    }
  }

  extractMatchId(url) {
    const matchIdMatch = url.match(/(?:match|series)\/([a-f0-9-]+)/i);
    return matchIdMatch ? matchIdMatch[1] : `match_${Date.now()}`;
  }
}

module.exports = MatchDetailsScraper;
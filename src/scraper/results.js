const BaseScraper = require('./base');
const logger = require('../logger');

class ResultsScraper extends BaseScraper {
  constructor(config = {}) {
    super(config);
    this.selectors = {
      resultContainer: config.selectors?.resultContainer || '.result-container',
      resultCard: config.selectors?.resultCard || '.result-card',
      matchTitle: config.selectors?.matchTitle || '.match-title',
      team1: config.selectors?.team1 || '.team-1',
      team2: config.selectors?.team2 || '.team-2',
      score1: config.selectors?.score1 || '.score-1',
      score2: config.selectors?.score2 || '.score-2',
      result: config.selectors?.result || '.result',
      winner: config.selectors?.winner || '.winner',
      margin: config.selectors?.margin || '.margin',
      manOfMatch: config.selectors?.manOfMatch || '.man-of-match',
      matchDate: config.selectors?.matchDate || '.match-date',
      matchLink: config.selectors?.matchLink || '.match-link',
    };
  }

  async scrape(page) {
    try {
      const html = await this.getHtml(page);
      const $ = this.parseHtml(html);

      const results = await this.extractResults($, page.url());
      const sanitizedResults = this.sanitizeData(results);
      
      logger.info(`Scraped ${sanitizedResults.length} results`);
      return sanitizedResults;
    } catch (error) {
      logger.error('Results scraping failed:', error);
      throw error;
    }
  }

  async extractResults($, baseUrl) {
    try {
      const results = [];
      const elements = $(this.selectors.resultContainer);
      
      elements.each((index, element) => {
        const $el = $(element);
        const link = $el.find(this.selectors.matchLink).attr('href') || '';
        
        results.push({
          id: this.extractMatchId(link),
          title: $el.find(this.selectors.matchTitle).text().trim(),
          team1: $el.find(this.selectors.team1).text().trim(),
          team2: $el.find(this.selectors.team2).text().trim(),
          score1: $el.find(this.selectors.score1).text().trim(),
          score2: $el.find(this.selectors.score2).text().trim(),
          result: $el.find(this.selectors.result).text().trim(),
          winner: $el.find(this.selectors.winner).text().trim(),
          margin: $el.find(this.selectors.margin).text().trim(),
          manOfMatch: $el.find(this.selectors.manOfMatch).text().trim(),
          matchDate: $el.find(this.selectors.matchDate).text().trim(),
          url: link.startsWith('http') ? link : `${baseUrl}${link}`,
        });
      });

      return results;
    } catch (error) {
      logger.warn('Extract results failed:', error);
      return [];
    }
  }

  extractMatchId(url) {
    const idMatch = url.match(/(?:match|series)\/([a-f0-9-]+)/i);
    return idMatch ? idMatch[1] : `result_${Date.now()}`;
  }
}

module.exports = ResultsScraper;
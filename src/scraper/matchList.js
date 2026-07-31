const BaseScraper = require('./base');
const logger = require('../logger');

class MatchListScraper extends BaseScraper {
  constructor(config = {}) {
    super(config);
    this.selectors = {
      matchContainer: config.selectors?.matchContainer || '.ds-grow',
      matchTitle: config.selectors?.matchTitle || '.ds-text-tight-m',
      matchStatus: config.selectors?.matchStatus || '.ds-text-tight-s',
      matchType: config.selectors?.matchType || '.ds-text-tight-s',
      venue: config.selectors?.venue || '.ds-text-tight-s',
      team1: config.selectors?.team1 || '.ds-text-tight-m',
      team2: config.selectors?.team2 || '.ds-text-tight-m',
      score1: config.selectors?.score1 || '.ds-text-tight-m',
      score2: config.selectors?.score2 || '.ds-text-tight-m',
      result: config.selectors?.result || '.ds-text-tight-s',
      matchLink: config.selectors?.matchLink || 'a[href*="/match/"]',
      matchDate: config.selectors?.matchDate || '.ds-text-tight-s',
    };
  }

  async scrape(page) {
    try {
      await page.waitForSelector('.ds-grow', { timeout: 10000 }).catch(() => {});
      
      const html = await this.getHtml(page);
      const $ = this.parseHtml(html);

      const matches = await this.extractMatches($, page.url());
      const sanitizedMatches = this.sanitizeData(matches);
      logger.info(`Scraped ${sanitizedMatches.length} matches`);
      return sanitizedMatches;
    } catch (error) {
      logger.error('MatchList scraping failed:', error);
      return [];
    }
  }

  async extractMatches($, baseUrl) {
    try {
      const matches = [];
      
      const matchElements = $('.ds-grow');
      
      matchElements.each((index, element) => {
        const $el = $(element);
        const link = $el.find('a[href*="/match/"]').attr('href') || '';
        const texts = $el.find('.ds-text-tight-m').map((i, el) => $(el).text().trim()).get();
        
        matches.push({
          id: this.extractMatchId(link) || `match_${Date.now()}_${index}`,
          title: texts[0] || '',
          matchType: '',
          status: $el.find('.ds-text-tight-s').first().text().trim() || '',
          venue: '',
          team1: texts[0] || '',
          team2: texts[1] || '',
          score1: '',
          score2: '',
          result: '',
          matchDate: '',
          url: link.startsWith('http') ? link : `${baseUrl}${link}`,
        });
      });

      return matches;
    } catch (error) {
      logger.warn('Extract matches failed:', error);
      return [];
    }
  }

  extractMatchId(url) {
    const matchIdMatch = url.match(/(?:match|series)\/([a-f0-9-]+)/i);
    return matchIdMatch ? matchIdMatch[1] : null;
  }
}

module.exports = MatchListScraper;
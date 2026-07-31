const BaseScraper = require('./base');
const logger = require('../logger');

class CommentaryScraper extends BaseScraper {
  constructor(config = {}) {
    super(config);
    this.selectors = {
      commentaryContainer: config.selectors?.commentaryContainer || '.ds-px-4',
      overInfo: config.selectors?.overInfo || '.ds-text-tight-s',
      ballInfo: config.selectors?.ballInfo || '.ds-text-tight-s',
      commentaryText: config.selectors?.commentaryText || '.ds-text-tight-m',
      commentaryType: config.selectors?.commentaryType || '.ds-text-tight-s',
      currentOver: config.selectors?.currentOver || '.ds-text-title-m',
      recentOvers: config.selectors?.recentOvers || '.ds-flex',
    };
  }

  async scrape(page) {
    try {
      await page.waitForSelector('.ds-px-4', { timeout: 10000 }).catch(() => {});
      
      const html = await this.getHtml(page);
      const $ = this.parseHtml(html);

      const commentary = {
        matchId: this.extractMatchId(page.url()),
        currentOver: await this.extractCurrentOver($),
        recentOvers: await this.extractRecentOvers($),
        commentary: await this.extractCommentaryEntries($),
        timestamp: new Date().toISOString(),
        url: page.url(),
      };

      const sanitizedCommentary = this.sanitizeData(commentary);
      logger.info(`Commentary scraped for match: ${sanitizedCommentary.matchId}`);
      return sanitizedCommentary;
    } catch (error) {
      logger.error('Commentary scraping failed:', error);
      return {
        matchId: this.extractMatchId(page.url()),
        currentOver: null,
        recentOvers: [],
        commentary: [],
        timestamp: new Date().toISOString(),
        url: page.url(),
      };
    }
  }

  async extractCurrentOver($) {
    try {
      const overText = $('.ds-text-title-m').first().text().trim();
      return {
        over: overText || '',
        runs: '',
        wickets: '',
        balls: '',
      };
    } catch (error) {
      logger.warn('Extract current over failed:', error);
      return null;
    }
  }

  async extractRecentOvers($) {
    try {
      const overs = [];
      const elements = $('.ds-flex');
      
      elements.each((index, element) => {
        const text = $(element).text().trim();
        if (text && text.match(/\d/)) {
          overs.push({
            over: `Over ${index + 1}`,
            runs: text,
            wickets: '',
            balls: '',
          });
        }
      });

      return overs.slice(0, 5);
    } catch (error) {
      logger.warn('Extract recent overs failed:', error);
      return [];
    }
  }

  async extractCommentaryEntries($) {
    try {
      const entries = [];
      const elements = $('.ds-px-4 .ds-text-tight-m');
      
      elements.each((index, element) => {
        const text = $(element).text().trim();
        if (text && text.length > 10) {
          entries.push({
            over: `Over ${Math.floor(index / 6) + 1}`,
            ball: `${(index % 6) + 1}`,
            text: text,
            type: 'normal',
            batsmanComment: '',
            timestamp: new Date().toISOString(),
          });
        }
      });

      return entries.slice(0, 20);
    } catch (error) {
      logger.warn('Extract commentary entries failed:', error);
      return [];
    }
  }

  extractMatchId(url) {
    const matchIdMatch = url.match(/(?:match|series)\/([a-f0-9-]+)/i);
    return matchIdMatch ? matchIdMatch[1] : 'current';
  }
}

module.exports = CommentaryScraper;
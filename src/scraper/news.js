const BaseScraper = require('./base');
const logger = require('../logger');

class NewsScraper extends BaseScraper {
  constructor(config = {}) {
    super(config);
    this.selectors = {
      newsContainer: config.selectors?.newsContainer || '.ds-flex.ds-flex-col',
      newsItem: config.selectors?.newsItem || '.ds-border.ds-border-line',
      newsTitle: config.selectors?.newsTitle || '.ds-text-title-s.ds-font-bold',
      newsContent: config.selectors?.newsContent || '.ds-text-tight-m',
      newsDate: config.selectors?.newsDate || '.ds-text-tight-s',
      newsSource: config.selectors?.newsSource || '.ds-text-tight-s',
      newsLink: config.selectors?.newsLink || 'a[href*="/story/"]',
      newsImage: config.selectors?.newsImage || 'img',
      newsCategory: config.selectors?.newsCategory || '.ds-text-tight-s',
    };
  }

  async scrape(page) {
    try {
      // Wait for content
      await page.waitForSelector('.ds-flex.ds-flex-col', { timeout: 10000 }).catch(() => {});

      const html = await this.getHtml(page);
      const $ = this.parseHtml(html);

      let newsItems = await this.extractNews($, page.url());

      if (newsItems.length === 0) {
        newsItems = await this.extractNewsAlternative($, page.url());
      }

      const sanitizedNews = this.sanitizeData(newsItems);
      logger.info(`Scraped ${sanitizedNews.length} news items`);
      return sanitizedNews;
    } catch (error) {
      logger.error('News scraping failed:', error);
      return [];
    }
  }

  async extractNews($, baseUrl) {
    try {
      const news = [];

      // Find news items
      const items = $('.ds-border.ds-border-line');

      items.each((index, element) => {
        const $el = $(element);

        const title = $el.find('.ds-text-title-s.ds-font-bold').first().text().trim();
        const content = $el.find('.ds-text-tight-m').first().text().trim();
        const link = $el.find('a[href*="/story/"]').attr('href') || '';
        const date = $el.find('.ds-text-tight-s').first().text().trim();
        const image = $el.find('img').attr('src') || '';

        if (title) {
          news.push({
            id: this.extractNewsId(link) || `news_${Date.now()}_${index}`,
            title: title,
            content: content || title,
            publishedDate: date || '',
            source: 'ESPNcricinfo',
            category: '',
            imageUrl: image,
            url: link.startsWith('http') ? link : `${baseUrl}${link}`,
          });
        }
      });

      return news;
    } catch (error) {
      logger.warn('Extract news failed:', error);
      return [];
    }
  }

  async extractNewsAlternative($, baseUrl) {
    try {
      const news = [];

      // Alternative - look for story links
      const links = $('a[href*="/story/"]');

      links.each((index, element) => {
        const $el = $(element);
        const link = $el.attr('href') || '';
        const title = $el.text().trim();

        if (title && link) {
          news.push({
            id: this.extractNewsId(link) || `news_${Date.now()}_${index}`,
            title: title,
            content: title,
            publishedDate: '',
            source: 'ESPNcricinfo',
            category: '',
            imageUrl: '',
            url: link.startsWith('http') ? link : `${baseUrl}${link}`,
          });
        }
      });

      return news;
    } catch (error) {
      logger.warn('Alternative extract news failed:', error);
      return [];
    }
  }

  extractNewsId(url) {
    const idMatch = url.match(/(?:news|story)\/([a-f0-9-]+)/i);
    return idMatch ? idMatch[1] : null;
  }
}

module.exports = NewsScraper;

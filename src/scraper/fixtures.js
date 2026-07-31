const BaseScraper = require('./base');
const logger = require('../logger');

class FixturesScraper extends BaseScraper {
  constructor(config = {}) {
    super(config);
    this.selectors = {
      // Updated selectors for ESPNcricinfo
      fixtureContainer: config.selectors?.fixtureContainer || '.ds-grow.ds-px-4.ds-py-3',
      fixtureCard: config.selectors?.fixtureCard || '.ds-flex.ds-flex-col.ds-border.ds-border-line',
      fixtureDate: config.selectors?.fixtureDate || '.ds-text-tight-s.ds-font-regular',
      team1: config.selectors?.team1 || '.ds-text-tight-m.ds-font-bold',
      team2: config.selectors?.team2 || '.ds-text-tight-m.ds-font-bold',
      venue: config.selectors?.venue || '.ds-text-tight-s.ds-font-regular',
      matchType: config.selectors?.matchType || '.ds-text-tight-s.ds-font-regular',
      series: config.selectors?.series || '.ds-text-tight-s.ds-font-bold',
      matchLink: config.selectors?.matchLink || 'a[href*="/match/"]',
      time: config.selectors?.time || '.ds-text-tight-s',
    };
  }

  async scrape(page) {
    try {
      // Wait for content to load
      await page.waitForSelector('.ds-grow.ds-px-4.ds-py-3', { timeout: 10000 }).catch(() => {});
      
      const html = await this.getHtml(page);
      const $ = this.parseHtml(html);

      // Try multiple selector strategies
      let fixtures = await this.extractFixtures($, page.url());
      
      if (fixtures.length === 0) {
        fixtures = await this.extractFixturesAlternative($, page.url());
      }

      const sanitizedFixtures = this.sanitizeData(fixtures);
      logger.info(`Scraped ${sanitizedFixtures.length} fixtures`);
      return sanitizedFixtures;
    } catch (error) {
      logger.error('Fixtures scraping failed:', error);
      return [];
    }
  }

  async extractFixtures($, baseUrl) {
    try {
      const fixtures = [];
      
      // Look for match cards
      const cards = $('.ds-flex.ds-flex-col.ds-border.ds-border-line');
      
      cards.each((index, element) => {
        const $el = $(element);
        
        // Find teams
        const teamElements = $el.find('.ds-text-tight-m.ds-font-bold');
        const teams = teamElements.map((i, el) => $(el).text().trim()).get();
        
        // Find match link
        const link = $el.find('a[href*="/match/"]').attr('href') || '';
        
        // Find venue
        const venue = $el.find('.ds-text-tight-s.ds-font-regular').first().text().trim();
        
        // Find date/time
        const dateTime = $el.find('.ds-text-tight-s').last().text().trim();
        
        if (teams.length >= 2) {
          fixtures.push({
            id: this.extractFixtureId(link) || `fixture_${Date.now()}_${index}`,
            title: `${teams[0]} vs ${teams[1]}`,
            team1: teams[0] || '',
            team2: teams[1] || '',
            venue: venue || '',
            matchType: '',
            series: '',
            matchDate: dateTime || '',
            time: '',
            url: link.startsWith('http') ? link : `${baseUrl}${link}`,
          });
        }
      });

      return fixtures;
    } catch (error) {
      logger.warn('Extract fixtures failed:', error);
      return [];
    }
  }

  async extractFixturesAlternative($, baseUrl) {
    try {
      const fixtures = [];
      
      // Alternative approach - look for any match links
      const links = $('a[href*="/match/"]');
      
      links.each((index, element) => {
        const $el = $(element);
        const link = $el.attr('href') || '';
        const text = $el.text().trim();
        
        // Try to parse team names from text
        const teams = text.split('vs').map(t => t.trim());
        
        if (teams.length >= 2) {
          fixtures.push({
            id: this.extractFixtureId(link) || `fixture_${Date.now()}_${index}`,
            title: text,
            team1: teams[0] || '',
            team2: teams[1] || '',
            venue: '',
            matchType: '',
            series: '',
            matchDate: '',
            time: '',
            url: link.startsWith('http') ? link : `${baseUrl}${link}`,
          });
        }
      });

      return fixtures;
    } catch (error) {
      logger.warn('Alternative extract fixtures failed:', error);
      return [];
    }
  }

  extractFixtureId(url) {
    const idMatch = url.match(/(?:match|series)\/([a-f0-9-]+)/i);
    return idMatch ? idMatch[1] : null;
  }
}

module.exports = FixturesScraper;
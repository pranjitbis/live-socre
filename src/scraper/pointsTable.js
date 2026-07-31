const BaseScraper = require('./base');
const logger = require('../logger');

class PointsTableScraper extends BaseScraper {
  constructor(config = {}) {
    super(config);
    this.selectors = {
      tableContainer: config.selectors?.tableContainer || '.ds-w-full',
      tableHeader: config.selectors?.tableHeader || '.ds-text-tight-s',
      tableRow: config.selectors?.tableRow || '.ds-border-b',
      teamName: config.selectors?.teamName || '.ds-text-tight-m',
      played: config.selectors?.played || '.ds-text-tight-m',
      won: config.selectors?.won || '.ds-text-tight-m',
      lost: config.selectors?.lost || '.ds-text-tight-m',
      tied: config.selectors?.tied || '.ds-text-tight-m',
      noResult: config.selectors?.noResult || '.ds-text-tight-m',
      points: config.selectors?.points || '.ds-text-tight-m',
      netRunRate: config.selectors?.netRunRate || '.ds-text-tight-m',
      tournamentName: config.selectors?.tournamentName || '.ds-text-title-m',
    };
  }

  async scrape(page) {
    try {
      await page.waitForSelector('.ds-w-full', { timeout: 10000 }).catch(() => {});
      
      const html = await this.getHtml(page);
      const $ = this.parseHtml(html);

      const pointsTable = {
        tournament: this.extractTournament($),
        standings: await this.extractStandings($),
        timestamp: new Date().toISOString(),
        url: page.url(),
      };

      const sanitizedTable = this.sanitizeData(pointsTable);
      logger.info(`Points table scraped for tournament: ${sanitizedTable.tournament}`);
      return sanitizedTable;
    } catch (error) {
      logger.error('PointsTable scraping failed:', error);
      return {
        tournament: 'Unknown',
        standings: [],
        timestamp: new Date().toISOString(),
        url: page.url(),
      };
    }
  }

  extractTournament($) {
    return $('.ds-text-title-m').first().text().trim() || 'Unknown Tournament';
  }

  async extractStandings($) {
    try {
      const standings = [];
      const rows = $('.ds-border-b');
      
      rows.each((index, element) => {
        const $row = $(element);
        const cells = $row.find('.ds-text-tight-m');
        const team = cells.eq(0).text().trim();
        
        if (team && team.length > 0) {
          standings.push({
            position: index + 1,
            team: team,
            played: parseInt(cells.eq(1).text().trim()) || 0,
            won: parseInt(cells.eq(2).text().trim()) || 0,
            lost: parseInt(cells.eq(3).text().trim()) || 0,
            tied: parseInt(cells.eq(4).text().trim()) || 0,
            noResult: parseInt(cells.eq(5).text().trim()) || 0,
            points: parseInt(cells.eq(6).text().trim()) || 0,
            netRunRate: parseFloat(cells.eq(7).text().trim()) || 0,
          });
        }
      });

      return standings;
    } catch (error) {
      logger.warn('Extract standings failed:', error);
      return [];
    }
  }
}

module.exports = PointsTableScraper;
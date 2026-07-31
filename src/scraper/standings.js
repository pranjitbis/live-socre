const BaseScraper = require('./base');
const logger = require('../logger');

class StandingsScraper extends BaseScraper {
  constructor(config = {}) {
    super(config);
    this.selectors = {
      standingsContainer: config.selectors?.standingsContainer || '.standings-container',
      groupStandings: config.selectors?.groupStandings || '.group-standings',
      groupName: config.selectors?.groupName || '.group-name',
      teamStanding: config.selectors?.teamStanding || '.team-standing',
      teamName: config.selectors?.teamName || '.team-name',
      position: config.selectors?.position || '.position',
      points: config.selectors?.points || '.points',
      played: config.selectors?.played || '.played',
      won: config.selectors?.won || '.won',
      lost: config.selectors?.lost || '.lost',
      tied: config.selectors?.tied || '.tied',
      noResult: config.selectors?.noResult || '.no-result',
      netRunRate: config.selectors?.netRunRate || '.net-run-rate',
    };
  }

  async scrape(page) {
    try {
      const html = await this.getHtml(page);
      const $ = this.parseHtml(html);

      const standings = {
        tournament: this.extractTournament($),
        groups: await this.extractGroups($),
        timestamp: new Date().toISOString(),
        url: page.url(),
      };

      const sanitizedStandings = this.sanitizeData(standings);
      logger.info(`Standings scraped for tournament: ${sanitizedStandings.tournament}`);
      return sanitizedStandings;
    } catch (error) {
      logger.error('Standings scraping failed:', error);
      throw error;
    }
  }

  extractTournament($) {
    return this.extractText($, '.tournament-name') || 'Unknown Tournament';
  }

  async extractGroups($) {
    try {
      const groups = [];
      const elements = $(this.selectors.groupStandings);
      
      elements.each((index, element) => {
        const $el = $(element);
        const groupName = $el.find(this.selectors.groupName).text().trim();
        const standings = this.extractTeamStandings($el);
        
        if (standings.length > 0) {
          groups.push({
            name: groupName || `Group ${index + 1}`,
            standings,
          });
        }
      });

      return groups;
    } catch (error) {
      logger.warn('Extract groups failed:', error);
      return [];
    }
  }

  extractTeamStandings($container) {
    try {
      const standings = [];
      const elements = $container.find(this.selectors.teamStanding);
      
      elements.each((index, element) => {
        const $el = $(element);
        const team = $el.find(this.selectors.teamName).text().trim();
        
        if (team) {
          standings.push({
            position: parseInt($el.find(this.selectors.position).text().trim()) || index + 1,
            team,
            points: parseInt($el.find(this.selectors.points).text().trim()) || 0,
            played: parseInt($el.find(this.selectors.played).text().trim()) || 0,
            won: parseInt($el.find(this.selectors.won).text().trim()) || 0,
            lost: parseInt($el.find(this.selectors.lost).text().trim()) || 0,
            tied: parseInt($el.find(this.selectors.tied).text().trim()) || 0,
            noResult: parseInt($el.find(this.selectors.noResult).text().trim()) || 0,
            netRunRate: parseFloat($el.find(this.selectors.netRunRate).text().trim()) || 0,
          });
        }
      });

      return standings;
    } catch (error) {
      logger.warn('Extract team standings failed:', error);
      return [];
    }
  }
}

module.exports = StandingsScraper;
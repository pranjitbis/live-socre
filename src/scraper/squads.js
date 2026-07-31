const BaseScraper = require('./base');
const logger = require('../logger');

class SquadsScraper extends BaseScraper {
  constructor(config = {}) {
    super(config);
    this.selectors = {
      squadContainer: config.selectors?.squadContainer || '.squad-container',
      teamSquad: config.selectors?.teamSquad || '.team-squad',
      teamName: config.selectors?.teamName || '.team-name',
      playerName: config.selectors?.playerName || '.player-name',
      playerRole: config.selectors?.playerRole || '.player-role',
      captain: config.selectors?.captain || '.captain',
      wicketkeeper: config.selectors?.wicketkeeper || '.wicketkeeper',
      playerImage: config.selectors?.playerImage || '.player-image',
    };
  }

  async scrape(page) {
    try {
      const html = await this.getHtml(page);
      const $ = this.parseHtml(html);

      const squads = {
        matchId: this.extractMatchId(page.url()),
        teams: await this.extractTeamSquads($),
        timestamp: new Date().toISOString(),
        url: page.url(),
      };

      const sanitizedSquads = this.sanitizeData(squads);
      logger.info(`Squads scraped for match: ${sanitizedSquads.matchId}`);
      return sanitizedSquads;
    } catch (error) {
      logger.error('Squads scraping failed:', error);
      throw error;
    }
  }

  async extractTeamSquads($) {
    try {
      const teams = {};
      const elements = $(this.selectors.teamSquad);
      
      elements.each((index, element) => {
        const $el = $(element);
        const teamName = $el.find(this.selectors.teamName).text().trim();
        const players = this.extractPlayers($el);
        
        if (teamName) {
          teams[teamName] = players;
        }
      });

      return teams;
    } catch (error) {
      logger.warn('Extract team squads failed:', error);
      return {};
    }
  }

  extractPlayers($container) {
    try {
      const players = [];
      const elements = $container.find(this.selectors.playerName);
      
      elements.each((index, element) => {
        const $el = $(element);
        const name = $el.text().trim();
        const role = $el.closest(this.selectors.playerName)
          .find(this.selectors.playerRole).text().trim();
        const isCaptain = $el.closest(this.selectors.playerName)
          .find(this.selectors.captain).length > 0;
        const isWicketkeeper = $el.closest(this.selectors.playerName)
          .find(this.selectors.wicketkeeper).length > 0;
        const image = $el.closest(this.selectors.playerName)
          .find(this.selectors.playerImage).attr('src') || '';

        if (name) {
          players.push({
            name,
            role: role || 'Batsman',
            isCaptain,
            isWicketkeeper,
            image,
          });
        }
      });

      return players;
    } catch (error) {
      logger.warn('Extract players failed:', error);
      return [];
    }
  }

  extractMatchId(url) {
    const matchIdMatch = url.match(/(?:match|series)\/([a-f0-9-]+)/i);
    return matchIdMatch ? matchIdMatch[1] : `match_${Date.now()}`;
  }
}

module.exports = SquadsScraper;
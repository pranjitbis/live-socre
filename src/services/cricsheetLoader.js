// src/services/cricsheetLoader.js
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

class CricsheetLoader {
  constructor() {
    this.dataPath = process.env.CRICSHEET_DATA_PATH || path.join(process.cwd(), 'data/cricsheet');
    this.cache = {
      data: null,
      lastLoad: null,
      women: [],
      men: [],
      all: [],
    };
    this.isLoading = false;
    this.loadPromise = null;
  }

  /**
   * Load all Cricsheet JSON files from the data directory
   */
  async loadAll() {
    // If already loading, return existing promise
    if (this.isLoading && this.loadPromise) {
      return this.loadPromise;
    }

    // If cache is fresh (less than 60 seconds), return cached data
    if (this.cache.data && this.cache.lastLoad) {
      const age = Date.now() - this.cache.lastLoad;
      if (age < 60000) {
        logger.debug(`📊 Using cached Cricsheet data (${age}ms old)`);
        return this.cache.data;
      }
    }

    this.isLoading = true;
    this.loadPromise = this._loadAllInternal();

    try {
      const result = await this.loadPromise;
      return result;
    } finally {
      this.isLoading = false;
      this.loadPromise = null;
    }
  }

  /**
   * Internal load method
   */
  async _loadAllInternal() {
    logger.info('📂 Loading Cricsheet data from:', this.dataPath);

    if (!fs.existsSync(this.dataPath)) {
      logger.warn(`⚠️ Cricsheet data path not found: ${this.dataPath}`);
      this.cache.data = [];
      this.cache.women = [];
      this.cache.men = [];
      return [];
    }

    const allMatches = [];
    const womenMatches = [];
    const menMatches = [];

    try {
      // Get all directories and files
      const items = fs.readdirSync(this.dataPath, { withFileTypes: true });

      // Process directories
      for (const item of items) {
        if (item.isDirectory()) {
          const dirPath = path.join(this.dataPath, item.name);
          const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'));

          logger.info(`📁 Processing directory: ${item.name} (${files.length} files)`);

          for (const file of files) {
            try {
              const filePath = path.join(dirPath, file);
              const match = this._loadMatchFile(filePath, item.name);

              if (match) {
                allMatches.push(match);

                // Determine gender from match data
                const gender = this._detectGender(match);
                if (gender === 'women') {
                  womenMatches.push(match);
                } else if (gender === 'men') {
                  menMatches.push(match);
                }
              }
            } catch (error) {
              logger.warn(`⚠️ Error loading ${file}: ${error.message}`);
            }
          }
        } else if (item.isFile() && item.name.endsWith('.json')) {
          // Also process JSON files directly in the root
          try {
            const filePath = path.join(this.dataPath, item.name);
            const match = this._loadMatchFile(filePath, 'root');

            if (match) {
              allMatches.push(match);
              const gender = this._detectGender(match);
              if (gender === 'women') {
                womenMatches.push(match);
              } else if (gender === 'men') {
                menMatches.push(match);
              }
            }
          } catch (error) {
            logger.warn(`⚠️ Error loading ${item.name}: ${error.message}`);
          }
        }
      }

      // Update cache
      this.cache.data = allMatches;
      this.cache.women = womenMatches;
      this.cache.men = menMatches;
      this.cache.lastLoad = Date.now();

      logger.info(
        `✅ Loaded ${allMatches.length} matches (${womenMatches.length} women, ${menMatches.length} men)`
      );

      return allMatches;
    } catch (error) {
      logger.error(`❌ Error loading Cricsheet data: ${error.message}`);
      this.cache.data = [];
      this.cache.women = [];
      this.cache.men = [];
      return [];
    }
  }

  /**
   * Load a single match file
   */
  _loadMatchFile(filePath, sourceDir) {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);

    // Add metadata
    data._sourceFile = path.basename(filePath);
    data._sourceDir = sourceDir;
    data._loadedAt = new Date().toISOString();

    // Detect gender from file name if not present in data
    if (!data.info?.gender) {
      data.info = data.info || {};
      data.info.gender = this._detectGenderFromFileName(path.basename(filePath), sourceDir);
    }

    // Ensure gender is set
    if (!data.info.gender) {
      data.info.gender = this._detectGender(data);
    }

    return data;
  }

  /**
   * Detect gender from file name and directory
   */
  _detectGenderFromFileName(filename, sourceDir) {
    const lowerFileName = filename.toLowerCase();
    const lowerDir = sourceDir.toLowerCase();

    // Check directory name
    if (lowerDir.includes('women') || lowerDir.includes('female')) {
      return 'women';
    }
    if (lowerDir.includes('men') || lowerDir.includes('male') || lowerDir.includes('mech')) {
      return 'men';
    }

    // Check file name
    if (lowerFileName.includes('women') || lowerFileName.includes('female')) {
      return 'women';
    }
    if (lowerFileName.includes('men') || lowerFileName.includes('male')) {
      return 'men';
    }

    // Check for team names that indicate women's cricket
    const womenTeams = ['women', 'womens', 'female', 'girls', 'lady', 'ladies'];
    if (womenTeams.some((term) => lowerFileName.includes(term) || lowerDir.includes(term))) {
      return 'women';
    }

    return null;
  }

  /**
   * Detect gender from match data
   */
  _detectGender(match) {
    // Check info.gender field
    if (match.info?.gender) {
      const gender = match.info.gender.toLowerCase();
      if (gender === 'female' || gender === 'women' || gender === 'woman') {
        return 'women';
      }
      if (gender === 'male' || gender === 'men' || gender === 'man') {
        return 'men';
      }
    }

    // Check file name
    const genderFromFile = this._detectGenderFromFileName(
      match._sourceFile || '',
      match._sourceDir || ''
    );
    if (genderFromFile) {
      return genderFromFile;
    }

    // Check team names for women's teams
    const teams = match.info?.teams || [];
    const womenKeywords = ['women', 'womens', 'female', 'girls', 'lady', 'ladies'];

    for (const team of teams) {
      const lowerTeam = team.toLowerCase();
      if (womenKeywords.some((keyword) => lowerTeam.includes(keyword))) {
        return 'women';
      }
    }

    // Check player names for women's players
    const players = match.info?.players || {};
    const womenNames = ['Ellyse', 'Meg', 'Smriti', 'Harmanpreet', 'Sophie', 'Heather', 'Nat'];
    for (const [team, playerList] of Object.entries(players)) {
      if (Array.isArray(playerList)) {
        for (const player of playerList) {
          if (womenNames.some((name) => player.includes(name))) {
            return 'women';
          }
        }
      }
    }

    // Default to men if no indicators found
    return 'men';
  }

  /**
   * Get matches by gender
   */
  getMatches(gender = 'all') {
    if (gender === 'women') {
      return this.cache.women || [];
    } else if (gender === 'men') {
      return this.cache.men || [];
    } else {
      return this.cache.data || [];
    }
  }

  /**
   * Search matches
   */
  searchMatches(query, gender = 'all') {
    const matches = this.getMatches(gender);
    const queryLower = query.toLowerCase();

    return matches.filter((match) => {
      const info = match.info || {};

      // Search in teams
      const teams = info.teams || [];
      if (teams.some((t) => t.toLowerCase().includes(queryLower))) {
        return true;
      }

      // Search in players
      const players = info.players || {};
      for (const [team, playerList] of Object.entries(players)) {
        if (Array.isArray(playerList)) {
          if (playerList.some((p) => p.toLowerCase().includes(queryLower))) {
            return true;
          }
        }
      }

      // Search in venue
      if (info.venue && info.venue.toLowerCase().includes(queryLower)) {
        return true;
      }

      // Search in city
      if (info.city && info.city.toLowerCase().includes(queryLower)) {
        return true;
      }

      // Search in series/event
      if (info.event?.name && info.event.name.toLowerCase().includes(queryLower)) {
        return true;
      }

      // Search in season
      if (info.season && info.season.toLowerCase().includes(queryLower)) {
        return true;
      }

      return false;
    });
  }

  /**
   * Get matches by team
   */
  getMatchesByTeam(teamName, gender = 'all') {
    const matches = this.getMatches(gender);
    const teamLower = teamName.toLowerCase();

    return matches.filter((match) => {
      const teams = match.info?.teams || [];
      return teams.some((t) => t.toLowerCase().includes(teamLower));
    });
  }

  /**
   * Get match statistics
   */
  getStats(gender = 'all') {
    const matches = this.getMatches(gender);

    const stats = {
      total_matches: matches.length,
      by_match_type: {},
      by_season: {},
      by_team: {},
      by_venue: {},
      teams: new Set(),
      venues: new Set(),
      players: new Set(),
    };

    for (const match of matches) {
      const info = match.info || {};

      // Match type
      const matchType = info.match_type || 'Unknown';
      stats.by_match_type[matchType] = (stats.by_match_type[matchType] || 0) + 1;

      // Season
      const season = info.season || 'Unknown';
      stats.by_season[season] = (stats.by_season[season] || 0) + 1;

      // Venue
      const venue = info.venue || 'Unknown';
      stats.by_venue[venue] = (stats.by_venue[venue] || 0) + 1;
      stats.venues.add(venue);

      // Teams
      const teams = info.teams || [];
      for (const team of teams) {
        stats.by_team[team] = (stats.by_team[team] || 0) + 1;
        stats.teams.add(team);
      }

      // Players
      const players = info.players || {};
      for (const [team, playerList] of Object.entries(players)) {
        if (Array.isArray(playerList)) {
          for (const player of playerList) {
            stats.players.add(player);
          }
        }
      }
    }

    // Convert Sets to Arrays
    stats.teams = Array.from(stats.teams).sort();
    stats.venues = Array.from(stats.venues).sort();
    stats.players_count = stats.players.size;
    delete stats.players;

    // Get gender breakdown
    stats.by_gender = {
      women: this.cache.women.length,
      men: this.cache.men.length,
      total: this.cache.data.length,
    };

    return stats;
  }

  /**
   * Refresh cache
   */
  async refresh() {
    this.cache.data = null;
    this.cache.lastLoad = null;
    this.cache.women = [];
    this.cache.men = [];
    return await this.loadAll();
  }

  /**
   * Get a single match by ID or file name
   */
  getMatchById(id) {
    const allMatches = this.cache.data || [];
    return allMatches.find((m) => {
      return (
        m._sourceFile === id ||
        m._sourceFile === `${id}.json` ||
        (m.info?.event?.name && m.info.event.name === id)
      );
    });
  }
}

// Singleton instance
const cricsheetLoader = new CricsheetLoader();

module.exports = { cricsheetLoader };

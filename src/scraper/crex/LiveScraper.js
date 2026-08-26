// src/scraper/crex/LiveScraper.js
const BaseCrexScraper = require('./BaseCrexScraper');
const LIVE_SELECTORS = require('./selectors/liveSelectors');
const logger = require('../../logger');
const util = require('util');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const browserManager = require('../browser');

const deepLog = (label, data) => {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`📊 ${label}`);
  console.log(`${'═'.repeat(80)}`);
  console.log(
    util.inspect(data, {
      depth: null,
      colors: true,
      compact: false,
      maxArrayLength: null,
      maxStringLength: null,
      showHidden: false,
    })
  );
  console.log(`${'═'.repeat(80)}\n`);
};

class LiveScraper extends BaseCrexScraper {
  constructor() {
    super();
    this.selectors = LIVE_SELECTORS;
    this.stats = {
      discovered: 0,
      detailed: 0,
      merged: 0,
      errors: 0,
      weatherSuccess: 0,
      weatherFailed: 0,
    };

    this.requestDelay = 3000;
    this.maxRetries = 2;
    this.browser = null;
    this.page = null;
    this.context = null;
    this.requestCount = 0;
    this.lastRequestTime = 0;
    this.isBrowserInitialized = false;

    this.browserManager = browserManager;
    this.useBrowserManager = true;

    this.numberOfAgents = 5;
    this.agentStaggerDelay = 100;
    this.matchDelay = 100;
    this.activeAgents = 0;
    this.agentResults = [];
    this.agentStats = {};
    this.processedUrls = new Set();
    this.scrapeStartTime = null;
    this.agentPages = new Map();

    this._isScraping = false;
    this._scrapeLockTime = null;
    this._scrapeTimeout = null;
    this._scrapeId = null;
    this._scrapePromise = null;
    this._lastScrapeTime = 0;
    this._minScrapeInterval = 1000;

    this.geoCache = new Map();
    this.weatherCache = new Map();

    this.weatherCodeMap = {
      0: { condition: 'Clear Sky', icon: '01d' },
      1: { condition: 'Mainly Clear', icon: '02d' },
      2: { condition: 'Partly Cloudy', icon: '03d' },
      3: { condition: 'Cloudy', icon: '04d' },
      45: { condition: 'Fog', icon: '50d' },
      48: { condition: 'Depositing Fog', icon: '50d' },
      51: { condition: 'Light Drizzle', icon: '09d' },
      53: { condition: 'Moderate Drizzle', icon: '09d' },
      55: { condition: 'Heavy Drizzle', icon: '09d' },
      61: { condition: 'Light Rain', icon: '10d' },
      63: { condition: 'Rain', icon: '10d' },
      65: { condition: 'Heavy Rain', icon: '10d' },
      71: { condition: 'Snow', icon: '13d' },
      73: { condition: 'Snow', icon: '13d' },
      75: { condition: 'Heavy Snow', icon: '13d' },
      80: { condition: 'Rain Showers', icon: '09d' },
      81: { condition: 'Rain Showers', icon: '09d' },
      82: { condition: 'Heavy Rain Showers', icon: '09d' },
      95: { condition: 'Thunderstorm', icon: '11d' },
      96: { condition: 'Thunderstorm', icon: '11d' },
      99: { condition: 'Thunderstorm', icon: '11d' },
    };

    this.countryMap = {
      India: 'India',
      England: 'England',
      Australia: 'Australia',
      Pakistan: 'Pakistan',
      'New Zealand': 'New Zealand',
      'South Africa': 'South Africa',
      'West Indies': 'West Indies',
      'Sri Lanka': 'Sri Lanka',
      Bangladesh: 'Bangladesh',
      Afghanistan: 'Afghanistan',
      Zimbabwe: 'Zimbabwe',
      Ireland: 'Ireland',
      Nepal: 'Nepal',
      Namibia: 'Namibia',
      Guyana: 'Guyana',
    };

    this.teamCountryMap = {
      PAK: 'Pakistan',
      WI: 'West Indies',
      IND: 'India',
      ENG: 'England',
      AUS: 'Australia',
      NZ: 'New Zealand',
      SA: 'South Africa',
      SL: 'Sri Lanka',
      BAN: 'Bangladesh',
      AFG: 'Afghanistan',
      ZIM: 'Zimbabwe',
      IRE: 'Ireland',
      NEP: 'Nepal',
      NAM: 'Namibia',
      GUY: 'Guyana',
      LANCS: 'England',
      LEIC: 'England',
      WOR: 'England',
      HAM: 'England',
      MDX: 'England',
      KT: 'England',
      LS: 'England',
      TR: 'England',
      DS: 'Sri Lanka',
      GG: 'Sri Lanka',
      'Live PAK': 'Pakistan',
    };

    this.teamIdMap = {
      India: 'team_ind',
      England: 'team_eng',
      Australia: 'team_aus',
      Pakistan: 'team_pak',
      'New Zealand': 'team_nz',
      'South Africa': 'team_sa',
      'West Indies': 'team_wi',
      'Sri Lanka': 'team_sl',
      Bangladesh: 'team_ban',
      Afghanistan: 'team_afg',
      Zimbabwe: 'team_zim',
      Ireland: 'team_ire',
      Nepal: 'team_nep',
      Namibia: 'team_nam',
      Maharani: 'team_maharani',
      'Galle Gallants': 'team_galle',
      'Dambulla Sixers': 'team_dambulla',
      'Kandy Falcons': 'team_kandy',
      'Jaffna Kings': 'team_jaffna',
      'Colombo Kaps': 'team_colombo',
      'Kandy Royals': 'team_kandy_royals',
      'London Spirit': 'team_london_spirit',
      'Manchester Super Giants': 'team_manchester',
      'Southern Brave': 'team_southern_brave',
      'Welsh Fire': 'team_welsh_fire',
      'Birmingham Phoenix': 'team_birmingham',
      'Trent Rockets': 'team_trent_rockets',
      'Oval Invincibles': 'team_oval',
      'Northern Superchargers': 'team_northern',
      Worcestershire: 'team_worcs',
      Derbyshire: 'team_derby',
      'Lahore Qalandars': 'team_lahore',
      'Perth Scorchers': 'team_perth',
      'Guyana Amazon Warriors': 'team_guyana',
      'San Francisco Unicorns': 'team_san_francisco',
      'BP-W': 'team_bp_w',
      'TR-W': 'team_tr_w',
      GLCS: 'team_glcs',
      SOM: 'team_som',
      ODW: 'team_odw',
      SDS: 'team_sds',
      'TYP-W': 'team_typ_w',
      'DG-W': 'team_dg_w',
      MKL: 'team_mkl',
      CW: 'team_cw',
      AC: 'team_ac',
      BL: 'team_bl',
      JS: 'team_js',
      KK: 'team_kk',
      SS: 'team_ss',
      LS: 'team_ls',
      MIL: 'team_mil',
      PD: 'team_pd',
      NDT: 'team_ndt',
      RNH: 'team_rnh',
      SR: 'team_sr',
      SRL: 'team_srl',
      BP: 'team_bp',
      LBW: 'team_lbw',
    };

    this.validTeamNames = new Set([
      'ODW', 'SDS', 'TYP-W', 'DG-W', 'MKL', 'CW', 'AC', 'BL', 'JS',
      'KK', 'SS', 'LS', 'MIL', 'PD', 'NDT', 'RNH', 'SR', 'SRL', 'BP', 'LBW',
      'London Spirit', 'MI London', 'Manchester Originals', 'Sunrisers Leeds',
      'Birmingham Phoenix', 'Southern Brave', 'Welsh Fire', 'Trent Rockets',
      'Oval Invincibles', 'Northern Superchargers',
      'India', 'England', 'Australia', 'Pakistan', 'New Zealand',
      'South Africa', 'West Indies', 'Sri Lanka', 'Bangladesh',
      'Afghanistan', 'Zimbabwe', 'Ireland', 'Nepal', 'Namibia',
      'Guyana', 'Jaffna Kings', 'Galle Gallants', 'Dambulla Sixers',
      'Kandy Falcons', 'Colombo Kaps', 'Kandy Royals',
      'Worcestershire', 'Derbyshire', 'Lahore Qalandars',
      'Perth Scorchers', 'Guyana Amazon Warriors',
      'San Francisco Unicorns', 'BP-W', 'TR-W', 'GLCS', 'SOM',
    ]);

    this.teamNameMap = {
      'London Spirit': 'LS',
      'MI London': 'MIL',
      'Manchester Originals': 'MIL',
      'Sunrisers Leeds': 'SRL',
      'Birmingham Phoenix': 'BP',
      'Southern Brave': 'SB',
      'Welsh Fire': 'WF',
      'Trent Rockets': 'TR',
      'Oval Invincibles': 'OI',
      'Northern Superchargers': 'NS',
    };
  }

  // ============================================================
  // ⭐ LOCK MANAGEMENT
  // ============================================================
  async acquireLock(scrapeId) {
    const now = Date.now();
    if (this._lastScrapeTime > 0 && now - this._lastScrapeTime < this._minScrapeInterval) {
      logger.debug(
        `⏳ Last scrape was ${Math.round((now - this._lastScrapeTime) / 1000)}s ago, waiting...`
      );
      await this.sleep(this._minScrapeInterval - (now - this._lastScrapeTime));
    }

    if (this._isScraping) {
      const lockAge = Date.now() - (this._scrapeLockTime || Date.now());
      if (lockAge > 120000) {
        logger.warn(`⚠️ Stale lock detected (${Math.round(lockAge / 1000)}s old), force releasing`);
        this.forceReleaseLock();
      } else {
        logger.warn(
          `⚠️ Scrape already in progress (lock age: ${Math.round(lockAge / 1000)}s), returning existing promise`
        );
        return false;
      }
    }

    this._isScraping = true;
    this._scrapeLockTime = Date.now();
    this._scrapeId = scrapeId;
    this._lastScrapeTime = Date.now();

    if (this._scrapeTimeout) {
      clearTimeout(this._scrapeTimeout);
    }
    this._scrapeTimeout = setTimeout(() => {
      if (this._isScraping) {
        logger.warn(`⚠️ Scrape ${this._scrapeId} timeout - force releasing lock`);
        this.forceReleaseLock();
      }
    }, 120000);

    return true;
  }

  forceReleaseLock() {
    if (this._isScraping) {
      const lockAge = Date.now() - (this._scrapeLockTime || Date.now());
      logger.warn(`🔓 Force releasing scrape lock (age: ${Math.round(lockAge / 1000)}s)`);
      this._isScraping = false;
      this._scrapeLockTime = null;
      this._scrapeId = null;
      if (this._scrapeTimeout) {
        clearTimeout(this._scrapeTimeout);
        this._scrapeTimeout = null;
      }
      this._scrapePromise = null;
      return true;
    }
    return false;
  }

  async ensureLockReleased() {
    if (this._isScraping) {
      const lockAge = Date.now() - (this._scrapeLockTime || Date.now());
      logger.warn(`⚠️ Force releasing existing lock (age: ${Math.round(lockAge / 1000)}s)`);
      this._isScraping = false;
      this._scrapeLockTime = null;
      this._scrapeId = null;
      if (this._scrapeTimeout) {
        clearTimeout(this._scrapeTimeout);
        this._scrapeTimeout = null;
      }
      this._scrapePromise = null;
      return true;
    }
    return false;
  }

  // ============================================================
  // ⭐ HELPER FUNCTIONS
  // ============================================================
  isValidTeamName(name) {
    if (!name) return false;
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 30) return false;

    for (const valid of this.validTeamNames) {
      if (trimmed === valid || trimmed.includes(valid) || valid.includes(trimmed)) {
        return true;
      }
    }

    if (trimmed.includes(' ') && trimmed.length > 5) {
      const playerPatterns = [
        /^[A-Z][a-z]+ [A-Z][a-z]+/,
        /^[A-Z]\. [A-Z][a-z]+/,
        /^[A-Z][a-z]+\s+[A-Z][a-z]+/,
      ];
      for (const pattern of playerPatterns) {
        if (pattern.test(trimmed)) return false;
      }
    }

    const invalidNames = [
      'Caught Out', 'Innings Break', 'Not Started', 'Live', 'Match',
      'Over', 'Wicket', 'Run', 'Ball', 'Striker', 'Bowler',
      'Toss', 'Commentary', 'Highlights', 'Scorecard', 'Discussions',
      'Points Table', 'Projected Score', 'Milestone', 'Local Time',
      'Team 1', 'Team 2', 'LBW Out',
    ];
    for (const invalid of invalidNames) {
      if (trimmed === invalid || trimmed.includes(invalid)) return false;
    }

    return true;
  }

  cleanTeamName(name) {
    if (!name) return '';
    let cleaned = name.trim();

    cleaned = cleaned.replace(/\s+(?:Match|T20|ODI|Test|100B)$/, '');
    cleaned = cleaned.replace(/\s+[0-9]+(?:st|nd|rd|th)\s+(?:Match|T20|ODI|Test|100B)$/, '');
    cleaned = cleaned.replace(/\s*[-/]\s*[0-9]+$/, '');
    cleaned = cleaned.replace(/\s*\([0-9.]+\)$/, '');
    cleaned = cleaned.replace(/^[A-Z]\.\s*[A-Z][a-z]+/, '');
    cleaned = cleaned.replace(/^[A-Z][a-z]+\s+[A-Z][a-z]+/, '');

    for (const [fullName, shortName] of Object.entries(this.teamNameMap)) {
      if (cleaned.includes(fullName) || fullName.includes(cleaned)) {
        return shortName;
      }
    }

    for (const [key, value] of Object.entries(this.teamIdMap)) {
      if (cleaned.includes(key) || key.includes(cleaned)) {
        return key;
      }
    }

    if (this.isValidTeamName(cleaned)) {
      return cleaned;
    }

    const urlMatch = cleaned.match(/([A-Z]{2,4})/);
    if (urlMatch && this.isValidTeamName(urlMatch[1])) {
      return urlMatch[1];
    }

    return cleaned;
  }

  getCountryFromTeamName(teamName) {
    if (!teamName) return null;
    if (this.teamCountryMap[teamName]) return this.teamCountryMap[teamName];
    for (const [key, value] of Object.entries(this.teamCountryMap)) {
      if (teamName.includes(key) || key.includes(teamName)) {
        return value;
      }
    }
    for (const [key, country] of Object.entries(this.countryMap)) {
      if (teamName.includes(key) || key.includes(teamName)) {
        return country;
      }
    }
    return null;
  }

  getTeamId(teamName) {
    if (!teamName) return `team_${Date.now()}`;
    for (const [name, id] of Object.entries(this.teamIdMap)) {
      if (teamName.includes(name) || name.includes(teamName)) {
        return id;
      }
    }
    const cleanName = teamName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `team_${cleanName}`;
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getRandomUserAgent() {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 OPR/107.0.0.0',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  // ============================================================
  // ⭐ WEATHER FUNCTIONS
  // ============================================================
  buildLocationCandidates(venue, series, matchTitle, team1Name, team2Name, matchUrl) {
    const candidates = new Set();

    if (venue && venue !== 'TBD' && venue.length > 2) {
      candidates.add(venue);
      const cleanedVenue = venue
        .replace(/Cricket Ground|Ground|Stadium|International Stadium|Sports Complex|Oval|Arena|Park|Gardens|Cricket Club|CC/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanedVenue !== venue && cleanedVenue.length > 2) {
        candidates.add(cleanedVenue);
      }
      if (venue.includes(',')) {
        const parts = venue.split(',').map((p) => p.trim());
        parts.forEach((part) => {
          if (part.length > 2) candidates.add(part);
        });
      }
      const cityMatch = venue.match(/,?\s*([A-Za-z\s]+)$/);
      if (cityMatch && cityMatch[1] && cityMatch[1].length > 2) {
        candidates.add(cityMatch[1].trim());
      }
    }

    if (matchUrl) {
      const urlParts = matchUrl.split('/');
      for (const part of urlParts) {
        const decoded = decodeURIComponent(part).replace(/-/g, ' ');
        for (const [country] of Object.entries(this.countryMap)) {
          if (decoded.includes(country.toLowerCase()) || decoded.includes(country)) {
            candidates.add(country);
          }
        }
        const locationMatch = decoded.match(
          /(england|australia|india|pakistan|sri lanka|west indies|new zealand|south africa|bangladesh|afghanistan|zimbabwe|ireland|nepal|namibia|guyana)/i
        );
        if (locationMatch) {
          candidates.add(locationMatch[1]);
        }
      }
    }

    if (series) {
      for (const [country] of Object.entries(this.countryMap)) {
        if (series.includes(country)) {
          candidates.add(country);
        }
      }
      const countryPatterns = [
        /(?:India|England|Australia|Pakistan|New Zealand|South Africa|West Indies|Sri Lanka|Bangladesh|Afghanistan|Zimbabwe|Ireland|Nepal|Namibia|Guyana)\s+(?:Tour|vs|in)/i,
        /(?:Tour|vs|in)\s+(?:India|England|Australia|Pakistan|New Zealand|South Africa|West Indies|Sri Lanka|Bangladesh|Afghanistan|Zimbabwe|Ireland|Nepal|Namibia|Guyana)/i,
      ];
      for (const pattern of countryPatterns) {
        const match = series.match(pattern);
        if (match) {
          const country = match[0].replace(/Tour|vs|in/gi, '').trim();
          if (country && country.length > 2) candidates.add(country);
        }
      }
      const vsMatch = series.match(/([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)/i);
      if (vsMatch) {
        const country1 = vsMatch[1].trim();
        const country2 = vsMatch[2].trim();
        if (country1 && country1.length > 2) candidates.add(country1);
        if (country2 && country2.length > 2) candidates.add(country2);
      }
    }

    if (matchTitle) {
      for (const [country] of Object.entries(this.countryMap)) {
        if (matchTitle.includes(country)) candidates.add(country);
      }
    }

    if (team1Name) {
      for (const [key, country] of Object.entries(this.countryMap)) {
        if (team1Name.includes(key) || key.includes(team1Name)) {
          candidates.add(country);
        }
      }
      const teamCountry = this.getCountryFromTeamName(team1Name);
      if (teamCountry) candidates.add(teamCountry);
    }

    if (team2Name) {
      for (const [key, country] of Object.entries(this.countryMap)) {
        if (team2Name.includes(key) || key.includes(team2Name)) {
          candidates.add(country);
        }
      }
      const teamCountry = this.getCountryFromTeamName(team2Name);
      if (teamCountry) candidates.add(teamCountry);
    }

    if (team1Name && team1Name.length <= 3) {
      const country = this.teamCountryMap[team1Name.toUpperCase()];
      if (country) candidates.add(country);
    }

    if (team2Name && team2Name.length <= 3) {
      const country = this.teamCountryMap[team2Name.toUpperCase()];
      if (country) candidates.add(country);
    }

    const validCandidates = new Set();
    for (const candidate of candidates) {
      const trimmed = candidate.trim();
      if (trimmed && trimmed !== 'TBD' && trimmed !== 'tbd' && trimmed.length > 2) {
        validCandidates.add(trimmed);
      }
    }

    const venueCandidates = [];
    const cityCandidates = [];
    const seriesCandidates = [];
    const countryCandidates = [];

    for (const candidate of validCandidates) {
      const isCountry = Object.values(this.countryMap).some(
        (c) => candidate.toLowerCase() === c.toLowerCase() || candidate.includes(c)
      );
      if (isCountry && candidate.length <= 20) {
        countryCandidates.push(candidate);
      } else if (candidate.includes(',')) {
        venueCandidates.push(candidate);
      } else if (candidate.match(/[A-Z][a-z]+\s+[A-Z][a-z]+/)) {
        venueCandidates.push(candidate);
      } else if (candidate.match(/[A-Z][a-z]+/)) {
        cityCandidates.push(candidate);
      } else {
        seriesCandidates.push(candidate);
      }
    }

    const allCandidates = [
      ...venueCandidates,
      ...cityCandidates,
      ...seriesCandidates,
      ...countryCandidates,
    ];

    const seen = new Set();
    const uniqueCandidates = [];
    for (const candidate of allCandidates) {
      const lower = candidate.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        uniqueCandidates.push(candidate);
      }
    }

    if (uniqueCandidates.length === 0) {
      if (team1Name) {
        const country = this.getCountryFromTeamName(team1Name);
        if (country && !uniqueCandidates.includes(country)) uniqueCandidates.push(country);
      }
      if (team2Name) {
        const country = this.getCountryFromTeamName(team2Name);
        if (country && !uniqueCandidates.includes(country)) uniqueCandidates.push(country);
      }
    }

    return uniqueCandidates;
  }

  async getCoordinates(location) {
    const cacheKey = location.toLowerCase().trim();
    if (this.geoCache.has(cacheKey)) {
      logger.debug(`    ✅ Coordinates from cache for: ${location}`);
      return this.geoCache.get(cacheKey);
    }

    try {
      const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
      const response = await axios.get(geocodeUrl, { timeout: 10000 });
      if (response.data.results && response.data.results.length > 0) {
        const result = response.data.results[0];
        const coords = {
          lat: result.latitude,
          lon: result.longitude,
          name: result.name,
          country: result.country,
        };
        this.geoCache.set(cacheKey, coords);
        logger.debug(`    ✅ Geocoded "${location}" → ${result.name}, ${result.country}`);
        return coords;
      } else {
        logger.debug(`    ⚠️ No results for location: "${location}"`);
        return null;
      }
    } catch (error) {
      logger.debug(`    ⚠️ Geocoding failed for "${location}": ${error.message}`);
      return null;
    }
  }

  async getWeatherForVenue(venue, series, matchTitle, team1Name, team2Name, matchUrl) {
    const candidates = this.buildLocationCandidates(
      venue,
      series,
      matchTitle,
      team1Name,
      team2Name,
      matchUrl
    );
    if (candidates.length === 0) {
      logger.warn(`    ❌ No location candidates found for weather`);
      return null;
    }

    logger.info(`    🌤️ Weather requested with ${candidates.length} location candidates:`);
    candidates.slice(0, 10).forEach((c, i) => {
      logger.info(`       ${i + 1}. "${c}"`);
    });
    if (candidates.length > 10) {
      logger.info(`       ... and ${candidates.length - 10} more`);
    }

    for (let i = 0; i < candidates.length; i++) {
      const location = candidates[i];
      logger.debug(`    🔍 Trying location ${i + 1}/${candidates.length}: "${location}"`);
      try {
        const coords = await this.getCoordinates(location);
        if (!coords) {
          logger.debug(`    ⚠️ No coordinates for "${location}", trying next`);
          continue;
        }
        const { lat: latitude, lon: longitude } = coords;
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=precipitation_probability_max&timezone=auto`;
        const weatherResponse = await axios.get(weatherUrl, { timeout: 10000 });
        const data = weatherResponse.data;
        if (!data.current) {
          logger.debug(`    ⚠️ No weather data for "${location}", trying next`);
          continue;
        }
        const current = data.current;
        const weatherCode = current.weather_code;
        const weatherInfo = this.weatherCodeMap[weatherCode] || {
          condition: 'Unknown',
          icon: '01d',
        };
        let rainProbability = null;
        if (
          data.daily &&
          data.daily.precipitation_probability_max &&
          data.daily.precipitation_probability_max.length > 0
        ) {
          rainProbability = data.daily.precipitation_probability_max[0];
        }
        const weather = {
          temperature: current.temperature_2m || null,
          feels_like: current.apparent_temperature || null,
          humidity: current.relative_humidity_2m || null,
          wind_speed: current.wind_speed_10m || null,
          condition: weatherInfo.condition,
          rain_probability: rainProbability,
          weather_icon: weatherInfo.icon,
          last_updated: new Date().toISOString(),
        };
        this.stats.weatherSuccess++;
        logger.info(
          `    ✅ Weather fetched for "${location}": ${weather.temperature}°C, ${weather.condition}, ${weather.humidity}% humidity`
        );
        return weather;
      } catch (error) {
        logger.debug(`    ❌ Weather API error for "${location}": ${error.message}`);
        continue;
      }
    }

    this.stats.weatherFailed++;
    logger.warn(`    ❌ No valid weather location found after all ${candidates.length} retries.`);
    return null;
  }

  // ============================================================
  // ⭐ BROWSER MANAGEMENT
  // ============================================================
  async initializeBrowser() {
    try {
      if (
        this.browserManager.isReady &&
        this.browserManager.browser &&
        this.browserManager.browser.isConnected()
      ) {
        this.browser = this.browserManager.browser;
        this.context = this.browserManager.context;
        if (!this.page || this.page.isClosed()) {
          this.page = await this.context.newPage();
          this.page.setDefaultTimeout(60000);
          this.page.setDefaultNavigationTimeout(60000);
        }
        this.isBrowserInitialized = true;
        return true;
      }
      await this.browserManager.launch();
      this.browser = this.browserManager.browser;
      this.context = this.browserManager.context;
      this.page = await this.context.newPage();
      this.page.setDefaultTimeout(60000);
      this.page.setDefaultNavigationTimeout(60000);
      this.isBrowserInitialized = true;
      logger.info('✅ Browser initialized via shared manager');
      return true;
    } catch (error) {
      logger.error(`Failed to initialize browser: ${error.message}`);
      return false;
    }
  }

  async closeBrowser() {
    try {
      for (const [agentId, page] of this.agentPages) {
        try {
          if (page && !page.isClosed()) {
            await page.close();
          }
        } catch (e) {}
      }
      this.agentPages.clear();
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
        this.page = null;
      }
      this.isBrowserInitialized = false;
      logger.info('✅ LiveScraper pages closed');
      return true;
    } catch (error) {
      logger.error(`Error closing pages: ${error.message}`);
      this.page = null;
      this.isBrowserInitialized = false;
      return false;
    }
  }

  async cleanup() {
    try {
      await this.closeBrowser();
      this.processedUrls.clear();
      this.agentResults = [];
      this.agentStats = {};
      this.activeAgents = 0;
      this.agentPages.clear();
      this.forceReleaseLock();
      logger.info('✅ LiveScraper cleaned up');
      return true;
    } catch (error) {
      logger.warn('Error cleaning up LiveScraper:', error.message);
      return false;
    }
  }

  // ============================================================
  // ⭐ AGENT MANAGEMENT
  // ============================================================
  splitIntoBatches(matches) {
    const batches = [];
    const total = matches.length;
    const batchSize = Math.ceil(total / this.numberOfAgents);
    for (let i = 0; i < this.numberOfAgents; i++) {
      const start = i * batchSize;
      const end = Math.min(start + batchSize, total);
      if (start < total) {
        batches.push(matches.slice(start, end));
      } else {
        batches.push([]);
      }
    }
    return batches;
  }

  async runAgent(agentNum, batch) {
    const agentId = `Agent ${agentNum}`;
    const stats = {
      total: batch.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      startTime: Date.now(),
    };

    this.agentStats[agentId] = stats;
    const results = [];

    try {
      if (!this.browserManager.isReady) {
        await this.browserManager.launch();
      }
      if (!this.browserManager.context) {
        logger.error(`❌ ${agentId} failed: No browser context`);
        return { agentId, matches: [], stats };
      }

      const page = await this.browserManager.context.newPage();
      page.setDefaultTimeout(45000);
      page.setDefaultNavigationTimeout(45000);
      this.agentPages.set(agentId, page);

      const userAgent = this.getRandomUserAgent();
      await page.setExtraHTTPHeaders({
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Referer: 'https://crex.com/',
      });

      this.activeAgents = (this.activeAgents || 0) + 1;

      for (let i = 0; i < batch.length; i++) {
        const match = batch[i];
        const urlKey = match.url.split('?')[0];
        if (this.processedUrls.has(urlKey)) {
          logger.info(`   ⏭️ ${agentId} skipping duplicate: ${match.url}`);
          continue;
        }
        this.processedUrls.add(urlKey);
        stats.processed++;
        logger.info(`   ${agentId} processing: ${match.team1.name} vs ${match.team2.name}`);

        try {
          const matchData = await this.getRealTimeMatchData(page, match, agentId);
          if (matchData) {
            results.push(matchData);
            stats.succeeded++;
            logger.info(`   ✅ ${agentId} got data for ${match.team1.name} vs ${match.team2.name}`);
          } else {
            stats.failed++;
            const fallbackMatch = this.createFallbackMatch(match);
            results.push(fallbackMatch);
          }
        } catch (error) {
          stats.failed++;
          logger.error(
            `   ❌ ${agentId} error on ${match.team1.name} vs ${match.team2.name}: ${error.message}`
          );
          const fallbackMatch = this.createFallbackMatch(match);
          results.push(fallbackMatch);
        }

        if (i < batch.length - 1) {
          const delay = this.matchDelay + Math.random() * 500;
          logger.info(`   ⏳ ${agentId} waiting ${Math.round(delay)}ms before next match...`);
          await this.sleep(delay);
        }
      }

      try {
        if (page && !page.isClosed()) {
          await page.close();
        }
        this.agentPages.delete(agentId);
      } catch (e) {}
      this.activeAgents = Math.max(0, (this.activeAgents || 1) - 1);
    } catch (error) {
      logger.error(`❌ ${agentId} crashed: ${error.message}`);
      try {
        const page = this.agentPages.get(agentId);
        if (page && !page.isClosed()) {
          await page.close();
        }
        this.agentPages.delete(agentId);
      } catch (e) {}
      this.activeAgents = Math.max(0, (this.activeAgents || 1) - 1);
    }

    return { agentId, matches: results, stats };
  }

  async processWithAgents(discoveredMatches) {
    logger.info('🤖 Starting Agent-based processing with 4 agents...');
    if (!discoveredMatches || discoveredMatches.length === 0) {
      return [];
    }
    if (!this.context) {
      await this.initializeBrowser();
      if (!this.context) {
        logger.error('❌ Failed to get browser context');
        return [];
      }
    }

    const batches = this.splitIntoBatches(discoveredMatches);
    const agentPromises = [];

    for (let i = 0; i < this.numberOfAgents; i++) {
      const agentNum = i + 1;
      const batch = batches[i];
      if (batch.length === 0) continue;
      const startDelay = i * this.agentStaggerDelay;
      logger.info(
        `⏳ Agent ${agentNum} starting in ${startDelay}ms with ${batch.length} matches...`
      );
      const agentPromise = new Promise((resolve) => {
        setTimeout(async () => {
          logger.info(`🤖 Agent ${agentNum} started with ${batch.length} matches`);
          const result = await this.runAgent(agentNum, batch);
          resolve(result);
        }, startDelay);
      });
      agentPromises.push(agentPromise);
    }

    const results = await Promise.all(agentPromises);
    const allMatches = [];
    results.forEach((result) => {
      if (result && result.matches) {
        allMatches.push(...result.matches);
      }
    });
    logger.info(`✅ All agents completed. Total matches: ${allMatches.length}`);
    return allMatches;
  }

  // ============================================================
  // ⭐ ⭐ CORE EXTRACTION FUNCTIONS ⭐ ⭐
  // ============================================================

  // ⭐ FIXED: Parse team score - handles "157-6" and "100b"
  parseTeamScore(scoreText, isBowling = false) {
    if (!scoreText) return { score: '', runs: null, wickets: null, overs: '', balls: null };
    
    const cleaned = scoreText.trim();
    let runs = null;
    let wickets = null;
    let overs = '';
    let balls = null;
    let score = cleaned;

    // ⭐ Check for "runs-wickets" format: "157-6", "157/6"
    const match = cleaned.match(/(\d+)\s*[-/]\s*(\d+)/);
    if (match) {
      if (isBowling) {
        // Bowling: "1-32" → wickets=1, runs=32
        wickets = parseInt(match[1]);
        runs = parseInt(match[2]);
        score = `${wickets}-${runs}`;
      } else {
        // Batting: "157-6" → runs=157, wickets=6
        runs = parseInt(match[1]);
        wickets = parseInt(match[2]);
        score = `${runs}-${wickets}`;
      }
    } else {
      // Single number: "157"
      const runsMatch = cleaned.match(/^(\d+)/);
      if (runsMatch) {
        runs = parseInt(runsMatch[1]);
        score = runsMatch[1];
        if (!isBowling) {
          wickets = 0;
        }
      }
    }

    // ⭐ Extract balls for The Hundred: "100b"
    const ballMatch = cleaned.match(/(\d+)b/);
    if (ballMatch) {
      balls = parseInt(ballMatch[1]);
      overs = `${balls}b`;
    }

    // Extract traditional overs: "(13.3)" or "13.3"
    const overMatch = cleaned.match(/\((\d+\.\d+)\)/) || cleaned.match(/(\d+\.\d+)/);
    if (overMatch && !overMatch[1].includes('b')) {
      overs = overMatch[1];
    }

    return { score, runs, wickets, overs, balls };
  }

  // ⭐ FIXED: Extract scoreboard with proper DOM parsing
  async extractScoreboard(page) {
    try {
      const result = await page.evaluate(() => {
        const scoreboard = {
          batting: { name: '', score: '', runs: null, wickets: null, overs: '', balls: null },
          bowling: { name: '', score: '', runs: null, wickets: null, overs: '', balls: null },
          target: null,
          required: { runs: null, balls: null },
          crr: null,
          rrr: null
        };

        function parseScore(text) {
          let score = '';
          let runs = null;
          let wickets = null;
          let overs = '';
          let balls = null;

          if (!text) return { score, runs, wickets, overs, balls };

          let cleaned = text.trim();

          // Parse "290/10" or "166/4" or "166-4" or "166 for 4"
          const match = cleaned.match(/(\d+)\s*[\/]\s*(\d+)/) || 
                        cleaned.match(/(\d+)\s*for\s*(\d+)/i) ||
                        cleaned.match(/(\d+)\s*-\s*([0-9]|10)\b/);
          
          if (match) {
            runs = parseInt(match[1]);
            wickets = parseInt(match[2]);
            score = `${runs}/${wickets}`;
          } else {
            // Check "290 (89.4)" or "290"
            const singleMatch = cleaned.match(/^(\d+)\s*(?:\((\d+\.\d+)\))?/);
            if (singleMatch) {
              runs = parseInt(singleMatch[1]);
              score = String(runs);
              wickets = singleMatch[2] ? 10 : 0;
              if (singleMatch[2]) {
                overs = singleMatch[2];
              }
            }
          }

          // Parse balls/overs if present (e.g. "100b" or "(20.0)")
          const ballMatch = cleaned.match(/(\d+)b/);
          if (ballMatch) {
            balls = parseInt(ballMatch[1]);
            overs = `${balls}b`;
          }

          const overMatch = cleaned.match(/\((\d+\.\d+)\)/) || cleaned.match(/(\d+\.\d+)\s*ov/i);
          if (overMatch) {
            overs = overMatch[1];
          }

          return { score, runs, wickets, overs, balls };
        }

        function extractCleanName(el) {
          if (!el) return '';
          const p = el.querySelector('p, a, .name-text, .team-title, .short-name');
          let text = p ? p.textContent : el.textContent;
          text = (text || '').split('\n')[0].trim();
          text = text.replace(/\bPP\b/g, '')
                     .replace(/\bP[123]\b/g, '')
                     .replace(/\s*\d+\(\d+.*\)$/, '')
                     .replace(/\s*\d+[\/-]\d+.*$/, '')
                     .split(/CRR\s*:/i)[0]
                     .split(/RRR\s*:/i)[0]
                     .split(/need\s+\d+/i)[0]
                     .split(/opt\s+to/i)[0]
                     .trim();
          return text.replace(/<[^>]*>/g, '').trim();
        }

        // Target actual CREX live-score-card DOM structure
        const liveScoreCard = document.querySelector('.live-score-card, .scoreboard, .match-header');
        
        if (liveScoreCard) {
          const innings = liveScoreCard.querySelectorAll('.team-inning');
          if (innings.length >= 1) {
            const battingEl = innings[0];
            const nameEl = battingEl.querySelector('.team-name, .name');
            if (nameEl) scoreboard.batting.name = extractCleanName(nameEl);

            const scoreSpan = battingEl.querySelector('.runs.f-runs span:nth-child(1), .team-score span:nth-child(1), .runs.f-runs, .team-score, .runs');
            const oversSpan = battingEl.querySelector('.runs.f-runs span:nth-child(2), .team-score span:nth-child(2)');

            if (scoreSpan) {
              const parsed = parseScore(scoreSpan.textContent.trim());
              if (parsed.runs !== null) {
                scoreboard.batting.score = parsed.score;
                scoreboard.batting.runs = parsed.runs;
                scoreboard.batting.wickets = parsed.wickets;
                if (oversSpan) {
                  scoreboard.batting.overs = oversSpan.textContent.trim();
                } else {
                  scoreboard.batting.overs = parsed.overs;
                }
              }
            }

            if (innings.length >= 2) {
              const bowlingEl = innings[1];
              const bNameEl = bowlingEl.querySelector('.team-name, .name');
              if (bNameEl) scoreboard.bowling.name = extractCleanName(bNameEl);

              const bScoreSpan = bowlingEl.querySelector('.runs.f-runs span:nth-child(1), .team-score span:nth-child(1), .runs.f-runs, .team-score, .runs');
              if (bScoreSpan && bScoreSpan.textContent.trim()) {
                const parsed = parseScore(bScoreSpan.textContent.trim());
                if (parsed.runs !== null) {
                  scoreboard.bowling.score = parsed.score;
                  scoreboard.bowling.runs = parsed.runs;
                  scoreboard.bowling.wickets = parsed.wickets;
                }
              }
            }
          }
        } else {
          // Fallback for team-result containers
          const teamResults = document.querySelectorAll('.team-result, .team-innig, .live-data, .team-inning-card');
          if (teamResults.length >= 2) {
            let battingEl = teamResults[0];
            let bowlingEl = teamResults[1];

            if (battingEl) {
              const nameEl = battingEl.querySelector('.team-name, .name, .team-title');
              if (nameEl) scoreboard.batting.name = extractCleanName(nameEl);

              const runsEl = battingEl.querySelector('.runs.f-runs, .team-score, .runs, .score');
              if (runsEl) {
                const parsed = parseScore(runsEl.textContent.trim());
                scoreboard.batting.score = parsed.score;
                scoreboard.batting.runs = parsed.runs;
                scoreboard.batting.wickets = parsed.wickets;
                scoreboard.batting.overs = parsed.overs;
              }
            }

            if (bowlingEl) {
              const nameEl = bowlingEl.querySelector('.team-name, .name, .team-title');
              if (nameEl) scoreboard.bowling.name = extractCleanName(nameEl);

              const runsEl = bowlingEl.querySelector('.runs.f-runs, .team-score, .runs, .score');
              if (runsEl && runsEl.textContent.trim()) {
                const parsed = parseScore(runsEl.textContent.trim());
                scoreboard.bowling.score = parsed.score;
                scoreboard.bowling.runs = parsed.runs;
                scoreboard.bowling.wickets = parsed.wickets;
              }
            }
          }
        }

        // Extract CRR/RRR from designated classes or container text
        const crrEl = document.querySelector('.crr, .current-run-rate');
        const rrrEl = document.querySelector('.rrr, .required-run-rate');
        
        if (crrEl) {
          const match = crrEl.textContent.match(/(\d+\.\d+)/);
          if (match) scoreboard.crr = parseFloat(match[1]);
        }
        if (rrrEl) {
          const match = rrrEl.textContent.match(/(\d+\.\d+)/);
          if (match) scoreboard.rrr = parseFloat(match[1]);
        }

        const infoEl = document.querySelector('.live-score-card, .scoreboard, .match-info, .live-card');
        const textToSearch = infoEl ? infoEl.textContent : (document.body ? document.body.textContent : '');
        if (textToSearch) {
          if (scoreboard.crr === null) {
            const crrMatch = textToSearch.match(/CRR\s*:\s*(\d+\.\d+)/i);
            if (crrMatch) scoreboard.crr = parseFloat(crrMatch[1]);
          }
          if (scoreboard.rrr === null) {
            const rrrMatch = textToSearch.match(/RRR\s*:\s*(\d+\.\d+)/i);
            if (rrrMatch) scoreboard.rrr = parseFloat(rrrMatch[1]);
          }
          
          const needMatch = textToSearch.match(/(?:need|requires?)\s*(\d+)\s*runs?\s*(?:in\s*(\d+)\s*balls?)?/i);
          if (needMatch) {
            scoreboard.required.runs = parseInt(needMatch[1]);
            if (needMatch[2]) {
              scoreboard.required.balls = parseInt(needMatch[2]);
            }
          }
        }

        return scoreboard;
      });

      return result || { batting: { name: '', score: '', runs: null, wickets: null, overs: '', balls: null }, bowling: { name: '', score: '', runs: null, wickets: null, overs: '', balls: null }, target: null, required: { runs: null, balls: null }, crr: null, rrr: null };
    } catch (error) {
      logger.error(`Error extracting scoreboard: ${error.message}`);
      return { batting: { name: '', score: '', runs: null, wickets: null, overs: '', balls: null }, bowling: { name: '', score: '', runs: null, wickets: null, overs: '', balls: null }, target: null, required: { runs: null, balls: null }, crr: null, rrr: null };
    }
  }

  // ⭐ FIXED: Extract current batsmen using exact CREX playing-batsmen-wrapper DOM
  async extractCurrentBatsmen(page) {
    try {
      const batsmen = await page.evaluate(() => {
        const result = [];
        
        // Exact CREX container: .playing-batsmen-wrapper
        const wrapper = document.querySelector('.playing-batsmen-wrapper, app-match-live-player');
        
        if (wrapper) {
          // Batsman cards inside playing-batsmen-wrapper do NOT have the .bowler class
          const cards = wrapper.querySelectorAll('.batsmen-partnership:not(.bowler)');
          for (const card of cards) {
            if (result.length >= 2) break;

            const nameEl = card.querySelector('.batsmen-name a p, .batsmen-name p, .batsmen-name');
            if (!nameEl) continue;

            const name = nameEl.textContent.trim().replace(/\*/g, '').trim();
            if (!name || name.length < 2) continue;

            let runs = null;
            let balls = null;

            const scoreEl = card.querySelector('.batsmen-score');
            if (scoreEl) {
              const pEls = scoreEl.querySelectorAll('p');
              if (pEls.length >= 1) {
                const rText = pEls[0].textContent.trim();
                const rNum = parseInt(rText);
                if (!isNaN(rNum)) runs = rNum;
              }
              if (pEls.length >= 2) {
                const bText = pEls[1].textContent.trim();
                const bMatch = bText.match(/(\d+)/);
                if (bMatch) balls = parseInt(bMatch[1]);
              }
            }

            // Striker indicator: circle-strike-icon or star in name
            const hasStrikeIcon = !!scoreEl?.querySelector('.circle-strike-icon') || !!card.querySelector('.circle-strike-icon');
            const hasStarInName = nameEl.textContent.includes('*');

            const isStriker = (hasStrikeIcon || hasStarInName) ? true : false;

            if (!result.some(p => p.name === name)) {
              result.push({ name, runs, balls, is_striker: isStriker });
            }
          }
        }

        if (result.length === 0) {
          // Fallback for older DOMs
          const battingSection = document.querySelector('.team-innig.batting, .team-innig:first-child, .team-result:first-child');
          if (battingSection) {
            const batsmenItems = battingSection.querySelectorAll('.batsmen-info-wrapper, .player-card, .batsman-item');
            for (const item of batsmenItems) {
              if (result.length >= 2) break;
              const nameEl = item.querySelector('.batsmen-name a p, .batsmen-name p, .batsmen-name, .player-name');
              if (!nameEl) continue;
              const name = nameEl.textContent.trim().replace(/\*/g, '').trim();
              if (!name || name.length < 2) continue;

              const scoreEl = item.querySelector('.batsmen-score, .score, .runs');
              let runs = null;
              let balls = null;
              if (scoreEl) {
                const match = scoreEl.textContent.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
                if (match) {
                  runs = parseInt(match[1]);
                  balls = parseInt(match[2]);
                }
              }
              const hasStrikerIcon = !!item.querySelector('.circle-strike-icon, .striker');
              const hasStarInName = nameEl.textContent.includes('*');
              const isStriker = (hasStrikerIcon || hasStarInName) ? true : false;

              if (!result.some(p => p.name === name)) {
                result.push({ name, runs, balls, is_striker: isStriker });
              }
            }
          }
        }

        return result;
      });

      return batsmen || [];
    } catch (error) {
      logger.debug(`Error extracting batsmen: ${error.message}`);
      return [];
    }
  }

  // ⭐ FIXED: Extract current bowler using exact CREX playing-batsmen-wrapper bowler card DOM
  async extractCurrentBowler(page) {
    try {
      const bowler = await page.evaluate(() => {
        const result = { name: '', overs: '', runs: null, wickets: null };

        // CREX exact bowler DOM element inside playing-batsmen-wrapper
        const bowlerCard = document.querySelector('.playing-batsmen-wrapper .batsmen-partnership:has(.bowler), .batsmen-partnership.bowler, .bowler-info');
        
        if (bowlerCard) {
          const nameEl = bowlerCard.querySelector('.batsmen-name a p, .batsmen-name p, .player-name, .name');
          if (nameEl) {
            result.name = nameEl.textContent.trim().replace(/\*/g, '');
          }

          const scoreEl = bowlerCard.querySelector('.batsmen-score.bowler, .batsmen-score, .bowler-score');
          if (scoreEl) {
            const pEls = scoreEl.querySelectorAll('p');
            if (pEls.length >= 1) {
              const figText = pEls[0].textContent.trim(); // e.g. "0-25"
              const figMatch = figText.match(/(\d+)\s*-\s*(\d+)/);
              if (figMatch) {
                result.wickets = parseInt(figMatch[1]);
                result.runs = parseInt(figMatch[2]);
              }
            }
            if (pEls.length >= 2) {
              const ovText = pEls[1].textContent.trim(); // e.g. "(3.5)"
              const ovMatch = ovText.match(/([\d.]+)/);
              if (ovMatch) {
                result.overs = ovMatch[1];
              }
            }
          }
        }

        if (!result.name) {
          // Fallback search
          const bowlerItems = document.querySelectorAll('.player-card, .player-info, tr, .bowler-row');
          for (const item of bowlerItems) {
            const text = item.textContent.trim();
            const figuresMatch = text.match(/(\d+)\s*-\s*(\d+)\s*(?:\((\d+\.?\d*)\))?/);
            if (!figuresMatch || text.match(/\d+\s*\(\s*\d+\s*\)/)) continue;

            const nameEl = item.querySelector('.batsmen-name a p, .batsmen-name p, .player-name, .name');
            if (!nameEl) continue;

            const name = nameEl.textContent.trim().replace(/\d+-\d+/g, '').trim();
            if (!name || name.length < 2) continue;

            result.name = name;
            result.wickets = parseInt(figuresMatch[1]);
            result.runs = parseInt(figuresMatch[2]);
            result.overs = figuresMatch[3] || '';
            break;
          }
        }

        return result;
      });

      return bowler || { name: '', overs: '', runs: null, wickets: null };
    } catch (error) {
      logger.debug(`Error extracting bowler: ${error.message}`);
      return { name: '', overs: '', runs: null, wickets: null };
    }
  }

  // ⭐ FIXED: Extract overs timeline with over numbers (The Hundred support)
  async extractOversTimeline(page) {
    try {
      const overs = await page.evaluate(() => {
        const result = [];
        
        // Find over containers with labels like "18th Five" or "Over 1"
        const overContainers = document.querySelectorAll('.over-container, .overs-slide, .over-item, .over-row, .ml-over-card, .ml-over-d');
        
        if (overContainers.length > 0) {
          overContainers.forEach((container) => {
            const overData = {
              over: '',
              balls: [],
              total: ''
            };

            // Get over label - check text matching Over X or Xth Five
            const containerText = container.textContent.trim();
            const overMatch = containerText.match(/Over\s*(\d+)/i) || 
                              containerText.match(/(\d+)(?:st|nd|rd|th)?\s+Five/i) ||
                              containerText.match(/^(\d+)(?:st|nd|rd|th)?\b/);
            if (overMatch) {
              overData.over = overMatch[1];
            } else {
              // Check label elements
              const labelEl = container.querySelector('.over-title, .over-number, .over-label, .overs-title');
              if (labelEl) {
                const text = labelEl.textContent.trim();
                const match = text.match(/\d+/);
                if (match) {
                  overData.over = match[0];
                }
              }
            }

            // Get balls from this over
            const ballElements = container.querySelectorAll('.over-ball, .ball, .ball-item');
            ballElements.forEach((ballEl) => {
              let value = ballEl.textContent.trim();
              if (value) {
                if (value === 'W' || value === 'w' || ballEl.classList.contains('ml-o-b-w')) value = 'W';
                else if (value === 'wd') value = 'wd';
                else if (value === 'nb') value = 'nb';
                else if (value === '4lb') value = '4lb';
                else if (value === '1lb') value = '1lb';
                
                let event = null;
                const parent = ballEl.parentElement;
                if (parent) {
                  const font3El = parent.querySelector('.font3, .event-text, .ball-detail');
                  if (font3El) {
                    event = font3El.textContent.trim();
                  }
                }
                
                if (!event) {
                  if (value === '0') event = 'dot ball';
                  else if (value === '1') event = 'single';
                  else if (value === '2') event = 'two runs';
                  else if (value === '3') event = 'three runs';
                  else if (value === '4') event = 'four';
                  else if (value === '6') event = 'six';
                  else if (value === 'W') event = 'wicket';
                  else if (value === 'wd' || /wd$/i.test(value)) event = 'wide';
                  else if (value === 'nb' || /nb$/i.test(value)) event = 'no-ball';
                  else if (value === 'lb' || /lb$/i.test(value)) event = 'leg bye';
                  else if (value === 'b' || /b$/i.test(value)) event = 'bye';
                }
                
                const isWicket = value === 'W' || ballEl.classList.contains('ml-o-b-w');

                overData.balls.push({
                  value: value,
                  event: event,
                  isWicket: isWicket
                });
              }
            });

            // Get total
            const totalEl = container.querySelector('.total, .over-total, .over-summary');
            if (totalEl) {
              overData.total = totalEl.textContent.trim().replace(/[^0-9]/g, '');
            } else {
              const totalMatch = containerText.match(/=\s*(\d+)/) || containerText.match(/Total\s*:\s*(\d+)/i);
              if (totalMatch) {
                overData.total = totalMatch[1];
              }
            }

            if (overData.balls.length > 0) {
              result.push(overData);
            }
          });
        } else {
          // Fallback: Group ball elements into sets of 5 (The Hundred) or 6 (Standard)
          const ballElements = document.querySelectorAll('.over-ball, .ball, .ml-o-b-1');
          if (ballElements.length > 0) {
            let currentOver = [];
            let total = 0;
            let overNumber = 1;

            ballElements.forEach((el, index) => {
              let value = el.textContent.trim();
              if (value) {
                if (value === 'W' || value === 'w') value = 'W';
                else if (value === 'wd') value = 'wd';
                else if (value === 'nb') value = 'nb';
                
                currentOver.push({
                  value: value,
                  event: null,
                  isWicket: value === 'W'
                });
                
                // Group by 6 for standard (or 5 for The Hundred)
                if ((index + 1) % 6 === 0 || index === ballElements.length - 1) {
                  if (currentOver.length > 0) {
                    result.push({
                      over: String(overNumber),
                      balls: currentOver,
                      total: String(total)
                    });
                    overNumber++;
                    currentOver = [];
                    total = 0;
                  }
                }
              }
            });
          }
        }

        return result;
      });

      return overs || [];
    } catch (error) {
      logger.debug(`Error extracting overs: ${error.message}`);
      return [];
    }
  }

  // ⭐ FIXED: Extract commentary with exact CREX Angular DOM structure
  async extractCommentary(page) {
    try {
      const commentary = await page.evaluate(() => {
        const result = [];
        const seen = new Set();

        // Exact CREX Angular container & cards
        const container = document.querySelector('app-match-commentary, .br-comm.search-results, .commentary-list');
        
        let rows = [];
        if (container) {
          rows = Array.from(container.querySelectorAll('.cm-b-roundcard, .comm-card, .comm-item, .commentary-item'));
        } else {
          rows = Array.from(document.querySelectorAll('.cm-b-roundcard, .comm-card, .comm-item, .commentary-item'));
        }

        for (const row of rows) {
          const rowText = row.textContent.trim();
          if (!rowText || rowText.length < 5) continue;

          // Reject rate table signatures
          if (/^\*?\s*\d+\.\d{2}\s*\d+\.\d{2}/.test(rowText) || /^\d+(\.\d+)?\d+(\.\d+)?\d+/.test(rowText)) {
            continue;
          }

          let ball = null;
          let ballEl = row.querySelector('.cm-b-over, .ball-no, .ball-number, .over-ball');
          if (ballEl) {
            const bt = ballEl.textContent.trim();
            if (/^\d+\.\d+$/.test(bt) || /^\d+b?$/.test(bt)) {
              ball = bt;
            }
          }

          if (!ball) {
            const ballMatch = rowText.match(/^(\d+\.[1-6])\b/) || rowText.match(/^(\d+b)\b/);
            if (ballMatch) {
              ball = ballMatch[1];
            }
          }

          if (!ball || !/^(?:\d+\.[1-6]|\d+b)$/.test(ball)) continue;

          let res = '';
          const resEl = row.querySelector('.cm-b-ballupdate, .event, .result, .ball-run, .font3');
          if (resEl) {
            res = resEl.textContent.trim();
          }

          if (!res) {
            const words = rowText.split(/\s+/);
            for (const w of words) {
              const cleanedW = w.replace(/[^A-Za-z0-9]/g, '');
              if (['W', '6', '4', 'wd', 'nb', '1', '2', '3', '0', 'FOUR', 'SIX', 'WICKET'].includes(cleanedW.toUpperCase())) {
                res = cleanedW;
                break;
              }
            }
          }

          let text = '';
          const textEl = row.querySelector('.cm-b-comment-c2, .comm-text, .commentary-text, .desc');
          if (textEl) {
            text = textEl.textContent.trim();
          } else {
            text = rowText;
            if (ball && text.startsWith(ball)) {
              text = text.substring(ball.length).trim();
            }
            if (res && text.startsWith(res)) {
              text = text.substring(res.length).trim();
            }
            text = text.replace(/^\s*[:-]\s*/, '').trim();
          }

          if (!text || text.length < 3) continue;

          // Reject rate table or numeric noise text
          if (/^\*?\s*\d+\.\d{2}/.test(text) && !/[a-zA-Z]{3,}/.test(text)) {
            continue;
          }

          const key = `${ball}|${text}`;
          if (seen.has(key)) continue;
          seen.add(key);

          // STRICT WICKET DETECTION: only if result is explicitly W/WICKET or dedicated wicket badge element exists
          const hasWicketClass = resEl && (
            resEl.classList.contains('wicket') || 
            resEl.classList.contains('w-bg') || 
            resEl.classList.contains('wicket-badge') ||
            resEl.classList.contains('cm-o-b-w')
          );
          const hasWicketBadge = row.querySelector('.wicket-badge, .w-bg, .wicket-icon, .font3.wicket, .cm-o-b-w') !== null;
          
          const isWicket = res.toUpperCase() === 'W' || 
                           res.toUpperCase() === 'WICKET' || 
                           hasWicketClass || 
                           hasWicketBadge;

          result.push({
            ball: ball,
            result: res || '',
            text: text,
            isWicket: isWicket
          });
        }

        return result;
      });

      return commentary || [];
    } catch (error) {
      logger.debug(`Error extracting commentary: ${error.message}`);
      return [];
    }
  }

  // ⭐ FIXED: Extract toss strictly from dedicated toss or status elements
  async extractToss(page) {
    try {
      const toss = await page.evaluate(() => {
        const result = { status: 'unknown', winner: null, decision: null };

        const tossSelectors = [
          '.toss-wrap', '.toss-info', '.match-toss', '.toss-detail', '.toss-text', '[class*="toss"]',
          '.ms-card', '.match-status', '.live-status', '.final-result', '.live-banner'
        ];
        
        for (const selector of tossSelectors) {
          const tossEl = document.querySelector(selector);
          if (tossEl) {
            const text = tossEl.textContent.trim();
            if (text && !/trail\s+by|lead\s+by|need|crr|rrr|target|runs|balls/i.test(text)) {
              if (/opt\s+to\s+(bowl|bat)/i.test(text) || /won\s+(?:the\s+)?toss/i.test(text) || /chose\s+to\s+(bowl|bat)/i.test(text)) {
                result.status = 'completed';

                const winnerMatch = text.match(/([A-Za-z0-9\s-]+)\s+won\s+(?:the\s+)?toss/i);
                if (winnerMatch) {
                  let winner = winnerMatch[1].replace(/and\s*$/i, '').trim();
                  if (winner && winner.length <= 15 && !/opt\s+to/i.test(winner)) {
                    result.winner = winner;
                  }
                }

                const decisionMatch = text.match(/(?:opt|chose|elect)\s+to\s+(bowl|bat)/i);
                if (decisionMatch) {
                  result.decision = decisionMatch[1].toLowerCase();
                }
                
                if (result.status === 'completed') break;
              }
            }
          }
        }

        return result;
      });

      return toss || { status: 'unknown', winner: null, decision: null };
    } catch (error) {
      logger.debug(`Error extracting toss: ${error.message}`);
      return { status: 'unknown', winner: null, decision: null };
    }
  }

  // ⭐ FIXED: Extract series
  async extractSeries(page) {
    try {
      const series = await page.evaluate(() => {
        const el = document.querySelector('.series-name, .snameTag, .match-series, .series-title, .tournament');
        if (el) {
          return el.textContent.trim();
        }
        return '';
      });

      return series || '';
    } catch (error) {
      logger.debug(`Error extracting series: ${error.message}`);
      return '';
    }
  }

  // ⭐ FIXED: Extract venue strictly from dedicated venue elements
  async extractVenue(page) {
    try {
      const venue = await page.evaluate(() => {
        // 1. Check dedicated venue selectors
        const selectors = [
          '.content-wrap.venue-detail .venue', '.venue-detail .venue', '.match-venue .venue',
          '.venue', '.venue-name', '.stadium-name', '.stadium', 
          '.match-venue', '.location', '.match-location',
          '.venue-info', '.stadium-info'
        ];
        
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            const text = el.textContent.trim();
            if (text && text.length > 3 && 
                !text.includes('Over') && !text.includes('wd') &&
                !text.includes('Batting') && !text.includes('Bowling') &&
                !text.includes('talking') && !text.includes('outfield') &&
                !text.includes('drizzling') && !text.includes('rain') && !text.includes('Rain')) {
              return text;
            }
          }
        }

        // 2. Check match-number or header elements containing ground/stadium names
        const headerEls = document.querySelectorAll('.match-number, .match-desc, .match-info .match-desc, .match-header, .info-card');
        for (const el of headerEls) {
          const text = el.textContent.trim();
          const groundMatch = text.match(/([A-Z][a-zA-Z0-9\s,.-]+(?:Cricket Ground|Ground|Stadium|Oval|Park|Arena|Complex))/i);
          if (groundMatch) {
            let cleaned = groundMatch[1].trim().replace(/^,\s*/, '').replace(/^(?:\d+(?:st|nd|rd|th)?\s+Match|T20|ODI|Test|100B|T10|\w+\s+League),\s*/i, '');
            if (cleaned && cleaned.length > 3 && !cleaned.toLowerCase().includes('league')) {
              return cleaned;
            }
          }
        }
        
        return null;
      });

      if (!venue) return null;
      let cleanedVenue = venue.trim();
      cleanedVenue = cleanedVenue.replace(/^(?:It has started drizzling at|Rain stops play at|Play starts at|Match scheduled at|at|in)\s+/i, '');
      return cleanedVenue || null;
    } catch (error) {
      logger.debug(`Error extracting venue: ${error.message}`);
      return null;
    }
  }

  // ⭐ FIXED: Extract match format and number
  async extractMatchFormat(page, matchUrl) {
    try {
      const formatData = await page.evaluate(() => {
        const h1 = document.querySelector('h1')?.textContent || '';
        const seriesName = document.querySelector('.series-name, .snameTag, .match-series, .series-info')?.textContent || '';
        const matchDesc = document.querySelector('.match-desc, .match-number, .match-desc-info')?.textContent || '';
        
        const combinedText = `${h1} | ${seriesName} | ${matchDesc}`.trim();
        
        let format = null;
        let matchNumber = null;

        if (/hundred/i.test(combinedText) || /100-ball/i.test(combinedText) || /100B/i.test(combinedText)) {
          format = 'The Hundred';
        } else if (/\bT20\b/i.test(combinedText) || /twenty20/i.test(combinedText) || /twenty 20/i.test(combinedText)) {
          format = 'T20';
        } else if (/\bODI\b/i.test(combinedText) || /one day/i.test(combinedText)) {
          format = 'ODI';
        } else if (/\bTest\b/i.test(combinedText) || /5-Day/i.test(combinedText) || /first-class/i.test(combinedText)) {
          format = 'Test';
        } else if (/\bT10\b/i.test(combinedText) || /ten10/i.test(combinedText)) {
          format = 'T10';
        }

        const matchNumMatch = combinedText.match(/(\d+)(?:st|nd|rd|th)\s+(?:Match|T20|ODI|Test|100B|T10)/i) || 
                              combinedText.match(/(Qualifier|Eliminator|Final)\s*\d*/i);
        if (matchNumMatch) {
          matchNumber = matchNumMatch[0];
        }

        return { format, matchNumber };
      });

      let format = formatData.format;
      let matchNumber = formatData.matchNumber || null;

      if (!format && matchUrl) {
        if (/hundred/i.test(matchUrl) || /100b/i.test(matchUrl)) {
          format = 'The Hundred';
        } else if (/t20/i.test(matchUrl)) {
          format = 'T20';
        } else if (/odi/i.test(matchUrl)) {
          format = 'ODI';
        } else if (/test/i.test(matchUrl)) {
          format = 'Test';
        } else if (/t10/i.test(matchUrl)) {
          format = 'T10';
        }

        if (!matchNumber) {
          const urlMatch = matchUrl.match(/(\d+)(?:st|nd|rd|th)?-?(?:match|odi|t20|100b|t10)/i);
          if (urlMatch) {
            matchNumber = urlMatch[0].replace(/-/g, ' ');
          }
        }
      }

      if (!format) {
        const bodyFormat = await page.evaluate(() => {
          const mainContent = document.querySelector('.match-info, .scoreboard, .match-detail-container')?.textContent || '';
          if (/\bT20\b/i.test(mainContent)) return 'T20';
          if (/\bODI\b/i.test(mainContent)) return 'ODI';
          if (/\bTest\b/i.test(mainContent)) return 'Test';
          if (/\bT10\b/i.test(mainContent)) return 'T10';
          return null;
        });
        format = bodyFormat;
      }

      return {
        format: format || null,
        number: matchNumber || null
      };
    } catch (error) {
      logger.debug(`Error extracting match format: ${error.message}`);
      return { format: null, number: null };
    }
  }

  // ⭐ FIXED: Get current ball from the last over
  async extractCurrentBall(page) {
    try {
      const currentBall = await page.evaluate(() => {
        const scoreboard = document.querySelector('.scoreboard, .team-innig, .overs-timeline');
        if (!scoreboard) return null;

        const ballSelectors = [
          '.current-ball', '.ball-number', '.over-ball.current',
          '.ball.current', '.highlight-ball', '.active-ball'
        ];
        
        for (const selector of ballSelectors) {
          const el = scoreboard.querySelector(selector);
          if (el) {
            const text = el.textContent.trim();
            if (text) {
              return text;
            }
          }
        }

        const scoreText = scoreboard.textContent || '';
        const overMatch = scoreText.match(/\((\d+\.\d+)\s*ov\)/i) || scoreText.match(/(\d+\.\d+)\s*overs/i);
        if (overMatch) {
          return overMatch[1];
        }

        return null;
      });

      if (!currentBall) return null;
      const cleanBall = currentBall.trim();

      if (/^\d+\.[1-6]$/.test(cleanBall)) {
        return cleanBall;
      }

      if (/^\d+b?$/.test(cleanBall)) {
        const val = parseInt(cleanBall);
        if (val >= 0 && val <= 125) {
          return cleanBall;
        }
      }

      return null;
    } catch (error) {
      logger.debug(`Error extracting current ball: ${error.message}`);
      return null;
    }
  }

  // ⭐ FIXED: Get current innings
  async extractCurrentInnings(page) {
    try {
      const innings = await page.evaluate(() => {
        const container = document.querySelector('.scoreboard, .match-info, .team-result, .live-data');
        if (container) {
          const text = container.textContent || '';
          const match = text.match(/(\d+)(?:st|nd|rd|th)?\s*Innings?/i);
          if (match) {
            const num = parseInt(match[1]);
            if (num === 1 || num === 2 || num === 3 || num === 4) {
              return num;
            }
          }
        }

        const inningsSelectors = [
          '.innings', '.current-innings', '.innings-number',
          '.inns', '.inning', '.innings-label'
        ];
        
        for (const selector of inningsSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            const text = el.textContent.trim();
            const match = text.match(/(\d+)/);
            if (match) {
              const num = parseInt(match[1]);
              if (num === 1 || num === 2 || num === 3 || num === 4) {
                return num;
              }
            }
          }
        }

        const bodyText = document.body.textContent || '';
        if (bodyText.includes('need') && bodyText.includes('runs in') && bodyText.includes('balls')) {
          return 2;
        }

        return null;
      });

      return innings ? parseInt(innings) : null;
    } catch (error) {
      logger.debug(`Error extracting current innings: ${error.message}`);
      return null;
    }
  }

  // ⭐ FIXED: Get start time
  async extractStartTime(page) {
    try {
      const startTime = await page.evaluate(() => {
        const timeSelectors = [
          '.start-time', '.match-time', '.time', 
          '.match-start-time', '.schedule-time',
          'time[datetime]', '[datetime]'
        ];
        
        for (const selector of timeSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            const datetime = el.getAttribute('datetime');
            if (datetime) {
              return datetime;
            }
            const text = el.textContent.trim();
            if (text && text.match(/\d{1,2}:\d{2}/)) {
              return text;
            }
          }
        }

        const bodyText = document.body.textContent;
        const timeMatch = bodyText.match(/Start\s*[::]\s*(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i);
        if (timeMatch) {
          return timeMatch[1].trim();
        }

        return null;
      });

      return startTime || null;
    } catch (error) {
      logger.debug(`Error extracting start time: ${error.message}`);
      return null;
    }
  }

  // ⭐ Extract Win Probability and Projected Scores cleanly from dedicated widgets
  async extractPrediction(page) {
    try {
      const prediction = await page.evaluate(() => {
        const result = {
          home_probability: null,
          away_probability: null,
          win_probability_text: null,
          favorite: null,
          projected_scores: []
        };

        // 1. Search for Win Probability in dedicated widgets
        const probContainer = document.querySelector('.probability, .win-probability, [class*="probability"], [class*="win-prob"], .win-prob-card');
        
        if (probContainer) {
          const text = probContainer.textContent || '';
          const matches = text.match(/(\d+)\s*%/g);
          if (matches && matches.length >= 2) {
            const hProb = parseInt(matches[0]);
            const aProb = parseInt(matches[1]);
            if (hProb >= 0 && hProb <= 100 && aProb >= 0 && aProb <= 100) {
              result.home_probability = hProb;
              result.away_probability = aProb;
              result.win_probability_text = `${hProb}% - ${aProb}%`;
            }
          } else {
            const percentElements = Array.from(probContainer.querySelectorAll('.percent, [class*="percent"], .bar-text'));
            const percents = percentElements
              .map(el => parseInt(el.textContent.replace(/[^0-9]/g, '')))
              .filter(n => !isNaN(n) && n >= 0 && n <= 100);
            
            if (percents.length >= 2) {
              result.home_probability = percents[0];
              result.away_probability = percents[1];
              result.win_probability_text = `${percents[0]}% - ${percents[1]}%`;
            }
          }
        }

        // 2. Search for Projected Score in dedicated card with clean cell parsing
        const projContainer = document.querySelector('.projected-score, [class*="projected-score"], .projected-card, .proj-score-wrapper');
        
        if (projContainer) {
          const rows = projContainer.querySelectorAll('tr, .projected-row');
          rows.forEach(r => {
            const cells = r.querySelectorAll('td, .cell, .col, span, p');
            if (cells.length >= 2) {
              const rateText = cells[0].textContent.trim();
              const scoreText = cells[cells.length - 1].textContent.trim();

              const rateMatch = rateText.match(/(\d+(?:\.\d+)?)/);
              const scoreMatch = scoreText.match(/(\d+)/);

              if (rateMatch && scoreMatch) {
                const rate = parseFloat(rateMatch[1]);
                const runs = parseInt(scoreMatch[1]);
                if (rate > 0 && rate < 50 && runs > 0 && runs < 1000) {
                  result.projected_scores.push({
                    rate: rate,
                    projected_runs: runs,
                    text: `${rate} R.R: ${runs}`
                  });
                }
              }
            }
          });
        }

        return result;
      });

      return prediction || { home_probability: null, away_probability: null, win_probability_text: null, favorite: null, projected_scores: [] };
    } catch (error) {
      logger.debug(`Error extracting prediction: ${error.message}`);
      return { home_probability: null, away_probability: null, win_probability_text: null, favorite: null, projected_scores: [] };
    }
  }

  // ⭐ Extract Yet to bat players list
  async extractYetToBat(page) {
    try {
      const yetToBat = await page.evaluate(() => {
        const players = [];
        const container = Array.from(document.querySelectorAll('div, section, article')).find(
          el => el.textContent && el.textContent.toLowerCase().includes('yet to bat')
        );

        if (container) {
          const items = container.querySelectorAll('.player-card, .player-item, .batsman-item, .ytb-player, div');
          items.forEach(item => {
            const nameEl = item.querySelector('.player-name, .name, p, a, span');
            const avgEl = item.querySelector('.avg, .player-avg, span.avg');
            if (nameEl) {
              const name = nameEl.textContent.trim();
              if (name && name.toLowerCase() !== 'yet to bat' && name.length > 2 && name.length < 35 && !players.some(p => p.name === name)) {
                let avg = null;
                if (avgEl) {
                  const avgMatch = avgEl.textContent.match(/Avg\s*[:\s]*([\d.]+)/i);
                  if (avgMatch) avg = parseFloat(avgMatch[1]);
                }
                players.push({ name, avg });
              }
            }
          });
        }
        return players;
      });

      return yetToBat || [];
    } catch (error) {
      logger.debug(`Error extracting Yet to bat: ${error.message}`);
      return [];
    }
  }

  // ⭐ Extract Full Scorecard (Batting, Bowling, Extras)
  async extractFullScorecard(page) {
    try {
      const fullScorecard = await page.evaluate(() => {
        const scorecardContainer = document.querySelector('.scorecard-table, .scorecard, .batting-table, .match-scorecard');
        if (!scorecardContainer) return null;

        const scorecard = {
          batting: [],
          bowling: [],
          extras: null
        };

        const battingRows = scorecardContainer.querySelectorAll('tr, .batting-row, .batsman-row, .tb-b-row');
        battingRows.forEach(row => {
          const cells = row.querySelectorAll('td, .cell');
          if (cells.length >= 4) {
            const name = cells[0].textContent.trim();
            const dismissal = cells[1] ? cells[1].textContent.trim() : '';
            const runsText = cells[2] ? cells[2].textContent.trim() : '0';
            const ballsText = cells[3] ? cells[3].textContent.trim() : '0';
            const foursText = cells[4] ? cells[4].textContent.trim() : '0';
            const sixesText = cells[5] ? cells[5].textContent.trim() : '0';
            const srText = cells[6] ? cells[6].textContent.trim() : '0';

            const runs = parseInt(runsText);
            const balls = parseInt(ballsText);

            const cleanedName = name.replace(/\*/g, '').trim();

            const isValidName = cleanedName && 
                                !['batter', 'batting', 'name', 'bowler', 'total', 'extras', 'did not bat', 'yet to bat'].includes(cleanedName.toLowerCase()) &&
                                !/^\d+$/.test(cleanedName) && 
                                !/^\d+\.\d+$/.test(cleanedName) && 
                                !/%/.test(cleanedName) &&
                                !/crr/i.test(cleanedName) && 
                                !/rrr/i.test(cleanedName) && 
                                !/over/i.test(cleanedName);

            if (isValidName && !isNaN(runs)) {
              scorecard.batting.push({
                name: cleanedName,
                dismissal,
                runs,
                balls: isNaN(balls) ? 0 : balls,
                fours: parseInt(foursText) || 0,
                sixes: parseInt(sixesText) || 0,
                strike_rate: parseFloat(srText) || null
              });
            }
          }
        });

        const bowlingRows = scorecardContainer.querySelectorAll('.bowling-row, .bowler-row, .tb-bw-row, tr.bowler');
        bowlingRows.forEach(row => {
          const cells = row.querySelectorAll('td, .cell');
          if (cells.length >= 4) {
            const name = cells[0].textContent.trim();
            const overs = cells[1] ? cells[1].textContent.trim() : '0';
            const maidens = parseInt(cells[2] ? cells[2].textContent.trim() : '0');
            const runs = parseInt(cells[3] ? cells[3].textContent.trim() : '0');
            const wickets = parseInt(cells[4] ? cells[4].textContent.trim() : '0');
            const economy = parseFloat(cells[5] ? cells[5].textContent.trim() : '0');

            const cleanedName = name.replace(/\*/g, '').trim();

            const isValidName = cleanedName && 
                                !['bowler', 'name', 'batter', 'total', 'extras'].includes(cleanedName.toLowerCase()) &&
                                !/^\d+$/.test(cleanedName) && 
                                !/^\d+\.\d+$/.test(cleanedName) && 
                                !/%/.test(cleanedName);

            if (isValidName && !isNaN(runs)) {
              scorecard.bowling.push({
                name: cleanedName,
                overs,
                maidens: isNaN(maidens) ? 0 : maidens,
                runs,
                wickets: isNaN(wickets) ? 0 : wickets,
                economy_rate: isNaN(economy) ? null : economy
              });
            }
          }
        });

        const extrasEl = Array.from(scorecardContainer.querySelectorAll('div, tr, p')).find(
          el => el.textContent && el.textContent.includes('Extras:')
        );
        if (extrasEl) {
          scorecard.extras = extrasEl.textContent.trim();
        }

        if (scorecard.batting.length === 0 && scorecard.bowling.length === 0) {
          return null;
        }

        return scorecard;
      });

      return fullScorecard || null;
    } catch (error) {
      logger.debug(`Error extracting full scorecard: ${error.message}`);
      return null;
    }
  }

  // ⭐ FIXED: Extract Live Ball Result Box strictly scoped to .result-box
  async extractLastBall(page) {
    try {
      const lastBall = await page.evaluate(() => {
        const resBox = document.querySelector('.result-box, .ball-result-card, .live-ball-box');
        if (!resBox) return { ball: null, value: null, event: null, isWicket: false };

        const font1El = resBox.querySelector('.font1');
        const font2El = resBox.querySelector('.font2');
        const font3El = resBox.querySelector('.font3');

        let val = font1El ? font1El.textContent.trim() : null;
        let eventText = font3El ? font3El.textContent.trim() : (font2El ? font2El.textContent.trim() : null);

        if (!val && font2El) val = font2El.textContent.trim();

        // Reject non-delivery UI state text from becoming last_ball.event
        const forbidden = [
          'players entering', 'players walking in', 'innings break', 'opt to bat', 'opt to bowl',
          'won the toss', 'won toss', 'trail by', 'lead by', 'day ', 'session ', 'local time',
          'match delayed', 'rain delay', 'stumps', 'tea', 'lunch', 'scheduled'
        ];
        if (eventText && forbidden.some(term => eventText.toLowerCase().includes(term))) {
          eventText = null;
        }

        let isWicket = false;
        const combinedText = `${val || ''} ${eventText || ''}`.toLowerCase();

        const isTemporary = /lbw\s+check|appeal|review|decision\s+pending|checking|under\s+review/i.test(combinedText) &&
                            !/not\s+out|out\s+confirmed/i.test(combinedText);
        const isNotOut = /not\s+out/i.test(combinedText);

        if (!isTemporary && !isNotOut) {
          if (val === 'W' || val === 'w' || (eventText && /catch|bowled|lbw|run out|stumped|hit wicket|wicket/i.test(eventText))) {
            isWicket = true;
            if (!val) val = 'W';
          }
        }

        return {
          ball: null,
          value: val,
          event: eventText || (val === '6' ? 'SIX' : (val === '4' ? 'FOUR' : (val === '0' ? 'dot ball' : val))),
          isWicket: isWicket
        };
      });

      return lastBall;
    } catch (error) {
      logger.debug(`Error extracting last ball: ${error.message}`);
      return { ball: null, value: null, event: null, isWicket: false };
    }
  }

  // ⭐ Extract Odds and Betting info strictly from dedicated odds card
  async extractOdds(page, prediction, homeTeamName, awayTeamName) {
    try {
      const odds = await page.evaluate(({ homeName, awayName }) => {
        const result = {
          favorite: null,
          home_win_percentage: null,
          away_win_percentage: null,
          win_probability: null,
          market_rates: null,
          betting_summary: null
        };

        const oddsContainer = document.querySelector('.odds, .odds-card, .session-odds, .market-rates, [class*="odds"]');
        if (oddsContainer) {
          const text = oddsContainer.textContent.trim();
          const oddsMatch = text.match(/(\d+(?:\.\d+)?)\s*[:\-\/]\s*(\d+(?:\.\d+)?)/);
          if (oddsMatch) {
            result.market_rates = oddsMatch[0];
          }
        }

        return result;
      }, { homeName: homeTeamName, awayName: awayTeamName });

      if (prediction) {
        odds.home_win_percentage = prediction.home_probability;
        odds.away_win_percentage = prediction.away_probability;
        odds.win_probability = prediction.win_probability_text;
        if (prediction.home_probability && prediction.away_probability) {
          odds.favorite = prediction.home_probability > prediction.away_probability ? homeTeamName : awayTeamName;
          odds.betting_summary = `${odds.favorite} is favored to win with ${Math.max(prediction.home_probability, prediction.away_probability)}% win probability`;
        }
      }

      return odds;
    } catch (error) {
      logger.debug(`Error extracting odds: ${error.message}`);
      return { favorite: null, home_win_percentage: null, away_win_percentage: null, win_probability: null, betting_summary: null };
    }
  }

  cleanTeamName(name) {
    if (!name) return '';
    let str = String(name).replace(/<[^>]*>/g, '').trim(); // Remove HTML tags
    
    // Strip CRR / RRR / need / runs / opt to / required / target / rate / status leaks
    str = str.replace(/CRR\s*[:].*$/i, '')
             .replace(/RRR\s*[:].*$/i, '')
             .replace(/\bneed\s*\d+.*$/i, '')
             .replace(/\bopt\s+to\s+.*$/i, '')
             .replace(/\bwon\s+the\s+toss.*$/i, '')
             .replace(/\bchose\s+to\s+.*$/i, '')
             .replace(/\brequired\b.*$/i, '')
             .replace(/\btarget\b.*$/i, '')
             .replace(/\brate\b.*$/i, '')
             .trim();

    // If string still contains forbidden words, extract just the team name prefix
    const forbidden = ['CRR', 'RRR', 'need', 'runs', 'balls', 'opt to', 'required', 'target', 'rate'];
    if (forbidden.some(word => str.toLowerCase().includes(word.toLowerCase()))) {
      const match = str.match(/^([A-Za-z0-9\s-]{2,15})/);
      if (match) {
        str = match[1].trim();
      }
    }

    return str;
  }

  // ⭐ Extract EXACT raw match status string from CREX DOM without sanitization
  async extractMatchStatus(page) {
    try {
      const status = await page.evaluate(() => {
        const selectors = [
          '.ms-card', '.match-status', '.live-status', '.ms-live-card', 
          '.status-text', '.final-result', '.live-banner .font3'
        ];
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            const text = el.textContent.trim();
            if (text && text.length > 0) {
              return text;
            }
          }
        }
        return 'Live';
      });

      return status || 'Live';
    } catch (error) {
      logger.debug(`Error extracting match status: ${error.message}`);
      return 'Live';
    }
  }

  // ⭐ FIXED: Extract Team 1 and Team 2 independently from header / team card DOM nodes
  async extractTeamsFromDOM(page) {
    try {
      const teams = await page.evaluate(() => {
        const res = {
          home: { name: '', short_name: '', logo: '' },
          away: { name: '', short_name: '', logo: '' }
        };

        function cleanName(raw) {
          if (!raw) return '';
          let s = raw.split('\n')[0].trim();
          s = s.replace(/\s*\d+[\/-]\d+.*$/, '');
          s = s.replace(/\s*\d+\(\d+.*\)$/, '');
          s = s.split(/CRR\s*:/i)[0].trim();
          s = s.split(/RRR\s*:/i)[0].trim();
          s = s.split(/need\s+\d+/i)[0].trim();
          s = s.split(/opt\s+to/i)[0].trim();
          return s.replace(/<[^>]*>/g, '').trim();
        }

        const t1Node = document.querySelector('.team-1, .team-a, .home-team-card, .team-card:nth-child(1)');
        const t2Node = document.querySelector('.team-2, .team-b, .away-team-card, .team-card:nth-child(2)');

        if (t1Node) {
          const nameEl = t1Node.querySelector('.team-name, .team-title, .name-text, a, p');
          const shortEl = t1Node.querySelector('.team-short-name, .short-name, .team-code');
          const imgEl = t1Node.querySelector('img');

          if (nameEl) res.home.name = cleanName(nameEl.textContent);
          if (shortEl) res.home.short_name = shortEl.textContent.trim();
          if (imgEl) res.home.logo = imgEl.src || '';
        }

        if (t2Node) {
          const nameEl = t2Node.querySelector('.team-name, .team-title, .name-text, a, p');
          const shortEl = t2Node.querySelector('.team-short-name, .short-name, .team-code');
          const imgEl = t2Node.querySelector('img');

          if (nameEl) res.away.name = cleanName(nameEl.textContent);
          if (shortEl) res.away.short_name = shortEl.textContent.trim();
          if (imgEl) res.away.logo = imgEl.src || '';
        }

        // Fallback: check .live-score-card .team-inning
        if (!res.home.name || !res.away.name) {
          const innings = document.querySelectorAll('.live-score-card .team-inning, .team-result');
          if (innings.length >= 2) {
            const inn1 = innings[0];
            const inn2 = innings[1];

            const n1 = inn1.querySelector('.team-name a, .team-name p, .team-name span:not(.score):not(.runs), .team-name');
            const n2 = inn2.querySelector('.team-name a, .team-name p, .team-name span:not(.score):not(.runs), .team-name');
            const logo1 = inn1.querySelector('img');
            const logo2 = inn2.querySelector('img');

            if (!res.home.name && n1) res.home.name = cleanName(n1.textContent);
            if (!res.away.name && n2) res.away.name = cleanName(n2.textContent);
            if (!res.home.logo && logo1) res.home.logo = logo1.src || '';
            if (!res.away.logo && logo2) res.away.logo = logo2.src || '';
          }
        }

        return res;
      });

      return teams;
    } catch (error) {
      logger.debug(`Error extracting teams from DOM: ${error.message}`);
      return { home: { name: '', short_name: '', logo: '' }, away: { name: '', short_name: '', logo: '' } };
    }
  }

  // ⭐ FIXED: Build match data with all fields
  async getRealTimeMatchData(page, match, agentId) {
    try {
      let url = match.url;
      if (url.includes('/match-details')) {
        url = url.replace('/match-details', '');
      }
      url = url.includes('?') ? `${url}&_=${Date.now()}` : `${url}?_=${Date.now()}`;
      logger.info(`   📡 ${agentId} fetching: ${url}`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.sleep(200);
      } catch (navError) {
        logger.warn(`   ⚠️ ${agentId} navigation timeout, using fallback`);
        return this.createFallbackMatch(match);
      }

      try {
        await page.waitForSelector(
          '.team-1, .team-2, .runs.f-runs, .live-score-card, .team-result',
          {
            timeout: 8000,
          }
        );
      } catch (e) {
        logger.warn(`   ⚠️ ${agentId} no match content found, using fallback`);
        return this.createFallbackMatch(match);
      }

      await this.sleep(100);

      // Extract all data
      const [series, venue, scoreboard, currentBatsmen, currentBowler, toss, commentary, matchFormat, currentInnings, currentBallRaw, startTime, prediction, yetToBat, fullScorecard, lastBall, matchStatus] =
        await Promise.all([
          this.extractSeries(page),
          this.extractVenue(page),
          this.extractScoreboard(page),
          this.extractCurrentBatsmen(page),
          this.extractCurrentBowler(page),
          this.extractToss(page),
          this.extractCommentary(page),
          this.extractMatchFormat(page, match.url),
          this.extractCurrentInnings(page),
          this.extractCurrentBall(page),
          this.extractStartTime(page),
          this.extractPrediction(page),
          this.extractYetToBat(page),
          this.extractFullScorecard(page),
          this.extractLastBall(page),
          this.extractMatchStatus(page),
        ]);

      // Reconcile lastBall delivery number & value with authoritative commentary
      if (lastBall && commentary && commentary.length > 0) {
        const deliveryComm = commentary.find(c => c.ball && /^(?:\d+\.[1-6]|\d+b)$/.test(c.ball));
        if (deliveryComm) {
          if (!lastBall.ball || lastBall.ball === deliveryComm.ball) {
            lastBall.ball = deliveryComm.ball;
            lastBall.value = deliveryComm.result;
            if (deliveryComm.isWicket) {
              lastBall.isWicket = true;
              lastBall.event = 'Wicket';
            } else {
              const forbiddenEvents = [
                'players entering', 'players walking in', 'innings break', 'opt to bat', 'opt to bowl',
                'won the toss', 'won toss', 'trail by', 'lead by', 'day ', 'session ', 'local time'
              ];
              const isBadEvent = !lastBall.event || forbiddenEvents.some(term => (lastBall.event || '').toLowerCase().includes(term));
              if (isBadEvent) {
                lastBall.event = deliveryComm.result === '4' ? 'FOUR' : (deliveryComm.result === '6' ? 'SIX' : deliveryComm.result);
              }
            }
          }
        }
      }

      // If lastBall has no ball and no valid delivery value, reset to null ball representation for unstarted/pre-match
      if (lastBall && !lastBall.ball && (!lastBall.value || lastBall.value === '0')) {
        lastBall.ball = null;
        lastBall.value = null;
        lastBall.event = null;
        lastBall.isWicket = false;
      }

      let currentBall = currentBallRaw;
      if (!currentBall && lastBall && lastBall.ball) {
        currentBall = lastBall.ball;
      }

      // Extract team 1 and team 2 independently from dedicated DOM containers
      const domTeams = await this.extractTeamsFromDOM(page);

      let homeTeamName = domTeams.home.name || this.cleanTeamName(match.team1?.name || scoreboard.batting.name);
      let awayTeamName = domTeams.away.name || this.cleanTeamName(match.team2?.name || scoreboard.bowling.name);

      // Validate team uniqueness & prevent duplicate team IDs
      let homeId = this.getTeamId(homeTeamName);
      let awayId = this.getTeamId(awayTeamName);

      if (homeId === awayId || homeTeamName === awayTeamName || !awayTeamName) {
        logger.warn(`⚠️ Duplicate or invalid team IDs detected (${homeId} vs ${awayId}). Re-inspecting fallback team names.`);
        if (match.team1?.name && match.team2?.name && match.team1.name !== match.team2.name) {
          homeTeamName = this.cleanTeamName(match.team1.name);
          awayTeamName = this.cleanTeamName(match.team2.name);
        } else if (scoreboard.batting.name && scoreboard.bowling.name && scoreboard.batting.name !== scoreboard.bowling.name) {
          homeTeamName = this.cleanTeamName(scoreboard.batting.name);
          awayTeamName = this.cleanTeamName(scoreboard.bowling.name);
        }
        homeId = this.getTeamId(homeTeamName);
        awayId = this.getTeamId(awayTeamName);
        if (homeId === awayId) {
          awayId = `${homeId}_away`;
        }
      }

      const homeLogo = domTeams.home.logo || match.team1?.flag || '';
      let awayLogo = domTeams.away.logo || match.team2?.flag || '';
      if (homeLogo && awayLogo && homeLogo === awayLogo) {
        if (match.team2?.flag && match.team2.flag !== homeLogo) {
          awayLogo = match.team2.flag;
        }
      }

      const homeShort = domTeams.home.short_name || match.team1?.short || homeTeamName.substring(0, 3).toUpperCase();
      let awayShort = domTeams.away.short_name || match.team2?.short || awayTeamName.substring(0, 3).toUpperCase();
      if (homeShort === awayShort) {
        awayShort = awayTeamName.substring(0, 3).toUpperCase();
      }

      const odds = await this.extractOdds(page, prediction, homeTeamName, awayTeamName);

      const matchId = match.url.match(/\/cricket-live-score\/([A-Za-z0-9-]+)/i);

      // Build the match data with all fields
      const matchData = {
        match_id: matchId ? matchId[1] : `live_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        match_url: match.url,
        series: {
          id: `series_${Date.now()}`,
          name: series || match.series || 'Unknown Series',
          short_name: series ? series.substring(0, 20) : '',
          season: new Date().getFullYear().toString(),
        },
        match: {
          number: matchFormat.number || null,
          format: matchFormat.format || null,
          status: matchStatus || 'Live',
          start_time: startTime || null,
          current_innings: currentInnings || null,
          current_ball: currentBall || null,
        },
        venue: {
          id: `venue_${Date.now()}`,
          name: venue || null,
        },
        teams: {
          home: {
            id: homeId,
            name: homeTeamName,
            short_name: homeShort,
            logo: homeLogo,
          },
          away: {
            id: awayId,
            name: awayTeamName,
            short_name: awayShort,
            logo: awayLogo,
          },
        },
        scoreboard: {
          batting_team: {
            name: scoreboard.batting.name || homeTeamName,
            score: scoreboard.batting.score || match.team1.score || '',
            runs: scoreboard.batting.runs,
            wickets: scoreboard.batting.wickets,
            overs: scoreboard.batting.overs || match.team1.overs || '',
            balls: scoreboard.batting.balls || null,
          },
          bowling_team: {
            name: scoreboard.bowling.name || awayTeamName,
            score: scoreboard.bowling.score || match.team2.score || '',
            runs: scoreboard.bowling.runs,
            wickets: scoreboard.bowling.wickets,
            overs: scoreboard.bowling.overs || match.team2.overs || '',
            balls: scoreboard.bowling.balls || null,
          },
          target: scoreboard.target,
          required_runs: scoreboard.required.runs,
          required_balls: scoreboard.required.balls,
          crr: scoreboard.crr,
          rrr: scoreboard.rrr,
          current_ball: currentBall || null,
          full_scorecard: fullScorecard,
        },
        current_batsmen: this.deduplicateBatsmen(currentBatsmen || []),
        yet_to_bat: yetToBat || [],
        current_bowler: currentBowler || { name: '', overs: '', runs: null, wickets: null },
        last_ball: lastBall || { ball: null, value: null, event: null, isWicket: false },
        overs: await this.extractOversTimeline(page),
        commentary: this.deduplicateCommentary(commentary || []),
        prediction: prediction || { home_probability: null, away_probability: null, projected_scores: [] },
        odds: odds,
        toss: toss || { status: 'unknown', winner: null, decision: null },
        result: null,
        weather: null,
        countdown: null,
        _lastUpdated: new Date().toISOString(),
        _updateCount: 1,
      };

      logger.info(`   📊 ${agentId} extracted: ${matchData.teams.home.name} ${matchData.scoreboard.batting_team.score || '0'} vs ${matchData.teams.away.name} ${matchData.scoreboard.bowling_team.score || '0'}`);

      // Try to get weather
      if (matchData.venue?.name) {
        try {
          const weather = await this.getWeatherForVenue(
            matchData.venue.name,
            matchData.series?.name || '',
            '',
            matchData.teams.home.name,
            matchData.teams.away.name,
            match.url
          );
          if (weather) {
            matchData.weather = weather;
          }
        } catch (e) {}
      }

      return this.validateMatchData(matchData);
    } catch (error) {
      logger.error(`   ❌ ${agentId} error: ${error.message}`);
      return this.createFallbackMatch(match);
    }
  }

  // ============================================================
  // ⭐ VALIDATION PIPELINE
  // ============================================================
  validateMatchData(match) {
    if (!match) return match;

    // 0. Team Name & Toss Sanitization (Strict Data Protection & Cross-Inference)
    if (match.teams) {
      if (match.teams.home && match.teams.home.name) {
        match.teams.home.name = this.cleanTeamName(match.teams.home.name);
      }
      if (match.teams.away && match.teams.away.name) {
        match.teams.away.name = this.cleanTeamName(match.teams.away.name);
      }
    }
    if (match.scoreboard) {
      if (match.scoreboard.batting_team && match.scoreboard.batting_team.name) {
        match.scoreboard.batting_team.name = this.cleanTeamName(match.scoreboard.batting_team.name);
      }
      if (match.scoreboard.bowling_team && match.scoreboard.bowling_team.name) {
        match.scoreboard.bowling_team.name = this.cleanTeamName(match.scoreboard.bowling_team.name);
      }
      
      // Cross-infer bowling team name if empty or identical to batting team name
      const bName = match.scoreboard.batting_team?.name;
      const hName = match.teams?.home?.name;
      const aName = match.teams?.away?.name;
      if (bName && hName && aName) {
        if (!match.scoreboard.bowling_team.name || match.scoreboard.bowling_team.name === bName) {
          match.scoreboard.bowling_team.name = (bName === hName) ? aName : hName;
        }
      }
    }
    if (match.toss) {
      if (match.toss.status) {
        match.toss.status = String(match.toss.status).replace(/<[^>]*>/g, '').trim();
        if (/need\s*\d+\s*runs/i.test(match.toss.status) || /crr/i.test(match.toss.status) || /trail\s+by|lead\s+by/i.test(match.toss.status)) {
          match.toss.status = match.toss.winner ? 'completed' : 'unknown';
        }
      }
      if (match.toss.winner) {
        match.toss.winner = String(match.toss.winner).replace(/<[^>]*>/g, '').trim();
      }
      if (match.toss.decision) {
        match.toss.decision = String(match.toss.decision).replace(/<[^>]*>/g, '').trim();
      }
    }

    // 0b. Current Ball Cross-Field Sync & Last Ball Consistency
    if (match.last_ball) {
      const forbiddenEvents = [
        'players entering', 'players walking in', 'innings break', 'opt to bat', 'opt to bowl',
        'won the toss', 'won toss', 'trail by', 'lead by', 'day ', 'session ', 'local time',
        'match delayed', 'rain delay', 'stumps', 'tea', 'lunch', 'scheduled'
      ];

      if (match.last_ball.event && forbiddenEvents.some(term => match.last_ball.event.toLowerCase().includes(term))) {
        let recovered = false;
        if (match.commentary && match.commentary.length > 0) {
          const firstComm = match.commentary.find(c => c.ball && /^(?:\d+\.[1-6]|\d+b)$/.test(c.ball));
          if (firstComm) {
            match.last_ball.ball = firstComm.ball;
            match.last_ball.value = firstComm.result;
            match.last_ball.event = firstComm.result === 'W' ? 'Wicket' : (firstComm.result === '4' ? 'FOUR' : (firstComm.result === '6' ? 'SIX' : firstComm.result));
            match.last_ball.isWicket = firstComm.isWicket;
            recovered = true;
          }
        }
        if (!recovered) {
          match.last_ball.event = null;
        }
      }

      if (!match.last_ball.ball && (!match.last_ball.value || match.last_ball.value === '0')) {
        match.last_ball.ball = null;
        match.last_ball.value = null;
        match.last_ball.event = null;
        match.last_ball.isWicket = false;
      }

      if (match.last_ball.value === 'W' || match.last_ball.value === 'WICKET') {
        match.last_ball.isWicket = true;
      } else if (match.last_ball.value === 'wd' || match.last_ball.value === 'nb') {
        match.last_ball.isWicket = false;
      }

      // Apply standard event normalization
      if (match.last_ball.value !== null) {
        match.last_ball.event = this.normalizeLastBallEvent(match.last_ball.value, match.last_ball.isWicket);
      }
      
      if (!match.scoreboard.current_ball && match.last_ball.ball) {
        match.scoreboard.current_ball = match.last_ball.ball;
      }
      if (match.match && !match.match.current_ball && match.last_ball.ball) {
        match.match.current_ball = match.last_ball.ball;
      }
    }

    // 1. Current Ball Validation
    if (match.scoreboard && match.scoreboard.current_ball) {
      const cb = String(match.scoreboard.current_ball).trim();
      let isValidBall = false;

      if (/^\d+\.[1-6]$/.test(cb)) {
        isValidBall = true;
      }
      else if (/^\d+b?$/.test(cb)) {
        const val = parseInt(cb);
        if (val >= 0 && val <= 125) {
          isValidBall = true;
        }
      }

      if (!isValidBall) {
        logger.warn(`⚠️ Invalid current ball detected: "${cb}". Setting to null.`);
        match.scoreboard.current_ball = null;
        if (match.match) {
          match.match.current_ball = null;
        }
      }
    }

    // 2. Format Validation
    if (match.match) {
      const titleText = `${match.series?.name || ''} ${match.teams?.home?.name || ''} vs ${match.teams?.away?.name || ''}`.toLowerCase();
      let detectedFormat = match.match.format;

      if (titleText.includes('t20') || titleText.includes('twenty20')) {
        detectedFormat = 'T20';
      } else if (titleText.includes('odi') || titleText.includes('one day')) {
        detectedFormat = 'ODI';
      } else if (titleText.includes('test') || titleText.includes('5-day')) {
        detectedFormat = 'Test';
      } else if (titleText.includes('hundred') || titleText.includes('100-ball') || titleText.includes('100b')) {
        detectedFormat = 'The Hundred';
      } else if (titleText.includes('t10') || titleText.includes('ten10')) {
        detectedFormat = 'T10';
      }

      if (detectedFormat && detectedFormat !== match.match.format) {
        logger.info(`📋 Correcting format from "${match.match.format}" to "${detectedFormat}" based on context`);
        match.match.format = detectedFormat;
      }
    }

    // 3. Scoreboard Validation & Clean Up
    if (match.scoreboard) {
      const cleanScore = (teamScore) => {
        if (!teamScore) return teamScore;
        const scoreStr = String(teamScore).trim();
        if (/^[0-9]-\d+$/.test(scoreStr)) {
          const parts = scoreStr.split('-');
          const w = parseInt(parts[0]);
          const r = parseInt(parts[1]);
          if (match.current_bowler && match.current_bowler.runs === r && match.current_bowler.wickets === w) {
            return '';
          }
          if (w < r) {
            return '';
          }
        }
        return teamScore;
      };

      if (match.scoreboard.bowling_team) {
        const oldScore = match.scoreboard.bowling_team.score;
        const newScore = cleanScore(oldScore);
        if (oldScore && !newScore) {
          logger.warn(`⚠️ Corrected bowling team score from "${oldScore}" (bowler figures) to empty string`);
          match.scoreboard.bowling_team.score = '';
          match.scoreboard.bowling_team.runs = null;
          match.scoreboard.bowling_team.wickets = null;
          match.scoreboard.bowling_team.overs = '';
        }
      }
    }

    // 4. Current Batsmen Validation & Single Striker Enforcer
    if (match.current_batsmen) {
      match.current_batsmen = match.current_batsmen.filter(player => {
        if (!player || !player.name) return false;
        const name = String(player.name).trim();
        
        const isInvalid = /^\d+$/.test(name) || 
                          /^\d+\.\d+$/.test(name) || 
                          /%/.test(name) || 
                          /crr/i.test(name) || 
                          /rrr/i.test(name) || 
                          /over/i.test(name);
        
        if (isInvalid) {
          logger.warn(`⚠️ Rejecting invalid current batsman name: "${name}"`);
          return false;
        }
        return true;
      });

      if (match.current_batsmen.length >= 2) {
        const strikerCount = match.current_batsmen.filter(b => b.is_striker).length;
        if (strikerCount === 0 || strikerCount > 1) {
          logger.warn(`⚠️ Normalizing striker states: found ${strikerCount} strikers. Setting 1st as striker, 2nd as non-striker.`);
          match.current_batsmen[0].is_striker = true;
          match.current_batsmen[1].is_striker = false;
        }
      }
    }

    // 5. Current Bowler Validation
    if (match.current_bowler) {
      const bName = String(match.current_bowler.name).trim();
      const isInvalid = !bName ||
                        /^\d+$/.test(bName) || 
                        /^\d+\.\d+$/.test(bName) || 
                        /%/.test(bName) || 
                        /crr/i.test(bName) || 
                        /rrr/i.test(bName) || 
                        /over/i.test(bName);

      if (isInvalid) {
        logger.warn(`⚠️ Rejecting invalid current bowler name: "${bName}"`);
        match.current_bowler = { name: '', overs: '', runs: null, wickets: null };
      } else {
        const isBatsman = match.current_batsmen && match.current_batsmen.some(batsman => batsman.name === bName);
        if (isBatsman) {
          logger.warn(`⚠️ Current bowler "${bName}" is also active batsman. Nullifying bowler.`);
          match.current_bowler = { name: '', overs: '', runs: null, wickets: null };
        }
      }
    }

    // 6. Projected Scores Validation
    if (match.prediction && match.prediction.projected_scores) {
      match.prediction.projected_scores = match.prediction.projected_scores.filter(proj => {
        const rate = proj.rate;
        const runs = proj.projected_runs;
        const isYear = rate === 2017 || rate === 2025 || rate === 2026 || rate === 2027;
        const isInvalid = isYear || rate <= 0 || rate > 50 || runs <= 0 || runs > 1000;
        if (isInvalid) {
          logger.warn(`⚠️ Rejecting invalid projected score: rate=${rate}, runs=${runs}`);
          return false;
        }
        return true;
      });
    }

    // 7. Commentary Clean Up
    if (match.commentary) {
      match.commentary = match.commentary.filter(item => {
        if (!item || !item.text) return false;
        // Filter out rate tables or concatenated number noise
        if (/^\*?\s*\d+\.\d{2}\s*\d+\.\d{2}/.test(item.text) || /^\d{4,}/.test(item.text)) {
          logger.warn(`⚠️ Rejecting commentary contamination text: "${item.text}"`);
          return false;
        }
        return true;
      });
    }

    // 8. Venue Cleanup & Contamination Check
    if (match.venue && match.venue.name) {
      let vName = String(match.venue.name).trim();
      vName = vName.replace(/^(?:It has started drizzling at|Rain stops play at|Play starts at|Match scheduled at|at|in)\s+/i, '');
      if (vName.includes('talking') || vName.includes('outfield') || vName.length > 80 || /^\d+$/.test(vName)) {
        logger.warn(`⚠️ Rejecting contaminated venue text: "${vName}"`);
        match.venue.name = null;
      }
    }

    // 9. Run Live Match Consistency Check & Log Validation Errors
    this.validateLiveMatchConsistency(match);

    return match;
  }

  validateLiveMatchConsistency(match) {
    if (!match) return;

    const matchId = match.match_id || 'unknown';

    // 1. Home ID vs Away ID
    if (match.teams?.home?.id && match.teams?.away?.id && match.teams.home.id === match.teams.away.id) {
      logger.error(`[CREX VALIDATION ERROR] Match ID: ${matchId} | Field: teams.home.id vs teams.away.id | Value: "${match.teams.home.id}" | Expected: Different Team IDs | DOM selector used: .team-1, .team-2`);
    }

    // 2. Home Name vs Away Name
    if (match.teams?.home?.name && match.teams?.away?.name && match.teams.home.name === match.teams.away.name) {
      logger.error(`[CREX VALIDATION ERROR] Match ID: ${matchId} | Field: teams.home.name vs teams.away.name | Value: "${match.teams.home.name}" | Expected: Different Team Names | DOM selector used: .team-1 .team-name, .team-2 .team-name`);
    }

    // 3. Batting vs Bowling Team Name
    if (match.scoreboard?.batting_team?.name && match.scoreboard?.bowling_team?.name && match.scoreboard.batting_team.name === match.scoreboard.bowling_team.name) {
      logger.error(`[CREX VALIDATION ERROR] Match ID: ${matchId} | Field: scoreboard.batting_team.name vs bowling_team.name | Value: "${match.scoreboard.batting_team.name}" | Expected: Batting and Bowling Teams must be opposite | DOM selector used: .team-inning`);
    }

    // 4. Team Name Contamination Check
    const forbiddenTeamTerms = ['CRR', 'RRR', 'runs', 'balls', 'required', 'target', 'trail', 'lead', 'opt to', 'won the toss'];
    const checkTeamHygiene = (teamName, fieldName) => {
      if (!teamName) return;
      for (const term of forbiddenTeamTerms) {
        if (teamName.toLowerCase().includes(term.toLowerCase())) {
          logger.error(`[CREX VALIDATION ERROR] Match ID: ${matchId} | Field: ${fieldName} | Value: "${teamName}" | Expected: Clean Team Name without "${term}" | DOM selector used: .team-name`);
        }
      }
    };
    checkTeamHygiene(match.teams?.home?.name, 'teams.home.name');
    checkTeamHygiene(match.teams?.away?.name, 'teams.away.name');
    checkTeamHygiene(match.scoreboard?.batting_team?.name, 'scoreboard.batting_team.name');

    // 5. Score / Runs / Wickets Agreement
    if (match.scoreboard?.batting_team) {
      const { score, runs, wickets } = match.scoreboard.batting_team;
      if (score === '0/0' && runs === 0 && wickets === 0 && match.match?.status !== 'Upcoming' && match.scoreboard.current_ball) {
        logger.error(`[CREX VALIDATION ERROR] Match ID: ${matchId} | Field: scoreboard.batting_team.score | Value: "0/0" | Expected: Valid score for ongoing match | DOM selector used: .runs.f-runs`);
      }
    }

    // 6. Last Ball Delivery Hygiene & Toss Leak Check
    if (match.last_ball) {
      const forbiddenEvents = [
        'players entering', 'players walking in', 'innings break', 'opt to bat', 'opt to bowl',
        'won the toss', 'won toss', 'trail by', 'lead by', 'day ', 'session ', 'local time'
      ];
      if (match.last_ball.event && forbiddenEvents.some(term => match.last_ball.event.toLowerCase().includes(term))) {
        logger.error(`[CREX VALIDATION ERROR] Match ID: ${matchId} | Field: last_ball.event | Value: "${match.last_ball.event}" | Expected: Real delivery result | DOM selector used: .result-box`);
      }
      if (match.last_ball.ball === null && match.last_ball.value !== null) {
        logger.error(`[CREX VALIDATION ERROR] Match ID: ${matchId} | Field: last_ball.value | Value: "${match.last_ball.value}" | Expected: null when ball is null | DOM selector used: .result-box`);
      }
    }

    // 7. Toss Status Match Status Contamination
    if (match.toss?.status && /trail\s+by|lead\s+by|need|crr|rrr|target|runs|balls/i.test(match.toss.status)) {
      logger.error(`[CREX VALIDATION ERROR] Match ID: ${matchId} | Field: toss.status | Value: "${match.toss.status}" | Expected: "completed" or "unknown" | DOM selector used: .toss-wrap`);
    }
  }

  normalizeLastBallEvent(val, isWicket) {
    if (isWicket || val === 'W' || val === 'WICKET') return 'wicket';
    if (!val) return null;
    const cleanVal = String(val).trim().toLowerCase();
    switch (cleanVal) {
      case '0': return 'dot ball';
      case '1': return 'single';
      case '2': return 'two runs';
      case '3': return 'three runs';
      case '4': case 'four': return 'four';
      case '6': case 'six': return 'six';
      case 'wd': case 'wide': return 'wide';
      case 'nb': case 'no ball': case 'no-ball': return 'no-ball';
      case 'lb': case 'leg bye': case 'leg-bye': return 'leg bye';
      case 'b': case 'bye': return 'bye';
      default: return cleanVal;
    }
  }

  // ============================================================
  // ⭐ DEDUPLICATION HELPERS
  // ============================================================
  deduplicateBatsmen(batsmen) {
    if (!batsmen || batsmen.length === 0) return [];

    const seen = new Set();
    const unique = [];

    for (const b of batsmen) {
      const key = b.name;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push({
          name: b.name,
          runs: b.runs,
          balls: b.balls,
          is_striker: b.is_striker || null
        });
      }
    }

    // Ensure mutually exclusive striker status if two active batsmen exist
    if (unique.length === 2) {
      if (unique[0].is_striker === true && unique[1].is_striker === true) {
        unique[1].is_striker = false;
      } else if (unique[0].is_striker === true && unique[1].is_striker === null) {
        unique[1].is_striker = false;
      } else if (unique[1].is_striker === true && unique[0].is_striker === null) {
        unique[0].is_striker = false;
      }
    }

    return unique;
  }

  deduplicateCommentary(commentary) {
    if (!commentary || commentary.length === 0) return [];

    const seen = new Set();
    const unique = [];

    for (const item of commentary) {
      const key = `${item.ball}|${item.result}|${item.text}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    }

    return unique;
  }

  // ============================================================
  // ⭐ FALLBACK MATCH
  // ============================================================
  createFallbackMatch(discovered) {
    return {
      match_id: `live_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      match_url: discovered.url,
      series: {
        id: `series_${Date.now()}`,
        name: discovered.series || 'Unknown Series',
        short_name: '',
        season: new Date().getFullYear().toString(),
      },
      match: {
        number: null,
        format: null,
        status: 'Live',
        start_time: null,
        current_innings: null,
        current_ball: null,
      },
      venue: {
        id: `venue_${Date.now()}`,
        name: null,
      },
      teams: {
        home: {
          id: this.getTeamId(discovered.team1.name),
          name: discovered.team1.name || 'Team 1',
          short_name: discovered.team1.short || 'T1',
          logo: discovered.team1.flag || '',
        },
        away: {
          id: this.getTeamId(discovered.team2.name),
          name: discovered.team2.name || 'Team 2',
          short_name: discovered.team2.short || 'T2',
          logo: discovered.team2.flag || '',
        },
      },
      scoreboard: {
        batting_team: {
          name: discovered.team1.name,
          score: discovered.team1.score || '',
          runs: null,
          wickets: null,
          overs: discovered.team1.overs || '',
          balls: null,
        },
        bowling_team: {
          name: discovered.team2.name,
          score: discovered.team2.score || '',
          runs: null,
          wickets: null,
          overs: discovered.team2.overs || '',
          balls: null,
        },
        target: null,
        required_runs: null,
        required_balls: null,
        crr: null,
        rrr: null,
        current_ball: null,
      },
      current_batsmen: [],
      current_bowler: { name: '', overs: '', runs: null, wickets: null },
      overs: [],
      commentary: [],
      prediction: { home_probability: null, away_probability: null, projected_scores: [] },
      toss: { status: 'unknown', winner: null, decision: null },
      result: null,
      weather: null,
      countdown: null,
    };
  }

  // ============================================================
  // ⭐ DISCOVER LIVE MATCHES
  // ============================================================
  async discoverLiveMatches() {
    logger.info('🔍 Phase 1: Discovering live matches...');

    const url = this.selectors.PAGE_URL || 'https://crex.com/cricket-live-score';

    if (!this.isBrowserInitialized || !this.page || this.page.isClosed()) {
      logger.warn('⚠️ Browser not initialized, initializing now...');
      await this.initializeBrowser();
      if (!this.page) {
        logger.error('❌ Failed to initialize page');
        return [];
      }
    }

    try {
      logger.info(`📡 Navigating to: ${url}`);

      let navSuccess = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          navSuccess = true;
          break;
        } catch (navError) {
          logger.warn(`⚠️ Navigation attempt ${attempt} failed: ${navError.message}`);
          
          const isCrash = navError.message.toLowerCase().includes('crash') || 
                          navError.message.toLowerCase().includes('detached') || 
                          navError.message.toLowerCase().includes('closed');
          if (isCrash) {
            logger.warn('⚠️ Page or browser crashed, restarting browser...');
            try {
              if (this.page) await this.page.close().catch(() => {});
            } catch (e) {}
            this.page = null;
            this.isBrowserInitialized = false;
            
            await this.browserManager.restart().catch(err => logger.error(`Failed to restart browser manager: ${err.message}`));
            await this.initializeBrowser().catch(() => {});
          }
          
          if (attempt < 2) {
            await this.sleep(2000 * attempt);
          }
        }
      }

      if (!navSuccess) {
        logger.error('❌ Failed to navigate after 2 attempts');
        return [];
      }

      await this.sleep(200);

      try {
        await this.page.waitForSelector('.live-card, .match-card, .team-innig, .team-result', {
          timeout: 8000,
        });
      } catch (e) {
        logger.warn('⚠️ No match indicators found, waiting for page to settle...');
        await this.sleep(500);
      }

      await this.sleep(100);
    } catch (error) {
      logger.error(`❌ Failed to load live matches page: ${error.message}`);
      return [];
    }

    const selectors = [
      '.live-card', '.live-score-card', '.match-card', '.match-container',
      '.team-result', '.team-content', '.teamProfile', '.team-innig',
      '.score-card', '.match-item', '.live-match-item', '.match-row',
    ];

    let foundCards = [];

    for (const selector of selectors) {
      try {
        const elements = await this.page.$$(selector);
        if (elements && elements.length > 0) {
          foundCards = elements;
          logger.info(`✅ Found ${elements.length} elements with selector: ${selector}`);
          break;
        }
      } catch (error) {
        logger.debug(`  ⚠️ Error with selector "${selector}": ${error.message}`);
      }
    }

    if (foundCards.length === 0) {
      logger.warn('❌ No live match cards found with any selector');
      return [];
    }

    try {
      const discoveredMatches = await this.page.evaluate((cards) => {
        const matches = [];
        const seenUrls = new Set();

        const getText = (el) => (el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');
        const cleanText = (text) => (text ? text.replace(/\s+/g, ' ').trim() : '');

        const isValidTeamName = (name) => {
          if (!name) return false;
          const trimmed = name.trim();
          if (trimmed.length < 2 || trimmed.length > 30) return false;

          const validTeamNames = new Set([
            'ODW', 'SDS', 'TYP-W', 'DG-W', 'MKL', 'CW', 'AC', 'BL', 'JS',
            'KK', 'SS', 'LS', 'MIL', 'PD', 'NDT', 'RNH', 'SR', 'SRL', 'BP', 'LBW',
            'London Spirit', 'MI London', 'Manchester Originals', 'Sunrisers Leeds',
            'Birmingham Phoenix', 'India', 'England', 'Australia', 'Pakistan',
            'New Zealand', 'South Africa', 'West Indies', 'Sri Lanka', 'Bangladesh',
            'Afghanistan', 'Zimbabwe', 'Ireland', 'Nepal', 'Namibia', 'Guyana',
            'Jaffna Kings', 'Galle Gallants', 'Dambulla Sixers', 'Kandy Falcons',
            'Colombo Kaps', 'Kandy Royals', 'Worcestershire', 'Derbyshire',
            'Lahore Qalandars', 'Perth Scorchers', 'Guyana Amazon Warriors',
            'San Francisco Unicorns', 'BP-W', 'TR-W', 'GLCS', 'SOM',
          ]);

          for (const valid of validTeamNames) {
            if (trimmed === valid || trimmed.includes(valid) || valid.includes(trimmed)) {
              return true;
            }
          }

          const invalidNames = [
            'Caught Out', 'Innings Break', 'Not Started', 'Live', 'Match',
            'Over', 'Wicket', 'Run', 'Ball', 'Striker', 'Bowler',
            'Toss', 'Commentary', 'Highlights', 'Scorecard', 'Discussions',
            'Points Table', 'Projected Score', 'Milestone', 'Local Time',
            'LBW Out',
          ];
          for (const invalid of invalidNames) {
            if (trimmed === invalid || trimmed.includes(invalid)) return false;
          }

          return true;
        };

        const getMatchUrl = (card) => {
          const links = card.querySelectorAll('a[href*="cricket-live-score"]');
          for (const link of links) {
            const href = link.getAttribute('href');
            if (href && href.includes('cricket-live-score')) {
              if (href.startsWith('https://')) return href;
              if (href.startsWith('/')) return `https://crex.com${href}`;
              return `https://crex.com/${href}`;
            }
          }
          return '';
        };

        const getTeamShortName = (name) => {
          const map = {
            India: 'IND', England: 'ENG', Australia: 'AUS', Pakistan: 'PAK',
            'New Zealand': 'NZ', 'South Africa': 'SA', 'West Indies': 'WI',
            'Sri Lanka': 'SL', Bangladesh: 'BAN', Afghanistan: 'AFG',
            Zimbabwe: 'ZIM', Ireland: 'IRE', Nepal: 'NEP', Namibia: 'NAM',
            'London Spirit': 'LS', 'MI London': 'MIL',
            'Manchester Originals': 'MIL', 'Sunrisers Leeds': 'SRL',
            'Birmingham Phoenix': 'BP', 'Southern Brave': 'SB',
            'Welsh Fire': 'WF', 'Trent Rockets': 'TR',
            'Oval Invincibles': 'OI', 'Northern Superchargers': 'NS',
          };
          return map[name] || name.substring(0, 3).toUpperCase();
        };

        cards.forEach((card) => {
          const cardText = getText(card);

          if (cardText.includes('Advertisement') || cardText.includes('News') ||
              cardText.includes('Video') || cardText.includes('Photo') || cardText.includes('Podcast')) {
            return;
          }

          const matchUrl = getMatchUrl(card);
          if (!matchUrl) return;

          const urlKey = matchUrl.split('?')[0];
          if (seenUrls.has(urlKey)) return;
          seenUrls.add(urlKey);

          let team1Name = '';
          let team2Name = '';
          let team1Score = '';
          let team1Wickets = '';
          let team1Overs = '';
          let team2Score = '';
          let team2Wickets = '';
          let team2Overs = '';

          const vsMatch = cardText.match(/([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)/i);
          if (vsMatch) {
            const t1 = cleanText(vsMatch[1]);
            const t2 = cleanText(vsMatch[2]);
            if (isValidTeamName(t1) && isValidTeamName(t2)) {
              team1Name = t1;
              team2Name = t2;
            }
          }

          if (!team1Name || !team2Name) {
            const teamSelectors = ['.team-name', '.teamName', '.name', '.team', '.cb-team-name'];
            const teamNames = [];

            for (const selector of teamSelectors) {
              const elements = card.querySelectorAll(selector);
              elements.forEach((el) => {
                const text = cleanText(getText(el));
                if (text && text.length > 1 && text.length < 30 && !text.includes('vs')) {
                  if (isValidTeamName(text)) {
                    teamNames.push(text);
                  }
                }
              });
              if (teamNames.length >= 2) break;
            }

            if (teamNames.length >= 2) {
              team1Name = teamNames[0];
              team2Name = teamNames[1];
            }
          }

          if (!team1Name || !team2Name) {
            const urlTeams = matchUrl.match(/\/([A-Za-z0-9-]+)-vs-([A-Za-z0-9-]+)/);
            if (urlTeams) {
              const t1 = urlTeams[1].toUpperCase();
              const t2 = urlTeams[2].toUpperCase();
              if (isValidTeamName(t1) && isValidTeamName(t2)) {
                team1Name = t1;
                team2Name = t2;
              }
            }
          }

          if (!team1Name || !team2Name) return;

          const flags = [];
          const flagImages = card.querySelectorAll('img[src*="Teams"], img[src*="cricketvectors"], .team-flag img, .flag img');
          flagImages.forEach((img) => {
            const src = img.getAttribute('src') || '';
            if (src && (src.includes('Teams') || src.includes('cricketvectors'))) {
              flags.push(src);
            }
          });

          const scoreElements = card.querySelectorAll('.score, .team-score, .runs, .score-text, .match-score');
          const oversElements = card.querySelectorAll('.overs, .over, .overs-text, .match-overs');

          if (scoreElements.length >= 2) {
            const score1Text = cleanText(getText(scoreElements[0]));
            const score2Text = cleanText(getText(scoreElements[1]));

            const score1Match = score1Text.match(/(\d+)[-/](\d+)/);
            if (score1Match) {
              team1Score = score1Match[1];
              team1Wickets = score1Match[2];
            }

            const score2Match = score2Text.match(/(\d+)[-/](\d+)/);
            if (score2Match) {
              team2Score = score2Match[1];
              team2Wickets = score2Match[2];
            }
          }

          if (oversElements.length >= 2) {
            team1Overs = cleanText(getText(oversElements[0])).replace(/[()]/g, '');
            team2Overs = cleanText(getText(oversElements[1])).replace(/[()]/g, '');
          }

          let series = '';
          const seriesSelectors = [
            '.series-name', '.snameTag', '.match-series', '.series-title',
            '.tournament', '.series',
          ];
          for (const selector of seriesSelectors) {
            const el = card.querySelector(selector);
            if (el) {
              series = cleanText(getText(el));
              break;
            }
          }

          if (team1Name && team2Name && isValidTeamName(team1Name) && isValidTeamName(team2Name)) {
            matches.push({
              url: matchUrl,
              status: 'LIVE',
              team1: {
                name: team1Name,
                short: getTeamShortName(team1Name),
                flag: flags[0] || '',
                score: team1Score,
                wickets: team1Wickets,
                overs: team1Overs,
              },
              team2: {
                name: team2Name,
                short: getTeamShortName(team2Name),
                flag: flags[1] || '',
                score: team2Score,
                wickets: team2Wickets,
                overs: team2Overs,
              },
              series: series,
            });
          }
        });

        return matches;
      }, foundCards);

      if (!discoveredMatches || !Array.isArray(discoveredMatches)) {
        logger.warn('⚠️ discoverLiveMatches returned undefined or null, returning empty array');
        return [];
      }

      logger.info(`✅ Discovered ${discoveredMatches.length} live matches`);

      if (discoveredMatches.length > 0) {
        discoveredMatches.forEach((match, index) => {
          logger.info(
            `  ${index + 1}. ${match.team1.name} (${match.team1.score}/${match.team1.wickets}) vs ${match.team2.name} (${match.team2.score}/${match.team2.wickets})`
          );
        });
      }

      return discoveredMatches;
    } catch (error) {
      logger.error(`❌ Error in discoverLiveMatches evaluate: ${error.message}`);
      return [];
    }
  }

  // ============================================================
  // ⭐ LOGGING
  // ============================================================
  logAgentStatistics() {
    if (Object.keys(this.agentStats).length === 0) return;
    logger.info(`   🤖 Agent Stats:`);
    for (const [agentId, stats] of Object.entries(this.agentStats)) {
      const successRate = stats.total > 0 ? Math.round((stats.succeeded / stats.total) * 100) : 0;
      logger.info(`      ${agentId}: ${stats.succeeded}/${stats.total} (${successRate}%)`);
    }
  }

  logStatistics() {
    logger.info(`📊 Live Scraper Statistics:`);
    logger.info(`   Discovered: ${this.stats.discovered}`);
    logger.info(`   Detailed extracted: ${this.stats.detailed}`);
    logger.info(`   Weather Success: ${this.stats.weatherSuccess}`);
    logger.info(`   Weather Failed: ${this.stats.weatherFailed}`);
    logger.info(`   Errors: ${this.stats.errors}`);
  }

  // ============================================================
  // ⭐ MAIN SCRAPE METHOD
  // ============================================================
  async scrapeLive(forceRefresh = true) {
    if (this._isScraping) {
      const lockAge = Date.now() - (this._scrapeLockTime || Date.now());
      if (lockAge < 120000) {
        logger.warn(
          `⚠️ Scrape already in progress (${Math.round(lockAge / 1000)}s), returning existing promise`
        );
        if (this._scrapePromise) {
          return this._scrapePromise;
        }
        return {
          success: false,
          source: 'crex',
          type: 'live',
          timestamp: new Date().toISOString(),
          data: [],
          total: 0,
          error: 'Scrape already in progress',
          duration: 0,
        };
      } else {
        this.forceReleaseLock();
      }
    }

    const scrapeId = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const lockAcquired = await this.acquireLock(scrapeId);
    if (!lockAcquired) {
      if (this._scrapePromise) {
        return this._scrapePromise;
      }
      return {
        success: false,
        source: 'crex',
        type: 'live',
        timestamp: new Date().toISOString(),
        data: [],
        total: 0,
        error: 'Could not acquire lock',
        duration: 0,
        scrapeId: scrapeId,
      };
    }

    this._scrapePromise = this._executeScrape(scrapeId);

    try {
      const result = await this._scrapePromise;
      this._scrapePromise = null;
      return result;
    } catch (error) {
      this._scrapePromise = null;
      this.forceReleaseLock();
      throw error;
    }
  }

  async _executeScrape(scrapeId) {
    this.scrapeStartTime = Date.now();

    try {
      logger.info(`🚀 [${scrapeId}] Starting live matches scraper`);

      const browserOk = await this.initializeBrowser();
      if (!browserOk || !this.page) {
        logger.error(`❌ [${scrapeId}] Failed to initialize browser`);
        this.forceReleaseLock();
        return {
          success: false,
          source: 'crex',
          type: 'live',
          timestamp: new Date().toISOString(),
          data: [],
          total: 0,
          error: 'Browser initialization failed',
          duration: Date.now() - this.scrapeStartTime,
          scrapeId: scrapeId,
        };
      }

      this.processedUrls.clear();
      this.agentResults = [];
      this.agentStats = {};
      this.activeAgents = 0;

      const discoveredMatches = await this.discoverLiveMatches();

      if (!discoveredMatches || !Array.isArray(discoveredMatches)) {
        logger.warn(`⚠️ [${scrapeId}] Discovered matches is not an array, using empty array`);
        this.stats.discovered = 0;
        this.forceReleaseLock();
        return {
          success: true,
          source: 'crex',
          type: 'live',
          timestamp: new Date().toISOString(),
          data: [],
          total: 0,
          duration: Date.now() - this.scrapeStartTime,
          cacheBuster: Date.now(),
          scrapeId: scrapeId,
        };
      }

      this.stats.discovered = discoveredMatches.length;

      if (discoveredMatches.length === 0) {
        logger.info(`📢 [${scrapeId}] No live matches currently in progress`);
        this.forceReleaseLock();
        return {
          success: true,
          source: 'crex',
          type: 'live',
          timestamp: new Date().toISOString(),
          data: [],
          total: 0,
          duration: Date.now() - this.scrapeStartTime,
          cacheBuster: Date.now(),
          scrapeId: scrapeId,
        };
      }

      const uniqueMatches = [];
      const seenUrls = new Set();
      for (const match of discoveredMatches) {
        const urlKey = match.url.split('?')[0];
        if (!seenUrls.has(urlKey)) {
          seenUrls.add(urlKey);
          uniqueMatches.push(match);
        }
      }

      const duplicateCount = discoveredMatches.length - uniqueMatches.length;
      logger.info(
        `📋 [${scrapeId}] Found ${uniqueMatches.length} unique live matches (removed ${duplicateCount} duplicates)`
      );

      const fullMatches = await this.processWithAgents(uniqueMatches);
      this.stats.detailed = fullMatches.length;

      logger.info(
        `📋 [${scrapeId}] Phase 2 complete: Extracted details for ${fullMatches.length} live matches`
      );

      await this.closeBrowser();
      this.logStatistics();
      this.logAgentStatistics();

      const result = {
        success: true,
        source: 'crex',
        type: 'live',
        timestamp: new Date().toISOString(),
        data: fullMatches,
        total: fullMatches.length,
        duration: Date.now() - this.scrapeStartTime,
        cacheBuster: Date.now(),
        scrapeId: scrapeId,
      };

      if (fullMatches.length > 0) {
        deepLog(`📋 SAMPLE LIVE MATCH - First match in detail`, fullMatches[0]);
      }

      this.forceReleaseLock();
      return result;
    } catch (error) {
      logger.error(`❌ [${scrapeId}] LiveScraper error: ${error.message}`);
      logger.error(error.stack);
      await this.closeBrowser();
      this.forceReleaseLock();

      return {
        success: false,
        source: 'crex',
        type: 'live',
        timestamp: new Date().toISOString(),
        data: [],
        total: 0,
        error: error.message,
        duration: Date.now() - this.scrapeStartTime,
        scrapeId: scrapeId,
      };
    }
  }
}

module.exports = LiveScraper;
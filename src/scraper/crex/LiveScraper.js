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

    this.numberOfAgents = 4;
    this.agentStaggerDelay = 2000;
    this.matchDelay = 2000;
    this.activeAgents = 0;
    this.agentResults = [];
    this.agentStats = {};
    this.processedUrls = new Set();
    this.scrapeStartTime = null;
    this.agentPages = new Map();

    // ⭐ IMPROVED LOCK MANAGEMENT
    this._isScraping = false;
    this._scrapeLockTime = null;
    this._scrapeTimeout = null;
    this._scrapeId = null;
    this._scrapePromise = null;
    this._lastScrapeTime = 0;
    this._minScrapeInterval = 5000; // 5 seconds minimum between scrapes

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
      'ODW',
      'SDS',
      'TYP-W',
      'DG-W',
      'MKL',
      'CW',
      'AC',
      'BL',
      'JS',
      'KK',
      'SS',
      'LS',
      'MIL',
      'PD',
      'NDT',
      'RNH',
      'SR',
      'SRL',
      'BP',
      'LBW',
      'London Spirit',
      'MI London',
      'Manchester Originals',
      'Sunrisers Leeds',
      'Birmingham Phoenix',
      'Southern Brave',
      'Welsh Fire',
      'Trent Rockets',
      'Oval Invincibles',
      'Northern Superchargers',
      'India',
      'England',
      'Australia',
      'Pakistan',
      'New Zealand',
      'South Africa',
      'West Indies',
      'Sri Lanka',
      'Bangladesh',
      'Afghanistan',
      'Zimbabwe',
      'Ireland',
      'Nepal',
      'Namibia',
      'Guyana',
      'Jaffna Kings',
      'Galle Gallants',
      'Dambulla Sixers',
      'Kandy Falcons',
      'Colombo Kaps',
      'Kandy Royals',
      'Worcestershire',
      'Derbyshire',
      'Lahore Qalandars',
      'Perth Scorchers',
      'Guyana Amazon Warriors',
      'San Francisco Unicorns',
      'BP-W',
      'TR-W',
      'GLCS',
      'SOM',
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

  // ⭐ IMPROVED LOCK MANAGEMENT
  async acquireLock(scrapeId) {
    // Check if enough time has passed since last scrape
    const now = Date.now();
    if (this._lastScrapeTime > 0 && now - this._lastScrapeTime < this._minScrapeInterval) {
      logger.debug(
        `⏳ Last scrape was ${Math.round((now - this._lastScrapeTime) / 1000)}s ago, waiting...`
      );
      await this.sleep(this._minScrapeInterval - (now - this._lastScrapeTime));
    }

    if (this._isScraping) {
      const lockAge = Date.now() - (this._scrapeLockTime || Date.now());
      if (lockAge > 10000) {
        // Lock is stale (>10 seconds), force release
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

    // Safety timeout - auto-release after 25 seconds
    if (this._scrapeTimeout) {
      clearTimeout(this._scrapeTimeout);
    }
    this._scrapeTimeout = setTimeout(() => {
      if (this._isScraping) {
        logger.warn(`⚠️ Scrape ${this._scrapeId} timeout - force releasing lock`);
        this.forceReleaseLock();
      }
    }, 25000);

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
      'Caught Out',
      'Innings Break',
      'Not Started',
      'Live',
      'Match',
      'Over',
      'Wicket',
      'Run',
      'Ball',
      'Striker',
      'Bowler',
      'Toss',
      'Commentary',
      'Highlights',
      'Scorecard',
      'Discussions',
      'Points Table',
      'Projected Score',
      'Milestone',
      'Local Time',
      'Team 1',
      'Team 2',
      'LBW Out',
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

  buildLocationCandidates(venue, series, matchTitle, team1Name, team2Name, matchUrl) {
    const candidates = new Set();

    if (venue && venue !== 'TBD' && venue.length > 2) {
      candidates.add(venue);

      const cleanedVenue = venue
        .replace(
          /Cricket Ground|Ground|Stadium|International Stadium|Sports Complex|Oval|Arena|Park|Gardens|Cricket Club|CC/gi,
          ''
        )
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanedVenue !== venue && cleanedVenue.length > 2) {
        candidates.add(cleanedVenue);
      }

      if (venue.includes(',')) {
        const parts = venue.split(',').map((p) => p.trim());
        parts.forEach((part) => {
          if (part.length > 2) {
            candidates.add(part);
          }
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
          if (country && country.length > 2) {
            candidates.add(country);
          }
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
        if (matchTitle.includes(country)) {
          candidates.add(country);
        }
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

      const response = await axios.get(geocodeUrl, {
        timeout: 10000,
      });

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

        const weatherResponse = await axios.get(weatherUrl, {
          timeout: 10000,
        });

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
        logger.info(
          `       (Original venue: "${venue || 'N/A'}", Teams: ${team1Name || 'N/A'} vs ${team2Name || 'N/A'})`
        );
        return weather;
      } catch (error) {
        logger.debug(`    ❌ Weather API error for "${location}": ${error.message}`);
        continue;
      }
    }

    this.stats.weatherFailed++;
    logger.warn(`    ❌ No valid weather location found after all ${candidates.length} retries.`);
    logger.warn(`       Venue: "${venue || 'N/A'}"`);
    logger.warn(`       Series: "${series || 'N/A'}"`);
    logger.warn(`       Teams: ${team1Name || 'N/A'} vs ${team2Name || 'N/A'}`);
    return null;
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

    return {
      agentId,
      matches: results,
      stats,
    };
  }

  async getRealTimeMatchData(page, match, agentId) {
    try {
      let url = match.url;

      if (url.includes('/match-details')) {
        url = url.replace('/match-details', '');
      }

      url = url.includes('?') ? `${url}&_=${Date.now()}` : `${url}?_=${Date.now()}`;

      logger.info(`   📡 ${agentId} fetching: ${url}`);

      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        const postLoadDelay = 1000 + Math.random() * 1000;
        await this.sleep(postLoadDelay);
      } catch (navError) {
        logger.warn(`   ⚠️ ${agentId} navigation timeout, using fallback`);
        return this.createFallbackMatch(match);
      }

      try {
        await page.waitForSelector('.team-1, .team-2, .runs.f-runs, .live-score-card', {
          timeout: 8000,
        });
      } catch (e) {
        logger.warn(`   ⚠️ ${agentId} no match content found, using fallback`);
        return this.createFallbackMatch(match);
      }

      await this.sleep(1000);

      const matchData = await this.extractMatchDetailsForAgent(page, match);

      if (!matchData || !matchData.teams?.home?.name) {
        logger.warn(`   ⚠️ ${agentId} invalid match data, using fallback`);
        return this.createFallbackMatch(match);
      }

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

      return matchData;
    } catch (error) {
      logger.error(`   ❌ ${agentId} error: ${error.message}`);
      return this.createFallbackMatch(match);
    }
  }

  async extractMatchDetailsForAgent(page, discovered) {
    try {
      const teamNames = await this.extractTeamNamesFromPage(page);
      const series = await this.extractSeries(page);
      const venue = await this.extractVenue(page);
      const scoreboard = await this.extractScoreboard(page);
      const currentBatsmen = await this.extractCurrentBatsmen(page);
      const currentBowler = await this.extractCurrentBowler(page);
      const overs = await this.extractOversTimeline(page);
      const commentary = await this.extractCommentary(page);
      const prediction = await this.extractPrediction(page);
      const toss = await this.extractToss(page);
      const result = await this.extractResult(page);

      let format = 'T20';
      const titleText = await this.extractTextFromSelectors(page, page, [
        'h1',
        '.match-title',
        '.title',
      ]);
      if (titleText) {
        if (titleText.includes('ODI')) format = 'ODI';
        else if (titleText.includes('Test')) format = 'Test';
        else if (titleText.includes('100B')) format = 'The Hundred';
      }

      const matchId = discovered.url.match(/\/cricket-live-score\/([A-Za-z0-9-]+)/i);

      let homeTeamName = teamNames.home || scoreboard.batting_team.name || discovered.team1.name;
      let awayTeamName = teamNames.away || scoreboard.bowling_team.name || discovered.team2.name;

      homeTeamName = this.cleanTeamName(homeTeamName);
      awayTeamName = this.cleanTeamName(awayTeamName);

      if (!this.isValidTeamName(homeTeamName) || !this.isValidTeamName(awayTeamName)) {
        const urlTeams = discovered.url.match(/\/([A-Za-z0-9-]+)-vs-([A-Za-z0-9-]+)/);
        if (urlTeams) {
          const t1 = urlTeams[1].toUpperCase();
          const t2 = urlTeams[2].toUpperCase();
          if (this.isValidTeamName(t1)) homeTeamName = t1;
          if (this.isValidTeamName(t2)) awayTeamName = t2;
        }
      }

      const homeShort = discovered.team1.short || homeTeamName.substring(0, 3).toUpperCase();
      const awayShort = discovered.team2.short || awayTeamName.substring(0, 3).toUpperCase();

      return {
        match_id: matchId
          ? matchId[1]
          : `live_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        match_url: discovered.url,
        series: {
          id: `series_${Date.now()}`,
          name: series || discovered.series || 'Unknown Series',
          short_name: series ? series.substring(0, 20) : '',
          season: new Date().getFullYear().toString(),
        },
        match: {
          number: titleText
            ? titleText.match(/(\d+(?:st|nd|rd|th)\s+(?:Match|T20|ODI|Test|100B))/i)?.[0] || 'Match'
            : 'Match',
          format: format,
          status: 'Live',
          start_time: new Date().toISOString(),
          current_innings: '',
          current_ball: scoreboard.current_ball || '',
        },
        venue: {
          id: `venue_${Date.now()}`,
          name: venue || 'TBD',
        },
        teams: {
          home: {
            id: this.getTeamId(homeTeamName),
            name: homeTeamName,
            short_name: homeShort,
            logo: discovered.team1.flag || '',
          },
          away: {
            id: this.getTeamId(awayTeamName),
            name: awayTeamName,
            short_name: awayShort,
            logo: discovered.team2.flag || '',
          },
        },
        scoreboard: {
          batting_team: {
            name: scoreboard.batting_team.name || homeTeamName,
            score: scoreboard.batting_team.score || discovered.team1.score || '',
            runs: scoreboard.batting_team.runs,
            wickets: scoreboard.batting_team.wickets,
            overs: scoreboard.batting_team.overs || discovered.team1.overs || '',
          },
          bowling_team: {
            name: scoreboard.bowling_team.name || awayTeamName,
            score: scoreboard.bowling_team.score || discovered.team2.score || '',
            runs: scoreboard.bowling_team.runs,
            wickets: scoreboard.bowling_team.wickets,
            overs: scoreboard.bowling_team.overs || discovered.team2.overs || '',
          },
          target: scoreboard.target,
          required_runs: scoreboard.required_runs,
          required_balls: scoreboard.required_balls,
          crr: scoreboard.crr,
          rrr: scoreboard.rrr,
          current_ball: scoreboard.current_ball || '',
        },
        current_batsmen: currentBatsmen,
        current_bowler: currentBowler,
        overs: overs,
        commentary: commentary,
        prediction: prediction,
        toss: toss,
        result: result,
        weather: null,
        countdown: null,
        _lastUpdated: new Date().toISOString(),
        _updateCount: 1,
      };
    } catch (error) {
      logger.error(`❌ Agent extract error: ${error.message}`);
      return this.createFallbackMatch(discovered);
    }
  }

  async extractTeamNamesFromPage(page) {
    const teams = { home: '', away: '' };

    try {
      const headerSelectors = [
        '.match-header .team-name',
        '.match-title .team-name',
        'h1 .team-name',
        '.match-info .team-name',
      ];

      let teamNames = [];
      for (const selector of headerSelectors) {
        try {
          const elements = await page.$$(selector);
          for (const el of elements) {
            const text = await page.evaluate((el) => el.textContent.trim(), el);
            if (text && text.length > 0 && text.length < 30) {
              teamNames.push(text);
            }
          }
          if (teamNames.length >= 2) break;
        } catch (e) {}
      }

      if (teamNames.length >= 2) {
        teams.home = teamNames[0];
        teams.away = teamNames[1];
        return teams;
      }
    } catch (error) {
      logger.debug(`Error extracting team names: ${error.message}`);
    }

    return teams;
  }

  // ⭐ FIXED: EXTRACT SCOREBOARD WITH WICKET DATA
  async extractScoreboard(page) {
    const scoreboard = {
      batting_team: { name: '', score: '', runs: null, wickets: null, overs: '' },
      bowling_team: { name: '', score: '', runs: null, wickets: null, overs: '' },
      target: null,
      required_runs: null,
      required_balls: null,
      crr: null,
      rrr: null,
      current_ball: '',
    };

    try {
      try {
        await page.evaluate(() => document.title);
      } catch (e) {
        logger.warn('⚠️ Page is closed, returning empty scoreboard');
        return scoreboard;
      }

      const scoreSelectors = [
        '.team-score .runs.f-runs',
        '.runs.f-runs',
        '.team-score .runs',
        '.score-card .team-score',
        '.team-innig .team-score',
        '.live-score-card .team-score',
      ];

      let teamScores = [];

      for (const selector of scoreSelectors) {
        try {
          const elements = await page.$$(selector);
          if (elements && elements.length >= 2) {
            teamScores = elements;
            break;
          }
        } catch (e) {}
      }

      if (teamScores.length >= 2) {
        for (let i = 0; i < Math.min(teamScores.length, 2); i++) {
          const el = teamScores[i];
          const isBatting = i === 0;

          try {
            const scoreText = await page.evaluate((element) => {
              const runsSpan = element.querySelector(
                '.runs.f-runs span, .runs span, span:first-child'
              );
              if (runsSpan) {
                return runsSpan.textContent.trim();
              }
              return element.textContent.trim();
            }, el);

            let runs = null;
            let wickets = null;
            let score = '';
            let overs = '';

            if (scoreText) {
              const scoreMatch = scoreText.match(/^(\d+)\s*[-/]\s*(\d+)/);
              if (scoreMatch) {
                runs = parseInt(scoreMatch[1]);
                wickets = parseInt(scoreMatch[2]);
                score = `${runs}-${wickets}`;
                logger.debug(`   ⭐ Parsed score: ${runs}-${wickets}`);
              } else {
                const runMatch = scoreText.match(/^(\d+)/);
                if (runMatch) {
                  runs = parseInt(runMatch[1]);
                  score = runMatch[1];
                  wickets = 0;
                }
              }

              const oversText = await page.evaluate((element) => {
                const spans = element.querySelectorAll('span');
                if (spans.length >= 2) {
                  return spans[1].textContent.trim();
                }
                const text = element.textContent.trim();
                const overMatch = text.match(/[\(\[(]?\s*(\d+\.\d+|\d+b)\s*[\)\])]?/);
                if (overMatch) {
                  return overMatch[1];
                }
                return '';
              }, el);

              if (oversText) {
                overs = oversText.replace(/[()[\]]/g, '').trim();
              }

              let teamName = await page.evaluate((element) => {
                const parent = element.parentElement;
                if (parent) {
                  const nameEl = parent.querySelector('.team-name, .name, .team-title');
                  if (nameEl) {
                    return nameEl.textContent.trim();
                  }
                }
                return '';
              }, el);

              if (!teamName) {
                const allText = await page.evaluate((element) => {
                  const parent = element.closest(
                    '.team-innig, .live-data, .team-result, .score-card'
                  );
                  if (parent) {
                    return parent.textContent.trim();
                  }
                  return element.parentElement.textContent.trim();
                }, el);

                const shortMatch = allText.match(/\b([A-Z]{2,4})\b/);
                if (shortMatch && this.isValidTeamName(shortMatch[1])) {
                  teamName = shortMatch[1];
                }
              }

              if (isBatting) {
                scoreboard.batting_team.name = teamName || `Team ${i + 1}`;
                scoreboard.batting_team.score = score;
                scoreboard.batting_team.runs = runs;
                scoreboard.batting_team.wickets = wickets !== null ? wickets : 0;
                scoreboard.batting_team.overs = overs || '';
                scoreboard.current_ball = overs || '';
              } else {
                scoreboard.bowling_team.name = teamName || `Team ${i + 1}`;
                scoreboard.bowling_team.score = score;
                scoreboard.bowling_team.runs = runs;
                scoreboard.bowling_team.wickets = wickets !== null ? wickets : 0;
                scoreboard.bowling_team.overs = overs || '';
              }
            }
          } catch (error) {
            logger.debug(`   Error extracting team ${i + 1}: ${error.message}`);
          }
        }
      }

      // Fallback
      if (!scoreboard.batting_team.runs && !scoreboard.bowling_team.runs) {
        try {
          const liveScore = await page.$('.live-score-card, .score-card, .match-score');
          if (liveScore) {
            const text = await page.evaluate((el) => el.textContent.trim(), liveScore);
            const scores = text.match(/(\d+)\s*[-/]\s*(\d+)/g);
            if (scores && scores.length >= 2) {
              for (let i = 0; i < Math.min(scores.length, 2); i++) {
                const match = scores[i].match(/(\d+)\s*[-/]\s*(\d+)/);
                if (match) {
                  const runs = parseInt(match[1]);
                  const wickets = parseInt(match[2]);
                  if (i === 0) {
                    scoreboard.batting_team.runs = runs;
                    scoreboard.batting_team.wickets = wickets;
                    scoreboard.batting_team.score = `${runs}-${wickets}`;
                  } else {
                    scoreboard.bowling_team.runs = runs;
                    scoreboard.bowling_team.wickets = wickets;
                    scoreboard.bowling_team.score = `${runs}-${wickets}`;
                  }
                }
              }
            }
          }
        } catch (e) {}
      }

      // Extract target, CRR, RRR
      const targetSelectors = ['.target', '.match-target', '.chase-target', '.target-score'];
      for (const sel of targetSelectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            const text = await page.evaluate((el) => el.textContent.trim(), el);
            if (text) {
              const numMatch = text.match(/(\d+)/);
              if (numMatch) {
                scoreboard.target = parseInt(numMatch[1]);
                break;
              }
            }
          }
        } catch (e) {}
      }

      const crrSelectors = ['.crr', '.current-run-rate', '.run-rate'];
      for (const sel of crrSelectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            const text = await page.evaluate((el) => el.textContent.trim(), el);
            if (text) {
              const numMatch = text.match(/(\d+\.\d+)/);
              if (numMatch) {
                scoreboard.crr = parseFloat(numMatch[1]);
                break;
              }
            }
          }
        } catch (e) {}
      }

      const rrrSelectors = ['.rrr', '.required-run-rate', '.req-run-rate'];
      for (const sel of rrrSelectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            const text = await page.evaluate((el) => el.textContent.trim(), el);
            if (text) {
              const numMatch = text.match(/(\d+\.\d+)/);
              if (numMatch) {
                scoreboard.rrr = parseFloat(numMatch[1]);
                break;
              }
            }
          }
        } catch (e) {}
      }

      return scoreboard;
    } catch (error) {
      logger.error(`Error extracting scoreboard: ${error.message}`);
      return scoreboard;
    }
  }

  async extractResult(page) {
    try {
      try {
        await page.evaluate(() => document.title);
      } catch (e) {
        return null;
      }

      const resultSelectors = [
        '.result-box .font3',
        '.result-box span',
        '.match-result',
        '.result-text',
        '[class*="result"] .font3',
        '.team-result .result-box span',
      ];

      for (const selector of resultSelectors) {
        try {
          const el = await page.$(selector);
          if (el) {
            const text = await page.evaluate((el) => el.textContent.trim(), el);
            if (text && text.length > 0 && text.length < 50) {
              let result = text.trim().replace(/\s+/g, ' ');
              logger.debug(`   Found result: ${result}`);
              return result;
            }
          }
        } catch (e) {}
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  // ⭐ FIXED: EXTRACT OVERS TIMELINE WITH BALL-BY-BALL
  async extractOversTimeline(page) {
    const overs = [];

    try {
      try {
        await page.evaluate(() => document.title);
      } catch (e) {
        return overs;
      }

      // Primary: Extract from .over-ball elements
      try {
        const ballData = await page.evaluate(() => {
          const balls = [];
          const ballElements = document.querySelectorAll('.over-ball');

          ballElements.forEach((el) => {
            const text = el.textContent.trim();
            if (text) {
              let value = text;
              if (value === 'W' || value === 'w') value = 'W';
              else if (value === 'wd') value = 'wd';
              else if (value === 'nb') value = 'nb';
              else if (value === '4lb') value = '4lb';
              else if (value === '1lb') value = '1lb';
              balls.push(value);
            }
          });

          return balls;
        });

        if (ballData && ballData.length > 0) {
          const font1Data = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.font1')).map((el) =>
              el.textContent.trim()
            );
          });

          const font3Data = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.font3')).map((el) =>
              el.textContent.trim()
            );
          });

          const ballsPerOver = 6;
          for (let i = 0; i < ballData.length; i += ballsPerOver) {
            const overBalls = ballData.slice(i, i + ballsPerOver);
            if (overBalls.length > 0) {
              const overNumber = Math.floor(i / ballsPerOver) + 1;

              const ballsWithEvents = [];
              for (let j = 0; j < overBalls.length; j++) {
                const value = overBalls[j];
                let event = null;

                for (let k = 0; k < font1Data.length; k++) {
                  if (font1Data[k] === value || font1Data[k].includes(value)) {
                    if (k < font3Data.length && font3Data[k]) {
                      event = font3Data[k];
                    }
                    break;
                  }
                }

                if (!event) {
                  event = this.getDefaultEvent(value);
                }

                const isWicket = this.isWicket(value, event);

                ballsWithEvents.push({
                  value: value,
                  event: event,
                  isWicket: isWicket,
                });
              }

              overs.push({
                over: String(overNumber),
                balls: ballsWithEvents,
                total: this.calculateOverTotal(overBalls),
              });
            }
          }

          logger.debug(`   ⭐ Extracted ${ballData.length} balls across ${overs.length} overs`);
          return overs;
        }
      } catch (e) {
        logger.debug(`   Error extracting ball-by-ball: ${e.message}`);
      }

      // Fallback: Container-based extraction
      const containerSelectors = [
        '.overs-timeline',
        '.overs-slide-container',
        '.overs-container',
        '.overs-list',
        '.ball-by-ball',
      ];

      for (const containerSel of containerSelectors) {
        try {
          const container = await page.$(containerSel);
          if (container) {
            const slideSelectors = ['.overs-slide', '.content', '.over-item', '.over-row'];
            for (const slideSel of slideSelectors) {
              const slides = await container.$$(slideSel);
              for (const slide of slides) {
                let overNumber = '';
                const overSelectors = [
                  '.over-title',
                  '.over-number',
                  '.title',
                  '.header',
                  'h4',
                  '.over-label',
                ];
                for (const sel of overSelectors) {
                  try {
                    const el = await slide.$(sel);
                    if (el) {
                      const text = await page.evaluate((el) => el.textContent.trim(), el);
                      if (text) {
                        let match = text.match(/Over\s*(\d+)/i);
                        if (match) {
                          overNumber = match[1];
                          break;
                        }
                        if (text.match(/^\d+$/)) {
                          overNumber = text;
                          break;
                        }
                      }
                    }
                  } catch (e) {}
                }

                const balls = [];
                const ballElements = await slide.$$('.over-ball, .ball, .ml-o-b-1');
                for (const ballEl of ballElements) {
                  const result = await page.evaluate((el) => el.textContent.trim(), ballEl);
                  if (result) {
                    let cleanResult = result.trim();
                    if (cleanResult === 'W') cleanResult = 'W';
                    else if (cleanResult === 'wd') cleanResult = 'wd';
                    else if (cleanResult === 'nb') cleanResult = 'nb';
                    else if (cleanResult === '4lb') cleanResult = '4lb';
                    else if (cleanResult === '1lb') cleanResult = '1lb';

                    const eventText = await this.getBallEvent(page, ballEl);

                    balls.push({
                      value: cleanResult,
                      event: eventText || this.getDefaultEvent(cleanResult),
                      isWicket: this.isWicket(cleanResult, eventText),
                    });
                  }
                }

                let total = '';
                const totalSelectors = ['.total', '.over-total', '.over-summary'];
                for (const sel of totalSelectors) {
                  try {
                    const el = await slide.$(sel);
                    if (el) {
                      const text = await page.evaluate((el) => el.textContent.trim(), el);
                      if (text) {
                        total = text.replace(/^=\s*/, '').trim();
                        break;
                      }
                    }
                  } catch (e) {}
                }

                if (overNumber || balls.length > 0) {
                  overs.push({
                    over: overNumber || '',
                    balls: balls,
                    total: total || '',
                  });
                }
              }
              if (overs.length > 0) break;
            }
          }
          if (overs.length > 0) break;
        } catch (e) {}
      }

      return overs;
    } catch (e) {
      logger.error(`Error extracting overs timeline: ${e.message}`);
      return overs;
    }
  }

  async getBallEvent(page, ballElement) {
    try {
      const parent = await page.evaluate((el) => el.parentElement, ballElement);
      if (parent) {
        const font3 = await page.evaluate((el) => {
          const font3El = el.querySelector('.font3');
          if (font3El) {
            return font3El.textContent.trim();
          }
          const text = el.textContent.trim();
          const eventMatch = text.match(
            /(caught|bowled|lbw|stumped|run out|out|six|four|single|dot)/i
          );
          if (eventMatch) {
            return eventMatch[1];
          }
          return '';
        }, parent);

        if (font3 && font3.length > 0) {
          return font3;
        }
      }
    } catch (e) {}
    return null;
  }

  getDefaultEvent(value) {
    const eventMap = {
      0: 'dot ball',
      1: 'single',
      2: 'double',
      3: 'triple',
      4: 'four',
      6: 'six',
      W: 'wicket',
      wd: 'wide',
      nb: 'no ball',
      '4lb': 'four leg bye',
      '1lb': 'leg bye',
      5: 'five',
    };
    return eventMap[value] || `ball: ${value}`;
  }

  isWicket(value, event) {
    if (value === 'W' || value === 'w') {
      return true;
    }

    if (event) {
      const wicketKeywords = ['out', 'caught', 'bowled', 'lbw', 'stumped', 'run out', 'hit wicket'];
      const lowerEvent = event.toLowerCase();
      for (const keyword of wicketKeywords) {
        if (lowerEvent.includes(keyword)) {
          return true;
        }
      }
    }

    return false;
  }

  calculateOverTotal(balls) {
    let total = 0;
    for (const ball of balls) {
      if (ball === '4' || ball === '4lb') total += 4;
      else if (ball === '6') total += 6;
      else if (ball === '1' || ball === '1lb') total += 1;
      else if (ball === '2') total += 2;
      else if (ball === '3') total += 3;
      else if (ball === '5') total += 5;
    }
    return String(total);
  }

  async extractCurrentBatsmen(page) {
    const batsmen = [];

    try {
      try {
        await page.evaluate(() => document.title);
      } catch (e) {
        return batsmen;
      }

      try {
        await page.waitForSelector(
          '.batsmen-info-wrapper, .player-card-wrapper, .playing-batsmen-wrapper, .player-profile, .player-card',
          { timeout: 5000 }
        );
      } catch (e) {
        return batsmen;
      }

      const battingContainerSelectors = [
        '.batsmen-info-wrapper',
        '.player-active',
        '.player-card-wrapper',
        '.player-card',
        '.player-profile',
        '.playing-batsmen-wrapper',
      ];

      let container = null;
      for (const selector of battingContainerSelectors) {
        try {
          const found = await page.$(selector);
          if (found) {
            container = found;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!container) {
        const batsmenItems = await page.$$('.batsmen-info-wrapper, .batsman-item, .player-info');
        if (batsmenItems.length === 0) return batsmen;

        for (const item of batsmenItems) {
          try {
            const batsman = await this.extractBatsmanFromElement(page, item);
            if (batsman && batsman.name) {
              batsmen.push(batsman);
            }
          } catch (e) {
            continue;
          }
        }

        if (batsmen.length > 0) {
          this.ensureStriker(batsmen);
          return batsmen;
        }

        return batsmen;
      }

      const cardSelectors = [
        '.batsmen-info-wrapper',
        '.player-card-wrapper',
        '.player-card',
        '.player-profile',
        '.batsman-item',
        '.batsman',
        '.player-info',
      ];

      let cards = [];
      for (const selector of cardSelectors) {
        try {
          const found = await container.$$(selector);
          if (found && found.length > 0) {
            cards = found;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (cards.length === 0) {
        const directCards = await page.$$('.batsmen-info-wrapper, .batsman-item');
        if (directCards.length > 0) {
          cards = directCards;
        } else {
          return batsmen;
        }
      }

      for (let i = 0; i < cards.length && batsmen.length < 2; i++) {
        const card = cards[i];
        try {
          const batsman = await this.extractBatsmanFromElement(page, card);
          if (batsman && batsman.name) {
            batsmen.push(batsman);
          }
        } catch (error) {
          continue;
        }
      }

      this.ensureStriker(batsmen);

      return batsmen;
    } catch (error) {
      logger.debug(`Error extracting current batsmen: ${error.message}`);
      return batsmen;
    }
  }

  async extractBatsmanFromElement(page, element) {
    try {
      let name = '';
      let runs = '';
      let balls = '';
      let is_striker = false;

      const nameSelectors = [
        '.batsmen-name a p',
        '.batsmen-name p',
        '.batsmen-name',
        '.player-name',
        '.playerName',
        '.name',
        '.p-name',
        'a[href*="/player/"] p',
        'a[href*="/player/"]',
      ];

      for (const sel of nameSelectors) {
        try {
          const nameEl = await element.$(sel);
          if (nameEl) {
            const text = await page.evaluate((el) => el.textContent.trim(), nameEl);
            if (text && text.length > 0 && text.length < 50) {
              name = text;
              break;
            }
          }
        } catch (e) {}
      }

      if (!name) return null;

      const scoreSelectors = ['.batsmen-score', '.batsmen-score p', '.score', '.runs'];

      for (const sel of scoreSelectors) {
        try {
          const scoreEl = await element.$(sel);
          if (scoreEl) {
            const text = await page.evaluate((el) => el.textContent.trim(), scoreEl);
            if (text) {
              const scoreMatch = text.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
              if (scoreMatch) {
                runs = scoreMatch[1];
                balls = scoreMatch[2];
                break;
              }
              const numMatch = text.match(/^(\d+)$/);
              if (numMatch) {
                runs = numMatch[1];
                break;
              }
            }
          }
        } catch (e) {}
      }

      // Check for striker indicator
      try {
        const svgSelectors = [
          '.circle-strike-icon',
          '.circle-strike-icon svg',
          'svg[viewBox="0 0 12 12"]',
          '.icon-left',
          '.striker-indicator',
          '[class*="strike"]',
          '[class*="highlight"]',
        ];

        for (const sel of svgSelectors) {
          try {
            const svgEl = await element.$(sel);
            if (svgEl) {
              const isVisible = await page.evaluate((el) => {
                const style = window.getComputedStyle(el);
                return (
                  style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
                );
              }, svgEl);

              if (isVisible) {
                is_striker = true;
                break;
              }
            }
          } catch (e) {}
        }
      } catch (e) {}

      return {
        name: name,
        runs: runs || null,
        balls: balls || null,
        is_striker: is_striker,
      };
    } catch (error) {
      return null;
    }
  }

  ensureStriker(batsmen) {
    if (batsmen.length === 0) return;

    const strikers = batsmen.filter((b) => b.is_striker === true);
    if (strikers.length === 0) {
      batsmen[0].is_striker = true;
    } else if (strikers.length > 1) {
      let foundFirst = false;
      for (const batsman of batsmen) {
        if (batsman.is_striker) {
          if (!foundFirst) {
            foundFirst = true;
          } else {
            batsman.is_striker = false;
          }
        }
      }
    }
  }

  async extractCurrentBowler(page) {
    const bowler = { name: '', overs: '', runs: null, wickets: null };

    try {
      try {
        await page.evaluate(() => document.title);
      } catch (e) {
        return bowler;
      }

      const bowlingContainerSelectors = [
        '.player-card-wrapper',
        '.player-card.border',
        '.player-profile',
        '.bowling-card',
        '.bowler-info',
        '.current-bowler',
        '.bowler-container',
        '.player-info',
      ];

      let container = null;
      for (const selector of bowlingContainerSelectors) {
        try {
          const found = await page.$(selector);
          if (found) {
            container = found;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!container) {
        const teamInnings = await page.$$('.team-innig, .live-data, .team-result');
        if (teamInnings.length >= 2) {
          const bowlingTeam = teamInnings[1];
          const playerCards = await bowlingTeam.$$(
            '.player-card, .player-card-wrapper, .player-profile'
          );
          if (playerCards.length > 0) {
            container = playerCards[0];
          }
        }
      }

      if (!container) return bowler;

      const nameSelectors = [
        '.batsmen-name',
        '.player-name',
        '.name',
        '.bowler-name',
        'a[href*="/player/"] p',
        'a[href*="/player/"]',
        '.p-name',
      ];
      for (const nameSel of nameSelectors) {
        try {
          const nameEl = await container.$(nameSel);
          if (nameEl) {
            const text = await page.evaluate((el) => el.textContent.trim(), nameEl);
            if (text && text.length > 0 && text.length < 50) {
              bowler.name = text;
              break;
            }
          }
        } catch (e) {}
      }

      const figuresSelectors = [
        '.bowling-figures',
        '.figures',
        '.stats',
        '.score',
        '.bowling-stats',
        '.bowler-stats',
      ];
      for (const figSel of figuresSelectors) {
        try {
          const figEl = await container.$(figSel);
          if (figEl) {
            const text = await page.evaluate((el) => el.textContent.trim(), figEl);
            if (text) {
              const figuresMatch = text.match(/(\d+)-(\d+)\s*\(([\d.]+)\)/);
              if (figuresMatch) {
                bowler.wickets = parseInt(figuresMatch[1]);
                bowler.runs = parseInt(figuresMatch[2]);
                bowler.overs = figuresMatch[3];
                break;
              }
            }
          }
        } catch (e) {}
      }

      return bowler;
    } catch (error) {}
    return bowler;
  }

  async extractToss(page) {
    const toss = { status: 'Not Started' };
    try {
      const tossSelectors = [
        '.toss-wrap p',
        '.toss-wrap',
        '[class*="toss"] p',
        '[class*="toss"]',
        '.match-info .toss',
        '.toss-info',
        '.toss-detail',
        '.match-toss',
      ];

      for (const selector of tossSelectors) {
        try {
          const elements = await page.$$(selector);
          for (const el of elements) {
            try {
              let text = await page.evaluate((el) => el.textContent.trim(), el);
              if (text && text.length > 0) {
                text = text.replace(/\s+/g, ' ').trim();
                if (text.includes('won the toss')) {
                  toss.status = text;
                  return toss;
                }
              }
            } catch (e) {
              continue;
            }
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {}
    return toss;
  }

  async extractSeries(page) {
    const selectors = [
      '.series-name',
      '.snameTag',
      '.match-series',
      '.series-title',
      '.tournament',
      '.series',
      '.match-tournament',
      'h1',
      '.match-header .series',
      '.match-info .series',
    ];
    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const text = await page.evaluate((el) => el.textContent.trim(), el);
          if (text && text.length > 0) {
            return text;
          }
        }
      } catch (e) {}
    }
    return '';
  }

  async extractVenue(page) {
    const selectors = [
      '.venue',
      '.match-venue',
      '.venue-name',
      '.location',
      '.stadium',
      '.match-location',
      '.match-info .venue',
      '.match-details .venue',
      '.matchInfo',
      '.info-row',
      '.venue-info',
      '.meta-info',
      '.scorecard-header',
    ];

    for (const selector of selectors) {
      try {
        const elements = await page.$$(selector);
        for (const el of elements) {
          const text = await page.evaluate((el) => el.textContent.trim(), el);
          if (text && text.length > 3 && !text.includes('Over') && !text.includes('wd')) {
            return text;
          }
        }
      } catch (e) {}
    }

    return '';
  }

  async extractCommentary(page) {
    const commentary = [];
    const containerSelectors = [
      '.commentary-container',
      '.commentary-section',
      '.commentary-list',
      '.live-commentary',
    ];
    for (const containerSel of containerSelectors) {
      try {
        const container = await page.$(containerSel);
        if (container) {
          const itemSelectors = ['.commentary-item', '.comment', '.ball-commentary'];
          for (const itemSel of itemSelectors) {
            const items = await container.$$(itemSel);
            for (const item of items) {
              const ball = await this.extractTextFromSelectors(page, item, [
                '.ball-number',
                '.over-ball',
                '.ball',
              ]);
              const result = await this.extractTextFromSelectors(page, item, [
                '.result',
                '.event',
                '.ball-result',
              ]);
              const text = await this.extractTextFromSelectors(page, item, [
                '.comment-text',
                '.description',
                '.comment',
              ]);
              if (ball || text || result) {
                commentary.push({
                  ball: ball || '',
                  result: result || '',
                  text: text || '',
                });
              }
            }
            if (commentary.length > 0) break;
          }
        }
        if (commentary.length > 0) break;
      } catch (e) {}
    }
    return commentary;
  }

  async extractPrediction(page) {
    const prediction = {
      home_probability: null,
      away_probability: null,
      projected_scores: [],
    };
    try {
      const displayFlex = await page.$('.displayFlex');
      if (displayFlex) {
        const percentageElements = await displayFlex.$$('.percentageScreenText');
        const percentages = [];
        for (const el of percentageElements) {
          const text = await page.evaluate((el) => el.textContent.trim(), el);
          if (text) {
            const num = parseInt(text.replace('%', ''));
            if (!isNaN(num)) percentages.push(num);
          }
        }
        if (percentages.length >= 2) {
          prediction.home_probability = percentages[0];
          prediction.away_probability = percentages[1];
        }
      }
    } catch (error) {}
    return prediction;
  }

  async extractTextFromSelectors(page, element, selectors) {
    for (const selector of selectors) {
      try {
        const el = await element.$(selector);
        if (el) {
          const text = await page.evaluate((el) => el.textContent.trim(), el);
          if (text) return text;
        }
      } catch (e) {}
    }
    return '';
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
        number: 'Match',
        format: 'T20',
        status: 'Live',
        start_time: '',
        current_innings: '',
        current_ball: '',
      },
      venue: {
        id: `venue_${Date.now()}`,
        name: 'TBD',
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
        },
        bowling_team: {
          name: discovered.team2.name,
          score: discovered.team2.score || '',
          runs: null,
          wickets: null,
          overs: discovered.team2.overs || '',
        },
        target: null,
        required_runs: null,
        required_balls: null,
        crr: null,
        rrr: null,
        current_ball: '',
      },
      current_batsmen: [],
      current_bowler: { name: '', overs: '', runs: null, wickets: null },
      overs: [],
      commentary: [],
      prediction: { home_probability: null, away_probability: null, projected_scores: [] },
      toss: { status: 'Not Started', winner: '', decision: '' },
      result: null,
      weather: null,
      countdown: null,
    };
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
          await this.page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 20000,
          });
          navSuccess = true;
          break;
        } catch (navError) {
          logger.warn(`⚠️ Navigation attempt ${attempt} failed: ${navError.message}`);
          if (attempt < 2) {
            await this.sleep(2000 * attempt);
          }
        }
      }

      if (!navSuccess) {
        logger.error('❌ Failed to navigate after 2 attempts');
        return [];
      }

      await this.sleep(2000);

      try {
        await this.page.waitForSelector('.live-card, .match-card, .team-innig', {
          timeout: 8000,
        });
      } catch (e) {
        logger.warn('⚠️ No match indicators found, waiting for page to settle...');
        await this.sleep(3000);
      }

      await this.sleep(1000);
    } catch (error) {
      logger.error(`❌ Failed to load live matches page: ${error.message}`);
      return [];
    }

    const selectors = [
      '.live-card',
      '.live-score-card',
      '.match-card',
      '.match-container',
      '.team-result',
      '.team-content',
      '.teamProfile',
      '.team-innig',
      '.score-card',
      '.match-item',
      '.live-match-item',
      '.match-row',
      '.cricket-match-card',
      '.match-card-container',
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

        const getText = (el) => {
          if (!el) return '';
          return el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
        };

        const cleanText = (text) => {
          if (!text) return '';
          return text.replace(/\s+/g, ' ').trim();
        };

        const isValidTeamName = (name) => {
          if (!name) return false;
          const trimmed = name.trim();
          if (trimmed.length < 2 || trimmed.length > 30) return false;

          const validTeamNames = new Set([
            'ODW',
            'SDS',
            'TYP-W',
            'DG-W',
            'MKL',
            'CW',
            'AC',
            'BL',
            'JS',
            'KK',
            'SS',
            'LS',
            'MIL',
            'PD',
            'NDT',
            'RNH',
            'SR',
            'SRL',
            'BP',
            'LBW',
            'London Spirit',
            'MI London',
            'Manchester Originals',
            'Sunrisers Leeds',
            'Birmingham Phoenix',
            'India',
            'England',
            'Australia',
            'Pakistan',
            'New Zealand',
            'South Africa',
            'West Indies',
            'Sri Lanka',
            'Bangladesh',
            'Afghanistan',
            'Zimbabwe',
            'Ireland',
            'Nepal',
            'Namibia',
            'Guyana',
            'Jaffna Kings',
            'Galle Gallants',
            'Dambulla Sixers',
            'Kandy Falcons',
            'Colombo Kaps',
            'Kandy Royals',
            'Worcestershire',
            'Derbyshire',
            'Lahore Qalandars',
            'Perth Scorchers',
            'Guyana Amazon Warriors',
            'San Francisco Unicorns',
            'BP-W',
            'TR-W',
            'GLCS',
            'SOM',
          ]);

          for (const valid of validTeamNames) {
            if (trimmed === valid || trimmed.includes(valid) || valid.includes(trimmed)) {
              return true;
            }
          }

          const invalidNames = [
            'Caught Out',
            'Innings Break',
            'Not Started',
            'Live',
            'Match',
            'Over',
            'Wicket',
            'Run',
            'Ball',
            'Striker',
            'Bowler',
            'Toss',
            'Commentary',
            'Highlights',
            'Scorecard',
            'Discussions',
            'Points Table',
            'Projected Score',
            'Milestone',
            'Local Time',
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
              if (href.startsWith('https://')) {
                return href;
              } else if (href.startsWith('/')) {
                return `https://crex.com${href}`;
              } else {
                return `https://crex.com/${href}`;
              }
            }
          }
          return '';
        };

        cards.forEach((card) => {
          const cardText = getText(card);

          if (
            cardText.includes('Advertisement') ||
            cardText.includes('News') ||
            cardText.includes('Video') ||
            cardText.includes('Photo') ||
            cardText.includes('Podcast')
          ) {
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
          const flagImages = card.querySelectorAll(
            'img[src*="Teams"], img[src*="cricketvectors"], .team-flag img, .flag img'
          );
          flagImages.forEach((img) => {
            const src = img.getAttribute('src') || '';
            if (src && (src.includes('Teams') || src.includes('cricketvectors'))) {
              flags.push(src);
            }
          });

          const scoreElements = card.querySelectorAll(
            '.score, .team-score, .runs, .score-text, .match-score'
          );
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
            '.series-name',
            '.snameTag',
            '.match-series',
            '.series-title',
            '.tournament',
            '.series',
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
                short: team1Name.substring(0, 3).toUpperCase(),
                flag: flags[0] || '',
                score: team1Score,
                wickets: team1Wickets,
                overs: team1Overs,
              },
              team2: {
                name: team2Name,
                short: team2Name.substring(0, 3).toUpperCase(),
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

  // ⭐ MAIN SCRAPE METHOD WITH IMPROVED LOCKING
  async scrapeLive(forceRefresh = true) {
    // Check if already scraping
    if (this._isScraping) {
      const lockAge = Date.now() - (this._scrapeLockTime || Date.now());
      if (lockAge < 10000) {
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

    // Acquire lock
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

    // Create promise for this scrape
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

      // Remove duplicates
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

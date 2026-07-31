// src/scraper/crex/UpcomingScraper.js
const BaseCrexScraper = require('./BaseCrexScraper');
const UPCOMING_SELECTORS = require('./selectors/upcomingSelectors');
const logger = require('../../logger');
const util = require('util');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Deep logging function
const deepLog = (label, data) => {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`📊 ${label}`);
  console.log(`${'═'.repeat(80)}`);
  console.log(util.inspect(data, {
    depth: null,
    colors: true,
    compact: false,
    maxArrayLength: null,
    maxStringLength: null,
    showHidden: false
  }));
  console.log(`${'═'.repeat(80)}\n`);
};

class UpcomingScraper extends BaseCrexScraper {
  constructor() {
    super();
    this.selectors = UPCOMING_SELECTORS;
    this.stats = {
      discovered: 0,
      detailed: 0,
      merged: 0,
      errors: 0,
      skippedLive: 0,
      skippedCompleted: 0,
      skippedOther: 0,
      weatherSuccess: 0,
      weatherFailed: 0
    };
    
    // Weather caches
    this.geoCache = new Map();
    this.weatherCache = new Map();
    this.playerCache = new Map();
    
    // Weather code mapping
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
      99: { condition: 'Thunderstorm', icon: '11d' }
    };
    
    // Country mapping for team names
    this.countryMap = {
      'India': 'India',
      'England': 'England',
      'Australia': 'Australia',
      'Pakistan': 'Pakistan',
      'New Zealand': 'New Zealand',
      'South Africa': 'South Africa',
      'West Indies': 'West Indies',
      'Sri Lanka': 'Sri Lanka',
      'Bangladesh': 'Bangladesh',
      'Afghanistan': 'Afghanistan',
      'Zimbabwe': 'Zimbabwe',
      'Ireland': 'Ireland',
      'Nepal': 'Nepal',
      'Namibia': 'Namibia',
      'Guyana': 'Guyana'
    };
    
    // Timezone mapping by venue/city
    this.timezoneMap = {
      'London': 'Europe/London',
      'Birmingham': 'Europe/London',
      'Manchester': 'Europe/London',
      'Leeds': 'Europe/London',
      'Nottingham': 'Europe/London',
      'Southampton': 'Europe/London',
      'Taunton': 'Europe/London',
      'Cardiff': 'Europe/London',
      'Edinburgh': 'Europe/London',
      'Dublin': 'Europe/Dublin',
      'Windhoek': 'Africa/Windhoek',
      'Bengaluru': 'Asia/Kolkata',
      'Bangalore': 'Asia/Kolkata',
      'Mumbai': 'Asia/Kolkata',
      'Delhi': 'Asia/Kolkata',
      'Chennai': 'Asia/Kolkata',
      'Kolkata': 'Asia/Kolkata',
      'Hyderabad': 'Asia/Kolkata',
      'Ahmedabad': 'Asia/Kolkata',
      'Pune': 'Asia/Kolkata',
      'Dharamsala': 'Asia/Kolkata',
      'Mohali': 'Asia/Kolkata',
      'Nagpur': 'Asia/Kolkata',
      'Indore': 'Asia/Kolkata',
      'Rajkot': 'Asia/Kolkata',
      'Lahore': 'Asia/Karachi',
      'Karachi': 'Asia/Karachi',
      'Rawalpindi': 'Asia/Karachi',
      'Multan': 'Asia/Karachi',
      'Dhaka': 'Asia/Dhaka',
      'Colombo': 'Asia/Colombo',
      'Kandy': 'Asia/Colombo',
      'Galle': 'Asia/Colombo',
      'Dambulla': 'Asia/Colombo',
      'Kathmandu': 'Asia/Kathmandu',
      'Dubai': 'Asia/Dubai',
      'Abu Dhabi': 'Asia/Dubai',
      'Sharjah': 'Asia/Dubai',
      'Melbourne': 'Australia/Melbourne',
      'Sydney': 'Australia/Sydney',
      'Brisbane': 'Australia/Brisbane',
      'Perth': 'Australia/Perth',
      'Adelaide': 'Australia/Adelaide',
      'Auckland': 'Pacific/Auckland',
      'Wellington': 'Pacific/Auckland',
      'Christchurch': 'Pacific/Auckland',
      'Port of Spain': 'America/Port_of_Spain',
      'Bridgetown': 'America/Barbados',
      'Georgetown': 'America/Guyana',
      'Guyana': 'America/Guyana',
      'Providence': 'America/Guyana',
      'Providence Stadium': 'America/Guyana',
      'Johannesburg': 'Africa/Johannesburg',
      'Cape Town': 'Africa/Johannesburg',
      'Durban': 'Africa/Johannesburg',
      'Centurion': 'Africa/Johannesburg',
      'Harare': 'Africa/Harare',
      'Bulawayo': 'Africa/Harare',
      'Kabul': 'Asia/Kabul',
      'Islamabad': 'Asia/Karachi',
      'Utrecht': 'Europe/Amsterdam',
      'Amsterdam': 'Europe/Amsterdam',
      'The Rose Bowl': 'Europe/London',
      'Edgbaston': 'Europe/London',
      'Old Trafford': 'Europe/London',
      'Headingley': 'Europe/London',
      'Trent Bridge': 'Europe/London',
      "Lord's": 'Europe/London',
      'The Oval': 'Europe/London',
      'Sophia Gardens': 'Europe/London',
      'Riverside Ground': 'Europe/London'
    };
  }

  // ============================================================
  // GET TIMEZONE FROM VENUE
  // ============================================================
  getTimezoneFromVenue(venue) {
    if (!venue) return 'Europe/London';
    
    for (const [city, timezone] of Object.entries(this.timezoneMap)) {
      if (venue.includes(city) || city.includes(venue)) {
        return timezone;
      }
    }
    
    const cityMatch = venue.match(/,?\s*([A-Za-z\s]+)$/);
    if (cityMatch) {
      const city = cityMatch[1].trim();
      for (const [knownCity, timezone] of Object.entries(this.timezoneMap)) {
        if (city.includes(knownCity) || knownCity.includes(city)) {
          return timezone;
        }
      }
    }
    
    for (const [country, timezone] of Object.entries({
      'UK': 'Europe/London',
      'England': 'Europe/London',
      'India': 'Asia/Kolkata',
      'Australia': 'Australia/Sydney',
      'Pakistan': 'Asia/Karachi',
      'Sri Lanka': 'Asia/Colombo',
      'Bangladesh': 'Asia/Dhaka',
      'Nepal': 'Asia/Kathmandu',
      'Namibia': 'Africa/Windhoek',
      'South Africa': 'Africa/Johannesburg',
      'West Indies': 'America/Port_of_Spain',
      'New Zealand': 'Pacific/Auckland',
      'UAE': 'Asia/Dubai',
      'Guyana': 'America/Guyana'
    })) {
      if (venue.includes(country)) {
        return timezone;
      }
    }
    
    return 'Europe/London';
  }

  // ============================================================
  // GENERATE TEAM ID DYNAMICALLY
  // ============================================================
  generateTeamId(teamName) {
    if (!teamName) return `team_${Date.now()}`;
    
    // Convert to lowercase, replace spaces with underscores
    let id = teamName.toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    
    return `team_${id}`;
  }

  // ============================================================
  // CLEAN PLAYER NAME - Preserve (C), (WK), ✈️
  // ============================================================
  cleanPlayerName(name) {
    if (!name) return '';
    
    // Normalize spaces
    let cleaned = name.replace(/\s+/g, ' ').trim();
    
    // Add space before ✈️ if missing
    cleaned = cleaned.replace(/✈️/g, ' ✈️').replace(/\s+/g, ' ').trim();
    
    // Ensure spaces around (C) and (WK)
    cleaned = cleaned.replace(/\(C\)/g, ' (C) ').replace(/\s+/g, ' ').trim();
    cleaned = cleaned.replace(/\(WK\)/g, ' (WK) ').replace(/\s+/g, ' ').trim();
    
    // Remove duplicate spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    // Ensure proper spacing for multiple markers
    cleaned = cleaned.replace(/\)\s*\(/g, ') (').replace(/\s+/g, ' ').trim();
    
    return cleaned;
  }

  // ============================================================
  // BUILD LOCATION CANDIDATES
  // ============================================================
  buildLocationCandidates(venue, series, matchTitle, team1Name, team2Name) {
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
        const parts = venue.split(',').map(p => p.trim());
        parts.forEach(part => {
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
    
    if (series) {
      for (const [country] of Object.entries(this.countryMap)) {
        if (series.includes(country)) {
          candidates.add(country);
        }
      }
      
      const countryPatterns = [
        /India\s+Tour/i,
        /England\s+Tour/i,
        /Australia\s+Tour/i,
        /Pakistan\s+Tour/i,
        /New\s+Zealand\s+Tour/i,
        /South\s+Africa\s+Tour/i,
        /West\s+Indies\s+Tour/i,
        /Sri\s+Lanka\s+Tour/i,
        /Bangladesh\s+Tour/i,
        /Afghanistan\s+Tour/i,
        /Zimbabwe\s+Tour/i,
        /Ireland\s+Tour/i,
        /Nepal\s+Tour/i,
        /Namibia\s+Tour/i,
        /Guyana\s+Tour/i
      ];
      
      for (const pattern of countryPatterns) {
        if (pattern.test(series)) {
          const match = series.match(pattern);
          if (match) {
            const country = match[0].replace('Tour', '').trim();
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
      
      const yearMatch = series.match(/\b(20\d{2})\b/);
      if (yearMatch) {
        const location = series.replace(yearMatch[0], '').trim();
        if (location && location.length > 2) {
          candidates.add(location);
        }
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
        if (team1Name.includes(key)) {
          candidates.add(country);
        }
      }
    }
    
    if (team2Name) {
      for (const [key, country] of Object.entries(this.countryMap)) {
        if (team2Name.includes(key)) {
          candidates.add(country);
        }
      }
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
    const teamCandidates = [];
    
    for (const candidate of validCandidates) {
      const isCountry = Object.values(this.countryMap).some(c => 
        candidate.toLowerCase() === c.toLowerCase() || 
        candidate.includes(c)
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
      ...teamCandidates
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
    
    return uniqueCandidates;
  }

  // ============================================================
  // GET COORDINATES
  // ============================================================
  async getCoordinates(location) {
    const cacheKey = location.toLowerCase().trim();
    
    if (this.geoCache.has(cacheKey)) {
      logger.debug(`    ✅ Coordinates from cache for: ${location}`);
      return this.geoCache.get(cacheKey);
    }

    try {
      const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
      
      const response = await axios.get(geocodeUrl, {
        timeout: 10000
      });
      
      if (response.data.results && response.data.results.length > 0) {
        const result = response.data.results[0];
        const coords = {
          lat: result.latitude,
          lon: result.longitude,
          name: result.name,
          country: result.country
        };
        this.geoCache.set(cacheKey, coords);
        logger.info(`    ✅ Geocoded "${location}" → ${result.name}, ${result.country} (${result.latitude}, ${result.longitude})`);
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

  // ============================================================
  // WEATHER INTEGRATION
  // ============================================================
  async getWeather(venue, series, matchTitle, team1Name, team2Name) {
    const candidates = this.buildLocationCandidates(venue, series, matchTitle, team1Name, team2Name);
    
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
          timeout: 10000
        });

        const data = weatherResponse.data;
        
        if (!data.current) {
          logger.debug(`    ⚠️ No weather data for "${location}", trying next`);
          continue;
        }

        const current = data.current;
        const weatherCode = current.weather_code;
        const weatherInfo = this.weatherCodeMap[weatherCode] || { condition: 'Unknown', icon: '01d' };
        
        let rainProbability = null;
        if (data.daily && data.daily.precipitation_probability_max && data.daily.precipitation_probability_max.length > 0) {
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
          last_updated: new Date().toISOString()
        };

        this.stats.weatherSuccess++;
        
        logger.info(`    ✅ Weather fetched for "${location}": ${weather.temperature}°C, ${weather.condition}, ${weather.humidity}% humidity`);
        logger.info(`       (Original venue: "${venue || 'N/A'}")`);
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

  // ============================================================
  // MAIN SCRAPE METHOD
  // ============================================================
  async scrapeUpcoming() {
    logger.info('🚀 Starting upcoming matches scraper (Two-Phase Approach)');

    try {
      await this.initializeBrowser();
      
      const discoveredMatches = await this.discoverMatches();
      this.stats.discovered = discoveredMatches.length;
      
      if (discoveredMatches.length === 0) {
        logger.warn('⚠️ No upcoming matches discovered');
        await this.closeBrowser();
        const result = {
          success: false,
          timestamp: new Date().toISOString(),
          data: []
        };
        deepLog('SCRAPER RESULT - No matches found', result);
        return result;
      }

      logger.info(`📋 Phase 1 complete: Discovered ${discoveredMatches.length} upcoming matches`);
      deepLog(`PHASE 1 - Discovered ${discoveredMatches.length} matches`, discoveredMatches);

      const fullMatches = await this.extractMatchDetails(discoveredMatches);
      this.stats.detailed = fullMatches.length;

      logger.info(`📋 Phase 2 complete: Extracted details for ${fullMatches.length} matches`);

      await this.closeBrowser();
      this.logStatistics();

      const result = {
        success: true,
        timestamp: new Date().toISOString(),
        data: fullMatches
      };

      deepLog('✅ FINAL SCRAPER RESULT - Complete JSON', result);
      
      if (fullMatches.length > 0) {
        deepLog('📋 SAMPLE MATCH - First match in detail', fullMatches[0]);
      }

      return result;

    } catch (error) {
      logger.error(`❌ UpcomingScraper error: ${error.message}`);
      await this.closeBrowser();
      const result = {
        success: false,
        timestamp: new Date().toISOString(),
        data: []
      };
      deepLog('❌ SCRAPER ERROR RESULT', result);
      return result;
    }
  }

  // ============================================================
  // PHASE 1: DISCOVER MATCHES
  // ============================================================
  async discoverMatches() {
    logger.info('🔍 Phase 1: Discovering upcoming matches from homepage...');

    try {
      await this.page.goto(this.selectors.PAGE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      await this.page.waitForTimeout(3000);
      
      const debugDir = path.join(process.cwd(), 'debug');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      
      try {
        await this.page.screenshot({ path: path.join(debugDir, 'upcoming-page-screenshot.png'), fullPage: true });
        logger.info(`💾 Saved screenshot to debug/upcoming-page-screenshot.png`);
      } catch (e) {
        logger.warn(`Could not save screenshot: ${e.message}`);
      }

      try {
        const pageHtml = await this.page.content();
        fs.writeFileSync(path.join(debugDir, 'upcoming-page.html'), pageHtml);
        logger.info(`💾 Saved page HTML to debug/upcoming-page.html for inspection`);
      } catch (e) {
        logger.warn(`Could not save HTML: ${e.message}`);
      }

    } catch (error) {
      logger.error(`❌ Failed to load homepage: ${error.message}`);
      return [];
    }

    const result = await this.page.evaluate(() => {
      const matches = [];
      const cards = document.querySelectorAll('.live-card');
      const skipped = {
        completed: [],
        live: [],
        other: []
      };
      
      const getText = (el) => {
        if (!el) return '';
        return el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
      };

      const cleanText = (text) => {
        if (!text) return '';
        return text.replace(/\s+/g, ' ').trim();
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

      const isCompletedMatch = (cardText, url) => {
        const completedIndicators = [
          'Summary', 'won by', 'Match Won', 'Player of the Match',
          'Result', 'Innings Break', 'Stumps', 'Match Summary', 'Match Ended', 'completed'
        ];
        
        for (const indicator of completedIndicators) {
          if (cardText.includes(indicator)) return true;
        }
        
        if (url && url.includes('summary')) return true;
        
        const scorePattern = /\d{1,3}[-\/]\d{1,2}\s*\([\d.]+\s*overs?\)/i;
        if (scorePattern.test(cardText)) {
          const resultWords = ['won', 'result', 'summary', 'completed'];
          for (const word of resultWords) {
            if (cardText.toLowerCase().includes(word)) return true;
          }
        }
        
        return false;
      };

      const isLiveMatch = (cardText) => {
        const liveIndicators = [
          'Live', 'LIVE', 'Need', 'Target', 'CRR', 'RRR',
          'Run Rate', 'Probability', 'Projected Score', 'Commentary',
          'Current Run Rate', 'Required Run Rate'
        ];
        
        for (const indicator of liveIndicators) {
          if (cardText.includes(indicator)) return true;
        }
        return false;
      };

      const isUpcomingMatch = (cardText) => {
        const timePatterns = [
          /\d{1,2}:\d{2}\s*(?:AM|PM)/i,
          /\d{1,2}\s*(?:AM|PM)/i,
          /\d+[mh]\s*\d+[s]?/i,
          /\d+[mh]/i
        ];
        
        for (const pattern of timePatterns) {
          if (pattern.test(cardText)) return true;
        }
        
        const upcomingIndicators = ['Starts in', 'Starting in', 'Match Starts', 'Today', 'Tomorrow'];
        for (const indicator of upcomingIndicators) {
          if (cardText.includes(indicator)) return true;
        }
        
        return false;
      };

      cards.forEach((card) => {
        const cardText = getText(card);
        const matchUrl = getMatchUrl(card);
        
        if (!matchUrl) return;
        
        if (cardText.includes('Advertisement') || 
            cardText.includes('News') || 
            cardText.includes('Video') || 
            cardText.includes('Photo') ||
            cardText.includes('Podcast')) {
          return;
        }

        if (isCompletedMatch(cardText, matchUrl)) {
          skipped.completed.push({ text: cardText.substring(0, 100), url: matchUrl });
          return;
        }

        if (isLiveMatch(cardText)) {
          skipped.live.push({ text: cardText.substring(0, 100), url: matchUrl });
          return;
        }

        if (!isUpcomingMatch(cardText)) {
          skipped.other.push({ text: cardText.substring(0, 100), url: matchUrl });
          return;
        }

        let team1Name = '';
        let team2Name = '';

        const vsMatch = cardText.match(/([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)/i);
        if (vsMatch) {
          team1Name = cleanText(vsMatch[1]);
          team2Name = cleanText(vsMatch[2]);
        }

        if (!team1Name || !team2Name) {
          const vsInParen = cardText.match(/([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)\s*\(/i);
          if (vsInParen) {
            team1Name = cleanText(vsInParen[1]);
            team2Name = cleanText(vsInParen[2]);
          }
        }

        if (!team1Name || !team2Name) {
          const teamSelectors = ['.team-name', '.teamName', '.name', '.team', '.cb-team-name'];
          const teamNames = [];
          
          for (const selector of teamSelectors) {
            const elements = card.querySelectorAll(selector);
            elements.forEach(el => {
              const text = cleanText(getText(el));
              if (text && text.length > 1 && text.length < 30 && !text.includes('vs')) {
                teamNames.push(text);
              }
            });
            if (teamNames.length >= 2) break;
          }

          if (teamNames.length >= 2) {
            team1Name = teamNames[0];
            team2Name = teamNames[1];
          }
        }

        const flags = [];
        const flagImages = card.querySelectorAll('img[src*="Teams"], img[src*="cricketvectors"], .team-flag img, .flag img');
        flagImages.forEach(img => {
          const src = img.getAttribute('src') || '';
          if (src && (src.includes('Teams') || src.includes('cricketvectors'))) {
            flags.push(src);
          }
        });

        let series = '';
        const seriesMatch = cardText.match(/([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)\s+(\d{4})/i);
        if (seriesMatch) {
          series = `${cleanText(seriesMatch[1])} vs ${cleanText(seriesMatch[2])} ${seriesMatch[3]}`;
        }

        if (team1Name && team2Name) {
          matches.push({
            url: matchUrl,
            team1: {
              name: team1Name,
              flag: flags[0] || ''
            },
            team2: {
              name: team2Name,
              flag: flags[1] || ''
            },
            series: series
          });
        }
      });

      return { matches, skipped };
    });

    if (result.skipped.completed.length > 0) {
      this.stats.skippedCompleted = result.skipped.completed.length;
      logger.info(`  ⏭️ Skipped ${result.skipped.completed.length} completed matches`);
      result.skipped.completed.slice(0, 3).forEach((item, index) => {
        logger.info(`    ${index + 1}. [Completed] ${item.text.substring(0, 50)}...`);
      });
      if (result.skipped.completed.length > 3) {
        logger.info(`    ... and ${result.skipped.completed.length - 3} more`);
      }
    }

    if (result.skipped.live.length > 0) {
      this.stats.skippedLive = result.skipped.live.length;
      logger.info(`  ⏭️ Skipped ${result.skipped.live.length} live matches`);
      result.skipped.live.slice(0, 3).forEach((item, index) => {
        logger.info(`    ${index + 1}. [Live] ${item.text.substring(0, 50)}...`);
      });
      if (result.skipped.live.length > 3) {
        logger.info(`    ... and ${result.skipped.live.length - 3} more`);
      }
    }

    if (result.skipped.other.length > 0) {
      this.stats.skippedOther = result.skipped.other.length;
      logger.info(`  ⏭️ Skipped ${result.skipped.other.length} other non-upcoming matches`);
    }

    logger.info(`✅ Discovered ${result.matches.length} upcoming matches`);
    
    if (result.matches.length > 0) {
      result.matches.forEach((match, index) => {
        logger.info(`  ${index + 1}. ${match.team1.name} vs ${match.team2.name} - ${match.url}`);
      });
    }

    deepLog(`PHASE 1 - Discovered ${result.matches.length} upcoming matches`, result.matches);
    return result.matches;
  }

  // ============================================================
  // PHASE 2: EXTRACT DETAILS FROM MATCH PAGES
  // ============================================================
  async extractMatchDetails(discoveredMatches) {
    logger.info('🔍 Phase 2: Extracting details from match pages...');
    
    const fullMatches = [];

    for (let i = 0; i < discoveredMatches.length; i++) {
      const discovered = discoveredMatches[i];
      logger.info(`  📄 Processing match ${i + 1}/${discoveredMatches.length}: ${discovered.url}`);

      try {
        await this.page.goto(discovered.url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        await this.page.waitForTimeout(3000);

        const detailData = await this.extractDetailedMatchData();
        const playersData = await this.extractPlayersFromTabs();
        
        let weather = null;
        if (detailData.venue || detailData.series || detailData.matchTitle || 
            detailData.team1.name || detailData.team2.name) {
          logger.info(`    🌤️ Requesting weather for match:`);
          logger.info(`       Venue: "${detailData.venue || 'TBD'}"`);
          logger.info(`       Series: "${detailData.series || 'N/A'}"`);
          logger.info(`       Teams: ${detailData.team1.name || 'N/A'} vs ${detailData.team2.name || 'N/A'}`);
          
          weather = await this.getWeather(
            detailData.venue,
            detailData.series,
            detailData.matchTitle,
            detailData.team1.name,
            detailData.team2.name
          );
          
          if (weather) {
            logger.info(`    ✅ Weather obtained for this match`);
          } else {
            logger.warn(`    ❌ No weather available for this match`);
          }
        } else {
          logger.debug(`    ⏭️ No location information available, skipping weather`);
        }
        
        const formattedMatch = await this.formatMatchData(discovered, detailData, playersData, weather);
        fullMatches.push(formattedMatch);
        
        const teamNames = Object.keys(playersData);
        logger.info(`    ✅ Extracted: ${formattedMatch.teams.home.name} vs ${formattedMatch.teams.away.name}`);
        logger.info(`       Venue: ${formattedMatch.venue.name || 'N/A'}`);
        logger.info(`       Start Time: ${formattedMatch.match.start_time || 'N/A'}`);
        logger.info(`       Weather: ${weather ? `${weather.temperature}°C, ${weather.condition}` : 'Not Available'}`);
        logger.info(`       Players: ${teamNames.map(t => `${t} (${playersData[t]?.length || 0})`).join(', ')}`);

        deepLog(`PHASE 2 - Match ${i + 1} Formatted Data`, formattedMatch);

        if (i < discoveredMatches.length - 1) {
          await this.page.waitForTimeout(1000);
        }

      } catch (error) {
        logger.error(`    ❌ Error processing match ${i + 1}: ${error.message}`);
        this.stats.errors++;
      }
    }

    deepLog(`PHASE 2 - ${fullMatches.length} upcoming matches collected`, fullMatches);
    return fullMatches;
  }

  // ============================================================
  // EXTRACT DETAILED MATCH DATA
  // ============================================================
  async extractDetailedMatchData() {
    return await this.page.evaluate(() => {
      const getText = (el) => {
        if (!el) return '';
        return el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
      };

      const cleanText = (text) => {
        if (!text) return '';
        return text.replace(/\s+/g, ' ').trim();
      };

      const allText = document.body ? document.body.textContent.replace(/\s+/g, ' ').trim() : '';

      const data = {
        series: '',
        matchTitle: '',
        venue: '',
        rawMatchDate: '',
        date: '',
        startTime: '',
        countdownText: '',
        result: '',
        winningTeam: '',
        margin: '',
        team1: { name: '', flag: '', score: '' },
        team2: { name: '', flag: '', score: '' }
      };

      const seriesSelectors = ['.series-name', '.snameTag', '.match-series', '.series-title', '.tournament', '.series', '.match-tournament'];
      for (const selector of seriesSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          data.series = cleanText(getText(el));
          if (data.series) break;
        }
      }

      const titleSelectors = ['h1', '.match-title', '.match-header h1', '.title', '.match-heading'];
      for (const selector of titleSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          data.matchTitle = cleanText(getText(el));
          if (data.matchTitle) break;
        }
      }

      const venueSelectors = [
        '.venue', '.match-venue', '.venue-name', '.location', '.stadium',
        '.match-location', '.matchInfo', '.match-details', '.info-row',
        '.venue-info', '.meta-info', '.scorecard-header',
        '[data-testid*="venue"]', '[class*="venue"]', '[class*="location"]'
      ];
      
      for (const selector of venueSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const text = cleanText(getText(el));
          if (text && text.length > 3 && 
              !text.includes('Over') && 
              !text.includes('wd') &&
              !text.match(/^\d/)) {
            data.venue = text;
            break;
          }
        }
        if (data.venue) break;
      }

      if (!data.venue) {
        const venuePatterns = [
          /Venue:\s*([^,\n]+(?:,[^,\n]+)?)/i,
          /at\s+([A-Za-z\s,]+(?:Stadium|Ground|Park|Gardens|Oval))/i,
          /Stadium:\s*([^,\n]+)/i,
          /Ground:\s*([^,\n]+)/i
        ];
        for (const pattern of venuePatterns) {
          const match = allText.match(pattern);
          if (match && match[1]) {
            data.venue = cleanText(match[1]);
            break;
          }
        }
      }

      // Extract raw match date - exactly as displayed on CREX
      const dateElement = document.querySelector('.match-date > div');
      if (dateElement) {
        const dateText = dateElement.textContent.trim();
        if (dateText && dateText.length > 0) {
          data.rawMatchDate = dateText;
          data.date = dateText;
          const timeMatch = dateText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)|\d{1,2}\s*(?:AM|PM))/i);
          if (timeMatch) {
            data.startTime = timeMatch[0];
          }
        }
      }

      // Fallback date selectors
      if (!data.rawMatchDate) {
        const dateSelectors = [
          '.match-date',
          '.date',
          '.schedule-date',
          '.day',
          '.fixture-date',
          '.start-date'
        ];
        for (const selector of dateSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            const text = cleanText(getText(el));
            if (text && text.length > 3) {
              data.rawMatchDate = text;
              data.date = text;
              const timeMatch = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)|\d{1,2}\s*(?:AM|PM))/i);
              if (timeMatch) {
                data.startTime = timeMatch[0];
              }
              break;
            }
          }
        }
      }

      // Fallback: Find "Today" or "Tomorrow" pattern
      if (!data.rawMatchDate) {
        const todayMatch = allText.match(/(Today|Tomorrow|\w+day),\s*\d{1,2}:\d{2}\s*(?:AM|PM)/i);
        if (todayMatch) {
          data.rawMatchDate = todayMatch[0];
          data.date = todayMatch[0];
          const timeMatch = todayMatch[0].match(/(\d{1,2}:\d{2}\s*(?:AM|PM)|\d{1,2}\s*(?:AM|PM))/i);
          if (timeMatch) {
            data.startTime = timeMatch[0];
          }
        }
      }

      const countdownSpans = document.querySelectorAll('.live-score-card span, .countdown-timer span, .match-timer span, .starts-in, .countdown');
      for (const span of countdownSpans) {
        const text = cleanText(getText(span));
        if (text && (text.match(/\d+[mh]\s*[:]?\s*\d+[s]?/) || text.match(/\d+[mh]/))) {
          data.countdownText = text;
          break;
        }
      }

      if (!data.countdownText) {
        const timePatterns = [
          /(\d+[mh]\s*[:]?\s*\d+[s]?)/i,
          /(\d+[mh])/i,
          /(\d+:\d{2})/
        ];
        for (const pattern of timePatterns) {
          const match = allText.match(pattern);
          if (match) {
            data.countdownText = cleanText(match[0]);
            break;
          }
        }
      }

      const teamContainers = document.querySelectorAll('.team-container, .team-info, .match-teams .team, .team-profile');
      
      if (teamContainers.length >= 2) {
        const team1El = teamContainers[0];
        const team2El = teamContainers[1];
        
        const name1El = team1El.querySelector('.team-name, .name, .team-title, .team-label');
        if (name1El) data.team1.name = cleanText(getText(name1El));
        
        const flag1El = team1El.querySelector('img');
        if (flag1El) data.team1.flag = flag1El.getAttribute('src') || '';
        
        const score1El = team1El.querySelector('.score, .team-score, .runs');
        if (score1El) data.team1.score = cleanText(getText(score1El));

        const name2El = team2El.querySelector('.team-name, .name, .team-title, .team-label');
        if (name2El) data.team2.name = cleanText(getText(name2El));
        
        const flag2El = team2El.querySelector('img');
        if (flag2El) data.team2.flag = flag2El.getAttribute('src') || '';
        
        const score2El = team2El.querySelector('.score, .team-score, .runs');
        if (score2El) data.team2.score = cleanText(getText(score2El));
      }

      const resultSelectors = ['.result', '.match-result', '.cb-result', '.status-text'];
      for (const selector of resultSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          const resultText = cleanText(getText(el));
          data.result = resultText;
          
          const winMatch = resultText.match(/([A-Za-z\s]+)\s+won/i);
          if (winMatch) {
            data.winningTeam = cleanText(winMatch[1]);
          }
          
          const marginMatch = resultText.match(/won by\s+([\d\s]+(?:runs|wickets))/i);
          if (marginMatch) {
            data.margin = cleanText(marginMatch[1]);
          }
          break;
        }
      }

      return data;
    });
  }

  // ============================================================
  // EXTRACT PLAYERS FROM TEAM TABS
  // ============================================================
  async extractPlayersFromTabs() {
    logger.info('    🏏 Extracting players from team tabs...');
    
    const playersData = {};
    let teamTabsFound = false;

    try {
      // Wait for the squad tabs to be fully rendered
      await this.page.waitForSelector('.playingxi-button, .tab-item, .team-tab, .playingxi-tab, [role="tab"]', {
        timeout: 10000
      }).catch(() => {
        logger.warn('    ⚠️ Squad tabs not found after waiting');
      });
      
      // Additional wait for React to render
      await this.page.waitForTimeout(1000);
      
      // Find all team tabs
      const tabs = await this.page.$$('.playingxi-button, .tab-item, .team-tab, .playingxi-tab, [role="tab"]');
      
      if (tabs.length < 2) {
        logger.warn('    ⚠️ Less than 2 team tabs found, trying alternative selectors');
        const altTabs = await this.page.$$('.team-selector, .team-button, .team-tab-btn');
        if (altTabs.length >= 2) {
          teamTabsFound = true;
          await this.processTabs(altTabs, playersData);
        }
      } else {
        teamTabsFound = true;
        await this.processTabs(tabs, playersData);
      }

      if (!teamTabsFound) {
        logger.warn('    ⚠️ No team tabs found, trying to extract from visible content');
        const visiblePlayers = await this.extractVisiblePlayers();
        if (Object.keys(visiblePlayers).length > 0) {
          Object.assign(playersData, visiblePlayers);
        }
      }

    } catch (error) {
      logger.error(`    ❌ Error extracting players: ${error.message}`);
    }

    return playersData;
  }

  // ============================================================
  // PROCESS TEAM TABS
  // ============================================================
  async processTabs(tabs, playersData) {
    const tabCount = Math.min(tabs.length, 2);
    
    for (let i = 0; i < tabCount; i++) {
      try {
        // Get the team name from the tab label (visible text - this is the short name)
        const teamShortName = await this.page.evaluate((tab) => {
          return tab.textContent ? tab.textContent.replace(/\s+/g, ' ').trim() : '';
        }, tabs[i]);

        if (!teamShortName) {
          logger.warn(`    ⚠️ Could not extract team short name for tab ${i + 1}`);
          continue;
        }

        logger.info(`    📋 Processing tab: ${teamShortName}`);

        // Click the tab and wait for content to render
        await tabs[i].click();
        await this.page.waitForTimeout(1000); // Wait for React to re-render
        
        // Wait for player cards to appear
        try {
          await this.page.waitForSelector('.playingxi-card .player-card, .playingxi-card-row .player-card, .player-card', {
            timeout: 5000
          });
        } catch (e) {
          logger.warn(`    ⚠️ No player cards found for ${teamShortName} after clicking`);
        }

        const players = await this.extractPlayersFromActiveTab(teamShortName);
        
        if (players.length > 0) {
          playersData[teamShortName] = players;
          logger.info(`    ✅ Extracted ${players.length} players for ${teamShortName}`);
          players.slice(0, 3).forEach((p, idx) => {
            const hasImage = p.image ? ' [has image]' : '';
            const hasProfile = p.profile_url ? ' [has profile]' : '';
            logger.info(`       ${idx + 1}. ${p.name} (${p.role})${hasImage}${hasProfile}`);
          });
          if (players.length > 3) {
            logger.info(`       ... and ${players.length - 3} more`);
          }
        } else {
          logger.warn(`    ⚠️ No players found for ${teamShortName}`);
        }

      } catch (error) {
        logger.error(`    ❌ Error processing tab ${i + 1}: ${error.message}`);
      }
    }
  }

  // ============================================================
  // EXTRACT PLAYERS FROM ACTIVE TAB
  // ============================================================
  async extractPlayersFromActiveTab(teamShortName) {
    return await this.page.evaluate((teamShortName) => {
      const getText = (el) => {
        if (!el) return '';
        return el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
      };

      const cleanText = (text) => {
        if (!text) return '';
        return text.replace(/\s+/g, ' ').trim();
      };

      const cleanPlayerName = (name) => {
        if (!name) return '';
        
        // Normalize spaces
        let cleaned = name.replace(/\s+/g, ' ').trim();
        
        // Add space before ✈️ if missing
        cleaned = cleaned.replace(/✈️/g, ' ✈️').replace(/\s+/g, ' ').trim();
        
        // Ensure spaces around (C) and (WK)
        cleaned = cleaned.replace(/\(C\)/g, ' (C) ').replace(/\s+/g, ' ').trim();
        cleaned = cleaned.replace(/\(WK\)/g, ' (WK) ').replace(/\s+/g, ' ').trim();
        
        // Remove duplicate spaces
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        
        // Ensure proper spacing for multiple markers
        cleaned = cleaned.replace(/\)\s*\(/g, ') (').replace(/\s+/g, ' ').trim();
        
        return cleaned;
      };

      const isPlaceholderImage = (src) => {
        if (!src) return true;
        const patterns = [
          'playerPlaceholder.svg',
          'placeholder',
          'default-player',
          'default-avatar',
          'assets/img/playerPlaceholder'
        ];
        for (const pattern of patterns) {
          if (src.includes(pattern)) return true;
        }
        return false;
      };

      const getFullUrl = (path) => {
        if (!path) return '';
        if (path.startsWith('https://')) return path;
        if (path.startsWith('/')) return `https://crex.com${path}`;
        return `https://crex.com/${path}`;
      };

      const players = [];

      // Find player cards in the current tab
      const playerCards = document.querySelectorAll('.playingxi-card .player-card, .playingxi-card-row .player-card, .player-card');
      
      if (playerCards.length === 0) {
        const altCards = document.querySelectorAll('.player-card, .player-item, .player-info');
        for (const card of altCards) {
          const player = extractPlayerFromCard(card);
          if (player) {
            players.push(player);
          }
        }
        return players;
      }

      for (const card of playerCards) {
        const player = extractPlayerFromCard(card);
        if (player) {
          players.push(player);
        }
      }

      // Debug: Log raw player names for this team
      console.log(`   📝 Raw player names for ${teamShortName}:`, players.map(p => p.rawName || p.name));

      return players;

      function extractPlayerFromCard(card) {
        const nameEl = card.querySelector('.p-name, .player-name, .name');
        const rawName = nameEl ? cleanText(getText(nameEl)) : '';
        
        if (!rawName) return null;

        // Clean the name while preserving (C), (WK), ✈️
        const cleanedName = cleanPlayerName(rawName);
        
        // Extract role
        let role = 'Player';
        const roleEl = card.querySelector('.bat-ball-type, .bat-ball-typ, .role, .player-role');
        if (roleEl) {
          const roleText = cleanText(getText(roleEl));
          if (roleText) {
            // Only use valid role values
            const validRoles = ['Batter', 'Bowler', 'All Rounder', 'Wicket Keeper'];
            for (const validRole of validRoles) {
              if (roleText.includes(validRole) || validRole.includes(roleText)) {
                role = validRole;
                break;
              }
            }
            if (role === 'Player') {
              // If no match, use the extracted text
              role = roleText;
            }
          }
        }

        const player = {
          name: cleanedName,
          role: role,
          rawName: rawName // For debugging
        };

        // Extract image
        let image = '';
        const imgSelectors = [
          '.img-card app-player-profile-img img',
          '.img-card img',
          'picture img',
          'img[data-src]',
          'img[src]',
          'img[srcset]'
        ];
        
        for (const selector of imgSelectors) {
          const imgEl = card.querySelector(selector);
          if (imgEl) {
            const dataSrc = imgEl.getAttribute('data-src');
            const src = imgEl.getAttribute('src');
            const srcset = imgEl.getAttribute('srcset');
            
            let imgSrc = dataSrc || src || srcset;
            
            if (srcset && !dataSrc && !src) {
              const firstSrc = srcset.split(',')[0]?.trim()?.split(' ')[0];
              if (firstSrc) imgSrc = firstSrc;
            }
            
            if (imgSrc && !isPlaceholderImage(imgSrc)) {
              image = imgSrc;
              break;
            }
          }
        }

        if (image) {
          player.image = image;
        }

        let profileUrl = '';
        const profileEl = card.querySelector('a[href*="/player/"]');
        if (profileEl) {
          const href = profileEl.getAttribute('href');
          if (href) {
            profileUrl = getFullUrl(href);
          }
        }

        if (profileUrl) {
          player.profile_url = profileUrl;
        }

        return player;
      }
    }, teamShortName);
  }

  // ============================================================
  // EXTRACT VISIBLE PLAYERS (Fallback)
  // ============================================================
  async extractVisiblePlayers() {
    return await this.page.evaluate(() => {
      const getText = (el) => {
        if (!el) return '';
        return el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
      };

      const cleanText = (text) => {
        if (!text) return '';
        return text.replace(/\s+/g, ' ').trim();
      };

      const cleanPlayerName = (name) => {
        if (!name) return '';
        let cleaned = name.replace(/\s+/g, ' ').trim();
        cleaned = cleaned.replace(/✈️/g, ' ✈️').replace(/\s+/g, ' ').trim();
        cleaned = cleaned.replace(/\(C\)/g, ' (C) ').replace(/\s+/g, ' ').trim();
        cleaned = cleaned.replace(/\(WK\)/g, ' (WK) ').replace(/\s+/g, ' ').trim();
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        cleaned = cleaned.replace(/\)\s*\(/g, ') (').replace(/\s+/g, ' ').trim();
        return cleaned;
      };

      const isPlaceholderImage = (src) => {
        if (!src) return true;
        const patterns = [
          'playerPlaceholder.svg',
          'placeholder',
          'default-player',
          'default-avatar',
          'assets/img/playerPlaceholder'
        ];
        for (const pattern of patterns) {
          if (src.includes(pattern)) return true;
        }
        return false;
      };

      const getFullUrl = (path) => {
        if (!path) return '';
        if (path.startsWith('https://')) return path;
        if (path.startsWith('/')) return `https://crex.com${path}`;
        return `https://crex.com/${path}`;
      };

      const players = [];
      const playerCards = document.querySelectorAll('.player-card, .player-item, .playingxi-card-row .player-card');
      
      playerCards.forEach(card => {
        const nameEl = card.querySelector('.p-name, .player-name, .name');
        const fullName = nameEl ? cleanText(getText(nameEl)) : '';
        
        if (!fullName) return;

        const cleanedName = cleanPlayerName(fullName);
        
        let role = 'Player';
        const roleEl = card.querySelector('.bat-ball-type, .bat-ball-typ, .role, .player-role');
        if (roleEl) {
          const roleText = cleanText(getText(roleEl));
          if (roleText) {
            const validRoles = ['Batter', 'Bowler', 'All Rounder', 'Wicket Keeper'];
            for (const validRole of validRoles) {
              if (roleText.includes(validRole) || validRole.includes(roleText)) {
                role = validRole;
                break;
              }
            }
            if (role === 'Player') {
              role = roleText;
            }
          }
        }

        const player = {
          name: cleanedName,
          role: role
        };

        let image = '';
        const imgEl = card.querySelector('.img-card img, .player-image img, img');
        if (imgEl) {
          const dataSrc = imgEl.getAttribute('data-src');
          const src = imgEl.getAttribute('src');
          const imgSrc = dataSrc || src;
          if (imgSrc && !isPlaceholderImage(imgSrc)) {
            image = imgSrc;
          }
        }

        if (image) {
          player.image = image;
        }

        let profileUrl = '';
        const profileEl = card.querySelector('a[href*="/player/"]');
        if (profileEl) {
          const href = profileEl.getAttribute('href');
          if (href) {
            profileUrl = getFullUrl(href);
          }
        }

        if (profileUrl) {
          player.profile_url = profileUrl;
        }

        players.push(player);
      });

      return { 'Players': players };
    });
  }

  // ============================================================
  // FORMAT MATCH DATA - TOSS REMOVED
  // ============================================================
  async formatMatchData(discovered, detailData, playersData, weatherData) {
    const matchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const seriesId = `series_${Date.now()}`;
    const venueId = `venue_${Date.now()}`;
    
    // Generate team IDs dynamically
    const team1Id = this.generateTeamId(detailData.team1.name || discovered.team1.name);
    const team2Id = this.generateTeamId(detailData.team2.name || discovered.team2.name);
    
    // Determine format
    let format = 'T20';
    const titleText = detailData.matchTitle || `${detailData.team1.name} vs ${detailData.team2.name}`;
    if (titleText.includes('ODI')) format = 'ODI';
    else if (titleText.includes('Test')) format = 'Test';
    else if (titleText.includes('100B')) format = 'The Hundred';
    else if (titleText.includes('T10')) format = 'T10';
    else if (titleText.includes('First Class')) format = 'First Class';
    else if (titleText.includes('List A')) format = 'List A';
    
    let matchNumber = 'Match';
    const numberMatch = titleText.match(/(\d+(?:st|nd|rd|th)\s+(?:Match|TEST|ODI|T20|T10|100B))/i);
    if (numberMatch) {
      matchNumber = numberMatch[0];
    }
    
    let status = 'Upcoming';
    if (detailData.result) {
      status = 'Completed';
    } else if (detailData.countdownText && detailData.countdownText.toLowerCase().includes('live')) {
      status = 'Live';
    }
    
    // Keep the original start_time exactly as displayed on CREX
    const startTime = detailData.rawMatchDate || '';

    // Build players data - use the short names from the tabs as keys
    const players = playersData || {};

    // Debug: Log extracted data
    logger.info(`    📊 Extraction Debug:`);
    logger.info(`       Team Short Names: ${Object.keys(players).join(', ') || 'None'}`);
    logger.info(`       Team IDs: ${team1Id}, ${team2Id}`);
    logger.info(`       Series Name: ${detailData.series || discovered.series || 'Unknown'}`);
    
    // Clean up series short name - trim leading/trailing spaces and commas
    let seriesShortName = detailData.series || discovered.series || 'Unknown Series';
    seriesShortName = seriesShortName.replace(/^[\s,]+|[\s,]+$/g, '').trim();
    
    logger.info(`       Series Short Name: "${seriesShortName}"`);
    
    // Log player counts
    for (const [teamShortName, playerList] of Object.entries(players)) {
      logger.info(`       ${teamShortName} Players: ${playerList.length}`);
      if (playerList.length > 0) {
        const sampleNames = playerList.slice(0, 2).map(p => p.rawName || p.name);
        logger.info(`         Sample raw names: ${sampleNames.join(', ')}`);
        const sampleCleaned = playerList.slice(0, 2).map(p => p.name);
        logger.info(`         Sample cleaned names: ${sampleCleaned.join(', ')}`);
      }
    }

    // Get short names from the discovered data if available
    const homeShortName = detailData.team1.short || discovered.team1.short || 
                          Object.keys(players).find(k => k.includes(discovered.team1.name?.substring(0, 3))) || 
                          discovered.team1.name?.substring(0, 3).toUpperCase() || '';
    
    const awayShortName = detailData.team2.short || discovered.team2.short || 
                          Object.keys(players).find(k => k.includes(discovered.team2.name?.substring(0, 3))) || 
                          discovered.team2.name?.substring(0, 3).toUpperCase() || '';

    return {
      match_id: matchId,
      match_url: discovered.url,
      series: {
        id: seriesId,
        name: detailData.series || discovered.series || 'Unknown Series',
        short_name: seriesShortName,
        season: new Date().getFullYear().toString()
      },
      match: {
        number: matchNumber,
        format: format,
        status: status,
        start_time: startTime
      },
      venue: {
        id: venueId,
        name: detailData.venue || 'TBD'
      },
      teams: {
        home: {
          id: team1Id,
          name: detailData.team1.name || discovered.team1.name,
          short_name: homeShortName,
          logo: detailData.team1.flag || discovered.team1.flag || ''
        },
        away: {
          id: team2Id,
          name: detailData.team2.name || discovered.team2.name,
          short_name: awayShortName,
          logo: detailData.team2.flag || discovered.team2.flag || ''
        }
      },
      players: players,
      weather: weatherData || null
    };
  }

  // ============================================================
  // LOG STATISTICS
  // ============================================================
  logStatistics() {
    logger.info(`📊 Upcoming Scraper Statistics:`);
    logger.info(`   Discovered: ${this.stats.discovered}`);
    logger.info(`   Detailed extracted: ${this.stats.detailed}`);
    logger.info(`   Skipped Completed: ${this.stats.skippedCompleted}`);
    logger.info(`   Skipped Live: ${this.stats.skippedLive}`);
    logger.info(`   Skipped Other: ${this.stats.skippedOther}`);
    logger.info(`   Weather Success: ${this.stats.weatherSuccess}`);
    logger.info(`   Weather Failed: ${this.stats.weatherFailed}`);
    logger.info(`   Errors: ${this.stats.errors}`);
    logger.info(`   Success rate: ${this.stats.discovered > 0 ? Math.round((this.stats.detailed / this.stats.discovered) * 100) : 0}%`);
  }
}

module.exports = UpcomingScraper;
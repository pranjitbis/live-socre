// src/services/FlagService.js
const logger = require('../logger');

class FlagService {
  constructor() {
    // Country code mapping for cricket teams
    this.countryCodeMap = {
      // Full country names
      'India': 'IN',
      'Australia': 'AU',
      'England': 'GB',
      'Pakistan': 'PK',
      'New Zealand': 'NZ',
      'South Africa': 'ZA',
      'West Indies': 'WI',
      'Sri Lanka': 'LK',
      'Bangladesh': 'BD',
      'Afghanistan': 'AF',
      'Zimbabwe': 'ZW',
      'Ireland': 'IE',
      'Nepal': 'NP',
      'Namibia': 'NA',
      'Netherlands': 'NL',
      'Oman': 'OM',
      'Scotland': 'GB-SCT',
      'United Arab Emirates': 'AE',
      'United States': 'US',
      'Hong Kong': 'HK',
      'Kenya': 'KE',
      'Uganda': 'UG',
      'Tanzania': 'TZ',
      'Nigeria': 'NG',
      'Canada': 'CA',
      'Argentina': 'AR',
      'Brazil': 'BR',
      'Chile': 'CL',
      'Peru': 'PE',
      'Mexico': 'MX',
      'Spain': 'ES',
      'France': 'FR',
      'Germany': 'DE',
      'Italy': 'IT',
      'Portugal': 'PT',
      'Switzerland': 'CH',
      'Austria': 'AT',
      'Romania': 'RO',
      'Greece': 'GR',
      'Turkey': 'TR',
      
      // Team abbreviations
      'IND': 'IN',
      'AUS': 'AU',
      'ENG': 'GB',
      'PAK': 'PK',
      'NZ': 'NZ',
      'SA': 'ZA',
      'WI': 'WI',
      'SL': 'LK',
      'BAN': 'BD',
      'AFG': 'AF',
      'ZIM': 'ZW',
      'IRE': 'IE',
      'NEP': 'NP',
      'NAM': 'NA',
      'NED': 'NL',
      'OMA': 'OM',
      'SCO': 'GB-SCT',
      'UAE': 'AE',
      'USA': 'US',
      'HKG': 'HK',
      'KEN': 'KE',
      'UGA': 'UG',
      'TZN': 'TZ',
      'NGA': 'NG',
      'CAN': 'CA',
      'ARG': 'AR',
      'BRA': 'BR',
      'CHI': 'CL',
      'PER': 'PE',
      'MEX': 'MX',
      'ESP': 'ES',
      'FRA': 'FR',
      'GER': 'DE',
      'ITA': 'IT',
      'POR': 'PT',
      'SUI': 'CH',
      'AUT': 'AT',
      'ROM': 'RO',
      'GRE': 'GR',
      'TUR': 'TR',
      
      // Franchise teams (IPL, BBL, etc.) - these will return null
      'Mumbai Indians': null,
      'Chennai Super Kings': null,
      'Royal Challengers Bangalore': null,
      'Kolkata Knight Riders': null,
      'Rajasthan Royals': null,
      'Delhi Capitals': null,
      'Sunrisers Hyderabad': null,
      'Lucknow Super Giants': null,
      'Gujarat Titans': null,
      'Punjab Kings': null,
      'MI': null,
      'CSK': null,
      'RCB': null,
      'KKR': null,
      'RR': null,
      'DC': null,
      'SRH': null,
      'LSG': null,
      'GT': null,
      'PBKS': null,
      
      // BBL Teams
      'Sydney Sixers': null,
      'Sydney Thunder': null,
      'Brisbane Heat': null,
      'Adelaide Strikers': null,
      'Perth Scorchers': null,
      'Melbourne Stars': null,
      'Melbourne Renegades': null,
      'Hobart Hurricanes': null,
      
      // PSL Teams
      'Islamabad United': null,
      'Karachi Kings': null,
      'Lahore Qalandars': null,
      'Multan Sultans': null,
      'Peshawar Zalmi': null,
      'Quetta Gladiators': null,
      
      // CPL Teams
      'Trinbago Knight Riders': null,
      'Guyana Amazon Warriors': null,
      'Barbados Royals': null,
      'St Kitts and Nevis Patriots': null,
      'St Lucia Kings': null,
      'Jamaica Tallawahs': null,
      
      // SA20 Teams
      'Sunrisers Eastern Cape': null,
      'Durban Super Giants': null,
      'MI Cape Town': null,
      'Joburg Super Kings': null,
      'Paarl Royals': null,
      'Pretoria Capitals': null,
      
      // The Hundred Teams
      'Trent Rockets': null,
      'London Spirit': null,
      'Manchester Super Giants': null,
      'Southern Brave': null,
      'Welsh Fire': null,
      'Oval Invincibles': null,
      'Northern Superchargers': null,
      'Birmingham Phoenix': null,
    };
    
    this.flagBaseUrl = 'https://flagcdn.com/w320';
  }

  getCountryCode(teamName) {
    if (!teamName) return null;
    
    // Clean the team name
    const cleaned = teamName.trim().replace(/\s+/g, ' ');
    
    // Direct match
    if (this.countryCodeMap[cleaned]) {
      return this.countryCodeMap[cleaned];
    }
    
    // Partial match
    for (const [name, code] of Object.entries(this.countryCodeMap)) {
      if (cleaned.includes(name) || name.includes(cleaned)) {
        return code;
      }
    }
    
    // Check for common abbreviations
    const parts = cleaned.split(' ');
    for (const part of parts) {
      const upper = part.toUpperCase();
      if (this.countryCodeMap[upper]) {
        return this.countryCodeMap[upper];
      }
    }
    
    return null;
  }

  getFlagUrl(teamName) {
    const countryCode = this.getCountryCode(teamName);
    if (!countryCode) return null;
    return `${this.flagBaseUrl}/${countryCode}.png`;
  }

  isInternationalTeam(teamName) {
    const code = this.getCountryCode(teamName);
    // If it's a franchise team, code will be null
    return code !== null;
  }

  isFranchiseTeam(teamName) {
    return this.getCountryCode(teamName) === null;
  }

  getTeamType(teamName) {
    if (!teamName) return 'unknown';
    if (this.isInternationalTeam(teamName)) return 'international';
    if (this.isFranchiseTeam(teamName)) return 'franchise';
    return 'unknown';
  }
}

module.exports = new FlagService();
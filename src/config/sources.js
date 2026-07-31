// src/config/sources.js
module.exports = {
  cricbuzz: {
    name: 'Cricbuzz',
    baseUrl: 'https://www.cricbuzz.com',
    endpoints: {
      live: '/cricket-match/live-scores',
      upcoming: '/cricket-match/live-scores/upcoming-matches',
      scoreboard: '/cricket-scoreboard',
      match: '/cricket-match/{matchId}',
      commentary: '/cricket-match/{matchId}/commentary',
      scorecard: '/cricket-match/{matchId}/scorecard',
      stats: '/cricket-match/{matchId}/stats'
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive'
    },
    rateLimit: {
      requestsPerMinute: 30,
      delayBetweenRequests: 2000
    }
  },

  espncricinfo: {
    name: 'ESPNcricinfo',
    baseUrl: 'https://www.espncricinfo.com',
    endpoints: {
      live: '/live-cricket-score',
      fixtures: '/fixtures',
      series: '/series',
      match: '/match/{matchId}',
      commentary: '/match/{matchId}/commentary',
      scorecard: '/match/{matchId}/scorecard'
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive'
    },
    rateLimit: {
      requestsPerMinute: 20,
      delayBetweenRequests: 3000
    }
  },

  icc: {
    name: 'ICC',
    baseUrl: 'https://www.icc-cricket.com',
    endpoints: {
      matches: '/matches',
      match: '/match/{matchId}',
      stats: '/stats'
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive'
    },
    rateLimit: {
      requestsPerMinute: 15,
      delayBetweenRequests: 4000
    }
  },

  flashscore: {
    name: 'Flashscore',
    baseUrl: 'https://www.flashscore.com',
    endpoints: {
      cricket: '/cricket/',
      live: '/cricket/live',
      upcoming: '/cricket/upcoming',
      finished: '/cricket/finished'
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive'
    },
    rateLimit: {
      requestsPerMinute: 10,
      delayBetweenRequests: 5000
    }
  },

  cricketguru: {
    name: 'CricketGuru',
    baseUrl: 'https://www.cricketguru.com',
    endpoints: {
      live: '/live-scores',
      match: '/match/{matchId}',
      commentary: '/match/{matchId}/commentary',
      scorecard: '/match/{matchId}/scorecard',
      preview: '/match/{matchId}/preview',
      squads: '/match/{matchId}/squads',
      stats: '/match/{matchId}/stats'
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive'
    },
    rateLimit: {
      requestsPerMinute: 30,
      delayBetweenRequests: 2000
    }
  }
};
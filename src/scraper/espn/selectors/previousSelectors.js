// src/scraper/espn/selectors/previousSelectors.js

module.exports = {
  // Page URLs
  PAGE_URL: 'https://www.espncricinfo.com/ci/engine/match/index.html?view=week',
  RESULTS_API: 'https://www.espncricinfo.com/ci/engine/match/index.json?view=week',

  // Match list selectors - HTML fallback
  MATCH_LIST: {
    MATCH_BLOCK:
      '.match-info, .match-block, .match-score, .match-result, .match-card, .matches-list .match',
    MATCH_LINK: 'a[href*="/series/"], a[href*="/match/"], a[href*="/ci/engine/match/"]',
    COMPLETED_INDICATORS: ['won by', 'won', 'drawn', 'tied', 'match tied', 'super over'],
    UPCOMING_INDICATORS: [
      'scheduled to begin',
      'match scheduled',
      'starts at',
      'match begins',
      'scheduled',
      'to begin',
      'will begin',
    ],
    ABANDONED_INDICATORS: ['abandoned', 'no result', 'cancelled', 'postponed', 'called off'],
  },

  // Match detail page selectors
  MATCH_DETAILS: {
    SERIES_NAME:
      '.match-info .series-name, .match-header .series-name, .match-series a, .series-title',
    SERIES_LINK: '.match-info .series-name a, .match-header .series-name a, .match-series a',
    MATCH_TITLE: '.match-header h1, .match-info h1, .match-title, .match-name',
    MATCH_STATUS: '.match-status, .match-result-text, .status-text, .result-status',
    MATCH_FORMAT: '.match-format, .format-tag, .match-info .format, .format-name',
    START_DATE: '.match-date, .start-date, .match-info .date, .schedule-date',
    VENUE: '.match-venue, .venue, .venue-name, .match-location, .ground-name',
    VENUE_LINK: '.venue a, .match-venue a, .ground-name a',
    TEAM_CONTAINER: '.team, .team-container, .match-teams .team, .team-info, .team-profile',
    TEAM_NAME: '.team-name, .name, .team-title, .team-label',
    TEAM_SHORT: '.team-short, .short-name, .abbr, .team-code',
    TEAM_LOGO: '.team-logo img, .logo img, .team-img img, .team-badge img',
    TEAM_LINK: 'a[href*="/team/"], a[href*="/teams/"]',
    TOSS: '.toss, .toss-info, .match-info .toss, .toss-detail',
    RESULT: '.result, .match-result, .result-text, .match-status, .score-result',
    PLAYER_OF_MATCH: '.player-of-match, .mom, .match-info .mom, .pom',
    SCORECARD: '.scorecard, .score-card, .innings, .match-scorecard',
    INNINGS: '.innings, .inning, .scorecard-innings, .match-innings',
    BATTING_TABLE: '.batting-table, .scorecard-batting, .batting, .innings-batting',
    BOWLING_TABLE: '.bowling-table, .scorecard-bowling, .bowling, .innings-bowling',
    FALL_OF_WICKETS: '.fall-of-wickets, .fow, .wicket-log, .score-fow',
    PARTNERSHIPS: '.partnerships, .partnership-log, .partnerships-section, .score-partnerships',
    UMPIRES: '.umpires, .officials .umpires, .match-officials .umpires',
    MATCH_REFEREE: '.match-referee, .referee, .officials .referee',
    COMMENTARY_URL: 'a[href*="/commentary/"]',
    MATCH_INFO: '.match-info, .match-details, .info-section, .match-header',
  },
};

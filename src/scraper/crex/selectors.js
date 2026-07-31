// src/scraper/crex/selectors.js
module.exports = {
  // Listing page selectors
  LIVE_CARD: '.live-card',
  LIVE_CARD_WRAPPER: '.live-card-wrapper',
  LIVE_CARD_TOP: '.live-card-top',
  LIVE_CARD_MIDDLE: '.live-card-middle',
  LIVE_CARD_BOTTOM: '.live-card-bottom',

  // Team selectors
  TEAM_NAME: '.team-name',
  TEAM_SCORE: '.team-score',
  TEAM_FLAG: '.team-flag, .team-logo img',
  TEAM_SHORT: '.team-short, .team-code',

  // Match info selectors
  MATCH_STATUS: '.match-status, .match-over, .status',
  MATCH_TIME: '.match-time, .match-data, .time',
  MATCH_DATE: '.match-date, .date',
  MATCH_NUMBER: '.match-number, .match-desc',
  MATCH_TITLE: '.match-title, .match-header h1, .title',
  MATCH_SERIES: '.snameTag, .series-name, .series-title',

  // Link selectors
  MATCH_LINK: 'a[href*="/cricket-live-score/"]',
  SERIES_LINK: 'a[href*="/series/"]',

  // Venue
  VENUE: '.venue, .match-venue, .venue-name',

  // Toss
  TOSS: '.toss-info, .toss-detail, .toss',
  TOSS_WINNER: '.toss-winner, .toss-team',
  TOSS_DECISION: '.toss-decision, .toss-opt',

  // Officials
  OFFICIALS: '.officials, .match-officials',
  UMPIRES: '.umpires, .umpire',
  THIRD_UMPIRE: '.third-umpire',
  MATCH_REFEREE: '.match-referee, .referee',

  // Player of Match
  PLAYER_OF_MATCH: '.player-of-match, .pom, .mom',
  POM_NAME: '.pom-name, .player-name',
  POM_IMAGE: '.pom-image img, .player-image img',
  POM_PROFILE: '.pom-profile, .player-profile',

  // Result
  RESULT: '.result, .match-result, .result-text',
  WINNING_TEAM: '.winning-team, .winner',
  MARGIN: '.margin, .win-margin',

  // Scoreboard
  SCOREBOARD: '.scoreboard, .match-score, .score-card',
  INNINGS: '.innings, .inning, .inngs',
  OVERS: '.overs, .over',
  RUNS: '.runs, .score',
  WICKETS: '.wickets, .wkts',

  // Commentary
  COMMENTARY: '.commentary, .commentary-link',
  SCORECARD: '.scorecard, .scorecard-link',
  PREVIEW: '.preview, .preview-link',
  SQUADS: '.squads, .squads-link',
  STATISTICS: '.stats, .stats-link',

  // Navigation
  NAV_SERIES: '.series-nav, .breadcrumb',
  NAV_MATCH: '.match-nav, .match-tabs',
};

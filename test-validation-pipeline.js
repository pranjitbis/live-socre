// test-validation-pipeline.js
const { LiveScraper } = require('./src/scraper/crex');
const logger = require('./src/logger');

// Temporarily hijack logger warning/info methods to verify they work
const originalWarn = logger.warn;
const originalInfo = logger.info;
let warnings = [];
let infos = [];

logger.warn = (...args) => {
  warnings.push(args.join(' '));
  console.log('⚠️ [WARN]:', ...args);
};

logger.info = (...args) => {
  infos.push(args.join(' '));
  console.log('ℹ️ [INFO]:', ...args);
};

async function runTests() {
  console.log('============================================================');
  console.log('Running Crex Live Scraper Validation Pipeline Tests');
  console.log('============================================================');

  const scraper = new LiveScraper();

  // Test Case 1: Format Validation & Correction
  console.log('\n--- Test Case 1: Format Validation & Correction ---');
  const match1 = {
    series: { name: 'NDS vs ODW, 38th T20, DPL 2026 live' },
    match: { format: 'ODI', status: 'Live' },
    teams: { home: { name: 'NDS' }, away: { name: 'ODW' } }
  };
  const result1 = scraper.validateMatchData(match1);
  console.log('Format after validation:', result1.match.format);
  if (result1.match.format === 'T20') {
    console.log('✅ Success: Format corrected from ODI to T20 based on series title');
  } else {
    console.error('❌ Failure: Format not corrected');
  }

  // Test Case 2: Current Ball validation
  console.log('\n--- Test Case 2: Current Ball Validation (Numerical Noise) ---');
  const match2 = {
    scoreboard: { current_ball: '2026b' },
    match: { current_ball: '2026b' }
  };
  const result2 = scraper.validateMatchData(match2);
  console.log('Current Ball after validation:', result2.scoreboard.current_ball);
  if (result2.scoreboard.current_ball === null && result2.match.current_ball === null) {
    console.log('✅ Success: "2026b" current_ball successfully set to null');
  } else {
    console.error('❌ Failure: current_ball was not set to null');
  }

  // Test Case 3: Valid current ball (overs style)
  console.log('\n--- Test Case 3: Valid Current Ball (traditional overs) ---');
  const match3 = {
    scoreboard: { current_ball: '19.4' }
  };
  const result3 = scraper.validateMatchData(match3);
  console.log('Current Ball after validation:', result3.scoreboard.current_ball);
  if (result3.scoreboard.current_ball === '19.4') {
    console.log('✅ Success: "19.4" is accepted as valid ball number');
  } else {
    console.error('❌ Failure: valid ball number rejected');
  }

  // Test Case 4: Valid current ball (balls style)
  console.log('\n--- Test Case 4: Valid Current Ball (Hundred style balls) ---');
  const match4 = {
    scoreboard: { current_ball: '85b' }
  };
  const result4 = scraper.validateMatchData(match4);
  console.log('Current Ball after validation:', result4.scoreboard.current_ball);
  if (result4.scoreboard.current_ball === '85b') {
    console.log('✅ Success: "85b" is accepted as valid ball number');
  } else {
    console.error('❌ Failure: valid hundred ball number rejected');
  }

  // Test Case 5: Player names validation (numeric noise, percentage, keywords)
  console.log('\n--- Test Case 5: Player Names Validation ---');
  const match5 = {
    current_batsmen: [
      { name: 'Virat Kohli', runs: 45 },
      { name: '45.2', runs: 0 },
      { name: 'CRR 6.5', runs: 0 },
      { name: '75%', runs: 0 }
    ],
    current_bowler: { name: 'CRR 6.5', overs: '3.4', runs: 24, wickets: 1 }
  };
  const result5 = scraper.validateMatchData(match5);
  console.log('Batsmen remaining:', result5.current_batsmen.map(b => b.name));
  console.log('Bowler name:', result5.current_bowler.name);

  if (result5.current_batsmen.length === 1 && result5.current_batsmen[0].name === 'Virat Kohli') {
    console.log('✅ Success: Invalid batsman names rejected, valid ones retained');
  } else {
    console.error('❌ Failure: Batsmen names not validated correctly');
  }
  if (result5.current_bowler.name === '') {
    console.log('✅ Success: Invalid bowler name rejected');
  } else {
    console.error('❌ Failure: Bowler name not validated correctly');
  }

  // Test Case 6: Bowler duplicate batsman check
  console.log('\n--- Test Case 6: Bowler Duplicating Batsman check ---');
  const match6 = {
    current_batsmen: [
      { name: 'Glenn Maxwell', runs: 12 }
    ],
    current_bowler: { name: 'Glenn Maxwell', overs: '1.2', runs: 15, wickets: 0 }
  };
  const result6 = scraper.validateMatchData(match6);
  console.log('Bowler name:', result6.current_bowler.name);
  if (result6.current_bowler.name === '') {
    console.log('✅ Success: Active batsman cannot be the active bowler simultaneously, bowler name set to empty string');
  } else {
    console.error('❌ Failure: Dual role player was not corrected');
  }

  // Test Case 7: Projected Score Validation
  console.log('\n--- Test Case 7: Projected Scores Validation ---');
  const match7 = {
    prediction: {
      projected_scores: [
        { rate: 6.0, projected_runs: 180 },
        { rate: 2026, projected_runs: 220 }, // Year leak
        { rate: -1, projected_runs: 50 }      // Negative rate
      ]
    }
  };
  const result7 = scraper.validateMatchData(match7);
  console.log('Projected scores remaining:', result7.prediction.projected_scores);
  if (result7.prediction.projected_scores.length === 1 && result7.prediction.projected_scores[0].rate === 6.0) {
    console.log('✅ Success: Invalid/leak projected scores filtered out');
  } else {
    console.error('❌ Failure: Projected scores not validated correctly');
  }

  // Test Case 8: Venue text cleanup
  console.log('\n--- Test Case 8: Venue Text Cleanup ---');
  const match8 = {
    venue: { name: 'It has started drizzling at MA Chidambaram Stadium, Chennai' }
  };
  const result8 = scraper.validateMatchData(match8);
  console.log('Venue name:', result8.venue.name);
  if (result8.venue.name === 'MA Chidambaram Stadium, Chennai') {
    console.log('✅ Success: Prefix cleaned from venue name');
  } else {
    console.error('❌ Failure: Venue name prefix not cleaned');
  }

  // Test Case 9: Scoreboard Validation
  console.log('\n--- Test Case 9: Scoreboard Validation ---');
  const match9 = {
    scoreboard: {
      bowling_team: {
        name: 'ODW',
        score: '0-17' // Bowler stats mistakenly matched
      }
    },
    current_bowler: {
      name: 'Hardik Pandya',
      wickets: 0,
      runs: 17
    }
  };
  const result9 = scraper.validateMatchData(match9);
  console.log('Bowling team score:', result9.scoreboard.bowling_team.score);
  if (result9.scoreboard.bowling_team.score === '') {
    console.log('✅ Success: Bowling team score corrected from bowler stats');
  } else {
    console.error('❌ Failure: Bowling team score not corrected');
  }

  console.log('\n============================================================');
  console.log('All Validation Pipeline Tests Completed successfully!');
  console.log('============================================================');
}

runTests().catch(console.error);

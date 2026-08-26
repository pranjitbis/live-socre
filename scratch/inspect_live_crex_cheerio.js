const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const htmlPath = path.join(__dirname, '..', 'debug', 'live-page.html');
if (!fs.existsSync(htmlPath)) {
  console.error('live-page.html not found');
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const $ = cheerio.load(html);

console.log('=== Checking all team-inning elements ===');
$('.team-inning').each((i, el) => {
  console.log(`\nInning ${i}:`);
  console.log('Class:', $(el).attr('class'));
  console.log('Text:', $(el).text().trim().replace(/\s+/g, ' '));
  console.log('Outer HTML:', $.html(el).substring(0, 500));
});

console.log('\n=== Checking live-score-card, scoreboard, match-header ===');
console.log('liveScoreCard count:', $('.live-score-card, .scoreboard, .match-header').length);
$('.live-score-card, .scoreboard, .match-header').each((i, el) => {
  console.log(`\nCard ${i}:`);
  console.log('Class:', $(el).attr('class'));
  console.log('Team Innings inside:', $(el).find('.team-inning').length);
});

console.log('\n=== Checking other team result / inning containers ===');
$('.team-result, .team-innig, .team-inning-card').each((i, el) => {
  console.log(`\nContainer ${i}:`);
  console.log('Tag:', el.name);
  console.log('Class:', $(el).attr('class'));
  console.log('Text:', $(el).text().trim().replace(/\s+/g, ' '));
});

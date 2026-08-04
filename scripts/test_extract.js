const axios = require('axios');
const cheerio = require('cheerio');
axios.get('https://db-all-prod-p.s3.us-east-2.amazonaws.com/comps/327/117917/results-all-results.html').then(({data}) => {
  const $ = cheerio.load(data);
  let loc = $('div[style*="24px"]').first().text().trim().replace(/\s+/g, ' ');
  if (!loc) loc = $('table').first().text().trim().replace(/\s+/g, ' ');
  console.log('EXTRACTED:', loc);
});

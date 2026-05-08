require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');

async function testYDPAA() {
  const url = 'https://www.ydpaa.com/';
  console.log('Fetching', url);
  const response = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    timeout: 10000
  });

  const $ = cheerio.load(response.data);
  let contactHref = $('a').filter(function() {
    return (/contact/i).test($(this).attr('href') || '') || (/contact/i).test($(this).text() || '');
  }).first().attr('href');
  
  console.log('contactHref found:', contactHref);
  
  if (contactHref) {
    let contactUrl = new URL(contactHref, url).href;
    console.log('contactUrl resolved:', contactUrl);
    
    if (contactUrl && contactUrl.startsWith('http')) {
      const contactRes = await axios.get(contactUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 10000
      });
      const $c = cheerio.load(contactRes.data);
      let mailtoEmail = null;
      $c('a').each((i, el) => {
        const href = $c(el).attr('href');
        if (href && href.toLowerCase().includes('mailto:')) {
          mailtoEmail = href.toLowerCase().split('mailto:')[1].split('?')[0].trim();
          return false;
        }
      });
      console.log('Mailto on contact page:', mailtoEmail);
    }
  }
}

testYDPAA().catch(console.error);

const axios = require('axios');
const cheerio = require('cheerio');
axios.get('https://yagp.org/winners/').then(r=>{
  const $ = cheerio.load(r.data);
  $('a').each((i, el)=>{
    const href = $(el).attr('href');
    if(href && (href.includes('winner') || href.includes('season'))) {
      console.log($(el).text().trim() + ' -> ' + href);
    }
  });
}).catch(console.error);

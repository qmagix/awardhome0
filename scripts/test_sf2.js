const axios = require('axios');
const cheerio = require('cheerio');
axios.get('https://yagp.org/yagp-2025-san-francisco-ca-march-winners/').then(r=>{
  const $ = cheerio.load(r.data);
  $('table tr').each((i, el)=>{
    const text = $(el).text();
    if(text.includes('Never Divide')) {
      console.log($(el).html().replace(/\s+/g, ' '));
    }
  });
});

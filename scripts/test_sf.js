const axios = require('axios');
const cheerio = require('cheerio');
axios.get('https://yagp.org/yagp-2025-san-francisco-ca-march-winners/').then(r=>{
  const $ = cheerio.load(r.data);
  $('table tr').each((i, el)=>{
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if(text.includes('Peasant Pas De Deux') || text.includes('Never Divide') || text.includes('PAS DE DEUX CATEGORY')) {
      console.log('--- row ---');
      $(el).find('td').each((j, td) => console.log(j, $(td).text().replace(/\s+/g, ' ').trim()));
    }
  });
});

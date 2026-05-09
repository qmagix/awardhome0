const axios = require('axios');
const cheerio = require('cheerio');
axios.get('https://yagp.org/yagp-2025-san-francisco-ca-march-winners/').then(r=>{
  const $ = cheerio.load(r.data);
  let pas = false;
  $('table tr').each((i, el)=>{
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if(text.includes('PAS DE DEUX CATEGORY')) pas = true;
    if(text.includes('LARGE ENSEMBLES')) pas = false;
    
    if(pas) {
      let cols = [];
      $(el).find('td').each((j, td) => cols.push($(td).text().replace(/\s+/g, ' ').trim()));
      console.log(cols.join(' | '));
    }
  });
});

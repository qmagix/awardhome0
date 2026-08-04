require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');

async function searchDuckDuckGo(query) {
  try {
    const response = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const $ = cheerio.load(response.data);
    const results = [];
    $('.result__url').each((i, elem) => {
      let urlText = $(elem).text().trim();
      if (urlText) {
        if (!urlText.startsWith('http')) urlText = 'https://' + urlText;
        results.push(urlText);
      }
    });
    return results.length > 0 ? results[0] : null;
  } catch (err) {
    return null;
  }
}

async function extractContactInfo(url) {
  let response;
  let finalUrl = url;
  
  try {
    response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 10000
    });
  } catch (error) {
    return { email: null, phone: null, address: null, finalUrl: url };
  }

  try {
    const $ = cheerio.load(response.data);
    
    // Extract mailto: links before removing HTML tags (case-insensitive, whitespace tolerant)
    let mailtoEmail = null;
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.toLowerCase().includes('mailto:')) {
        mailtoEmail = href.toLowerCase().split('mailto:')[1].split('?')[0].trim();
        return false; // break loop
      }
    });
    console.log('Homepage mailto:', mailtoEmail);
    
    $('script, style, noscript, iframe').remove();
    $('br, p, div, li').each(function () {
      $(this).replaceWith(' ' + $(this).text() + ' ');
    });

    const text = $('body').text().replace(/\s+/g, ' ');

    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const email = mailtoEmail || (emailMatch ? emailMatch[0] : null);

    const phoneMatch = text.match(/(?:^|[^\d])((?:\+?1[-.\s]?)?\(?[2-9][0-8][0-9]\)?[-.\s]?[2-9][0-9]{2}[-.\s]?[0-9a-zA-Z]{4})\b/);
    const phone = phoneMatch ? phoneMatch[1] : null;

    const addressMatch = text.match(/[0-9]+\s+[A-Za-z0-9\s.,-]+(?:Avenue|Ave|Street|St|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Circle|Cir|Way|Place|Pl|Square|Sq|Highway|Hwy)[A-Za-z0-9\s.,-]+[a-zA-Z]{2}\.?\s+[0-9]{5}/i);
    const address = addressMatch ? addressMatch[0].trim() : null;

    let result = { email, phone, address, finalUrl };

    if (!result.email) {
      let contactHref = $('a').filter(function() {
        return (/contact/i).test($(this).attr('href') || '') || (/contact/i).test($(this).text() || '');
      }).first().attr('href');

      if (contactHref) {
        let contactUrl;
        try {
          contactUrl = new URL(contactHref, finalUrl).href;
        } catch (e) {
          contactUrl = null;
        }

        if (contactUrl && contactUrl.startsWith('http')) {
          console.log(`    - Email not found on homepage. Checking contact page: ${contactUrl}`);
          try {
            const contactRes = await axios.get(contactUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
              timeout: 10000
            });
            const $c = cheerio.load(contactRes.data);
            
            $c('a').each((i, el) => {
              const href = $c(el).attr('href');
              if (href && href.toLowerCase().includes('mailto:')) {
                result.email = href.toLowerCase().split('mailto:')[1].split('?')[0].trim();
                return false;
              }
            });
            console.log('Contact page mailto:', result.email);
          } catch (cErr) {
            console.log(`      Failed to check contact page: ${cErr.message}`);
          }
        }
      }
    }
    
    console.log('Final Result before LLM:', result);
    return result;
  } catch (err) {
    console.log('Error:', err.message);
  }
}

async function test() {
  const url = await searchDuckDuckGo("Yoko's Dance and Performing Arts Academy dance studio website");
  console.log("DDG returned:", url);
  await extractContactInfo(url);
}

test();

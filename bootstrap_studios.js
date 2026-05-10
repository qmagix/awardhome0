require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { openDb } = require('./database.js');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function searchDuckDuckGo(query) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    const $ = cheerio.load(response.data);
    const results = [];

    $('.result__url').each((i, el) => {
      const link = $(el).text().trim();
      if (link && !link.includes('duckduckgo.com')) {
        results.push(link);
      }
    });

    return results.length > 0 ? `https://${results[0]}` : null;
  } catch (error) {
    console.error(`Error searching DuckDuckGo for "${query}":`, error.message);
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
    if (url.startsWith('https://')) {
      finalUrl = url.replace('https://', 'http://');
      console.log(`    - HTTPS failed (${error.message}). Retrying with HTTP...`);
      try {
        response = await axios.get(finalUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          timeout: 10000
        });
      } catch (httpError) {
        console.error(`    - Both HTTPS and HTTP failed: ${httpError.message}`);
        return { email: null, phone: null, address: null, finalUrl: url };
      }
    } else {
      console.error(`    - Failed to extract from ${url}: ${error.message}`);
      return { email: null, phone: null, address: null, finalUrl: url };
    }
  }

  try {
    const $ = cheerio.load(response.data);
    
    // Extract mailto: and contact links before mutating the DOM
    let mailtoEmail = null;
    let contactHref = null;
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      
      // Check for mailto
      if (!mailtoEmail && href && href.toLowerCase().includes('mailto:')) {
        mailtoEmail = href.toLowerCase().split('mailto:')[1].split('?')[0].trim();
      }
      
      // Check for contact page link
      if (!contactHref && ((href && (/contact/i).test(href)) || (/contact/i).test($(el).text() || ''))) {
        contactHref = href;
      }
    });
    
    $('script, style, noscript, iframe').remove();
    
    // Replace block-level tags and line breaks with spaces so text doesn't fuse together
    $('br, p, div, li').each(function () {
      $(this).replaceWith(' ' + $(this).text() + ' ');
    });

    const text = $('body').text().replace(/\s+/g, ' ');

    // Email regex (prioritize mailto link if found)
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const email = mailtoEmail || (emailMatch ? emailMatch[0] : null);

    // Phone regex - expanded to catch alphanumeric endings like (925) 867-EBDC
    const phoneMatch = text.match(/(?:^|[^\d])((?:\+?1[-.\s]?)?\(?[2-9][0-8][0-9]\)?[-.\s]?[2-9][0-9]{2}[-.\s]?[0-9a-zA-Z]{4})\b/);
    const phone = phoneMatch ? phoneMatch[1] : null;

    // Address heuristic - expanded to be case insensitive for state like "Ca."
    const addressMatch = text.match(/[0-9]+\s+[A-Za-z0-9\s.,-]+(?:Avenue|Ave|Street|St|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Circle|Cir|Way|Place|Pl|Square|Sq|Highway|Hwy)[A-Za-z0-9\s.,-]+[a-zA-Z]{2}\.?\s+[0-9]{5}/i);
    const address = addressMatch ? addressMatch[0].trim() : null;

    let result = { email, phone, address, finalUrl };

    // Deep link fallback: If no email found on homepage, try to fetch the "contact" page link we found earlier
    if (!result.email) {
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
            
            // Check mailto on contact page (case-insensitive)
            $c('a').each((i, el) => {
              const href = $c(el).attr('href');
              if (href && href.toLowerCase().includes('mailto:')) {
                result.email = href.toLowerCase().split('mailto:')[1].split('?')[0].trim();
                return false;
              }
            });

            $c('script, style, noscript, iframe').remove();
            $c('br, p, div, li').each(function () {
              $c(this).replaceWith(' ' + $c(this).text() + ' ');
            });
            const contactText = $c('body').text().replace(/\s+/g, ' ');

            if (!result.email) {
              const cEmailMatch = contactText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
              if (cEmailMatch) result.email = cEmailMatch[0];
            }
            if (!result.phone) {
              const cPhoneMatch = contactText.match(/(?:^|[^\d])((?:\+?1[-.\s]?)?\(?[2-9][0-8][0-9]\)?[-.\s]?[2-9][0-9]{2}[-.\s]?[0-9a-zA-Z]{4})\b/);
              if (cPhoneMatch) result.phone = cPhoneMatch[1];
            }
            if (!result.address) {
              const cAddrMatch = contactText.match(/[0-9]+\s+[A-Za-z0-9\s.,-]+(?:Avenue|Ave|Street|St|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Circle|Cir|Way|Place|Pl|Square|Sq|Highway|Hwy)[A-Za-z0-9\s.,-]+[a-zA-Z]{2}\.?\s+[0-9]{5}/i);
              if (cAddrMatch) result.address = cAddrMatch[0].trim();
            }
          } catch (cErr) {
            console.log(`      Failed to check contact page: ${cErr.message}`);
          }
        }
      }
    }

    // If we STILL missed the email and we have an OpenAI API key, fallback to LLM
    // (We skip LLM if we already have the email, to save costs as email is the primary goal)
    if (!result.email && process.env.OPENAI_API_KEY) {
      console.log(`    - Regex missed some fields. Falling back to LLM extraction...`);

      // Extract high-value sections to save tokens: targeted sections first
      let highValueText = $('footer, [id*="contact"], [class*="contact"], address').text().replace(/\s+/g, ' ').trim();
      
      // If targeted selectors fail, fallback to the top and bottom of the page (headers and footers)
      if (highValueText.length < 50) {
        const fullText = text; // text is already defined above from $('body').text()
        if (fullText.length > 4000) {
          // Take first 1000 chars (header) and last 3000 chars (footer)
          highValueText = fullText.substring(0, 1000) + "\n...\n" + fullText.substring(fullText.length - 3000);
        } else {
          highValueText = fullText;
        }
      }
      
      highValueText = highValueText.substring(0, 4500); // hard cap
      
      if (highValueText.length > 50) {
        try {
          const llmResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "Extract contact info from this website text. Return a flat JSON object with keys 'email', 'phone', and 'address'. All values MUST be strings. If there are multiple locations, combine them into a single string separated by ' | '. If not found, use null." },
              { role: "user", content: highValueText }
            ],
            response_format: { type: "json_object" }
          }, {
            headers: {
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            }
          });

          const llmData = JSON.parse(llmResponse.data.choices[0].message.content);
          const usage = llmResponse.data.usage;
          
          // Cost calculation for gpt-4o-mini
          // Input: $0.150 / 1M tokens, Output: $0.600 / 1M tokens
          const cost = (usage.prompt_tokens * 0.15 / 1000000) + (usage.completion_tokens * 0.60 / 1000000);

          console.log(`\n      --- LLM Request Text ---\n      ${highValueText.substring(0, 500)}... (truncated)`);
          console.log(`      --- LLM Response JSON ---\n      ${JSON.stringify(llmData, null, 2)}`);
          console.log(`      --- LLM Cost ---`);
          console.log(`      Tokens used: ${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion = ${usage.total_tokens} total`);
          console.log(`      Cost for this scrape: $${cost.toFixed(6)}`);

          // Helper to serialize object to string just in case LLM disobeys
          const serialize = (val) => {
            if (!val) return null;
            if (typeof val === 'string') return val;
            if (typeof val === 'object') return Object.entries(val).map(([k, v]) => `${k}: ${v}`).join(' | ');
            return String(val);
          };

          // Trust the LLM over the Regex. If the LLM found something, let it override.
          if (llmData.email) result.email = serialize(llmData.email);
          if (llmData.phone) result.phone = serialize(llmData.phone);
          if (llmData.address) result.address = serialize(llmData.address);
        } catch (llmError) {
          console.error(`      LLM Extraction failed: ${llmError.response ? JSON.stringify(llmError.response.data) : llmError.message}`);
        }
      } else {
        console.log(`   highValueText is too short (${highValueText}) to extract contact info.`);
      }
    }

    return result;
  } catch (error) {
    console.error(` -> Failed to extract from ${url}: ${error.message}`);
    return { email: null, phone: null, address: null };
  }
}

async function run() {
  console.log("Starting Studio Info Bootstrapper...");
  const db = await openDb();

  // Find studios that don't have a website_url and don't already have a pending draft.
  // Filter for studios with > 10 awards and recent participation (>= 2023).
  const studios = await db.all(`
    SELECT s.id, s.name 
    FROM studios s
    LEFT JOIN studio_info_drafts d ON s.id = d.studio_id AND d.status = 'pending'
    JOIN awards a ON a.studio_id = s.id
    JOIN events e ON a.event_id = e.id
    WHERE (s.website_url IS NULL OR s.website_url = '')
      AND (s.email IS NULL OR s.email = '')
      AND (s.phone IS NULL OR s.phone = '')
      AND d.id IS NULL
    GROUP BY s.id, s.name
    HAVING COUNT(a.id) > 10 AND MAX(e.year) >= 2023
  `);

  if (studios.length === 0) {
    console.log("No studios currently need bootstrapping or all have pending drafts.");
    return;
  }
  console.log(`Found ${studios.length} studios to bootstrap...\n`);

  const total = studios.length;
  let successfulExtractions = 0;
  const startTime = Date.now();

  for (let i = 0; i < total; i++) {
    const studio = studios[i];
    const n = i + 1;
    
    // Calculate estimated time remaining
    const elapsedMs = Date.now() - startTime;
    const avgMsPerStudio = i > 0 ? elapsedMs / i : 6000; // default 6s per loop
    const remainingMs = avgMsPerStudio * (total - i);
    const remainingMin = Math.floor(remainingMs / 60000);
    const remainingSec = Math.floor((remainingMs % 60000) / 1000);

    console.log(`\n======================================================`);
    console.log(`[${n}/${total}] Searching for: ${studio.name}`);
    console.log(`⏱  Estimated time remaining: ~${remainingMin}m ${remainingSec}s | Success rate: ${i > 0 ? Math.round((successfulExtractions/i)*100) : 0}%`);
    console.log(`======================================================`);
    const query = `${studio.name} dance studio website`;
    const scrapedUrl = await searchDuckDuckGo(query);

    if (scrapedUrl) {
      console.log(` -> Found potential URL: ${scrapedUrl}`);

      console.log(` -> Attempting to extract contact info from page...`);
      const contactInfo = await extractContactInfo(scrapedUrl);

      if (contactInfo.email) console.log(`    - Email: ${contactInfo.email}`);
      if (contactInfo.phone) console.log(`    - Phone: ${contactInfo.phone}`);
      if (contactInfo.address) console.log(`    - Address: ${contactInfo.address}`);

      if (contactInfo.email || contactInfo.phone || contactInfo.address) {
        successfulExtractions++;
      }

      await db.run(`
        INSERT INTO studio_info_drafts 
        (studio_id, scraped_name, scraped_website_url, scraped_email, scraped_phone, scraped_address, source_url) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        studio.id,
        studio.name,
        contactInfo.finalUrl,
        contactInfo.email,
        contactInfo.phone,
        contactInfo.address,
        `https://duckduckgo.com/?q=${encodeURIComponent(query)}`
      ]);

      console.log(` -> Draft created for review.`);
    } else {
      console.log(` -> No results found.`);
    }

    // Polite delay to avoid rate limiting from DuckDuckGo
    await delay(5000);
  }

  console.log("Bootstrapping complete! Check the Admin Dashboard.");
}

run().catch(console.error);

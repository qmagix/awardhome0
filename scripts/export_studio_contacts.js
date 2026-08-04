const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

const db = new sqlite3.Database('./database.sqlite');
db.all = promisify(db.all.bind(db));

async function exportContacts() {
  console.log('Exporting studio contact info...');
  
  // Export any studio that has at least some contact/social info populated.
  const studios = await db.all(`
    SELECT name, website_url, email, phone, address, contact, instagram_handle, tiktok_handle, bio, logo_url
    FROM studios
    WHERE website_url IS NOT NULL
       OR email IS NOT NULL
       OR phone IS NOT NULL
       OR address IS NOT NULL
       OR instagram_handle IS NOT NULL
       OR tiktok_handle IS NOT NULL
  `);

  console.log(`Found ${studios.length} studios with contact information.`);
  
  // We'll also export approved drafts just in case there are pending drafts that have valuable info
  const drafts = await db.all(`
    SELECT s.name, d.scraped_website_url as website_url, d.scraped_email as email, d.scraped_phone as phone, d.scraped_address as address
    FROM studio_info_drafts d
    JOIN studios s ON d.studio_id = s.id
    WHERE d.status = 'approved' OR d.status = 'pending'
  `);
  
  console.log(`Found ${drafts.length} studio info drafts.`);

  // Merge drafts into studios if the studio itself doesn't have the info yet
  const studioMap = new Map();
  for (const s of studios) {
    studioMap.set(s.name, s);
  }
  
  for (const d of drafts) {
    if (studioMap.has(d.name)) {
      const s = studioMap.get(d.name);
      if (!s.website_url && d.website_url) s.website_url = d.website_url;
      if (!s.email && d.email) s.email = d.email;
      if (!s.phone && d.phone) s.phone = d.phone;
      if (!s.address && d.address) s.address = d.address;
    } else {
      studioMap.set(d.name, {
        name: d.name,
        website_url: d.website_url,
        email: d.email,
        phone: d.phone,
        address: d.address,
        contact: null,
        instagram_handle: null,
        tiktok_handle: null,
        bio: null,
        logo_url: null
      });
    }
  }

  const finalExport = Array.from(studioMap.values());
  
  fs.writeFileSync('./studio_contacts_backup.json', JSON.stringify(finalExport, null, 2));
  console.log(`\nSuccessfully exported ${finalExport.length} studio contact records to studio_contacts_backup.json`);
  
  db.close();
}

exportContacts().catch(console.error);

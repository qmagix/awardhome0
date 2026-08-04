const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

const db = new sqlite3.Database('./database.sqlite');
db.run = promisify(db.run.bind(db));
db.get = promisify(db.get.bind(db));

async function importContacts() {
  if (!fs.existsSync('./studio_contacts_backup.json')) {
    console.error('Error: studio_contacts_backup.json not found!');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync('./studio_contacts_backup.json', 'utf8'));
  console.log(`Loaded ${data.length} studio records to restore...`);

  let restoredCount = 0;
  let notFoundCount = 0;

  for (const record of data) {
    const studio = await db.get('SELECT id FROM studios WHERE name = ?', [record.name]);
    
    if (studio) {
      await db.run(`
        UPDATE studios 
        SET website_url = COALESCE(?, website_url),
            email = COALESCE(?, email),
            phone = COALESCE(?, phone),
            address = COALESCE(?, address),
            contact = COALESCE(?, contact),
            instagram_handle = COALESCE(?, instagram_handle),
            tiktok_handle = COALESCE(?, tiktok_handle),
            bio = COALESCE(?, bio),
            logo_url = COALESCE(?, logo_url)
        WHERE id = ?
      `, [
        record.website_url,
        record.email,
        record.phone,
        record.address,
        record.contact,
        record.instagram_handle,
        record.tiktok_handle,
        record.bio,
        record.logo_url,
        studio.id
      ]);
      restoredCount++;
    } else {
      notFoundCount++;
    }
  }

  console.log(`\nRestore complete!`);
  console.log(`- Successfully updated ${restoredCount} studios.`);
  if (notFoundCount > 0) {
    console.log(`- Could not find ${notFoundCount} studios by name in the new database.`);
  }

  db.close();
}

importContacts().catch(console.error);

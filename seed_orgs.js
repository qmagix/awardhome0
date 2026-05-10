const { openDb } = require('./database');

async function seedOrgs() {
  const db = await openDb();
  
  const orgs = [
    { name: 'KAR Dance Competition', slug: 'kar', website: 'https://dancekar.com' },
    { name: 'Rainbow National Dance Competition', slug: 'rainbow', website: 'https://rainbowdance.com' },
    { name: 'Revolution Talent Competition', slug: 'revolution', website: 'https://revolutiontalent.com' },
    { name: 'Starpower Talent Competition', slug: 'starpower', website: 'https://starpowertalent.com' },
    { name: 'Youth America Grand Prix', slug: 'yagp', website: 'https://yagp.org' },
    { name: 'Believe Talent Competition', slug: 'believe', website: 'https://believetalent.com' },
    { name: 'Imagine Dance Challenge', slug: 'imagine', website: 'https://imaginedancechallenge.com' },
    { name: 'DreamMaker Dance Competition', slug: 'dreammaker', website: 'https://dreammakerdance.com' }
  ];

  console.log('Seeding organizations...');
  
  for (const org of orgs) {
    const existing = await db.get('SELECT id FROM organizations WHERE slug = ?', [org.slug]);
    if (!existing) {
      await db.run(
        'INSERT INTO organizations (name, slug, website) VALUES (?, ?, ?)',
        [org.name, org.slug, org.website]
      );
      console.log(`Inserted: ${org.name}`);
    } else {
      console.log(`Already exists: ${org.name}`);
    }
  }
  
  console.log('Seeding complete.');
}

if (require.main === module) {
  seedOrgs().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seedOrgs };

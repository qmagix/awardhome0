require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { openDb } = require('./database');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { generateDancerId, generateStudioId } = require('./utils');
const { runBackfillForEvent } = require('./backfill_utils');

const upload = multer({ dest: 'uploads/' });

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // Added for JSON parsing
app.use(express.urlencoded({ extended: true })); // Added for form parsing
app.use(session({
  secret: 'dance-awards-secret-key-123', // In production, use env variable
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using https
}));

app.locals.formatPlacement = function(place) {
  if (!place) return '';
  const strPlace = String(place).trim();
  const num = parseInt(strPlace, 10);
  if (!isNaN(num) && num.toString() === strPlace) {
    const j = num % 10, k = num % 100;
    if (j == 1 && k != 11) return num + "st";
    if (j == 2 && k != 12) return num + "nd";
    if (j == 3 && k != 13) return num + "rd";
    return num + "th";
  }
  return place;
};

// Global middleware to pass user to templates
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY || 're_123456789');

app.get('/register', (req, res) => res.render('register'));
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  const db = await openDb();
  
  const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    return res.render('register', { error: 'Email already registered' });
  }

  const hash = await bcrypt.hash(password, 10);
  await db.run(`INSERT INTO users (email, password_hash) VALUES (?, ?)`, [email, hash]);
  
  const token = Buffer.from(email + ':dance_secret').toString('base64');
  const verifyLink = `http://localhost:3000/verify-email?token=${token}&email=${encodeURIComponent(email)}`;
  
  if (process.env.RESEND_API_KEY) {
    try {
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: email,
        subject: 'Verify your Dance Awards Account',
        html: `<p>Click here to verify: <a href="${verifyLink}">${verifyLink}</a></p>`
      });
    } catch (e) {
      console.error("Resend error:", e);
    }
  } else {
    console.log(`[DEV MODE] Verification Link for ${email}: ${verifyLink}`);
  }

  res.render('register', { message: 'Registration successful! Please check your email to verify your account.' });
});

app.get('/verify-email', async (req, res) => {
  const { token, email } = req.query;
  const expectedToken = Buffer.from(email + ':dance_secret').toString('base64');
  
  if (token === expectedToken) {
    const db = await openDb();
    await db.run('UPDATE users SET is_verified = 1 WHERE email = ?', [email]);
    res.send('<script>alert("Email verified!"); window.location.href="/login";</script>');
  } else {
    res.status(400).send('Invalid token');
  }
});

app.get('/login', (req, res) => res.render('login'));
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const db = await openDb();
  
  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.render('login', { error: 'Invalid credentials' });
  }
  
  if (!user.is_verified) {
    return res.render('login', { error: 'Please verify your email first.' });
  }

  req.session.user = { id: user.id, email: user.email, role: user.role };
  
  if (user.role === 'admin' || user.role === 'superadmin') {
    return res.redirect('/admin');
  }

  const ownedStudio = await db.get('SELECT id FROM studios WHERE owner_id = ? LIMIT 1', [user.id]);
  if (ownedStudio) {
    res.redirect(`/studio/${ownedStudio.id}`);
  } else {
    res.redirect('/');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Auth Middleware
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin')) return res.status(403).send('Forbidden');
  next();
}

function requireSuperadmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'superadmin') return res.status(403).send('Forbidden: Superadmin only');
  next();
}

app.get('/claim/studio/:id', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT id, name FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  res.render('claim_studio', { studio });
});

app.post('/claim/studio/:id', requireAuth, async (req, res) => {
  const { role, phone, proof } = req.body;
  const db = await openDb();
  
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');

  if (studio.is_claimed) {
    return res.render('claim_studio', { studio, error: 'Studio is already claimed.' });
  }

  // Combine proof text
  const proof_text = `Role: ${role}\nPhone: ${phone}\nDetails: ${proof}`;
  
  // Fast-Track Verification Logic
  const user = req.session.user;
  let autoApproved = false;

  if (studio.website_url) {
    try {
      const studioDomain = new URL(studio.website_url.startsWith('http') ? studio.website_url : `https://${studio.website_url}`).hostname.replace(/^www\./, '');
      const userDomain = user.email.split('@')[1];
      if (studioDomain === userDomain) {
        autoApproved = true;
      }
    } catch(e) {
      console.error("Domain parsing error:", e);
    }
  }

  if (autoApproved) {
    await db.run('UPDATE studios SET is_claimed = 1, owner_id = ? WHERE id = ?', [user.id, studio.id]);
    await db.run('INSERT INTO studio_claims (user_id, studio_id, proof_text, status) VALUES (?, ?, ?, ?)', [user.id, studio.id, proof_text, 'approved']);
    
    // Make user a studio_owner if they are just a user
    if (user.role === 'user') {
       await db.run('UPDATE users SET role = ? WHERE id = ?', ['studio_owner', user.id]);
       req.session.user.role = 'studio_owner';
    }
    
    return res.send(`<script>alert("Congratulations! Your email domain matched the studio's website. Your claim has been auto-approved."); window.location.href="/studio/${studio.id}";</script>`);
  } else {
    // Normal pending claim
    await db.run('INSERT INTO studio_claims (user_id, studio_id, proof_text, status) VALUES (?, ?, ?, ?)', [user.id, studio.id, proof_text, 'pending']);
    return res.send(`<script>alert("Claim submitted successfully! Our admins will review your request shortly."); window.location.href="/studio/${studio.id}";</script>`);
  }
});

// Studio Management Routes
app.get('/manage/studio/:id', requireAuth, async (req, res) => {
  const db = await openDb();
  let studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  
  if (!studio) return res.status(404).send('Studio not found');
  if (studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden: Not the owner');
  
  if (!studio.join_code) {
    const crypto = require('crypto');
    const newCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    await db.run('UPDATE studios SET join_code = ? WHERE id = ?', [newCode, studio.id]);
    studio.join_code = newCode;
  }
  
  const baseName = studio.name.split(',')[0].trim();
  const searchName = `%${baseName}%`;
  const rejectedArray = studio.rejected_merges ? studio.rejected_merges.split(',') : [];
  
  const similarStudios = await db.all(`
    SELECT id, name, aka, status 
    FROM studios 
    WHERE (name LIKE ? OR aka LIKE ?)
      AND id != ?
      AND status != 'merged'
  `, [searchName, searchName, studio.id]);

  const potentialDuplicates = similarStudios.filter(s => !rejectedArray.includes(s.id.toString()));
  
  res.render('manage_studio', { studio, potentialDuplicates });
});

app.post('/manage/studio/:id/reset-code', requireAuth, async (req, res) => {
  const db = await openDb();
  // Ensure user owns this studio
  if (req.session.user.role !== 'superadmin') {
    const studio = await db.get('SELECT id FROM studios WHERE id = ? AND owner_id = ?', [req.params.id, req.session.user.id]);
    if (!studio) return res.status(403).send('Forbidden');
  }

  // Generate new 6-character code
  const crypto = require('crypto');
  const newCode = crypto.randomBytes(3).toString('hex').toUpperCase();

  await db.run('UPDATE studios SET join_code = ? WHERE id = ?', [newCode, req.params.id]);
  res.redirect(`/manage/studio/${req.params.id}`);
});

app.post('/manage/studio/:id/profile', requireAuth, async (req, res) => {
  const { name, website_url, email, phone, logo_url, bio, instagram_handle, tiktok_handle } = req.body;
  const db = await openDb();
  
  const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  if (studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden: Not the owner');
  
  await db.run(`
    UPDATE studios 
    SET name = ?, website_url = ?, email = ?, phone = ?, logo_url = ?, bio = ?, instagram_handle = ?, tiktok_handle = ?
    WHERE id = ?
  `, [name, website_url, email, phone, logo_url, bio, instagram_handle, tiktok_handle, req.params.id]);
  
  const updatedStudio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  res.render('manage_studio', { studio: updatedStudio, success: 'Profile updated successfully!' });
});

app.get('/manage/studio/:id/roster', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  if (studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden: Not the owner');

  const roster = await db.all(`
    SELECT d.id, d.unique_id, d.name, d.birthday, ds.status, ds.headshot_url, ds.graduation_year,
           (SELECT COUNT(*) FROM award_dancers ad JOIN awards a ON ad.award_id = a.id WHERE ad.dancer_id = d.id AND a.studio_id = ds.studio_id) as total_awards
    FROM dancers d
    JOIN dancer_studios ds ON d.id = ds.dancer_id
    WHERE ds.studio_id = ?
    ORDER BY d.name ASC
  `, [req.params.id]);

  res.render('manage_studio_roster', { studio, roster });
});

app.post('/manage/studio/:id/roster/:dancerId/update', requireAuth, async (req, res) => {
  const { headshot_url, graduation_year, status } = req.body;
  const db = await openDb();
  
  const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden');

  await db.run(`
    UPDATE dancer_studios 
    SET headshot_url = ?, graduation_year = ?, status = ?
    WHERE studio_id = ? AND dancer_id = ?
  `, [headshot_url || null, graduation_year || null, status || 'active', req.params.id, req.params.dancerId]);
  
  res.redirect(`/manage/studio/${req.params.id}/roster`);
});

app.post('/manage/studio/:id/awards/self-report', requireAuth, async (req, res) => {
  const { event_name, year, category, performance_name, place, dancer_ids } = req.body;
  const db = await openDb();
  
  const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden');

  // Create a dummy event for self-reported awards if we don't have a structured one
  await db.run('INSERT INTO events (name, year, org_id) VALUES (?, ?, NULL)', [event_name, year]);
  const event = await db.get('SELECT id FROM events ORDER BY id DESC LIMIT 1');

  await db.run(`
    INSERT INTO awards (event_id, place, performance_name, category, studio_id, is_self_added, verification_status) 
    VALUES (?, ?, ?, ?, ?, 1, 'unverified')
  `, [event.id, place, performance_name, category, req.params.id]);
  
  const award = await db.get('SELECT id FROM awards ORDER BY id DESC LIMIT 1');

  if (dancer_ids) {
    const ids = Array.isArray(dancer_ids) ? dancer_ids : [dancer_ids];
    for (const dId of ids) {
      await db.run('INSERT INTO award_dancers (award_id, dancer_id) VALUES (?, ?)', [award.id, dId]);
    }
  }

  res.redirect(`/manage/studio/${req.params.id}/awards?year=${year}`);
});

app.get('/api/dancers/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);
  const db = await openDb();
  
  const dancers = await db.all(`
    SELECT d.id, d.name, 
           (SELECT COUNT(*) FROM award_dancers ad WHERE ad.dancer_id = d.id) as award_count
    FROM dancers d
    WHERE d.name LIKE ?
    ORDER BY award_count DESC
    LIMIT 10
  `, [`%${q}%`]);

  for (let dancer of dancers) {
    dancer.recent_routines = await db.all(`
      SELECT a.performance_name, e.year, o.name as comp_name
      FROM awards a
      JOIN award_dancers ad ON a.id = ad.award_id
      JOIN events e ON a.event_id = e.id
      LEFT JOIN organizations o ON e.org_id = o.id
      WHERE ad.dancer_id = ?
      ORDER BY e.year DESC
      LIMIT 3
    `, [dancer.id]);
  }

  res.json(dancers);
});

app.post('/manage/studio/:id/roster/merge', requireAuth, async (req, res) => {
  const { primary_id, duplicate_id } = req.body;
  const db = await openDb();
  
  const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden');

  if (!primary_id || !duplicate_id || primary_id === duplicate_id) {
    return res.status(400).send('Invalid merge parameters');
  }

  // Verify both dancers belong to this studio
  const d1 = await db.get('SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?', [primary_id, req.params.id]);
  const d2 = await db.get('SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?', [duplicate_id, req.params.id]);
  
  if (!d1 || !d2) {
    return res.status(403).send('Both dancers must be on your roster to merge them.');
  }

  try {
    await db.run('BEGIN TRANSACTION');

    // 1. Move all awards from duplicate to primary (use INSERT OR IGNORE to prevent UNIQUE constraint errors if they somehow both won the exact same award record)
    await db.run('INSERT OR IGNORE INTO award_dancers (award_id, dancer_id) SELECT award_id, ? FROM award_dancers WHERE dancer_id = ?', [primary_id, duplicate_id]);
    await db.run('DELETE FROM award_dancers WHERE dancer_id = ?', [duplicate_id]);

    // 2. Move any OTHER studio affiliations the duplicate might have had (that aren't this studio)
    await db.run('INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id, status) SELECT ?, studio_id, status FROM dancer_studios WHERE dancer_id = ?', [primary_id, duplicate_id]);
    await db.run('DELETE FROM dancer_studios WHERE dancer_id = ?', [duplicate_id]);

    // 3. Delete the duplicate dancer record
    await db.run('DELETE FROM dancers WHERE id = ?', [duplicate_id]);

    await db.run('COMMIT');
    res.redirect(`/manage/studio/${req.params.id}/roster?success=Merge+completed`);
  } catch (err) {
    await db.run('ROLLBACK');
    console.error(err);
    res.status(500).send('Merge failed');
  }
});

app.post('/manage/studio/:id/roster/csv-preview', requireAuth, upload.single('roster_csv'), async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden');

  if (!req.file) return res.status(400).send('No file uploaded');

  try {
    const fileContent = fs.readFileSync(req.file.path, 'utf-8');
    const records = parse(fileContent, { columns: true, skip_empty_lines: true, trim: true });
    
    // We need 'name' at minimum
    if (records.length > 0 && !records[0].name) {
      // maybe they capitalized Name? Let's lowercase all keys
      records.forEach(r => {
        Object.keys(r).forEach(k => {
          if(k.toLowerCase() !== k) {
            r[k.toLowerCase()] = r[k];
            delete r[k];
          }
        });
      });
      
      if (!records[0].name) {
         fs.unlinkSync(req.file.path);
         return res.status(400).send('CSV must have a "name" column.');
      }
    }

    // Prepare resolution data
    const previewData = [];
    for (const row of records) {
      if (!row.name) continue;
      
      // Global search for this exact or partial name
      const matches = await db.all(`
        SELECT id, name, birthday, 
        (SELECT COUNT(*) FROM award_dancers ad WHERE ad.dancer_id = dancers.id) as award_count
        FROM dancers 
        WHERE name LIKE ?
        ORDER BY award_count DESC LIMIT 5
      `, [`%${row.name}%`]);

      previewData.push({
        csv_row: row,
        matches: matches
      });
    }

    // Keep the file path so the commit phase can re-read it or we can pass JSON via form
    // Since we have the previewData array, we will just render a resolution UI and pass the array back as JSON hidden input
    fs.unlinkSync(req.file.path);

    res.render('manage_studio_roster_csv', { studio, previewData });
  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    console.error(error);
    res.status(500).send('Error parsing CSV. Please ensure it is a valid CSV file.');
  }
});

app.post('/manage/studio/:id/roster/csv-commit', requireAuth, async (req, res) => {
  const { resolution_data } = req.body; 
  // resolution_data will be an array of { action: 'create'|'link'|'skip', dancer_id: ID_if_link, csv_row: {name, birthday, graduation_year, status} }
  
  const db = await openDb();
  const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden');

  let parsedData;
  try {
    parsedData = JSON.parse(resolution_data);
  } catch (e) {
    return res.status(400).send('Invalid resolution data');
  }

  const crypto = require('crypto');

  try {
    await db.run('BEGIN TRANSACTION');

    for (const item of parsedData) {
      if (item.action === 'skip') continue;

      let dancerId = item.dancer_id;

      if (item.action === 'create') {
        const uniqueId = generateDancerId(item.csv_row.name);
        await db.run('INSERT INTO dancers (unique_id, name, birthday) VALUES (?, ?, ?)', [uniqueId, item.csv_row.name, item.csv_row.birthday || null]);
        const newDancer = await db.get('SELECT id FROM dancers ORDER BY id DESC LIMIT 1');
        dancerId = newDancer.id;
      }

      if (dancerId) {
        // Link to studio with pivot data
        const status = item.csv_row.status ? item.csv_row.status.toLowerCase() : 'active';
        const gradYear = item.csv_row.graduation_year ? parseInt(item.csv_row.graduation_year) : null;
        
        await db.run(`
          INSERT INTO dancer_studios (dancer_id, studio_id, status, graduation_year) 
          VALUES (?, ?, ?, ?)
          ON CONFLICT(dancer_id, studio_id) DO UPDATE SET 
            status = excluded.status,
            graduation_year = excluded.graduation_year
        `, [dancerId, req.params.id, status, gradYear]);
      }
    }

    await db.run('COMMIT');
    res.redirect(`/manage/studio/${req.params.id}/roster?success=CSV+Import+Completed`);
  } catch (err) {
    await db.run('ROLLBACK');
    console.error(err);
    res.status(500).send('Import failed');
  }
});

app.post('/manage/studio/:id/roster/claim', requireAuth, async (req, res) => {
  const { dancer_id, new_dancer_name } = req.body;
  const db = await openDb();
  
  const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden');

  let finalDancerId = dancer_id;

  if (new_dancer_name) {
    // Create new dancer
    const uniqueId = generateDancerId(new_dancer_name);
    await db.run('INSERT INTO dancers (unique_id, name) VALUES (?, ?)', [uniqueId, new_dancer_name]);
    const newDancer = await db.get('SELECT id FROM dancers ORDER BY id DESC LIMIT 1');
    finalDancerId = newDancer.id;
  }

  if (finalDancerId) {
    await db.run('INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id, status) VALUES (?, ?, ?)', [finalDancerId, req.params.id, 'active']);
  }

  res.redirect(`/manage/studio/${req.params.id}/roster`);
});

app.get('/manage/studio/:id/verifications', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  
  if (!studio) return res.status(404).send('Studio not found');
  if (studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden: Not the owner');
  
  const pendingAwards = await db.all(`
    SELECT ad.id as link_id, ad.award_id, d.name as dancer_name, d.unique_id, a.performance_name, a.award_type, e.name as event_name, e.year
    FROM award_dancers ad
    JOIN dancers d ON ad.dancer_id = d.id
    JOIN awards a ON ad.award_id = a.id
    JOIN events e ON a.event_id = e.id
    WHERE ad.status = 'pending' AND a.studio_id = ?
  `, [studio.id]);

  res.render('manage_studio_verifications', { studio, pendingAwards });
});

app.post('/manage/studio/:id/verifications/award/:link_id/approve', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden');
  
  const link = await db.get('SELECT dancer_id FROM award_dancers WHERE id = ?', [req.params.link_id]);
  if (link) {
    await db.run("UPDATE award_dancers SET status = 'verified' WHERE id = ?", [req.params.link_id]);
    await db.run("UPDATE dancer_studios SET status = 'active' WHERE dancer_id = ? AND studio_id = ?", [link.dancer_id, studio.id]);
  }
  
  res.redirect(`/manage/studio/${studio.id}/verifications`);
});

app.post('/manage/studio/:id/verifications/award/:link_id/deny', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden');
  
  const link = await db.get('SELECT dancer_id FROM award_dancers WHERE id = ?', [req.params.link_id]);
  if (link) {
    await db.run("DELETE FROM award_dancers WHERE id = ?", [req.params.link_id]);
    // Optionally delete from dancer_studios if this was the only award and they were pending... 
    // but for now, just deleting the award claim is enough.
  }
  res.redirect(`/manage/studio/${studio.id}/verifications`);
});

app.get('/manage/studio/:id/awards', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  if (studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden: Not the owner');
  
  const yearsResult = await db.all(`
    SELECT DISTINCT e.year
    FROM awards a
    JOIN events e ON a.event_id = e.id
    WHERE a.studio_id = ?
    ORDER BY e.year DESC
  `, [req.params.id]);
  const availableYears = yearsResult.map(r => r.year);

  let selectedYear = req.query.year ? parseInt(req.query.year) : null;
  if (!selectedYear && availableYears.length > 0) {
    selectedYear = availableYears[0];
  }

  let awards = [];
  if (selectedYear) {
    awards = await db.all(`
      SELECT a.*, d.name as dancer_name, e.name as event_name, e.year as event_year 
      FROM awards a
      LEFT JOIN dancers d ON a.dancer_id = d.id
      LEFT JOIN events e ON a.event_id = e.id
      WHERE a.studio_id = ? AND e.year = ?
      ORDER BY e.date_string DESC
    `, [req.params.id, selectedYear]);
  }

  const studioDancers = await db.all(`
    SELECT d.id, d.name 
    FROM dancers d
    JOIN dancer_studios ds ON d.id = ds.dancer_id
    WHERE ds.studio_id = ?
    ORDER BY d.name ASC
  `, [req.params.id]);

  let awardDancers = [];
  if (selectedYear) {
    awardDancers = await db.all(`
      SELECT ad.award_id, d.id as dancer_id, d.name 
      FROM award_dancers ad
      JOIN dancers d ON ad.dancer_id = d.id
      JOIN awards a ON ad.award_id = a.id
      JOIN events e ON a.event_id = e.id
      WHERE a.studio_id = ? AND e.year = ?
    `, [req.params.id, selectedYear]);
  }
  
  const groupedDancers = {};
  for (const row of awardDancers) {
    if (!groupedDancers[row.award_id]) groupedDancers[row.award_id] = [];
    groupedDancers[row.award_id].push({ id: row.dancer_id, name: row.name });
  }

  res.render('manage_studio_awards', { studio, awards, studioDancers, groupedDancers, availableYears, selectedYear });
});

app.post('/manage/studio/:id/awards/:awardId/update', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden');
  
  const award = await db.get('SELECT * FROM awards WHERE id = ? AND studio_id = ?', [req.params.awardId, req.params.id]);
  if (!award) return res.status(404).send('Award not found');
  
  const { performance_name, place, award_type } = req.body;
  
  if (performance_name && !award.performance_name) {
    await db.run('UPDATE awards SET performance_name = ? WHERE id = ?', [performance_name, award.id]);
  }
  if (place && !award.place) {
    await db.run('UPDATE awards SET place = ? WHERE id = ?', [place, award.id]);
  }
  if (award_type && !award.award_type) {
    await db.run('UPDATE awards SET award_type = ? WHERE id = ?', [award_type, award.id]);
  }
  
  const yearQuery = req.query.year ? `?year=${req.query.year}` : '';
  res.redirect(`/manage/studio/${req.params.id}/awards${yearQuery}`);
});

app.post('/manage/studio/:id/awards/:awardId/dancers', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden');
  
  const yearQuery = req.query.year ? `?year=${req.query.year}` : '';
  let { dancer_name } = req.body;
  if (!dancer_name) return res.redirect(`/manage/studio/${req.params.id}/awards${yearQuery}`);
  dancer_name = dancer_name.trim();
  
  try {
    let dancer = await db.get(`
      SELECT d.id FROM dancers d 
      JOIN dancer_studios ds ON d.id = ds.dancer_id 
      WHERE d.name = ? COLLATE NOCASE AND ds.studio_id = ?
    `, [dancer_name, req.params.id]);
    
    if (!dancer) {
      dancer = await db.get('SELECT id FROM dancers WHERE name = ? COLLATE NOCASE LIMIT 1', [dancer_name]);
    }
    
    if (!dancer) {
      const unique_id = generateDancerId(dancer_name);
      const result = await db.run('INSERT INTO dancers (unique_id, name) VALUES (?, ?)', [unique_id, dancer_name]);
      dancer = { id: result.lastID };
    }
    
    try {
      await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [dancer.id, req.params.id]);
    } catch(e) { }

    await db.run('INSERT INTO award_dancers (award_id, dancer_id) VALUES (?, ?)', [req.params.awardId, dancer.id]);
  } catch(e) { console.error(e); }
  
  res.redirect(`/manage/studio/${req.params.id}/awards${yearQuery}`);
});

app.post('/manage/studio/:id/awards/:awardId/dancers/:dancerId/remove', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden');
  
  await db.run('DELETE FROM award_dancers WHERE award_id = ? AND dancer_id = ?', [req.params.awardId, req.params.dancerId]);
  
  const yearQuery = req.query.year ? `?year=${req.query.year}` : '';
  res.redirect(`/manage/studio/${req.params.id}/awards${yearQuery}`);
});

// Widget Builder UI
app.get('/manage/studio/:id/widget', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  if (studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden');
  
  res.render('manage_studio_widget', { studio });
});

// Public Widget Iframe Route
app.get('/widget/studio/:id', async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT name, logo_url FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  
  const awards = await db.all(`
    SELECT a.place, a.performance_name, a.award_type, e.name as event_name, e.year, d.name as dancer_name
    FROM awards a
    LEFT JOIN events e ON a.event_id = e.id
    LEFT JOIN dancers d ON a.dancer_id = d.id
    WHERE a.studio_id = ?
    ORDER BY e.year DESC, e.date_string DESC
    LIMIT 20
  `, [req.params.id]);
  
  const theme = req.query.theme || 'dark';
  const primaryColor = req.query.primary || 'ec4899';
  const bg = req.query.bg || (theme === 'dark' ? '000000' : 'ffffff');
  
  res.render('widget', { studio, awards, theme, primaryColor, bg });
});

app.get('/my-studio', requireAuth, async (req, res) => {
  const db = await openDb();
  const ownedStudio = await db.get('SELECT id FROM studios WHERE owner_id = ? LIMIT 1', [req.session.user.id]);
  if (ownedStudio) {
    res.redirect(`/manage/studio/${ownedStudio.id}`);
  } else {
    res.redirect('/');
  }
});

app.get('/faq/admin', (req, res) => {
  res.render('faq_admin');
});

app.get('/faq/dancer', (req, res) => {
  res.render('faq_dancer');
});

app.get('/', async (req, res) => {
  const db = await openDb();
  
  const featuredStudios = await db.all(`
    SELECT s.id, s.name, COUNT(DISTINCT a.id) as total_awards
    FROM studios s
    LEFT JOIN awards a ON s.id = a.studio_id
    WHERE s.is_featured = 1
    GROUP BY s.id
    ORDER BY s.name
  `);
  
  let excludeIds = featuredStudios.map(s => s.id);
  if (excludeIds.length === 0) excludeIds = [-1];
  
  const topStudios = await db.all(`
    SELECT s.id, s.name, COUNT(a.id) as total_awards
    FROM studios s
    LEFT JOIN awards a ON s.id = a.studio_id
    WHERE s.id NOT IN (${excludeIds.join(',')})
    GROUP BY s.id
    ORDER BY total_awards DESC
    LIMIT 12
  `);

  const orgs = await db.all(`SELECT id, name, slug FROM organizations ORDER BY name`);
  res.render('index', { featuredStudios, topStudios, orgs });
});

app.get('/org/:slug', async (req, res) => {
  const db = await openDb();
  const org = await db.get(`SELECT * FROM organizations WHERE slug = ?`, [req.params.slug]);
  if (!org) return res.status(404).send('Organization not found');

  const events = await db.all(`
    SELECT * FROM events WHERE org_id = ? ORDER BY year DESC, date_string DESC
  `, [org.id]);

  const eventsByYearMap = new Map();
  for (const event of events) {
    const year = event.year || 'Unknown Year';
    if (!eventsByYearMap.has(year)) {
      eventsByYearMap.set(year, []);
    }
    eventsByYearMap.get(year).push(event);
  }

  const groupedData = Array.from(eventsByYearMap, ([year, events]) => ({
    year,
    events
  }));

  res.render('org', { org, groupedData, eventsCount: events.length });
});

app.get('/studios', async (req, res) => {
  const db = await openDb();
  
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;

  const countRow = await db.get(`SELECT COUNT(*) as count FROM studios`);
  const totalStudios = countRow.count;
  const totalPages = Math.ceil(totalStudios / limit);

  const studios = await db.all(`
    SELECT s.*, 
           COUNT(DISTINCT a.id) as total_awards,
           COUNT(DISTINCT a.event_id) as total_events
    FROM studios s
    LEFT JOIN awards a ON s.id = a.studio_id
    GROUP BY s.id
    ORDER BY s.name ASC
    LIMIT ? OFFSET ?
  `, [limit, offset]);
  
  res.render('studios', { studios, currentPage: page, totalPages });
});

app.post('/api/studios/:id/investigate', express.json(), async (req, res) => {
  const db = await openDb();
  const { investigate } = req.body;
  await db.run(`UPDATE studios SET needs_investigation = ? WHERE id = ?`, [investigate ? 1 : 0, req.params.id]);
  res.json({ success: true });
});

app.post('/api/studios/:id/feature', express.json(), async (req, res) => {
  const db = await openDb();
  const { feature } = req.body;
  await db.run(`UPDATE studios SET is_featured = ? WHERE id = ?`, [feature ? 1 : 0, req.params.id]);
  res.json({ success: true });
});

app.get('/admin', async (req, res) => {
  const db = await openDb();
  const flaggedStudios = await db.all(`SELECT id, name FROM studios WHERE needs_investigation = 1 ORDER BY name`);
  const flaggedDancers = await db.all(`SELECT id, name, unique_id FROM dancers WHERE needs_investigation = 1 ORDER BY name`);
  const allStudios = await db.all(`SELECT id, name FROM studios ORDER BY name`);
  
  res.render('admin', { flaggedStudios, flaggedDancers, allStudios });
});

// Admin: Manage Orgs
app.get('/admin/orgs', requireAdmin, async (req, res) => {
  const db = await openDb();
  const orgs = await db.all(`
    SELECT o.*, COUNT(e.id) as event_count 
    FROM organizations o 
    LEFT JOIN events e ON o.id = e.org_id 
    GROUP BY o.id 
    ORDER BY o.name ASC
  `);
  res.render('admin_orgs', { orgs });
});

app.post('/admin/orgs', requireAdmin, async (req, res) => {
  const db = await openDb();
  const { name, slug, website } = req.body;
  
  if (!name || !slug) return res.status(400).send('Name and Slug are required');

  try {
    await db.run('INSERT INTO organizations (name, slug, website) VALUES (?, ?, ?)', [name.trim(), slug.trim(), website ? website.trim() : null]);
    res.redirect('/admin/orgs');
  } catch (e) {
    res.status(400).send('Error creating organization. Slug or Name might already exist.');
  }
});

app.post('/admin/orgs/:id/edit', requireAdmin, async (req, res) => {
  const db = await openDb();
  const { name, slug, website } = req.body;
  
  if (!name || !slug) return res.status(400).send('Name and Slug are required');

  try {
    await db.run('UPDATE organizations SET name = ?, slug = ?, website = ? WHERE id = ?', [name.trim(), slug.trim(), website ? website.trim() : null, req.params.id]);
    res.redirect('/admin/orgs');
  } catch (e) {
    res.status(400).send('Error updating organization. Slug or Name might already exist.');
  }
});

app.post('/admin/orgs/:id/delete', requireAdmin, async (req, res) => {
  const db = await openDb();
  try {
    // Also delete any orphaned events/awards if necessary, or just rely on CASCADE if set up.
    // Given the user said "some times duplicates got accidentally added", they probably don't have events.
    // But to be safe, let's delete the organization.
    await db.run('DELETE FROM organizations WHERE id = ?', [req.params.id]);
    res.redirect('/admin/orgs');
  } catch (e) {
    res.status(500).send('Error deleting organization. Ensure no events are tied to it before deleting.');
  }
});

app.get('/admin/studios', requireAdmin, async (req, res) => {
  const db = await openDb();
  
  const page = parseInt(req.query.page) || 1;
  const search = req.query.search || '';
  const limit = 50;
  const offset = (page - 1) * limit;

  let whereClause = '';
  let queryParams = [];
  
  if (search) {
    whereClause = 'WHERE s.name LIKE ?';
    queryParams.push(`%${search}%`);
  }

  const countRow = await db.get(`SELECT COUNT(*) as count FROM studios s ${whereClause}`, queryParams);
  const totalStudios = countRow.count;
  const totalPages = Math.ceil(totalStudios / limit);

  const queryParams2 = [...queryParams, limit, offset];

  const studios = await db.all(`
    SELECT s.*, 
           COUNT(DISTINCT a.id) as total_awards,
           COUNT(DISTINCT a.event_id) as total_events
    FROM studios s
    LEFT JOIN awards a ON s.id = a.studio_id
    ${whereClause}
    GROUP BY s.id
    ORDER BY s.name ASC
    LIMIT ? OFFSET ?
  `, queryParams2);
  
  res.render('admin_studios', { studios, currentPage: page, totalPages, search });
});

app.get('/admin/claims', requireAdmin, async (req, res) => {
  const db = await openDb();
  const claims = await db.all(`
    SELECT sc.*, u.email as user_email, s.name as studio_name 
    FROM studio_claims sc
    JOIN users u ON sc.user_id = u.id
    JOIN studios s ON sc.studio_id = s.id
    WHERE sc.status = 'pending'
    ORDER BY sc.created_at DESC
  `);
  res.render('admin_claims', { claims });
});

app.post('/admin/claims/:id/approve', requireAdmin, async (req, res) => {
  const db = await openDb();
  const claim = await db.get('SELECT * FROM studio_claims WHERE id = ?', [req.params.id]);
  if (!claim) return res.status(404).send('Claim not found');
  
  await db.run('UPDATE studios SET is_claimed = 1, owner_id = ? WHERE id = ?', [claim.user_id, claim.studio_id]);
  await db.run('UPDATE studio_claims SET status = "approved" WHERE id = ?', [claim.id]);
  await db.run('UPDATE users SET role = "studio_owner" WHERE id = ? AND role = "user"', [claim.user_id]);
  
  res.redirect('/admin/claims');
});

app.post('/admin/claims/:id/reject', requireAdmin, async (req, res) => {
  const db = await openDb();
  await db.run('UPDATE studio_claims SET status = "rejected" WHERE id = ?', [req.params.id]);
  res.redirect('/admin/claims');
});

// Admin Studio Drafts (Bootstrapped Info)
app.get('/admin/studio-drafts', requireAdmin, async (req, res) => {
  const db = await openDb();
  const drafts = await db.all(`
    SELECT d.*, s.name as current_name, s.address as current_address, s.phone as current_phone, s.email as current_email, s.website_url as current_website_url
    FROM studio_info_drafts d
    JOIN studios s ON d.studio_id = s.id
    WHERE d.status = 'pending'
    ORDER BY d.created_at DESC
  `);
  res.render('admin_studio_drafts', { drafts });
});

app.post('/admin/studio-drafts/:id/approve', requireAdmin, async (req, res) => {
  const db = await openDb();
  const draft = await db.get('SELECT * FROM studio_info_drafts WHERE id = ? AND status = "pending"', [req.params.id]);
  if (!draft) return res.status(404).send('Draft not found or already processed');

  // We allow admins to modify the drafted data before saving, so read from req.body
  const { website_url, email, phone, address } = req.body;

  // Update studio with the (potentially modified) scraped data. Only override if field was provided in the form.
  await db.run(`
    UPDATE studios 
    SET 
      website_url = COALESCE(NULLIF(?, ''), website_url),
      email = COALESCE(NULLIF(?, ''), email),
      phone = COALESCE(NULLIF(?, ''), phone),
      address = COALESCE(NULLIF(?, ''), address)
    WHERE id = ?
  `, [website_url, email, phone, address, draft.studio_id]);

  await db.run('UPDATE studio_info_drafts SET status = "approved" WHERE id = ?', [req.params.id]);
  
  res.redirect('/admin/studio-drafts');
});

app.post('/admin/studio-drafts/:id/reject', requireAdmin, async (req, res) => {
  const db = await openDb();
  await db.run('UPDATE studio_info_drafts SET status = "rejected" WHERE id = ?', [req.params.id]);
  res.redirect('/admin/studio-drafts');
});

// Superadmin User Management
app.get('/admin/users', requireSuperadmin, async (req, res) => {
  const db = await openDb();
  const users = await db.all('SELECT id, email, role, is_verified, created_at FROM users ORDER BY created_at DESC');
  res.render('admin_users', { users });
});

app.post('/admin/users/:id/toggle-role', requireSuperadmin, async (req, res) => {
  const db = await openDb();
  const targetUser = await db.get('SELECT id, role FROM users WHERE id = ?', [req.params.id]);
  
  if (!targetUser) return res.status(404).send('User not found');
  if (targetUser.role === 'superadmin') return res.status(400).send('Cannot modify superadmin role');
  
  const newRole = targetUser.role === 'admin' ? 'user' : 'admin';
  await db.run('UPDATE users SET role = ? WHERE id = ?', [newRole, targetUser.id]);
  
  res.redirect('/admin/users');
});

app.get('/admin/compare/studios', async (req, res) => {
  const db = await openDb();
  const { id1, id2 } = req.query;
  
  const allStudios = await db.all(`SELECT id, name FROM studios ORDER BY name`);
  
  let s1 = null, s2 = null;
  let s1Events = [], s2Events = [];
  let s1Dancers = [], s2Dancers = [];

  if (id1) {
    s1 = await db.get(`SELECT * FROM studios WHERE id = ?`, [id1]);
    if (s1) {
      s1Events = await db.all(`
        SELECT DISTINCT e.name, e.year, o.name as org_name 
        FROM awards a
        JOIN events e ON a.event_id = e.id
        JOIN organizations o ON e.org_id = o.id
        WHERE a.studio_id = ?
        ORDER BY e.year DESC, e.name ASC
      `, [id1]);
      
      s1Dancers = await db.all(`
        SELECT d.name, COUNT(a.id) as award_count
        FROM awards a
        JOIN dancers d ON a.dancer_id = d.id
        WHERE a.studio_id = ?
        GROUP BY d.id
        ORDER BY award_count DESC
        LIMIT 10
      `, [id1]);
    }
  }

  if (id2) {
    s2 = await db.get(`SELECT * FROM studios WHERE id = ?`, [id2]);
    if (s2) {
      s2Events = await db.all(`
        SELECT DISTINCT e.name, e.year, o.name as org_name 
        FROM awards a
        JOIN events e ON a.event_id = e.id
        JOIN organizations o ON e.org_id = o.id
        WHERE a.studio_id = ?
        ORDER BY e.year DESC, e.name ASC
      `, [id2]);
      
      s2Dancers = await db.all(`
        SELECT d.name, COUNT(a.id) as award_count
        FROM awards a
        JOIN dancers d ON a.dancer_id = d.id
        WHERE a.studio_id = ?
        GROUP BY d.id
        ORDER BY award_count DESC
        LIMIT 10
      `, [id2]);
    }
  }

  res.render('compare_studios', { allStudios, id1, id2, s1, s2, s1Events, s2Events, s1Dancers, s2Dancers });
});

app.post('/api/merge/studios', express.json(), async (req, res) => {
  const db = await openDb();
  const { sourceId, targetId } = req.body;
  if (!sourceId || !targetId || sourceId === targetId) return res.status(400).json({ error: "Invalid IDs" });
  
  try {
    await db.run('BEGIN TRANSACTION');
    
    // Update awards with traceability
    await db.run(`UPDATE awards SET studio_id = ?, merged_from_studio_id = ? WHERE studio_id = ?`, [targetId, sourceId, sourceId]);
    
    // Transfer dancer associations
    const links = await db.all(`SELECT dancer_id FROM dancer_studios WHERE studio_id = ?`, [sourceId]);
    for (const link of links) {
      const exists = await db.get(`SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [link.dancer_id, targetId]);
      if (!exists) {
         await db.run(`UPDATE dancer_studios SET studio_id = ? WHERE dancer_id = ? AND studio_id = ?`, [targetId, link.dancer_id, sourceId]);
      } else {
         await db.run(`DELETE FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [link.dancer_id, sourceId]);
      }
    }
    
    // Mark source studio as merged, do NOT delete it
    await db.run(`UPDATE studios SET status = 'merged', merged_into_id = ? WHERE id = ?`, [targetId, sourceId]);
    
    await db.run('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await db.run('ROLLBACK');
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reject-merge/studios', express.json(), async (req, res) => {
  const db = await openDb();
  const { sourceId, targetId } = req.body;
  if (!sourceId || !targetId) return res.status(400).json({ error: "Invalid IDs" });
  
  try {
    const studio = await db.get('SELECT rejected_merges FROM studios WHERE id = ?', [targetId]);
    let rejected = studio.rejected_merges ? studio.rejected_merges.split(',') : [];
    if (!rejected.includes(sourceId.toString())) {
      rejected.push(sourceId.toString());
      await db.run('UPDATE studios SET rejected_merges = ? WHERE id = ?', [rejected.join(','), targetId]);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/merge/dancers', express.json(), async (req, res) => {
  const db = await openDb();
  const { sourceId, targetId } = req.body;
  if (!sourceId || !targetId || sourceId === targetId) return res.status(400).json({ error: "Invalid IDs" });
  
  try {
    await db.run(`UPDATE awards SET dancer_id = ? WHERE dancer_id = ?`, [targetId, sourceId]);
    const links = await db.all(`SELECT studio_id FROM dancer_studios WHERE dancer_id = ?`, [sourceId]);
    for (const link of links) {
      const exists = await db.get(`SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [targetId, link.studio_id]);
      if (!exists) {
         await db.run(`UPDATE dancer_studios SET dancer_id = ? WHERE dancer_id = ? AND studio_id = ?`, [targetId, sourceId, link.studio_id]);
      } else {
         await db.run(`DELETE FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [sourceId, link.studio_id]);
      }
    }
    await db.run(`DELETE FROM dancers WHERE id = ?`, [sourceId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/studio/:id', async (req, res) => {
  const db = await openDb();
  
  await db.run('UPDATE studios SET view_count = view_count + 1 WHERE id = ?', [req.params.id]);
  
  const studio = await db.get(`SELECT * FROM studios WHERE id = ?`, [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');

  let mergedIntoStudio = null;
  if (studio.status === 'merged' && studio.merged_into_id) {
    mergedIntoStudio = await db.get('SELECT id, name FROM studios WHERE id = ?', [studio.merged_into_id]);
  }

  const awards = await db.all(`
    SELECT a.*, d.name as dancer_name, d.unique_id, e.name as event_name, e.year as event_year, e.date_string, o.name as org_name 
    FROM awards a
    LEFT JOIN dancers d ON a.dancer_id = d.id
    LEFT JOIN events e ON a.event_id = e.id
    LEFT JOIN organizations o ON e.org_id = o.id
    WHERE a.studio_id = ?
    ORDER BY e.year DESC, e.date_string DESC, a.award_type, a.place
  `, [req.params.id]);

  const awardDancers = await db.all(`
    SELECT ad.award_id, d.name, d.unique_id, ad.status
    FROM award_dancers ad
    JOIN dancers d ON ad.dancer_id = d.id
    WHERE ad.award_id IN (SELECT id FROM awards WHERE studio_id = ?)
  `, [req.params.id]);

  const awardDancersMap = {};
  for (const ad of awardDancers) {
    if (!awardDancersMap[ad.award_id]) awardDancersMap[ad.award_id] = [];
    awardDancersMap[ad.award_id].push({ name: ad.name, unique_id: ad.unique_id, status: ad.status });
  }

  // Group by Year -> Event
  const yearsMap = new Map();
  let totalAwards = 0;
  const eventsAttended = new Set();
  
  for (const award of awards) {
    if (awardDancersMap[award.id]) {
      award.dancers = awardDancersMap[award.id];
    } else if (award.dancer_name) {
      award.dancers = [{ name: award.dancer_name, unique_id: award.unique_id }];
    } else {
      award.dancers = [];
    }
    
    totalAwards++;
    const year = award.event_year || 'Unknown Year';
    const eventKey = `${award.org_name} - ${award.event_name} (${award.date_string})`;
    eventsAttended.add(eventKey);

    if (!yearsMap.has(year)) {
      yearsMap.set(year, new Map());
    }
    
    const eventsMap = yearsMap.get(year);
    if (!eventsMap.has(eventKey)) {
      eventsMap.set(eventKey, {
         title: eventKey,
         eventId: award.event_id,
         awards: []
      });
    }
    
    eventsMap.get(eventKey).awards.push(award);
  }
  
  // Format into arrays for EJS
  const groupedData = Array.from(yearsMap, ([year, eventsMap]) => {
    return {
      year,
      events: Array.from(eventsMap.values())
    };
  });
  
  const yearsActive = Array.from(yearsMap.keys()).sort().reverse();
  const activeYearsStr = yearsActive.length > 0 ? 
    (yearsActive.length === 1 ? `${yearsActive[0]}` : `${yearsActive[yearsActive.length - 1]} - ${yearsActive[0]}`) 
    : 'None';

  const quickStats = {
    totalAwards,
    totalEvents: eventsAttended.size,
    activeYearsStr
  };

  res.render('studio', { studio, mergedIntoStudio, groupedData, quickStats, hasAwards: awards.length > 0 });
});

app.get('/dancer/:unique_id', async (req, res) => {
  const db = await openDb();
  const dancer = await db.get(`
    SELECT * FROM dancers WHERE unique_id = ?
  `, [req.params.unique_id]);
  
  if (!dancer) return res.status(404).send('Dancer not found');

  // Fetch all affiliated studios
  const studios = await db.all(`
    SELECT s.id, s.name, ds.status 
    FROM dancer_studios ds
    JOIN studios s ON ds.studio_id = s.id
    WHERE ds.dancer_id = ?
  `, [dancer.id]);
  
  // Attach studios to the dancer object for the view
  dancer.studios = studios;

  const awards = await db.all(`
    SELECT DISTINCT a.*, e.name as event_name, e.year as event_year,
      (SELECT COUNT(*) FROM award_dancers ad2 WHERE ad2.award_id = a.id) as dancer_count
    FROM awards a
    LEFT JOIN events e ON a.event_id = e.id
    LEFT JOIN award_dancers ad ON a.id = ad.award_id
    WHERE a.dancer_id = ? OR ad.dancer_id = ?
    ORDER BY a.award_type, a.place
  `, [dancer.id, dancer.id]);

  const soloAwards = awards.filter(a => a.dancer_count <= 1 && (!a.category || !a.category.toLowerCase().includes('group')));
  const groupAwards = awards.filter(a => a.dancer_count > 1 || (a.category && a.category.toLowerCase().includes('group')));

  res.render('dancer', { dancer, soloAwards, groupAwards });
});

app.get('/event/:id', async (req, res) => {
  const db = await openDb();
  const event = await db.get(`
    SELECT e.*, o.name as org_name 
    FROM events e
    JOIN organizations o ON e.org_id = o.id
    WHERE e.id = ?
  `, [req.params.id]);

  if (!event) return res.status(404).send('Event not found');

  const awards = await db.all(`
    SELECT a.*, d.name as dancer_name, d.unique_id, s.name as studio_name
    FROM awards a
    LEFT JOIN dancers d ON a.dancer_id = d.id
    LEFT JOIN studios s ON a.studio_id = s.id
    WHERE a.event_id = ?
    ORDER BY s.name, a.award_type, a.place
  `, [req.params.id]);

  const awardDancers = await db.all(`
    SELECT ad.award_id, d.name, d.unique_id
    FROM award_dancers ad
    JOIN dancers d ON ad.dancer_id = d.id
    WHERE ad.award_id IN (SELECT id FROM awards WHERE event_id = ?)
  `, [req.params.id]);

  const awardDancersMap = {};
  for (const ad of awardDancers) {
    if (!awardDancersMap[ad.award_id]) awardDancersMap[ad.award_id] = [];
    awardDancersMap[ad.award_id].push({ name: ad.name, unique_id: ad.unique_id });
  }

  for (const award of awards) {
    if (awardDancersMap[award.id]) {
      award.dancers = awardDancersMap[award.id];
    } else if (award.dancer_name) {
      award.dancers = [{ name: award.dancer_name, unique_id: award.unique_id }];
    } else {
      award.dancers = [];
    }
  }

  // Group by studio
  const studiosMap = new Map();
  for (const award of awards) {
    const studioKey = award.studio_name || 'Unknown Studio';
    if (!studiosMap.has(studioKey)) {
      studiosMap.set(studioKey, { studioId: award.studio_id, awards: [] });
    }
    studiosMap.get(studioKey).awards.push(award);
  }
  
  const groupedAwards = Array.from(studiosMap, ([studioName, data]) => ({
    studioName,
    studioId: data.studioId,
    eventAwards: data.awards
  }));

  res.render('event', { event, groupedAwards });
});

app.post('/admin/backfill-dancers/:event_id', async (req, res) => {
  const db = await openDb();
  const eventId = req.params.event_id;
  
  try {
    const backfilledCount = await runBackfillForEvent(db, eventId);
    res.send(`<script>alert("Successfully backfilled ${backfilledCount} dancer records for this event."); window.location.href='/event/${eventId}';</script>`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error running backfill");
  }
});

app.get('/api/check-dancer-studio', async (req, res) => {
  const { unique_id, studio_id } = req.query;
  const db = await openDb();
  
  if (!unique_id || !studio_id) return res.json({ linked: false });
  
  const dancer = await db.get('SELECT id FROM dancers WHERE unique_id = ?', [unique_id]);
  if (!dancer) return res.json({ linked: false });
  
  const link = await db.get('SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?', [dancer.id, studio_id]);
  return res.json({ linked: !!link });
});

app.post('/api/claim-award', async (req, res) => {
  const { award_id, studio_id, join_code, unique_id, name, birthday } = req.body;
  const db = await openDb();

  try {
    let dancerId = null;
    let isLinked = false;
    let generatedUniqueId = null;
    let dancerName = name;
    let finalUniqueId = null;

    if (unique_id) {
      const dancer = await db.get('SELECT id, name, unique_id FROM dancers WHERE unique_id = ?', [unique_id]);
      if (!dancer) return res.status(404).json({ error: 'Dancer with that Unique ID not found.' });
      dancerId = dancer.id;
      dancerName = dancer.name;
      finalUniqueId = dancer.unique_id;
      const link = await db.get('SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?', [dancerId, studio_id]);
      if (link) isLinked = true;
    } else if (name) {
      // Create new unverified dancer
      generatedUniqueId = generateDancerId(name);
      const result = await db.run(
        'INSERT INTO dancers (unique_id, name, birthday, needs_investigation) VALUES (?, ?, ?, 1)', 
        [generatedUniqueId, name, birthday || null]
      );
      dancerId = result.lastID;
    } else {
      return res.status(400).json({ error: 'Must provide Unique ID or Name.' });
    }

    // If not already linked to the studio, they MUST provide the correct join_code
    if (!isLinked) {
      const studio = await db.get('SELECT id, join_code FROM studios WHERE id = ?', [studio_id]);
      if (!studio || studio.join_code !== join_code) {
        return res.status(400).json({ error: 'The Studio Secret Code you entered is incorrect. Please double check with your Studio Director.' });
      }
      // Insert dancer_studios pending
      await db.run("INSERT INTO dancer_studios (dancer_id, studio_id, status) VALUES (?, ?, 'pending')", [dancerId, studio_id]);
    }

    // Fetch target award to get performance_name and event_id
    const targetAward = await db.get('SELECT event_id, performance_name FROM awards WHERE id = ?', [award_id]);

    // Insert award_dancers pending for the main award
    const existingAwardLink = await db.get('SELECT id FROM award_dancers WHERE dancer_id = ? AND award_id = ?', [dancerId, award_id]);
    if (!existingAwardLink) {
      await db.run("INSERT INTO award_dancers (award_id, dancer_id, status) VALUES (?, ?, 'pending')", [award_id, dancerId]);
    } else {
      return res.status(400).json({ error: 'You are already linked to this award.' });
    }

    let backfilledAwards = [parseInt(award_id)];

    // Backfill other awards with the same performance_name at the same event
    if (targetAward && targetAward.performance_name && targetAward.event_id) {
      const relatedAwards = await db.all(
        'SELECT id FROM awards WHERE event_id = ? AND performance_name = ? AND studio_id = ? AND id != ?',
        [targetAward.event_id, targetAward.performance_name, studio_id, award_id]
      );
      
      for (let rel of relatedAwards) {
        const exist = await db.get('SELECT id FROM award_dancers WHERE dancer_id = ? AND award_id = ?', [dancerId, rel.id]);
        if (!exist) {
          await db.run("INSERT INTO award_dancers (award_id, dancer_id, status) VALUES (?, ?, 'pending')", [rel.id, dancerId]);
          backfilledAwards.push(rel.id);
        }
      }
    }

    if (name && !unique_id) {
      finalUniqueId = generatedUniqueId;
    }

    res.json({ success: true, newUniqueId: generatedUniqueId, dancerName, dancerUniqueId: finalUniqueId, backfilledAwards });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Bootstrap Superadmin
  if (process.env.SUPERADMIN_EMAIL && process.env.SUPERADMIN_PASSWORD) {
    const db = await openDb();
    const existing = await db.get('SELECT id FROM users WHERE email = ?', [process.env.SUPERADMIN_EMAIL]);
    if (!existing) {
      const hash = await bcrypt.hash(process.env.SUPERADMIN_PASSWORD, 10);
      await db.run(
        'INSERT INTO users (email, password_hash, role, is_verified) VALUES (?, ?, ?, ?)',
        [process.env.SUPERADMIN_EMAIL, hash, 'superadmin', 1]
      );
      console.log(`Superadmin bootstrapped: ${process.env.SUPERADMIN_EMAIL}`);
    } else {
      // Ensure role is superadmin if it exists but was downgraded or something
      await db.run('UPDATE users SET role = "superadmin" WHERE email = ?', [process.env.SUPERADMIN_EMAIL]);
    }
  }
});

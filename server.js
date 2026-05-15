require('dotenv').config();
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
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

app.locals.formatPlacement = function (award) {
  // Backwards compatibility if a string/null is passed directly
  let place = award;
  let awardClass = null;
  if (award && typeof award === 'object') {
    place = award.place;
    awardClass = award.award_class;
  }

  if (!place || place === 'N/A' || place === 'null') {
    if (awardClass === 'scholarship' || awardClass === 'title' || awardClass === 'special' || awardClass === 'studio') {
      return 'Winner';
    }
    return 'N/A';
  }
  const strPlace = String(place).trim();
  const num = parseInt(strPlace, 10);
  if (!isNaN(num) && num.toString() === strPlace) {
    const j = num % 10, k = num % 100;
    if (j == 1 && k != 11) return num + "st";
    if (j == 2 && k != 12) return num + "nd";
    if (j == 3 && k != 13) return num + "rd";
    return num + "th";
  }
  return String(place);
};

app.locals.getPremiumDetails = function (award) {
  const text = [award.category, award.award_type, award.performance_name].filter(Boolean).join(' ').toLowerCase();

  if (text.includes('scholarship')) return { isPremium: true, icon: '🎓' };
  if (text.includes('invite') || text.includes('invitation')) return { isPremium: true, icon: '💌' };
  if (text.includes('title') || text.includes('photogenic') || text.match(/\bdoy\b/) || text.includes('dancer of the year')) return { isPremium: true, icon: '👑' };

  return { isPremium: false, icon: '' };
};

app.locals.isPremiumAward = function (award) {
  return app.locals.getPremiumDetails(award).isPremium;
};

app.locals.getCustomIcon = function(award, customIcons) {
  if (!customIcons || typeof customIcons !== 'object') return null;
  const pLower = String(award.place || '').toLowerCase();
  const aClass = award.award_class || '';

  if (aClass === 'title') {
    if (pLower.includes('runner') && customIcons.title && customIcons.title.runnerup) return customIcons.title.runnerup;
    if (customIcons.title && customIcons.title.winner) return customIcons.title.winner;
  }
  
  if (aClass === 'scholarship') {
    if (customIcons.scholarship && customIcons.scholarship.default) return customIcons.scholarship.default;
  }
  
  if (aClass === 'special' || aClass === 'studio') {
    const key = (award.award_type && award.award_type.trim() !== '') ? award.award_type : award.category;
    if (key && customIcons.special && customIcons.special.custom && customIcons.special.custom[key]) {
      return customIcons.special.custom[key];
    }
    
    const text = [award.category, award.award_type, award.performance_name].filter(Boolean).join(' ').toLowerCase();
    if ((text.includes('invite') || text.includes('invitation')) && customIcons.special && customIcons.special.invitation) {
      return customIcons.special.invitation;
    }

    if (customIcons.special && customIcons.special.default) return customIcons.special.default;
  }
  
  if (aClass === 'adjudication') {
    // Adjudications usually store the score string in the place field
    const adjKey = String(award.place || '').trim();
    if (adjKey && customIcons.adjudication && customIcons.adjudication[adjKey]) {
      return customIcons.adjudication[adjKey];
    }
    // Also try award_type just in case the importer mapped it weirdly
    const typeKey = (award.award_type && award.award_type.trim() !== '') ? award.award_type : award.category;
    if (typeKey && customIcons.adjudication && customIcons.adjudication[typeKey]) {
      return customIcons.adjudication[typeKey];
    }
  }
  
  if (aClass === 'overall') {
    if (pLower === '1' || pLower.includes('1st') || pLower === 'winner') {
      if (customIcons.overall && customIcons.overall['1']) return customIcons.overall['1'];
    } else if (pLower === '2' || pLower.includes('2nd')) {
      if (customIcons.overall && customIcons.overall['2']) return customIcons.overall['2'];
    } else if (pLower === '3' || pLower.includes('3rd')) {
      if (customIcons.overall && customIcons.overall['3']) return customIcons.overall['3'];
    }
    if (customIcons.overall && customIcons.overall['other']) return customIcons.overall['other'];
  }
  
  return null;
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
      const studioDomain = new URL(studio.website_url.startsWith('http') ? studio.website_url : `https://${studio.website_url}`).hostname.replace(/^www\./i, '').toLowerCase();
      const userDomain = user.email.split('@')[1].toLowerCase();
      if (studioDomain === userDomain) {
        autoApproved = true;
      }
    } catch (e) {
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

app.get('/claim/dancer/:id', requireAuth, async (req, res) => {
  const db = await openDb();
  const dancer = await db.get('SELECT id, name, unique_id, is_claimed FROM dancers WHERE id = ?', [req.params.id]);
  if (!dancer) return res.status(404).send('Dancer not found');
  res.render('claim_dancer', { dancer, error: null });
});

app.post('/claim/dancer/:id', requireAuth, async (req, res) => {
  const { relationship, proof } = req.body;
  const db = await openDb();

  const dancer = await db.get('SELECT * FROM dancers WHERE id = ?', [req.params.id]);
  if (!dancer) return res.status(404).send('Dancer not found');

  if (dancer.is_claimed) {
    return res.render('claim_dancer', { dancer, error: 'Dancer is already claimed.' });
  }

  const proof_text = `Relationship: ${relationship}\nDetails: ${proof}`;
  const user = req.session.user;

  await db.run('INSERT INTO dancer_claims (user_id, dancer_id, proof_text, status) VALUES (?, ?, ?, ?)', [user.id, dancer.id, proof_text, 'pending']);
  return res.send(`<script>alert("Claim submitted successfully! Our admins will review your request shortly."); window.location.href="/dancer/${dancer.unique_id}";</script>`);
});

// Studio Management Routes
// Organization Dashboard
app.get('/manage/org/:id', requireAuth, async (req, res) => {
  const db = await openDb();
  const org = await db.get('SELECT * FROM organizations WHERE id = ?', [req.params.id]);
  if (!org) return res.status(404).send('Organization not found');

  if (org.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin') {
    return res.status(403).send('Forbidden: You do not own this organization profile.');
  }

  // Get stats
  const stats = await db.get(`
    SELECT 
      COUNT(DISTINCT a.studio_id) as total_studios,
      COUNT(a.id) as total_awards
    FROM awards a
    JOIN events e ON a.event_id = e.id
    WHERE e.org_id = ?
  `, [org.id]);

  // Determine rank by total awards
  const rankQuery = await db.all(`
    SELECT o.id, COUNT(a.id) as total_awards
    FROM organizations o
    JOIN events e ON o.id = e.org_id
    JOIN awards a ON e.id = a.event_id
    GROUP BY o.id
    ORDER BY total_awards DESC
  `);

  let rank = -1;
  for (let i = 0; i < rankQuery.length; i++) {
    if (rankQuery[i].id === org.id) {
      rank = i + 1;
      break;
    }
  }

  // Get events
  const events = await db.all('SELECT * FROM events WHERE org_id = ? ORDER BY year DESC, date_string DESC', [org.id]);

  // Get top dancer for this org (mock example)
  const topDancer = await db.get(`
    SELECT d.id, d.unique_id, d.name, COUNT(a.id) as award_count
    FROM dancers d
    JOIN award_dancers ad ON d.id = ad.dancer_id
    JOIN awards a ON ad.award_id = a.id
    JOIN events e ON a.event_id = e.id
    WHERE e.org_id = ? AND length(d.name) > 5 AND a.place IN ('1', '1st', 'Winner')
    GROUP BY d.id
    ORDER BY award_count DESC
    LIMIT 1
  `, [org.id]);

  // Get top studio for this org (mock example)
  const topStudio = await db.get(`
    SELECT s.id, s.name, COUNT(a.id) as award_count
    FROM studios s
    JOIN awards a ON s.id = a.studio_id
    JOIN events e ON a.event_id = e.id
    WHERE e.org_id = ? AND length(s.name) > 5 AND s.name NOT LIKE '%Independent%'
    GROUP BY s.id
    ORDER BY award_count DESC
    LIMIT 1
  `, [org.id]);

  // Get org uploads
  const uploads = await db.all('SELECT * FROM org_uploads WHERE org_id = ? ORDER BY created_at DESC', [org.id]);

  res.render('manage_org', { org, stats, rank, events, uploads, topDancer, topStudio, user: req.session.user });
});

// Configure multer for org uploads
const orgUpload = multer({ dest: 'tobeprocessed/org_uploads/' });
const brandingUpload = multer({ dest: 'public/uploads/org_branding/' });

app.post('/manage/org/:id/upload', requireAuth, orgUpload.single('results_file'), async (req, res) => {
  const db = await openDb();
  const org = await db.get('SELECT * FROM organizations WHERE id = ?', [req.params.id]);
  if (!org) return res.status(404).send('Organization not found');

  if (org.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin') {
    return res.status(403).send('Forbidden');
  }

  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }

  const { event_name, event_date, event_location } = req.body;
  const filePath = req.file.path;

  await db.run(`
    INSERT INTO org_uploads (org_id, event_name, event_date, event_location, file_path)
    VALUES (?, ?, ?, ?, ?)
  `, [org.id, event_name, event_date, event_location, filePath]);

  res.redirect('/manage/org/' + org.id);
});

app.get('/manage/org/:id/branding', requireAuth, async (req, res) => {
  const db = await openDb();
  const org = await db.get('SELECT * FROM organizations WHERE id = ?', [req.params.id]);
  if (!org) return res.status(404).send('Org not found');
  
  if (req.session.user.role !== 'superadmin' && org.owner_id !== req.session.user.id) {
    return res.status(403).send('Unauthorized');
  }

  // Get distinct award types (or categories if award_type is empty) for this org's events, ranked by frequency
  const awardTypes = await db.all(`
    SELECT COALESCE(NULLIF(TRIM(a.award_type), ''), TRIM(a.category)) as award_type, COUNT(a.id) as freq
    FROM awards a
    JOIN events e ON a.event_id = e.id
    WHERE e.org_id = ? AND COALESCE(NULLIF(TRIM(a.award_type), ''), TRIM(a.category)) IS NOT NULL AND COALESCE(NULLIF(TRIM(a.award_type), ''), TRIM(a.category)) != ''
    GROUP BY COALESCE(NULLIF(TRIM(a.award_type), ''), TRIM(a.category))
    ORDER BY freq DESC
  `, [org.id]);

  let customIcons = {};
  try {
    if (org.custom_icons) customIcons = JSON.parse(org.custom_icons);
  } catch(e) {}

  res.render('manage_org_branding', { org, awardTypes, customIcons, user: req.session.user });
});

app.post('/manage/org/:id/marketing', requireAuth, async (req, res) => {
  const db = await openDb();
  const org = await db.get('SELECT * FROM organizations WHERE id = ?', [req.params.id]);
  if (!org) return res.status(404).send('Org not found');
  if (req.session.user.role !== 'superadmin' && org.owner_id !== req.session.user.id) return res.status(403).send('Unauthorized');

  const { description, slogan } = req.body;
  
  await db.run('UPDATE organizations SET description = ?, slogan = ? WHERE id = ?', [description, slogan, org.id]);
  
  res.redirect('/manage/org/' + org.id);
});

app.post('/manage/org/:id/branding/logo', requireAuth, brandingUpload.single('logo'), async (req, res) => {
  const db = await openDb();
  const org = await db.get('SELECT * FROM organizations WHERE id = ?', [req.params.id]);
  if (!org) return res.status(404).send('Org not found');
  if (req.session.user.role !== 'superadmin' && org.owner_id !== req.session.user.id) return res.status(403).send('Unauthorized');

  if (!req.file) return res.redirect('/manage/org/' + org.id + '/branding');

  const logoUrl = '/uploads/org_branding/' + req.file.filename;
  await db.run('UPDATE organizations SET logo_url = ? WHERE id = ?', [logoUrl, org.id]);
  
  res.redirect('/manage/org/' + org.id + '/branding');
});

app.post('/manage/org/:id/branding/logo-settings', requireAuth, async (req, res) => {
  const db = await openDb();
  const org = await db.get('SELECT * FROM organizations WHERE id = ?', [req.params.id]);
  if (!org) return res.status(404).send('Org not found');
  if (req.session.user.role !== 'superadmin' && org.owner_id !== req.session.user.id) return res.status(403).send('Unauthorized');

  let customIcons = {};
  if (org.custom_icons) {
    try { customIcons = JSON.parse(org.custom_icons); } catch (e) {}
  }
  
  customIcons.hide_logo = req.body.show_logo !== 'on'; // Checkbox is 'on' when checked
  customIcons.logo_size = parseInt(req.body.logo_size) || 24;
  customIcons.logo_opacity = parseFloat(req.body.logo_opacity);
  if (isNaN(customIcons.logo_opacity)) customIcons.logo_opacity = 0.6;

  await db.run('UPDATE organizations SET custom_icons = ? WHERE id = ?', [JSON.stringify(customIcons), org.id]);

  res.redirect('/manage/org/' + org.id + '/branding');
});

app.post('/manage/org/:id/branding/icon', requireAuth, brandingUpload.single('icon'), async (req, res) => {
  const db = await openDb();
  const org = await db.get('SELECT * FROM organizations WHERE id = ?', [req.params.id]);
  if (!org) return res.status(404).send('Org not found');
  if (req.session.user.role !== 'superadmin' && org.owner_id !== req.session.user.id) return res.status(403).send('Unauthorized');

  const { icon_class, icon_key } = req.body;
  if (!icon_class) return res.status(400).send('Icon class required');

  let customIcons = {};
  try {
    if (org.custom_icons) customIcons = JSON.parse(org.custom_icons);
  } catch(e) {}

  if (!customIcons[icon_class]) customIcons[icon_class] = {};

  if (req.file) {
    const filePath = '/uploads/org_branding/' + req.file.filename;
    if (icon_class === 'scholarship') {
      customIcons.scholarship.default = filePath;
    } else if (icon_class === 'special' && icon_key === 'default') {
      customIcons.special.default = filePath;
    } else if (icon_class === 'special') {
      if (!customIcons.special.custom) customIcons.special.custom = {};
      customIcons.special.custom[icon_key] = filePath;
    } else {
      customIcons[icon_class][icon_key] = filePath;
    }
    await db.run('UPDATE organizations SET custom_icons = ? WHERE id = ?', [JSON.stringify(customIcons), org.id]);
  }
  
  res.redirect('/manage/org/' + org.id + '/branding');
});

app.post('/manage/org/:id/branding/icon/delete', requireAuth, async (req, res) => {
  const db = await openDb();
  const org = await db.get('SELECT * FROM organizations WHERE id = ?', [req.params.id]);
  if (!org) return res.status(404).send('Org not found');
  if (req.session.user.role !== 'superadmin' && org.owner_id !== req.session.user.id) return res.status(403).send('Unauthorized');

  const { icon_class, icon_key } = req.body;
  let customIcons = {};
  try {
    if (org.custom_icons) customIcons = JSON.parse(org.custom_icons);
  } catch(e) {}

  if (customIcons[icon_class]) {
    if (icon_class === 'scholarship') {
      delete customIcons.scholarship.default;
    } else if (icon_class === 'special' && icon_key === 'default') {
      delete customIcons.special.default;
    } else if (icon_class === 'special' && customIcons.special.custom) {
      delete customIcons.special.custom[icon_key];
    } else {
      delete customIcons[icon_class][icon_key];
    }
    await db.run('UPDATE organizations SET custom_icons = ? WHERE id = ?', [JSON.stringify(customIcons), org.id]);
  }
  
  res.redirect('/manage/org/' + org.id + '/branding');
});

app.get('/manage/studio/:id', requireAuth, async (req, res) => {
  const db = await openDb();
  let studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);

  if (!studio) return res.status(404).send('Studio not found');
  if (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin') return res.status(403).send('Forbidden: Not the owner');

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

  let prefs = {};
  if (studio.public_preferences) {
    try { prefs = JSON.parse(studio.public_preferences); } catch (e) { }
  }
  if (Object.keys(prefs).length === 0) {
    prefs = { show_total_awards: true, show_events_attended: true, show_1st_place_finishes: true, show_1st_place_this_year: true, show_past_5_years: true, show_this_year: true };
  }
  studio.prefs = prefs;

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
  if (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin') return res.status(403).send('Forbidden: Not the owner');

  const prefs = {
    show_total_awards: req.body.show_total_awards === 'on',
    show_events_attended: req.body.show_events_attended === 'on',
    show_1st_place_finishes: req.body.show_1st_place_finishes === 'on',
    show_1st_place_this_year: req.body.show_1st_place_this_year === 'on',
    show_past_5_years: req.body.show_past_5_years === 'on',
    show_this_year: req.body.show_this_year === 'on'
  };

  await db.run(`
    UPDATE studios 
    SET name = ?, website_url = ?, email = ?, phone = ?, logo_url = ?, bio = ?, instagram_handle = ?, tiktok_handle = ?, public_preferences = ?
    WHERE id = ?
  `, [name, website_url, email, phone, logo_url, bio, instagram_handle, tiktok_handle, JSON.stringify(prefs), req.params.id]);

  const updatedStudio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  res.render('manage_studio', { studio: updatedStudio, success: 'Profile updated successfully!' });
});

app.get('/manage/studio/:id/roster/export', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  if (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin') return res.status(403).send('Forbidden');

  const roster = await db.all(`
    SELECT d.name, d.unique_id, d.birthday, ds.status, ds.graduation_year,
           (SELECT COUNT(*) FROM award_dancers ad JOIN awards a ON ad.award_id = a.id WHERE ad.dancer_id = d.id AND a.studio_id = ds.studio_id) as total_awards
    FROM dancers d
    JOIN dancer_studios ds ON d.id = ds.dancer_id
    WHERE ds.studio_id = ? AND ds.status != 'alumni'
    ORDER BY d.name ASC
  `, [req.params.id]);

  let csvContent = "Name,Unique ID,Birthday,Status,Graduation Year,Total Awards\n";
  for (const row of roster) {
    const name = `"${row.name.replace(/"/g, '""')}"`;
    const dob = row.birthday || "";
    const status = row.status || "active";
    const grad = row.graduation_year || "";
    csvContent += `${name},${row.unique_id},${dob},${status},${grad},${row.total_awards}\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="studio_${studio.id}_active_roster.csv"`);
  res.send(csvContent);
});

app.get('/manage/studio/:id/roster', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  if (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin') return res.status(403).send('Forbidden: Not the owner');

  const roster = await db.all(`
    SELECT d.id, d.unique_id, d.name, d.birthday, ds.status, ds.headshot_url, ds.graduation_year,
           (SELECT COUNT(*) FROM award_dancers ad JOIN awards a ON ad.award_id = a.id WHERE ad.dancer_id = d.id AND a.studio_id = ds.studio_id) as total_awards
    FROM dancers d
    JOIN dancer_studios ds ON d.id = ds.dancer_id
    WHERE ds.studio_id = ?
    ORDER BY d.name ASC
  `, [req.params.id]);

  const studioAwardsRaw = await db.all(`
    SELECT ad.dancer_id, a.place, a.category, a.performance_name, e.year, e.name as event_name
    FROM award_dancers ad
    JOIN awards a ON ad.award_id = a.id
    JOIN events e ON a.event_id = e.id
    WHERE a.studio_id = ?
    ORDER BY e.year DESC, a.id DESC
  `, [req.params.id]);

  const awardsByDancer = {};
  for (const award of studioAwardsRaw) {
    if (!awardsByDancer[award.dancer_id]) awardsByDancer[award.dancer_id] = [];
    if (awardsByDancer[award.dancer_id].length < 3) {
      awardsByDancer[award.dancer_id].push(award);
    }
  }

  roster.forEach(d => {
    d.recent_awards = awardsByDancer[d.id] || [];
  });

  const suspectedDuplicatesRaw = await db.all(`
    SELECT d.name, d.id, d.unique_id, d.birthday, d.claimed_by_user_id,
           (SELECT COUNT(*) FROM award_dancers ad JOIN awards a ON ad.award_id = a.id WHERE ad.dancer_id = d.id AND a.studio_id = ds.studio_id) as total_awards
    FROM dancers d
    JOIN dancer_studios ds ON d.id = ds.dancer_id
    WHERE ds.studio_id = ?
      AND LOWER(d.name) IN (
        SELECT LOWER(d2.name)
        FROM dancers d2
        JOIN dancer_studios ds2 ON d2.id = ds2.dancer_id
        WHERE ds2.studio_id = ?
        GROUP BY LOWER(d2.name)
        HAVING COUNT(*) > 1
      )
      AND LOWER(d.name) NOT IN (
        SELECT LOWER(dancer_name) FROM studio_duplicate_exceptions WHERE studio_id = ?
      )
    ORDER BY d.name ASC, total_awards DESC
  `, [req.params.id, req.params.id, req.params.id]);

  const duplicateSets = {};
  suspectedDuplicatesRaw.forEach(row => {
    const key = row.name.toLowerCase();
    if (!duplicateSets[key]) duplicateSets[key] = { name: row.name, profiles: [] };
    duplicateSets[key].profiles.push(row);
  });

  res.render('manage_studio_roster', { studio, roster, duplicateSets });
});

app.post('/manage/studio/:id/roster/:dancerId/update', requireAuth, async (req, res) => {
  const { headshot_url, graduation_year, status, birthday } = req.body;
  const db = await openDb();

  const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).send('Forbidden');

  await db.run(`
    UPDATE dancer_studios 
    SET headshot_url = ?, graduation_year = ?, status = ?
    WHERE studio_id = ? AND dancer_id = ?
  `, [headshot_url || null, graduation_year || null, status || 'active', req.params.id, req.params.dancerId]);

  if (birthday !== undefined) {
    await db.run(`UPDATE dancers SET birthday = ? WHERE id = ?`, [birthday || null, req.params.dancerId]);
  }

  res.redirect(`/manage/studio/${req.params.id}/roster`);
});

app.post('/manage/studio/:id/roster/:dancerId/toggle-status', requireAuth, async (req, res) => {
  const { new_status } = req.body;
  const db = await openDb();

  const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (new_status !== 'active' && new_status !== 'alumni') {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    await db.run(`
      UPDATE dancer_studios 
      SET status = ?
      WHERE studio_id = ? AND dancer_id = ?
    `, [new_status, req.params.id, req.params.dancerId]);
    
    res.json({ success: true, status: new_status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/manage/studio/:id/awards/self-report', requireAuth, async (req, res) => {
  const { event_name, year, category, performance_name, place, dancer_ids } = req.body;
  const db = await openDb();

  const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).send('Forbidden');

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

app.post('/manage/studio/:id/awards/csv-preview', requireAuth, upload.single('csvFile'), async (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded');
  const db = await openDb();
  
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).send('Forbidden');

  try {
    const fileContent = fs.readFileSync(req.file.path, 'utf-8');
    const records = parse(fileContent, { columns: true, skip_empty_lines: true, trim: true });
    
    const previewData = [];
    const roster = await db.all(`
      SELECT d.id, d.name 
      FROM dancer_studios ds
      JOIN dancers d ON ds.dancer_id = d.id
      WHERE ds.studio_id = ?
    `, [req.params.id]);

    for (const row of records) {
      const findKey = (search) => Object.keys(row).find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '').includes(search));
      
      const eventName = row[findKey('competition')] || row[findKey('event')] || '';
      const year = row[findKey('year')] || '';
      const performanceName = row[findKey('routine')] || row[findKey('performance')] || '';
      const place = row[findKey('place')] || row[findKey('result')] || '';
      const category = row[findKey('category')] || '';
      const dancersStr = row[findKey('dancer')] || '';

      const missing = [];
      if (!eventName) missing.push('Competition Name');
      if (!year) missing.push('Year');
      if (!performanceName) missing.push('Routine Name');
      if (!place) missing.push('Place');

      const matchedDancers = [];
      if (dancersStr) {
        const names = dancersStr.split(',').map(n => n.trim()).filter(n => n);
        for (const name of names) {
          const match = roster.find(r => r.name.toLowerCase() === name.toLowerCase());
          if (match) {
            matchedDancers.push({ id: match.id, name: match.name, matched: true });
          } else {
            matchedDancers.push({ name: name, matched: false });
          }
        }
      }

      previewData.push({
        event_name: eventName,
        year: year,
        performance_name: performanceName,
        place: place,
        category: category,
        dancers: matchedDancers,
        isValid: missing.length === 0,
        missing: missing
      });
    }

    fs.unlinkSync(req.file.path);
    res.render('manage_studio_awards_csv', { studio, previewData });
  } catch (err) {
    if (req.file) fs.unlinkSync(req.file.path);
    console.error(err);
    res.status(500).send('Error parsing CSV. Please ensure you are using the correct template format.');
  }
});

app.post('/manage/studio/:id/awards/csv-commit', requireAuth, async (req, res) => {
  const { preview_data } = req.body;
  const db = await openDb();

  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).send('Forbidden');

  if (preview_data) {
    let rows = [];
    try {
      rows = JSON.parse(preview_data);
    } catch (e) {
      return res.status(400).send('Invalid data format received.');
    }

    for (const row of rows) {
      if (!row.isValid) continue;

      let event = await db.get('SELECT id FROM events WHERE name = ? AND year = ? AND org_id IS NULL', [row.event_name, row.year]);
      if (!event) {
        await db.run('INSERT INTO events (name, year, org_id) VALUES (?, ?, NULL)', [row.event_name, row.year]);
        event = await db.get('SELECT id FROM events ORDER BY id DESC LIMIT 1');
      }

      await db.run(`
        INSERT INTO awards (event_id, place, performance_name, category, studio_id, is_self_added, verification_status)
        VALUES (?, ?, ?, ?, ?, 1, 'unverified')
      `, [event.id, row.place, row.performance_name, row.category, req.params.id]);

      const award = await db.get('SELECT id FROM awards ORDER BY id DESC LIMIT 1');

      for (const d of row.dancers) {
        if (d.matched && d.id) {
          await db.run('INSERT INTO award_dancers (award_id, dancer_id) VALUES (?, ?)', [award.id, d.id]);
        } else if (!d.matched && d.name) {
          await db.run('INSERT INTO dancers (name) VALUES (?)', [d.name]);
          const newDancer = await db.get('SELECT id FROM dancers ORDER BY id DESC LIMIT 1');
          await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [newDancer.id, req.params.id]);
          await db.run('INSERT INTO award_dancers (award_id, dancer_id) VALUES (?, ?)', [award.id, newDancer.id]);
        }
      }
    }
  }

  res.redirect(`/manage/studio/${req.params.id}/awards`);
});

app.get('/api/dancers/search', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const { q, studio } = req.query;
  if (!q || q.length < 2) return res.json([]);
  const db = await openDb();

  let query = `
    SELECT d.id, d.name, d.unique_id,
           (SELECT COUNT(*) FROM award_dancers ad WHERE ad.dancer_id = d.id) as award_count,
           (SELECT GROUP_CONCAT(s.name, ', ') 
            FROM dancer_studios ds 
            JOIN studios s ON ds.studio_id = s.id 
            WHERE ds.dancer_id = d.id) as studio_names
    FROM dancers d
    WHERE d.name LIKE ?
  `;
  const params = [`%${q}%`];

  const dancersRaw = await db.all(query, params);
  
  // Filter by studio in JS since it's an alias from a subquery and SQLite is finicky
  let dancers = dancersRaw;
  if (studio && studio.length >= 2) {
    const studioLower = studio.toLowerCase();
    dancers = dancersRaw.filter(d => d.studio_names && d.studio_names.toLowerCase().includes(studioLower));
  }

  // Sort and limit
  dancers = dancers.sort((a, b) => b.award_count - a.award_count).slice(0, 20);

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
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).send('Forbidden');

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

// Clean Duplicate Set (1-Click Merge)
app.post('/manage/studio/:id/roster/clean-duplicate-set', requireAuth, async (req, res) => {
  const { duplicate_name } = req.body;
  const db = await openDb();

  const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).json({ error: 'Forbidden' });

  if (!duplicate_name) return res.status(400).json({ error: 'Missing name' });

  try {
    // Fetch all profiles for this exact name in this studio
    const profiles = await db.all(`
      SELECT d.id, d.claimed_by_user_id,
             (SELECT COUNT(*) FROM award_dancers ad JOIN awards a ON ad.award_id = a.id WHERE ad.dancer_id = d.id AND a.studio_id = ds.studio_id) as total_awards
      FROM dancers d
      JOIN dancer_studios ds ON d.id = ds.dancer_id
      WHERE ds.studio_id = ? AND LOWER(d.name) = ?
    `, [req.params.id, duplicate_name.trim().toLowerCase()]);

    if (profiles.length < 2) return res.status(400).json({ error: 'No duplicates found for this name.' });

    // Determine Primary
    // Priority 1: Claimed
    // Priority 2: Most awards
    profiles.sort((a, b) => {
      if (a.claimed_by_user_id && !b.claimed_by_user_id) return -1;
      if (!a.claimed_by_user_id && b.claimed_by_user_id) return 1;
      return b.total_awards - a.total_awards;
    });

    const primaryId = profiles[0].id;
    const duplicatesToMerge = profiles.slice(1).map(p => p.id);

    await db.run('BEGIN TRANSACTION');

    for (let dupId of duplicatesToMerge) {
      await db.run('INSERT OR IGNORE INTO award_dancers (award_id, dancer_id) SELECT award_id, ? FROM award_dancers WHERE dancer_id = ?', [primaryId, dupId]);
      await db.run('DELETE FROM award_dancers WHERE dancer_id = ?', [dupId]);

      await db.run('INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id, status) SELECT ?, studio_id, status FROM dancer_studios WHERE dancer_id = ?', [primaryId, dupId]);
      await db.run('DELETE FROM dancer_studios WHERE dancer_id = ?', [dupId]);

      await db.run('DELETE FROM dancers WHERE id = ?', [dupId]);
    }

    await db.run('COMMIT');
    res.json({ success: true, merged: duplicatesToMerge.length });
  } catch (err) {
    await db.run('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
});

// Ignore Duplicate Set
app.post('/manage/studio/:id/roster/ignore-duplicate-set', requireAuth, async (req, res) => {
  const { duplicate_name } = req.body;
  const db = await openDb();

  const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).json({ error: 'Forbidden' });

  if (!duplicate_name) return res.status(400).json({ error: 'Missing name' });

  try {
    await db.run('INSERT OR IGNORE INTO studio_duplicate_exceptions (studio_id, dancer_name) VALUES (?, ?)', [req.params.id, duplicate_name.trim().toLowerCase()]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
});

app.post('/manage/studio/:id/roster/csv-preview', requireAuth, upload.single('roster_csv'), async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).send('Forbidden');

  if (!req.file) return res.status(400).send('No file uploaded');

  try {
    const fileContent = fs.readFileSync(req.file.path, 'utf-8');
    const records = parse(fileContent, { columns: true, skip_empty_lines: true, trim: true });

    // We need 'name' at minimum
    if (records.length > 0 && !records[0].name) {
      // maybe they capitalized Name? Let's lowercase all keys
      records.forEach(r => {
        Object.keys(r).forEach(k => {
          if (k.toLowerCase() !== k) {
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
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).send('Forbidden');

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
        const status = 'active';
        const gradYear = null;

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
  const { claim_unique_id, new_dancer_name, birthday } = req.body;
  const db = await openDb();

  const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).send('Forbidden');

  let finalDancerId = null;

  if (claim_unique_id) {
    const existingDancer = await db.get('SELECT id FROM dancers WHERE unique_id = ?', [claim_unique_id.trim()]);
    if (!existingDancer) {
      return res.status(404).send('Dancer not found with that Unique ID.');
    }
    finalDancerId = existingDancer.id;
  } else if (new_dancer_name) {
    // Create new dancer
    const uniqueId = generateDancerId(new_dancer_name);
    await db.run('INSERT INTO dancers (unique_id, name, birthday) VALUES (?, ?, ?)', [uniqueId, new_dancer_name, birthday || null]);
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
  if (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin') return res.status(403).send('Forbidden: Not the owner');

  const pendingAwards = await db.all(`
    SELECT ad.id as link_id, ad.award_id, d.name as dancer_name, d.unique_id, a.performance_name, a.award_type, e.name as event_name, e.year
    FROM award_dancers ad
    JOIN dancers d ON ad.dancer_id = d.id
    JOIN awards a ON ad.award_id = a.id
    JOIN events e ON a.event_id = e.id
    WHERE ad.status = 'pending' AND a.studio_id = ?
  `, [studio.id]);

  const pendingRoster = await db.all(`
    SELECT ds.id as link_id, d.name as dancer_name, d.unique_id, ds.created_at
    FROM dancer_studios ds
    JOIN dancers d ON ds.dancer_id = d.id
    WHERE ds.status = 'pending' AND ds.studio_id = ?
  `, [studio.id]);

  res.render('manage_studio_verifications', { studio, pendingAwards, pendingRoster });
});

app.post('/manage/studio/:id/verifications/award/:link_id/approve', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).send('Forbidden');

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
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).send('Forbidden');

  await db.run("DELETE FROM award_dancers WHERE id = ?", [req.params.link_id]);
  res.redirect(`/manage/studio/${studio.id}/verifications`);
});

app.post('/manage/studio/:id/verifications/roster/:link_id/approve', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).send('Forbidden');

  await db.run('UPDATE dancer_studios SET status = "active" WHERE id = ?', [req.params.link_id]);

  res.redirect(`/manage/studio/${req.params.id}/verifications`);
});

app.post('/manage/studio/:id/verifications/roster/:link_id/deny', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).send('Forbidden');

  await db.run('DELETE FROM dancer_studios WHERE id = ?', [req.params.link_id]);

  res.redirect(`/manage/studio/${req.params.id}/verifications`);
});

app.post('/api/studios/:id/verifications/bulk', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).send('Forbidden');

  const { type, action, linkIds } = req.body;
  if (!Array.isArray(linkIds) || linkIds.length === 0) return res.status(400).json({ error: 'Invalid linkIds' });

  try {
    if (type === 'award') {
      if (action === 'approve') {
        for (const link_id of linkIds) {
          const link = await db.get('SELECT dancer_id FROM award_dancers WHERE id = ?', [link_id]);
          if (link) {
            await db.run("UPDATE award_dancers SET status = 'verified' WHERE id = ?", [link_id]);
            await db.run("UPDATE dancer_studios SET status = 'active' WHERE dancer_id = ? AND studio_id = ?", [link.dancer_id, studio.id]);
          }
        }
      } else if (action === 'deny') {
        for (const link_id of linkIds) {
          await db.run("DELETE FROM award_dancers WHERE id = ?", [link_id]);
        }
      }
    } else if (type === 'roster') {
      if (action === 'approve') {
        for (const link_id of linkIds) {
          await db.run("UPDATE dancer_studios SET status = 'active' WHERE id = ?", [link_id]);
        }
      } else if (action === 'deny') {
        for (const link_id of linkIds) {
          await db.run("DELETE FROM dancer_studios WHERE id = ?", [link_id]);
        }
      }
    } else {
      return res.status(400).json({ error: 'Invalid type' });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/manage/studio/:id/awards', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  if (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin') return res.status(403).send('Forbidden: Not the owner');

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
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).send('Forbidden');

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
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).send('Forbidden');

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
      const unique_id = generateDancerId(dancer_name);
      const result = await db.run('INSERT INTO dancers (unique_id, name) VALUES (?, ?)', [unique_id, dancer_name]);
      dancer = { id: result.lastID };
    }

    try {
      await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [dancer.id, req.params.id]);
    } catch (e) { }

    await db.run('INSERT INTO award_dancers (award_id, dancer_id) VALUES (?, ?)', [req.params.awardId, dancer.id]);
  } catch (e) { console.error(e); }

  res.redirect(`/manage/studio/${req.params.id}/awards${yearQuery}`);
});

app.post('/manage/studio/:id/awards/:awardId/dancers/:dancerId/remove', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio || (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) return res.status(403).send('Forbidden');

  await db.run('DELETE FROM award_dancers WHERE award_id = ? AND dancer_id = ?', [req.params.awardId, req.params.dancerId]);

  const yearQuery = req.query.year ? `?year=${req.query.year}` : '';
  res.redirect(`/manage/studio/${req.params.id}/awards${yearQuery}`);
});

// Widget Builder UI
app.get('/manage/studio/:id/widget', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  if (studio.owner_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin') return res.status(403).send('Forbidden');

  res.render('manage_studio_widget', { studio });
});

// Public Widget Iframe Route
app.get('/widget/studio/:id', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.removeHeader('X-Frame-Options');

  const db = await openDb();
  const studio = await db.get('SELECT name, logo_url FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');

  const baseQuery = `
    SELECT a.id, a.place, a.performance_name, a.award_type, a.category, e.name as event_name, e.year, GROUP_CONCAT(d.name, ', ') as dancer_name
    FROM awards a
    LEFT JOIN events e ON a.event_id = e.id
    LEFT JOIN award_dancers ad ON a.id = ad.award_id
    LEFT JOIN dancers d ON ad.dancer_id = d.id
    WHERE a.studio_id = ?
    GROUP BY a.id
    ORDER BY e.year DESC, e.date_string DESC
  `;
  
  const awardsRaw = await db.all(baseQuery, [req.params.id]);

  const theme = req.query.theme || 'dark';
  const primaryColor = req.query.primary || 'ec4899';
  const bg = req.query.bg || (theme === 'dark' ? '000000' : 'ffffff');
  const layout = req.query.layout || 'list';
  const premiumOnly = req.query.premiumOnly === 'true';
  const topPlacementsOnly = req.query.topPlacementsOnly === 'true';
  
  const showTotalAwards = req.query.showTotalAwards !== 'false'; // default true for stats
  const showTopPlacements = req.query.showTopPlacements !== 'false';
  const showPastYear = req.query.showPastYear !== 'false';
  const widgetType = req.query.widgetType || 'both'; // 'stats', 'awards', or 'both'

  const currentYear = new Date().getFullYear();
  const widgetStats = {
    totalAwards: awardsRaw.length,
    pastYearAwards: awardsRaw.filter(a => parseInt(a.year, 10) === currentYear).length,
    topPlacements: awardsRaw.filter(a => {
      if (!a.place) return false;
      const p = String(a.place).toLowerCase();
      return p === '1' || p.includes('1st') || p === '2' || p.includes('2nd') || p === '3' || p.includes('3rd') || p === 'winner';
    }).length
  };

  let awards = awardsRaw;

  if (premiumOnly || topPlacementsOnly) {
    awards = awards.filter(award => {
      let isTopPlace = false;
      if (award.place) {
        const pLower = String(award.place).toLowerCase();
        if (pLower === '1' || pLower.includes('1st') || pLower === '2' || pLower.includes('2nd') || pLower === '3' || pLower.includes('3rd') || pLower === 'winner') {
          isTopPlace = true;
        }
      }
      
      const isPremium = app.locals.isPremiumAward(award);
      
      if (premiumOnly && topPlacementsOnly) {
        return isPremium && isTopPlace;
      } else if (premiumOnly) {
        return isPremium;
      } else if (topPlacementsOnly) {
        return isTopPlace;
      }
      return true;
    });
  }

  // Final limit after filtering
  awards = awards.slice(0, 20);

  res.render('widget', { 
    studio, 
    awards, 
    theme, 
    primaryColor, 
    bg, 
    layout,
    widgetStats,
    showTotalAwards,
    showTopPlacements,
    showPastYear,
    widgetType
  });
});

app.get('/my-studio', requireAuth, async (req, res) => {
  const db = await openDb();
  const ownedStudio = await db.get('SELECT id FROM studios WHERE owner_id = ? LIMIT 1', [req.session.user.id]);
  if (ownedStudio) {
    res.redirect(`/manage/studio/${ownedStudio.id}`);
  } else {
    res.send(`<script>alert("You haven't claimed a studio yet! Please search for your studio in the directory and click 'Claim this Studio' to gain management access."); window.location.href="/studios";</script>`);
  }
});
app.get('/my-dancer', requireAuth, async (req, res) => {
  const db = await openDb();
  const ownedDancer = await db.get('SELECT id FROM dancers WHERE claimed_by_user_id = ? LIMIT 1', [req.session.user.id]);
  if (ownedDancer) {
    res.redirect(`/manage/dancer/${ownedDancer.id}`);
  } else {
    res.send(`<script>alert("You haven't claimed a dancer profile yet!"); window.location.href="/";</script>`);
  }
});

app.get('/manage/dancer/:id', requireAuth, async (req, res) => {
  const db = await openDb();
  const dancer = await db.get('SELECT * FROM dancers WHERE id = ?', [req.params.id]);
  
  if (!dancer) return res.status(404).send('Dancer not found');
  if (dancer.claimed_by_user_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin') {
    return res.status(403).send('Forbidden: Not the owner');
  }

  const studios = await db.all(`
    SELECT s.name, s.unique_id, ds.status, ds.id as link_id
    FROM dancer_studios ds
    JOIN studios s ON ds.studio_id = s.id
    WHERE ds.dancer_id = ?
  `, [dancer.id]);

  const awards = await db.all(`
    SELECT a.*, e.name as event_name, e.year, s.name as studio_name, o.name as org_name
    FROM awards a
    JOIN award_dancers ad ON a.id = ad.award_id
    JOIN events e ON a.event_id = e.id
    LEFT JOIN studios s ON a.studio_id = s.id
    LEFT JOIN organizations o ON e.org_id = o.id
    WHERE ad.dancer_id = ?
    ORDER BY e.year DESC
  `, [dancer.id]);

  res.render('manage_dancer', { dancer, studios, awards });
});

app.post('/manage/dancer/:id/update', requireAuth, async (req, res) => {
  const db = await openDb();
  const dancer = await db.get('SELECT claimed_by_user_id FROM dancers WHERE id = ?', [req.params.id]);
  
  if (!dancer || (dancer.claimed_by_user_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) {
    return res.status(403).send('Forbidden');
  }

  const { name, birthday, headshot_url, graduation_year } = req.body;
  await db.run(`
    UPDATE dancers 
    SET name = ?, birthday = ?, headshot_url = ?, graduation_year = ? 
    WHERE id = ?
  `, [name, birthday || null, headshot_url || null, graduation_year || null, req.params.id]);
  
  res.redirect(`/manage/dancer/${req.params.id}`);
});

app.post('/manage/dancer/:id/join-studio', requireAuth, async (req, res) => {
  const db = await openDb();
  const dancer = await db.get('SELECT claimed_by_user_id FROM dancers WHERE id = ?', [req.params.id]);
  
  if (!dancer || (dancer.claimed_by_user_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) {
    return res.status(403).send('Forbidden');
  }

  const { studio_unique_id } = req.body;
  const studio = await db.get('SELECT id FROM studios WHERE unique_id = ?', [studio_unique_id.trim()]);
  
  if (!studio) {
    return res.send(`<script>alert("Studio not found with that Unique ID."); window.location.href="/manage/dancer/${req.params.id}";</script>`);
  }

  try {
    await db.run('INSERT INTO dancer_studios (dancer_id, studio_id, status) VALUES (?, ?, ?)', [req.params.id, studio.id, 'pending']);
    res.send(`<script>alert("Request sent successfully! The studio director must approve it."); window.location.href="/manage/dancer/${req.params.id}";</script>`);
  } catch (err) {
    // Unique constraint violation
    res.send(`<script>alert("You are already linked or have a pending request for this studio."); window.location.href="/manage/dancer/${req.params.id}";</script>`);
  }
});

// API: Search Missing Awards
app.get('/api/dancer/:id/search-missing-awards', requireAuth, async (req, res) => {
  const db = await openDb();
  
  // Verify ownership
  const dancer = await db.get('SELECT claimed_by_user_id FROM dancers WHERE id = ?', [req.params.id]);
  if (!dancer || (dancer.claimed_by_user_id !== req.session.user.id && req.session.user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  let { q, studio } = req.query;
  if (!q || q.trim().length < 2) {
    return res.json([]);
  }
  
  q = q.trim();
  const nameQuery = `%${q}%`;
  
  try {
    let sql = `
      SELECT 
        a.id, a.performance_name, a.category, a.place, a.award_type,
        e.name as event_name, e.year, o.name as org_name,
        s.name as studio_name, d.name as dancer_name_on_award
      FROM awards a
      JOIN events e ON a.event_id = e.id
      LEFT JOIN organizations o ON e.org_id = o.id
      LEFT JOIN studios s ON a.studio_id = s.id
      JOIN award_dancers ad ON a.id = ad.award_id
      JOIN dancers d ON ad.dancer_id = d.id
      WHERE d.name LIKE ? COLLATE NOCASE
      AND a.id NOT IN (
        SELECT award_id FROM award_dancers WHERE dancer_id = ?
      )
    `;
    const params = [nameQuery, req.params.id];

    if (studio && studio.trim().length > 0) {
      sql += ` AND s.name LIKE ? COLLATE NOCASE`;
      params.push(`${studio.trim()}%`);
    }

    sql += ` ORDER BY e.year DESC, e.name ASC LIMIT 50`;

    const results = await db.all(sql, params);
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
});

// API: Claim Missing Award (Smart Auto-Backfill)
app.post('/manage/dancer/:id/claim-missing-award', requireAuth, async (req, res) => {
  const db = await openDb();
  
  // Verify ownership
  const dancer = await db.get('SELECT claimed_by_user_id FROM dancers WHERE id = ?', [req.params.id]);
  if (!dancer || (dancer.claimed_by_user_id !== req.session.user.id && req.session.user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { award_id } = req.body;
  if (!award_id) return res.status(400).json({ error: 'Missing award ID' });
  
  try {
    // Check if already linked
    const existing = await db.get('SELECT id FROM award_dancers WHERE dancer_id = ? AND award_id = ?', [req.params.id, award_id]);
    if (existing) {
      return res.status(400).json({ error: 'Already claimed this award.' });
    }

    // Insert pending claim for the main award
    await db.run("INSERT INTO award_dancers (award_id, dancer_id, status) VALUES (?, ?, 'pending')", [award_id, req.params.id]);
    
    // Smart Auto-Backfill
    const targetAward = await db.get('SELECT event_id, performance_name, studio_id FROM awards WHERE id = ?', [award_id]);
    let backfilledCount = 0;
    
    if (targetAward && targetAward.performance_name && targetAward.event_id) {
      // Find other awards for the same routine at the same event
      const relatedAwards = await db.all(
        'SELECT id FROM awards WHERE event_id = ? AND performance_name = ? AND id != ?',
        [targetAward.event_id, targetAward.performance_name, award_id]
      );
      
      for (let rel of relatedAwards) {
        const exist = await db.get('SELECT id FROM award_dancers WHERE dancer_id = ? AND award_id = ?', [req.params.id, rel.id]);
        if (!exist) {
          await db.run("INSERT INTO award_dancers (award_id, dancer_id, status) VALUES (?, ?, 'pending')", [rel.id, req.params.id]);
          backfilledCount++;
        }
      }
    }
    
    res.json({ success: true, backfilledCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
});

app.get('/faq/admin', (req, res) => {
  res.render('faq_admin');
});

app.get('/faq/dancer', (req, res) => {
  res.render('faq_dancer');
});

app.get('/faq/organizer', (req, res) => {
  res.render('faq_organizer', { user: req.session.user });
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
    LIMIT 100
  `);

  const topStudiosThisYear = await db.all(`
    SELECT s.id, s.name, COUNT(a.id) as total_awards
    FROM studios s
    LEFT JOIN awards a ON s.id = a.studio_id
    LEFT JOIN events e ON a.event_id = e.id
    WHERE e.year = (SELECT MAX(year) FROM events) AND s.id NOT IN (${excludeIds.join(',')})
    GROUP BY s.id
    ORDER BY total_awards DESC
    LIMIT 100
  `);

  const topStudiosFirstPlaceThisYear = await db.all(`
    SELECT s.id, s.name, COUNT(a.id) as total_awards
    FROM studios s
    LEFT JOIN awards a ON s.id = a.studio_id
    LEFT JOIN events e ON a.event_id = e.id
    WHERE a.is_first_place = 1 
      AND e.year = (SELECT MAX(year) FROM events)
      AND s.id NOT IN (${excludeIds.join(',')})
    GROUP BY s.id
    ORDER BY total_awards DESC
    LIMIT 100
  `);

  const orgs = await db.all(`
    SELECT o.id, o.name, o.slug, COUNT(e.id) as event_count
    FROM organizations o
    LEFT JOIN events e ON o.id = e.org_id AND e.year >= 2022
    GROUP BY o.id
    ORDER BY o.name
  `);
  
  const isAdmin = req.session && req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'superadmin');
  
  if (isAdmin) {
    res.render('index_admin', { featuredStudios, topStudios: topStudios.slice(0, 12), orgs });
  } else {
    res.render('index', { featuredStudios, topStudios, topStudiosThisYear, topStudiosFirstPlaceThisYear, orgs });
  }
});

app.get('/org/:slug', async (req, res) => {
  if (!req.session || !req.session.user || (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin')) {
    return res.status(403).send('Detailed event data is only available to platform administrators.');
  }
  
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
  const q = req.query.q || '';

  let whereClause = '';
  let queryParams = [];

  if (q) {
    whereClause = 'WHERE s.name LIKE ?';
    queryParams.push(`%${q}%`);
  }

  const countRow = await db.get(`SELECT COUNT(*) as count FROM studios s ${whereClause}`, queryParams);
  const totalStudios = countRow.count;
  const totalPages = Math.ceil(totalStudios / limit);

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
  `, [...queryParams, limit, offset]);

  res.render('studios', { studios, currentPage: page, totalPages, q });
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

app.post('/admin/impersonate/generate', requireSuperadmin, async (req, res) => {
  const { user_id, target_url } = req.body;
  if (!user_id || !target_url) return res.status(400).json({ error: 'Missing parameters' });

  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');

  const db = await openDb();
  await db.run('INSERT INTO impersonation_tokens (token, target_user_id, target_url) VALUES (?, ?, ?)', [token, user_id, target_url]);

  // Return the one-time login link
  const link = `${req.protocol}://${req.get('host')}/login/impersonate/${token}`;
  res.json({ success: true, link });
});

app.get('/login/impersonate/:token', async (req, res) => {
  const db = await openDb();
  const record = await db.get('SELECT * FROM impersonation_tokens WHERE token = ?', [req.params.token]);

  if (!record) {
    return res.status(400).send('Invalid or expired impersonation link.');
  }

  // Delete the token so it can only be used once
  await db.run('DELETE FROM impersonation_tokens WHERE token = ?', [req.params.token]);

  // Check expiration (e.g., 1 hour)
  const created = new Date(record.created_at).getTime();
  if (Date.now() - created > 60 * 60 * 1000) {
    return res.status(400).send('This impersonation link has expired.');
  }

  const user = await db.get('SELECT * FROM users WHERE id = ?', [record.target_user_id]);
  if (!user) return res.status(404).send('User not found.');

  req.session.user = user;
  res.redirect(record.target_url);
});

app.get('/admin/accounts', requireSuperadmin, async (req, res) => {
  const db = await openDb();

  const orgs = await db.all(`
    SELECT o.id, o.name, o.owner_id, u.email as owner_email, COUNT(e.id) as event_count
    FROM organizations o
    JOIN users u ON o.owner_id = u.id
    LEFT JOIN events e ON o.id = e.org_id
    GROUP BY o.id
  `);

  const studios = await db.all(`
    SELECT s.id, s.name, s.owner_id, u.email as owner_email, COUNT(a.id) as award_count
    FROM studios s
    JOIN users u ON s.owner_id = u.id
    LEFT JOIN awards a ON s.id = a.studio_id
    GROUP BY s.id
  `);

  res.render('admin_accounts', { orgs, studios, user: req.session.user });
});

app.get('/admin', requireAdmin, async (req, res) => {
  const db = await openDb();

  // Parallelize the stats queries for performance
  const [
    totalOrgs, totalEvents, totalStudios, totalDancers, totalAwards,
    claimedStudios, claimedDancers, pendingClaims,
    studiosWithManyAwards, studiosWithEmail, marketingStudiosCount
  ] = await Promise.all([
    db.get(`SELECT COUNT(*) as count FROM organizations`),
    db.get(`SELECT COUNT(*) as count FROM events`),
    db.get(`SELECT COUNT(*) as count FROM studios`),
    db.get(`SELECT COUNT(*) as count FROM dancers`),
    db.get(`SELECT COUNT(*) as count FROM awards`),
    db.get(`SELECT COUNT(*) as count FROM studios WHERE is_claimed = 1`),
    db.get(`SELECT COUNT(DISTINCT dancer_id) as count FROM award_dancers WHERE status IN ('pending', 'approved')`),
    db.get(`SELECT COUNT(*) as count FROM studio_claims WHERE status = 'pending'`),
    db.get(`SELECT COUNT(*) as count FROM (SELECT studio_id FROM awards GROUP BY studio_id HAVING COUNT(*) > 15)`),
    db.get(`SELECT COUNT(*) as count FROM studios WHERE email IS NOT NULL AND email != ''`),
    db.get(`SELECT COUNT(*) as count FROM (SELECT s.id FROM studios s JOIN awards a ON s.id = a.studio_id WHERE s.email IS NOT NULL AND s.email != '' GROUP BY s.id HAVING COUNT(a.id) > 15)`)
  ]);

  const stats = {
    orgs: totalOrgs.count,
    events: totalEvents.count,
    studios: totalStudios.count,
    dancers: totalDancers.count,
    awards: totalAwards.count,
    claimedStudios: claimedStudios.count,
    claimedDancers: claimedDancers.count,
    pendingClaims: pendingClaims.count,
    studiosWithManyAwards: studiosWithManyAwards ? studiosWithManyAwards.count : 0,
    studiosWithEmail: studiosWithEmail ? studiosWithEmail.count : 0,
    marketingStudiosCount: marketingStudiosCount ? marketingStudiosCount.count : 0
  };

  const flaggedStudios = await db.all(`SELECT id, name FROM studios WHERE needs_investigation = 1 ORDER BY name`);
  const flaggedDancers = await db.all(`SELECT id, name, unique_id FROM dancers WHERE needs_investigation = 1 ORDER BY name`);
  const allStudios = await db.all(`SELECT id, name FROM studios ORDER BY name`);

  res.render('admin', { flaggedStudios, flaggedDancers, allStudios, stats });
});

// Admin: Marketing Studios
app.get('/admin/marketing/studios', requireAdmin, async (req, res) => {
  const db = await openDb();
  const studios = await db.all(`
    SELECT s.id, s.name, s.email, COUNT(a.id) as award_count
    FROM studios s
    JOIN awards a ON s.id = a.studio_id
    WHERE s.email IS NOT NULL AND s.email != ''
    GROUP BY s.id
    HAVING award_count > 15
    ORDER BY award_count DESC
  `);
  res.render('admin_marketing_studios', { studios });
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

  const dancerClaims = await db.all(`
    SELECT dc.*, u.email as user_email, d.name as dancer_name, d.unique_id as dancer_unique_id 
    FROM dancer_claims dc
    JOIN users u ON dc.user_id = u.id
    JOIN dancers d ON dc.dancer_id = d.id
    WHERE dc.status = 'pending'
    ORDER BY dc.created_at DESC
  `);

  res.render('admin_claims', { claims, dancerClaims });
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

// Dancer Claims logic
app.post('/admin/claims/dancer/:id/approve', requireAdmin, async (req, res) => {
  const db = await openDb();
  const claim = await db.get('SELECT * FROM dancer_claims WHERE id = ?', [req.params.id]);
  if (!claim) return res.status(404).send('Claim not found');

  await db.run('UPDATE dancers SET is_claimed = 1, claimed_by_user_id = ? WHERE id = ?', [claim.user_id, claim.dancer_id]);
  await db.run('UPDATE dancer_claims SET status = "approved" WHERE id = ?', [claim.id]);

  const user = await db.get('SELECT role FROM users WHERE id = ?', [claim.user_id]);
  if (user && user.role === 'user') {
    await db.run('UPDATE users SET role = "dancer_owner" WHERE id = ?', [claim.user_id]);
  }

  res.redirect('/admin/claims');
});

app.post('/admin/claims/dancer/:id/reject', requireAdmin, async (req, res) => {
  const db = await openDb();
  await db.run('UPDATE dancer_claims SET status = "rejected" WHERE id = ?', [req.params.id]);
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

app.post('/admin/users/add', requireSuperadmin, async (req, res) => {
  const { email, password, role, is_verified } = req.body;
  const db = await openDb();

  if (!email || !password || !role) {
    return res.status(400).send('Email, password, and role are required');
  }

  const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    return res.status(400).send('User with this email already exists');
  }

  const hash = await bcrypt.hash(password, 10);
  const isVerifiedInt = is_verified === 'on' ? 1 : 0;

  await db.run(
    'INSERT INTO users (email, password_hash, role, is_verified) VALUES (?, ?, ?, ?)',
    [email, hash, role, isVerifiedInt]
  );

  res.redirect('/admin/users');
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

app.get('/admin/duplicates', requireSuperadmin, async (req, res) => {
  const db = await openDb();
  const studios = await db.all("SELECT id, name FROM studios WHERE status = 'active' ORDER BY LOWER(name)");

  const groupedDuplicates = [];
  let currentGroup = null;

  for (let i = 0; i < studios.length - 1; i++) {
    const s1 = studios[i];
    const s2 = studios[i + 1];
    const n1 = s1.name.toLowerCase();
    const n2 = s2.name.toLowerCase();

    if (n2.startsWith(n1) && n1.length > 5) {
      if (!currentGroup) {
        currentGroup = { base: s1, matches: [s2] };
      } else {
        if (n2.startsWith(currentGroup.base.name.toLowerCase())) {
          currentGroup.matches.push(s2);
        } else {
          groupedDuplicates.push(currentGroup);
          currentGroup = { base: s1, matches: [s2] };
        }
      }
    } else {
      if (currentGroup) {
        groupedDuplicates.push(currentGroup);
        currentGroup = null;
      }
    }
  }
  if (currentGroup) groupedDuplicates.push(currentGroup);

  res.render('admin_duplicates', {
    totalStudios: studios.length,
    duplicateGroupsCount: groupedDuplicates.length,
    groupedDuplicates
  });
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

// GET studio first places
app.get('/studio/:id/first-places', async (req, res) => {
  const db = await openDb();
  
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');

  const awards = await db.all(`
    SELECT a.*, e.name as event_name, e.year as event_year, o.name as org_name
    FROM awards a
    JOIN events e ON a.event_id = e.id
    JOIN organizations o ON e.org_id = o.id
    WHERE a.studio_id = ? AND a.is_first_place = 1
    ORDER BY e.year DESC, e.name ASC
  `, [req.params.id]);

  res.render('studio_first_places', {
    studio,
    awards,
    user: req.session ? req.session.user : null
  });
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
    SELECT a.*, d.name as dancer_name, d.unique_id, e.name as event_name, e.year as event_year, e.date_string, o.name as org_name, o.logo_url, o.custom_icons
    FROM awards a
    LEFT JOIN dancers d ON a.dancer_id = d.id
    LEFT JOIN events e ON a.event_id = e.id
    LEFT JOIN organizations o ON e.org_id = o.id
    WHERE a.studio_id = ?
    ORDER BY e.year DESC, e.date_string DESC, a.award_type, a.place
  `, [req.params.id]);

  awards.forEach(a => {
    if (a.custom_icons) {
      try { a.customIconsObj = JSON.parse(a.custom_icons); } catch(e) {}
    }
  });

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

  const currentYear = new Date().getFullYear();
  let awardsThisYear = 0;
  let awardsPast5Years = 0;
  const eventsThisYear = new Set();
  const eventsPast5Years = new Set();
  let firstPlaceCount = 0;
  let firstPlaceCountThisYear = 0;
  let scholarshipCount = 0;
  const uniqueDancers = new Set();
  const hallOfFame = [];

  for (const award of awards) {
    if (awardDancersMap[award.id]) {
      award.dancers = awardDancersMap[award.id];
    } else if (award.dancer_name) {
      award.dancers = [{ name: award.dancer_name, unique_id: award.unique_id }];
    } else {
      award.dancers = [];
    }

    award.dancers.forEach(d => {
      if (d.unique_id) uniqueDancers.add(d.unique_id);
      else if (d.name) uniqueDancers.add(d.name.toLowerCase().trim());
    });

    totalAwards++;
    const year = award.event_year;
    const eventKey = `${award.org_name} - ${award.event_name} (${award.date_string})`;
    eventsAttended.add(eventKey);

    const yearNum = parseInt(year, 10);
    if (!isNaN(yearNum)) {
      if (yearNum === currentYear) {
        awardsThisYear++;
        eventsThisYear.add(eventKey);
      }
      if (yearNum >= currentYear - 4) {
        awardsPast5Years++;
        eventsPast5Years.add(eventKey);
      }
    }

    if (award.is_first_place) {
      firstPlaceCount++;
      if (yearNum === currentYear) {
        firstPlaceCountThisYear++;
      }
    }

    const premiumDetails = app.locals.getPremiumDetails(award);
    if (premiumDetails.icon === '🎓' || premiumDetails.icon === '💌') {
      scholarshipCount++;
    }

    // Hall of Fame logic: Premium award + '1st' place + National/Finals indicator
    if (award.is_first_place && premiumDetails.isPremium) {
      const nameLower = (award.award_type || award.category || '').toLowerCase();
      const eventNameLower = (award.event_name || '').toLowerCase();
      if (nameLower.includes('national') || nameLower.includes('final') || nameLower.includes('grand') || nameLower.includes('title') || eventNameLower.includes('national') || eventNameLower.includes('final')) {
        hallOfFame.push(award);
      }
    }

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
  const groupedData = Array.from(yearsMap, ([year, eventsMap], idx) => {
    return {
      year,
      events: idx === 0 ? Array.from(eventsMap.values()) : [],
      isLoaded: idx === 0
    };
  });

  const yearsActive = Array.from(yearsMap.keys()).sort().reverse();
  const activeYearsStr = yearsActive.length > 0 ?
    (yearsActive.length === 1 ? `${yearsActive[0]}` : `${yearsActive[yearsActive.length - 1]} - ${yearsActive[0]}`)
    : 'None';

  const quickStats = {
    totalAwards,
    totalEvents: eventsAttended.size,
    activeYearsStr,
    sinceYear: yearsActive.length > 0 ? yearsActive[yearsActive.length - 1] : null,
    awardsThisYear,
    eventsThisYear: eventsThisYear.size,
    awardsPast5Years,
    eventsPast5Years: eventsPast5Years.size,
    firstPlaceCount,
    firstPlaceCountThisYear,
    scholarshipCount,
    uniqueDancersCount: uniqueDancers.size
  };

  let prefs = {};
  if (studio.public_preferences) {
    try { prefs = JSON.parse(studio.public_preferences); } catch (e) { }
  }
  if (Object.keys(prefs).length === 0) {
    prefs = { show_total_awards: true, show_events_attended: true, show_1st_place_finishes: true, show_1st_place_this_year: true, show_past_5_years: true, show_this_year: true };
  }
  studio.prefs = prefs;

  // Fetch Alumni (graduated this year or earlier)
  const alumni = await db.all(`
    SELECT d.id, d.name, d.unique_id, ds.graduation_year, ds.headshot_url, ds.notes
    FROM dancer_studios ds
    JOIN dancers d ON ds.dancer_id = d.id
    WHERE ds.studio_id = ? AND ds.graduation_year <= ?
    ORDER BY ds.graduation_year DESC, d.name ASC
  `, [req.params.id, currentYear]);

  // Keep max 12 items for Hall of Fame
  const topHallOfFame = hallOfFame.slice(0, 12);

  res.render('studio', { studio, mergedIntoStudio, groupedData, quickStats, hallOfFame: topHallOfFame, alumni, hasAwards: awards.length > 0 });
});

app.get('/api/studio/:id/year/:year', async (req, res) => {
  const db = await openDb();
  
  const awards = await db.all(`
    SELECT a.*, d.name as dancer_name, d.unique_id, e.name as event_name, e.year as event_year, e.date_string, o.name as org_name, o.logo_url, o.custom_icons
    FROM awards a
    LEFT JOIN dancers d ON a.dancer_id = d.id
    LEFT JOIN events e ON a.event_id = e.id
    LEFT JOIN organizations o ON e.org_id = o.id
    WHERE a.studio_id = ? AND e.year = ?
    ORDER BY e.date_string DESC, a.award_type, a.place
  `, [req.params.id, req.params.year]);

  awards.forEach(a => {
    if (a.custom_icons) {
      try { a.customIconsObj = JSON.parse(a.custom_icons); } catch(e) {}
    }
  });

  const awardDancers = await db.all(`
    SELECT ad.award_id, d.name, d.unique_id, ad.status
    FROM award_dancers ad
    JOIN dancers d ON ad.dancer_id = d.id
    WHERE ad.award_id IN (SELECT id FROM awards WHERE studio_id = ? AND event_id IN (SELECT id FROM events WHERE year = ?))
  `, [req.params.id, req.params.year]);

  const awardDancersMap = {};
  for (const ad of awardDancers) {
    if (!awardDancersMap[ad.award_id]) awardDancersMap[ad.award_id] = [];
    awardDancersMap[ad.award_id].push({ name: ad.name, unique_id: ad.unique_id, status: ad.status });
  }

  const eventsMap = new Map();
  for (const award of awards) {
    if (awardDancersMap[award.id]) {
      award.dancers = awardDancersMap[award.id];
    } else if (award.dancer_name) {
      award.dancers = [{ name: award.dancer_name, unique_id: award.unique_id }];
    } else {
      award.dancers = [];
    }

    const eventKey = `${award.org_name} - ${award.event_name} (${award.date_string})`;
    if (!eventsMap.has(eventKey)) {
      eventsMap.set(eventKey, {
        title: eventKey,
        eventId: award.event_id,
        awards: []
      });
    }
    eventsMap.get(eventKey).awards.push(award);
  }

  const events = Array.from(eventsMap.values());
  res.render('partials/studio_year_events', { events });
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
    SELECT DISTINCT a.*, e.name as event_name, e.year as event_year, o.logo_url, o.custom_icons,
      (SELECT COUNT(*) FROM award_dancers ad2 WHERE ad2.award_id = a.id) as dancer_count
    FROM awards a
    LEFT JOIN events e ON a.event_id = e.id
    LEFT JOIN organizations o ON e.org_id = o.id
    LEFT JOIN award_dancers ad ON a.id = ad.award_id
    WHERE a.dancer_id = ? OR ad.dancer_id = ?
    ORDER BY a.award_type, a.place
  `, [dancer.id, dancer.id]);

  awards.forEach(a => {
    if (a.custom_icons) {
      try { a.customIconsObj = JSON.parse(a.custom_icons); } catch(e) {}
    }
  });

  const specialClassTypes = ['scholarship', 'special', 'studio', 'invitation'];
  const isSpecialKeyword = (str) => {
    if (!str) return false;
    const lower = str.toLowerCase();
    return lower.includes('scholarship') || lower.includes('invite') || lower.includes('invitation');
  };
  
  const conventionAwards = awards.filter(a => 
    specialClassTypes.includes(a.award_class) || 
    isSpecialKeyword(a.award_type) || 
    isSpecialKeyword(a.category) || 
    isSpecialKeyword(a.performance_name) ||
    (!a.performance_name && a.dancer_count > 1)
  );
  const performanceAwards = awards.filter(a => !conventionAwards.includes(a));

  const soloAwards = performanceAwards.filter(a => a.dancer_count <= 1 && (!a.category || !a.category.toLowerCase().includes('group')));
  const groupAwards = performanceAwards.filter(a => a.dancer_count > 1 || (a.category && a.category.toLowerCase().includes('group')));

  res.render('dancer', { dancer, soloAwards, groupAwards, conventionAwards });
});

app.get('/event/:id', async (req, res) => {
  if (!req.session || !req.session.user || (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin')) {
    return res.status(403).send('Detailed event data is only available to platform administrators.');
  }

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

const claimAwardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many claims submitted from this IP, please try again after 15 minutes' }
});

app.post('/api/claim-award', claimAwardLimiter, async (req, res) => {
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

const PORT = process.env.PORT || 3008;
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

// Setup automated nightly backups at 3:00 AM
cron.schedule('0 3 * * *', () => {
  console.log('Running automated nightly backup of database.sqlite...');
  try {
    if (!fs.existsSync(path.join(__dirname, 'backups'))) {
      fs.mkdirSync(path.join(__dirname, 'backups'));
    }
    const dateStr = new Date().toISOString().split('T')[0];
    const backupPath = path.join(__dirname, 'backups', `database_${dateStr}.sqlite`);
    fs.copyFileSync(path.join(__dirname, 'database.sqlite'), backupPath);
    console.log(`Backup successfully created at ${backupPath}`);
    
    // Cleanup old backups (keep last 7)
    const files = fs.readdirSync(path.join(__dirname, 'backups'))
      .filter(f => f.startsWith('database_') && f.endsWith('.sqlite'))
      .sort()
      .reverse();
    
    if (files.length > 7) {
      const toDelete = files.slice(7);
      toDelete.forEach(file => {
        fs.unlinkSync(path.join(__dirname, 'backups', file));
        console.log(`Deleted old backup: ${file}`);
      });
    }
  } catch (err) {
    console.error('Failed to run nightly backup:', err);
  }
});

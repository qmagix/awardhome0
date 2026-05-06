require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { openDb } = require('./database');
const path = require('path');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true })); // Added for form parsing
app.use(session({
  secret: 'dance-awards-secret-key-123', // In production, use env variable
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using https
}));

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
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  
  if (!studio) return res.status(404).send('Studio not found');
  if (studio.owner_id !== req.session.user.id) return res.status(403).send('Forbidden: Not the owner');
  
  res.render('manage_studio', { studio });
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
      const crypto = require('crypto');
      const uuid = crypto.randomBytes(16).toString('hex');
      const slug = dancer_name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const unique_id = `${uuid}-${slug}`;
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

  res.render('org', { org, events });
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
    await db.run(`UPDATE awards SET studio_id = ? WHERE studio_id = ?`, [targetId, sourceId]);
    const links = await db.all(`SELECT dancer_id FROM dancer_studios WHERE studio_id = ?`, [sourceId]);
    for (const link of links) {
      const exists = await db.get(`SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [link.dancer_id, targetId]);
      if (!exists) {
         await db.run(`UPDATE dancer_studios SET studio_id = ? WHERE dancer_id = ? AND studio_id = ?`, [targetId, link.dancer_id, sourceId]);
      } else {
         await db.run(`DELETE FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [link.dancer_id, sourceId]);
      }
    }
    await db.run(`DELETE FROM studios WHERE id = ?`, [sourceId]);
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

  const awards = await db.all(`
    SELECT a.*, d.name as dancer_name, d.unique_id, e.name as event_name, e.year as event_year, e.date_string, o.name as org_name 
    FROM awards a
    LEFT JOIN dancers d ON a.dancer_id = d.id
    LEFT JOIN events e ON a.event_id = e.id
    LEFT JOIN organizations o ON e.org_id = o.id
    WHERE a.studio_id = ?
    ORDER BY e.year DESC, e.date_string DESC, a.award_type, a.place
  `, [req.params.id]);

  // Group by Year -> Event
  const yearsMap = new Map();
  let totalAwards = 0;
  const eventsAttended = new Set();
  
  for (const award of awards) {
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

  res.render('studio', { studio, groupedData, quickStats });
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
    SELECT a.*, e.name as event_name, e.year as event_year 
    FROM awards a
    LEFT JOIN events e ON a.event_id = e.id
    WHERE a.dancer_id = ?
    ORDER BY a.award_type, a.place
  `, [dancer.id]);

  res.render('dancer', { dancer, awards });
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
  
  // Find all awards for this event that have a performance number but NO dancer
  const missingDancers = await db.all(`
    SELECT id, performance_number, studio_id 
    FROM awards 
    WHERE event_id = ? AND dancer_id IS NULL AND performance_number IS NOT NULL AND performance_number != ''
  `, [eventId]);
  
  let backfilledCount = 0;

  for (const award of missingDancers) {
    // Look for another award in the SAME event, SAME studio, SAME performance_number WITH a dancer
    const match = await db.get(`
      SELECT dancer_id 
      FROM awards 
      WHERE event_id = ? AND studio_id = ? AND performance_number = ? AND dancer_id IS NOT NULL
      LIMIT 1
    `, [eventId, award.studio_id, award.performance_number]);

    if (match) {
      await db.run(`
        UPDATE awards SET dancer_id = ? WHERE id = ?
      `, [match.dancer_id, award.id]);
      backfilledCount++;
    }
  }

  res.send(`<script>alert("Successfully backfilled ${backfilledCount} dancer records for this event."); window.location.href='/event/${eventId}';</script>`);
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

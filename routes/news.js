// AwardHome News: founder-authored announcements + (later) community stories.
// V1 architecture (2026-08-27): articles are EJS partials in views/news/ with
// a registry below — publishing = add partial + registry entry + deploy, so
// content is git-versioned and local/prod parity is automatic. Migrate to a
// news_posts table only when outside contributors/sponsored posts become real
// (phase 2, see ideas.md — sponsored posts need FTC "Sponsored" labeling).
// Deliberately OUTSIDE the beta gate: the launch announcement must be
// shareable to the public before launch day.
const express = require('express');
const router = express.Router();

// Newest first. slug = views/news/<slug>.ejs
const ARTICLES = [
  {
    slug: 'awardhome-launches-september-15',
    title: 'AwardHome opens to the public on September 15',
    date: '2026-08-15',
    summary: 'The digital trophy case for competitive dance — 1.5 million awards, 27 competitions, one home — opens to everyone on September 15.',
  },
  {
    slug: 'why-awardhome-exists',
    title: 'Why AwardHome exists',
    date: '2026-05-20',
    summary: "Years before a line of code, there was a studio, a box of trophies, and a domain name bought on a promise. Sam's founding story.",
  },
];

router.get('/news', (req, res) => {
  res.render('news_index', { articles: ARTICLES, user: req.session.user || null });
});

router.get('/news/:slug', (req, res) => {
  const article = ARTICLES.find(a => a.slug === req.params.slug);
  if (!article) return res.status(404).send('Article not found');
  res.render('news_article', { article, articles: ARTICLES, user: req.session.user || null });
});

module.exports = router;

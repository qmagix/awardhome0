const crypto = require('crypto');

function generateDancerId(name) {
  const hex = crypto.randomBytes(4).toString('hex'); // 8 characters
  const slug = name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : 'unknown';
  return `DNC-${hex}-${slug}`;
}

function generateStudioId(name) {
  const hex = crypto.randomBytes(4).toString('hex');
  const slug = name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : 'unknown';
  return `STU-${hex}-${slug}`;
}

module.exports = { generateDancerId, generateStudioId };

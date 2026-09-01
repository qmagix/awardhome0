require('dotenv').config();

const PORT = process.env.PORT || 3008;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// The private-beta gate is a PRODUCTION concern: it keeps the public data
// surfaces from being browsable before launch. In development it only gets in
// the way of the person building them — and worse, it makes a local server
// behave unlike the developer's mental model, which is how a mobile client
// pointed at production gets mistaken for a server misconfiguration.
//
// So: on in production whenever BETA_MODE=true, and in development only when
// explicitly asked for with BETA_MODE_DEV=true (for testing the gate itself).
// A .env carried over from a prod-shaped config no longer gates localhost.
const BETA_REQUESTED = process.env.BETA_MODE === 'true';
const IS_PROD = process.env.NODE_ENV === 'production';
const BETA_MODE = BETA_REQUESTED && (IS_PROD || process.env.BETA_MODE_DEV === 'true');
const BETA_KEY = process.env.BETA_ACCESS_KEY || null;

module.exports = { PORT, BASE_URL, BETA_MODE, BETA_KEY };

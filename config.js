require('dotenv').config();

const PORT = process.env.PORT || 3008;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const BETA_MODE = process.env.BETA_MODE === 'true';
const BETA_KEY = process.env.BETA_ACCESS_KEY || null;

module.exports = { PORT, BASE_URL, BETA_MODE, BETA_KEY };

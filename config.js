require('dotenv').config();

const PORT = process.env.PORT || 3008;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

module.exports = { PORT, BASE_URL };

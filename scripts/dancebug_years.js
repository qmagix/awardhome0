// DanceBug's events_list.php uses internal d_year ids, not calendar years.
// Shared by batch_import.js (fetching) and weekly_update.js (cache
// invalidation must target raw/<comp>/<d_year>/ where list pages live).
// Extend when a new season opens.
const YEARS_MAP = {
  2027: 2055,
  2026: 2054,
  2025: 2053,
  2024: 2052,
  2023: 2051,
  2022: 2050,
  2021: 2049,
  2020: 2048,
  2019: 2047,
  2018: 2021,
  2017: 2020,
  2016: 4
};

module.exports = { YEARS_MAP };

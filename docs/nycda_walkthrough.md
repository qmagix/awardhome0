# NYCDA Bulk PDF Extraction & Database Ingestion

This document details the entire end-to-end process of scraping, validating, formatting, and ingesting NYCDA competition and convention results from 2022-2026 into the platform's SQLite database.

## 1. Bulk PDF Categorization
- Filtered all PDFs to isolate modern layouts (2022-2026).
- Used `pdf2json` to reverse-engineer X/Y coordinate layouts to reconstruct the underlying table structure of both Competitions and Conventions.
- Converted 330 valid NYCDA PDFs into perfectly structured text files in `tobeprocessed/pdf/nycda/txt/`.

## 2. Database Ingestion (`import_nycda_txt.js`)
- **Backup Created**: Prior to running, a full snapshot of the database was saved to `database.sqlite.bak_nycda`.
- **Event Linkage**: NYCDA was successfully added to the `organizations` table. The import script parsed the filenames to dynamically assign each award to its respective City and Year event (e.g., `NYCDA - Atlanta (2025)`).
- **Idempotent Inserts**: 
  - *Competitions:* We verified idempotency by checking `event_id`, `category`, `performance_name`, `place`, and `studio_id`.
  - *Conventions:* As agreed, to prevent data duplication for identical convention scholarships, we dynamically generated unique award records mapped explicitly to individual dancers using the `award_dancers` junction table mapping.
- **Dependency Resolution**: For every row processed, the script verified if the `studio` and `dancer` already existed in the database. If they did not, it successfully initialized them on-the-fly and created the appropriate M:N pivot linkages in `dancer_studios`.

## 3. Results Summary
We successfully ingested a massive archive of NYCDA results into the core application:
- **Total Convention Awards Inserted:** 2,674
- **Total Competition Awards Inserted:** 33,698
- **Total NYCDA Awards Imported:** 36,372

All data is now active in the database and ready to be viewed in the UI dashboard!

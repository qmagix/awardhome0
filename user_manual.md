# Studio Admin Portal User Manual

Welcome to the Studio Admin Portal documentation. This manual provides instructions on how to use the various data importation scripts designed to pull competition results from the web into your local database.

Currently, the system is designed to support 8 major competitions. The importation scripts are split into two major architectures based on how the respective competitions publish their results.

## 1. The DanceBug Importer (5 Competitions)
Five of our supported competitions utilize DanceBug for their results hosting. We have built a unified, dynamic batch import script (`batch_import.js`) that handles all of these simultaneously.

**Supported Competitions:**
- Starpower Talent Competition (`starpower`)
- Revolution Talent Competition (`revolution`)
- Believe Talent Competition (`believe`)
- Imagine Dance Challenge (`imagine`)
- DreamMaker Dance Competition (`dreammaker`)

### How to use:
To run the importer for a specific competition, use the `batch_import.js` script followed by the competition's slug. You can optionally specify one or more years to run. If you don't specify any years, it will automatically attempt to scrape all historical data from 2026 back to 2016.

**Syntax:**
```bash
node batch_import.js <slug> [year1] [year2] ...
```

**Examples:**
```bash
# Scrape Imagine Dance Challenge for the years 2025 and 2024
node batch_import.js imagine 2025 2024

# Scrape DreamMaker for all available historical years
node batch_import.js dreammaker

# Scrape Revolution for 2026
node batch_import.js revolution 2026
```

## 2. Standalone Scrapers (KAR & Rainbow)
KAR and Rainbow host their own result platforms with unique structures, so they have dedicated scraping scripts.

### DanceKAR
KAR data is scraped using `scrape_kar_year.js` and `scrape_dancekar.js`. 
- To scrape a specific year, you can edit the bottom of `scrape_kar_year.js` to define your target year, then run:
  ```bash
  node scrape_kar_year.js
  ```

### Rainbow National Dance Competition
Rainbow data is similarly scraped using `scrape_rainbow_year.js`.
- To scrape a specific year, edit the target year at the bottom of the script, then run:
  ```bash
  node scrape_rainbow_year.js
  ```

### Mass Scraping (KAR & Rainbow)
If you want to pull down the entire historical archives for **both** KAR and Rainbow simultaneously (from 2024 back to 2016), you can run the master script:
```bash
node scrape_all_years.js
```

## 3. Youth America Grand Prix (YAGP)
YAGP results have a unique table structure (including complex Pas De Deux and Special Awards formats). Use the dedicated `scrape_yagp_year.js` script to parse individual event result pages.

**Test Mode (Dry Run)**
To safely extract and view the data as JSON without writing to the database, use the `--test` flag:
```bash
node scrape_yagp_year.js --test https://yagp.org/yagp-2025-tampa-fl-finals-winners/
```
*Note: This will output the results to the console (you can pipe it to a file like `> test.json` for review).*

**Live Database Import**
Once verified, run the script without the test flag to insert the awards, dancers, and studio linkages into the SQLite database. The script is highly idempotent and will skip duplicates safely.
```bash
node scrape_yagp_year.js https://yagp.org/yagp-2025-tampa-fl-finals-winners/
```

**Mass Scraping by Year**
To scrape an entire year's worth of YAGP results simultaneously, use the `scrape_all_yagp.js` master script. This script dynamically pulls all event URLs for a given year directly from YAGP's WordPress sitemap and processes them in bulk.
```bash
node scrape_all_yagp.js 2024
```

## 4. Studio Deduplication & Normalization
YAGP frequently appends geographic codes (e.g., `, CA`, `, China`) to studio names, causing the database to spawn duplicate entries for the same studio (e.g., `Studio X` and `Studio X, CA`). 

To resolve this without deleting or destroying cross-event data, run the `dedup_studios.js` script periodically after large ingestions.
```bash
node dedup_studios.js
```
This script will:
- Scan for studios containing a comma.
- Extract the base name and check if it already exists in the database.
- Seamlessly re-link all dancers to the base name.
- Store the longer, comma-appended name in the base studio's new `aka` field to preserve the alias.
- Delete the duplicate studio record.

---

## 5. Downloading Legacy PDFs
For older years (typically pre-2022), DanceBug competitions often published their results as static PDF files rather than HTML pages. These cannot be automatically parsed into the database. 

However, you can automatically bulk-download all of these legacy PDFs to your local machine for offline archiving using the `download_legacy_pdfs.js` script.

**How to run:**
```bash
- `node download_legacy_pdfs.js`

## Platform Documentation
To assist users in navigating the platform, two standalone FAQ pages are hosted on the application itself:
- **Studio Admin FAQ (`/faq/admin`)**: A comprehensive guide for Studio Directors on how to claim their studio, customize their public profile, embed the iframe widget, and manage their dancer roster securely using the Secret Join Code. It also details the "Pseudo-Studio" architecture for handling multi-studio collaborations (e.g. YAGP Pas De Deux).
- **Dancer FAQ (`/faq/dancer`)**: A guide for students/parents explaining how to claim awards using their Studio Secret Code, how to reuse their auto-generated Unique ID for faster claiming, what the verification badges mean, and the platform's privacy protections.
```
This script will loop through all 5 DanceBug competitions, scan their historical archives, and download any PDF results it finds into the `/tobeprocessed/pdf/<competition_slug>/` directory, along with a handy JSON metadata file for each PDF.

# Project-Specific AI Instructions

This file contains the core architecture, rules, and workflows for the **Dance Awards Platform**. Any AI agent operating within this repository MUST adhere to these rules.

## Core Stack & Architecture
- **Backend:** Node.js, Express
- **Database:** SQLite (using `sqlite` and `sqlite3` packages)
- **Frontend:** EJS (Embedded JavaScript templates), Vanilla CSS, Vanilla JS
- **Scraping/ETL:** Cheerio, Axios (Puppeteer for dynamic sites)

## Global User Rules
1. Be thoughtful, concise and clear.
2. Put all user input/request, except debugging requests, in a `user_prompts.md` file.
3. Put all user request and your response summary in an `interaction_history.md` file.
4. Put all documentation files (specification, implementation plan, user manual etc) at the root or `./docs` directory.
5. Always create/update documentation for app features in a `features.md` file.
6. Always create/update a user manual file for the app, in a `user_manual.md` file.
7. Always create and maintain a to-do list, use `TODOS_and_DONE.md` file at the root.

## Project-Specific Rules
1. **Documentation Parity:** Any time a new user-facing workflow, UI tool, or architectural edge case is introduced, the AI MUST proactively update the `/faq/admin` or `/faq/dancer` EJS pages (located in `views/`) to explain how it works.
2. **Schema Integrity:** The SQLite database uses two primary Many-to-Many junction tables: `award_dancers` and `dancer_studios`. Never default to legacy 1:1 columns (like `awards.dancer_id`) when parsing or mapping dancers to group awards.
3. **Scraper Idempotency:** All ETL / Scraper scripts MUST be strictly idempotent. Always check the database for existing records (event name, performance name, place, category) before inserting to avoid duplicates. Use SQL Transactions for batch insertions.
4. **Pseudo-Studios for Collabs:** If an award is won by a cross-studio collaboration (e.g., "Studio A & Studio B" at YAGP), DO NOT build a many-to-many pivot table for studios. Instead, retain the concatenated string as a new "Pseudo-Studio". The dancers themselves will bridge the affiliations via the `dancer_studios` mappings.
5. **UI Framework:** Rely strictly on Vanilla CSS and HTML5 attributes. Do not introduce TailwindCSS or other styling frameworks without explicit user permission. Ensure all designs are responsive and visually clean.

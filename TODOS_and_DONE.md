# TODOS and DONE

## TODO
- [ ] Initialize Node project and install dependencies
- [ ] Create SQLite schema in `database.js`
- [ ] Build `scrape_dancekar.js`
- [ ] Build `server.js` and Express routes
- [ ] Build EJS views (`layout`, `index`, `studio`, `dancer`)
- [ ] Style the application to be premium and modern
- [ ] Implement Dancer Public Profile Pages (`/dancer/:unique_id`) with verified awards and stats.
- [ ] Add optional Email-Backed Accounts for dancers to secure their unique IDs.
- [ ] Set up Email Notifications for Studio Admins when new pending claims arrive.
- [ ] Add Bulk Actions (Approve/Deny All) to the Studio Verification Dashboard.
- [ ] Implement Roster Export to CSV for Studio Admins.
- [x] Add Composite Indexes to the SQLite database (e.g., `event_id, performance_name, studio_id`) to optimize backfill and search queries at scale.
- [ ] Implement Server-side Pagination/Lazy Loading for studio awards lists to prevent browser freezing for mega-studios.
- [ ] Create automated nightly backups (cron job) for the SQLite database.
- [ ] Add API Rate Limiting to `/api/claim-award` to prevent brute-forcing of Join Codes.

- [x] add to superadmin dashboard: number of studios have more than 15 awards, number of studios have email addresses. 


## DONE
- [x] Create project documentation files

- [x] Rearrange columns on /admin/studios to put 'Featured' on the rightmost side.
- [x] Add search filter by studio name to /admin/studios.

- [x] Add is_claimed field to studios table.
- [x] Display Claim/Login buttons on individual studio pages based on claim status.

- [x] Add 'Why Claim' modal to studio page detailing benefits (embed widget, customize profile, manage awards, analytics).

- [x] Add dotenv and bootstrap Superadmin account via environment variables.
- [x] Create User Management dashboard for superadmin to toggle admin roles.

- [x] Build Phase 1 of Studio Management Dashboard (Profile Editing & Basic Analytics).

- [x] Build Phase 2: Awards Editor with empty-field locking and many-to-many group dancer mapping.
- [x] Build Phase 2: Widget Builder with custom theme and color pickers.

- [x] Phase 3: Optimize Awards Editor performance using Single Edit Modal and Year-Based Pagination.

- [x] NYCDA PDF Bulk Extraction: Developed coordinate-based parsing script (`categorize_nycda.js`) to parse all 2022+ competition and convention results from NYCDA PDFs into structured text, successfully marking valid files with `GOOD-`.

- [x] Integrate Instagram and TikTok handles into Studio Profiles and Management Dashboard.

- [x] Create a `.gitignore` file for the repository.

- [x] Build automated ETL Studio Data Bootstrapping pipeline with staging tables and admin review dashboard.
- [x] Design for dancers ease of use: view/search dancers by name, join studio via code, claim group award via unique ID, color-coded badges.
- [x] Build Organizer Custom Branding Dashboard (Live Trophy Preview, Logo sliders, Taxonomy-Based Custom Icons, Legal Agreements).
- [x] Implement Organizer Marketing Profile (Slogan and Description).
- [x] Refactor Organizer Overview to Tabbed UI with Client-Side Search for past events.
- [x] Phase 2: Bulk CSV Self-Reporting with Automatic Roster Linking for missing awards.
- [x] Adjust Studio Dashboard Analytics to count total Scholarships & Invites.
- [x] Add 'Invitation' default custom icon field for Organizer Custom Branding.
- [x] Finalize Embeddable Studio Widgets (Cross-Origin Headers, Many-to-Many Group Dancers, Custom Data Filters).
- [x] Build Dancer Dashboard: Find Missing Awards search tool and Smart Auto-Backfill claiming.
- [x] Enhance Studio Roster UI: Active/Inactive tabs, status toggles, and recent awards summary popup.

# Features

## Current Features
- **Database Backend:** SQLite database storing studios, dancers, and awards.
- **Scraping Framework:** Extensible web scraping architecture, starting with `scrape_dancekar.js` for KAR Dance Competition.
- **Studio Directory:** Web interface listing all participating studios.
- **Studio Profile:** Dedicated page for each studio showing all awards won by their students.
- **Dancer Profile:** Dedicated page for each dancer with a unique, permanent identifier (`UUID-slugified-name`) showing all their solo awards.

## Planned Features
- Multi-competition aggregations
- Search and filtering by dancer, studio, or competition

### Admin Studio Directory Enhancements
- **Column Ordering**: The 'Featured' column is placed on the far right for better usability.
- **Studio Search**: Administrators can now filter the studio directory by name using a search bar at the top of the page.

### Studio Claiming Interface
- **Status Indicator**: Studio pages now visually indicate if they have been claimed.
- **Claim/Login Actions**: Unclaimed studios feature a 'Claim Studio' button, while claimed studios feature a 'Login' button for the owner.

### Marketing & Studio Claim Benefits
- **Benefits Modal**: A new modal has been added to outline the value proposition of claiming a studio. It highlights embedding widgets, profile customization, data management, and exclusive analytics to encourage studio owners to sign up.

### Secure Studio Claim Process
- **Authentication & Verification**: Users must register and verify their email via Resend before claiming a studio.
- **Fast-Track Auto-Approval**: If the user's verified email domain matches the studio's official website URL exactly, the claim is auto-approved instantly.
- **Manual Admin Review**: Claims using generic emails (like @gmail.com) are routed to an Admin dashboard for manual verification and approval.

### Admin Management
- **Superadmin Bootstrapping**: A master `superadmin` account is automatically seeded into the database upon server startup if `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` are provided in the `.env` file.
- **User Role Management**: Superadmins have access to a dedicated dashboard (`/admin/users`) to view all registered users and promote/demote them to/from the `admin` role.

### Studio Management Dashboard
- **Profile Customization**: Owners can edit their studio's bio, logo, email, phone, and website URL through the `/manage/studio/:id` dashboard.
- **Analytics Tracking**: The system tracks and displays a `view_count` for every studio profile, showing owners exactly how much traffic their page is receiving.

### Awards Data Integrity & Editing
- **Restricted Awards Editor**: Studio owners can manage their awards history, but to preserve the integrity of published competition results, they are only permitted to edit fields that are currently empty (e.g. filling in a missing routine name).
- **Group Dancer Mapping**: Owners can link multiple existing dancers from their studio to a single award (like a duet or group routine) via the 'award_dancers' relational table, ensuring those awards correctly display on each individual dancer's profile.

### Embeddable Awards Widget
- **Widget Builder**: A dedicated tool for studio owners to generate a custom HTML `<iframe>` snippet to embed their awards feed on their own website.
- **Customization**: The widget supports URL query parameters (`theme`, `bg`, `primary`) allowing owners to seamlessly match the widget to their website's branding.

### Awards Editor Performance Optimizations
- **Single Edit Modal**: To ensure maximum UI responsiveness even for studios with thousands of awards, the editor uses a lightweight DOM structure. Instead of rendering hundreds of individual forms, a single universal 'Edit' modal handles all updates.
- **Year-Based Pagination**: Historical awards are paginated by year. The server automatically aggregates the active competition years for the studio and generates navigation tabs, ensuring rapid page loads by querying one year at a time.

### Studio Social Media Integration
- **Social Links**: Studios can now add their Instagram and TikTok handles to their profile via the Management Dashboard.
- **Profile Badges**: Sleek, branded social media badges dynamically render on the public studio page alongside the website link, driving direct engagement to the studio's social channels.

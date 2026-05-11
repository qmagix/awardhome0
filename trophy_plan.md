# Digital Trophy Premium Ecosystem: Product Roadmap & Architecture

## 1. Executive Summary
The **Digital Trophy System** transforms the AwardHome platform from a pure data aggregator into a B2B merchandising and marketing tool. By allowing Event Organizers (e.g., YAGP, KAR, Rainbow) to purchase premium subscriptions, they gain the ability to customize the visual appearance of their awards across the entire platform. 

When a dancer views their "Digital Trophy Case," awards from Premium Organizers will stand out with bespoke branding, 3D assets, sponsor integrations, and rich media, driving higher engagement and prestige.

---

## 2. Product Tiers & Features

### Tier 1: Basic (Free)
* **Default Glassmorphic Card:** Standard black/gold design.
* **Basic Text Info:** Place, Category, Routine Name.
* **Standard Verification:** Generic blue checkmark showing the data was imported officially.

### Tier 2: Premium Brand Partner ($XXX/year or $/event)
* **Custom Brand Colors:** Hex codes injected into the CSS gradient backgrounds and borders of the cards.
* **Custom Logo Upload:** Replaces the generic trophy icon with the competition's official logo.
* **Custom Badge:** Replaces the generic blue checkmark with an "Official Partner" glowing badge.
* **Sponsor Tagging:** Ability to add a `Sponsored By: [Brand]` text block and logo to specific award cards (e.g., "1st Place Solo Sponsored by Capezio").

### Tier 3: Platinum / Interactive ($$$/year)
* **Interactive 3D Assets:** Rotating WebGL/Three.js 3D trophies (e.g., a spinning diamond, gold ballet shoe).
* **Rich Media Integration:** Ability for organizers to attach the official performance video (YouTube/Vimeo link) directly to the back of the card (flip animation).
* **Automated PDF Certificates:** A "Download Certificate" button that dynamically renders the dancer's info over the organizer's uploaded PDF template.
* **Dedicated Leaderboard Page:** A branded URL (e.g., `awardhome.com/yagp/2026/leaderboard`) showing top studios and dancers for their events.

---

## 3. Technical Architecture (Implementation Plan)

### A. Database Schema Expansion
We need to store the custom branding data. Instead of bloating the schema with dozens of columns, we will add a `brand_config` JSON column to the `organizations` table. 

```sql
ALTER TABLE organizations ADD COLUMN is_premium BOOLEAN DEFAULT 0;
ALTER TABLE organizations ADD COLUMN brand_config TEXT; -- Stores JSON
```

**Example JSON structure for `brand_config`:**
```json
{
  "theme": "dark",
  "primary_color": "#FF007F",
  "gradient_start": "#FF007F",
  "gradient_end": "#4A00E0",
  "logo_url": "https://s3.bucket/yagp_logo.png",
  "custom_badge_url": "https://s3.bucket/yagp_verified.png",
  "3d_model_url": null
}
```

### B. Sponsor & Media Links (Event Level)
To handle sponsors and videos, we will add columns to the `awards` or `events` table:
```sql
ALTER TABLE awards ADD COLUMN sponsor_name TEXT;
ALTER TABLE awards ADD COLUMN sponsor_logo_url TEXT;
ALTER TABLE awards ADD COLUMN performance_video_url TEXT;
```

### C. Frontend Implementation (EJS & CSS)
When rendering a dancer's profile in `dancer.ejs`, the server will parse the `brand_config` JSON.
We will use **CSS Custom Properties (Variables)** applied inline to individual cards to dynamically theme them without breaking the global stylesheet.

**Example EJS Implementation:**
```html
<div class="award-card <%= org.is_premium ? 'premium-card' : '' %>" 
     style="--card-primary: <%= config.primary_color %>; --card-grad-end: <%= config.gradient_end %>;">
    
    <% if (org.is_premium && config.logo_url) { %>
        <img src="<%= config.logo_url %>" class="custom-trophy-logo" alt="Org Logo">
    <% } else { %>
        <div class="generic-trophy-icon">🏆</div>
    <% } %>

    <h3><%= award.place %> - <%= award.performance_name %></h3>
    
    <% if (award.sponsor_name) { %>
        <div class="sponsor-tag">
            Sponsored by <img src="<%= award.sponsor_logo_url %>"> <%= award.sponsor_name %>
        </div>
    <% } %>
</div>
```

**Example CSS (`style.css`):**
```css
.premium-card {
    background: linear-gradient(135deg, var(--card-primary), var(--card-grad-end));
    box-shadow: 0 4px 15px var(--card-primary);
    border: 1px solid var(--card-primary);
}
```

---

## 4. The Organizer Portal (New UI)
We will need to build a new dashboard route specifically for Event Organizers (`/organizer/dashboard`). 
* **Role Management:** Add an `organizer` role to the `users` table.
* **Claiming:** Similar to how Studios claim their profiles, Organizers must claim their Organization.
* **The Brand Builder:** A WYSIWYG editor where organizers can pick their colors using a color picker, upload logos, and immediately see a "Live Preview" of how their award cards will look.

---

## 5. Development Phases

**Phase 1: Database & Basic Theming**
- Update SQLite schema with `is_premium` and `brand_config`.
- Update `dancer.ejs` to support inline CSS variables based on the JSON payload.
- Manually configure one competition (e.g., Starpower) via database seed to test the visual output.

**Phase 2: Organizer Portal**
- Build the Organizer login and claiming flow.
- Build the "Brand Builder" UI so organizers can self-serve their design choices.

**Phase 3: Sponsor & Certificate Engine**
- Build the PDF generation pipeline (using a library like `pdf-lib` or `puppeteer`).
- Add sponsor upload fields to the Organizer portal, allowing them to mass-apply sponsors to specific age divisions or categories.

**Phase 4: Platinum Assets**
- Integrate `Three.js` for rendering 3D GLTF models on the cards.
- Add video embed support.

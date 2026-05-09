# Application Features

This document outlines the core features of the Dance Awards Platform.

## 1. Platform Structure
- **Public Directory:** Searchable homepage featuring top and featured studios.
- **Organization Dashboards:** Tabbed interfaces showing competition history grouped by year.
- **Studio Profiles:** Public pages displaying bio, logo, social links, and a searchable awards table.
- **Dancer Profiles:** Public pages displaying verified affiliations and a consolidated list of solo and group awards.

## 2. Studio Management Portal
- **Claim System:** Two-tiered approval (Automated Fast-Track vs Admin Review) to take ownership of a studio.
- **Profile Customizer:** Edit bio, update logos, and link Instagram/TikTok handles.
- **Widget Builder:** Generate copy-paste iframe code with custom color pickers to embed awards on external websites.
- **Awards Editor:** Add existing dancers to awards, or manually input missing awards.
- **Roster Management:** View the studio's full dancer roster and cycle the Secret Join Code.
- **Verifications Dashboard:** Approve or deny pending award claims submitted by dancers.

## 3. Dancer Experience
- **Award Claiming:** Dancers can click "+ Add Me" on any award to link it to their profile.
- **Unique IDs:** Dancers are issued a Unique ID to rapidly claim future awards without needing the Studio Code.
- **Smart Auto-Backfill:** Claiming one award automatically queries and claims all other awards for the same routine at the same event.
- **Privacy:** Roster lists are hidden from the public; dancers only appear on the awards they claim.

## 4. Superadmin Controls
- **Data Drafts / ETL Triage:** Review scraped web data (emails, addresses) before merging into live studios.
- **Role Management:** Promote standard users to admins.
- **Organization Management:** Full CRUD interface for adding, editing, and deleting Competition Organizations.
- **Studio Deduplication:** An automated system (`dedup_studios.js`) that identifies duplicated studios containing geographic suffixes (e.g., "Studio X, CA"), merging them into their base name and maintaining an internal `aka` alias field to prevent data fragmentation.

## 5. FAQ & Instructions Documentation
- **Studio Admin FAQ (`/faq/admin`)**: Outlines how to claim a studio, customize the profile, manage the roster using the Secret Join Code, approve/deny claims, handle multi-studio "Pseudo-Studio" collaborations, and embed the Widget.
- **Dancer FAQ (`/faq/dancer`)**: Explains how to create a profile via award claiming, the difference between the Unique ID and Studio Code, what the colored verification badges mean, how Smart Auto-Backfill works, and privacy guarantees.
- **Global Footer Navigation**: Both FAQ pages are permanently linked in the website footer for easy accessibility from any page.

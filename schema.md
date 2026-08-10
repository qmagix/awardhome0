Database Schema Design
This document outlines the proposed database schema to support multiple organizations, events, and a flexible many-to-many relationship between students/dancers and their respective clubs/studios.

Proposed Schema
1. organizations
Represents the competition hosting company (e.g., "KAR Dance Competition"). Data here will be manually seeded.

id (INTEGER, Primary Key)
name (TEXT, Unique, Not Null) - e.g., "KAR"
slug (TEXT, Unique, Not Null) - e.g., "kar"
website (TEXT)

2. events
Represents a specific competition instance.

id (INTEGER, Primary Key)
org_id (INTEGER, Foreign Key to organizations(id))
name (TEXT, Not Null) - e.g., "Hayward, CA"
year (INTEGER, Not Null) - e.g., 2026
date_string (TEXT) - e.g., "2/13/2026"
url (TEXT) - The source URL for the scraped data.

3. studios (or Clubs/Organizations)
Represents the dance studios, clubs, or training organizations.

id (INTEGER, Primary Key)
unique_id (TEXT, Unique, Not Null) - e.g., UUID-slugified-name
name (TEXT, Unique, Not Null)
contact (TEXT, Nullable)
address (TEXT, Nullable)
email (TEXT, Nullable)
phone (TEXT, Nullable)
website_url (TEXT, Nullable)

4. dancers (or Students)
Represents individual dancers/students. A student can belong to multiple clubs/studios over time.

id (INTEGER, Primary Key)
unique_id (TEXT, Unique, Not Null) - Lifetime UUID (e.g., UUID-slugified-name)
name (TEXT, Not Null)
birthday (TEXT, Nullable) - Format: YYYY-MM-DD
change_log (TEXT, Nullable) - JSON string or text block to track historical updates to the profile.

5. dancer_studios (Pivot Table)
A many-to-many relationship table allowing a dancer/student to be affiliated with multiple studios/clubs (e.g., dance, swimming, fencing).

id (INTEGER, Primary Key)
dancer_id (INTEGER, Foreign Key to dancers(id))
studio_id (INTEGER, Foreign Key to studios(id))
status (TEXT, Default: 'active') - e.g., 'active', 'past'
notes (TEXT, Nullable)
Constraint: UNIQUE(dancer_id, studio_id)

6. awards
Represents a specific award given at an event.

id (INTEGER, Primary Key)
event_id (INTEGER, Foreign Key to events(id))
studio_id (INTEGER, Foreign Key to studios(id))
dancer_id (INTEGER, Foreign Key to dancers(id), Nullable)
place (TEXT)
performance_name (TEXT)
performance_number (TEXT)
award_type (TEXT)
category (TEXT)
notes (TEXT, Nullable) - For future use or admin annotations.
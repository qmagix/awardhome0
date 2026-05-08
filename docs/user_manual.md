# User Manual

## Running the Application

### 1. Prerequisites
- Node.js installed
- SQLite3 installed

### 2. Setup
Install dependencies by running:
```bash
npm install
```

### 3. Scraping Data
To scrape the initial KAR dance competition data and populate the database:
```bash
node scrape_dancekar.js
```
This will fetch the data, parse the results, and seed the `database.sqlite` file.

### 4. Running the Server
Start the web server by running:
```bash
npm start
```
By default, the server will be available at `http://localhost:3000`.

### 5. Navigation
- Visit `/` to see a list of all studios.
- Click on a studio to view all awards for that specific studio.
- Click on a solo dancer's name to view their individual page and all their associated solo awards.

### Using the Admin Studio Search
1. Navigate to the Admin Studio Directory (`/admin/studios`).
2. At the top right, enter the name of the studio you are looking for in the search bar.
3. Click 'Search' to filter the list of studios by your query.
4. To clear the search results, click the 'Clear' button.

### Claiming a Studio
1. Navigate to a specific Studio's page (e.g., `/studio/14`).
2. If the studio is unclaimed, you will see a 'Claim Studio' button next to the name. Click it to begin the claiming process (coming soon).
3. If the studio is already claimed, you will see a 'Login' link to access the studio's management dashboard.

### Viewing Claim Benefits
1. For an unclaimed studio, click the 'Why Claim?' link next to the 'Claim Studio' button.
2. A popup will appear explaining the core benefits (widgets, customization, management, analytics).
3. Click anywhere outside the popup or the 'X' button to close it.

### Registering and Claiming
1. Click **Register** in the top navigation bar to create an account.
2. You will receive an email from Resend to verify your account.
3. Navigate to your studio's page and click **Claim Studio**.
4. Fill out the form with your Role and Phone number. If your email matches the studio's website domain, you'll be instantly approved! Otherwise, an admin will review your request.

### Managing Users & Admins (Superadmin Only)
1. Log in with the superadmin email and password provided in your `.env` file.
2. Click **User Mgmt** in the top navigation bar.
3. You will see a list of all registered users.
4. Click **Make Admin** to grant a user admin privileges (allowing them to approve/reject studio claims).
5. Click **Revoke Admin** to remove those privileges.

### Managing Your Studio Profile
1. If you own a studio, log in to your account.
2. Click **My Studio** in the top navigation bar to go straight to your dashboard, or click **Manage Studio** from your public studio page.
3. Here, you can view your total profile views.
4. Update your Studio Name, Website, Email, Phone, Logo URL, and Bio. Click **Save Profile Changes**.
5. Click the **Back to Public Profile** link in the sidebar to see how your new bio and logo look to the public!

### Using the Awards Editor
1. From your Studio Management Dashboard, click **Awards Editor** in the sidebar.
2. You will see a list of all awards attributed to your studio.
3. If an award is missing a performance name, place, or award type, you will see an input field. Type the missing info and click **Save**.
4. To add dancers to a duet, trio, or group award, use the **Add Dancer** dropdown below the award to select from dancers already affiliated with your studio.

### Using the Widget Builder
1. From your Studio Management Dashboard, click **Widget Builder** in the sidebar.
2. Use the color pickers to select a Background Color and a Primary Brand Color that matches your website.
3. Watch the Live Preview update instantly!
4. When you are happy with the design, click **Copy** on the embed code and paste it into the HTML block of your website builder (Wix, Squarespace, etc.).

### Navigating the Optimized Awards Editor
1. By default, the Awards Editor only loads your most recent year's awards to ensure lightning-fast performance.
2. To view historical data, click on the **Year Tabs** (e.g., 2024, 2023) at the top of the editor.
3. Instead of editing directly inside the table, click the **Edit** button next to any award. This will instantly open a pop-up window where you can safely update missing performance data or add group dancers.

### Linking Social Media Accounts
1. From your Studio Management Dashboard, click **Profile & Customization**.
2. Scroll down to the contact section to find the **Instagram Handle** and **TikTok Handle** fields.
3. Enter your usernames (e.g., `@yourstudio`) and click **Save Profile Changes**.
4. Vibrant, clickable Instagram and TikTok buttons will automatically appear on your public studio page!

### Admin: Reviewing Automated Studio Data
1. Run the bootstrapper script via terminal (`node bootstrap_studios.js`) to automatically search the internet for missing studio websites.
2. In the platform, click **Data Drafts** in the top navigation bar (requires Admin/Superadmin).
3. You will see a list of scraped data drafts. Each draft shows the current database info on the left, and the newly scraped info on the right.
4. You can freely edit the scraped information in the text boxes to fix any formatting errors.
5. Click **Merge & Approve** to overwrite the current database with the new data, or **Reject Bad Data** to delete the scrape.

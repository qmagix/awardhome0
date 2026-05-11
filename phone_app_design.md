# AwardHome Mobile App Strategy & Design Document

## 1. Executive Summary & Recommendation
Creating a dedicated iOS and Android application for AwardHome is an excellent strategic move. While the web platform is great for discovery and administration, a mobile app creates **stickiness**. It sits on the user's home screen, utilizes push notifications for new awards, and natively integrates with mobile social sharing (like Instagram Stories).

**Recommendation:** We should avoid building two separate native apps (Swift for iOS / Kotlin for Android). Instead, we should use a cross-platform framework. 
Given your current web stack (Node.js/Express with EJS), the best approach is **React Native using Expo**. It provides a premium, "true native" feel, gives you full access to native social sharing APIs, and allows us to build both iOS and Android simultaneously using JavaScript/TypeScript.

---

## 2. Strategic Value (Why build an app?)
* **Dancers:** Instant push notification when an award is imported and mapped to them. One-tap sharing of their "Digital Trophy" directly to Instagram/TikTok stories.
* **Studio Admins:** Push notifications for incoming dancer claim requests. Quick approval interface while on the go (at the studio or competition).
* **Organizers:** Push notifications to attendees ("Results for YAGP Tampa are now live on AwardHome!").

---

## 3. Technical Approach Options

### Option A: Capacitor / Web Wrapper (Fastest, Lowest Effort)
* **How it works:** We wrap your existing responsive Express/EJS web pages in a native shell (using Capacitor or Ionic).
* **Pros:** Extremely fast to deploy. We reuse 100% of the HTML/CSS we've already written.
* **Cons:** Slower, clunky performance compared to native. Sometimes rejected by the Apple App Store for "not providing enough native functionality."

### Option B: React Native with Expo (Recommended MVP)
* **How it works:** We build a standalone mobile frontend using React Native. It communicates with your existing Node.js server via a new JSON API.
* **Pros:** True native animations and performance. Massive ecosystem for social sharing plugins. Easy to compile to both iOS and Android. Written in JavaScript.
* **Cons:** Requires building a REST API alongside your existing EJS routes. Requires rewriting the UI components in React Native.

### Option C: Fully Native iOS/Android (Overkill)
* **How it works:** Writing one app in Swift (Apple) and another in Kotlin (Google).
* **Pros:** Absolute best performance.
* **Cons:** Requires two separate codebases. Highest maintenance cost. Not recommended for a startup.

---

## 4. Recommended Architecture (React Native)

To support a mobile app, we will need to slightly decouple your architecture. Currently, `server.js` renders HTML directly via `res.render('dancer.ejs')`.

We will add a new `/api/v1/` namespace to `server.js` that returns JSON instead of HTML. 

**Example Flow:**
1. Mobile App makes a GET request to `awardhome.com/api/v1/dancers/1234/awards`
2. Express server queries the SQLite database.
3. Express server returns JSON: `[{ place: "1", performance: "Dream On" }]`
4. React Native app natively renders the glassy, animated trophy card.

---

## 5. Core Feature MVP (Version 1.0)

To avoid feature bloat, V1 should focus strictly on the highest-value actions.

### For Dancers (The "Trophy Case" App)
- **Push Authentication:** Secure login via Secret Join Code or Email.
- **Trophy Feed:** A highly visual, scrollable feed of their historical awards.
- **Social Share Button:** Generates an image of the specific award card and opens the native iOS/Android share sheet.
- **Profile Customization:** Upload headshot, add Instagram handle.

### For Studio Admins (The "Manager" App)
- **Roster Overview:** A list of active dancers.
- **Push Approvals:** When a dancer tries to claim an award or join the studio, the admin gets a push notification and can tap "Approve" or "Reject".
- **Studio Stats:** A quick analytics dashboard showing total awards won this season.

---

## 6. Native Social Sharing Strategy
The biggest growth lever for the app is social sharing. Dancers *want* to brag about their awards.
Using React Native's `Share` API or `expo-sharing`, we can build a feature that takes a specific trophy card (e.g., "1st Place Solo - YAGP"), renders it off-screen into an image buffer, and passes it directly to **Instagram Stories**. 

We can even overlay a custom AwardHome sticker or QR code on the shared image, driving viewers back to the app to download it.

---

## 7. Next Steps & Development Roadmap

If we proceed with the React Native approach, here is the execution plan:

1. **API Development (Backend):** 
   - Extract the logic from `server.js` routes into a dedicated `routes/api.js` file.
   - Implement JWT (JSON Web Tokens) for mobile authentication.
2. **Mobile App Initialization:**
   - Run `npx create-expo-app awardhome-mobile` to scaffold the app.
   - Build out the custom Black/Gold UI components in React Native.
3. **Core Integration:**
   - Connect the app to the local Express API.
   - Implement the "Trophy Case" list view.
4. **Social & Push:**
   - Implement `expo-sharing` for the Instagram integration.
   - Integrate Expo Push Notifications.
5. **App Store Deployment:**
   - Setup Apple Developer & Google Play accounts.
   - Submit for review.

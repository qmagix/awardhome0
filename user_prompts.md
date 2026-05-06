# User Prompts

- I am planning for build a platform that hosts awards for students. Starting from dancers. Examples of awards data are as here: https://dancekar.com/competition/results/2026/1900
What I like you to do is first scrape the data from the website and store it in a database. Establish an account for each studio and list all the awards for each studio. That is step one. Then for all solo dances create a page for each dancer and have a unique identifier for each dancer (that would be used for future linking).
Now please go ahead and bootstrap this project. use sqlite for database.
- UUID-slugified-name is better, dancer move around studios and organizations, and we want the UUID be their lifetime id.
- please name scraper with each site, we may need different ones for different competitions

## User Request - 2026-05-05
For /admin/studios page, please put featured column on the right most side. Also on this page please add search /filter studio by name function

## User Request - 2026-05-05
Good. It works. Now for each studio page, such as http://localhost:3000/studio/14, if a studio is claimed, please put a "login" link next to the studio name. If is is not claimed, please add a "Claim" button next to the studio name. of course this requires adding a is_claimed field to the studio table and default to false?

## User Request - 2026-05-05
Good. Next to the "Claim Studio" button, how about adding a "Why Claim" link that leads to a popup explaining the benefit such as (1) embedding widget to their own website, (2) customize what to display (3) update awards items .. . anything else to add from marketing perspective? 

## User Request - 2026-05-05
Now let's design the studio claim function/process, what would you recommend as a safe and robust process? 

## User Request - 2026-05-06
admin/claims now returns forbidden, should we set superadmin account info in .env and enable superadmin to create admin accounts to enable access to admin functions? 

## User Request - 2026-05-06
please take a look at http://localhost:3000/studio/14 again, this account is claimed by sam@jludance.com, but after login, the page still have the login button on the right, looks strange. 

## User Request - 2026-05-06
After the user login, right now it first shows the main page http://localhost:3000. If a user have a claimed studio, please show the studio page first, make sense? 

## User Request - 2026-05-06
Good. And now good to see there is a "Manage Studio" button on the right. Right now clicking on it does nothing. Please propose what should be "manage studio" leads to?

## User Request - 2026-05-06
Good. Now let's move on to phase 2

## User Request - 2026-05-06
It works now but usability is an issue when there are lots of awards the page becomes very slugish, and not very responsive, what about on the table for each row have an edit button that bring up an editor for the respective entry only after a click? will this make it have better performance? any other suggestions?  Listing awards by year if the total is over 50 awards?

## User Request - 2026-05-06
Good. Now for the profile page, do you think if we should add optional instagram and tiktok handles?

## User Request - 2026-05-06
Please create a gitignore file in this repo

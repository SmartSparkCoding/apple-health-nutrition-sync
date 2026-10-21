# iOS Shortcut build spec: Sync Nutrition to Health

Base URL: https://poke.mini-jacob.hackclub.app

This repo does not ship a binary .shortcut file. iOS only imports shortcuts that are signed, and signing requires Apple's tooling (the macOS shortcuts command). Build the shortcut by hand with the steps below, which takes about 10 minutes.

## Variables

- BaseURL = https://poke.mini-jacob.hackclub.app
- AuthKey = your AUTH_KEY

## Actions in order

1. Text: https://poke.mini-jacob.hackclub.app, then Set Variable BaseURL.
2. Text: your AUTH_KEY, then Set Variable AuthKey.
3. Get Contents of URL: URL = BaseURL + /meals/pending. Method GET. Header x-auth-key = AuthKey.
4. Get Dictionary Value: Key = meals, input = Contents of URL. Set Variable Pending.
5. Repeat with Each: input = Pending.
6. Inside the loop, Get Dictionary Value for each key on Repeat Item, with Set Variable after each:
   - id to MealID
   - timestamp to MealTime
   - calories to Calories
   - protein to Protein
   - carbs to Carbs
   - fat to Fat
7. Format Date: ISO 8601, input = MealTime. Set Variable MealDate.
8. Log Health Sample: Dietary Energy, value Calories, unit kcal, start and end date MealDate.
9. Log Health Sample: Protein, value Protein, unit g, start and end date MealDate.
10. Log Health Sample: Carbohydrates, value Carbs, unit g, start and end date MealDate.
11. Log Health Sample: Dietary Fat Total, value Fat, unit g, start and end date MealDate.
12. Get Contents of URL: URL = BaseURL + /meals/ + MealID + /synced. Method POST. Header x-auth-key = AuthKey.
13. End Repeat.

After building, name the shortcut "Sync Nutrition to Health" and set up the time-of-day automation described in README section 4.

## Optional: share it to others

On the device, open the shortcut, tap the share icon, and choose Copy iCloud Link. Paste the link here to share it. The link is created by iOS, not by this repo.

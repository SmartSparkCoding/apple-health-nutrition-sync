# apple-health-nutrition-sync

Bridges Poke nutrition tracking to Apple HealthKit via iOS Shortcuts, running on Hack Club Nest.

## 1. What the project does

Poke tracks what you eat. Apple Health is where your nutrition data is meant to live, but Poke cannot write to HealthKit directly. This project fills the gap:

1. Poke (or any client) POSTs meals to a small Express server running on Hack Club Nest.
2. The server stores each meal with a `synced: false` flag in a local JSON file.
3. An iOS Shortcut on your iPhone periodically calls the server to fetch pending meals.
4. For each meal, the Shortcut uses "Log Health Sample" to write Dietary Energy, Protein, Carbohydrates and Fat into Apple Health.
5. The Shortcut then tells the server the meal is synced, so it is never written twice.

An optional automatic background run can be set up in the Shortcuts app so this happens without you opening anything.

### API

All endpoints except `/health` require the auth key, sent either as the header `x-auth-key: <AUTH_KEY>` or as `Authorization: Bearer <AUTH_KEY>`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness check. No auth. Returns `{"ok": true}`. |
| POST | `/meals` | Add one meal, or many via `{"meals": [...]}`. Duplicate `id`s are skipped. |
| GET | `/meals/pending` | Returns meals where `synced` is false. |
| POST | `/meals/:id/synced` | Marks a single meal as synced. |
| POST | `/meals/synced` | Batch mark: body `{"ids": ["..."]}`. |

A meal object looks like this:

```json
{
  "id": "lunch-2026-10-21-1",
  "name": "Chicken wrap",
  "timestamp": "2026-10-21T13:05:00Z",
  "calories": 520,
  "protein": 38,
  "carbs": 45,
  "fat": 18
}
```

- `id` is optional. If omitted, a UUID is generated. Supplying your own stable id lets Poke retry safely without creating duplicates.
- `timestamp` is optional (defaults to now). It is used as the start and end date of the Health samples.
- Nutrient values are in kcal for `calories` and grams for `protein`, `carbs`, and `fat`.

Example request:

```bash
curl -X POST https://YOUR-NEST-URL/meals \
  -H "Content-Type: application/json" \
  -H "x-auth-key: YOUR_AUTH_KEY" \
  -d '{"name":"Oats","calories":350,"protein":12,"carbs":60,"fat":7}'
```

## 2. Deploying and running on Nest

These steps assume a Linux shell on your Hack Club Nest machine with Node.js 18 or newer installed (check with `node -v`).

### Install

```bash
git clone https://github.com/SmartSparkCoding/apple-health-nutrition-sync.git
cd apple-health-nutrition-sync
npm install
```

### Set the auth key

Generate a long random key and keep it secret. The server refuses to start without it.

```bash
openssl rand -hex 32
```

Export it, along with an optional port and data file location:

```bash
export AUTH_KEY="paste-your-generated-key"
export PORT=3000
# optional: where meals are stored (defaults to ./data/meals.json)
export DATA_FILE="$HOME/nutrition-data/meals.json"
```

### Run it

Quick test in the foreground:

```bash
node index.js
```

You should see `apple-health-nutrition-sync listening on port 3000`. Check it with `curl http://localhost:3000/health`.

For a long-running service, pick one of the options below.

#### Option A: pm2 (simplest)

```bash
sudo npm install -g pm2
AUTH_KEY="your-key" PORT=3000 pm2 start index.js --name nutrition-sync
pm2 save
pm2 startup   # follow the printed command so it survives reboots
pm2 logs nutrition-sync
```

#### Option B: systemd

Create `/etc/systemd/system/nutrition-sync.service` (replace the user, paths and key):

```ini
[Unit]
Description=apple-health-nutrition-sync
After=network.target

[Service]
Type=simple
User=YOUR_LINUX_USER
WorkingDirectory=/home/YOUR_LINUX_USER/apple-health-nutrition-sync
Environment=AUTH_KEY=your-key
Environment=PORT=3000
Environment=DATA_FILE=/home/YOUR_LINUX_USER/nutrition-data/meals.json
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nutrition-sync
systemctl status nutrition-sync
journalctl -u nutrition-sync -f
```

(Confirm the node path with `which node` and adjust `ExecStart` if needed.)

### Make it reachable from your iPhone

The iPhone must be able to reach the server over HTTPS. Expose the port through whatever public URL Nest provides for your app, or put it behind a reverse proxy with TLS. Verify from your phone's browser or from another network:

```
https://YOUR-NEST-URL/health
```

It should return `{"ok":true}`. Use that base URL in the Shortcut below.

### Data and backups

Meals are stored in a single JSON file at `DATA_FILE`. Back it up occasionally, for example with `cp meals.json meals.backup.json`. Writes are atomic (written to a temp file, then renamed), so a crash should not corrupt it.

## 3. Setting up the Apple Shortcut (iOS)

You need the Shortcuts app on an iPhone running a recent iOS version. Apple Health must allow Shortcuts to write the four nutrition types. The first time the Shortcut runs, iOS will ask for permission; tap Turn On All for Dietary Energy, Protein, Carbohydrates and Fat (Dietary Fat Total). If you denied it earlier, go to Settings, Privacy and Security, Health, Shortcuts and enable them.

You will need your server base URL (for example `https://YOUR-NEST-URL`) and your AUTH_KEY.

### Step 1: Create the shortcut

1. Open Shortcuts and tap the plus button in the top right to create a new shortcut.
2. Tap the name at the top and rename it to "Sync Nutrition to Health".
3. Tap the settings icon (sliders) and make sure it is allowed to run without confirmation where possible. Optional: turn on "Show in Share Sheet" off.

### Step 2: Store your settings as variables

1. Add a "Text" action with your base URL, for example `https://YOUR-NEST-URL`. Rename its variable to `BaseURL` by tapping the action's output and choosing Set Variable, named `BaseURL`.
2. Add another "Text" action with your auth key and set it as a variable named `AuthKey`.

Using variables means you only edit these in one place later.

### Step 3: Fetch pending meals

1. Add the action "Get Contents of URL".
2. Tap URL and enter `BaseURL` as a variable followed by `/meals/pending` (tap the variable chip to insert it, then type the rest).
3. Tap Show More. Set Method to GET.
4. Under Headers, add a header with key `x-auth-key` and value `AuthKey` (insert the variable).
5. The action outputs the JSON response. Add the action "Get Dictionary Value" with Key set to `meals` to get the list of meals. Note: the list is in the `meals` key.

### Step 4: Loop over the meals

1. Add the action "Repeat with Each" and set its input to the Dictionary Value from Step 3 (the `meals` list). Each pass gives you one meal as the Repeat Item.
2. Inside the loop, add "Get Dictionary Value" actions on the Repeat Item to read these keys into variables (use Set Variable after each one): `timestamp` (into `MealTime`), `calories` (into `Calories`), `protein` (into `Protein`), `carbs` (into `Carbs`), `fat` (into `Fat`), and `id` (into `MealID`).
3. Convert `MealTime` to a date: add the action "Format Date" or "Get Details of Dates" is not needed. Simply add "Date" action with Format set to ISO 8601 and set the input to the `MealTime` text, then set the variable `MealDate`. Use `MealDate` as the start and end date in the next steps.

### Step 5: Log the Health samples

Inside the loop, add four "Log Health Sample" actions, one for each type:

1. Sample Type: Dietary Energy. Value: `Calories`. Unit: kcal (the action may show it as Calories). Start Date and End Date: `MealDate`.
2. Sample Type: Protein. Value: `Protein`. Unit: g. Start Date and End Date: `MealDate`.
3. Sample Type: Carbohydrates. Value: `Carbs`. Unit: g. Start Date and End Date: `MealDate`.
4. Sample Type: Dietary Fat Total (shown as Fat in some versions). Value: `Fat`. Unit: g. Start Date and End Date: `MealDate`.

If a value is 0, you can leave the sample in place or wrap it in an "If" action (Value is greater than 0) to skip it.

### Step 6: Mark the meal as synced

Still inside the loop, after the four samples:

1. Add "Get Contents of URL".
2. URL: `BaseURL` variable followed by `/meals/` then the `MealID` variable then `/synced`.
3. Show More, Method: POST.
4. Headers: `x-auth-key` with the `AuthKey` variable.

The server now flags that meal as synced and it will not appear in future pending lists. End the loop with the "End Repeat" action (added automatically when you add Repeat with Each, so just confirm it is at the bottom).

### Step 7: Test it

1. Add a meal from your computer with the curl example above.
2. Tap the shortcut's Play button.
3. Open the Health app, Browse, Nutrition, and check that Dietary Energy, Protein, Carbohydrates and Fat show the new values for the meal's time.
4. Run the shortcut again. It should log nothing new, because the meal was marked synced.

## 4. Configuring automatic background sync

The Shortcuts app can run a shortcut automatically on a schedule. Since the sync is idempotent (already-synced meals are skipped), running it often is harmless.

1. Open Shortcuts and go to the Automation tab.
2. Tap plus, then Create Personal Automation.
3. Choose Time of Day, set a time (for example 8:00 AM), and choose Daily. Some iOS versions let you pick Repeat every hour or similar options under Time of Day.
4. Tap Next, then Add Action, and select the Sync Nutrition to Health shortcut (Run Shortcut action).
5. Turn OFF "Ask Before Running" so it runs in the background. Tap Done.
6. Repeat this for additional times (for example lunchtime and evening), since each automation is one time of day.

Notes:

- iOS may ask you to confirm the first run of a new automation. Accept it, and then the automation will run without asking.
- Background automations depend on the phone having network access at the scheduled time. If the server is unreachable, the shortcut fails quietly and the meal stays pending. The next run picks it up.
- You can also trigger the shortcut from a Personal Automation that runs when you open the Health app or when you lock or unlock the phone, if you prefer event-based syncing.
- To check the server state from anywhere, call `GET /meals/pending` with the auth header. An empty list means everything has been synced.

## Troubleshooting

- 401 Missing auth key or 403 Invalid auth key: the `x-auth-key` header value does not match the AUTH_KEY on the server.
- 400 Malformed JSON or validation errors: check that nutrient fields are numbers and non-negative, and that the body is valid JSON.
- Server refuses to start with "AUTH_KEY environment variable is required": export AUTH_KEY, or set it in the systemd unit or pm2 command.
- Health samples not appearing: check Settings, Privacy and Security, Health, Shortcuts and make sure all four nutrition types are allowed for writing.
- A meal was logged twice in Health: this only happens if a meal was logged but the synced call failed. Use a stable `id` when adding meals, and check the `synced` flag on the server.

## Project layout

```
index.js       Express server (meal storage, auth, pending and synced endpoints)
package.json   Dependencies and start script (npm start)
README.md      This file
```

## License

MIT

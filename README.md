# apple-health-nutrition-sync

Bridges Poke nutrition tracking to Apple HealthKit via iOS Shortcuts, running on Hack Club Nest.

Default base URL: https://poke.mini-jacob.hackclub.app/

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
| GET | `/meals/pending` | Returns meals where `synced` is false. Every meal includes all nutrient fields, with missing optional fields returned as 0. |
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
  "fat": 18,
  "caffeine": 0,
  "water": 250,
  "fibre": 6,
  "sugar": 4
}
```

- `id` is optional. If omitted, a UUID is generated. Supplying your own stable id lets Poke retry safely without creating duplicates.
- `timestamp` is optional (defaults to now). It is used as the start and end date of the Health samples.
- Nutrient values are in kcal for `calories` and grams for `protein`, `carbs`, and `fat`.
- Optional extra metrics: `caffeine` in mg, `water` in ml, `fibre` in g, and `sugar` in g. Each one is optional and defaults to 0 if omitted. All must be non-negative numbers.
- Meals saved before these fields were added are still valid. `GET /meals/pending` returns them with the new fields set to 0.

Example request:

```bash
curl -X POST https://poke.mini-jacob.hackclub.app/meals \
  -H "Content-Type: application/json" \
  -H "x-auth-key: YOUR_AUTH_KEY" \
  -d '{"name":"Oats","calories":350,"protein":12,"carbs":60,"fat":7,"fibre":8,"sugar":5}'
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

### Public URL

The server is exposed at https://poke.mini-jacob.hackclub.app/. Verify it from your phone's browser or another network:

```
https://poke.mini-jacob.hackclub.app/health
```

It should return `{"ok":true}`.

### Data and backups

Meals are stored in a single JSON file at `DATA_FILE`. Back it up occasionally, for example with `cp meals.json meals.backup.json`. Writes are atomic (written to a temp file, then renamed), so a crash should not corrupt it.

## 3. Setting up the Apple Shortcut (iOS)

You need the Shortcuts app on an iPhone running a recent iOS version. Apple Health must allow Shortcuts to write the four nutrition types. The first time the Shortcut runs, iOS will ask for permission; tap Turn On All for Dietary Energy, Protein, Carbohydrates and Fat (Dietary Fat Total). If you denied it earlier, go to Settings, Privacy and Security, Health, Shortcuts and enable them.

You will need the base URL https://poke.mini-jacob.hackclub.app and your AUTH_KEY. A full step-by-step spec is in SHORTCUT_SETUP.md in this repo.

### Step 1: Create the shortcut

1. Open Shortcuts and tap the plus button in the top right to create a new shortcut.
2. Tap the name at the top and rename it to "Sync Nutrition to Health".

### Step 2: Store your settings as variables

1. Add a "Text" action with `https://poke.mini-jacob.hackclub.app`. Set it as a variable named `BaseURL`.
2. Add another "Text" action with your auth key and set it as a variable named `AuthKey`.

### Step 3: Fetch pending meals

1. Add the action "Get Contents of URL".
2. Set the URL to the `BaseURL` variable followed by `/meals/pending`.
3. Tap Show More. Set Method to GET.
4. Under Headers, add a header with key `x-auth-key` and value set to the `AuthKey` variable.
5. Add the action "Get Dictionary Value" with Key set to `meals`. This gives you the list of pending meals.

### Step 4: Loop over the meals

1. Add the action "Repeat with Each" and set its input to the list from Step 3. Each pass gives you one meal as the Repeat Item.
2. Inside the loop, add "Get Dictionary Value" actions on the Repeat Item, each followed by Set Variable, to read: `timestamp` into `MealTime`, `calories` into `Calories`, `protein` into `Protein`, `carbs` into `Carbs`, `fat` into `Fat`, and `id` into `MealID`. The extra metrics (`caffeine`, `water`, `fibre`, `sugar`) can be read the same way when you add their Health samples.
3. Add a "Format Date" action with Format set to ISO 8601 and the input set to `MealTime`. Set the output to a variable named `MealDate`. Use `MealDate` as the start and end date in the next steps.

### Step 5: Log the Health samples

Inside the loop, add four "Log Health Sample" actions, one for each type:

1. Sample Type: Dietary Energy. Value: `Calories`. Unit: kcal. Start Date and End Date: `MealDate`.
2. Sample Type: Protein. Value: `Protein`. Unit: g. Start Date and End Date: `MealDate`.
3. Sample Type: Carbohydrates. Value: `Carbs`. Unit: g. Start Date and End Date: `MealDate`.
4. Sample Type: Dietary Fat Total. Value: `Fat`. Unit: g. Start Date and End Date: `MealDate`.

If a value is 0, you can leave the sample in place or wrap it in an "If" action (Value is greater than 0) to skip it.

Optional extra samples (not yet in the Shortcut, add them when you want them logged): Caffeine (mg), Water (ml, Dietary Water), Fiber (g, Dietary Fiber) and Sugar (g, Dietary Sugar). Each one uses the same Start and End Date of `MealDate`, and should be wrapped in an "If" action (Value is greater than 0).

### Step 6: Mark the meal as synced

Still inside the loop, after the four samples:

1. Add "Get Contents of URL".
2. URL: the `BaseURL` variable followed by `/meals/` then the `MealID` variable then `/synced`.
3. Show More, Method: POST.
4. Headers: `x-auth-key` with the `AuthKey` variable.

End the loop with the "End Repeat" action (added automatically with Repeat with Each).

### Step 7: Test it

1. Add a meal with the curl example above.
2. Tap the shortcut's Play button.
3. Open the Health app, Browse, Nutrition, and check that Dietary Energy, Protein, Carbohydrates and Fat show the new values for the meal's time.
4. Run the shortcut again. It should log nothing new, because the meal was marked synced.

## 4. Configuring automatic background sync

The Shortcuts app can run a shortcut automatically on a schedule. Since the sync is idempotent (already-synced meals are skipped), running it often is harmless.

1. Open Shortcuts and go to the Automation tab.
2. Tap plus, then Create Personal Automation.
3. Choose Time of Day, set a time (for example 8:00 AM), and choose Daily.
4. Tap Next, then Add Action, and select the Sync Nutrition to Health shortcut (Run Shortcut action).
5. Turn OFF "Ask Before Running" so it runs in the background. Tap Done.
6. Repeat for additional times (for example lunchtime and evening), since each automation is one time of day.

Notes:

- iOS may ask you to confirm the first run of a new automation. Accept it, and then the automation will run without asking.
- If the server is unreachable at the scheduled time, the shortcut fails quietly and the meal stays pending. The next run picks it up.
- To check the server state, call `GET /meals/pending` with the auth header. An empty list means everything has been synced.

## Troubleshooting

- 401 Missing auth key or 403 Invalid auth key: the `x-auth-key` header value does not match the AUTH_KEY on the server.
- 400 Malformed JSON or validation errors: check that nutrient fields are numbers and non-negative, and that the body is valid JSON.
- Server refuses to start with "AUTH_KEY environment variable is required": export AUTH_KEY, or set it in the systemd unit or pm2 command.
- Health samples not appearing: check Settings, Privacy and Security, Health, Shortcuts and make sure all four nutrition types are allowed for writing.
- A meal was logged twice in Health: this only happens if a meal was logged but the synced call failed. Use a stable `id` when adding meals.

## Project layout

```
index.js            Express server (meal storage, auth, pending and synced endpoints)
package.json        Dependencies and start script (npm start)
SHORTCUT_SETUP.md   Exact iOS Shortcut build spec
README.md           This file
```

## License

MIT

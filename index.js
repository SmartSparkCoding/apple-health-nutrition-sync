const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const AUTH_KEY = process.env.AUTH_KEY;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'meals.json');

if (!AUTH_KEY) {
  console.error('AUTH_KEY environment variable is required. Refusing to start.');
  process.exit(1);
}

// ---- Simple JSON file store ----
function loadMeals() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveMeals(meals) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(meals, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---- Auth: accepts x-auth-key header or Authorization: Bearer <key> ----
function requireAuth(req, res, next) {
  const headerKey = req.get('x-auth-key');
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const provided = headerKey || bearer;
  if (!provided) return res.status(401).json({ error: 'Missing auth key' });
  const a = Buffer.from(provided);
  const b = Buffer.from(AUTH_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'Invalid auth key' });
  }
  next();
}

const NUMERIC_FIELDS = ['calories', 'protein', 'carbs', 'fat'];

function normaliseMeal(input) {
  if (!input || typeof input !== 'object') return { error: 'Meal must be an object' };
  const timestamp = input.timestamp ? new Date(input.timestamp) : new Date();
  if (isNaN(timestamp.getTime())) return { error: 'Invalid timestamp' };

  const meal = {
    id: input.id ? String(input.id) : crypto.randomUUID(),
    name: input.name ? String(input.name) : 'Meal',
    timestamp: timestamp.toISOString(),
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    synced: false,
    syncedAt: null,
  };

  for (const field of NUMERIC_FIELDS) {
    const value = Number(input[field] ?? 0);
    if (!Number.isFinite(value) || value < 0) {
      return { error: `Field "${field}" must be a non-negative number` };
    }
    meal[field] = value;
  }
  return { meal };
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Poke (or any client) pushes one or more meals. Accepts {meals: [...]} or a single meal object.
app.post('/meals', requireAuth, (req, res) => {
  const body = req.body || {};
  const inputs = Array.isArray(body.meals) ? body.meals : [body];
  const meals = loadMeals();
  const existingIds = new Set(meals.map((m) => m.id));
  const added = [];
  const skipped = [];

  for (const input of inputs) {
    const result = normaliseMeal(input);
    if (result.error) return res.status(400).json({ error: result.error });
    if (existingIds.has(result.meal.id)) {
      skipped.push(result.meal.id);
      continue;
    }
    meals.push(result.meal);
    existingIds.add(result.meal.id);
    added.push(result.meal.id);
  }

  saveMeals(meals);
  res.status(201).json({ added, skipped });
});

// The iOS Shortcut calls this to fetch meals that have not been written to HealthKit yet.
app.get('/meals/pending', requireAuth, (req, res) => {
  const pending = loadMeals().filter((m) => !m.synced);
  res.json({ count: pending.length, meals: pending });
});

// Mark a single meal as synced after the Shortcut has logged its Health samples.
app.post('/meals/:id/synced', requireAuth, (req, res) => {
  const meals = loadMeals();
  const meal = meals.find((m) => m.id === req.params.id);
  if (!meal) return res.status(404).json({ error: 'Meal not found' });
  meal.synced = true;
  meal.syncedAt = new Date().toISOString();
  saveMeals(meals);
  res.json({ ok: true, id: meal.id, syncedAt: meal.syncedAt });
});

// Batch variant: {"ids": ["...", "..."]}
app.post('/meals/synced', requireAuth, (req, res) => {
  const ids = new Set(Array.isArray(req.body?.ids) ? req.body.ids.map(String) : []);
  const meals = loadMeals();
  const now = new Date().toISOString();
  let marked = 0;
  for (const meal of meals) {
    if (ids.has(meal.id) && !meal.synced) {
      meal.synced = true;
      meal.syncedAt = now;
      marked++;
    }
  }
  saveMeals(meals);
  res.json({ ok: true, marked });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`apple-health-nutrition-sync listening on port ${PORT}`);
});

const express = require('express');
const { Pool } = require('pg');
const Redis = require('ioredis');

// Structured JSON logs -> picked up by Filebeat -> Elasticsearch -> Kibana
const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ level, msg, service: 'api', time: new Date().toISOString(), ...extra }));

const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: 5432,
  user: process.env.DB_USER || 'shop',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'shoplite',
});
const redis = new Redis({ host: process.env.REDIS_HOST || 'redis', maxRetriesPerRequest: 2 });
redis.on('error', (e) => log('error', 'redis error', { error: e.message }));

const CACHE_KEY = 'tasks:all';
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/api/health') return;
    log(res.statusCode >= 500 ? 'error' : 'info', 'request', {
      method: req.method, path: req.originalUrl, status: res.statusCode, duration_ms: Date.now() - start,
    });
  });
  next();
});

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    log('error', 'unhandled error', { error: e.message, path: req.originalUrl });
    res.status(500).json({ error: 'internal error' });
  });

const invalidate = () => redis.del(CACHE_KEY).catch(() => {});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/tasks', wrap(async (req, res) => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) { res.set('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
  } catch (_) { /* cache is optional */ }
  const { rows } = await pool.query('SELECT * FROM tasks ORDER BY id DESC');
  redis.set(CACHE_KEY, JSON.stringify(rows), 'EX', 10).catch(() => {});
  res.set('X-Cache', 'MISS');
  res.json(rows);
}));

app.post('/api/tasks', wrap(async (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title required' });
  const { rows } = await pool.query('INSERT INTO tasks(title) VALUES($1) RETURNING *', [title]);
  await invalidate();
  log('info', 'task created', { task_id: rows[0].id });
  res.status(201).json(rows[0]);
}));

app.patch('/api/tasks/:id', wrap(async (req, res) => {
  const { rows } = await pool.query('UPDATE tasks SET done = NOT done WHERE id=$1 RETURNING *', [req.params.id]);
  await invalidate();
  rows.length ? res.json(rows[0]) : res.status(404).json({ error: 'not found' });
}));

app.delete('/api/tasks/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM tasks WHERE id=$1', [req.params.id]);
  await invalidate();
  res.status(204).end();
}));

// Demo endpoint: generates an error log so you can see it in Kibana
app.get('/api/simulate-error', (req, res) => {
  log('error', 'simulated failure', { reason: 'demo for Kibana' });
  res.status(500).json({ error: 'simulated' });
});

async function init() {
  for (let i = 1; i <= 30; i++) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS tasks(
        id SERIAL PRIMARY KEY, title TEXT NOT NULL, done BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT now())`);
      log('info', 'database ready');
      return;
    } catch (e) {
      log('warn', 'waiting for database', { attempt: i, error: e.message });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  process.exit(1);
}
init().then(() => app.listen(3000, () => log('info', 'api listening', { port: 3000 })));

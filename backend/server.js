// server.js — Whisper Wall backend API
// Express + node:sqlite. Pure REST API under /api — the frontend is deployed
// separately (its own static host) and talks to this server over HTTP.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// CORS — only allow the frontend origin(s) listed in CLIENT_ORIGIN (comma
// separated). Leave CLIENT_ORIGIN unset locally to allow any origin, which is
// convenient for local development.
// ---------------------------------------------------------------------------
const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS: ' + origin));
  }
}));

app.use(express.json());

// Health check — useful for Render and for confirming the API is reachable
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Whisper Wall API is running' });
});

const REACTION_TYPES = ['relate', 'lol', 'support', 'shock'];

function emptyReactionCounts() {
  return { relate: 0, lol: 0, support: 0, shock: 0 };
}

// Build a full confession object (with aggregated reactions + comments) for API responses
function hydrateConfession(row, ownerId) {
  const reactionRows = db.prepare(
    'SELECT type, COUNT(*) AS n FROM reactions WHERE confession_id = ? GROUP BY type'
  ).all(row.id);

  const reactions = emptyReactionCounts();
  reactionRows.forEach(r => { reactions[r.type] = r.n; });

  const mineRow = ownerId
    ? db.prepare('SELECT type FROM reactions WHERE confession_id = ? AND owner_id = ?').get(row.id, ownerId)
    : null;

  const comments = db.prepare(
    'SELECT who, text, created_at FROM comments WHERE confession_id = ? ORDER BY id ASC'
  ).all(row.id);

  return {
    id: row.id,
    category: row.category,
    tags: JSON.parse(row.tags),
    text: row.text,
    createdAt: row.created_at,
    reportCount: row.report_count,
    reactions,
    mine: mineRow ? mineRow.type : null,
    comments,
    isOwner: !!ownerId && ownerId === row.owner_id
  };
}

// ---------------------------------------------------------------------------
// GET /api/confessions — list confessions with optional filters
// query: ownerId, category, tag, search, sort=new|top
// ---------------------------------------------------------------------------
app.get('/api/confessions', (req, res) => {
  const { ownerId, category, tag, search, sort } = req.query;

  let rows = db.prepare('SELECT * FROM confessions').all();

  if (category && category !== 'All') {
    rows = rows.filter(r => r.category === category);
  }
  if (tag) {
    rows = rows.filter(r => JSON.parse(r.tags).includes(tag));
  }
  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter(r => r.text.toLowerCase().includes(s));
  }

  let confessions = rows.map(r => hydrateConfession(r, ownerId));

  if (sort === 'top') {
    confessions.sort((a, b) => {
      const totalA = Object.values(a.reactions).reduce((x, y) => x + y, 0);
      const totalB = Object.values(b.reactions).reduce((x, y) => x + y, 0);
      return totalB - totalA;
    });
  } else {
    confessions.sort((a, b) => b.id - a.id);
  }

  res.json(confessions);
});

// GET /api/tags — distinct tags in use, for the sidebar tag chip list
app.get('/api/tags', (req, res) => {
  const rows = db.prepare('SELECT tags FROM confessions').all();
  const tagSet = new Set();
  rows.forEach(r => JSON.parse(r.tags).forEach(t => tagSet.add(t)));
  res.json([...tagSet]);
});

// GET /api/trending — top 4 confessions by total reactions
app.get('/api/trending', (req, res) => {
  const rows = db.prepare('SELECT * FROM confessions').all();
  const confessions = rows.map(r => hydrateConfession(r, null));
  confessions.sort((a, b) => {
    const totalA = Object.values(a.reactions).reduce((x, y) => x + y, 0);
    const totalB = Object.values(b.reactions).reduce((x, y) => x + y, 0);
    return totalB - totalA;
  });
  res.json(confessions.slice(0, 4));
});

// ---------------------------------------------------------------------------
// POST /api/confessions — create a new confession
// body: { ownerId, category, tags: [], text }
// ---------------------------------------------------------------------------
app.post('/api/confessions', (req, res) => {
  const { ownerId, category, tags, text } = req.body;

  if (!ownerId || !text || !text.trim()) {
    return res.status(400).json({ error: 'ownerId and text are required.' });
  }

  const info = db.prepare(`
    INSERT INTO confessions (owner_id, category, tags, text)
    VALUES (?, ?, ?, ?)
  `).run(ownerId, category || 'Campus Life', JSON.stringify(Array.isArray(tags) ? tags : []), text.trim());

  const row = db.prepare('SELECT * FROM confessions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(hydrateConfession(row, ownerId));
});

// ---------------------------------------------------------------------------
// DELETE /api/confessions/:id — only the original (anonymous) poster can delete
// body/query: ownerId
// ---------------------------------------------------------------------------
app.delete('/api/confessions/:id', (req, res) => {
  const id = Number(req.params.id);
  const ownerId = req.body.ownerId || req.query.ownerId;

  const row = db.prepare('SELECT * FROM confessions WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Confession not found.' });

  if (!ownerId || ownerId !== row.owner_id) {
    return res.status(403).json({ error: 'You can only delete your own confession.' });
  }

  db.prepare('DELETE FROM confessions WHERE id = ?').run(id); // cascades reactions + comments
  res.json({ success: true, id });
});

// ---------------------------------------------------------------------------
// POST /api/confessions/:id/react — toggle/change a reaction
// body: { ownerId, type }
// ---------------------------------------------------------------------------
app.post('/api/confessions/:id/react', (req, res) => {
  const id = Number(req.params.id);
  const { ownerId, type } = req.body;

  if (!ownerId || !REACTION_TYPES.includes(type)) {
    return res.status(400).json({ error: 'ownerId and a valid reaction type are required.' });
  }

  const confession = db.prepare('SELECT id FROM confessions WHERE id = ?').get(id);
  if (!confession) return res.status(404).json({ error: 'Confession not found.' });

  const existing = db.prepare('SELECT type FROM reactions WHERE confession_id = ? AND owner_id = ?').get(id, ownerId);

  if (existing && existing.type === type) {
    db.prepare('DELETE FROM reactions WHERE confession_id = ? AND owner_id = ?').run(id, ownerId);
  } else if (existing) {
    db.prepare('UPDATE reactions SET type = ? WHERE confession_id = ? AND owner_id = ?').run(type, id, ownerId);
  } else {
    db.prepare('INSERT INTO reactions (confession_id, owner_id, type) VALUES (?, ?, ?)').run(id, ownerId, type);
  }

  const row = db.prepare('SELECT * FROM confessions WHERE id = ?').get(id);
  res.json(hydrateConfession(row, ownerId));
});

// ---------------------------------------------------------------------------
// POST /api/confessions/:id/comments — add a comment
// body: { text }
// ---------------------------------------------------------------------------
app.post('/api/confessions/:id/comments', (req, res) => {
  const id = Number(req.params.id);
  const { text } = req.body;

  if (!text || !text.trim()) return res.status(400).json({ error: 'Comment text is required.' });

  const confession = db.prepare('SELECT id FROM confessions WHERE id = ?').get(id);
  if (!confession) return res.status(404).json({ error: 'Confession not found.' });

  const who = `Anon #${Math.floor(100 + Math.random() * 900)}`;
  db.prepare('INSERT INTO comments (confession_id, who, text) VALUES (?, ?, ?)').run(id, who, text.trim());

  const row = db.prepare('SELECT * FROM confessions WHERE id = ?').get(id);
  res.status(201).json(hydrateConfession(row, req.body.ownerId));
});

// ---------------------------------------------------------------------------
// POST /api/confessions/:id/report — flag a confession for moderator review
// ---------------------------------------------------------------------------
app.post('/api/confessions/:id/report', (req, res) => {
  const id = Number(req.params.id);
  const confession = db.prepare('SELECT id FROM confessions WHERE id = ?').get(id);
  if (!confession) return res.status(404).json({ error: 'Confession not found.' });

  db.prepare('UPDATE confessions SET report_count = report_count + 1 WHERE id = ?').run(id);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Communities — created by users, deletable only by their creator.
// GET  /api/communities              list all + joined state + isOwner flag
// POST /api/communities              create { ownerId, name }
// DELETE /api/communities/:id        delete (creator only)
// POST /api/communities/:id/toggle   join / leave
// ---------------------------------------------------------------------------
app.get('/api/communities', (req, res) => {
  const { ownerId } = req.query;
  const communities = db.prepare('SELECT * FROM communities ORDER BY id DESC').all();
  const joined = ownerId
    ? new Set(db.prepare('SELECT community_id FROM joined_communities WHERE owner_id = ?').all(ownerId).map(r => r.community_id))
    : new Set();

  res.json(communities.map(c => ({
    id: c.id,
    name: c.name,
    createdAt: c.created_at,
    joined: joined.has(c.id),
    isOwner: !!ownerId && ownerId === c.owner_id
  })));
});

app.post('/api/communities', (req, res) => {
  const { ownerId, name } = req.body;
  if (!ownerId || !name || !name.trim()) {
    return res.status(400).json({ error: 'ownerId and name are required.' });
  }

  const existing = db.prepare('SELECT id FROM communities WHERE name = ?').get(name.trim());
  if (existing) {
    return res.status(409).json({ error: 'A community with that name already exists.' });
  }

  const info = db.prepare('INSERT INTO communities (name, owner_id) VALUES (?, ?)').run(name.trim(), ownerId);
  const row = db.prepare('SELECT * FROM communities WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ id: row.id, name: row.name, createdAt: row.created_at, joined: false, isOwner: true });
});

app.delete('/api/communities/:id', (req, res) => {
  const id = Number(req.params.id);
  const ownerId = req.body.ownerId || req.query.ownerId;

  const row = db.prepare('SELECT * FROM communities WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Community not found.' });

  if (!ownerId || ownerId !== row.owner_id) {
    return res.status(403).json({ error: 'You can only delete a community you created.' });
  }

  db.prepare('DELETE FROM communities WHERE id = ?').run(id); // cascades joined_communities
  res.json({ success: true, id });
});

app.post('/api/communities/:id/toggle', (req, res) => {
  const id = Number(req.params.id);
  const { ownerId } = req.body;
  if (!ownerId) return res.status(400).json({ error: 'ownerId is required.' });

  const community = db.prepare('SELECT id FROM communities WHERE id = ?').get(id);
  if (!community) return res.status(404).json({ error: 'Community not found.' });

  const existing = db.prepare('SELECT 1 FROM joined_communities WHERE owner_id = ? AND community_id = ?').get(ownerId, id);
  if (existing) {
    db.prepare('DELETE FROM joined_communities WHERE owner_id = ? AND community_id = ?').run(ownerId, id);
  } else {
    db.prepare('INSERT INTO joined_communities (owner_id, community_id) VALUES (?, ?)').run(ownerId, id);
  }
  res.json({ joined: !existing });
});

// ---------------------------------------------------------------------------
// Polls — created by users, deletable only by their creator.
// Multiple polls can be open at the same time.
// GET  /api/polls                    list all polls with options + voted state
// POST /api/polls                    create { ownerId, question, options: [] }
// DELETE /api/polls/:id               delete (creator only)
// POST /api/polls/:id/vote           vote once { ownerId, optionId }
// ---------------------------------------------------------------------------
function hydratePoll(poll, ownerId) {
  const options = db.prepare('SELECT * FROM poll_options WHERE poll_id = ?').all(poll.id);
  const voted = ownerId
    ? !!db.prepare('SELECT 1 FROM poll_votes WHERE poll_id = ? AND owner_id = ?').get(poll.id, ownerId)
    : false;

  return {
    id: poll.id,
    question: poll.question,
    createdAt: poll.created_at,
    options: options.map(o => ({ id: o.id, label: o.label, votes: o.votes })),
    voted,
    isOwner: !!ownerId && ownerId === poll.owner_id
  };
}

app.get('/api/polls', (req, res) => {
  const { ownerId } = req.query;
  const polls = db.prepare('SELECT * FROM polls ORDER BY id DESC').all();
  res.json(polls.map(p => hydratePoll(p, ownerId)));
});

app.post('/api/polls', (req, res) => {
  const { ownerId, question, options } = req.body;

  if (!ownerId || !question || !question.trim()) {
    return res.status(400).json({ error: 'ownerId and question are required.' });
  }
  const cleanOptions = Array.isArray(options)
    ? options.map(o => (o || '').toString().trim()).filter(Boolean)
    : [];
  if (cleanOptions.length < 2) {
    return res.status(400).json({ error: 'At least 2 non-empty options are required.' });
  }

  const pollInfo = db.prepare('INSERT INTO polls (question, owner_id) VALUES (?, ?)').run(question.trim(), ownerId);
  const pollId = pollInfo.lastInsertRowid;

  const insertOption = db.prepare('INSERT INTO poll_options (poll_id, label, votes) VALUES (?, ?, 0)');
  cleanOptions.forEach(label => insertOption.run(pollId, label));

  const row = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  res.status(201).json(hydratePoll(row, ownerId));
});

app.delete('/api/polls/:id', (req, res) => {
  const id = Number(req.params.id);
  const ownerId = req.body.ownerId || req.query.ownerId;

  const row = db.prepare('SELECT * FROM polls WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Poll not found.' });

  if (!ownerId || ownerId !== row.owner_id) {
    return res.status(403).json({ error: 'You can only delete a poll you created.' });
  }

  db.prepare('DELETE FROM polls WHERE id = ?').run(id); // cascades poll_options + poll_votes
  res.json({ success: true, id });
});

app.post('/api/polls/:id/vote', (req, res) => {
  const pollId = Number(req.params.id);
  const { ownerId, optionId } = req.body;
  if (!ownerId || !optionId) return res.status(400).json({ error: 'ownerId and optionId are required.' });

  const already = db.prepare('SELECT 1 FROM poll_votes WHERE poll_id = ? AND owner_id = ?').get(pollId, ownerId);
  if (already) return res.status(409).json({ error: 'You already voted in this poll.' });

  const option = db.prepare('SELECT * FROM poll_options WHERE id = ? AND poll_id = ?').get(optionId, pollId);
  if (!option) return res.status(404).json({ error: 'Poll option not found.' });

  db.prepare('UPDATE poll_options SET votes = votes + 1 WHERE id = ?').run(optionId);
  db.prepare('INSERT INTO poll_votes (poll_id, owner_id) VALUES (?, ?)').run(pollId, ownerId);

  const row = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  res.json(hydratePoll(row, ownerId));
});

// ---------------------------------------------------------------------------
// 404 + error handlers
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Whisper Wall API running on port ${PORT}`);
});

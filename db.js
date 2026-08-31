// Postgres database layer. On Railway, add a Postgres plugin to your
// project and it will inject DATABASE_URL automatically — no manual setup
// needed beyond running the schema below once (this file does it on boot).

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set. Add a Postgres database in Railway (or set it locally) before starting.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway's internal Postgres URL does not require SSL; its public/proxy
  // URL does. This works for both without needing a separate flag.
  ssl: process.env.DATABASE_URL?.includes('railway') || process.env.PGSSLMODE === 'require'
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected Postgres pool error:', err.message);
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      title TEXT,
      mode TEXT NOT NULL DEFAULT 'chat', -- 'chat' | 'prompt-generator'
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL, -- 'user' | 'assistant'
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS images (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,             -- 'generate' | 'edit'
      prompt TEXT NOT NULL,
      provider TEXT NOT NULL,         -- 'alibaba' | 'cloudflare' | 'pixazo' | 'transloadit'
      model TEXT,
      source_image_url TEXT,          -- original image, for edits
      provider_image_url TEXT,        -- the provider's (often temporary) URL
      imgbb_url TEXT,                 -- permanent transloaded URL
      imgbb_thumb_url TEXT,
      imgbb_delete_url TEXT,
      parameters JSONB,               -- extra params used
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id SERIAL PRIMARY KEY,
      module_key TEXT NOT NULL DEFAULT 'generate', -- 'generate' | 'edit'
      headline TEXT NOT NULL,                       -- shown in the dropdown
      full_prompt TEXT NOT NULL,                     -- filled into the prompt box
      sub_category TEXT,
      tags TEXT[] DEFAULT '{}',
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Building blocks for the "Prompt Generator" tab (subject / style /
    -- lighting / mood / tag pickers + the Manage Data admin panel).
    CREATE TABLE IF NOT EXISTS prompt_data (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('subject','style','lighting','mood','tag')),
      value TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_images_type ON images(type);
    CREATE INDEX IF NOT EXISTS idx_prompts_module ON prompts(module_key);
    CREATE INDEX IF NOT EXISTS idx_prompt_data_type ON prompt_data(type);
  `);
  console.log('✅ Postgres schema ready');
}

// ── Conversations / messages ──────────────────────────────────────────
async function createConversation(mode = 'chat', title = null) {
  const { rows } = await pool.query(
    'INSERT INTO conversations (mode, title) VALUES ($1, $2) RETURNING id',
    [mode, title]
  );
  return rows[0].id;
}

async function getConversation(id) {
  const { rows } = await pool.query('SELECT * FROM conversations WHERE id = $1', [id]);
  return rows[0] || null;
}

async function listConversations() {
  const { rows } = await pool.query('SELECT * FROM conversations ORDER BY id DESC');
  return rows;
}

async function addMessage(conversationId, role, content) {
  await pool.query(
    'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
    [conversationId, role, content]
  );
}

async function getMessages(conversationId) {
  const { rows } = await pool.query(
    'SELECT role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY id ASC',
    [conversationId]
  );
  return rows;
}

// ── Images ───────────────────────────────────────────────────────────
async function saveImage(row) {
  const { rows } = await pool.query(
    `INSERT INTO images
      (type, prompt, provider, model, source_image_url, provider_image_url, imgbb_url, imgbb_thumb_url, imgbb_delete_url, parameters)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      row.type,
      row.prompt,
      row.provider,
      row.model || null,
      row.source_image_url || null,
      row.provider_image_url || null,
      row.imgbb_url || null,
      row.imgbb_thumb_url || null,
      row.imgbb_delete_url || null,
      row.parameters ? JSON.stringify(row.parameters) : null,
    ]
  );
  return rows[0].id;
}

async function listImages({ type, limit = 50, offset = 0 } = {}) {
  if (type) {
    const { rows } = await pool.query(
      'SELECT * FROM images WHERE type = $1 ORDER BY id DESC LIMIT $2 OFFSET $3',
      [type, limit, offset]
    );
    return rows;
  }
  const { rows } = await pool.query(
    'SELECT * FROM images ORDER BY id DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

async function getImage(id) {
  const { rows } = await pool.query('SELECT * FROM images WHERE id = $1', [id]);
  return rows[0] || null;
}

async function deleteImage(id) {
  const { rowCount } = await pool.query('DELETE FROM images WHERE id = $1', [id]);
  return rowCount;
}

// ── Prompts (saved-prompt dropdown; rows come from your own SQL inserts) ──
async function listPrompts({ moduleKey } = {}) {
  if (moduleKey) {
    const { rows } = await pool.query(
      `SELECT id, module_key, headline, full_prompt, sub_category, tags
       FROM prompts WHERE is_active = true AND module_key = $1
       ORDER BY sort_order ASC, id ASC`,
      [moduleKey]
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT id, module_key, headline, full_prompt, sub_category, tags
     FROM prompts WHERE is_active = true
     ORDER BY sort_order ASC, id ASC`
  );
  return rows;
}

// ── Saved prompts admin (create/delete for the dropdown) ──────────────
async function createPrompt({ moduleKey = 'generate', headline, fullPrompt, subCategory = null, tags = [], sortOrder = 0 }) {
  const { rows } = await pool.query(
    `INSERT INTO prompts (module_key, headline, full_prompt, sub_category, tags, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, module_key, headline, full_prompt, sub_category, tags`,
    [moduleKey, headline, fullPrompt, subCategory, tags, sortOrder]
  );
  return rows[0];
}

// Insert, or overwrite in place (same id, keeps sort_order) if a prompt with
// the same module_key + headline already exists. Used by both the quick
// "Save prompt" button and the Manage Data card, so re-saving under a name
// you've already used updates it instead of creating a duplicate.
async function upsertPrompt({ moduleKey = 'generate', headline, fullPrompt, subCategory = null, tags = [] }) {
  const existing = await pool.query(
    'SELECT id FROM prompts WHERE module_key = $1 AND headline = $2 LIMIT 1',
    [moduleKey, headline]
  );
  if (existing.rows.length) {
    const { rows } = await pool.query(
      `UPDATE prompts SET full_prompt = $1, sub_category = $2, tags = $3
       WHERE id = $4
       RETURNING id, module_key, headline, full_prompt, sub_category, tags`,
      [fullPrompt, subCategory, tags, existing.rows[0].id]
    );
    return { ...rows[0], overwritten: true };
  }
  const row = await createPrompt({ moduleKey, headline, fullPrompt, subCategory, tags });
  return { ...row, overwritten: false };
}

async function deletePrompt(id) {
  const { rowCount } = await pool.query('DELETE FROM prompts WHERE id = $1', [id]);
  return rowCount;
}

// ── Prompt data (subject/style/lighting/mood/tag building blocks) ─────
const PROMPT_DATA_TYPE_TO_KEY = {
  subject: 'subjects',
  style: 'styles',
  lighting: 'lightings',
  mood: 'moods',
  tag: 'tags',
};

async function listPromptData() {
  const { rows } = await pool.query(
    'SELECT id, type, value FROM prompt_data ORDER BY type ASC, id ASC'
  );
  const grouped = { subjects: [], styles: [], lightings: [], moods: [], tags: [] };
  for (const row of rows) {
    const key = PROMPT_DATA_TYPE_TO_KEY[row.type];
    if (key) grouped[key].push({ id: row.id, value: row.value });
  }
  return grouped;
}

async function addPromptDataItem(type, value) {
  if (!PROMPT_DATA_TYPE_TO_KEY[type]) {
    throw new Error(`type must be one of: ${Object.keys(PROMPT_DATA_TYPE_TO_KEY).join(', ')}`);
  }
  const { rows } = await pool.query(
    'INSERT INTO prompt_data (type, value) VALUES ($1, $2) RETURNING id, type, value',
    [type, value]
  );
  return rows[0];
}

async function deletePromptDataItem(id) {
  const { rowCount } = await pool.query('DELETE FROM prompt_data WHERE id = $1', [id]);
  return rowCount;
}

async function getPromptDataByIds(ids = []) {
  if (!ids.length) return [];
  const { rows } = await pool.query(
    'SELECT id, type, value FROM prompt_data WHERE id = ANY($1::int[])',
    [ids]
  );
  return rows;
}

module.exports = {
  pool,
  init,
  createConversation,
  getConversation,
  listConversations,
  addMessage,
  getMessages,
  saveImage,
  listImages,
  getImage,
  deleteImage,
  listPrompts,
  createPrompt,
  upsertPrompt,
  deletePrompt,
  listPromptData,
  addPromptDataItem,
  deletePromptDataItem,
  getPromptDataByIds,
};
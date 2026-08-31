require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const db = require('./db');
const chatRoutes = require('./routes/chat');
const imageRoutes = require('./routes/image');
const agentRoutes = require('./routes/agent');
const billingRoutes = require('./routes/billing');
const historyRoutes = require('./routes/history');
const promptsRoutes = require('./routes/prompts');
const promptDataRoutes = require('./routes/prompt-data');
const promptGenRoutes = require('./routes/prompt-gen');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    providers: {
      alibaba: !!(process.env.ALIBABA_API_KEY && process.env.ALIBABA_WORKSPACE_ID),
      cloudflare: !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID),
      pixazo: !!process.env.PIXAZO_API_KEY,
      transloadit: !!(process.env.TRANSLOADIT_AUTH_KEY && process.env.TRANSLOADIT_AUTH_SECRET),
      imgbb: !!process.env.IMGBB_API_KEY,
      database: !!process.env.DATABASE_URL,
    },
  });
});

app.use('/api/chat', chatRoutes);
app.use('/api/image', imageRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/prompts', promptsRoutes);
app.use('/api/prompt-data', promptDataRoutes);
app.use('/api/prompt', promptGenRoutes);

// Fallback 404 for unmatched API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

async function start() {
  try {
    await db.init();
  } catch (err) {
    console.error('❌ Failed to initialize database schema:', err.message);
    console.error('   Server will keep running, but DB-backed routes (chat, image history) will fail until this is resolved.');
  }

  app.listen(PORT, () => {
    console.log(`✅ Simple AI server listening on port ${PORT}`);
  });
}

start();
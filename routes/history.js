const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/history/images?type=generate|edit&limit=&offset=
router.get('/images', async (req, res) => {
  try {
    const { type, limit, offset } = req.query;
    const rows = await db.listImages({
      type: type && ['generate', 'edit'].includes(type) ? type : undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/history/images/:id
router.get('/images/:id', async (req, res) => {
  try {
    const row = await db.getImage(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/history/images/:id
// Note: only removes the DB record; the image stays on imgbb unless you
// separately call its delete_url (imgbb_delete_url on the row).
router.delete('/images/:id', async (req, res) => {
  try {
    const changes = await db.deleteImage(req.params.id);
    if (!changes) return res.status(404).json({ error: 'not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/history/conversations
router.get('/conversations', async (req, res) => {
  try {
    res.json(await db.listConversations());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

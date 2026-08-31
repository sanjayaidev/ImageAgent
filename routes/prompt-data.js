const express = require('express');
const db = require('../db');

const router = express.Router();

const VALID_TYPES = ['subject', 'style', 'lighting', 'mood', 'tag'];

// GET /api/prompt-data
// Returns { subjects: [], styles: [], lightings: [], moods: [], tags: [] }
// Powers the Prompt Generator tab's dropdowns/tags + the Manage Data panel.
router.get('/', async (req, res) => {
  try {
    const data = await db.listPromptData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prompt-data
// body: { type: 'subject'|'style'|'lighting'|'mood'|'tag', value }
router.post('/', async (req, res) => {
  try {
    const { type, value } = req.body || {};
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    if (!value || !value.trim()) {
      return res.status(400).json({ error: 'value is required' });
    }
    const row = await db.addPromptDataItem(type, value.trim());
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/prompt-data/:id
router.delete('/:id', async (req, res) => {
  try {
    const rowCount = await db.deletePromptDataItem(req.params.id);
    if (!rowCount) return res.status(404).json({ error: 'item not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/prompts?module=generate|edit
// Populates the "saved prompt" dropdown.
router.get('/', async (req, res) => {
  try {
    const { module: moduleKey } = req.query;
    if (moduleKey && !['generate', 'edit'].includes(moduleKey)) {
      return res.status(400).json({ error: "module must be 'generate' or 'edit'" });
    }
    const rows = await db.listPrompts({ moduleKey });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prompts
// body: { module: 'generate'|'edit', headline, full_prompt, sub_category?, tags? }
// Upserts by (module, headline): saving under a name you've already used
// overwrites that row instead of creating a duplicate.
router.post('/', async (req, res) => {
  try {
    const { module: moduleKey = 'generate', headline, full_prompt: fullPrompt, sub_category: subCategory, tags } = req.body || {};
    if (!['generate', 'edit'].includes(moduleKey)) {
      return res.status(400).json({ error: "module must be 'generate' or 'edit'" });
    }
    if (!headline || !headline.trim()) {
      return res.status(400).json({ error: 'headline is required' });
    }
    if (!fullPrompt || !fullPrompt.trim()) {
      return res.status(400).json({ error: 'full_prompt is required' });
    }
    const row = await db.upsertPrompt({
      moduleKey,
      headline: headline.trim(),
      fullPrompt: fullPrompt.trim(),
      subCategory: subCategory || null,
      tags: Array.isArray(tags) ? tags : [],
    });
    res.status(row.overwritten ? 200 : 201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/prompts/:id
router.delete('/:id', async (req, res) => {
  try {
    const rowCount = await db.deletePrompt(req.params.id);
    if (!rowCount) return res.status(404).json({ error: 'prompt not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
const express = require('express');
const TransloaditProvider = require('../providers/transloadit');
const { requireEnv } = require('../services/save-image');

const router = express.Router();

function getTransloadit() {
  return new TransloaditProvider(requireEnv('TRANSLOADIT_AUTH_KEY'), requireEnv('TRANSLOADIT_AUTH_SECRET'));
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// GET /api/billing?month=YYYY-MM
// Defaults to the current (still-accruing) month. Requires the Transloadit
// Auth Key to have the `billing:read` scope enabled.
router.get('/', async (req, res) => {
  try {
    const month = (req.query.month && String(req.query.month).trim()) || currentMonth();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month must be in YYYY-MM format' });
    }

    const transloadit = getTransloadit();
    const bill = await transloadit.getBill(month);
    res.json(bill);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

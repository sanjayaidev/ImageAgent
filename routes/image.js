const express = require('express');
const TransloaditProvider = require('../providers/transloadit');
const catalog = require('../providers/model-catalog');
const { uploadToImgbb } = require('../services/imgbb');
const { transloadAndSave, requireEnv } = require('../services/save-image');

const router = express.Router();

// Image generation/editing is intentionally limited to Transloadit's
// nano-banana family + gpt-image-2 — see providers/model-catalog.js.
const GENERATE_PROVIDERS = ['transloadit'];
const EDIT_PROVIDERS = ['transloadit'];

// GET /api/image/catalog?type=generate|edit
// Powers the dynamic provider/model/param dropdowns on the frontend —
// only the fields a given model actually supports are ever shown.
router.get('/catalog', (req, res) => {
  const type = req.query.type === 'edit' ? 'edit' : 'generate';
  res.json(type === 'edit' ? catalog.getEditCatalog() : catalog.getGenerateCatalog());
});

function getTransloadit() {
  return new TransloaditProvider(requireEnv('TRANSLOADIT_AUTH_KEY'), requireEnv('TRANSLOADIT_AUTH_SECRET'));
}

// POST /api/image/generate
// body: { prompt, provider?: transloadit, model?, ...providerParams }
router.post('/generate', async (req, res) => {
  try {
    const {
      prompt, provider = 'transloadit', model,
      width, height, seed, aspect_ratio, format, style, num_outputs,
    } = req.body || {};
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt is required' });
    if (!GENERATE_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `provider must be one of: ${GENERATE_PROVIDERS.join(', ')}` });
    }

    const transloadit = getTransloadit();
    const usedModel = catalog.TRANSLOADIT_GENERATE_MODELS.includes(model) ? model : catalog.TRANSLOADIT_DEFAULT_MODEL;
    // When size_mode is 'custom', use width/height; otherwise use aspect_ratio
    const arValue = req.body.size_mode === 'custom' ? undefined : aspect_ratio;
    const whValue = req.body.size_mode === 'custom' ? { width, height } : {};
    const result = await transloadit.generateImage(prompt, {
      model: usedModel,
      aspect_ratio: arValue,
      seed,
      format,
      style,
      num_outputs,
      ...whValue,
    });
    const providerImageUrl = result.imageUrl;

    const saved = await transloadAndSave({
      type: 'generate',
      prompt,
      provider,
      model: usedModel,
      providerImageUrl,
      parameters: { width, height, seed, aspect_ratio, format, style, num_outputs },
    });

    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/image/edit
// body: { prompt, image_url?, image_data_url?, provider?: transloadit, model?, ...providerParams }
// Either image_url (a public URL) or image_data_url (a base64 data: URL,
// e.g. from a file upload) must be provided. If only image_data_url is
// given, it's transloaded to imgbb first so Transloadit (which fetches the
// source over HTTP) gets a public URL.
router.post('/edit', async (req, res) => {
  try {
    const { prompt, image_url, image_data_url, provider = 'transloadit', model, width, height, seed, aspect_ratio, format } = req.body || {};
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'edit instruction (prompt) is required' });
    if ((!image_url || !image_url.trim()) && (!image_data_url || !image_data_url.trim())) {
      return res.status(400).json({ error: 'image_url or image_data_url is required' });
    }
    if (!EDIT_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `provider must be one of: ${EDIT_PROVIDERS.join(', ')}` });
    }

    // Resolve the source image to a public URL — Transloadit's
    // /http/import robot can't accept a base64 data URI directly, so for
    // an uploaded file we always host it on imgbb first.
    let sourceUrl = image_url && image_url.trim();
    if (!sourceUrl) {
      const imgbbKey = requireEnv('IMGBB_API_KEY');
      const uploadedSource = await uploadToImgbb(imgbbKey, { dataUrl: image_data_url });
      sourceUrl = uploadedSource.url;
    }

    const transloadit = getTransloadit();
    const usedModel = catalog.TRANSLOADIT_EDIT_MODELS.includes(model) ? model : catalog.TRANSLOADIT_DEFAULT_MODEL;
    // When size_mode is 'custom', use width/height; otherwise use aspect_ratio
    const arValue = req.body.size_mode === 'custom' ? undefined : aspect_ratio;
    const whValue = req.body.size_mode === 'custom' ? { width, height } : {};
    const result = await transloadit.editImage(prompt, sourceUrl, {
      model: usedModel,
      aspect_ratio: arValue,
      seed,
      format,
      ...whValue,
    });
    const providerImageUrl = result.imageUrl;

    const saved = await transloadAndSave({
      type: 'edit',
      prompt,
      provider,
      model: usedModel,
      sourceImageUrl: sourceUrl,
      providerImageUrl,
      parameters: { width, height, seed, aspect_ratio, format },
    });

    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

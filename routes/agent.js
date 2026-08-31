const express = require('express');
const AlibabaProvider = require('../providers/alibaba');
const TransloaditProvider = require('../providers/transloadit');
const { parseImageRequest } = require('../providers/qwen-agent');
const { transloadAndSave, requireEnv } = require('../services/save-image');

const router = express.Router();

function getAlibaba() {
  return new AlibabaProvider(
    requireEnv('ALIBABA_API_KEY'),
    requireEnv('ALIBABA_WORKSPACE_ID'),
    process.env.ALIBABA_REGION
  );
}
function getTransloadit() {
  return new TransloaditProvider(requireEnv('TRANSLOADIT_AUTH_KEY'), requireEnv('TRANSLOADIT_AUTH_SECRET'));
}

// POST /api/agent/generate
// body: { message } — a single free-text line, e.g.
//   "a lighthouse at dusk, storm clouds, 16:9"
//   "portrait of a fox in the snow, 1024x1536, gpt image"
// Qwen3 reads it, splits out the visual prompt from any size/aspect-ratio/
// model/style directives, and the resulting image is generated with
// Transloadit (nano-banana family or gpt-image-2 only).
router.post('/generate', async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || !message.trim()) return res.status(400).json({ error: 'message is required' });

    const alibaba = getAlibaba();
    const parsed = await parseImageRequest(alibaba, message.trim());

    const transloadit = getTransloadit();
    const isCustomSize = !!(parsed.width && parsed.height);
    const result = await transloadit.generateImage(parsed.prompt, {
      model: parsed.model,
      aspect_ratio: isCustomSize ? undefined : parsed.aspect_ratio,
      width: isCustomSize ? parsed.width : undefined,
      height: isCustomSize ? parsed.height : undefined,
      style: parsed.style || undefined,
      format: parsed.format || undefined,
      num_outputs: parsed.num_outputs || undefined,
    });

    const saved = await transloadAndSave({
      type: 'generate',
      prompt: parsed.prompt,
      provider: 'transloadit',
      model: parsed.model,
      providerImageUrl: result.imageUrl,
      parameters: {
        aspect_ratio: parsed.aspect_ratio,
        width: parsed.width,
        height: parsed.height,
        dpi: parsed.dpi,
        style: parsed.style,
        format: parsed.format,
        num_outputs: parsed.num_outputs,
        agent_original_message: message,
      },
    });

    res.json({ ...saved, agent: parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

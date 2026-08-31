const express = require('express');
const AlibabaProvider = require('../providers/alibaba');
const TransloaditProvider = require('../providers/transloadit');
const { parseImageRequest } = require('../providers/qwen-agent');
const { uploadToImgbb } = require('../services/imgbb');
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
// body: { message, image_url?, image_data_url? } — a single free-text line,
// e.g. "a lighthouse at dusk, storm clouds, 16:9" or
// "portrait of a fox in the snow, 1024x1536, gpt image", optionally with a
// reference image attached (image_url for a public URL, or image_data_url
// for a base64 data: URL from a file upload). Qwen3 reads the message and
// splits out the visual prompt from any size/aspect-ratio/model/style
// directives; if a reference image is attached, the result is an edit of
// that image instead of a fresh generation.
router.post('/generate', async (req, res) => {
  try {
    const { message, image_url, image_data_url } = req.body || {};
    if (!message || !message.trim()) return res.status(400).json({ error: 'message is required' });

    // Resolve the reference image (if any) to a public URL up front —
    // Transloadit's /http/import robot can't accept a base64 data URI
    // directly, so an uploaded file is hosted on imgbb first.
    let sourceUrl = image_url && image_url.trim();
    if (!sourceUrl && image_data_url && image_data_url.trim()) {
      const imgbbKey = requireEnv('IMGBB_API_KEY');
      const uploadedSource = await uploadToImgbb(imgbbKey, { dataUrl: image_data_url });
      sourceUrl = uploadedSource.url;
    }

    const alibaba = getAlibaba();
    const parsed = await parseImageRequest(alibaba, message.trim());

    const transloadit = getTransloadit();
    const isCustomSize = !!(parsed.width && parsed.height);
    const sizeOptions = {
      model: parsed.model,
      aspect_ratio: isCustomSize ? undefined : parsed.aspect_ratio,
      width: isCustomSize ? parsed.width : undefined,
      height: isCustomSize ? parsed.height : undefined,
      style: parsed.style || undefined,
      format: parsed.format || undefined,
      num_outputs: parsed.num_outputs || undefined,
    };

    const result = sourceUrl
      ? await transloadit.editImage(parsed.prompt, sourceUrl, sizeOptions)
      : await transloadit.generateImage(parsed.prompt, sizeOptions);

    const saved = await transloadAndSave({
      type: sourceUrl ? 'edit' : 'generate',
      prompt: parsed.prompt,
      provider: 'transloadit',
      model: parsed.model,
      sourceImageUrl: sourceUrl || undefined,
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

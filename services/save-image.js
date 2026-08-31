// Shared by routes/image.js and routes/agent.js: transloads a provider
// result (URL or base64 data URL) to imgbb and persists a history row.

const { uploadToImgbb } = require('./imgbb');
const db = require('../db');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured on the server`);
  return v;
}

// Transloads a provider result (URL or base64 data URL) to imgbb and
// persists a history row. Returns the saved row.
async function transloadAndSave({ type, prompt, provider, model, sourceImageUrl, providerImageUrl, dataUrl, parameters }) {
  const imgbbKey = requireEnv('IMGBB_API_KEY');
  const uploaded = await uploadToImgbb(imgbbKey, dataUrl ? { dataUrl } : { imageUrl: providerImageUrl });

  const id = await db.saveImage({
    type,
    prompt,
    provider,
    model,
    source_image_url: sourceImageUrl,
    provider_image_url: providerImageUrl || null,
    imgbb_url: uploaded.url,
    imgbb_thumb_url: uploaded.thumbUrl,
    imgbb_delete_url: uploaded.deleteUrl,
    parameters,
  });

  return db.getImage(id);
}

module.exports = { transloadAndSave, requireEnv };

// Pixazo Gateway provider wrapper — trimmed to image generation only.
// Auth: "Ocp-Apim-Subscription-Key" header (Azure APIM-style gateway)
// Free model: Flux 1 Schnell — synchronous, no polling needed.

const GATEWAY = 'https://gateway.pixazo.ai';
const IMAGE_PATH = '/flux-1-schnell/v1/getData';

class PixazoProvider {
  constructor(apiKey) {
    if (!apiKey) throw new Error('Pixazo API key is required');
    this.apiKey = apiKey;
  }

  _headers() {
    return {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': this.apiKey,
    };
  }

  _clean(body) {
    const out = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
    return out;
  }

  // Flux 1 Schnell — free, synchronous. Response has the finished image
  // URL directly as `output`.
  // params: { prompt, width, height, num_steps (max 8), seed }
  async generateImage(params = {}) {
    if (!params.prompt) throw new Error('prompt is required');

    const response = await fetch(`${GATEWAY}${IMAGE_PATH}`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(this._clean(params)),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error || !data.output) {
      throw new Error(`Pixazo Flux 1 Schnell error (${response.status}): ${data.message || data.error || 'no image returned'}`);
    }
    return data; // { output: '<image_url>', ... }
  }
}

PixazoProvider.IMAGE_MODEL = 'flux-1-schnell';

module.exports = PixazoProvider;

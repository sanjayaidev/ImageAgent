// Cloudflare Workers AI provider wrapper — trimmed to text-to-image only.
// Free tier: 10,000 Neurons/day, no credit card required.
// Model: @cf/black-forest-labs/flux-1-schnell

const BASE_URL = 'https://api.cloudflare.com/client/v4/accounts';
const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

class CloudflareProvider {
  constructor(apiToken, accountId) {
    if (!apiToken) throw new Error('Cloudflare API token is required');
    if (!accountId) throw new Error('Cloudflare Account ID is required');
    this.apiToken = apiToken;
    this.accountId = accountId;
  }

  _url(model) {
    return `${BASE_URL}/${this.accountId}/ai/run/${model}`;
  }

  _headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiToken}`,
    };
  }

  // text-to-image via Flux 1 Schnell — free.
  // params: { prompt, num_steps<=8, seed }
  // NOTE: this model only accepts prompt/steps/seed — no width/height.
  // Returns { imageDataUrl } — base64 JPEG as a data: URL.
  async textToImage(params = {}) {
    if (!params.prompt) throw new Error('prompt is required');

    const body = {
      prompt: params.prompt,
      steps: Math.min(Math.max(parseInt(params.num_steps) || 4, 1), 8),
    };
    if (params.seed !== undefined) body.seed = params.seed;

    const response = await fetch(this._url(IMAGE_MODEL), {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const detail = errBody?.errors?.[0]?.message || `HTTP ${response.status}`;
      throw new Error(`Cloudflare Flux 1 Schnell error: ${detail}`);
    }

    const data = await response.json();
    if (data?.errors?.length) {
      throw new Error(`Cloudflare Flux 1 Schnell error: ${data.errors[0]?.message || 'unknown error'}`);
    }
    const b64 = data?.result?.image;
    if (!b64) throw new Error('Cloudflare Flux 1 Schnell returned no image data');
    return { imageDataUrl: `data:image/jpeg;base64,${b64}` };
  }
}

CloudflareProvider.IMAGE_MODEL = IMAGE_MODEL;

module.exports = CloudflareProvider;

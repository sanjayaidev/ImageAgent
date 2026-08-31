// Transloadit provider wrapper — image generation AND editing via the
// 🤖 /image/generate Robot (https://transloadit.com/docs/robots/image-generate/).
//
// Auth: Auth Key + Auth Secret (from your Transloadit Workspace's
// Credentials page). The official SDK signs requests for you.
//
// NOTE: `transloadit` is now v4 (https://transloadit.com/docs/sdks/node-sdk/)
// — an ESM-only package. v3 hardcoded HMAC-SHA1 signing, which newer Auth
// Keys reject with INVALID_SIGNATURE ("...demands sha384 instead of
// sha1?"); v4 signs with SHA384 as Transloadit's API now expects. Since
// this project is CommonJS, the client is loaded via a cached dynamic
// import() rather than a top-level require().
//
// - Text-to-image: just a prompt, no input image.
// - Image editing: pass a source image URL — Transloadit imports it via the
//   /http/import Robot in the same Assembly, then feeds it into
//   /image/generate tagged `as: "image"`. Supported edit models (e.g.
//   google/nano-banana*) apply the prompt as an edit instruction to that
//   image, no mask required for general edits.
//
// Default model: google/nano-banana (per Transloadit's own Robot default).

const DEFAULT_MODEL = 'google/nano-banana';

// Cached so every provider instance reuses the same dynamic import instead
// of re-importing the ESM module on every request.
let transloaditModulePromise = null;
function loadTransloaditModule() {
  if (!transloaditModulePromise) transloaditModulePromise = import('transloadit');
  return transloaditModulePromise;
}

class TransloaditProvider {
  constructor(authKey, authSecret) {
    if (!authKey) throw new Error('Transloadit Auth Key is required');
    if (!authSecret) throw new Error('Transloadit Auth Secret is required');
    this.authKey = authKey;
    this.authSecret = authSecret;
    this._client = null;
  }

  async _getClient() {
    if (this._client) return this._client;
    const { Transloadit } = await loadTransloaditModule();
    this._client = new Transloadit({ authKey: this.authKey, authSecret: this.authSecret });
    return this._client;
  }

  // Runs an Assembly with a single /image/generate step (plus an optional
  // /http/import step feeding it, for edits) and returns the resulting
  // file's URL.
  async _runGenerate({ prompt, model, imageUrl, format, width, height, aspect_ratio, seed, style, num_outputs }) {
    if (!prompt || !prompt.trim()) throw new Error('prompt is required');

    const client = await this._getClient();

    const steps = {};
    const generateStep = {
      robot: '/image/generate',
      model: model || DEFAULT_MODEL,
      prompt,
      result: true,
    };
    if (format) generateStep.format = format;
    if (width) generateStep.width = width;
    if (height) generateStep.height = height;
    if (aspect_ratio) generateStep.aspect_ratio = aspect_ratio;
    if (seed !== undefined && seed !== null && seed !== '') generateStep.seed = seed;
    if (style) generateStep.style = style;
    if (num_outputs) generateStep.num_outputs = num_outputs;

    if (imageUrl) {
      steps[':original'] = { robot: '/http/import', url: imageUrl };
      generateStep.use = [{ name: ':original', as: 'image' }];
    }
    steps.generated = generateStep;

    let result;
    try {
      result = await client.createAssembly({
        params: { steps },
        waitForCompletion: true,
      });
    } catch (err) {
      // v4 throws ApiError with details under `.response` (v3 used
      // `.assembly.error` / a plain `.message`) — check both shapes so this
      // keeps working across SDK versions.
      const reason =
        err?.response?.message || err?.response?.error || err?.assembly?.error || err?.message || 'request failed';
      const assemblyId = err?.response?.assembly_id;
      throw new Error(`Transloadit error: ${reason}${assemblyId ? ` (assembly ${assemblyId})` : ''}`);
    }

    if (result?.error) {
      throw new Error(`Transloadit error: ${result.message || result.error}`);
    }

    const files = result?.results?.generated || [];
    if (!files.length) {
      throw new Error('Transloadit returned no generated image');
    }

    return {
      raw: result,
      imageUrl: files[0].ssl_url || files[0].url,
      assemblyId: result.assembly_id,
    };
  }

  // Text-to-image
  async generateImage(prompt, options = {}) {
    return this._runGenerate({ prompt, ...options });
  }

  // Image editing: options.imageUrl is required (single source image URL)
  async editImage(prompt, imageUrl, options = {}) {
    if (!imageUrl) throw new Error('imageUrl is required for Transloadit image editing');
    return this._runGenerate({ prompt, imageUrl, ...options });
  }

  // Retrieves account billing/usage data for a given YYYY-MM month via the
  // SDK's getBill(date) (GET /bill/{DATE}). The current (in-progress) month
  // can be queried too — invoice_id comes back null until the month closes
  // and the numbers are still accruing live.
  // NOTE: the Auth Key used must have the `billing:read` scope enabled
  // (Transloadit dashboard → API keys) or this call will be rejected.
  async getBill(date) {
    if (!date || !/^\d{4}-\d{2}$/.test(date)) throw new Error('date must be in YYYY-MM format');
    const client = await this._getClient();
    try {
      return await client.getBill(date);
    } catch (err) {
      const reason = err?.response?.message || err?.response?.error || err?.message || 'request failed';
      throw new Error(`Transloadit billing error: ${reason}`);
    }
  }
}

TransloaditProvider.DEFAULT_MODEL = DEFAULT_MODEL;

module.exports = TransloaditProvider;

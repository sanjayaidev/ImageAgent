// Alibaba Cloud Model Studio (DashScope) provider wrapper
// Trimmed down (from SanjayAIHub) to just what this server needs:
//   - chatCompletion  -> chat + prompt generation
//   - imageGeneration -> text-to-image AND image-to-image (editing) since
//                        Qwen-Image 3.0 unified both into one endpoint
//
// Chat uses the OpenAI-compatible endpoint, scoped to the user's workspace:
//   https://{workspace_id}.{region}.maas.aliyuncs.com/compatible-mode/v1/chat/completions
// Image generation/editing uses the native DashScope endpoint:
//   https://{workspace_id}.{region}.maas.aliyuncs.com/api/v1/...

const DEFAULT_REGION = 'ap-southeast-1'; // Singapore

class AlibabaProvider {
  constructor(apiKey, workspaceId, region = DEFAULT_REGION) {
    if (!apiKey) throw new Error('Alibaba API key is required');
    if (!workspaceId) throw new Error('Alibaba workspace_id is required');
    this.apiKey = apiKey;
    this.workspaceId = workspaceId;
    this.baseUrl = `https://${workspaceId}.${region}.maas.aliyuncs.com`;
    this.chatBaseUrl = `${this.baseUrl}/compatible-mode/v1`;
  }

  // messages: [{ role, content }]
  async chatCompletion(messages, options = {}) {
    const {
      model = 'qwen-plus',
      temperature = 0.7,
      max_tokens = 2048,
      top_p = 1,
      stream = false,
      enable_thinking,
    } = options;

    const payload = { model, messages, temperature, max_tokens, top_p, stream };
    if (enable_thinking !== undefined) payload.enable_thinking = enable_thinking;

    const response = await fetch(`${this.chatBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let detail = errorText;
      try {
        detail = JSON.parse(errorText).error?.message || errorText;
      } catch (_) {}
      throw new Error(`Alibaba chat error (${response.status}): ${detail}`);
    }

    return response.json();
  }

  // Text-to-image AND image-to-image (editing) via the DashScope
  // multimodal-generation endpoint. `images`: optional array of 1-3 image
  // URLs/base64 data URIs for editing. Leave empty for plain text-to-image.
  async imageGeneration(prompt, options = {}) {
    const {
      model = 'qwen-image-3.0-pro',
      images = [],
      size,
      n = 1,
      seed,
      negative_prompt,
      prompt_extend = true,
      watermark = false,
    } = options;

    if (!prompt || !prompt.trim()) throw new Error('prompt is required');
    if (images.length > 3) throw new Error('At most 3 reference images are supported for image-to-image');

    const content = images.filter(Boolean).map((img) => ({ image: img }));
    content.push({ text: prompt });

    const parameters = { prompt_extend: !!prompt_extend, watermark: !!watermark };
    if (size) parameters.size = size;
    if (n !== undefined && n !== null) parameters.n = parseInt(n) || 1;
    if (negative_prompt && negative_prompt.trim()) parameters.negative_prompt = negative_prompt;
    if (seed !== undefined && seed !== null && seed !== '') parameters.seed = parseInt(seed);

    const payload = {
      model,
      input: { messages: [{ role: 'user', content }] },
      parameters,
    };

    const response = await fetch(`${this.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.code) {
      const detail = data.message || data.output?.text || `HTTP ${response.status}`;
      throw new Error(`Alibaba image error (${data.code || response.status}): ${detail}`);
    }

    const urls = [];
    for (const choice of data?.output?.choices || []) {
      for (const item of choice?.message?.content || []) {
        if (item?.image) urls.push(item.image);
      }
    }

    data._imageUrls = urls;
    return data;
  }

  // Image editing = imageGeneration() with 1-3 reference images attached.
  // `imageUrl` may be a single URL/base64 string, or an array of up to 3.
  async imageEdit(prompt, imageUrl, options = {}) {
    if (!prompt || !prompt.trim()) throw new Error('prompt (edit instruction) is required');
    if (!imageUrl) throw new Error('imageUrl is required');

    const images = Array.isArray(imageUrl) ? imageUrl : [imageUrl];
    return this.imageGeneration(prompt, { ...options, images });
  }
}

// Default models
AlibabaProvider.DEFAULT_CHAT_MODEL = 'qwen-plus';
AlibabaProvider.DEFAULT_IMAGE_MODEL = 'qwen-image-3.0-pro';
AlibabaProvider.DEFAULT_EDIT_MODEL = 'qwen-image-edit-plus';

module.exports = AlibabaProvider;

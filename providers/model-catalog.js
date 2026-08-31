// providers/model-catalog.js
//
// Central catalog of providers/models/parameters for image GENERATE and
// EDIT, in the same shape as SanjayAIHub's modules/text-to-image.js:
// every tweakable knob is a `select`, `range`, or `checkbox` field, never
// free text. The frontend (public/js/adaptive-params.js) renders a form
// straight from whichever model's schema is active, so only the params a
// model actually supports are ever shown.
//
// Model lists / size presets for Alibaba are ported from
// https://github.com/sanjayaidev/SanjayAIHub (providers/alibaba-models.js,
// modules/text-to-image.js). Transloadit models/params are from
// https://transloadit.com/docs/robots/image-generate/.

// ── Alibaba (DashScope / Qwen-Image) ──────────────────────────────────
const ALIBABA_GENERATE_MODELS = [
  'qwen-image-2.0',       // default — "Qwen-Image 2"
  'qwen-image-2.0-pro',
  'qwen-image-3.0-pro',   // unified T2I + I2I, limited preview
  'qwen-image',
  'qwen-image-max',
  'qwen-image-plus',
  'wan2.6-t2i',
  'wan2.7-image-pro',
  'z-image-turbo',
];

const ALIBABA_EDIT_MODELS = [
  'qwen-image-edit-plus', // default
  'qwen-image-edit',
  'qwen-image-edit-max',
  'qwen-image-3.0-pro',   // also supports image-to-image (unified endpoint)
];

const ALIBABA_DEFAULT_GENERATE_MODEL = 'qwen-image-2.0';
const ALIBABA_DEFAULT_EDIT_MODEL = 'qwen-image-edit-plus';

// qwen-image-3.0-pro accepts any "W*H" between 512*512 and 2048*2048 (or
// no size at all, letting the model choose). Other Qwen-Image models are
// restricted to a fixed, verified set of sizes.
const ALIBABA_SIZE_OPTIONS_3PRO = [
  { value: '', label: 'Auto (model decides)' },
  { value: '1024*1024', label: 'Square (1024×1024)' },
  { value: '1328*1328', label: 'Square (1328×1328)' },
  { value: '1664*928', label: 'Landscape 16:9 (1664×928)' },
  { value: '1472*1104', label: 'Landscape 4:3 (1472×1104)' },
  { value: '1104*1472', label: 'Portrait 3:4 (1104×1472)' },
  { value: '928*1664', label: 'Portrait 9:16 (928×1664)' },
  { value: '2048*2048', label: 'Square Max (2048×2048)' },
];

const ALIBABA_SIZE_OPTIONS_STANDARD = [
  { value: '1328*1328', label: 'Square (1328×1328)' },
  { value: '1664*928', label: 'Landscape 16:9 (1664×928)' },
  { value: '1472*1104', label: 'Landscape 4:3 (1472×1104)' },
  { value: '1104*1472', label: 'Portrait 3:4 (1104×1472)' },
  { value: '928*1664', label: 'Portrait 9:16 (928×1664)' },
];

const ALIBABA_VALID_SIZES = ['1024*1024', '1328*1328', '1664*928', '1472*1104', '1104*1472', '928*1664', '2048*2048'];

function alibabaSchema(model) {
  const is3Pro = model === 'qwen-image-3.0-pro';
  const schema = {
    size: {
      type: 'select',
      label: 'Aspect ratio / size',
      options: is3Pro ? ALIBABA_SIZE_OPTIONS_3PRO : ALIBABA_SIZE_OPTIONS_STANDARD,
      default: is3Pro ? '' : '1328*1328',
      // qwen-image-3.0-pro also accepts an arbitrary W*H below — once that's
      // on, this preset dropdown no longer applies.
      ...(is3Pro ? { disabledWhen: 'custom_size' } : {}),
    },
    n: {
      type: 'range',
      label: 'Number of images',
      min: 1, max: is3Pro ? 6 : 4, step: 1,
      default: 1,
    },
    use_seed: {
      type: 'checkbox',
      label: 'Use fixed seed',
      default: false,
    },
    seed: {
      type: 'range',
      label: 'Seed',
      min: 0, max: 999999999, step: 1,
      default: 0,
      dependsOn: 'use_seed',
    },
    prompt_extend: {
      type: 'checkbox',
      label: 'Smart prompt rewriting',
      default: true,
    },
    watermark: {
      type: 'checkbox',
      label: 'Add watermark',
      default: false,
    },
  };

  // Only qwen-image-3.0-pro accepts an arbitrary "W*H" (512–2048 either
  // side); other Qwen-Image models are restricted to the verified preset
  // sizes above, so the free-entry width/height fields are added for this
  // model only.
  if (is3Pro) {
    schema.custom_size = {
      type: 'checkbox',
      label: 'Custom resolution',
      default: false,
    };
    schema.width = {
      type: 'number',
      label: 'Width (px)',
      min: 512, max: 2048, step: 8,
      default: 1024,
      dependsOn: 'custom_size',
    };
    schema.height = {
      type: 'number',
      label: 'Height (px)',
      min: 512, max: 2048, step: 8,
      default: 1024,
      dependsOn: 'custom_size',
    };
  }

  return schema;
}

// ── Cloudflare (Flux 1 Schnell) ───────────────────────────────────────
const CLOUDFLARE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

function cloudflareSchema() {
  return {
    num_steps: {
      type: 'range',
      label: 'Steps',
      min: 1, max: 8, step: 1,
      default: 4,
    },
    use_seed: {
      type: 'checkbox',
      label: 'Use fixed seed',
      default: false,
    },
    seed: {
      type: 'range',
      label: 'Seed',
      min: 0, max: 999999999, step: 1,
      default: 0,
      dependsOn: 'use_seed',
    },
  };
}

// ── Pixazo (Flux 1 Schnell) ───────────────────────────────────────────
const PIXAZO_MODEL = 'flux-1-schnell';

function pixazoSchema() {
  return {
    width: { type: 'select', label: 'Width', options: [512, 768, 1024], default: 1024 },
    height: { type: 'select', label: 'Height', options: [512, 768, 1024], default: 1024 },
    num_steps: { type: 'range', label: 'Steps', min: 1, max: 8, step: 1, default: 4 },
    use_seed: { type: 'checkbox', label: 'Use fixed seed', default: false },
    seed: { type: 'range', label: 'Seed', min: 0, max: 999999999, step: 1, default: 0, dependsOn: 'use_seed' },
  };
}

// ── Transloadit (/image/generate robot) ───────────────────────────────
// Model list + params per https://transloadit.com/docs/robots/image-generate/
//
// Trimmed to just the nano-banana family + gpt-image-2 — the only models
// the agent (and the manual dropdowns) are allowed to pick from. All four
// support custom width/height directly, which is what makes them a good
// fit for the "size stated in the prompt itself" agent flow.
const TRANSLOADIT_GENERATE_MODELS = [
  'google/nano-banana',        // default
  'google/nano-banana-2',
  'google/nano-banana-pro',
  'openai/gpt-image-2',
];
const TRANSLOADIT_EDIT_MODELS = [...TRANSLOADIT_GENERATE_MODELS];

const TRANSLOADIT_DEFAULT_MODEL = 'google/nano-banana';

const TRANSLOADIT_ASPECT_OPTIONS = [
  { value: '1:1', label: 'Square 1:1' },
  { value: '16:9', label: 'Landscape 16:9' },
  { value: '9:16', label: 'Portrait 9:16' },
  { value: '4:3', label: 'Landscape 4:3' },
  { value: '3:4', label: 'Portrait 3:4' },
  { value: '3:2', label: 'Landscape 3:2' },
  { value: '2:3', label: 'Portrait 2:3' },
];

const TRANSLOADIT_FORMAT_OPTIONS = ['png', 'jpeg', 'webp', 'gif', 'svg'];

// Per https://transloadit.com/docs/robots/image-generate/, width/height are
// "mainly used by Google image models and openai/gpt-image-2" — other
// models (flux, recraft, the inpainting model) only take aspect_ratio, so
// custom width/height inputs are only offered for these.
const TRANSLOADIT_CUSTOM_SIZE_MODELS = [
  'google/nano-banana',
  'google/nano-banana-2',
  'google/nano-banana-pro',
  'openai/gpt-image-2',
];

const TRANSLOADIT_STYLE_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'photorealistic', label: 'Photorealistic' },
  { value: 'digital art', label: 'Digital art' },
  { value: 'anime', label: 'Anime' },
  { value: '3d render', label: '3D render' },
  { value: 'watercolor', label: 'Watercolor' },
  { value: 'oil painting', label: 'Oil painting' },
  { value: 'line art', label: 'Line art' },
];

function transloaditSchema(model) {
  const supportsCustomSize = TRANSLOADIT_CUSTOM_SIZE_MODELS.includes(model);

  const schema = {};

  if (supportsCustomSize) {
    schema.size_mode = {
      type: 'select',
      label: 'Size mode',
      options: [
        { value: 'aspect_ratio', label: 'Aspect Ratio' },
        { value: 'custom', label: 'Custom Resolution' },
      ],
      default: 'aspect_ratio',
    };
    schema.aspect_ratio = {
      type: 'select',
      label: 'Aspect ratio',
      options: TRANSLOADIT_ASPECT_OPTIONS,
      default: '1:1',
      disabledWhen: 'size_mode_custom',
    };
    schema.width = {
      type: 'number',
      label: 'Width (px)',
      min: 256, max: 4096, step: 8,
      default: 1024,
      dependsOn: 'size_mode_custom',
    };
    schema.height = {
      type: 'number',
      label: 'Height (px)',
      min: 256, max: 4096, step: 8,
      default: 1024,
      dependsOn: 'size_mode_custom',
    };
  } else {
    // Models that don't support custom resolution only get aspect_ratio
    schema.aspect_ratio = {
      type: 'select',
      label: 'Aspect ratio',
      options: TRANSLOADIT_ASPECT_OPTIONS,
      default: '1:1',
    };
  }

  schema.format = { type: 'select', label: 'Format', options: TRANSLOADIT_FORMAT_OPTIONS, default: 'png' };
  schema.style = { type: 'select', label: 'Style', options: TRANSLOADIT_STYLE_OPTIONS, default: '' };
  schema.num_outputs = { type: 'range', label: 'Number of outputs', min: 1, max: 10, step: 1, default: 1 };
  schema.use_seed = { type: 'checkbox', label: 'Use fixed seed', default: false };
  schema.seed = { type: 'range', label: 'Seed', min: 0, max: 999999999, step: 1, default: 0, dependsOn: 'use_seed' };

  return schema;
}

// ── Assemble full catalogs ────────────────────────────────────────────
function buildSchemas(models, schemaFn) {
  const out = {};
  for (const m of models) out[m] = schemaFn(m);
  return out;
}

// Image generate/edit is intentionally limited to Transloadit's
// nano-banana family + gpt-image-2 (see TRANSLOADIT_GENERATE_MODELS
// above). Alibaba/Cloudflare/Pixazo are no longer offered as image
// providers — Alibaba (Qwen) is still used elsewhere as the chat/agent
// LLM (see routes/agent.js), just not for image pixels anymore.
function getGenerateCatalog() {
  return {
    providers: ['transloadit'],
    models: {
      transloadit: TRANSLOADIT_GENERATE_MODELS,
    },
    defaults: {
      provider: 'transloadit',
      transloadit: TRANSLOADIT_DEFAULT_MODEL,
    },
    schemas: {
      ...buildSchemas(TRANSLOADIT_GENERATE_MODELS, transloaditSchema),
    },
  };
}

function getEditCatalog() {
  return {
    providers: ['transloadit'],
    models: {
      transloadit: TRANSLOADIT_EDIT_MODELS,
    },
    defaults: {
      provider: 'transloadit',
      transloadit: TRANSLOADIT_DEFAULT_MODEL,
    },
    schemas: {
      ...buildSchemas(TRANSLOADIT_EDIT_MODELS, transloaditSchema),
    },
  };
}

module.exports = {
  ALIBABA_GENERATE_MODELS,
  ALIBABA_EDIT_MODELS,
  ALIBABA_DEFAULT_GENERATE_MODEL,
  ALIBABA_DEFAULT_EDIT_MODEL,
  ALIBABA_VALID_SIZES,
  CLOUDFLARE_MODEL,
  PIXAZO_MODEL,
  TRANSLOADIT_GENERATE_MODELS,
  TRANSLOADIT_EDIT_MODELS,
  TRANSLOADIT_DEFAULT_MODEL,
  TRANSLOADIT_ASPECT_OPTIONS,
  TRANSLOADIT_FORMAT_OPTIONS,
  getGenerateCatalog,
  getEditCatalog,
};

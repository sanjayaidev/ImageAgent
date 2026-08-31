// providers/qwen-agent.js
//
// The "agent" flow: a user types one free-text line like
//   "a lighthouse at dusk in 16:9, ultra realistic"
//   "portrait of a fox, 1024x1536, use gpt image"
// and instead of picking provider/model/size from dropdowns, a Qwen3 LLM
// call (via AlibabaProvider.chatCompletion) reads the sentence and decides:
//   - the clean image prompt (with sizing/model chatter stripped out)
//   - an aspect ratio OR an explicit width/height
//   - which of the 4 allowed image models fits best
//   - optional style/format/num_outputs if mentioned
//
// Everything the LLM returns is treated as untrusted and re-validated
// against the same allow-lists the manual dropdowns use
// (providers/model-catalog.js) before it ever reaches Transloadit.

const catalog = require('./model-catalog');

// Qwen3's flagship text model on DashScope's OpenAI-compatible endpoint.
// Override with AGENT_MODEL if you want to point this at a different Qwen3
// variant (e.g. qwen3-flash for lower latency/cost).
const DEFAULT_AGENT_MODEL = process.env.AGENT_MODEL || 'qwen3-max';

const ALLOWED_MODELS = catalog.TRANSLOADIT_GENERATE_MODELS; // nano-banana(.../-2/-pro) + gpt-image-2
const ALLOWED_ASPECTS = catalog.TRANSLOADIT_ASPECT_OPTIONS.map((o) => o.value); // '1:1','16:9',...
const ALLOWED_FORMATS = catalog.TRANSLOADIT_FORMAT_OPTIONS;

// ── Physical-size → pixel conversion ───────────────────────────────────
// "7x4 feet", "8.5x11 inch", "50x70cm" etc get converted deterministically
// here rather than trusting the LLM's arithmetic. All units normalize to
// inches, then a DPI (explicit, or auto-picked to fit the provider's max)
// turns that into pixels.
const INCHES_PER_UNIT = { in: 1, ft: 12, cm: 1 / 2.54, mm: 1 / 25.4, m: 39.3701 };
const DEFAULT_DPI = 150;   // reasonable default for on-screen/AI-generated art
const MIN_DPI = 20;        // floor so tiny DPIs don't collapse the image to nothing
const MAX_DPI = 600;       // ceiling so a stray "6000 dpi" doesn't blow up the request
const MIN_PIXELS = 256;
const MAX_PIXELS = 4096;   // matches the width/height range every allowed model supports

function roundToStep(value, step = 8) {
  return Math.round(value / step) * step;
}

// Returns { width, height, dpi } in pixels, or null if the unit is invalid.
function physicalToPixels(physicalWidth, physicalHeight, unit, explicitDpi) {
  const perInch = INCHES_PER_UNIT[unit];
  if (!perInch || !(physicalWidth > 0) || !(physicalHeight > 0)) return null;

  const widthIn = physicalWidth * perInch;
  const heightIn = physicalHeight * perInch;

  let dpi;
  if (explicitDpi && Number.isFinite(explicitDpi)) {
    dpi = Math.max(MIN_DPI, Math.min(MAX_DPI, explicitDpi));
  } else {
    // No DPI stated — auto-pick the largest DPI (up to the default) that
    // still keeps both dimensions within the provider's pixel cap, so a
    // "7x4 feet" banner doesn't request an impossible 12600x7200 image.
    const fitDpi = Math.min(MAX_PIXELS / widthIn, MAX_PIXELS / heightIn);
    dpi = Math.max(MIN_DPI, Math.min(DEFAULT_DPI, fitDpi));
  }

  let width = roundToStep(widthIn * dpi);
  let height = roundToStep(heightIn * dpi);
  width = Math.max(MIN_PIXELS, Math.min(MAX_PIXELS, width));
  height = Math.max(MIN_PIXELS, Math.min(MAX_PIXELS, height));

  return { width, height, dpi: Math.round(dpi) };
}

// Backup regex pass over the user's raw text, used only when the LLM
// didn't come back with any size info at all (e.g. JSON parsing failed).
// Matches things like "7x4 feet", "8.5 x 11 inches", "50x70cm".
const UNIT_WORDS = {
  ft: 'ft', foot: 'ft', feet: 'ft', "'": 'ft',
  in: 'in', inch: 'in', inches: 'in', '"': 'in',
  cm: 'cm', centimeter: 'cm', centimeters: 'cm', centimetre: 'cm', centimetres: 'cm',
  mm: 'mm', millimeter: 'mm', millimeters: 'mm', millimetre: 'mm', millimetres: 'mm',
  m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
};
const PHYSICAL_SIZE_RE = /(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*(feet|foot|ft|inches|inch|in|centimeters|centimetres|centimeter|centimetre|cm|millimeters|millimetres|millimeter|millimetre|mm|meters|metres|meter|metre|m|'|")\b/i;

function extractPhysicalSizeFromText(text) {
  const match = text.match(PHYSICAL_SIZE_RE);
  if (!match) return null;
  const unit = UNIT_WORDS[match[3].toLowerCase()];
  if (!unit) return null;
  return { physicalWidth: parseFloat(match[1]), physicalHeight: parseFloat(match[2]), unit };
}

const SYSTEM_PROMPT = `You are a parameter-extraction assistant for an AI image generator. The user gives you one message that mixes an image description with (optionally) sizing/aspect-ratio/model/style instructions written in plain language — sizes may be given as exact pixels, as a shape in words, OR as a real-world physical size (feet, inches, cm, mm, meters — e.g. "7x4 feet", "8.5x11 inch", "50x70cm poster"). Your job is to split those apart. Do NOT do any unit math yourself — just extract the numbers/units exactly as stated; a separate step converts physical sizes to pixels.

Respond with ONLY a single JSON object, no markdown fences, no commentary, matching exactly this shape:
{
  "prompt": string,            // the visual image description, with any sizing/aspect-ratio/model/format/style/count instructions removed. Keep all visual detail (subject, setting, lighting, style, mood, colors) intact and unchanged in wording.
  "aspect_ratio": string|null, // one of: "1:1","16:9","9:16","4:3","3:4","3:2","2:3" — pick the closest match if the user described a shape in words (e.g. "widescreen"->"16:9", "portrait"->"9:16", "square"->"1:1"). null if an explicit pixel size or physical size was given instead, or nothing about size/shape was said.
  "width": number|null,        // explicit PIXEL width if the user gave exact pixel dimensions (e.g. "1920x1080", "1024*1024"). null otherwise — do NOT fill this for physical (feet/inch/cm/mm/m) sizes, use physical_width instead.
  "height": number|null,       // explicit PIXEL height, paired with width. null otherwise.
  "physical_width": number|null,   // real-world width if given in feet/inches/cm/mm/meters (e.g. "7x4 feet" -> 7). null otherwise.
  "physical_height": number|null,  // real-world height, paired with physical_width (e.g. "7x4 feet" -> 4). null otherwise.
  "physical_unit": string|null,    // one of "in","ft","cm","mm","m" for the physical_width/physical_height above. Normalize words like "inches","inch","\\"" -> "in"; "feet","foot","ft","'" -> "ft"; "centimeters","centimetre" -> "cm"; "millimeters" -> "mm"; "meters","metre" -> "m". null if no physical size was given.
  "dpi": number|null,          // explicit DPI/PPI/resolution density ONLY if the user stated one (e.g. "300 dpi poster", "150 ppi"). null otherwise — do not guess a default, a separate step picks a sensible default.
  "model": string,             // one of: "google/nano-banana", "google/nano-banana-2", "google/nano-banana-pro", "openai/gpt-image-2". Pick "openai/gpt-image-2" only if the user explicitly asked for GPT/OpenAI image generation. Pick "google/nano-banana-2" or "google/nano-banana-pro" only if the user explicitly named that version. Default to "google/nano-banana-pro" otherwise.
  "style": string|null,        // a short style keyword if clearly requested (e.g. "photorealistic","anime","3d render","watercolor","oil painting","line art","digital art"). null otherwise.
  "format": string|null,       // one of "png","jpeg","webp","gif","svg" if explicitly requested. null otherwise.
  "num_outputs": number|null   // how many images if explicitly requested (e.g. "give me 3 variations"). null otherwise.
}

Rules:
- If the user gives exact pixel dimensions (the word "px" or plain numbers like "1920x1080" with no unit), fill width/height and leave everything else about size null.
- If the user gives a real-world physical size (feet, inches, cm, mm, meters — including print/poster/banner/wall/canvas sizes like "7x4 feet", "A4", "8.5x11in"), fill physical_width/physical_height/physical_unit and leave width/height/aspect_ratio null. For named paper sizes you recognize (e.g. "A4" = 21x29.7cm, "letter" = 8.5x11in), fill in the physical dimensions and unit.
- If the user only describes a shape/ratio in words with no numbers, fill aspect_ratio and leave the rest null.
- If nothing about size is said, leave aspect_ratio, width, height, physical_width, physical_height, physical_unit and dpi all null (the caller will pick a sensible default).
- Never invent visual details that were not in the user's message.
- Output must be valid JSON and nothing else.`;

function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

// Best-effort extraction of the first {...} JSON object in a string, in
// case the model adds any stray text around it despite instructions.
function extractJsonObject(text) {
  const cleaned = stripCodeFences(text);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Agent LLM did not return JSON');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function clampInt(value, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

// Validates/clamps whatever the LLM returned against the same allow-lists
// the manual dropdowns use, so a hallucinated model/format/ratio can never
// reach the provider call. `originalMessage` is used only as a regex
// backup for physical size if the LLM didn't extract any size info.
function sanitizeParsed(parsed, fallbackPrompt, originalMessage) {
  const out = {
    prompt: (typeof parsed.prompt === 'string' && parsed.prompt.trim()) ? parsed.prompt.trim() : fallbackPrompt,
    aspect_ratio: null,
    width: null,
    height: null,
    dpi: null,
    model: ALLOWED_MODELS.includes(parsed.model) ? parsed.model : catalog.TRANSLOADIT_DEFAULT_MODEL,
    style: (typeof parsed.style === 'string' && parsed.style.trim()) ? parsed.style.trim() : null,
    format: ALLOWED_FORMATS.includes(parsed.format) ? parsed.format : null,
    num_outputs: parsed.num_outputs != null ? clampInt(parsed.num_outputs, 1, 10) : null,
  };

  const hasWidth = parsed.width != null && parsed.width !== '';
  const hasHeight = parsed.height != null && parsed.height !== '';
  const hasPhysical = parsed.physical_width != null && parsed.physical_height != null && parsed.physical_unit;

  if (hasPhysical) {
    const converted = physicalToPixels(
      parseFloat(parsed.physical_width),
      parseFloat(parsed.physical_height),
      parsed.physical_unit,
      parsed.dpi != null ? parseFloat(parsed.dpi) : undefined
    );
    if (converted) {
      out.width = converted.width;
      out.height = converted.height;
      out.dpi = converted.dpi;
    }
  }

  if (!out.width && hasWidth && hasHeight) {
    out.width = clampInt(parsed.width, MIN_PIXELS, MAX_PIXELS);
    out.height = clampInt(parsed.height, MIN_PIXELS, MAX_PIXELS);
  } else if (!out.width && ALLOWED_ASPECTS.includes(parsed.aspect_ratio)) {
    out.aspect_ratio = parsed.aspect_ratio;
  }

  // The LLM didn't find any size info at all — try a deterministic regex
  // pass over the raw text as a backup before falling back to square.
  if (!out.width && !out.aspect_ratio && originalMessage) {
    const backup = extractPhysicalSizeFromText(originalMessage);
    if (backup) {
      const converted = physicalToPixels(backup.physicalWidth, backup.physicalHeight, backup.unit);
      if (converted) {
        out.width = converted.width;
        out.height = converted.height;
        out.dpi = converted.dpi;
      }
    }
  }

  // Nothing about size was given at all — default to a square image.
  if (!out.width && !out.aspect_ratio) {
    out.aspect_ratio = '1:1';
  }

  return out;
}

// alibaba: an AlibabaProvider instance (used only for the chat/parsing
// call — never for image pixels, per the model-catalog restriction).
async function parseImageRequest(alibaba, message, options = {}) {
  if (!message || !message.trim()) throw new Error('message is required');

  const completion = await alibaba.chatCompletion(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: message },
    ],
    {
      model: options.model || DEFAULT_AGENT_MODEL,
      temperature: 0.1,
      enable_thinking: false, // we want a direct JSON answer, not a reasoning trace
    }
  );

  const raw = completion?.choices?.[0]?.message?.content;
  if (!raw) throw new Error('No reply returned from Qwen3 agent');

  let parsed;
  try {
    parsed = extractJsonObject(raw);
  } catch (err) {
    // Fall back to treating the whole message as the prompt with default
    // sizing, rather than failing the request outright.
    parsed = { prompt: message };
  }

  return sanitizeParsed(parsed, message.trim(), message.trim());
}

module.exports = { parseImageRequest, DEFAULT_AGENT_MODEL, ALLOWED_MODELS, ALLOWED_ASPECTS };

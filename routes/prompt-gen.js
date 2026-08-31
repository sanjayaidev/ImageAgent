const express = require('express');
const AlibabaProvider = require('../providers/alibaba');
const db = require('../db');

const router = express.Router();

const ENHANCE_SYSTEM = `You are an expert AI image-prompt writer. The user gives you a rough combination of a subject, style, lighting, mood, extra details and tags. Turn it into a single, detailed, vivid prompt suitable for AI image generation models.

Rules:
- Output ONLY the final prompt text — no preamble, no explanation, no quotes around it.
- Weave the given elements together naturally into 1-3 sentences, dense with concrete visual detail.
- Don't invent unrelated elements; only elaborate on what was given.`;

function getAlibaba() {
  const apiKey = process.env.ALIBABA_API_KEY;
  const workspaceId = process.env.ALIBABA_WORKSPACE_ID;
  const region = process.env.ALIBABA_REGION;
  if (!apiKey || !workspaceId) return null;
  return new AlibabaProvider(apiKey, workspaceId, region);
}

// POST /api/prompt/generate
// body: { subject_id?, style_id?, lighting_id?, mood_id?, tag_ids?: [], additional?: string }
// Looks up the selected building blocks, joins them into a raw prompt, and
// (if Alibaba is configured) asks the model to polish it into a vivid final
// prompt. Falls back to the raw joined string if Alibaba isn't configured
// or the call fails, so this endpoint always returns something usable.
router.post('/generate', async (req, res) => {
  try {
    const { subject_id: subjectId, style_id: styleId, lighting_id: lightingId, mood_id: moodId, tag_ids: tagIds = [], additional = '' } = req.body || {};

    const idsToFetch = [subjectId, styleId, lightingId, moodId, ...(Array.isArray(tagIds) ? tagIds : [])]
      .filter(v => v !== undefined && v !== null && v !== '')
      .map(v => parseInt(v, 10))
      .filter(v => Number.isFinite(v));

    const rows = idsToFetch.length ? await db.getPromptDataByIds(idsToFetch) : [];
    const byId = new Map(rows.map(r => [String(r.id), r]));

    const parts = [];
    if (subjectId && byId.has(String(subjectId))) parts.push(byId.get(String(subjectId)).value);
    if (styleId && byId.has(String(styleId))) parts.push(byId.get(String(styleId)).value);
    if (lightingId && byId.has(String(lightingId))) parts.push(byId.get(String(lightingId)).value);
    if (moodId && byId.has(String(moodId))) parts.push(byId.get(String(moodId)).value);
    if (additional && additional.trim()) parts.push(additional.trim());
    const tagValues = (Array.isArray(tagIds) ? tagIds : [])
      .map(id => byId.get(String(id)))
      .filter(Boolean)
      .map(r => r.value);
    if (tagValues.length) parts.push(tagValues.join(', '));

    const rawPrompt = parts.join(', ');
    if (!rawPrompt) {
      return res.status(400).json({ error: 'Select at least one option or add some detail first.' });
    }

    const alibaba = getAlibaba();
    if (!alibaba) {
      return res.json({ prompt: rawPrompt });
    }

    try {
      const completion = await alibaba.chatCompletion(
        [
          { role: 'system', content: ENHANCE_SYSTEM },
          { role: 'user', content: rawPrompt },
        ],
        { model: AlibabaProvider.DEFAULT_CHAT_MODEL, enable_thinking: false }
      );
      const reply = completion?.choices?.[0]?.message?.content?.trim();
      res.json({ prompt: reply || rawPrompt });
    } catch (aiErr) {
      // AI enhancement failed (bad key, rate limit, etc) — the raw joined
      // prompt is still a perfectly usable result, so don't fail the request.
      res.json({ prompt: rawPrompt });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

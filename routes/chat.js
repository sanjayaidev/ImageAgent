const express = require('express');
const AlibabaProvider = require('../providers/alibaba');
const db = require('../db');

const router = express.Router();

const PROMPT_GENERATOR_SYSTEM = `You are an expert AI image-prompt writer. The user will give you a short idea, and you turn it into a single, detailed, vivid prompt suitable for AI image generation models (Alibaba Qwen-Image, Flux, nano-banana, etc).

Rules:
- Output ONLY the final prompt text — no preamble, no explanation, no quotes around it.
- Include concrete visual detail: subject, setting, lighting, composition, color palette, mood, and art/photo style.
- Keep it to 1-3 sentences, dense with specific detail rather than vague adjectives.
- Respect any constraints the user gives (style, aspect, mood, subject count, etc).`;

function getAlibaba() {
  const apiKey = process.env.ALIBABA_API_KEY;
  const workspaceId = process.env.ALIBABA_WORKSPACE_ID;
  const region = process.env.ALIBABA_REGION;
  if (!apiKey || !workspaceId) {
    throw new Error('Alibaba is not configured. Set ALIBABA_API_KEY and ALIBABA_WORKSPACE_ID.');
  }
  return new AlibabaProvider(apiKey, workspaceId, region);
}

// POST /api/chat
// body: { message, conversationId?, mode?: 'chat' | 'prompt-generator', model? }
router.post('/', async (req, res) => {
  try {
    const { message, conversationId, mode = 'chat', model } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (!['chat', 'prompt-generator'].includes(mode)) {
      return res.status(400).json({ error: "mode must be 'chat' or 'prompt-generator'" });
    }

    let convId = conversationId;
    if (convId) {
      const conv = await db.getConversation(convId);
      if (!conv) return res.status(404).json({ error: `conversation ${convId} not found` });
    } else {
      convId = await db.createConversation(mode, message.slice(0, 60));
    }

    const history = await db.getMessages(convId);

    const messages = [];
    if (mode === 'prompt-generator') {
      messages.push({ role: 'system', content: PROMPT_GENERATOR_SYSTEM });
    }
    for (const m of history) messages.push({ role: m.role, content: m.content });
    messages.push({ role: 'user', content: message });

    const alibaba = getAlibaba();
    const completion = await alibaba.chatCompletion(messages, {
      model: model || AlibabaProvider.DEFAULT_CHAT_MODEL,
      // Prompt-generation wants a direct, immediately usable answer, not a
      // reasoning trace eating the token budget.
      enable_thinking: mode === 'prompt-generator' ? false : undefined,
    });

    const reply = completion?.choices?.[0]?.message?.content;
    if (!reply) throw new Error('No reply returned from Alibaba chat');

    await db.addMessage(convId, 'user', message);
    await db.addMessage(convId, 'assistant', reply);

    res.json({ conversationId: convId, mode, reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/conversations
router.get('/conversations', async (req, res) => {
  try {
    res.json(await db.listConversations());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/:conversationId
router.get('/:conversationId', async (req, res) => {
  try {
    const conv = await db.getConversation(req.params.conversationId);
    if (!conv) return res.status(404).json({ error: 'conversation not found' });
    const messages = await db.getMessages(req.params.conversationId);
    res.json({ conversation: conv, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

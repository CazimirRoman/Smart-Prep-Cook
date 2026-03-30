import type { VercelRequest, VercelResponse } from '@vercel/node';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config({ path: '.env.local' });

const ALLOWED_MODELS = ['gpt-5.3-chat-latest'];

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;

  if (!body?.messages || !Array.isArray(body.messages)) {
    return res.status(400).json({ error: 'Missing or invalid messages' });
  }

  if (body.model && !ALLOWED_MODELS.includes(body.model)) {
    return res.status(400).json({ error: `Model not allowed: ${body.model}` });
  }

  try {
    const response = await client.chat.completions.create({
      ...body,
      model: body.model || ALLOWED_MODELS[0],
    });
    return res.status(200).json(response);
  } catch (e: any) {
    console.error('[api/ai] OpenAI error:', e?.message || e);
    const status = e?.status || 502;
    return res.status(status).json({ error: e?.message || 'OpenAI request failed' });
  }
}

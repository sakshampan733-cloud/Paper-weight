import { client, preflight, QUESTION_SCHEMA, parseStructuredResponse, handleError } from './_shared.js';

const MAX_NOTES_LEN = 20000; // keep the request modest — this is text, not a PDF
const MAX_COUNT = 20;

const GENERATE_SCHEMA = { type: 'array', items: QUESTION_SCHEMA };

function notesText(cards) {
  return (Array.isArray(cards) ? cards : [])
    .filter((c) => c && c.type === 'note')
    .map((c) => `## ${c.title || ''}\n${(c.html || '').replace(/<[^>]+>/g, ' ')}`)
    .join('\n\n')
    .slice(0, MAX_NOTES_LEN);
}

async function generate(req, res) {
  const cards = req.body.cards;
  const count = Math.min(MAX_COUNT, Math.max(1, parseInt(req.body.count, 10) || 5));
  const notes = notesText(cards);
  if (!notes.trim()) {
    res.status(400).json({ error: 'No note content to generate questions from.' });
    return;
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 6000,
    thinking: { type: 'disabled' },
    messages: [
      {
        role: 'user',
        content: `Here are study notes for a chapter:\n\n${notes}\n\nGenerate exactly ${count} exam-style practice questions covering this material, each with a full worked answer. Use the same HTML subset as the notes (e.g. <p>, <b>, <div class="work"> for calculations) in the answer.`
      }
    ],
    output_config: { format: { type: 'json_schema', schema: GENERATE_SCHEMA } }
  });

  const { data: questions, error, status } = parseStructuredResponse(response);
  if (error) {
    res.status(status).json({ error });
    return;
  }
  res.status(200).json({ questions });
}

async function answer(req, res) {
  const question = typeof req.body.question === 'string' ? req.body.question.trim() : '';
  if (!question) {
    res.status(400).json({ error: 'Missing question text.' });
    return;
  }
  const notes = notesText(req.body.cards);

  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 2000,
    thinking: { type: 'disabled' },
    messages: [
      {
        role: 'user',
        content: `${notes ? `Chapter notes for context:\n\n${notes}\n\n` : ''}Write a full worked answer to this exam question:\n\n${question}\n\nUse the same HTML subset the notes use (<p>, <b>, <div class="work"> for any calculation).`
      }
    ],
    output_config: {
      format: {
        type: 'json_schema',
        schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }
      }
    }
  });

  const { data, error, status } = parseStructuredResponse(response);
  if (error) {
    res.status(status).json({ error });
    return;
  }
  res.status(200).json({ answer: data.a });
}

export default async function handler(req, res) {
  if (preflight(req, res)) return;

  const mode = req.body && req.body.mode;
  try {
    if (mode === 'generate') await generate(req, res);
    else if (mode === 'answer') await answer(req, res);
    else res.status(400).json({ error: 'mode must be "generate" or "answer".' });
  } catch (err) {
    handleError(res, err, 'Question generation failed.');
  }
}

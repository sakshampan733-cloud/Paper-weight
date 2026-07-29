import { client, preflight, parseStructuredResponse, handleError } from './_shared.js';

// Takes a subject's stored per-paper question lists (small JSON, no PDFs) and
// categorizes likely questions for the upcoming exam into four tiers. Pattern-
// matched only against the papers the user uploaded for this one subject.
const PREDICT_SCHEMA = {
  type: 'object',
  properties: {
    tiers: {
      type: 'object',
      properties: {
        confirmed: { type: 'array', items: { $ref: '#/$defs/pred' } },
        likely: { type: 'array', items: { $ref: '#/$defs/pred' } },
        wildcard: { type: 'array', items: { $ref: '#/$defs/pred' } },
        unlikely: { type: 'array', items: { $ref: '#/$defs/pred' } }
      },
      required: ['confirmed', 'likely', 'wildcard', 'unlikely'],
      additionalProperties: false
    }
  },
  required: ['tiers'],
  additionalProperties: false,
  $defs: {
    pred: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        question: { type: 'string', description: 'a representative predicted question for this topic' },
        rationale: { type: 'string', description: 'why it lands in this tier — which terms/papers it recurred in' }
      },
      required: ['topic', 'question', 'rationale'],
      additionalProperties: false
    }
  }
};

const PREDICT_PROMPT = `You are a Paper Predictor for a single university subject. Below are the questions extracted from the student's own uploaded past exam papers, grouped by term. Analyze the recurrence and weighting of topics ACROSS these papers and predict what is likely to appear on the next exam.

Categorize predicted questions into exactly four tiers:
- "confirmed": topics that appear in essentially every term — near-certain to appear again.
- "likely": topics that recur across most terms — probable.
- "wildcard": topics that appear occasionally or in only one term — could resurface.
- "unlikely": topics seen once long ago or trailing off — safe to deprioritize.

Base this ONLY on the papers provided — do not invent syllabus knowledge. Cite which terms each prediction recurred in, in the rationale.`;

export default async function handler(req, res) {
  if (preflight(req, res)) return;

  const papers = req.body && req.body.papers;
  if (!Array.isArray(papers) || !papers.length) {
    res.status(400).json({ error: 'No papers to analyze — upload at least one first.' });
    return;
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 6000,
      thinking: { type: 'disabled' },
      messages: [
        {
          role: 'user',
          content: `${PREDICT_PROMPT}\n\nPapers (JSON):\n${JSON.stringify(papers).slice(0, 40000)}`
        }
      ],
      output_config: { format: { type: 'json_schema', schema: PREDICT_SCHEMA } }
    });

    const { data, error, status } = parseStructuredResponse(response);
    if (error) {
      res.status(status).json({ error });
      return;
    }
    res.status(200).json({ tiers: data.tiers });
  } catch (err) {
    handleError(res, err, 'Prediction failed.');
  }
}

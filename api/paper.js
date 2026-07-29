import { client, preflight, requireBase64Field, parseStructuredResponse, handleError } from './_shared.js';

// Extracts the question list from a single past exam paper PDF. Returns just
// the questions (topic + text + marks), not the chapter/card schema — the
// predictor pattern-matches across these lists, it doesn't render them as cards.
const PAPER_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'the topic/area this question tests, in a few words' },
          text: { type: 'string', description: 'the question as printed on the paper' },
          marks: { type: 'string', description: 'marks/weight if shown, else ""' }
        },
        required: ['topic', 'text', 'marks'],
        additionalProperties: false
      }
    }
  },
  required: ['questions'],
  additionalProperties: false
};

const PAPER_PROMPT = `This is a past examination paper PDF. Extract every question on it. For each question, give the topic it tests (a few words), the question text as printed, and its marks/weight if shown (else ""). Include every distinct question and sub-question; don't summarize or merge them.`;

export default async function handler(req, res) {
  if (preflight(req, res)) return;

  const pdfBase64 = requireBase64Field(req, res, 'pdfBase64');
  if (!pdfBase64) return;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 6000,
      thinking: { type: 'disabled' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: PAPER_PROMPT }
          ]
        }
      ],
      output_config: { format: { type: 'json_schema', schema: PAPER_SCHEMA } }
    });

    const { data, error, status } = parseStructuredResponse(response);
    if (error) {
      res.status(status).json({ error });
      return;
    }
    res.status(200).json({ questions: data.questions });
  } catch (err) {
    handleError(res, err, 'Paper extraction failed.');
  }
}

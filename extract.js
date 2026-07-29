import { client, preflight, requireBase64Field, CARD_SCHEMA, parseStructuredResponse, handleError } from './_shared.js';

const CHAPTER_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'the chapter title' },
    lectures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          cards: { type: 'array', items: CARD_SCHEMA }
        },
        required: ['title', 'cards'],
        additionalProperties: false
      }
    }
  },
  required: ['name', 'lectures'],
  additionalProperties: false
};

const EXTRACTION_PROMPT = `You are extracting structured study notes from a chapter PDF for a notes app called Paperweight, which renders your output as note/formula/question cards grouped into lectures.

Split the PDF into one lecture per major section or topic (a short PDF with one topic is a single lecture). For each lecture:
- Write "note" cards covering every concept, definition, and explanation of substance — don't summarize away detail. Use <p>, <ul>/<ol>, <b>, <em>, <code>, and <table> where the source has tabular data. Put any worked calculation or step-by-step numeric example inside <div class="work">…</div> so it renders in monospace.
- Write "formula" cards for every formula in the chapter, one card per logical group of related formulas, with a short label and note for each row.
- Write "question" cards for every practice question, illustration, or worked example problem in the PDF — question text in "q", the full worked solution in "a" (using <div class="work"> for the arithmetic), "src" only if the PDF names a source/exam, else "", and "tags" like ["Numerical"] or ["Theory"].

Be thorough: this replaces reading the chapter by hand, so don't skip content to keep the output short. Give the chapter a clear, specific "name" (not "Chapter 1" — the actual topic).`;

const MAX_CUSTOM_PROMPT_LEN = 2000;
const MAX_QUESTION_COUNT = 30;

export default async function handler(req, res) {
  if (preflight(req, res)) return;

  const pdfBase64 = requireBase64Field(req, res, 'pdfBase64');
  if (!pdfBase64) return;

  const customPrompt = typeof req.body.customPrompt === 'string' ? req.body.customPrompt.trim().slice(0, MAX_CUSTOM_PROMPT_LEN) : '';
  const questionCount = Math.min(MAX_QUESTION_COUNT, Math.max(0, parseInt(req.body.questionCount, 10) || 0));

  let prompt = EXTRACTION_PROMPT;
  if (customPrompt) {
    prompt += `\n\nAdditional instructions from the user for this specific chapter — follow these too:\n${customPrompt}`;
  }
  if (questionCount > 0) {
    prompt += `\n\nAlso generate exactly ${questionCount} extra exam-style practice "question" cards covering material from this chapter (beyond any questions already in the source PDF), spread across whichever lectures make sense.`;
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      thinking: { type: 'disabled' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: prompt }
          ]
        }
      ],
      output_config: { format: { type: 'json_schema', schema: CHAPTER_SCHEMA } }
    });

    const { data: chapter, error, status } = parseStructuredResponse(response);
    if (error) {
      res.status(status).json({ error });
      return;
    }
    res.status(200).json({ chapter });
  } catch (err) {
    handleError(res, err, 'Extraction failed.');
  }
}

import Anthropic from '@anthropic-ai/sdk';

// Reads ANTHROPIC_API_KEY from the environment automatically — set it as a
// Vercel project environment variable, never commit it. Shared by every
// function under api/ so there's exactly one client and one CORS setup.
export const client = new Anthropic();

export const MAX_B64_LEN = 5 * 1024 * 1024; // ~3.7MB of PDF once decoded; keeps the request under Vercel's body limit

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Returns true if the caller should stop (preflight or wrong method already handled).
export function preflight(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return true;
  }
  return false;
}

export function requireBase64Field(req, res, field) {
  const value = req.body && req.body[field];
  if (!value || typeof value !== 'string') {
    res.status(400).json({ error: `Missing ${field} in the request body.` });
    return null;
  }
  if (value.length > MAX_B64_LEN) {
    res.status(413).json({ error: 'That PDF is too large for this backend (~3.5MB limit).' });
    return null;
  }
  return value;
}

// Every question/note card in the app follows this shape — reused wherever
// Claude needs to emit cards (chapter extraction, question generation).
export const CARD_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      properties: {
        type: { const: 'note' },
        title: { type: 'string' },
        html: {
          type: 'string',
          description:
            'Rendered as innerHTML. Use <p>, <ul>/<ol>/<li>, <b>, <em>, <code>, <table>/<tr>/<th>/<td>, and <div class="work">…</div> for monospace worked calculations (preserve line breaks with \\n inside it).'
        }
      },
      required: ['type', 'title', 'html'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        type: { const: 'formula' },
        title: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              l: { type: 'string', description: 'short label for the formula' },
              f: { type: 'string', description: 'the formula itself, plain text/mono' },
              n: { type: 'string', description: 'a short note about it, or "" if none' }
            },
            required: ['l', 'f', 'n'],
            additionalProperties: false
          }
        }
      },
      required: ['type', 'title', 'items'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        type: { const: 'question' },
        q: { type: 'string', description: 'the question text' },
        a: {
          type: 'string',
          description: 'the worked answer, same HTML subset as a note card, including <div class="work"> for calculations'
        },
        src: { type: 'string', description: 'exam/source citation if the PDF gives one, else ""' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'e.g. ["Numerical"] or ["Theory"]'
        }
      },
      required: ['type', 'q', 'a', 'src', 'tags'],
      additionalProperties: false
    }
  ]
};

// The bare question/answer shape, without the discriminated "type" wrapper —
// used where Claude is only ever emitting questions (generate/answer modes,
// past-paper extraction), so the schema doesn't need the note/formula arms.
export const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    q: { type: 'string' },
    a: { type: 'string', description: 'the worked answer, same HTML subset as a note card' },
    src: { type: 'string', description: 'exam/source citation if known, else ""' },
    tags: { type: 'array', items: { type: 'string' } }
  },
  required: ['q', 'a', 'src', 'tags'],
  additionalProperties: false
};

// Pulls the guaranteed-JSON text block out of a structured-output response,
// or a {error, status} pair describing what went wrong.
export function parseStructuredResponse(response) {
  if (response.stop_reason === 'refusal') {
    return { error: 'Claude declined to process this.', status: 422 };
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) {
    return { error: 'No response text came back from Claude.', status: 502 };
  }
  try {
    return { data: JSON.parse(textBlock.text) };
  } catch (err) {
    return { error: 'Could not parse Claude’s response as JSON.', status: 502 };
  }
}

export function handleError(res, err, fallbackMessage) {
  console.error(err);
  res.status(500).json({ error: (err && err.message) || fallbackMessage || 'Something went wrong.' });
}

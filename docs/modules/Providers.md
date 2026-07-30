# Module: Providers

`js/providers.js`

## Purpose

One adapter per LLM vendor, each reduced to the same shape so
[[Panel_UI]] can call any of them identically:

- `buildRequest(apiKey, model, systemPrompt, userPrompt) -> {url, options}`
- `extractText(json) -> string | undefined`
- `label`, `defaultModel`, `requiresKey` (default `true`)

| Provider | Key required | Default model | Endpoint shape |
|---|---|---|---|
| `ollama` | No | `gemma4:26b` | Local, OpenAI-compatible (`/v1/chat/completions`) |
| `claude` | Yes | `claude-sonnet-5` | Anthropic Messages API |
| `openai` | Yes | `gpt-4o` | OpenAI chat completions |
| `gemini` | Yes | `gemini-2.5-flash` | Google `generateContent`, key in query string |

Adding a fifth provider means adding one more entry to this object — no
changes needed in `main.js`.

## Prompt construction

`translateBatch()` (called from [[Panel_UI]]) assembles the system prompt
from three layers, in order:

1. `DEFAULT_TRANSLATE_SYSTEM_PROMPT` — fixed IEC/IEEE 82079 minimalist
   style: short, formal, imperative for actions, consistent terminology,
   warnings kept structurally distinct.
2. `FORMATTING_MARKERS_INSTRUCTION` — appended only when "preserve
   formatting" is on; teaches the LLM the `<<mN>>...<</mN>>` tag contract
   from [[../01_Architecture]] so it repositions tags around the
   translated phrase instead of dropping or merging them.
3. Style examples — appended only when `examples/<lang-code>/*.txt` exist
   for the target language (loaded by [[Panel_UI]]).

The user prompt is just the target language plus a JSON array of
`{id, contents}` fragments — providers never see frame metadata beyond
that.

## Response handling

Every provider is expected to reply with **only** a JSON array of
`{id, contents}`, same length as the input. `translateBatch()` strips
common ```` ```json ```` code-fence wrapping before parsing, then throws a
descriptive error (surfaced in the panel log by [[Panel_UI]]) if the reply
isn't valid JSON or the vendor's response shape didn't yield any text at
all.

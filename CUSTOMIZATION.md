# Customizing Translate & Check

Applies identically to all four packages (Illustrator/InDesign × mac/
windows) — `js/providers.js` and the style-examples mechanism in
`js/main.js` are byte-identical across all four, so one edit covers every
variant you've installed.

## Changing the prompt

The system prompt sent to whichever LLM provider is selected lives in
**`js/providers.js`**, as the `DEFAULT_TRANSLATE_SYSTEM_PROMPT` constant
near the top of the file. It currently instructs a specific house style
(IEC/IEEE 82079 minimalist technical-manual style: short, formal,
imperative, one fact per sentence). Edit that string directly to change
the baseline style for every translation, regardless of provider or
target language.

Two related pieces, same file:

- **`FORMATTING_MARKERS_INSTRUCTION`** — appended to the prompt only when
  "Preserve character formatting" is checked. Explains the `<<mN>>...<</mN>>`
  span-marker syntax to the model. Only touch this if you also change how
  formatting spans are marked in `checks.js`/`host.jsx` — the two have to
  agree on the exact tag syntax.
- **`translateBatch()`**, same file — this is where the base prompt,
  formatting instruction, and any style examples (see below) get
  concatenated before the request is sent. The per-request user message
  (target language + the actual text fragments as JSON) is built here too,
  separately from the system prompt.

After editing `providers.js`, close and reopen the panel (`Window >
Extensions`, toggle off/on) — same reload requirement as editing
`host.jsx`, since CEP doesn't hot-reload panel scripts.

## Per-language tone/style folders

Drop plain `.txt` files into `examples/<lang-code>/` (folders already
present: `en`, `de`, `fr`, `cs`, `pl`, `nl`) and every file in that folder
gets read and appended to the system prompt as approved reference
examples whenever that language is the translation target — this is how
you steer tone/terminology per language without touching code at all.

- The language code is derived from whatever you type in "Target
  language": a `(xx)` suffix if present (`"German (de)"` → `de`), otherwise
  the whole string lowercased with everything but letters/digits stripped
  (`deriveLangCode()` in `js/main.js`).
- Any number of `.txt` files per folder — they're concatenated in
  directory-read order, separated by `---`. No naming convention required.
- An empty or missing folder for a given language just means no style
  reference gets sent for it — translation still runs, using only the
  default IEC/IEEE 82079 instruction from `providers.js`.
- Put real, approved snippets from actual house-style manuals here, not
  invented examples — the model matches tone/terminology against whatever
  it's given, so the quality of these files directly determines output
  quality more than any prompt wording does.

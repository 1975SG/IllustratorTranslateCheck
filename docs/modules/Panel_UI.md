# Module: Panel UI

`index.html` + `css/style.css` + `js/main.js`

## Purpose

Owns the workflow state machine and all persistence. Everything else
(`providers.js`, `checks.js`, `host.jsx`) is called from here; nothing
outside this module talks to `localStorage` or drives button state.

## Workflow state machine

Four buttons, strictly gated in sequence:

1. **Extract** — always enabled. Calls `extractTextFrames()` or
   `extractTextFramesMD()` in [[Host_Script]] depending on the "preserve
   formatting" checkbox. Populates `state.originals`, enables Translate.
2. **Translate** — disabled until Extract has run and returned at least one
   frame. Requires an API key (unless the provider is key-less, e.g.
   Ollama) and a target language. Populates `state.translated`, enables
   Apply.
3. **Apply** — disabled until Translate has produced output. Writes
   `state.translated` back via `applyTranslations()` /
   `applyTranslationsMD()`. Enables Check.
4. **Check** — disabled until Apply has run. Runs overset detection (via
   [[Host_Script]]) plus the two local heuristics in [[Checks]].

Re-running Extract resets `state.translated` and re-disables Apply/Check,
since a fresh extraction invalidates any prior translation's frame mapping.

## Batching

`chunkFrames(frames, maxChars)` splits frames into request-sized batches by
**total character count**, not item count — a handful of long paragraphs
shouldn't fill the same budget as many short callouts. This bounds the
LLM's reply size so it doesn't get truncated mid-JSON on large documents.
Default budget: 3000 chars/batch. Failed batches log an error and fall back
to the original (untranslated) text for just that batch's frames — one
bad batch doesn't abort the whole translate step.

## Persistence (`localStorage`)

All scoped by provider where relevant, so switching providers doesn't
clobber another provider's saved key/model:

| Key | Holds |
|---|---|
| `tcheck_provider` | last-selected provider |
| `tcheck_apikey_<provider>` | API key, per provider |
| `tcheck_model_<provider>` | model override, per provider |
| `tcheck_targetLang` | last-used target language |
| `tcheck_preserveFormatting` | checkbox state |

Keys are stored client-side in the panel's own local storage only — never
transmitted anywhere except directly to the selected provider's API as part
of the translate request.

## Style examples lookup

`loadStyleExamples(targetLang)` derives a language code from the typed
target language (`"German (de)"` → `de`, or lowercases/strips the whole
string if there's no parenthetical), reads every `.txt` under
`examples/<code>/` via Node's `fs`/`path` (available because the manifest
enables `--enable-nodejs`/`--mixed-context`), and concatenates them for
[[Providers]] to fold into the system prompt.

## Host script bootstrap

`loadHostScript()` explicitly `$.evalFile()`s `jsx/host.jsx` on panel load
and logs whether `extractTextFrames`/`extractTextFramesMD` registered as
functions — see [[../01_Architecture]] for why this isn't left to the
manifest's autoload.

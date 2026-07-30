# Illustrator Translate & Check

CEP panel for Adobe Illustrator that extracts text frames from a document,
sends them to an LLM for translation, writes the result back into the same
frames, and runs a handful of QA checks (overset text, leftover untranslated
strings, missing glyph support) — all without leaving Illustrator.

Panel-side JS drives the UI and calls the LLM provider directly over
`fetch`; an ExtendScript host (`jsx/host.jsx`) does the actual document
read/write inside Illustrator's scripting engine.

## Status

- Extract text frames (current selection, or whole document if nothing is
  selected)
- Translate via one of four providers: local Ollama, Claude, ChatGPT, Gemini
- Optional formatting-preserving mode — captures per-run font/size/color/
  underline/tracking as inline markers so mixed bold/regular text survives
  translation unchanged
- Apply translated text back to the original frames
- Per-language style examples (`examples/<lang-code>/*.txt`) fed to the LLM
  as house-style reference
- Checks: overset text frames, untranslated leftovers, font/script glyph
  support (heuristic registry, not real font introspection)

Full architecture and module docs live in [`docs/`](docs/) — start at
[`docs/00_Project_Vision.md`](docs/00_Project_Vision.md).

## Install

Tested on Apple Silicon Macs (M4 Pro, M4) with Illustrator 2024/2025+ (CEP 9,
`ILST` host version 25+).

1. **Copy the extension into Illustrator's CEP extensions folder:**

   ```sh
   mkdir -p ~/Library/Application\ Support/Adobe/CEP/extensions
   cp -R /path/to/IllustratorTranslateCheck \
     ~/Library/Application\ Support/Adobe/CEP/extensions/com.sgozel.translatecheck
   ```

2. **Enable CEP debug mode** so Illustrator loads this unsigned extension
   (it isn't packaged as a signed `.zxp`):

   ```sh
   defaults write com.adobe.CSXS.9 PlayerDebugMode 1
   defaults write com.adobe.CSXS.10 PlayerDebugMode 1
   defaults write com.adobe.CSXS.11 PlayerDebugMode 1
   ```

   Run all three — different Illustrator releases check different `CSXS.N`
   domains, and setting an unused one is harmless.

3. **Restart Illustrator.**

4. Open the panel from **Window → Extensions → Translate & Check**.

If it doesn't appear: quit Illustrator fully (not just close the document),
confirm the folder name under `CEP/extensions/` contains `CSXS/manifest.xml`
directly (no extra nesting), then relaunch.

## Usage

1. Select a target language (e.g. `German (de)`) and, if using a hosted
   provider, paste an API key — stored only in the panel's local storage on
   that machine.
2. **1. Extract text** — pulls text frames from the current selection, or
   the whole document if nothing is selected.
3. **2. Translate** — batches frames to the chosen provider (chunked by
   character count so long documents don't get cut off mid-reply).
4. **3. Apply to document** — writes translated text back into the same
   frames by index.
5. **4. Run checks** — flags overset frames, untranslated leftovers, and
   fonts that may not cover the scripts used in the translated text.

Providers:

| Provider | Needs API key | Notes |
|---|---|---|
| Ollama (local) | No | `http://localhost:11434`, default model `gemma4:26b` — no cost, nothing leaves the machine |
| Claude (Anthropic) | Yes | default model `claude-sonnet-5` |
| ChatGPT (OpenAI) | Yes | default model `gpt-4o` |
| Gemini (Google) | Yes | default model `gemini-2.5-flash` |

## Style examples

Drop approved `.txt` snippets in `examples/<lang-code>/` (folders already
present: `en`, `de`, `fr`, `cs`, `pl`, `nl`) to steer tone/terminology per
language. Empty or missing folder = default IEC/IEEE 82079 minimalist style
only. See `examples/README.txt`.

## Limitations

- Text-frame `id`s are index positions into `doc.textFrames` — the document
  must not gain/lose/reorder text frames between Extract and Apply.
- "Missing glyph support" is a manual font→script registry
  (`js/checks.js`), not real font introspection — Illustrator's scripting
  API can't query a font file's actual glyph coverage. Extend
  `FONT_SCRIPT_SUPPORT` for fonts not already listed.
- Formatting-preserving mode assumes source text has no literal `<<`/`>>`
  sequences.

# Roadmap: MVP (current, shipped)

Goal: replace the manual export/translate/paste/eyeball-check loop with an
in-document workflow. This scope is done and tested on Apple Silicon Macs
(M4 Pro, M4) against Illustrator 2024/2025 (CEP 9).

## Scope

- Extract text frames — selection-scoped or whole-document fallback
  ([[../modules/Host_Script]])
- Translate via four peer providers: Ollama (local), Claude, ChatGPT,
  Gemini ([[../modules/Providers]])
- Plain-text apply, and formatting-preserving apply (font/size/underline/
  tracking/color per run) ([[../modules/Host_Script]])
- Per-language style examples fed into the system prompt
  ([[../modules/Panel_UI]])
- Batching by character budget so large documents don't truncate a reply
  ([[../modules/Panel_UI]])
- Checks: overset text, leftover untranslated strings, font/script glyph
  coverage heuristic ([[../modules/Checks]])
- Provider/key/model/target-language persistence in the panel's local
  storage

## Explicitly out of scope for this phase

- Signed `.zxp` packaging/distribution — install is a manual folder copy
  plus enabling CEP debug mode (see the [README](../../README.md))
- Real font glyph-coverage introspection (registry-based heuristic only)
- Any guard against document structure changing between Extract and Apply

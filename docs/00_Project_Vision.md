# Illustrator Translate & Check — Project Vision

## Thesis

Translation of Illustrator artwork (labels, callouts, technical drawings) is
normally a copy-out/copy-in job: export text, hand it to a translator or an
LLM, paste it back, then manually re-check that nothing overflows its box,
nothing got left in the source language, and the chosen font can actually
render what came back. This panel collapses that loop into the document
itself — extract, translate, apply, and check all happen against the live
Illustrator DOM, in place.

## What it is

A CEP panel for Illustrator that:
- Extracts text frame contents (selection-scoped, or whole document)
- Sends them to an LLM (local or hosted) for translation, in a fixed
  technical/instructional style
- Writes the result back into the same frames, optionally preserving
  per-run character formatting
- Runs QA checks a human would otherwise do by eye: overset text, leftover
  untranslated strings, fonts that may not cover the translated script

## What it is not

- Not a general CAT (computer-assisted translation) tool — no translation
  memory, no segment database, no multi-file project management
- Not a font-introspection tool — glyph-coverage checking is a maintained
  registry (see [[modules/Checks]]), not real font-file parsing
- Not tied to one LLM vendor — provider is a thin adapter (see
  [[modules/Providers]]); local (Ollama) and hosted (Claude, ChatGPT,
  Gemini) are peers, not a default with fallbacks bolted on
- Not a signed, store-distributed extension — it's a debug-mode CEP panel,
  installed by copying a folder (see the [README](../README.md))

## Core architecture decision

CEP (Common Extensibility Platform), not UXP. Illustrator's UXP support
lags Photoshop/InDesign and did not cover the text-run-level character
attribute access this tool depends on at the time this was built. CEP's
ExtendScript host (`jsx/host.jsx`) has direct, mature access to
`textRange.characterAttributes` per character, which the formatting-
preservation feature requires. See [[01_Architecture]].

## Status

Working end-to-end: extract → translate → apply → check, both plain-text
and formatting-preserving modes. Tested on Apple Silicon Macs (M4 Pro, M4)
against Illustrator 2024/2025 (CEP 9). See [[roadmap/MVP]] for exact scope
and [[roadmap/Future]] for what's next.

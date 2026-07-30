# Module: Checks

`js/checks.js`, plus the overset check in [[Host_Script]]

## Purpose

QA passes that run after Apply, surfaced by the Check button in
[[Panel_UI]]. Three checks, two of which are pure and local (no
Illustrator round-trip beyond data already extracted):

1. **Overset text** — delegated entirely to `checkOverset()` in
   [[Host_Script]], since detecting clipped text requires manipulating the
   actual Illustrator frame (duplicate + convert to point text). This
   module just relays the result.
2. **Leftover untranslated text** (`checkLeftoverText`) — flags any frame
   whose translated contents are byte-identical to the original *and*
   contain at least one letter (`\p{L}`). Strings with no letters at all
   (part numbers, pure units, bare symbols) are skipped, since those are
   usually meant to stay identical across languages.
3. **Glyph/script support** (`runGlyphChecks` → `checkGlyphSupport`) — see
   below.

## Glyph/script support — important limitation

**This is not real font introspection.** Illustrator's scripting API has
no way to query which glyphs a font file actually contains. Instead:

- `SCRIPT_RANGES` — regex ranges detecting which Unicode scripts
  (Cyrillic, Greek, CJK, Hangul, Hiragana/Katakana, Arabic, Hebrew, Thai,
  Vietnamese-extended-Latin) appear in the translated text.
- `FONT_SCRIPT_SUPPORT` — a hand-maintained registry, keyed by the exact
  (lowercased) `fontFamily` string Illustrator reports, of which of those
  scripts each font is known to cover beyond basic Latin.

A frame is flagged when it uses a script not listed for its font in the
registry. **Extend `FONT_SCRIPT_SUPPORT` for whatever fonts your actual
manuals use** — an unlisted font is treated as covering nothing beyond
Latin, which will over-flag correctly-covered fonts just as easily as it
catches real gaps.

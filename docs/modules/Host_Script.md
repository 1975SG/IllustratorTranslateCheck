# Module: Host Script

`jsx/host.jsx` (ExtendScript, runs inside Illustrator's scripting engine)
plus `jsx/json2.js` (JSON polyfill — Illustrator's engine has no native
`JSON` object)

## Purpose

The only code in this project that touches the live Illustrator document.
Every function returns a JSON string (`{ok, ...}` or `{ok: false, error}`)
since ExtendScript calls cross the CEP bridge as strings.

## Frame selection

Both extraction functions share the same rule: use the current selection
if one exists (`doc.selection`), otherwise every unlocked/visible frame in
the document. `id` is always the frame's index within the full
`doc.textFrames` collection — not the selection — because Apply and the
overset check re-index that same full collection later. See the frame-
identity note in [[../01_Architecture]].

## Plain-text mode

`extractTextFrames()` / `applyTranslations()` — reads/writes `.contents`
only. Position, size, transform, and font are untouched.

## Formatting-preserving mode

`extractTextFramesMD()` / `applyTranslationsMD()` capture and restore a
per-character-run **fingerprint**: font, size, underline, tracking, and
color (RGB/CMYK/Gray/Spot, via `colorKey()`/`makeColorFromKey()`) — not
just bold/italic — so a third weight like "Black" headings, distinct from
inline "Bold" emphasis, isn't silently collapsed.

1. `getRuns(tf)` walks every character, grouping consecutive characters
   with an identical fingerprint into runs.
2. `computeBaseKey(runs)` picks whichever fingerprint covers the most
   characters in the frame as the "base" (unmarked) style — not
   necessarily the single longest contiguous run.
3. `buildLegendAndMarkdown(runs, baseKey)` wraps every non-base run in a
   uniquely numbered tag — `<<m1>>...<</m1>>`, `<<m2>>...<</m2>>` — and
   returns a `legend` mapping each tag to its fingerprint. See
   [[../01_Architecture]] for why numbered tags instead of Markdown `**`.
4. On the way back in, `parseMarkdown()` re-splits translated markdown
   into `{marker, text}` segments. A recognized opening tag whose matching
   close went missing (translator dropped/mangled it) is silently
   discarded — only that tag's own markup disappears; the wrapped words
   stay as ordinary (falls back to base-styled) text rather than leaking
   `<<mN>>` into the document or guessing where the span should end.
5. `applyFingerprintToRange()` reapplies font/size/underline/tracking/color
   per span. It clamps `endIdx` to the frame's actual character count as a
   defensive measure — a freshly assigned `.contents` string's character
   count can differ slightly from the JS-side string length (trailing
   story/paragraph markers), which would otherwise throw mid-loop and
   abort the whole frame.

**Assumption:** source text contains no literal `<<`/`>>` sequences. If a
document violates this, escaping would need to be added — not currently
handled.

## Overset detection

Illustrator's DOM has no `isOverset` flag. `hasOversetSingle(tf)` detects
it by duplicating the frame, converting the duplicate from area text to
point text (which never clips), and diffing contents against the original
(after stripping `\x03`/`\r` control characters). Any difference means the
area frame was clipping text. The duplicate is always removed in a
`finally` block. Only `TextType.AREATEXT` frames can overset this way —
point/path text frames return `false` unconditionally.

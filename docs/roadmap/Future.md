# Roadmap: Future (not scheduled)

Ideas recorded here so they don't get silently assumed as in-scope. None
have a committed timeline.

## Packaging & distribution

- Signed `.zxp` build (ZXPSignCmd) so the extension can be installed
  without enabling CEP debug mode — currently blocked on deciding whether
  this project stays personal-use or moves toward wider distribution
- UXP migration path, once Illustrator's UXP text-run character-attribute
  API reaches parity with what [[../modules/Host_Script]] depends on
  today (see the CEP-over-UXP decision in [[../01_Architecture]])

## Workflow safety

- Snapshot/guard against the document gaining, losing, or reordering text
  frames between Extract and Apply, instead of relying on the user not to
  edit mid-workflow (see the frame-identity note in [[../01_Architecture]])
- Undo-safety net: snapshot frame contents before Apply so a bad
  translation batch can be reverted from the panel, not just via
  Illustrator's own undo stack

## Checks

- Real font glyph-coverage checking (e.g. a `fonttools`/AFDKO sidecar
  reading the actual font file) to replace the hand-maintained
  `FONT_SCRIPT_SUPPORT` registry in [[../modules/Checks]]
- Surface which specific characters triggered a glyph-support flag, not
  just which script

## Providers

- Additional adapters (e.g. other local runtimes) — the peer-adapter shape
  in [[../modules/Providers]] should make this a small, additive change
- Streaming responses / progress indication for large batch translations

## UI

- Per-artboard scoping control, instead of relying on manual selection
  before Extract
- Batch progress bar / cancel for multi-chunk translate runs

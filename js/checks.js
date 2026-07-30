// Heuristic QA checks that run entirely in the panel (no LLM calls, no
// Illustrator round-trip needed except for the data already extracted).
//
// IMPORTANT LIMITATION: "missing glyph support" here is NOT real font
// introspection — Illustrator's scripting API has no way to query which
// glyphs a font file actually contains. This is a manual registry of which
// Unicode scripts each font family is known to cover. Extend
// FONT_SCRIPT_SUPPORT below for the fonts your manuals actually use.

const SCRIPT_RANGES = [
  { name: "Cyrillic", re: /[Ѐ-ӿ]/ },
  { name: "Greek", re: /[Ͱ-Ͽ]/ },
  { name: "CJK", re: /[㐀-鿿豈-﫿]/ },
  { name: "Hangul", re: /[가-힣]/ },
  { name: "Hiragana/Katakana", re: /[぀-ヿ]/ },
  { name: "Arabic", re: /[؀-ۿ]/ },
  { name: "Hebrew", re: /[֐-׿]/ },
  { name: "Thai", re: /[฀-๿]/ },
  { name: "Vietnamese-extended-Latin", re: /[Ạ-ỹ]/ }
];

// Fonts known to cover these scripts, beyond basic Latin. Add your own fonts here —
// key by the exact fontFamily string Illustrator reports (lowercased).
const FONT_SCRIPT_SUPPORT = {
  "arial": ["Cyrillic", "Greek", "Hebrew", "Arabic", "Vietnamese-extended-Latin"],
  "arial unicode ms": ["Cyrillic", "Greek", "CJK", "Hangul", "Hiragana/Katakana", "Arabic", "Hebrew", "Thai", "Vietnamese-extended-Latin"],
  "noto sans": ["Cyrillic", "Greek", "Vietnamese-extended-Latin"],
  "noto sans cjk": ["Cyrillic", "Greek", "CJK", "Hangul", "Hiragana/Katakana", "Vietnamese-extended-Latin"],
  "helvetica neue": ["Cyrillic", "Greek", "Vietnamese-extended-Latin"]
};

function scriptsUsed(text) {
  const found = [];
  for (const s of SCRIPT_RANGES) {
    if (s.re.test(text)) found.push(s.name);
  }
  return found;
}

// frame: {id, contents, fontFamily} -> null | {id, font, missingScripts}
function checkGlyphSupport(frame) {
  const used = scriptsUsed(frame.contents || "");
  if (used.length === 0) return null;
  const key = (frame.fontFamily || "").toLowerCase().trim();
  const supported = FONT_SCRIPT_SUPPORT[key] || [];
  const missing = used.filter(s => supported.indexOf(s) === -1);
  if (missing.length === 0) return null;
  return { id: frame.id, font: frame.fontFamily || "(unknown font)", missingScripts: missing };
}

function runGlyphChecks(translatedFrames) {
  return translatedFrames.map(checkGlyphSupport).filter(Boolean);
}

// originals/translated: [{id, contents}, ...] matched by id.
// Skips strings with no letters at all (part numbers, pure units, symbols)
// since those are usually meant to stay identical across languages.
function checkLeftoverText(originals, translated) {
  const originalById = {};
  originals.forEach(f => { originalById[f.id] = f.contents; });
  const hasLetter = /\p{L}/u;
  const flags = [];
  translated.forEach(f => {
    const before = originalById[f.id];
    if (before === undefined) return;
    if (f.contents === before && hasLetter.test(before)) {
      flags.push({ id: f.id, contents: f.contents });
    }
  });
  return flags;
}

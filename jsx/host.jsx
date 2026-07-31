#target illustrator

// ExtendScript has no native JSON object (confirmed: typeof JSON === "undefined"
// in Illustrator's engine), unlike modern browser/Node JS. Polyfill it.
if (typeof JSON === "undefined") {
    #include "json2.js"
}

function ensureDocument() {
    if (!app.documents.length) {
        throw new Error("No active document open in Illustrator.");
    }
    return app.activeDocument;
}

// Returns whichever text frames are currently selected, or every unlocked/
// visible text frame in the document if nothing is selected. "id" is always
// the frame's index within doc.textFrames (not the selection) — applyTranslations()
// and checkOverset() re-index that same full collection, so the document must
// not gain/lose/reorder text frames between calls.

// Tells whether/how a frame participates in the current selection:
//   null                    -> frame not part of the selection at all
//   { start: 0, end: null } -> frame is selected as a whole (Selection tool
//                              click on the frame itself, or Cmd+A with the
//                              Type tool active)
//   { start, end }          -> a dragged Type-tool selection covering only
//                              part of the frame's text (end is exclusive).
// doc.selection can contain TextRange items (dragged text — these carry real
// .start/.end, story-relative, so frameStart is subtracted back out to make
// them frame-relative) mixed with PageItem items (whole frames picked with
// the Selection tool). A TextRange match always wins over a coarser
// tf.selected/PageItem match when both are present, since it's the more
// precise signal — tf.selected alone can't be trusted to mean "whole frame"
// because Illustrator also flags the frame selected while text inside it is
// being partially selected with the Type tool.
function getFrameSelectionRange(tf, selection) {
    var frameStart = 0, frameLen = 0;
    try { frameStart = tf.textRange.start; } catch (e) {}
    try { frameLen = tf.textRange.characters.length; } catch (e) {}

    var textStart = null, textEnd = null;
    var wholeFrameSelected = false;

    for (var s = 0; s < selection.length; s++) {
        var item = selection[s];
        if (item === tf) { wholeFrameSelected = true; continue; }

        // Every property read below is on a live ExtendScript bridge object,
        // not a plain JS object — reading a property a given selection-item
        // type doesn't actually support (e.g. .start/.end on a PathItem, or
        // .story on something that isn't text at all) can throw instead of
        // quietly returning undefined, so each one gets its own try/catch
        // rather than relying on a bare "typeof item.start" to fail safely.
        var itemStart = null;
        try { itemStart = item.start; } catch (e) { itemStart = null; }
        var itemEnd = null;
        try { itemEnd = item.end; } catch (e) { itemEnd = null; }
        if (typeof itemStart !== "number" || typeof itemEnd !== "number") continue;

        var itemStory = null;
        try { itemStory = item.story; } catch (e) { itemStory = null; }
        var tfStory = null;
        try { tfStory = tf.story; } catch (e) { tfStory = null; }
        if (!itemStory || !tfStory || itemStory !== tfStory) continue;

        var s0 = Math.max(0, itemStart - frameStart);
        var e0 = Math.min(frameLen, itemEnd - frameStart);
        if (e0 <= s0) continue;
        if (textStart === null || s0 < textStart) textStart = s0;
        if (textEnd === null || e0 > textEnd) textEnd = e0;
    }

    if (textStart !== null) {
        if (textStart <= 0 && textEnd >= frameLen) return { start: 0, end: null };
        return { start: textStart, end: textEnd };
    }
    var isSelected = false;
    try { isSelected = tf.selected; } catch (e) { isSelected = false; }
    if (wholeFrameSelected || isSelected) return { start: 0, end: null };
    return null;
}

function extractTextFrames() {
    try {
        var doc = ensureDocument();
        var frames = doc.textFrames;
        var selection = doc.selection;
        var useSelection = selection && selection.length > 0;
        var out = [];
        for (var i = 0; i < frames.length; i++) {
            var tf = frames[i];
            if (tf.locked || tf.hidden) continue;
            var range = null;
            if (useSelection) {
                range = getFrameSelectionRange(tf, selection);
                if (range === null) continue;
            }
            var isPartial = !!(range && range.end !== null);
            var full = tf.contents;
            var contents = isPartial ? full.substring(range.start, range.end) : full;
            if (isPartial && contents === "") continue;
            var fontFamily = "";
            try {
                if (tf.textRange && tf.textRange.characters.length > 0) {
                    fontFamily = tf.textRange.characterAttributes.textFont.family;
                }
            } catch (e) {}
            out.push({
                id: i,
                kind: tf.kind.toString() + (isPartial ? " (selection)" : ""),
                contents: contents,
                fontFamily: fontFamily,
                rangeStart: isPartial ? range.start : null,
                rangeEnd: isPartial ? range.end : null
            });
        }
        return JSON.stringify({ ok: true, frames: out, usedSelection: useSelection, totalInDoc: frames.length });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

// payload: JSON string of [{id, contents, rangeStart, rangeEnd}, ...].
// When rangeStart/rangeEnd are present (a partial Type-tool selection at
// extraction time), only that slice of the frame's plain text is replaced —
// computed by splicing translated text into a fresh read of the frame's
// current full string, then writing the WHOLE string back, since Illustrator
// has no documented way to assign .contents to an arbitrary sub-range object.
// That means this — like whole-frame replacement below — does not guarantee
// per-character formatting survives on the untouched prefix/suffix; if that
// matters, use "Preserve character formatting" (applyTranslationsMD, which
// explicitly re-stripes prefix/selected/suffix from captured fingerprints).
// Frame position, size, and transform are untouched either way.
function applyTranslations(payload) {
    try {
        var doc = ensureDocument();
        var data = JSON.parse(payload);
        var frames = doc.textFrames;
        var applied = [];
        var errors = [];
        for (var i = 0; i < data.length; i++) {
            var item = data[i];
            var idx = item.id;
            if (idx < 0 || idx >= frames.length) {
                errors.push({ id: idx, error: "index out of range (document structure changed since extraction)" });
                continue;
            }
            try {
                var tf = frames[idx];
                if (typeof item.rangeStart === "number" && typeof item.rangeEnd === "number") {
                    var full = tf.contents;
                    var endIdx = Math.min(item.rangeEnd, full.length);
                    var startIdx = Math.min(item.rangeStart, endIdx);
                    tf.contents = full.substring(0, startIdx) + item.contents + full.substring(endIdx);
                } else {
                    tf.contents = item.contents;
                }
                applied.push(idx);
            } catch (e) {
                errors.push({ id: idx, error: e.toString() });
            }
        }
        return JSON.stringify({ ok: true, applied: applied, errors: errors });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

// Illustrator's scripting DOM has no direct "isOverset" flag. Detect it by
// duplicating the frame, converting the duplicate from area to point text
// (which never clips), and diffing contents. Any difference means the area
// frame was clipping text. Point/path text frames can't overset this way.
function hasOversetSingle(tf) {
    if (tf.kind !== TextType.AREATEXT) return false;
    var dup = null;
    try {
        dup = tf.duplicate();
        dup.convertAreaObjectToPointObject();
        var original = tf.contents.replace(/[\x03\r]/g, "");
        var converted = dup.contents.replace(/[\x03\r]/g, "");
        return converted !== original;
    } catch (e) {
        return false;
    } finally {
        if (dup) {
            try { dup.remove(); } catch (e2) {}
        }
    }
}

// ---- Markdown-formatted extraction/write-back ----
// Captures a run's full attribute fingerprint (font, size, color, underline,
// tracking) rather than just bold/italic, so styles beyond a simple two-level
// scheme (e.g. a third "Black" weight used for section headings, distinct from
// the "Bold" weight used for inline emphasis) are not silently collapsed.
// Assumption: source text does not contain literal "*" characters or the
// "<<" / ">>" marker delimiters. If that turns out to be false for some
// document, escaping will need to be added.

function colorKey(ca) {
    try {
        var c = ca.fillColor;
        if (c instanceof RGBColor) return "RGB:" + Math.round(c.red) + "," + Math.round(c.green) + "," + Math.round(c.blue);
        if (c instanceof CMYKColor) return "CMYK:" + Math.round(c.cyan) + "," + Math.round(c.magenta) + "," + Math.round(c.yellow) + "," + Math.round(c.black);
        if (c instanceof GrayColor) return "Gray:" + Math.round(c.gray);
        if (c instanceof SpotColor) return "Spot:" + c.spot.name + "," + Math.round(c.tint);
        return "Other";
    } catch (e) {
        return "Unknown";
    }
}

function getFingerprint(ca) {
    var fp = {};
    try { fp.font = ca.textFont.name; } catch (e) { fp.font = ""; }
    try { fp.size = Math.round(ca.size * 100) / 100; } catch (e) { fp.size = 0; }
    try { fp.underline = !!ca.underline; } catch (e) { fp.underline = false; }
    try { fp.tracking = ca.tracking; } catch (e) { fp.tracking = 0; }
    fp.color = colorKey(ca);
    return fp;
}

function fpKey(fp) {
    return fp.font + "|" + fp.size + "|" + fp.underline + "|" + fp.tracking + "|" + fp.color;
}

// Groups consecutive characters sharing an identical fingerprint into runs.
function getRuns(tf) {
    var chars = tf.textRange.characters;
    var n = chars.length;
    var runs = [];
    if (n === 0) return runs;
    var curFp = null, curKey = null, curText = "";
    for (var i = 0; i < n; i++) {
        var fp = getFingerprint(chars[i].characterAttributes);
        var key = fpKey(fp);
        if (key !== curKey) {
            if (curKey !== null) runs.push({ fp: curFp, key: curKey, text: curText });
            curFp = fp; curKey = key; curText = "";
        }
        curText += chars[i].contents;
    }
    runs.push({ fp: curFp, key: curKey, text: curText });
    return runs;
}

// The base/unmarked style is whichever fingerprint covers the most characters
// in the frame (not necessarily the single longest run).
function computeBaseKey(runs) {
    var totals = {};
    for (var i = 0; i < runs.length; i++) {
        totals[runs[i].key] = (totals[runs[i].key] || 0) + runs[i].text.length;
    }
    var bestKey = null, bestLen = -1;
    for (var k in totals) {
        if (totals[k] > bestLen) { bestLen = totals[k]; bestKey = k; }
    }
    return bestKey;
}

// Assigns a UNIQUE numbered tag to every non-base RUN OCCURRENCE (not one
// marker per distinct style) — <<m1>>...<</m1>>, <<m2>>...<</m2>>, etc. A
// frame with several headings sharing the same bold style still gets a
// separate tag per heading. This matters because a shared delimiter (like
// markdown's **) can't tell which opening tag a given closing tag belongs to:
// if a translator drops or shifts one closing "**" in a frame with several
// bold spans, the nearest-match parser pairs it with the WRONG opening tag,
// silently merging everything in between into one corrupted span. Named,
// numbered tags can only match their own pair, so a dropped/malformed tag
// affects only its own span (falls back to unmarked/base text) instead of
// cascading through the rest of the frame.
function buildLegendAndMarkdown(runs, baseKey) {
    var legend = {};
    var md = "";
    var counter = 0;
    for (var j = 0; j < runs.length; j++) {
        var r = runs[j];
        if (r.key === baseKey) {
            md += r.text;
        } else {
            counter++;
            var marker = "m" + counter;
            legend[marker] = r.fp;
            md += "<<" + marker + ">>" + r.text + "<</" + marker + ">>";
        }
    }
    return { markdown: md, legend: legend };
}

// Splits an ordered run list (as produced by getRuns, covering a whole
// frame's text end to end) into the portion before [start,end), the portion
// inside it, and the portion after — cutting individual runs in two where the
// boundary falls mid-run. "selected" keeps .key (needed by
// buildLegendAndMarkdown); prefix/suffix only need .fp/.text since they're
// never turned into markdown, just re-striped verbatim on apply.
function splitRunsByRange(runs, start, end) {
    var prefix = [], selected = [], suffix = [];
    var pos = 0;
    for (var i = 0; i < runs.length; i++) {
        var r = runs[i];
        var rStart = pos, rEnd = pos + r.text.length;
        pos = rEnd;
        if (rStart < start) {
            var pEnd = Math.min(rEnd, start);
            prefix.push({ fp: r.fp, text: r.text.substring(0, pEnd - rStart) });
        }
        var selStart = Math.max(rStart, start), selEnd = Math.min(rEnd, end);
        if (selStart < selEnd) {
            selected.push({ fp: r.fp, key: r.key, text: r.text.substring(selStart - rStart, selEnd - rStart) });
        }
        if (rEnd > end) {
            var sStart = Math.max(rStart, end);
            suffix.push({ fp: r.fp, text: r.text.substring(sStart - rStart) });
        }
    }
    return { prefix: prefix, selected: selected, suffix: suffix };
}

function extractTextFramesMD() {
    try {
        var doc = ensureDocument();
        var frames = doc.textFrames;
        var selection = doc.selection;
        var useSelection = selection && selection.length > 0;
        var out = [];
        for (var i = 0; i < frames.length; i++) {
            var tf = frames[i];
            if (tf.locked || tf.hidden) continue;
            var range = null;
            if (useSelection) {
                range = getFrameSelectionRange(tf, selection);
                if (range === null) continue;
            }
            var isPartial = !!(range && range.end !== null);
            // Fingerprint the WHOLE frame regardless of selection — needed
            // even for a partial selection, since applyTranslationsMD has to
            // re-stripe the untouched prefix/suffix after the frame-wide
            // .contents write that landing the translated text requires.
            var runs = getRuns(tf);
            if (runs.length === 0) {
                if (!isPartial) out.push({ id: i, kind: tf.kind.toString(), markdown: "", legend: {}, baseFingerprint: null });
                continue;
            }
            var baseKey = computeBaseKey(runs);
            var baseFp = null;
            for (var r = 0; r < runs.length; r++) {
                if (runs[r].key === baseKey) { baseFp = runs[r].fp; break; }
            }
            if (!isPartial) {
                var built = buildLegendAndMarkdown(runs, baseKey);
                out.push({
                    id: i,
                    kind: tf.kind.toString(),
                    markdown: built.markdown,
                    legend: built.legend,
                    baseFingerprint: baseFp
                });
                continue;
            }
            var split = splitRunsByRange(runs, range.start, range.end);
            if (split.selected.length === 0) continue;
            var selBuilt = buildLegendAndMarkdown(split.selected, baseKey);
            out.push({
                id: i,
                kind: tf.kind.toString() + " (selection)",
                markdown: selBuilt.markdown,
                legend: selBuilt.legend,
                baseFingerprint: baseFp,
                rangeStart: range.start,
                rangeEnd: range.end,
                prefixRuns: split.prefix,
                suffixRuns: split.suffix
            });
        }
        return JSON.stringify({ ok: true, frames: out, usedSelection: useSelection, totalInDoc: frames.length });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

// Parses "<<mN>>...<</mN>>" spans out of translated markdown into an ordered
// list of {marker, text} segments (marker is null for unmarked/base text).
// Each tag only matches its own numbered close tag, so a dropped or malformed
// tag can only affect its own span, instead of a generic delimiter (like
// markdown's **) accidentally pairing with an unrelated span further down and
// corrupting everything in between.
function parseMarkdown(md) {
    var segments = [];
    var i = 0;
    var n = md.length;
    var buf = "";
    function flushBase() {
        if (buf.length) { segments.push({ marker: null, text: buf }); buf = ""; }
    }
    while (i < n) {
        var ch = md.charAt(i);
        if (ch === "<" && md.substr(i, 2) === "<<") {
            var openEnd = md.indexOf(">>", i + 2);
            if (openEnd !== -1) {
                var markerId = md.substring(i + 2, openEnd);
                var closeTag = "<</" + markerId + ">>";
                var closeStart = md.indexOf(closeTag, openEnd + 2);
                if (closeStart !== -1) {
                    flushBase();
                    segments.push({ marker: markerId, text: md.substring(openEnd + 2, closeStart) });
                    i = closeStart + closeTag.length;
                    continue;
                }
                // Recognized opening tag but its matching close tag is
                // missing (translator dropped/mangled it) — silently skip
                // just the opening tag's own markup rather than leaking
                // "<<mN>>" into the visible text or guessing where the
                // (unknown) intended span should end. The wrapped words
                // themselves are untouched and continue as ordinary text.
                i = openEnd + 2;
                continue;
            }
            buf += ch; i++;
            continue;
        }
        buf += ch;
        i++;
    }
    flushBase();
    return segments;
}

function makeColorFromKey(key) {
    if (!key) return null;
    var parts = key.split(":");
    var kind = parts[0];
    if (kind === "RGB") {
        var rgb = parts[1].split(",");
        var c = new RGBColor();
        c.red = Number(rgb[0]); c.green = Number(rgb[1]); c.blue = Number(rgb[2]);
        return c;
    }
    if (kind === "CMYK") {
        var cmyk = parts[1].split(",");
        var c2 = new CMYKColor();
        c2.cyan = Number(cmyk[0]); c2.magenta = Number(cmyk[1]); c2.yellow = Number(cmyk[2]); c2.black = Number(cmyk[3]);
        return c2;
    }
    if (kind === "Gray") {
        var c3 = new GrayColor();
        c3.gray = Number(parts[1]);
        return c3;
    }
    if (kind === "Spot") {
        var sp = parts[1].split(",");
        try {
            var c4 = new SpotColor();
            c4.spot = app.activeDocument.spots.getByName(sp[0]);
            c4.tint = Number(sp[1]);
            return c4;
        } catch (e) { return null; }
    }
    return null;
}

function applyFingerprintToRange(tf, startIdx, endIdx, fp) {
    var font = null;
    if (fp.font) {
        try { font = app.textFonts.getByName(fp.font); } catch (e) { font = null; }
    }
    var color = makeColorFromKey(fp.color);
    // Defensive clamp: Illustrator's internal character count for a freshly
    // assigned .contents string can differ slightly from the JS-side length
    // (e.g. trailing story/paragraph markers), which would otherwise throw
    // an out-of-range scripting error mid-loop and abort the whole frame.
    var maxLen = tf.textRange.characters.length;
    if (endIdx > maxLen) endIdx = maxLen;
    for (var c = startIdx; c < endIdx; c++) {
        var ca = tf.textRange.characters[c].characterAttributes;
        if (font) ca.textFont = font;
        if (typeof fp.size === "number" && fp.size > 0) ca.size = fp.size;
        ca.underline = !!fp.underline;
        if (typeof fp.tracking === "number") ca.tracking = fp.tracking;
        if (color) ca.fillColor = color;
    }
}

function runsToText(runs) {
    var t = "";
    if (!runs) return t;
    for (var i = 0; i < runs.length; i++) t += runs[i].text;
    return t;
}

// Re-applies a captured prefix/suffix run list starting at a given character
// offset in the (already rewritten) frame — walks the runs in order, advancing
// the offset by each run's own text length as it goes.
function applyRunsToRange(tf, offset, runs) {
    if (!runs) return;
    var pos = offset;
    for (var i = 0; i < runs.length; i++) {
        var len = runs[i].text.length;
        if (len > 0) applyFingerprintToRange(tf, pos, pos + len, runs[i].fp);
        pos += len;
    }
}

// payload: JSON string of [{id, markdown, legend, baseFingerprint}, ...] as
// produced by extractTextFramesMD (markdown/legend/baseFingerprint carried
// through translation unchanged except for the text inside markers/base
// runs), plus optionally {rangeStart, rangeEnd, prefixRuns, suffixRuns} when
// extraction was scoped to a partial Type-tool selection. In that case the
// whole frame still has to be reassembled and rewritten in one .contents
// write (prefixText + translated selection + suffixText), because Illustrator
// has no documented way to assign .contents to an arbitrary sub-range — but
// prefixRuns/suffixRuns (captured BEFORE translation, never touched by the
// LLM) are re-striped onto the rebuilt string afterward, so the untouched
// parts of the frame come back with their exact original per-run formatting
// rather than collapsing to one style like a plain-mode apply would. Frame
// position, size, and transform are untouched.
function applyTranslationsMD(payload) {
    try {
        var doc = ensureDocument();
        var data = JSON.parse(payload);
        var frames = doc.textFrames;
        var applied = [];
        var errors = [];
        for (var i = 0; i < data.length; i++) {
            var item = data[i];
            var idx = item.id;
            if (idx < 0 || idx >= frames.length) {
                errors.push({ id: idx, error: "index out of range (document structure changed since extraction)" });
                continue;
            }
            try {
                var tf = frames[idx];
                var segments = parseMarkdown(item.markdown || "");
                var selectedText = "";
                var spans = [];
                for (var s = 0; s < segments.length; s++) {
                    var start = selectedText.length;
                    selectedText += segments[s].text;
                    if (segments[s].marker) {
                        spans.push({ marker: segments[s].marker, start: start, end: selectedText.length });
                    }
                }

                var isPartial = !!(item.prefixRuns || item.suffixRuns);
                var prefixText = isPartial ? runsToText(item.prefixRuns) : "";
                var suffixText = isPartial ? runsToText(item.suffixRuns) : "";
                var plainText = prefixText + selectedText + suffixText;

                tf.contents = plainText;

                if (isPartial) {
                    applyRunsToRange(tf, 0, item.prefixRuns);
                    if (item.baseFingerprint) {
                        applyFingerprintToRange(tf, prefixText.length, prefixText.length + selectedText.length, item.baseFingerprint);
                    }
                    for (var sp = 0; sp < spans.length; sp++) {
                        var fp = item.legend ? item.legend[spans[sp].marker] : null;
                        if (fp) applyFingerprintToRange(tf, prefixText.length + spans[sp].start, prefixText.length + spans[sp].end, fp);
                    }
                    applyRunsToRange(tf, prefixText.length + selectedText.length, item.suffixRuns);
                } else {
                    if (item.baseFingerprint) {
                        applyFingerprintToRange(tf, 0, plainText.length, item.baseFingerprint);
                    }
                    for (var sp2 = 0; sp2 < spans.length; sp2++) {
                        var fp2 = item.legend ? item.legend[spans[sp2].marker] : null;
                        if (fp2) applyFingerprintToRange(tf, spans[sp2].start, spans[sp2].end, fp2);
                    }
                }
                applied.push(idx);
            } catch (e) {
                errors.push({ id: idx, error: e.toString() });
            }
        }
        return JSON.stringify({ ok: true, applied: applied, errors: errors });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

function checkOverset() {
    try {
        var doc = ensureDocument();
        var frames = doc.textFrames;
        var out = [];
        for (var i = 0; i < frames.length; i++) {
            var tf = frames[i];
            if (tf.locked || tf.hidden) continue;
            out.push({ id: i, overset: hasOversetSingle(tf) });
        }
        return JSON.stringify({ ok: true, results: out });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

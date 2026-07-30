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
function isFrameInSelection(tf, selection) {
    for (var s = 0; s < selection.length; s++) {
        if (selection[s] === tf) return true;
    }
    return false;
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
            if (useSelection && !(tf.selected || isFrameInSelection(tf, selection))) continue;
            var fontFamily = "";
            try {
                if (tf.textRange && tf.textRange.characters.length > 0) {
                    fontFamily = tf.textRange.characterAttributes.textFont.family;
                }
            } catch (e) {}
            out.push({
                id: i,
                kind: tf.kind.toString(),
                contents: tf.contents,
                fontFamily: fontFamily
            });
        }
        return JSON.stringify({ ok: true, frames: out, usedSelection: useSelection, totalInDoc: frames.length });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

// payload: JSON string of [{id, contents}, ...]
// Only .contents is written — position, size, transform, and font are untouched.
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
                frames[idx].contents = item.contents;
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
            if (useSelection && !(tf.selected || isFrameInSelection(tf, selection))) continue;
            var runs = getRuns(tf);
            if (runs.length === 0) {
                out.push({ id: i, kind: tf.kind.toString(), markdown: "", legend: {}, baseFingerprint: null });
                continue;
            }
            var baseKey = computeBaseKey(runs);
            var baseFp = null;
            for (var r = 0; r < runs.length; r++) {
                if (runs[r].key === baseKey) { baseFp = runs[r].fp; break; }
            }
            var built = buildLegendAndMarkdown(runs, baseKey);
            out.push({
                id: i,
                kind: tf.kind.toString(),
                markdown: built.markdown,
                legend: built.legend,
                baseFingerprint: baseFp
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

// payload: JSON string of [{id, markdown, legend, baseFingerprint}, ...] as
// produced by extractTextFramesMD (markdown/legend/baseFingerprint carried
// through translation unchanged except for the text inside markers/base runs).
// Only .contents and character-level styling are written — position, size,
// and transform of the frame itself are untouched.
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
                var plainText = "";
                var spans = [];
                for (var s = 0; s < segments.length; s++) {
                    var start = plainText.length;
                    plainText += segments[s].text;
                    if (segments[s].marker) {
                        spans.push({ marker: segments[s].marker, start: start, end: plainText.length });
                    }
                }
                tf.contents = plainText;
                if (item.baseFingerprint) {
                    applyFingerprintToRange(tf, 0, plainText.length, item.baseFingerprint);
                }
                for (var sp = 0; sp < spans.length; sp++) {
                    var fp = item.legend ? item.legend[spans[sp].marker] : null;
                    if (fp) applyFingerprintToRange(tf, spans[sp].start, spans[sp].end, fp);
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

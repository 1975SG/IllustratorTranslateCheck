const cs = new CSInterface();
const logEl = document.getElementById("log");

const state = {
  originals: [],   // [{id, kind, contents, fontFamily}] or, with preserveFormatting,
                   // [{id, kind, contents /* markdown */, legend, baseFingerprint}]
  translated: []   // [{id, contents}]
};

function log(message, cls) {
  const div = document.createElement("div");
  div.className = "entry" + (cls ? " " + cls : "");
  div.textContent = message;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  logEl.innerHTML = "";
}

const fs = require("fs");
const path = require("path");

// getSystemPath() returns a file:// URI. On Windows that's "file:///C:/Users/..."
// — stripping just "file://" leaves a leading slash before the drive letter
// ("/C:/Users/...", not a valid Windows path) — so that case is stripped too.
function getExtensionRoot() {
  var p = cs.getSystemPath(SystemPath.EXTENSION).replace(/^file:\/\//, "");
  if (/^\/[a-zA-Z]:\//.test(p)) p = p.substring(1);
  return p;
}

// "German (de)" -> "de", "German" -> "german" — matches examples/<code>/ folder names.
function deriveLangCode(targetLang) {
  const paren = targetLang.match(/\(([^)]+)\)\s*$/);
  if (paren) return paren[1].trim().toLowerCase();
  return targetLang.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Reads every .txt file under examples/<langCode>/ and concatenates them.
// Returns "" if the folder doesn't exist or has no .txt files.
function loadStyleExamples(targetLang) {
  const code = deriveLangCode(targetLang);
  const dir = path.join(getExtensionRoot(), "examples", code);
  if (!fs.existsSync(dir)) return "";
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".txt"));
  if (!files.length) return "";
  return files
    .map(f => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n\n---\n\n");
}

function evalScriptAsync(script) {
  return new Promise((resolve) => cs.evalScript(script, resolve));
}

// --- provider / key persistence -------------------------------------------

const providerSel = document.getElementById("provider");
const apiKeyInput = document.getElementById("apiKey");
const modelInput = document.getElementById("model");
const targetLangInput = document.getElementById("targetLang");
const preserveFormattingInput = document.getElementById("preserveFormatting");

const apiKeyLabel = document.getElementById("apiKeyLabel");
const apiKeyHint = document.getElementById("apiKeyHint");

function loadProviderFields() {
  const p = providerSel.value;
  const provider = PROVIDERS[p];
  apiKeyInput.value = localStorage.getItem("tcheck_apikey_" + p) || "";
  modelInput.value = localStorage.getItem("tcheck_model_" + p) || "";
  modelInput.placeholder = "default: " + provider.defaultModel;

  const needsKey = provider.requiresKey !== false;
  apiKeyInput.disabled = !needsKey;
  apiKeyInput.placeholder = needsKey ? "paste your API key" : "not needed — runs locally";
  apiKeyLabel.textContent = needsKey ? "API key" : "API key (not needed)";
  apiKeyHint.textContent = needsKey
    ? "Stored only in this panel's local storage on this Mac, not synced anywhere."
    : "Ollama runs locally on this Mac — no key, no cost, no data leaves the machine.";
}

providerSel.addEventListener("change", loadProviderFields);
apiKeyInput.addEventListener("change", () => {
  localStorage.setItem("tcheck_apikey_" + providerSel.value, apiKeyInput.value);
});
modelInput.addEventListener("change", () => {
  localStorage.setItem("tcheck_model_" + providerSel.value, modelInput.value);
});
targetLangInput.addEventListener("change", () => {
  localStorage.setItem("tcheck_targetLang", targetLangInput.value);
});
targetLangInput.value = localStorage.getItem("tcheck_targetLang") || "";

preserveFormattingInput.addEventListener("change", () => {
  localStorage.setItem("tcheck_preserveFormatting", preserveFormattingInput.checked ? "1" : "");
});
preserveFormattingInput.checked = localStorage.getItem("tcheck_preserveFormatting") === "1";

const savedProvider = localStorage.getItem("tcheck_provider");
if (savedProvider) providerSel.value = savedProvider;
providerSel.addEventListener("change", () => {
  localStorage.setItem("tcheck_provider", providerSel.value);
});
loadProviderFields();

// --- buttons ----------------------------------------------------------------

const btnExtract = document.getElementById("btnExtract");
const btnTranslate = document.getElementById("btnTranslate");
const btnApply = document.getElementById("btnApply");
const btnCheck = document.getElementById("btnCheck");

btnExtract.addEventListener("click", async () => {
  clearLog();
  btnExtract.disabled = true;
  try {
    const preserveFormatting = preserveFormattingInput.checked;
    const raw = await evalScriptAsync(preserveFormatting ? "extractTextFramesMD()" : "extractTextFrames()");
    const res = JSON.parse(raw);
    if (!res.ok) throw new Error(res.error);
    // Normalize to a common {id, kind, contents, ...} shape regardless of mode,
    // so the translate step below can stay agnostic to which one ran.
    state.originals = preserveFormatting
      ? res.frames.map(f => ({
          id: f.id, kind: f.kind, contents: f.markdown, legend: f.legend, baseFingerprint: f.baseFingerprint,
          rangeStart: f.rangeStart, rangeEnd: f.rangeEnd, prefixRuns: f.prefixRuns, suffixRuns: f.suffixRuns
        }))
      : res.frames;
    state.translated = [];
    if (res.usedSelection) {
      log("Extracted " + res.frames.length + " of " + res.totalInDoc + " text frame(s) — using current selection.", "ok");
    } else {
      log("Extracted " + res.frames.length + " text frame(s) — no selection, used the whole document. " +
        "Select specific frames/artboards before extracting to scope it down.", "warn");
    }
    state.originals.forEach(f => log("  #" + f.id + " [" + f.kind + "] " + truncate(f.contents), "info"));
    btnTranslate.disabled = res.frames.length === 0;
    btnApply.disabled = true;
    btnCheck.disabled = true;
  } catch (e) {
    log("Extract failed: " + e.message, "bad");
  } finally {
    btnExtract.disabled = false;
  }
});

// Splits frames into chunks bounded by total character count, not just item
// count, so a handful of long paragraphs don't blow the same budget as many
// short callouts. Keeps single LLM calls small enough that the model's reply
// (translating + echoing every fragment as JSON) doesn't get cut off mid-output.
function chunkFrames(frames, maxChars) {
  const chunks = [];
  let current = [];
  let currentChars = 0;
  frames.forEach(f => {
    const len = (f.contents || "").length;
    if (current.length && currentChars + len > maxChars) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(f);
    currentChars += len;
  });
  if (current.length) chunks.push(current);
  return chunks;
}

btnTranslate.addEventListener("click", async () => {
  if (!state.originals.length) return;
  const provider = providerSel.value;
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim();
  const targetLang = targetLangInput.value.trim();

  if (!apiKey && PROVIDERS[provider].requiresKey !== false) { log("Enter an API key first.", "bad"); return; }
  if (!targetLang) { log("Enter a target language first.", "bad"); return; }

  btnTranslate.disabled = true;
  let styleExamples = "";
  try {
    styleExamples = loadStyleExamples(targetLang);
  } catch (e) {
    log("Could not read style examples folder: " + e.message, "warn");
  }
  if (styleExamples) {
    log("Using style examples from examples/" + deriveLangCode(targetLang) + "/", "info");
  }
  const chunks = chunkFrames(state.originals, 3000);
  if (chunks.length > 1) {
    log("Splitting into " + chunks.length + " batch(es) to keep replies from being cut off.", "info");
  }
  try {
    const byId = {};
    for (let i = 0; i < chunks.length; i++) {
      log("Calling " + PROVIDERS[provider].label + " (" + (i + 1) + "/" + chunks.length + ", " +
        chunks[i].length + " fragment(s))...", "info");
      try {
        const result = await translateBatch(provider, apiKey, model, chunks[i], targetLang, styleExamples, preserveFormattingInput.checked);
        result.forEach(r => { byId[r.id] = r.contents; });
      } catch (e) {
        log("Batch " + (i + 1) + "/" + chunks.length + " failed: " + e.message + " — keeping originals for it.", "bad");
      }
    }

    const missing = state.originals.filter(f => byId[f.id] === undefined);
    if (missing.length) {
      log("Warning: " + missing.length + " fragment(s) came back untranslated (omitted or batch failure), keeping originals for those.", "warn");
    }

    state.translated = state.originals.map(f => ({
      id: f.id,
      contents: byId[f.id] !== undefined ? byId[f.id] : f.contents,
      rangeStart: f.rangeStart,
      rangeEnd: f.rangeEnd
    }));

    log("Translation preview:", "ok");
    state.originals.forEach(f => {
      const t = byId[f.id];
      if (t !== undefined && t !== f.contents) {
        log("  #" + f.id + ": " + truncate(f.contents) + "  ->  " + truncate(t), "info");
      }
    });

    btnApply.disabled = false;
  } catch (e) {
    log("Translate failed: " + e.message, "bad");
  } finally {
    btnTranslate.disabled = false;
  }
});

btnApply.addEventListener("click", async () => {
  if (!state.translated.length) return;
  btnApply.disabled = true;
  try {
    const preserveFormatting = preserveFormattingInput.checked;
    let payload;
    if (preserveFormatting) {
      const originalById = {};
      state.originals.forEach(f => { originalById[f.id] = f; });
      payload = state.translated.map(t => ({
        id: t.id,
        markdown: t.contents,
        legend: originalById[t.id] && originalById[t.id].legend,
        baseFingerprint: originalById[t.id] && originalById[t.id].baseFingerprint,
        prefixRuns: originalById[t.id] && originalById[t.id].prefixRuns,
        suffixRuns: originalById[t.id] && originalById[t.id].suffixRuns
      }));
    } else {
      payload = state.translated;
    }
    const script = (preserveFormatting ? "applyTranslationsMD(" : "applyTranslations(") + JSON.stringify(JSON.stringify(payload)) + ")";
    const raw = await evalScriptAsync(script);
    const res = JSON.parse(raw);
    if (!res.ok) throw new Error(res.error);
    log("Applied " + res.applied.length + " frame(s) to the document.", "ok");
    if (res.errors.length) {
      res.errors.forEach(e => log("  #" + e.id + " failed: " + e.error, "bad"));
    }
    btnCheck.disabled = false;
  } catch (e) {
    log("Apply failed: " + e.message, "bad");
  } finally {
    btnApply.disabled = false;
  }
});

btnCheck.addEventListener("click", async () => {
  log("Running checks...", "info");
  try {
    const oversetRaw = await evalScriptAsync("checkOverset()");
    const oversetRes = JSON.parse(oversetRaw);
    if (!oversetRes.ok) throw new Error(oversetRes.error);
    const oversetFlagged = oversetRes.results.filter(r => r.overset);
    if (oversetFlagged.length) {
      oversetFlagged.forEach(r => log("OVERSET  #" + r.id + " no longer fits its text box.", "bad"));
    } else {
      log("No overset text frames found.", "ok");
    }

    const leftover = checkLeftoverText(state.originals, state.translated);
    if (leftover.length) {
      leftover.forEach(f => log("UNTRANSLATED  #" + f.id + ": " + truncate(f.contents), "bad"));
    } else {
      log("No untranslated leftover text found.", "ok");
    }

    const fontById = {};
    state.originals.forEach(f => { fontById[f.id] = f.fontFamily; });
    const glyphInput = state.translated.map(f => ({ id: f.id, contents: f.contents, fontFamily: fontById[f.id] }));
    const glyphFlags = runGlyphChecks(glyphInput);
    if (glyphFlags.length) {
      glyphFlags.forEach(f => log("GLYPH  #" + f.id + " font \"" + f.font + "\" may not support: " + f.missingScripts.join(", "), "warn"));
    } else {
      log("No known glyph-support issues found.", "ok");
    }
  } catch (e) {
    log("Check failed: " + e.message, "bad");
  }
});

function truncate(s, n) {
  n = n || 60;
  s = (s || "").replace(/\r/g, " ⏎ ");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// The manifest's <ScriptPath> auto-load did not reliably register host.jsx's
// top-level functions in this CEP/Illustrator combo, so load it explicitly.
// getSystemPath() can return a "file://" URI rather than a plain POSIX path,
// which $.evalFile() cannot open, so strip that prefix if present.
async function loadHostScript() {
  const jsxPath = (getExtensionRoot() + "/jsx/host.jsx").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  log("Loading host script from: " + jsxPath, "info");
  const result = await evalScriptAsync('$.evalFile("' + jsxPath + '")');
  const check = await evalScriptAsync("typeof extractTextFrames");
  const checkMD = await evalScriptAsync("typeof extractTextFramesMD");
  log("host.jsx load result: " + result + " | extractTextFrames is " + check +
    " | extractTextFramesMD is " + checkMD, (check === "function" && checkMD === "function") ? "ok" : "bad");
}
loadHostScript();

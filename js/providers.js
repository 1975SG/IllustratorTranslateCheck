// Thin fetch-based adapters for the three LLM providers. Each adapter only
// builds the request and extracts the reply text — response shape differs
// per provider, everything else (prompt, batching, JSON re-parsing) is shared.

const PROVIDERS = {
  ollama: {
    label: "Local (Ollama)",
    endpoint: "http://localhost:11434/v1/chat/completions",
    defaultModel: "gemma4:26b",
    requiresKey: false,
    buildRequest(apiKey, model, systemPrompt, userPrompt) {
      return {
        url: this.endpoint,
        options: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // Ollama's OpenAI-compatible endpoint requires the header to be
            // present but ignores its value.
            "authorization": "Bearer ollama"
          },
          body: JSON.stringify({
            model: model || this.defaultModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ]
          })
        }
      };
    },
    extractText(json) {
      return json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    }
  },

  claude: {
    label: "Claude (Anthropic)",
    endpoint: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-sonnet-5",
    buildRequest(apiKey, model, systemPrompt, userPrompt) {
      return {
        url: this.endpoint,
        options: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            // Required for direct browser/CEP-panel calls, not just server-side use.
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify({
            model: model || this.defaultModel,
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }]
          })
        }
      };
    },
    extractText(json) {
      return json.content && json.content[0] && json.content[0].text;
    }
  },

  openai: {
    label: "ChatGPT (OpenAI)",
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o",
    buildRequest(apiKey, model, systemPrompt, userPrompt) {
      return {
        url: this.endpoint,
        options: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "authorization": "Bearer " + apiKey
          },
          body: JSON.stringify({
            model: model || this.defaultModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ]
          })
        }
      };
    },
    extractText(json) {
      return json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    }
  },

  gemini: {
    label: "Gemini (Google)",
    defaultModel: "gemini-2.5-flash",
    endpointFor(model, apiKey) {
      return "https://generativelanguage.googleapis.com/v1beta/models/" +
        (model || this.defaultModel) + ":generateContent?key=" + encodeURIComponent(apiKey);
    },
    buildRequest(apiKey, model, systemPrompt, userPrompt) {
      return {
        url: this.endpointFor(model, apiKey),
        options: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }]
          })
        }
      };
    },
    extractText(json) {
      return json.candidates && json.candidates[0] && json.candidates[0].content &&
        json.candidates[0].content.parts && json.candidates[0].content.parts[0] &&
        json.candidates[0].content.parts[0].text;
    }
  }
};

const DEFAULT_TRANSLATE_SYSTEM_PROMPT =
  "You are a precise technical translator for product manuals and technical drawings.\n" +
  "Write in the IEC/IEEE 82079 minimalist style for instructions-for-use:\n" +
  "- short, formal, and strictly logical — one instruction or fact per sentence\n" +
  "- imperative mood for actions (\"Press the button\", not \"The button should be pressed\")\n" +
  "- plain, literal wording — no marketing language, no filler, no rhetorical variation\n" +
  "- consistent terminology: the same source term must always get the same translation\n" +
  "- keep warnings/cautions unambiguous and structurally distinct from regular steps\n\n" +
  "You will receive a JSON array of text fragments, each with a stable \"id\".\n" +
  "Translate each \"contents\" string into the requested target language, preserving:\n" +
  "- line breaks exactly as given\n" +
  "- numbers, units, part numbers, and placeholder tokens exactly as-is\n" +
  "- terse callout/label style (do not expand into full sentences)\n" +
  "Reply with ONLY a JSON array of the same length, each item: " +
  "{\"id\": <same id>, \"contents\": \"<translated text>\"}. No prose, no markdown fences.";

const FORMATTING_MARKERS_INSTRUCTION =
  "\n\nSome fragments contain inline formatting tags like <<m1>>marked text<</m1>>, " +
  "<<m2>>other text<</m2>>, etc. — each numbered tag is unique and marks character-level " +
  "styling from the original document. For every tag: keep its exact opening and closing " +
  "form (e.g. <<m3>> ... <</m3>>, same number on both ends), wrapped tightly around the " +
  "corresponding translated word(s) or phrase, repositioned to wherever that phrase falls " +
  "in the translated sentence. Never merge two different-numbered tags into one, never drop " +
  "a closing tag, never reuse a number for a different span, and never translate the tag " +
  "syntax itself.";

// frames: [{id, contents}, ...] -> resolves to [{id, contents}, ...] translated
// styleExamples: optional string of approved reference text in the target language
// preserveFormatting: true when contents carries inline **bold**/*italic*/<<sN>> markers
// (from extractTextFramesMD) that must survive translation untouched.
async function translateBatch(providerKey, apiKey, model, frames, targetLang, styleExamples, preserveFormatting) {
  const provider = PROVIDERS[providerKey];
  if (!provider) throw new Error("Unknown provider: " + providerKey);
  if (!apiKey && provider.requiresKey !== false) throw new Error(provider.label + " API key is empty.");

  let systemPrompt = DEFAULT_TRANSLATE_SYSTEM_PROMPT;
  if (preserveFormatting) {
    systemPrompt += FORMATTING_MARKERS_INSTRUCTION;
  }
  if (styleExamples && styleExamples.trim()) {
    systemPrompt += "\n\nMatch the tone, sentence structure, and terminology of these " +
      "approved reference examples in the target language:\n\n" + styleExamples.trim();
  }

  const userPrompt = "Target language: " + targetLang + "\n\nFragments:\n" +
    JSON.stringify(frames.map(f => ({ id: f.id, contents: f.contents })));

  const req = provider.buildRequest(apiKey, model, systemPrompt, userPrompt);
  const res = await fetch(req.url, req.options);
  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(provider.label + " API error " + res.status + ": " + rawText.slice(0, 500));
  }

  let json;
  try {
    json = JSON.parse(rawText);
  } catch (e) {
    throw new Error(provider.label + " returned a non-JSON response.");
  }

  const text = provider.extractText(json);
  if (!text) throw new Error(provider.label + " response had no text content.");

  const cleaned = text.trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```$/, "");

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error("Could not parse " + provider.label + " reply as JSON: " + e.message);
  }
}

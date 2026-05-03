/**
 * EVGCPL Portal — AI Proxy
 * 
 * Add this to your existing Apps Script project (the one at exec URL
 * AKfycbxajus...). It wires a `aiProxy` action handler into doPost.
 *
 * SETUP (one-time, ~3 minutes):
 *   1. Get a Groq API key:
 *      → console.groq.com → API Keys → Create API Key → copy
 *   2. In Apps Script editor:
 *      → Project Settings (gear icon) → Script Properties → Add property
 *      → Property: GROQ_API_KEY     Value: <paste your gsk_xxx key>
 *      → (optional) Property: GEMINI_API_KEY  Value: <gemini key as fallback>
 *   3. Save the script (Ctrl+S)
 *   4. Deploy → Manage Deployments → click pencil on Active deployment
 *      → Version: New version → Deploy
 *   5. Exec URL stays the same. Done.
 *
 * USAGE FROM PORTAL:
 *   The portal's AI Chat panel calls this automatically. Domain data
 *   (Accounts/Purchase/Stores/etc rows as CSV) is appended to the
 *   system prompt before sending. Groq receives the question + the
 *   relevant rows and answers from them.
 *
 * MODEL CHOICE:
 *   - Groq llama-3.3-70b-versatile: fast (~500 tok/sec), 128K context,
 *     free tier of 30 req/min. Good for production.
 *   - Gemini 1.5 Flash: free tier, slightly slower, also 1M context.
 *     Used as fallback if GROQ_API_KEY is missing.
 *
 * RATE LIMITS:
 *   Groq free: 30 req/min, 14K tokens/min. Plenty for an internal tool.
 *   If you hit limits often, upgrade to Groq's paid tier (~$0.05 per
 *   million tokens — ~₹4) or self-host Llama via Ollama.
 */

// ──────────────────────────────────────────────────────────────────
//  Wire this into your existing doPost(e) function.
//  Add a case for 'aiProxy' in your action switch:
//
//    function doPost(e) {
//      const data = JSON.parse(e.postData.contents);
//      switch (data.action) {
//        case 'appendRow':  return appendRow(data);
//        case 'updateCell': return updateCell(data);
//        case 'aiProxy':    return aiProxy(data);   // ← add this
//        // ... other actions
//      }
//    }
// ──────────────────────────────────────────────────────────────────

function aiProxy(data) {
  const { system, messages } = data;
  if (!messages || !messages.length) {
    return jsonResponse({ success: false, error: { message: 'No messages provided' } });
  }

  const props = PropertiesService.getScriptProperties();
  const groqKey   = props.getProperty('GROQ_API_KEY');
  const geminiKey = props.getProperty('GEMINI_API_KEY');

  // Prefer Groq, fall back to Gemini
  if (groqKey) {
    try {
      return aiProxyGroq(system, messages, groqKey);
    } catch (err) {
      Logger.log('Groq failed, trying Gemini: ' + err);
      if (geminiKey) return aiProxyGemini(system, messages, geminiKey);
      return jsonResponse({ success: false, error: { message: 'Groq error: ' + err.message } });
    }
  }
  if (geminiKey) return aiProxyGemini(system, messages, geminiKey);

  return jsonResponse({
    success: false,
    error: { message: 'No AI key configured. Set GROQ_API_KEY in Script Properties.' }
  });
}

/**
 * Call Groq's OpenAI-compatible chat completions endpoint.
 * Llama 3.3 70B Versatile — fast, 128K context, current default.
 */
function aiProxyGroq(systemPrompt, messages, apiKey) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const payload = {
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt || 'You are a helpful EVGCPL assistant.' },
      ...messages,
    ],
    temperature: 0.2,           // low temp = factual / deterministic
    max_tokens: 1000,
    top_p: 0.9,
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code !== 200) {
    throw new Error('Groq HTTP ' + code + ': ' + text.slice(0, 200));
  }

  const result = JSON.parse(text);
  const reply = result.choices && result.choices[0] && result.choices[0].message
    ? result.choices[0].message.content
    : '(no response)';

  return jsonResponse({
    success: true,
    reply: reply,
    model: 'groq/llama-3.3-70b-versatile',
    usage: result.usage,
  });
}

/**
 * Call Google's Gemini API. Fallback when Groq isn't configured or
 * fails. Free tier is generous; quality slightly behind Llama 3.3 for
 * structured-data Q&A but still good.
 */
function aiProxyGemini(systemPrompt, messages, apiKey) {
  const model = 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Gemini wants the system prompt baked into the first user message
  const combined = (systemPrompt ? systemPrompt + '\n\n' : '') +
    messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

  const payload = {
    contents: [{ parts: [{ text: combined }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1000 },
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code !== 200) {
    return jsonResponse({ success: false, error: { message: 'Gemini HTTP ' + code + ': ' + text.slice(0, 200) }});
  }

  const result = JSON.parse(text);
  const reply = result.candidates &&
                result.candidates[0] &&
                result.candidates[0].content &&
                result.candidates[0].content.parts &&
                result.candidates[0].content.parts[0]
    ? result.candidates[0].content.parts[0].text
    : '(no response)';

  return jsonResponse({
    success: true,
    reply: reply,
    model: 'gemini-1.5-flash',
  });
}

// Helper — JSON response with proper MIME type for the portal frontend
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Optional: a quick test you can run from the editor.
 * Run it once after setup to confirm Groq is reachable.
 *
 *   1. Click on testAiProxy in the function dropdown
 *   2. Click Run
 *   3. View → Logs (Ctrl+Enter) → should show a sensible answer
 */
function testAiProxy() {
  const result = aiProxy({
    system: 'You are an EVGCPL assistant. Answer briefly.',
    messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
  });
  Logger.log(result.getContent());
}

// =====================================================
// IS Plan Viewer — Schedule AI Extraction
// =====================================================
// Extracts HVAC equipment from mechanical schedule images.
// Supports: Gemini (default/free), OpenAI, any compatible API.
// =====================================================

const CONFIG_KEY = 'isplan_schedule_ai_config';

function getConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}; } catch { return {}; }
}
function saveConfig(cfg) { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); }

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.onerror = rej;
    reader.readAsDataURL(blob);
  });
}

// Strip the data URL prefix to get raw base64
function stripDataUrl(dataUrl) {
  return dataUrl.replace(/^data:[^;]+;base64,/, '');
}

// Detect provider from API key format
function detectProvider(apiKey) {
  if (!apiKey) return 'none';
  if (apiKey.startsWith('AIza')) return 'gemini';
  if (apiKey.startsWith('sk-')) return 'openai';
  return 'openai'; // default fallback
}

// ── Extraction prompt ─────────────────────────────────

const EXTRACTION_PROMPT = `You are an expert HVAC estimator analyzing a mechanical equipment schedule from construction drawings.

Your job: extract every piece of equipment from this schedule into structured JSON.

This is a standard mechanical schedule — typically a table with columns for equipment designation, capacity, airflow, electrical, and model info. Schedules may be titled "HVAC Equipment Schedule", "Mechanical Schedule", "Rooftop Unit Schedule", "Fan Schedule", "Air Handler Schedule", etc.

For EACH equipment entry, extract these fields in order of priority:

=== PRIMARY FIELDS (critical — always extract these) ===
- "tag": Equipment tag/designation (e.g., "RTU-1", "AHU-2", "EF-3", "MAU-1", "FCU-1", "HP-1", "CU-1", "ERV-1")
- "type": Equipment type. Standardize to one of: "Rooftop Unit", "Air Handler", "Exhaust Fan", "Makeup Air Unit", "Fan Coil Unit", "Heat Pump", "Mini Split", "Condensing Unit", "ERV", "HRV", "Unit Heater", "Cabinet Heater", "VAV Box", "WSHP", "PTAC", "Package Unit", "Split System". Use the closest match.
- "tonnage": Cooling capacity in tons (number). Convert from BTU if needed: BTU/12000 = tons. null if not listed.
- "cfm": Supply airflow in CFM (number). Use the supply/total CFM, not outdoor air. null if not listed.
- "model": Full model number as shown (string). This is critical for procurement.
- "manufacturer": Brand/manufacturer name (string). Common: Carrier, Trane, Lennox, AAON, Daikin, Mitsubishi, LG, York, Rheem, Bard.

=== SECONDARY FIELDS (important for coordination) ===
- "heating": Heating type and capacity (e.g., "250 MBH Gas", "15 kW Electric", "Heat Pump", null)
- "voltage": Electrical requirements as shown (e.g., "208/3/60", "460/3/60", "120/1/60", null)
- "refrigerant": Refrigerant type (e.g., "R-410A", "R-32", "R-454B", null)
- "mca": Minimum circuit ampacity if shown (number or null)
- "mocp": Maximum overcurrent protection if shown (number or null)

=== SKIP THESE (do not extract) ===
- Entering/leaving air temperatures
- Discharge air temperatures
- Sound ratings/NC levels
- Weight
- Filter sizes (unless no other data exists for the row)
- Coil specifications
- Drain connection sizes

Rules:
1. Each ROW in the schedule = one equipment entry. Do not merge or skip rows.
2. If a tag appears multiple times (e.g., "FCU-1" through "FCU-12"), create separate entries for each unique tag. If a range is shown ("FCU-1 THRU FCU-12"), expand into individual entries with the same specs.
3. If you can partially read a field, include what you can. Use null only if truly unreadable.
4. Model numbers often contain dashes, slashes, and mixed case — preserve exactly as shown.
5. Some schedules split into multiple tables on one page (e.g., RTU schedule + fan schedule). Extract from ALL tables.

Return ONLY a JSON array. No markdown fencing, no explanation text, just the raw array.
Example: [{"tag":"RTU-1","type":"Rooftop Unit","tonnage":10,"cfm":4000,"model":"RN-048-3-0-0-A00","manufacturer":"AAON","heating":"150 MBH Gas","voltage":"208/3/60","refrigerant":"R-410A","mca":42,"mocp":60}]`;

// ── Gemini API ────────────────────────────────────────

async function callGemini(base64DataUrl, config) {
  const apiKey = config.apiKey;
  const model = config.model || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const rawBase64 = stripDataUrl(base64DataUrl);
  // Detect mime type from data URL
  const mimeMatch = base64DataUrl.match(/^data:([^;]+);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

  const body = {
    contents: [{
      parts: [
        { text: EXTRACTION_PROMPT },
        { inline_data: { mime_type: mimeType, data: rawBase64 } }
      ]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4000 }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseEquipmentJSON(content);
}

// ── OpenAI-compatible API ─────────────────────────────

async function callOpenAI(base64DataUrl, config) {
  const apiKey = config.apiKey;
  const endpoint = config.endpoint || 'https://api.openai.com/v1/chat/completions';
  const model = config.model || 'gpt-4o';

  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: EXTRACTION_PROMPT },
        { type: 'image_url', image_url: { url: base64DataUrl, detail: 'high' } }
      ]
    }],
    max_tokens: 4000,
    temperature: 0.1,
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  return parseEquipmentJSON(content);
}

// ── JSON parser (handles markdown-wrapped responses) ──

function parseEquipmentJSON(content) {
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Could not parse equipment list from AI response.');
  return JSON.parse(jsonMatch[0]);
}

// ── Public API ────────────────────────────────────────

const ScheduleAI = {

  async extract(blob, onStatus) {
    const config = getConfig();
    if (!config.apiKey) throw new Error('NO_API_KEY');

    const provider = config.provider || detectProvider(config.apiKey);

    onStatus?.('Converting image...');
    const base64 = await blobToBase64(blob);

    onStatus?.(`Sending to ${provider === 'gemini' ? 'Gemini' : 'OpenAI'} vision...`);
    const equipment = provider === 'gemini'
      ? await callGemini(base64, config)
      : await callOpenAI(base64, config);

    onStatus?.(`Found ${equipment.length} equipment entries`);
    return equipment;
  },

  equipmentToSymbols(equipment) {
    const COLORS = ['#4dabf7','#69db7c','#ffd43b','#da77f2','#ff8787','#a9e34b','#ffa94d','#74c0fc','#f783ac','#63e6be','#d0bfff','#ffc078'];
    return equipment.map((eq, i) => {
      // Build a concise but informative description from primary fields
      const descParts = [eq.type];
      if (eq.manufacturer) descParts.push(eq.manufacturer);
      if (eq.tonnage) descParts.push(eq.tonnage + ' ton');
      if (eq.cfm) descParts.push(eq.cfm + ' CFM');
      return {
        tag: (eq.tag || '').toUpperCase(),
        description: descParts.filter(Boolean).join(' · '),
        color: COLORS[i % COLORS.length],
        // Full equipment record for downstream reference
        equipment: {
          type: eq.type || null,
          tonnage: eq.tonnage || null,
          cfm: eq.cfm || null,
          model: eq.model || null,
          manufacturer: eq.manufacturer || null,
          heating: eq.heating || null,
          voltage: eq.voltage || null,
          refrigerant: eq.refrigerant || null,
          mca: eq.mca || null,
          mocp: eq.mocp || null,
        }
      };
    }).filter(s => s.tag);
  },

  getConfig, saveConfig,
  isConfigured() { return !!getConfig().apiKey; },

  renderConfigUI() {
    const cfg = getConfig();
    const provider = cfg.provider || detectProvider(cfg.apiKey);
    return `
      <div style="padding:8px 0">
        <label style="display:block;font-size:11px;color:#a0a0c0;margin-bottom:3px">Provider</label>
        <select id="aiCfgProvider" style="width:100%;background:#1a1a2e;border:1px solid #0f3460;color:#e0e0e0;padding:6px 10px;border-radius:4px;font-size:12px;margin-bottom:8px" onchange="document.getElementById('aiCfgHint').textContent={'gemini':'Free — get key at aistudio.google.com/apikey','openai':'Pay-per-use — platform.openai.com/api-keys'}[this.value]||''">
          <option value="gemini"${provider === 'gemini' ? ' selected' : ''}>Google Gemini (free tier)</option>
          <option value="openai"${provider === 'openai' ? ' selected' : ''}>OpenAI (pay-per-use)</option>
        </select>
        <div id="aiCfgHint" style="font-size:10px;color:#555;margin:-4px 0 8px">${provider === 'gemini' ? 'Free — get key at aistudio.google.com/apikey' : 'Pay-per-use — platform.openai.com/api-keys'}</div>
        <label style="display:block;font-size:11px;color:#a0a0c0;margin-bottom:3px">API Key</label>
        <input type="password" id="aiCfgKey" value="${cfg.apiKey || ''}" placeholder="${provider === 'gemini' ? 'AIza...' : 'sk-...'}" style="width:100%;background:#1a1a2e;border:1px solid #0f3460;color:#e0e0e0;padding:6px 10px;border-radius:4px;font-size:12px;margin-bottom:8px">
        <button onclick="window._aiSaveConfig()" style="background:#00ff88;color:#1a1a2e;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600">Save</button>
        <span id="aiCfgStatus" style="margin-left:8px;font-size:11px;color:#555"></span>
      </div>
    `;
  },
};

window._aiSaveConfig = function() {
  const provider = document.getElementById('aiCfgProvider')?.value || 'gemini';
  const key = document.getElementById('aiCfgKey')?.value?.trim();
  saveConfig({ apiKey: key || null, provider });
  const status = document.getElementById('aiCfgStatus');
  if (status) { status.textContent = '✓ Saved'; status.style.color = '#00ff88'; }
};

export default ScheduleAI;

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
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('sk-')) return 'openai';
  return 'openai';
}

// ── Extraction prompt ─────────────────────────────────

const EXTRACTION_PROMPT = `You are an expert HVAC estimator analyzing a mechanical schedule from construction drawings.

Your job: extract every tagged item from this schedule into structured JSON. This could be ANY type of mechanical schedule — equipment, fans, air distribution, terminal units, accessories, or specialty items.

Common schedule titles you may encounter:
- HVAC Equipment Schedule, Mechanical Schedule, Rooftop Unit Schedule
- Fan Schedule, Exhaust Fan Schedule, Supply Fan Schedule
- Air Distribution Schedule, Diffuser Schedule, Grille Schedule, Register Schedule
- Terminal Unit Schedule, VAV Box Schedule, Fan Coil Schedule
- Air Curtain Schedule, Unit Heater Schedule, Cabinet Heater Schedule
- Damper Schedule, Louver Schedule, Hood Schedule

For EACH row/entry, extract these fields:

=== PRIMARY FIELDS (always extract) ===
- "tag": The item tag/designation exactly as shown (e.g., "RTU-1", "EF-3", "SD-1", "GR-4", "AC-1", "VAV-2A", "UH-1", "FPB-3")
- "type": Item type. Standardize to the closest match from this list:
  EQUIPMENT: "Rooftop Unit" | "Air Handler" | "Package Unit" | "Split System" | "Condensing Unit" | "Heat Pump" | "Mini Split" | "WSHP" | "PTAC"
  FANS: "Exhaust Fan" | "Supply Fan" | "Return Fan" | "Transfer Fan" | "Inline Fan" | "Ceiling Fan" | "Power Ventilator" | "Kitchen Hood Fan" | "Garage Fan"
  AIR DISTRIBUTION: "Supply Diffuser" | "Return Grille" | "Transfer Grille" | "Linear Diffuser" | "Slot Diffuser" | "Register" | "Louver" | "Intake Louver" | "Exhaust Louver"
  TERMINAL UNITS: "VAV Box" | "Fan Powered Box" | "Fan Coil Unit" | "FPTU" | "Chilled Beam"
  ENERGY RECOVERY: "ERV" | "HRV" | "Energy Recovery Wheel"
  HEATING: "Unit Heater" | "Cabinet Heater" | "Radiant Heater" | "Baseboard Heater" | "Duct Heater"
  MAKEUP AIR: "Makeup Air Unit" | "DOAS"
  SPECIALTY: "Air Curtain" | "Fume Hood" | "Kitchen Hood" | "Damper" | "Fire Damper" | "Smoke Damper" | "Combination Fire/Smoke Damper" | "Control Damper" | "Backdraft Damper"
  If none match, use the description from the schedule as-is.
- "category": One of: "equipment" | "fan" | "air-distribution" | "terminal" | "energy-recovery" | "heating" | "makeup-air" | "specialty"
- "cfm": Airflow in CFM (number or null)
- "model": Full model number exactly as shown (string or null)
- "manufacturer": Brand name (string or null)

=== SECONDARY FIELDS (extract if visible) ===
- "tonnage": Cooling tonnage (number or null) — convert from BTU if needed (BTU/12000)
- "heating": Heating capacity/type (e.g., "250 MBH Gas", "15 kW Electric", null)
- "voltage": Electrical (e.g., "208/3/60", null)
- "refrigerant": Refrigerant type (e.g., "R-410A", null)
- "mca": Minimum circuit ampacity (number or null)
- "mocp": Maximum overcurrent protection (number or null)
- "size": Physical size for grilles/diffusers/dampers (e.g., "24x24", "12x8", "10\" round", null)
- "quantity": If a quantity column exists showing multiples of the same tag (number or null, default null meaning 1)
- "location": Serving area/room if shown (string or null)

=== SKIP THESE ===
- Entering/leaving/discharge air temperatures
- Sound ratings/NC levels
- Weight
- Coil specifications
- Drain connection sizes

Rules:
1. Each ROW = one entry. Do not merge or skip rows.
2. If a tag range is shown ("FCU-1 THRU FCU-12"), expand into individual entries with the same specs.
3. Partially readable fields: include what you can read. null only if truly unreadable.
4. Model numbers: preserve exactly as shown (dashes, slashes, mixed case).
5. Multiple tables on one page: extract from ALL of them.
6. For air distribution items (grilles/diffusers/registers): size and CFM are the primary data, tonnage will be null.
7. For dampers: size is the primary data, CFM/tonnage may be null.
8. For fans: CFM and HP/watts are the primary data, tonnage will be null.

Return ONLY a JSON array. No markdown, no explanation.
Examples:
[{"tag":"RTU-1","type":"Rooftop Unit","category":"equipment","tonnage":10,"cfm":4000,"model":"RN-048","manufacturer":"AAON","heating":"150 MBH Gas","voltage":"208/3/60","refrigerant":"R-410A","mca":42,"mocp":60,"size":null,"quantity":null,"location":null},
{"tag":"EF-1","type":"Exhaust Fan","category":"fan","tonnage":null,"cfm":2500,"model":"CSP-A1200","manufacturer":"Greenheck","heating":null,"voltage":"208/1/60","refrigerant":null,"mca":null,"mocp":null,"size":null,"quantity":null,"location":"Restrooms"},
{"tag":"SD-1","type":"Supply Diffuser","category":"air-distribution","tonnage":null,"cfm":200,"model":"STR","manufacturer":"Titus","heating":null,"voltage":null,"refrigerant":null,"mca":null,"mocp":null,"size":"24x24","quantity":12,"location":null},
{"tag":"FSD-1","type":"Combination Fire/Smoke Damper","category":"specialty","tonnage":null,"cfm":null,"model":"FSD-35","manufacturer":"Ruskin","heating":null,"voltage":"120/1/60","refrigerant":null,"mca":null,"mocp":null,"size":"24x12","quantity":4,"location":null}]`;

// ── Gemini API ────────────────────────────────────────

async function callGemini(base64DataUrl, config) {
  const apiKey = config.apiKey;
  const model = config.model || 'gemini-2.5-flash';
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

// ── Anthropic Claude API ───────────────────────

async function callAnthropic(base64DataUrl, config) {
  const apiKey = config.apiKey;
  const model = config.model || 'claude-sonnet-4-20250514';

  const rawBase64 = stripDataUrl(base64DataUrl);
  const mimeMatch = base64DataUrl.match(/^data:([^;]+);/);
  const mediaType = mimeMatch ? mimeMatch[1] : 'image/png';

  const body = {
    model,
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: rawBase64 } },
        { type: 'text', text: EXTRACTION_PROMPT }
      ]
    }]
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.content?.[0]?.text || '';
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

    const providerName = { gemini: 'Gemini', anthropic: 'Claude', openai: 'OpenAI' }[provider] || provider;
    onStatus?.(`Sending to ${providerName} vision...`);
    let equipment;
    if (provider === 'gemini') equipment = await callGemini(base64, config);
    else if (provider === 'anthropic') equipment = await callAnthropic(base64, config);
    else equipment = await callOpenAI(base64, config);

    onStatus?.(`Found ${equipment.length} equipment entries`);
    return equipment;
  },

  equipmentToSymbols(equipment) {
    // Color palettes by category for visual distinction
    const CAT_COLORS = {
      'equipment':       ['#4dabf7','#339af0','#228be6','#1c7ed6'],
      'fan':             ['#69db7c','#51cf66','#40c057','#37b24d'],
      'air-distribution':['#ffd43b','#fcc419','#fab005','#f59f00'],
      'terminal':        ['#da77f2','#cc5de8','#be4bdb','#ae3ec9'],
      'energy-recovery': ['#74c0fc','#4dabf7','#339af0','#228be6'],
      'heating':         ['#ff8787','#ff6b6b','#fa5252','#f03e3e'],
      'makeup-air':      ['#ffa94d','#ff922b','#fd7e14','#f76707'],
      'specialty':       ['#a9e34b','#94d82d','#82c91e','#74b816'],
    };
    const DEFAULT_COLORS = ['#4dabf7','#69db7c','#ffd43b','#da77f2','#ff8787','#a9e34b','#ffa94d','#74c0fc'];
    const catCounters = {};

    return equipment.map((eq) => {
      const cat = eq.category || 'equipment';
      if (!catCounters[cat]) catCounters[cat] = 0;
      const palette = CAT_COLORS[cat] || DEFAULT_COLORS;
      const color = palette[catCounters[cat]++ % palette.length];

      // Build description based on category
      const descParts = [eq.type];
      if (eq.manufacturer) descParts.push(eq.manufacturer);
      if (eq.tonnage) descParts.push(eq.tonnage + ' ton');
      if (eq.cfm) descParts.push(eq.cfm + ' CFM');
      if (eq.size) descParts.push(eq.size);
      if (eq.quantity && eq.quantity > 1) descParts.push('qty ' + eq.quantity);

      return {
        tag: (eq.tag || '').toUpperCase(),
        description: descParts.filter(Boolean).join(' · '),
        color,
        category: cat,
        equipment: {
          type: eq.type || null,
          category: cat,
          tonnage: eq.tonnage || null,
          cfm: eq.cfm || null,
          model: eq.model || null,
          manufacturer: eq.manufacturer || null,
          heating: eq.heating || null,
          voltage: eq.voltage || null,
          refrigerant: eq.refrigerant || null,
          mca: eq.mca || null,
          mocp: eq.mocp || null,
          size: eq.size || null,
          quantity: eq.quantity || null,
          location: eq.location || null,
        }
      };
    }).filter(s => s.tag);
  },

  getConfig, saveConfig,
  isConfigured() { return !!getConfig().apiKey; },

  renderConfigUI() {
    const cfg = getConfig();
    const provider = cfg.provider || detectProvider(cfg.apiKey);
    const hints = {
      anthropic: 'Uses existing Anthropic key — ~$0.01/extraction',
      gemini: 'Free tier — get key at aistudio.google.com/apikey',
      openai: 'Pay-per-use — platform.openai.com/api-keys'
    };
    const placeholders = { anthropic: 'sk-ant-...', gemini: 'AIza...', openai: 'sk-...' };
    return `
      <div style="padding:8px 0">
        <label style="display:block;font-size:11px;color:#a0a0c0;margin-bottom:3px">Provider</label>
        <select id="aiCfgProvider" style="width:100%;background:#1a1a2e;border:1px solid #0f3460;color:#e0e0e0;padding:6px 10px;border-radius:4px;font-size:12px;margin-bottom:8px" onchange="document.getElementById('aiCfgHint').textContent=${JSON.stringify(hints)}[this.value]||''">
          <option value="anthropic"${provider === 'anthropic' ? ' selected' : ''}>Anthropic Claude (recommended)</option>
          <option value="gemini"${provider === 'gemini' ? ' selected' : ''}>Google Gemini</option>
          <option value="openai"${provider === 'openai' ? ' selected' : ''}>OpenAI</option>
        </select>
        <div id="aiCfgHint" style="font-size:10px;color:#555;margin:-4px 0 8px">${hints[provider] || ''}</div>
        <label style="display:block;font-size:11px;color:#a0a0c0;margin-bottom:3px">API Key</label>
        <input type="password" id="aiCfgKey" value="${cfg.apiKey || ''}" placeholder="${placeholders[provider] || 'API key...'}" style="width:100%;background:#1a1a2e;border:1px solid #0f3460;color:#e0e0e0;padding:6px 10px;border-radius:4px;font-size:12px;margin-bottom:8px">
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

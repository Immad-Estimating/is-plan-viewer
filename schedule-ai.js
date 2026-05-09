// =====================================================
// IS Plan Viewer — Schedule AI Extraction
// =====================================================
// Extracts HVAC system symbols and equipment data from
// mechanical schedule images using vision AI.
// Standalone module — no dependencies on index.html.
// =====================================================

// ── Configuration ─────────────────────────────────────
// Stored in localStorage, configurable per browser
const CONFIG_KEY = 'isplan_schedule_ai_config';

function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
  } catch { return {}; }
}

function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

// ── Image handling ────────────────────────────────────

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Extraction prompt ─────────────────────────────────

const EXTRACTION_PROMPT = `You are analyzing a mechanical/HVAC schedule from construction drawings. Extract ALL equipment entries from this schedule image.

For each piece of equipment, return a JSON object with these fields:
- "tag": The system/equipment tag (e.g., "RTU-1", "AHU-2", "EF-3", "MAU-1", "FCU-1", "ERV-1", "HP-1")
- "type": Equipment type (e.g., "Rooftop Unit", "Air Handler", "Exhaust Fan", "Makeup Air Unit", "Fan Coil", "Heat Pump", "Mini Split", "ERV")
- "tonnage": Cooling tonnage if listed (number or null)
- "cfm": Airflow in CFM if listed (number or null)
- "heating": Heating capacity/type if listed (e.g., "250 MBH Gas", "15 kW Electric", null)
- "voltage": Electrical info if listed (e.g., "208/3/60", "120/1/60", null)
- "refrigerant": Refrigerant type if listed (e.g., "R-410A", "R-32", null)
- "model": Model number if listed (string or null)
- "manufacturer": Manufacturer if listed (string or null)
- "notes": Any other relevant info from the schedule row (string or null)

Return ONLY a JSON array of objects. No markdown, no explanation, just the array.
If you cannot read the schedule clearly, return what you can with null for unreadable fields.
Example: [{"tag":"RTU-1","type":"Rooftop Unit","tonnage":10,"cfm":4000,"heating":"150 MBH Gas","voltage":"208/3/60","refrigerant":"R-410A","model":"RN-048","manufacturer":"AAON","notes":"VAV w/ economizer"}]`;

// ── API call ──────────────────────────────────────────

async function callVisionAPI(base64Image, config) {
  const apiKey = config.apiKey;
  const endpoint = config.endpoint || 'https://api.openai.com/v1/chat/completions';
  const model = config.model || 'gpt-4o';

  if (!apiKey) {
    throw new Error('No API key configured. Click ⚙ Configure to add one.');
  }

  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: EXTRACTION_PROMPT },
          { type: 'image_url', image_url: { url: base64Image, detail: 'high' } }
        ]
      }
    ],
    max_tokens: 4000,
    temperature: 0.1,
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';

  // Parse JSON from response (may be wrapped in ```json ... ```)
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Could not parse equipment list from AI response.');

  return JSON.parse(jsonMatch[0]);
}

// ── Public API ────────────────────────────────────────

const ScheduleAI = {

  // Extract equipment from an image blob
  async extract(blob, onStatus) {
    const config = getConfig();

    if (!config.apiKey) {
      throw new Error('NO_API_KEY');
    }

    onStatus?.('Converting image...');
    const base64 = await blobToBase64(blob);

    onStatus?.('Sending to vision AI...');
    const equipment = await callVisionAPI(base64, config);

    onStatus?.(`Found ${equipment.length} equipment entries`);
    return equipment;
  },

  // Convert extracted equipment to system symbols
  equipmentToSymbols(equipment) {
    const COLORS = ['#4dabf7','#69db7c','#ffd43b','#da77f2','#ff8787','#a9e34b','#ffa94d','#74c0fc','#f783ac','#63e6be','#d0bfff','#ffc078'];
    return equipment.map((eq, i) => ({
      tag: (eq.tag || '').toUpperCase(),
      description: [eq.type, eq.tonnage ? eq.tonnage + ' ton' : null, eq.cfm ? eq.cfm + ' CFM' : null].filter(Boolean).join(' · '),
      color: COLORS[i % COLORS.length],
      // Full equipment data stored for reference
      equipment: {
        type: eq.type || null,
        tonnage: eq.tonnage || null,
        cfm: eq.cfm || null,
        heating: eq.heating || null,
        voltage: eq.voltage || null,
        refrigerant: eq.refrigerant || null,
        model: eq.model || null,
        manufacturer: eq.manufacturer || null,
        notes: eq.notes || null,
      }
    })).filter(s => s.tag); // exclude entries with no tag
  },

  // Get/save configuration
  getConfig,
  saveConfig,

  // Check if configured
  isConfigured() {
    return !!getConfig().apiKey;
  },

  // Render config UI (returns HTML string)
  renderConfigUI() {
    const cfg = getConfig();
    return `
      <div style="padding:8px 0">
        <label style="display:block;font-size:11px;color:#a0a0c0;margin-bottom:3px">API Key (OpenAI or compatible)</label>
        <input type="password" id="aiCfgKey" value="${cfg.apiKey || ''}" placeholder="sk-..." style="width:100%;background:#1a1a2e;border:1px solid #0f3460;color:#e0e0e0;padding:6px 10px;border-radius:4px;font-size:12px;margin-bottom:8px">
        <label style="display:block;font-size:11px;color:#a0a0c0;margin-bottom:3px">Endpoint (optional — defaults to OpenAI)</label>
        <input type="text" id="aiCfgEndpoint" value="${cfg.endpoint || ''}" placeholder="https://api.openai.com/v1/chat/completions" style="width:100%;background:#1a1a2e;border:1px solid #0f3460;color:#e0e0e0;padding:6px 10px;border-radius:4px;font-size:12px;margin-bottom:8px">
        <label style="display:block;font-size:11px;color:#a0a0c0;margin-bottom:3px">Model (optional — defaults to gpt-4o)</label>
        <input type="text" id="aiCfgModel" value="${cfg.model || ''}" placeholder="gpt-4o" style="width:100%;background:#1a1a2e;border:1px solid #0f3460;color:#e0e0e0;padding:6px 10px;border-radius:4px;font-size:12px;margin-bottom:8px">
        <button onclick="window._aiSaveConfig()" style="background:#00ff88;color:#1a1a2e;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600">Save Configuration</button>
        <span id="aiCfgStatus" style="margin-left:8px;font-size:11px;color:#555"></span>
      </div>
    `;
  },
};

// Global config save handler
window._aiSaveConfig = function() {
  const key = document.getElementById('aiCfgKey')?.value?.trim();
  const endpoint = document.getElementById('aiCfgEndpoint')?.value?.trim();
  const model = document.getElementById('aiCfgModel')?.value?.trim();
  saveConfig({
    apiKey: key || null,
    endpoint: endpoint || null,
    model: model || null,
  });
  const status = document.getElementById('aiCfgStatus');
  if (status) { status.textContent = '✓ Saved'; status.style.color = '#00ff88'; }
};

export default ScheduleAI;

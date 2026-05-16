export function installCommandRoll(ctx = {}) {
  const {
    viewer = null,
    pdfToScreen = function(x, y) { return { x, y }; },
    getCommands = function() { return []; },
    onExecuteCommand = function() {},
    onFieldChange = function() {},
    onExit = function() {},
  } = ctx;

  let active = false;
  let anchorPoint = null;
  let ductConfig = null;
  let commands = [];
  let selectedIdx = 0;
  let history = [];
  let el = null;

  function ensureEl() {
    if (el) return el;
    injectCSS();
    el = document.createElement('div');
    el.className = 'command-roll';
    el.innerHTML = '<div class="cr-title">Command Roll</div><div class="cr-list"></div><div class="cr-history"></div>';
    (viewer || document.body).appendChild(el);
    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('click', (e) => {
      const row = e.target.closest('[data-cr-idx]');
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      selectedIdx = parseInt(row.dataset.crIdx, 10) || 0;
      render();
      executeSelected();
    });
    el.addEventListener('input', (e) => {
      const input = e.target.closest('[data-cr-field]');
      if (!input) return;
      e.stopPropagation();
      const cmd = getSelectedCommand();
      if (!cmd) return;
      cmd[input.dataset.crField] = input.value;
      onFieldChange(cmd, input.dataset.crField, input.value);
    });
    return el;
  }

  function injectCSS() {
    if (document.getElementById('command-roll-css')) return;
    const style = document.createElement('style');
    style.id = 'command-roll-css';
    style.textContent = `
.command-roll {
  position: absolute;
  z-index: 180;
  width: 190px;
  padding: 6px;
  border: 1px solid rgba(233, 69, 96, 0.65);
  border-radius: 9px;
  background: rgba(9, 14, 28, 0.94);
  box-shadow: 0 8px 24px rgba(0,0,0,0.38);
  color: #e8edf7;
  font: 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  backdrop-filter: blur(3px);
  user-select: none;
  pointer-events: none;
  display: none;
}
.command-roll.active { display: block; }
.cr-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #a0a0c0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  margin: 0 0 5px;
}
.cr-list { display: flex; flex-direction: column; gap: 3px; }
.cr-row {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  align-items: center;
  gap: 5px;
  padding: 4px 6px;
  border-radius: 7px;
  color: #cfd6ea;
  border: 1px solid transparent;
}
.cr-row.dim { opacity: 0.55; }
.cr-row.selected {
  background: rgba(233, 69, 96, 0.2);
  border-color: rgba(233, 69, 96, 0.65);
  color: #fff;
}
.cr-kind {
  font-size: 9px;
  color: #74809d;
  text-transform: uppercase;
  white-space: nowrap;
}
.cr-history {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(160,160,192,0.18);
}
.cr-hist-item {
  max-width: 62px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #8892b0;
  background: rgba(255,255,255,0.05);
  border-radius: 999px;
  padding: 2px 6px;
  font-size: 9px;
}
.cr-fields {
  pointer-events: auto;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  margin-top: 5px;
}
.cr-field {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #9aa5c3;
  font-size: 9px;
}
.cr-field input {
  min-width: 0;
  width: 100%;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(160,160,192,0.35);
  border-radius: 5px;
  color: #fff;
  padding: 3px 4px;
  font: 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  outline: none;
}
.cr-field input:focus {
  border-color: rgba(233,69,96,0.85);
  background: rgba(233,69,96,0.14);
}
`;
    document.head.appendChild(style);
  }

  function rebuildCommands() {
    const next = getCommands({ duct: ductConfig, anchor: anchorPoint }) || [];
    commands = next.length ? next : [{ id: 'continue', label: 'Continue Duct', kind: 'duct', action: 'continue' }];
    if (selectedIdx >= commands.length) selectedIdx = 0;
  }

  function render() {
    const node = ensureEl();
    if (!active || !anchorPoint) {
      node.classList.remove('active');
      return;
    }
    rebuildCommands();
    const visible = getVisibleCommands();
    node.querySelector('.cr-title').innerHTML = `<span>Command Roll</span><span>${selectedIdx + 1}/${commands.length}</span>`;
    node.querySelector('.cr-list').innerHTML = visible.map(({ cmd, idx }) => `
      <div class="cr-row${idx === selectedIdx ? ' selected' : ' dim'}" data-cr-idx="${idx}">
        <span>${idx === selectedIdx ? '>' : idx < selectedIdx ? '^' : 'v'}</span>
        <span>${escapeHtml(cmd.label || cmd.type || 'Command')}</span>
        <span class="cr-kind">${escapeHtml(cmd.kind || cmd.action || '')}</span>
      </div>
    `).join('');
    const selected = commands[selectedIdx];
    const fields = selected && Array.isArray(selected.fields) ? selected.fields : [];
    const fieldsHtml = fields.map(field => `
      <label class="cr-field">
        <span>${escapeHtml(field.label || field.key)}</span>
        <input data-cr-field="${escapeHtml(field.key)}" value="${escapeHtml(selected[field.key] || '')}" />
      </label>
    `).join('');
    node.querySelector('.cr-list').insertAdjacentHTML('beforeend', fieldsHtml ? `<div class="cr-fields">${fieldsHtml}</div>` : '');
    node.querySelector('.cr-history').innerHTML = history.slice(-3).map(item =>
      `<span class="cr-hist-item" title="${escapeHtml(item)}">${escapeHtml(item)}</span>`
    ).join('');
    position();
    node.classList.add('active');
  }

  function getVisibleCommands() {
    if (commands.length <= 3) return commands.map((cmd, idx) => ({ cmd, idx }));
    const seen = new Set();
    return [-1, 0, 1].map(offset => {
      const idx = (selectedIdx + offset + commands.length) % commands.length;
      return { cmd: commands[idx], idx };
    }).filter(item => {
      if (seen.has(item.idx)) return false;
      seen.add(item.idx);
      return true;
    });
  }

  function position() {
    if (!el || !anchorPoint || !viewer) return;
    const w = el.offsetWidth || 210;
    const h = el.offsetHeight || 120;
    let left = viewer.clientWidth - w - 16;
    let top = 64;
    left = Math.max(8, Math.min(viewer.clientWidth - w - 8, left));
    top = Math.max(8, Math.min(viewer.clientHeight - h - 8, top));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function handleWheel(e) {
    if (!active) return false;
    e.preventDefault();
    e.stopPropagation();
    cycle(e.deltaY > 0 ? 1 : -1);
    return true;
  }

  function cycle(delta) {
    rebuildCommands();
    selectedIdx = (selectedIdx + delta + commands.length) % commands.length;
    render();
  }

  function getSelectedCommand() {
    rebuildCommands();
    return commands[selectedIdx] || null;
  }

  function executeSelected(opts = {}) {
    const cmd = getSelectedCommand();
    if (!cmd) return false;
    if (cmd.action === 'exit') {
      stop();
      onExit();
      return true;
    }
    if (cmd.action === 'continue') {
      selectedIdx = 0;
      render();
      return false;
    }
    const didExecute = onExecuteCommand(cmd, { anchor: opts.anchor || anchorPoint, duct: ductConfig });
    if (didExecute !== false) {
      history.push(cmd.label || cmd.type || 'Command');
      if (history.length > 12) history = history.slice(-12);
      if (!opts.keepSelection) selectedIdx = 0;
      if (opts.anchor) anchorPoint = opts.anchor;
      render();
      return true;
    }
    return false;
  }

  function start(opts = {}) {
    active = true;
    anchorPoint = opts.anchor || anchorPoint;
    ductConfig = opts.duct || ductConfig;
    selectedIdx = 0;
    render();
  }

  function update(opts = {}) {
    if (opts.anchor) anchorPoint = opts.anchor;
    if (opts.duct) ductConfig = opts.duct;
    if (active) render();
  }

  function stop() {
    active = false;
    selectedIdx = 0;
    if (el) el.classList.remove('active');
  }

  function handleKeyDown(e) {
    if (!active) return false;
    if (e.key === 'Escape') {
      e.preventDefault();
      stop();
      onExit();
      return true;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      return executeSelected();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      cycle(1);
      return true;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      cycle(-1);
      return true;
    }
    return false;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch];
    });
  }

  window.addEventListener('resize', position);

  return {
    start,
    update,
    stop,
    render,
    isActive: () => active,
    getSelectedCommand,
    executeSelected,
    handleWheel,
    handleKeyDown,
  };
}

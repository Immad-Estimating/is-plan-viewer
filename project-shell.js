export function installProjectShell(ctx = {}) {
  const {
    idbGet,
    idbGetAll,
    idbGetAllByIndex,
    idbPut,
    idbAdd,
    idbDelete,
    idbDeleteByIndex,
    navigateTo,
    pdfjsLib,
    goToSheetPage = function() {}
  } = ctx;

  // =====================================================
  // Quickbase Project Cache
  // =====================================================
  let qbProjects = [];
  
  async function loadQuickbaseProjects() {
    try {
      const resp = await fetch('projects.json');
      if (resp.ok) qbProjects = await resp.json();
    } catch (e) {
      console.warn('Could not load projects.json:', e);
    }
  }
  
  function fuzzyMatch(str, query) {
    if (!query) return true;
    const s = str.toLowerCase();
    const q = query.toLowerCase();
    // Simple substring match on each word
    const words = q.split(/\s+/);
    return words.every(w => s.includes(w));
  }
  
  function searchQBProjects(query) {
    if (!query || query.length < 2) return [];
    return qbProjects.filter(p => {
      return fuzzyMatch(p.name || '', query) || fuzzyMatch(p.client || '', query) || fuzzyMatch(p.builder || '', query);
    }).slice(0, 20);
  }
  

  // =====================================================
  // Dashboard (paginated infinite scroll)
  // =====================================================
  const DASH_PAGE_SIZE = 36;
  let _dashSorted = [];  // full filtered+sorted list for current render
  let _dashShown = 0;    // how many cards currently in DOM
  let _dashObserver = null;
  
  async function renderDashboard() {
    const projects = await idbGetAll('projects');
    const searchQuery = document.getElementById('dashboardSearch').value.trim();
    const content = document.getElementById('dashboardContent');
  
    // Also render QB panel
    renderQBPanel();
  
    // Drawing counts are cached on project records — migrate any legacy projects missing it
    let needsMigration = projects.some(p => p.drawingCount === undefined);
    if (needsMigration) {
      const allDrawings = await idbGetAll('drawings');
      const counts = {};
      for (const d of allDrawings) counts[d.projectId] = (counts[d.projectId] || 0) + 1;
      for (const p of projects) {
        if (p.drawingCount === undefined) {
          p.drawingCount = counts[p.id] || 0;
          await idbPut('projects', p);
        }
      }
    }
  
    let filtered = projects;
    if (searchQuery) {
      const localMatches = projects.filter(p => fuzzyMatch(p.name || '', searchQuery) || fuzzyMatch(p.client || '', searchQuery));
      const localQbIds = new Set(projects.filter(p => p.qbId).map(p => p.qbId));
      const qbMatches = searchQBProjects(searchQuery).filter(q => !localQbIds.has(q.id));
  
      if (qbMatches.length > 0 && localMatches.length === 0) {
        content.innerHTML = renderProjectGrid(localMatches) + renderQBSuggestions(qbMatches);
        return;
      }
      filtered = localMatches;
      if (qbMatches.length > 0) {
        content.innerHTML = renderProjectGrid(filtered) + renderQBSuggestions(qbMatches);
        return;
      }
    }
  
    if (filtered.length === 0) {
      content.innerHTML = `<div class="empty-state"><div class="icon">📋</div><h3>No Projects Yet</h3><p>Click "+ New Project" to get started</p></div>`;
      return;
    }
  
    content.innerHTML = renderProjectGrid(filtered);
  }
  
  function renderProjectGrid(projects) {
    if (projects.length === 0) return '';
    _dashSorted = [...projects].sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));
    _dashShown = 0;
  
    // Tear down previous observer
    if (_dashObserver) { _dashObserver.disconnect(); _dashObserver = null; }
  
    const firstBatch = _dashSorted.slice(0, DASH_PAGE_SIZE);
    _dashShown = firstBatch.length;
  
    let html = `<div class="project-grid" id="projGrid">${firstBatch.map(p => renderProjectCard(p, p.drawingCount || 0)).join('')}</div>`;
  
    // Sentinel for infinite scroll (only if more to load)
    if (_dashSorted.length > DASH_PAGE_SIZE) {
      html += `<div class="scroll-sentinel" id="scrollSentinel"><div class="scroll-ring"></div></div>`;
      html += `<div class="scroll-count" id="scrollCount">${_dashShown} of ${_dashSorted.length} projects</div>`;
      // Wire up intersection observer after next paint
      requestAnimationFrame(() => {
        const sentinel = document.getElementById('scrollSentinel');
        if (!sentinel) return;
        _dashObserver = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) _dashLoadMore();
        }, { root: document.getElementById('dashboardContent'), rootMargin: '200px' });
        _dashObserver.observe(sentinel);
      });
    }
  
    return html;
  }
  
  function _dashLoadMore() {
    if (_dashShown >= _dashSorted.length) return;
    const grid = document.getElementById('projGrid');
    const sentinel = document.getElementById('scrollSentinel');
    const countEl = document.getElementById('scrollCount');
    if (!grid) return;
  
    const nextBatch = _dashSorted.slice(_dashShown, _dashShown + DASH_PAGE_SIZE);
    for (let i = 0; i < nextBatch.length; i++) {
      const p = nextBatch[i];
      const tmp = document.createElement('div');
      tmp.innerHTML = renderProjectCard(p, p.drawingCount || 0);
      const card = tmp.firstElementChild;
      card.classList.add('entering');
      card.style.animationDelay = `${i * 30}ms`;
      grid.appendChild(card);
    }
    _dashShown += nextBatch.length;
  
    if (countEl) countEl.textContent = `${_dashShown} of ${_dashSorted.length} projects`;
  
    if (_dashShown >= _dashSorted.length) {
      if (sentinel) sentinel.classList.add('done');
      if (countEl) countEl.textContent = `All ${_dashSorted.length} projects loaded`;
      if (_dashObserver) { _dashObserver.disconnect(); _dashObserver = null; }
    }
  }
  
  function renderProjectCard(project, drawingCount) {
    const dc = drawingCount != null ? drawingCount : (project.drawingCount || 0);
    const date = project.modifiedAt ? new Date(project.modifiedAt).toLocaleDateString() : 'Never';
    const stageBadge = project.stage ? `<span class="stage-badge ${getStageCssClass(project.stage)}">${escapeHtml(project.stage)}</span>` : '';
    const clientLine = project.client ? `<div class="card-meta">${escapeHtml(project.client)}${project.builder ? ' / ' + escapeHtml(project.builder) : ''}</div>` : '';
  
    return `<a class="project-card" href="#/project/${project.id}" data-project-id="${project.id}">
      <div class="card-header">
        <div class="card-name" id="cardName-${project.id}">${escapeHtml(project.name)} ${stageBadge}</div>
        <div class="card-actions">
          <button onclick="event.stopPropagation(); event.preventDefault(); renameProject(${project.id})" title="Rename">✏️</button>
          <button onclick="event.stopPropagation(); event.preventDefault(); deleteProject(${project.id}, '${escapeHtml(project.name).replace(/'/g, "\\'")}')" title="Delete">🗑️</button>
        </div>
      </div>
      ${clientLine}
      <div class="card-stats">
        <span>📄 ${dc} drawing${dc !== 1 ? 's' : ''}</span>
        <span>📅 ${date}</span>
      </div>
    </a>`;
  }
  
  function renderQBSuggestions(qbMatches) {
    if (qbMatches.length === 0) return '';
    let html = '<div style="margin-top:20px;padding-top:16px;border-top:1px solid #0f3460"><h4 style="color:#a0a0c0;font-size:12px;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px">Import from Quickbase</h4><div class="project-grid">';
    for (const q of qbMatches) {
      const stageBadge = q.stage ? `<span class="stage-badge ${getStageCssClass(q.stage)}">${escapeHtml(q.stage)}</span>` : '';
      html += `<div class="project-card" onclick="importQBProject(${q.id})" style="border-style:dashed;opacity:0.8">
        <div class="card-header"><div class="card-name">${escapeHtml(q.name)} ${stageBadge}</div></div>
        ${q.client ? `<div class="card-meta">${escapeHtml(q.client)}</div>` : ''}
        <div class="card-stats"><span style="color:#e94560">Click to import</span></div>
      </div>`;
    }
    html += '</div></div>';
    return html;
  }
  
  function getStageCssClass(stage) {
    if (!stage) return 'default';
    const s = stage.toLowerCase();
    if (s.includes('award')) return 'award';
    if (s.includes('bid')) return 'bid';
    if (s.includes('budget')) return 'budgeting';
    if (s.includes('precon') || s.includes('pre-con')) return 'preconstruction';
    if (s.includes('construction') || s.includes('progress')) return 'construction';
    return 'default';
  }
  
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  
  window.openProject = function(id) {
    navigateTo(`#/project/${id}`);
  };
  
  window.filterProjects = function() {
    renderDashboard();
  };
  
  // ===== Toast notification =====
  function showToast(msg, accent = false) {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = 'toast' + (accent ? ' accent' : '');
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
  
  // ===== QB Sidebar Panel =====
  let qbPanelCollapsed = false;
  let qbPanelFilter = '';
  let qbSortField = 'name'; // 'name', 'client', 'stage'
  let qbSortAsc = true;
  
  function getActiveQBProjects() {
    const excluded = ['lost', 'no bid'];
    return qbProjects.filter(p => {
      const s = (p.stage || '').toLowerCase().trim();
      return !excluded.includes(s);
    });
  }
  
  function formatQBDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (isNaN(d)) return '';
    return `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
  }
  
  async function renderQBPanel() {
    const allProjects = await idbGetAll('projects');
    const importedQbIds = new Set(allProjects.filter(p => p.qbId).map(p => p.qbId));
  
    let active = getActiveQBProjects();
    if (qbPanelFilter) {
      active = active.filter(p => fuzzyMatch(p.name || '', qbPanelFilter) || fuzzyMatch(p.client || '', qbPanelFilter) || fuzzyMatch(p.builder || '', qbPanelFilter));
    }
    // Apply column filters
    ['name','client','stage'].forEach(f => {
      if (colFilters[f]) {
        active = active.filter(p => colFilters[f].has((p[f]||'').trim().toLowerCase() || '(empty)'));
      }
    });
    if (colFilters.modified && colFilters.modified._cutoff) {
      active = active.filter(p => p.modified && p.modified >= colFilters.modified._cutoff);
    }
    // Sort
    active.sort((a, b) => {
      let av, bv;
      if (qbSortField === 'modified') { av = a.modified || ''; bv = b.modified || ''; }
      else { av = (a[qbSortField] || '').toLowerCase(); bv = (b[qbSortField] || '').toLowerCase(); }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return qbSortAsc ? cmp : -cmp;
    });
    // Update sort arrows
    ['name','client','stage','modified'].forEach(f => {
      const th = document.querySelector(`th[data-sort="${f}"]`);
      const arrow = document.getElementById(`sortArrow-${f}`);
      if (th && arrow) {
        th.classList.toggle('active', f === qbSortField);
        arrow.textContent = f === qbSortField ? (qbSortAsc ? '▲' : '▼') : '';
      }
    });
  
    const tbody = document.getElementById('qbTableBody');
    const countEl = document.getElementById('qbCount');
    countEl.textContent = `${active.length} active bid${active.length !== 1 ? 's' : ''}`;
  
    tbody.innerHTML = active.map(q => {
      const imported = importedQbIds.has(q.id);
      const stageBadge = q.stage ? `<span class="stage-badge ${getStageCssClass(q.stage)}">${escapeHtml(q.stage)}</span>` : '';
      const importedTag = imported ? '<span class="qb-imported-tag">✓</span>' : '';
      const modDate = q.modified ? formatQBDate(q.modified) : '';
      return `<tr class="qb-row${imported ? ' imported' : ''}" draggable="true" data-qbid="${q.id}">
        <td class="qb-proj-name" title="${escapeHtml(q.name)}">${escapeHtml(q.name)}${importedTag}</td>
        <td class="qb-client" title="${escapeHtml(q.client || '')}">${escapeHtml(q.client || '')}</td>
        <td>${stageBadge}</td>
        <td class="qb-modified">${modDate}</td>
      </tr>`;
    }).join('');
  
    // Attach dragstart to rows
    tbody.querySelectorAll('.qb-row').forEach(row => {
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', row.dataset.qbid);
        e.dataTransfer.effectAllowed = 'copy';
      });
    });
  }
  
  window.filterQBPanel = function() {
    qbPanelFilter = document.getElementById('qbPanelSearch').value.trim();
    renderQBPanel();
  };
  
  window.sortQBPanel = function(field) {
    if (qbSortField === field) {
      qbSortAsc = !qbSortAsc;
    } else {
      qbSortField = field;
      qbSortAsc = true;
    }
    renderQBPanel();
  };
  
  // Column filters: { name: Set, client: Set, stage: Set } - null means no filter (show all)
  const colFilters = { name: null, client: null, stage: null, modified: null };
  
  window.toggleColFilter = function(field) {
    const drop = document.getElementById(`filterDrop-${field}`);
    const isOpen = drop.classList.contains('open');
    ['name','client','stage','modified'].forEach(f => document.getElementById(`filterDrop-${f}`).classList.remove('open'));
    if (isOpen) return;
  
    if (field === 'modified') {
      const current = colFilters.modified;
      const sel = current ? current._preset || '' : '';
      drop.innerHTML = `
        <label style="font-weight:600;color:#a0a0c0;padding-bottom:2px">Filter by date</label>
        <label><input type="radio" name="dateFilter" value="" ${!sel ? 'checked' : ''}> All dates</label>
        <label><input type="radio" name="dateFilter" value="7d" ${sel==='7d' ? 'checked' : ''}> Last 7 days</label>
        <label><input type="radio" name="dateFilter" value="14d" ${sel==='14d' ? 'checked' : ''}> Last 2 weeks</label>
        <label><input type="radio" name="dateFilter" value="30d" ${sel==='30d' ? 'checked' : ''}> Last 30 days</label>
        <label><input type="radio" name="dateFilter" value="60d" ${sel==='60d' ? 'checked' : ''}> Last 60 days</label>
        <label><input type="radio" name="dateFilter" value="90d" ${sel==='90d' ? 'checked' : ''}> Last 90 days</label>
        <label><input type="radio" name="dateFilter" value="6m" ${sel==='6m' ? 'checked' : ''}> Last 6 months</label>
        <label><input type="radio" name="dateFilter" value="1y" ${sel==='1y' ? 'checked' : ''}> Last year</label>
        <div class="filter-actions"><button onclick="applyDateFilter()">Apply</button><button onclick="clearColFilter('modified')">Clear</button></div>
      `;
      positionFilterDropdown(field, drop);
      drop.classList.add('open');
      return;
    }
  
    const excluded = ['lost', 'no bid'];
    let pool = qbProjects.filter(p => !excluded.includes((p.stage||'').toLowerCase().trim()));
    ['name','client','stage','modified'].forEach(f => {
      if (f !== field && colFilters[f]) {
        if (f === 'modified') return;
        pool = pool.filter(p => colFilters[f].has((p[f]||'').toLowerCase().trim() || '(empty)'));
      }
    });
  
    const values = [...new Set(pool.map(p => (p[field]||'').trim() || '(empty)'))].sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const currentFilter = colFilters[field];
  
    let html = values.map(v => {
      const checked = !currentFilter || currentFilter.has(v.toLowerCase());
      const escaped = v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
      return `<label><input type="checkbox" data-val="${escaped}" ${checked ? 'checked' : ''}> ${escaped}</label>`;
    }).join('');
    html += `<div class="filter-actions"><button onclick="applyColFilter('${field}')">Apply</button><button onclick="clearColFilter('${field}')">Clear</button></div>`;
    drop.innerHTML = html;
    positionFilterDropdown(field, drop);
    drop.classList.add('open');
  };
  
  window.applyDateFilter = function() {
    const drop = document.getElementById('filterDrop-modified');
    const selected = drop.querySelector('input[name="dateFilter"]:checked');
    const val = selected ? selected.value : '';
    if (!val) {
      colFilters.modified = null;
      document.getElementById('filterBtn-modified').classList.remove('filtered');
    } else {
      const ms = { '7d': 7, '14d': 14, '30d': 30, '60d': 60, '90d': 90, '6m': 182, '1y': 365 };
      const cutoff = new Date(Date.now() - (ms[val] || 30) * 86400000).toISOString();
      colFilters.modified = { _preset: val, _cutoff: cutoff };
      document.getElementById('filterBtn-modified').classList.add('filtered');
    }
    drop.classList.remove('open');
    renderQBPanel();
  };
  
  window.applyColFilter = function(field) {
    const drop = document.getElementById(`filterDrop-${field}`);
    const checks = drop.querySelectorAll('input[type="checkbox"]');
    const selected = new Set();
    let allChecked = true;
    checks.forEach(cb => {
      if (cb.checked) selected.add(cb.dataset.val.toLowerCase());
      else allChecked = false;
    });
    colFilters[field] = allChecked ? null : (selected.size > 0 ? selected : new Set(['__none__']));
    drop.classList.remove('open');
    // Update filter icon
    const btn = document.getElementById(`filterBtn-${field}`);
    btn.classList.toggle('filtered', !allChecked);
    renderQBPanel();
  };
  
  window.clearColFilter = function(field) {
    colFilters[field] = null;
    document.getElementById(`filterDrop-${field}`).classList.remove('open');
    document.getElementById(`filterBtn-${field}`).classList.remove('filtered');
    renderQBPanel();
  };
  
  // Close filter dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.col-filter-dropdown') && !e.target.closest('.col-filter-btn')) {
      ['name','client','stage','modified'].forEach(f => document.getElementById(`filterDrop-${f}`)?.classList.remove('open'));
    }
  });
  
  function positionFilterDropdown(field, drop) {
    const btn = document.getElementById(`filterBtn-${field}`);
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    drop.style.top = (rect.bottom + 4) + 'px';
    // Try to align right edge with button, but keep within viewport
    const dropWidth = 240;
    let left = rect.right - dropWidth;
    if (left < 8) left = 8;
    if (left + dropWidth > window.innerWidth - 8) left = window.innerWidth - dropWidth - 8;
    drop.style.left = left + 'px';
  }
  
  // QB panel resize handle
  (function() {
    const handle = document.getElementById('qbResizeHandle');
    const panel = document.getElementById('dashboardRight');
    if (!handle || !panel) return;
    let startX, startW;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = panel.offsetWidth;
      handle.classList.add('active');
      const onMove = (e) => {
        const delta = startX - e.clientX;
        const newW = Math.max(320, Math.min(window.innerWidth * 0.8, startW + delta));
        panel.style.width = newW + 'px';
      };
      const onUp = () => {
        handle.classList.remove('active');
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  })();
  
  window.refreshQBPanel = async function() {
    try {
      const resp = await fetch('projects.json?t=' + Date.now());
      if (resp.ok) qbProjects = await resp.json();
    } catch (e) {
      console.warn('Could not refresh projects.json:', e);
    }
    renderQBPanel();
    showToast('Active bids refreshed');
  };
  
  window.toggleQBPanel = function() {
    const panel = document.getElementById('dashboardRight');
    const toggle = document.getElementById('qbCollapseToggle');
    qbPanelCollapsed = !qbPanelCollapsed;
    panel.classList.toggle('collapsed', qbPanelCollapsed);
    toggle.textContent = qbPanelCollapsed ? '▶' : '◀';
  };
  
  // ===== Drag-to-import (drop on left panel) =====
  function setupDragImport() {
    const left = document.getElementById('dashboardLeft');
  
    left.addEventListener('dragover', (e) => {
      // Only react to QB drags (not file drags)
      if (e.dataTransfer.types.includes('text/plain')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        left.classList.add('drop-hover');
      }
    });
  
    left.addEventListener('dragleave', (e) => {
      // Only remove if actually leaving the panel
      if (!left.contains(e.relatedTarget)) {
        left.classList.remove('drop-hover');
      }
    });
  
    left.addEventListener('drop', async (e) => {
      left.classList.remove('drop-hover');
      const qbIdStr = e.dataTransfer.getData('text/plain');
      if (!qbIdStr) return;
      e.preventDefault();
      const qbId = parseInt(qbIdStr);
      if (isNaN(qbId)) return;
  
      // Check if already imported
      const allProjects = await idbGetAll('projects');
      const existing = allProjects.find(p => p.qbId === qbId);
      if (existing) {
        showToast('This project is already in your workspace', true);
        // Flash the existing card
        const card = document.querySelector(`.project-card[data-project-id="${existing.id}"]`);
        if (card) {
          card.classList.add('flash');
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => card.classList.remove('flash'), 1500);
        }
        return;
      }
  
      // Import the project
      await importQBProject(qbId);
    });
  }
  
  
  window.importQBProject = async function(qbId) {
    const qb = qbProjects.find(q => q.id === qbId);
    if (!qb) return;
    const now = Date.now();
    const id = await idbAdd('projects', {
      name: qb.name,
      qbId: qb.id,
      client: qb.client || '',
      builder: qb.builder || '',
      stage: qb.stage || '',
      drawingCount: 0,
      createdAt: now,
      modifiedAt: now
    });
    navigateTo(`#/project/${id}`);
  };
  
  // ===== New Project Modal =====
  let selectedQBProject = null;
  
  window.openNewProjectModal = function() {
    selectedQBProject = null;
    document.getElementById('newProjectName').value = '';
    document.getElementById('qbSearchInput').value = '';
    document.getElementById('qbResults').innerHTML = '';
    document.getElementById('qbSelected').style.display = 'none';
    document.getElementById('newProjectModal').classList.add('open');
    document.getElementById('newProjectName').focus();
  };
  
  window.closeNewProjectModal = function() {
    document.getElementById('newProjectModal').classList.remove('open');
  };
  
  window.searchQuickbase = function() {
    const query = document.getElementById('qbSearchInput').value.trim();
    const results = searchQBProjects(query);
    const container = document.getElementById('qbResults');
    if (results.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = results.map(q => {
      const stageBadge = q.stage ? `<span class="stage-badge ${getStageCssClass(q.stage)}" style="margin-left:6px">${escapeHtml(q.stage)}</span>` : '';
      return `<div class="qb-result-item" onclick="selectQBProject(${q.id})">
        <div class="qb-name">${escapeHtml(q.name)}${stageBadge}</div>
        <div class="qb-detail">${escapeHtml(q.client || '')}${q.builder ? ' / ' + escapeHtml(q.builder) : ''}</div>
      </div>`;
    }).join('');
  };
  
  window.selectQBProject = function(qbId) {
    const qb = qbProjects.find(q => q.id === qbId);
    if (!qb) return;
    selectedQBProject = qb;
    document.getElementById('newProjectName').value = qb.name;
    document.getElementById('qbResults').innerHTML = '';
    document.getElementById('qbSearchInput').value = '';
    document.getElementById('qbSelected').style.display = 'flex';
    document.getElementById('qbSelName').textContent = qb.name;
  };
  
  window.clearQbSelection = function() {
    selectedQBProject = null;
    document.getElementById('qbSelected').style.display = 'none';
  };
  
  window.createProject = async function() {
    const name = document.getElementById('newProjectName').value.trim();
    if (!name) return;
    const now = Date.now();
    const proj = {
      name,
      qbId: selectedQBProject ? selectedQBProject.id : null,
      client: selectedQBProject ? (selectedQBProject.client || '') : '',
      builder: selectedQBProject ? (selectedQBProject.builder || '') : '',
      stage: selectedQBProject ? (selectedQBProject.stage || '') : '',
      drawingCount: 0,
      createdAt: now,
      modifiedAt: now
    };
    const id = await idbAdd('projects', proj);
    closeNewProjectModal();
    navigateTo(`#/project/${id}`);
  };
  
  // ===== Rename / Delete Project =====
  window.renameProject = async function(id) {
    const card = document.getElementById(`cardName-${id}`);
    if (!card) return;
    const project = await idbGet('projects', id);
    if (!project) return;
  
    // Mark the parent <a> to disable navigation while renaming
    const cardEl = card.closest('.project-card');
    if (cardEl) cardEl.dataset.renaming = 'true';
  
    const currentName = project.name;
    card.innerHTML = `<input type="text" value="${escapeHtml(currentName)}" id="renameInput-${id}">`;
    const input = document.getElementById(`renameInput-${id}`);
    input.focus();
    input.select();
  
    // Stop clicks on the input from navigating the <a>
    input.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); });
    input.addEventListener('mousedown', (e) => { e.stopPropagation(); });
  
    let saved = false;
    const save = async () => {
      if (saved) return;
      saved = true;
      const newName = input.value.trim();
      if (newName && newName !== currentName) {
        project.name = newName;
        project.modifiedAt = Date.now();
        await idbPut('projects', project);
      }
      if (cardEl) delete cardEl.dataset.renaming;
      renderDashboard();
    };
  
    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = currentName; input.blur(); }
    });
  };
  
  window.deleteProject = function(id, name) {
    showConfirm(`Delete project "${name}" and all its drawings?`, async () => {
      // Delete all pageData for drawings in this project
      const drawings = await idbGetAllByIndex('drawings', 'projectId', id);
      for (const d of drawings) {
        await idbDeleteByIndex('pageData', 'drawingId', d.id);
      }
      // Delete all drawings
      await idbDeleteByIndex('drawings', 'projectId', id);
      // Delete project
      await idbDelete('projects', id);
      renderDashboard();
    });
  };
  
  // ===== Inline rename in Drawing Manager =====
  window.renameProjectInline = function(projectId, el) {
    // Already editing - don't re-trigger
    if (el.contentEditable === 'true') return;
  
    const currentName = el.textContent.trim();
    el.contentEditable = 'true';
    el.style.outline = '1px solid #e94560';
    el.style.borderRadius = '3px';
    el.style.padding = '2px 6px';
    el.focus();
  
    // Select all text
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  
    let saved = false;
    const save = async () => {
      if (saved) return;
      saved = true;
      el.contentEditable = 'false';
      el.style.outline = '';
      el.style.padding = '';
      const newName = el.textContent.trim();
      if (newName && newName !== currentName) {
        const project = await idbGet('projects', projectId);
        if (project) {
          project.name = newName;
          project.modifiedAt = Date.now();
          await idbPut('projects', project);
        }
      }
      el.textContent = newName || currentName;
    };
    el.addEventListener('blur', save, { once: true });
    el.addEventListener('keydown', function handler(e) {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); el.removeEventListener('keydown', handler); }
      if (e.key === 'Escape') { el.textContent = currentName; el.blur(); el.removeEventListener('keydown', handler); }
      if (e.key === 'Escape') { input.value = currentName; input.blur(); }
    });
  };
  
  // ===== Confirm Dialog =====
  function showConfirm(message, onConfirm) {
    const overlay = document.getElementById('confirmDialog');
    document.getElementById('confirmMessage').textContent = message;
    overlay.classList.add('open');
  
    const yesBtn = document.getElementById('confirmYes');
    const noBtn = document.getElementById('confirmNo');
  
    const cleanup = () => {
      overlay.classList.remove('open');
      yesBtn.replaceWith(yesBtn.cloneNode(true));
      noBtn.replaceWith(noBtn.cloneNode(true));
    };
  
    document.getElementById('confirmYes').addEventListener('click', () => { cleanup(); onConfirm(); }, { once: true });
    document.getElementById('confirmNo').addEventListener('click', () => { cleanup(); }, { once: true });
  }
  
  // =====================================================
  // Drawing Manager
  // =====================================================
  let currentManagerProjectId = null;
  
  async function renderDrawingManager(projectId) {
    currentManagerProjectId = projectId;
    const project = await idbGet('projects', projectId);
    if (!project) { navigateTo('#/'); return; }
  
    const titleEl = document.getElementById('dmProjectTitle');
    titleEl.textContent = project.name;
    titleEl.onclick = () => renameProjectInline(projectId, titleEl);
  
    const drawings = await idbGetAllByIndex('drawings', 'projectId', projectId);
    const content = document.getElementById('drawingManagerContent');
  
    let html = `<div class="upload-zone" id="uploadZone">
      <div class="uz-icon">📄</div>
      <p>Drag & drop PDFs here or click to upload</p>
      <button class="uz-btn" onclick="document.getElementById('drawingFileInput').click()">Choose Files</button>
    </div>`;
  
    // Load pageData for all drawings to show sheet info
    const allPageData = [];
    for (const d of drawings) {
      const pd = await idbGetAllByIndex('pageData', 'drawingId', d.id);
      allPageData.push(...pd);
    }
    // Index: drawingId -> { pageNum -> pageData }
    const sheetIndex = {};
    for (const pd of allPageData) {
      if (!sheetIndex[pd.drawingId]) sheetIndex[pd.drawingId] = {};
      sheetIndex[pd.drawingId][pd.pageNum] = pd;
    }
  
    if (drawings.length === 0) {
      html += `<div class="empty-state"><div class="icon">📐</div><h3>No Drawings Yet</h3><p>Upload PDF files to get started</p></div>`;
    } else {
      html += `<div class="drawing-list">`;
      const sorted = [...drawings].sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
      for (const d of sorted) {
        const modifiedStr = d.modifiedAt ? formatDateTime(d.modifiedAt) : '';
        const size = d.fileSize ? formatFileSize(d.fileSize) : '';
        const pc = d.pageCount || 0;
        const sheetLabel = pc ? `${pc} sheet${pc !== 1 ? 's' : ''}` : '';
        const safeName = escapeHtml(d.fileName).replace(/'/g, "\\'");
        const sheets = sheetIndex[d.id] || {};
        const isExp = _dwExpanded[d.id] ? ' expanded' : '';
  
        html += `<div class="dw-card${isExp}" id="dwCard-${d.id}">`;
  
        // Header row — click to expand/collapse
        html += `<div class="dw-head" onclick="toggleDrawingCard(${d.id})">`;
        html += `<span class="dw-arrow">▶</span>`;
        html += `<div class="dw-head-info">`;
        html += `<div class="dw-head-name" id="drawingName-${d.id}">${escapeHtml(d.fileName)}</div>`;
        html += `<div class="dw-head-meta">`;
        if (sheetLabel) html += `<span>📄 ${sheetLabel}</span>`;
        if (size) html += `<span>${size}</span>`;
        if (modifiedStr) html += `<span>${modifiedStr}</span>`;
        html += `</div></div>`;
  
        // Actions on header
        html += `<div class="dw-head-actions">`;
        html += `<button onclick="event.stopPropagation(); renameDrawing(${d.id})" title="Rename">✏️</button>`;
        html += `<button onclick="event.stopPropagation(); reuploadDrawing(${d.id})" title="Re-upload PDF">🔄</button>`;
        html += `<button onclick="event.stopPropagation(); duplicateDrawing(${d.id})" title="Duplicate">📋</button>`;
        html += `<button onclick="event.stopPropagation(); deleteDrawing(${d.id}, '${safeName}')" title="Delete">🗑️</button>`;
        html += `</div></div>`;
  
        // Body — open button + sheet list
        html += `<div class="dw-body">`;
        html += `<div class="dw-open-bar">`;
        html += `<a class="dw-open-btn" href="#/project/${projectId}/drawing/${d.id}">Open Drawing</a>`;
        html += `</div>`;
  
        if (pc > 0) {
          html += `<div class="dw-sheets">`;
          html += `<div class="dw-sheets-label">Sheets</div>`;
          for (let p = 1; p <= pc; p++) {
            const pd = sheets[p];
            const name = pd && pd.pageName ? pd.pageName : '';
            const hasMeas = pd && ((pd.measurements && pd.measurements.length > 0) || (pd.fittings && pd.fittings.length > 0) || (pd.stacks && pd.stacks.length > 0));
            const hasScale = pd && pd.scale;
            const badge = hasMeas ? '<span class="sr-badge">✓ data</span>' : (hasScale ? '<span class="sr-badge">✓ scale</span>' : '<span class="sr-badge empty">—</span>');
            html += `<div class="sheet-row" onclick="navigateTo('#/project/${projectId}/drawing/${d.id}'); setTimeout(()=>window._goToSheetPage && window._goToSheetPage(${p}),300)">`;
            html += `<span class="sr-num">Pg ${p}</span>`;
            html += `<span class="sr-name" id="shName-${d.id}-${p}">${escapeHtml(name)}</span>`;
            html += badge;
            html += `<span class="sr-icons">`;
            html += `<button onclick="event.stopPropagation(); renameSheetInManager(${d.id}, ${p})" title="Rename sheet">✏️</button>`;
            html += `<button onclick="event.stopPropagation(); deleteSheetInManager(${d.id}, ${p}, ${pc}, '${safeName}')" title="Delete sheet">🗑️</button>`;
            html += `</span>`;
            html += `</div>`;
          }
          html += `</div>`;
        }
  
        html += `</div>`; // dw-body
        html += `</div>`; // dw-card
      }
      html += `</div>`;
    }
  
    content.innerHTML = html;
  
    // Setup upload zone drag/drop
    setupUploadZone();
  }
  
  function setupUploadZone() {
    const zone = document.getElementById('uploadZone');
    if (!zone) return;
  
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => { zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      handleDrawingFiles(e.dataTransfer.files);
    });
    zone.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') document.getElementById('drawingFileInput').click();
    });
  }
  
  document.getElementById('drawingFileInput').addEventListener('change', (e) => {
    handleDrawingFiles(e.target.files);
    e.target.value = '';
  });
  
  async function handleDrawingFiles(files) {
    if (!currentManagerProjectId) return;
  
    for (const file of files) {
      if (file.type !== 'application/pdf') continue;
  
      // Store the blob from the original file BEFORE pdf.js detaches the buffer
      const pdfBlob = file.slice(0, file.size, 'application/pdf');
      let pageCount = 0;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const tempDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        pageCount = tempDoc.numPages;
      } catch (e) {
        console.warn('Could not read PDF page count:', e);
      }
  
      const drawing = {
        projectId: currentManagerProjectId,
        fileName: file.name,
        pdfBlob: pdfBlob,
        fileSize: file.size,
        pageCount,
        uploadedAt: Date.now()
      };
  
      await idbAdd('drawings', drawing);
    }
  
    // Update project modifiedAt + drawingCount
    const project = await idbGet('projects', currentManagerProjectId);
    if (project) {
      project.modifiedAt = Date.now();
      project.drawingCount = (project.drawingCount || 0) + Array.from(files).filter(f => f.type === 'application/pdf').length;
      await idbPut('projects', project);
    }
  
    renderDrawingManager(currentManagerProjectId);
  }
  
  function formatDateTime(ts) {
    const d = new Date(ts);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const year = d.getFullYear();
    let hours = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${month}/${day}/${year} ${hours}:${mins} ${ampm}`;
  }
  
  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  
  window.openDrawing = function(projectId, drawingId) {
    navigateTo(`#/project/${projectId}/drawing/${drawingId}`);
  };
  
  // Re-upload PDF into an existing drawing (replaces broken/missing PDF, keeps all takeoff data)
  // Safety: validates page count matches original to prevent orphaned takeoff data
  window.reuploadDrawing = function(drawingId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file || file.type !== 'application/pdf') {
        alert('⚠️ Please select a PDF file.');
        return;
      }
      const drawing = await idbGet('drawings', drawingId);
      if (!drawing) { alert('⚠️ Drawing not found.'); return; }
      // Read new PDF blob and page count
      const pdfBlob = file.slice(0, file.size, 'application/pdf');
      let newPageCount = 0;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const tempDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        newPageCount = tempDoc.numPages;
      } catch (err) {
        console.warn('Could not read PDF page count:', err);
      }
      const origPages = drawing.pageCount || 0;
      // Check which pages have takeoff data
      const pageData = await idbGetAllByIndex('pageData', 'drawingId', drawingId);
      const pagesWithWork = pageData.filter(pd => {
        const m = pd.measurements || [];
        const f = pd.fittings || [];
        const s = pd.stacks || [];
        return m.length > 0 || f.length > 0 || s.length > 0;
      });
      const maxPageWithWork = pagesWithWork.reduce((max, pd) => {
        const pageNum = parseInt(String(pd.id).split('-').pop()) || 0;
        return Math.max(max, pageNum);
      }, 0);
      // BLOCK: new PDF has fewer pages than the highest page with takeoff data
      if (newPageCount > 0 && maxPageWithWork > 0 && newPageCount < maxPageWithWork) {
        alert(`⚠️ Cannot replace: the new PDF has ${newPageCount} page${newPageCount !== 1 ? 's' : ''} but you have takeoff work on page ${maxPageWithWork}.\n\nUpload the same file (or one with at least ${maxPageWithWork} pages) to avoid losing work.`);
        return;
      }
      // WARN: page count mismatch (but no data would be lost)
      if (origPages > 0 && newPageCount > 0 && newPageCount !== origPages) {
        const proceed = confirm(`⚠️ Page count mismatch:\n\nOriginal: ${origPages} pages\nNew file: ${newPageCount} pages\n\nThis is meant for re-uploading the SAME file (e.g., to fix a corrupted PDF). A different file may cause takeoff positions to be wrong.\n\nContinue anyway?`);
        if (!proceed) return;
      }
      // Update drawing record - keep ID, takeoff data, just replace the PDF
      drawing.pdfBlob = pdfBlob;
      drawing.fileSize = file.size;
      if (newPageCount) drawing.pageCount = newPageCount;
      drawing.modifiedAt = Date.now();
      await idbPut('drawings', drawing);
      showToast(`PDF replaced for "${drawing.fileName}" - takeoff data preserved`);
      renderDrawingManager(currentManagerProjectId);
    };
    input.click();
  };
  
  window.deleteDrawing = function(drawingId, fileName) {
    showConfirm(`Delete drawing "${fileName}"?`, async () => {
      await idbDeleteByIndex('pageData', 'drawingId', drawingId);
      await idbDelete('drawings', drawingId);
      // Update project modifiedAt + drawingCount
      if (currentManagerProjectId) {
        const project = await idbGet('projects', currentManagerProjectId);
        if (project) {
          project.modifiedAt = Date.now();
          project.drawingCount = Math.max(0, (project.drawingCount || 1) - 1);
          await idbPut('projects', project);
        }
      }
      renderDrawingManager(currentManagerProjectId);
    });
  };
  
  window.renameDrawing = async function(drawingId) {
    const nameEl = document.getElementById(`drawingName-${drawingId}`);
    if (!nameEl || nameEl.contentEditable === 'true') return;
  
    const drawing = await idbGet('drawings', drawingId);
    if (!drawing) return;
  
    // Mark parent <a> to block navigation while editing
    const parentLink = nameEl.closest('a.drawing-item');
    if (parentLink) parentLink.dataset.renaming = 'true';
  
    const currentName = drawing.fileName;
    nameEl.textContent = currentName;
    nameEl.contentEditable = 'true';
    nameEl.style.outline = '1px solid #e94560';
    nameEl.style.borderRadius = '3px';
    nameEl.style.padding = '2px 6px';
    nameEl.style.cursor = 'text';
    nameEl.style.display = 'block';
  
    // Block clicks inside the name from triggering the <a> link
    // stopPropagation prevents <a> navigation; do NOT preventDefault on mousedown (kills cursor placement)
    const blockClick = (e) => { e.stopPropagation(); e.preventDefault(); };
    const blockMouse = (e) => { e.stopPropagation(); };
    nameEl.addEventListener('click', blockClick);
    nameEl.addEventListener('mousedown', blockMouse);
  
    nameEl.focus();
  
    const range = document.createRange();
    const dotIdx = currentName.lastIndexOf('.');
    const textNode = nameEl.firstChild;
    if (textNode && dotIdx > 0) {
      range.setStart(textNode, 0);
      range.setEnd(textNode, dotIdx);
    } else {
      range.selectNodeContents(nameEl);
    }
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  
    let saved = false;
    const save = async () => {
      if (saved) return;
      saved = true;
      nameEl.contentEditable = 'false';
      nameEl.style.outline = '';
      nameEl.style.padding = '';
      nameEl.style.cursor = '';
      nameEl.removeEventListener('click', blockClick);
      nameEl.removeEventListener('mousedown', blockMouse);
      if (parentLink) delete parentLink.dataset.renaming;
      const newName = nameEl.textContent.trim();
      if (newName && newName !== currentName) {
        drawing.fileName = newName;
        drawing.modifiedAt = Date.now();
        await idbPut('drawings', drawing);
        // Update project modifiedAt
        if (currentManagerProjectId) {
          const proj = await idbGet('projects', currentManagerProjectId);
          if (proj) { proj.modifiedAt = Date.now(); await idbPut('projects', proj); }
        }
      }
      nameEl.textContent = '📄 ' + (newName || currentName);
    };
    nameEl.addEventListener('blur', save, { once: true });
    nameEl.addEventListener('keydown', function handler(e) {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); nameEl.removeEventListener('keydown', handler); }
      if (e.key === 'Escape') { nameEl.textContent = currentName; nameEl.blur(); nameEl.removeEventListener('keydown', handler); }
    });
  };
  
  window.duplicateDrawing = async function(drawingId) {
    const drawing = await idbGet('drawings', drawingId);
    if (!drawing) return;
  
    const dialog = document.getElementById('duplicateDialog');
    const msgEl = document.getElementById('dupMessage');
    msgEl.textContent = `"${drawing.fileName}" - Do you want to duplicate just the PDF, or include all measurements and scale data?`;
    dialog.classList.add('open');
  
    const btnCancel = document.getElementById('dupCancel');
    const btnDrawing = document.getElementById('dupDrawingOnly');
    const btnTakeoff = document.getElementById('dupWithTakeoff');
  
    const cleanup = () => {
      dialog.classList.remove('open');
      btnCancel.replaceWith(btnCancel.cloneNode(true));
      btnDrawing.replaceWith(btnDrawing.cloneNode(true));
      btnTakeoff.replaceWith(btnTakeoff.cloneNode(true));
    };
  
    document.getElementById('dupCancel').addEventListener('click', cleanup, { once: true });
  
    document.getElementById('dupDrawingOnly').addEventListener('click', async () => {
      cleanup();
      await doDuplicate(drawing, false);
    }, { once: true });
  
    document.getElementById('dupWithTakeoff').addEventListener('click', async () => {
      cleanup();
      await doDuplicate(drawing, true);
    }, { once: true });
  };
  
  async function doDuplicate(originalDrawing, includeTakeoff) {
    const now = Date.now();
    const newName = originalDrawing.fileName.replace(/(\.pdf)$/i, ' (Copy)$1');
  
    const newDrawing = {
      projectId: originalDrawing.projectId,
      fileName: newName,
      pdfBlob: originalDrawing.pdfBlob,
      fileSize: originalDrawing.fileSize,
      pageCount: originalDrawing.pageCount,
      uploadedAt: now,
      modifiedAt: now
    };
  
    const newId = await idbAdd('drawings', newDrawing);
  
    if (includeTakeoff) {
      // Copy all pageData for the original drawing
      const allPageData = await idbGetAllByIndex('pageData', 'drawingId', originalDrawing.id);
      for (const pd of allPageData) {
        const newKey = `${newId}-${pd.pageNum}`;
        const newPd = {
          id: newKey,
          drawingId: newId,
          pageNum: pd.pageNum,
          scale: pd.scale ? { ...pd.scale } : null,
          measurements: pd.measurements ? pd.measurements.map(m => ({ ...m, id: ++window._measIdCounter })) : [],
          pageName: pd.pageName || ''
        };
        await idbPut('pageData', newPd);
      }
      showToast(`Duplicated "${originalDrawing.fileName}" with all takeoff data`);
    } else {
      showToast(`Duplicated "${originalDrawing.fileName}" (drawing only)`);
    }
  
    // Update project modifiedAt + drawingCount
    if (currentManagerProjectId) {
      const proj = await idbGet('projects', currentManagerProjectId);
      if (proj) { proj.modifiedAt = now; proj.drawingCount = (proj.drawingCount || 0) + 1; await idbPut('projects', proj); }
    }
  
    renderDrawingManager(currentManagerProjectId);
  }
  
  // Global measurement counter for duplicates
  window._measIdCounter = window._measIdCounter || 0;
  
  // =====================================================
  // Sheet Management (individual pages within drawings)
  // =====================================================
  
  // Track which drawing cards are expanded (survives re-renders within session)
  const _dwExpanded = {};
  
  // Toggle drawing card expand/collapse
  window.toggleDrawingCard = function(drawingId) {
    _dwExpanded[drawingId] = !_dwExpanded[drawingId];
    const card = document.getElementById('dwCard-' + drawingId);
    if (card) card.classList.toggle('expanded', _dwExpanded[drawingId]);
  };
  
  // Navigate to a specific page after opening a drawing
  window._goToSheetPage = async function(pageNum) {
    await goToSheetPage(pageNum);
  };
  
  // Rename a sheet from the drawing manager
  window.renameSheetInManager = async function(drawingId, pageNum) {
    const el = document.getElementById('shName-' + drawingId + '-' + pageNum);
    if (!el) return;
    const key = drawingId + '-' + pageNum;
    const pd = await idbGet('pageData', key);
    const currentName = (pd && pd.pageName) || '';
  
    el.contentEditable = 'true';
    el.textContent = currentName;
    el.style.outline = '1px solid #e94560';
    el.style.borderRadius = '3px';
    el.style.padding = '1px 4px';
    el.style.color = '#e0e0e0';
    el.focus();
  
    if (currentName) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  
    let saved = false;
    const save = async () => {
      if (saved) return;
      saved = true;
      el.contentEditable = 'false';
      el.style.outline = '';
      el.style.padding = '';
      el.style.color = '';
      const newName = el.textContent.trim();
      // Save to pageData
      const existing = await idbGet('pageData', key);
      if (existing) {
        existing.pageName = newName;
        await idbPut('pageData', existing);
      } else {
        // Create minimal pageData record for this page
        await idbPut('pageData', {
          id: key, drawingId, pageNum,
          scale: null, measurements: [], fittings: [], stacks: [],
          pageName: newName, annoSize: 1, annoTextOpacity: 1, annoFillOpacity: 0.85
        });
      }
      el.textContent = newName;
    };
    el.addEventListener('blur', save, { once: true });
    el.addEventListener('keydown', function handler(e) {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); el.removeEventListener('keydown', handler); }
      if (e.key === 'Escape') { el.textContent = currentName; el.blur(); el.removeEventListener('keydown', handler); }
    });
  };
  
  // Delete a single sheet from a drawing (from drawing manager)
  window.deleteSheetInManager = function(drawingId, pageNum, totalPages, drawingName) {
    if (totalPages <= 1) {
      showConfirm(`This is the only sheet in "${drawingName}". Delete the entire drawing?`, async () => {
        await idbDeleteByIndex('pageData', 'drawingId', drawingId);
        await idbDelete('drawings', drawingId);
        if (currentManagerProjectId) {
          const project = await idbGet('projects', currentManagerProjectId);
          if (project) {
            project.modifiedAt = Date.now();
            project.drawingCount = Math.max(0, (project.drawingCount || 1) - 1);
            await idbPut('projects', project);
          }
        }
        renderDrawingManager(currentManagerProjectId);
      });
      return;
    }
    showConfirm(`Delete sheet ${pageNum} from "${drawingName}"? This will remove the page and any takeoff data on it.`, async () => {
      await _deleteSheetFromDrawing(drawingId, pageNum);
      renderDrawingManager(currentManagerProjectId);
    });
  };
  

  // Core sheet deletion: removes page from PDF blob, shifts pageData, updates drawing record
  async function _deleteSheetFromDrawing(drawingId, pageNum) {
    const drawing = await idbGet('drawings', drawingId);
    if (!drawing || !drawing.pdfBlob) return;
  
    const totalPages = drawing.pageCount || 1;
  
    // Rebuild PDF without the deleted page using pdf.js to render remaining pages to a new PDF
    // Since we can't truly splice a PDF in the browser without a PDF write library,
    // we'll mark the page as deleted by:
    // 1. Delete pageData for the removed page
    // 2. Shift all higher pageData down by 1
    // 3. Update drawing.pageCount
    // 4. Store list of deleted page indices on the drawing record
    //    (the viewer will skip these when rendering)
  
    // Delete takeoff data for the removed page
    const key = drawingId + '-' + pageNum;
    try { await idbDelete('pageData', key); } catch (e) {}
  
    // Shift higher pages down
    for (let p = pageNum + 1; p <= totalPages; p++) {
      const oldKey = drawingId + '-' + p;
      const pd = await idbGet('pageData', oldKey);
      if (pd) {
        // Delete old record
        await idbDelete('pageData', oldKey);
        // Re-insert with new page number
        pd.id = drawingId + '-' + (p - 1);
        pd.pageNum = p - 1;
        await idbPut('pageData', pd);
      }
    }
  
    // Track deleted original page indices so viewer can skip them
    if (!drawing.deletedPages) drawing.deletedPages = [];
    // Map through existing deleted pages to find the original index
    let origPage = pageNum;
    const sorted = [...drawing.deletedPages].sort((a, b) => a - b);
    for (const dp of sorted) {
      if (dp <= origPage) origPage++;
    }
    drawing.deletedPages.push(origPage);
    drawing.pageCount = totalPages - 1;
    drawing.modifiedAt = Date.now();
    await idbPut('drawings', drawing);
  }
  


  return {
    loadQuickbaseProjects,
    fuzzyMatch,
    searchQBProjects,
    renderDashboard,
    renderDrawingManager,
    setupDragImport,
    showToast,
    showConfirm,
    escapeHtml,
    _deleteSheetFromDrawing
  };
}

// ============================================================================
// ORBIT v1.2 - 修复完善版
// 数据结构保持兼容：records { id,date,status,highlight,tags[],note,createdAt }
// ============================================================================

const API = window.AiPhone;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------- 常量 ----------
const STATUS_ORDER = ['very-down', 'down', 'stable', 'up', 'very-up'];
const STATUS_META = {
  'very-down': { sym: '↓↓', label: '被限制' },
  'down':      { sym: '↓',  label: '下降' },
  'stable':    { sym: '→',  label: '平稳' },
  'up':        { sym: '↑',  label: '流动' },
  'very-up':   { sym: '↑↑', label: '高度创造' }
};

// ---------- 状态 ----------
let state = {
  currentMonth: new Date(),
  selectedDate: new Date(),
  records: {},      // date -> [record]
  tags: [],
  settings: { reminderEnabled: true, reminderTime: '21:00', customCSS: '' },
  editingId: null,  // 正在编辑的记录 id
  selectedTags: new Set(),
  selectedStatus: '',
  statsRange: 'all' // all | month | week
};

// ---------- 日期工具（避免 new Date("YYYY-MM-DD") 的时区偏移）----------
function parseLocalDate(str) {
  const p = String(str).split('-').map(Number);
  return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
}
function formatDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function getTodayStr() { return formatDate(new Date()); }
function shiftDate(dateStr, deltaDays) {
  const d = parseLocalDate(dateStr); d.setDate(d.getDate() + deltaDays); return formatDate(d);
}
function isSameMonth(d, monthDate) {
  return d.getFullYear() === monthDate.getFullYear() && d.getMonth() === monthDate.getMonth();
}
function dateDiffDays(aStr, bStr) { // b - a
  const a = parseLocalDate(aStr).getTime(), b = parseLocalDate(bStr).getTime();
  return Math.round((b - a) / 86400000);
}

// ---------- 日期显示 ----------
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
function formatDateCN(d) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${WEEK_CN[d.getDay()]}`;
}

// ============================================================================
// 数据层
// ============================================================================

async function loadData() {
  try {
    const recordsList = await API.db.list('records', { limit: 10000 });
    const tagsList = await API.db.list('tags', { limit: 1000 });
    const settingsList = await API.db.list('settings', { limit: 1 });

    state.records = {};
    recordsList.forEach(it => {
      const d = it.date;
      if (!state.records[d]) state.records[d] = [];
      state.records[d].push(it);
    });

    state.tags = tagsList.map(t => t.name).sort((a, b) => a.localeCompare(b, 'zh'));

    if (settingsList.length > 0) {
      state.settings = Object.assign(state.settings, settingsList[0]);
    }
    applyCustomCSS(state.settings.customCSS);
  } catch (e) {
    console.warn('loadData:', e);
  }
}

async function reloadRecords() {
  // 保存/删除后重新读库，保证页面与数据一致
  const recordsList = await API.db.list('records', { limit: 10000 });
  state.records = {};
  recordsList.forEach(it => {
    const d = it.date;
    if (!state.records[d]) state.records[d] = [];
    state.records[d].push(it);
  });
}

async function saveRecord(record) {
  if (record.id) {
    await API.db.update('records', record.id, record);
  } else {
    record.id = 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    record.createdAt = record.createdAt || new Date().toISOString();
    await API.db.create('records', record);
  }
  return record;
}

async function deleteRecord(id) {
  await API.db.delete('records', id);
}

async function saveTag(name) {
  if (!name || state.tags.includes(name)) return;
  state.tags.push(name);
  state.tags.sort((a, b) => a.localeCompare(b, 'zh'));
  await API.db.create('tags', { name });
}

async function removeTag(name) {
  state.tags = state.tags.filter(t => t !== name);
  const list = await API.db.list('tags', { limit: 1000 });
  const item = list.find(t => t.name === name);
  if (item) await API.db.delete('tags', item.id);
}

async function saveSettings() {
  const list = await API.db.list('settings', { limit: 1 });
  if (list.length > 0) await API.db.update('settings', list[0].id, state.settings);
  else await API.db.create('settings', state.settings);
}

function applyCustomCSS(css) {
  let el = document.getElementById('custom-styles');
  if (!el) { el = document.createElement('style'); el.id = 'custom-styles'; document.head.appendChild(el); }
  el.textContent = css || '';
}

// ============================================================================
// AI 摘要（每天只保留一条，自动更新；无记录的天不生成）
// ============================================================================

async function generateDailySummary(date) {
  const records = state.records[date] || [];
  if (records.length === 0) return null;

  const statuses = records.map(r => r.status);
  const allTags = [...new Set(records.flatMap(r => r.tags || []))];
  const hasHl = records.some(r => r.highlight);

  const summary = `【${date} 创造观测】
状态：${statuses.map(s => STATUS_META[s]?.sym || s).join(' → ')}
触发：${allTags.join('、') || '无'}
${hasHl ? '★ 含重点观察' : ''}`;

  // 本地存一份（按天一条）
  try {
    const list = await API.db.list('daily_summaries', { limit: 10000 });
    const exist = list.find(s => s.date === date);
    if (exist) await API.db.update('daily_summaries', exist.id, { date, text: summary, updatedAt: new Date().toISOString() });
    else await API.db.create('daily_summaries', { date, text: summary, createdAt: new Date().toISOString() });
  } catch (e) { console.warn('summary save:', e); }

  // 写入角色短期记忆（轻量，一条/天，不堆量）
  if (state.characterId) {
    try {
      await API.memory.addTimeline({
        characterId: state.characterId,
        appLabel: '创造观测',
        summary: `${date} 创造状态：${statuses.map(s => STATUS_META[s]?.sym || s).join('→')}`,
        detail: 'daily_observation',
        appEventId: `observation_${date}`,
        data: { date, statuses, tags: allTags, hasHighlight: hasHl }
      });
    } catch (e) { console.warn('timeline:', e); }
  }
  return summary;
}

// ============================================================================
// 页面渲染：月历
// ============================================================================

function renderCalendar() {
  const y = state.currentMonth.getFullYear(), m = state.currentMonth.getMonth();
  $('#monthDisplay').textContent = `${y}年${m + 1}月`;

  const grid = $('#calendarGrid');
  grid.innerHTML = '';

  const firstDay = new Date(y, m, 1).getDay();
  // 转为周一开头：周日=6，周一=0，周二=1…
  const firstDayMon = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = getTodayStr();

  for (let i = 0; i < firstDayMon; i++) {
    const empty = document.createElement('div');
    empty.style.cssText = 'min-width:0;';
    grid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const recs = state.records[dateStr] || [];

    const cell = document.createElement('div');
    cell.className = 'cal-cell';

    const dayNum = document.createElement('div');
    dayNum.className = 'day-num' + (dateStr === todayStr ? ' today' : '');
    dayNum.textContent = day;

    const star = document.createElement('div');
    star.className = 'day-star';
    star.textContent = recs.some(r => r.highlight) ? '★' : '';

    // 状态轨迹：按时间顺序展示当天出现的不同状态（去重连续重复，最多显示3个箭头）
    const trail = document.createElement('div');
    trail.className = 'day-trail';
    if (recs.length > 0) {
      const sorted = recs.slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      let last = '', html = '', cnt = 0;
      sorted.forEach(r => {
        const meta = STATUS_META[r.status];
        if (!meta) return;
        if (meta.sym !== last) {
          if (cnt >= 3) return; // 最多3个，更多的就不显示了
          html += `<span class="st-${r.status}">${meta.sym}</span>`;
          last = meta.sym;
          cnt++;
        }
      });
      trail.innerHTML = html || '';
    }

    // 标签（最多显示 1 个 + 计数）
    const tags = document.createElement('div');
    tags.className = 'day-tags';
    if (recs.length > 0) {
      const allTags = [...new Set(recs.flatMap(r => r.tags || []))];
      tags.textContent = allTags.length > 1 ? allTags.slice(0, 1).join('') + `+${allTags.length - 1}` : (allTags[0] || '');
    }

    cell.appendChild(dayNum);
    cell.appendChild(star);
    cell.appendChild(trail);
    cell.appendChild(tags);

    cell.addEventListener('click', () => {
      state.selectedDate = parseLocalDate(dateStr);
      switchTab('today');
      renderToday();
    });

    grid.appendChild(cell);
  }
}

// ============================================================================
// 页面渲染：当天（可查看任意日期，历史日期可编辑/新增）
// ============================================================================

function renderToday() {
  const dateStr = formatDate(state.selectedDate);
  const todayStr = getTodayStr();

  $('#todayDate').textContent = formatDateCN(state.selectedDate);
  const sub = $('#todayCount');
  const recs = state.records[dateStr] || [];
  sub.textContent = dateStr === todayStr ? '今天' : (recs.length ? `${recs.length} 条观测` : '无记录');

  const container = $('#todayRecords');
  container.innerHTML = '';

  if (recs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `<div class="icon">🌗</div>这一天没有观测记录`;
    container.appendChild(empty);
    return;
  }

  const sorted = recs.slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  sorted.forEach(rec => {
    const meta = STATUS_META[rec.status] || { sym: rec.status, label: rec.status };
    const card = document.createElement('div');
    card.className = 'record' + (rec.highlight ? ' starred' : '');

    const timeStr = rec.createdAt ? new Date(rec.createdAt).toTimeString().slice(0, 5) : '';

    card.innerHTML = `
      <div class="record-top">
        <span class="record-status st-${rec.status}">${meta.sym} <span style="font-size:13px; font-weight:500; color:var(--text-2);">${meta.label}</span>${rec.highlight ? '<span class="record-star">★</span>' : ''}</span>
        <div class="record-meta">
          <span class="record-time">${timeStr}</span>
          <button class="btn btn-ghost btn-sm edit-rec" data-id="${rec.id}">编辑</button>
        </div>
      </div>
      ${rec.tags && rec.tags.length ? `<div class="record-tags">${rec.tags.map(t => `<span class="record-tag">${t}</span>`).join('')}</div>` : ''}
      ${rec.note ? `<div class="record-note">${escapeHtml(rec.note)}</div>` : ''}
    `;
    container.appendChild(card);
  });

  // 编辑按钮
  container.querySelectorAll('.edit-rec').forEach(btn => {
    btn.addEventListener('click', () => openRecordSheet(btn.dataset.id));
  });
}

// 当天页翻页：上一天 / 下一天
function shiftToday(delta) {
  const d = parseLocalDate(formatDate(state.selectedDate));
  d.setDate(d.getDate() + delta);
  state.selectedDate = d;
  renderToday();
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

// ============================================================================
// 记录表单（新增 & 编辑）
// ============================================================================

function openRecordSheet(recordId = null) {
  state.editingId = recordId;
  state.selectedTags = new Set();
  state.selectedStatus = '';

  $('#recordSheetTitle').textContent = recordId ? '编辑观测' : '新增观测';
  $('#recordNote').value = '';
  $('#isHighlight').classList.remove('on');
  $('#deleteRecordBtn').style.display = recordId ? 'block' : 'none';

  // 状态按钮
  $$('#statusPicker button').forEach(b => b.classList.remove('sel'));

  if (recordId) {
    // 查找记录（可能在任意日期，不止今天）
    let found = null;
    Object.values(state.records).forEach(arr => {
      const r = arr.find(x => x.id === recordId);
      if (r) found = r;
    });
    if (found) {
      state.selectedStatus = found.status;
      state.selectedTags = new Set(found.tags || []);
      $('#recordNote').value = found.note || '';
      if (found.highlight) $('#isHighlight').classList.add('on');
      $$('#statusPicker button').forEach(b => {
        if (b.dataset.status === found.status) b.classList.add('sel');
      });
    }
  }

  renderTagPicker();
  $('#recordSheet').classList.add('open');
}

function closeRecordSheet() {
  $('#recordSheet').classList.remove('open');
  state.editingId = null;
}

function renderTagPicker() {
  const wrap = $('#tagPicker');
  wrap.innerHTML = '';
  if (state.tags.length === 0) {
    const hint = document.createElement('span');
    hint.style.cssText = 'font-size:13px;color:var(--text-3);';
    hint.textContent = '还没有标签，下方添加一个';
    wrap.appendChild(hint);
    return;
  }
  state.tags.forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-pick' + (state.selectedTags.has(tag) ? ' sel' : '');
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      if (state.selectedTags.has(tag)) { state.selectedTags.delete(tag); btn.classList.remove('sel'); }
      else { state.selectedTags.add(tag); btn.classList.add('sel'); }
    });
    wrap.appendChild(btn);
  });
}

async function handleRecordSubmit(e) {
  e.preventDefault();

  if (!state.selectedStatus) {
    await toast('请选择一个创造状态');
    return;
  }

  // 关键修复：用当前查看的日期，而不是系统今天
  const dateStr = formatDate(state.selectedDate);

  let record;
  if (state.editingId) {
    // 编辑：从库里取原记录，保留原 date
    let original = null;
    Object.values(state.records).forEach(arr => {
      const r = arr.find(x => x.id === state.editingId);
      if (r) original = r;
    });
    if (!original) { await toast('记录不存在'); closeRecordSheet(); return; }
    record = Object.assign({}, original);
    record.status = state.selectedStatus;
    record.tags = Array.from(state.selectedTags);
    record.note = $('#recordNote').value.trim();
    record.highlight = $('#isHighlight').classList.contains('on');
  } else {
    record = {
      date: dateStr,
      status: state.selectedStatus,
      tags: Array.from(state.selectedTags),
      note: $('#recordNote').value.trim(),
      highlight: $('#isHighlight').classList.contains('on'),
      createdAt: new Date().toISOString()
    };
  }

  try {
    await saveRecord(record);
    await reloadRecords();          // 立即重新读库，页面即时更新
    closeRecordSheet();
    renderToday();
    renderCalendar();
    renderStats();
    await generateDailySummary(record.date);
    await toast('已保存');
  } catch (err) {
    await toast('保存失败：' + err.message);
  }
}

async function handleRecordDelete(e) {
  e.preventDefault();
  if (!state.editingId) return;
  try {
    await deleteRecord(state.editingId);
    await reloadRecords();
    closeRecordSheet();
    renderToday();
    renderCalendar();
    renderStats();
    await toast('已删除');
  } catch (err) {
    await toast('删除失败：' + err.message);
  }
}

// ============================================================================
// 统计
// ============================================================================

function filterRecordsByRange(range) {
  const today = getTodayStr();
  let minDate = '0000-00-00';
  if (range === 'week') minDate = shiftDate(today, -6);      // 最近7天
  else if (range === 'month') minDate = shiftDate(today, -29); // 最近30天

  const out = [];
  Object.entries(state.records).forEach(([date, arr]) => {
    if (date >= minDate) arr.forEach(r => out.push(Object.assign({ date }, r)));
  });
  return out;
}

function renderStats() {
  renderStatusStats();
  renderTrendStats();
  renderTagStats();
  renderHighlightStats();
}

function renderStatusStats() {
  const card = $('#statusStats');
  const records = filterRecordsByRange(state.statsRange);

  const counts = {};
  STATUS_ORDER.forEach(s => counts[s] = 0);
  records.forEach(r => { if (counts[r.status] != null) counts[r.status]++; });
  const total = records.length;

  const segHtml = `
    <div class="seg" id="statsRangeSeg">
      <button data-r="all" class="${state.statsRange === 'all' ? 'sel' : ''}">全部</button>
      <button data-r="month" class="${state.statsRange === 'month' ? 'sel' : ''}">本月</button>
      <button data-r="week" class="${state.statsRange === 'week' ? 'sel' : ''}">本周</button>
    </div>`;

  let bars = '';
  STATUS_ORDER.forEach(s => {
    const meta = STATUS_META[s];
    const n = counts[s] || 0;
    const pct = total ? Math.round(n / total * 100) : 0;
    bars += `
      <div class="bar-row">
        <span class="bar-lbl st-${s}">${meta.sym}</span>
        <span class="bar-count">${n} 次</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:var(--st-${s});"></div></div>
        <span class="bar-pct">${pct}%</span>
      </div>`;
  });

  card.innerHTML = `
    <div class="stat-top">
      <div class="stat-total">总观测 <b>${total}</b> 条</div>
      ${segHtml}
    </div>
    ${bars}
    ${total === 0 ? '<div style="color:var(--text-3);font-size:13px;text-align:center;padding:10px 0;">暂无观测数据</div>' : ''}`;

  $('#statsRangeSeg').querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.statsRange = btn.dataset.r;
      renderStats();
    });
  });
}

function renderTrendStats() {
  const card = $('#trendStats');
  const dates = Object.keys(state.records).sort();
  if (dates.length === 0) {
    card.innerHTML = '<div style="color:var(--text-3);font-size:13px;text-align:center;padding:10px 0;">记录后将在此显示趋势</div>';
    return;
  }

  const rows = [];
  dates.slice(-14).forEach(date => {
    const recs = (state.records[date] || []).slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const syms = [];
    let last = '';
    recs.forEach(r => {
      const meta = STATUS_META[r.status];
      if (meta && meta.sym !== last) { syms.push(`<span class="s st-${r.status}">${meta.sym}</span>`); last = meta.sym; }
    });
    const hl = recs.some(r => r.highlight) ? '<span style="color:var(--star);">★</span>' : '';
    rows.push(`<div class="trend-item"><span class="d">${date.slice(5)}</span>${syms.join('')}${hl}</div>`);
  });

  card.innerHTML = `<div class="trend-line">${rows.join('')}</div>`;
}

function renderTagStats() {
  const card = $('#tagStats');
  const records = filterRecordsByRange(state.statsRange);

  const tagCount = {};
  const tagStatus = {};
  records.forEach(r => {
    (r.tags || []).forEach(t => {
      tagCount[t] = (tagCount[t] || 0) + 1;
      if (!tagStatus[t]) tagStatus[t] = {};
      tagStatus[t][r.status] = (tagStatus[t][r.status] || 0) + 1;
    });
  });

  const sorted = Object.entries(tagCount).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    card.innerHTML = '<div style="color:var(--text-3);font-size:13px;text-align:center;padding:10px 0;">暂无标签数据</div>';
    return;
  }

  const max = sorted[0][1];
  let html = '';
  sorted.forEach(([tag, n]) => {
    const pct = Math.round(n / max * 100);
    const stStr = STATUS_ORDER.map(s => {
      const c = tagStatus[tag][s] || 0;
      return c ? `<span class="st-${s}" style="font-weight:600;">${STATUS_META[s].sym}${c}</span>` : '';
    }).filter(Boolean).join(' ');
    html += `
      <div class="tag-stat-row">
        <div style="flex:1; min-width:0;">
          <div class="tag-stat-name">${escapeHtml(tag)} <span style="font-size:11px;color:var(--text-3);">${pct}%</span></div>
          <div style="font-size:11px; margin-top:2px; display:flex; gap:6px; flex-wrap:wrap;">${stStr || '<span style="color:var(--text-3);">—</span>'}</div>
        </div>
        <span class="tag-stat-count">${n} 次</span>
      </div>`;
  });

  card.innerHTML = html;
}

function renderHighlightStats() {
  const card = $('#hlStats');
  const today = getTodayStr();

  const all = [];
  Object.entries(state.records).forEach(([date, arr]) => {
    arr.forEach(r => { if (r.highlight) all.push(Object.assign({ date }, r)); });
  });
  all.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));

  const total = all.length;
  const month = all.filter(r => r.date >= shiftDate(today, -29)).length;
  const week = all.filter(r => r.date >= shiftDate(today, -6)).length;

  let html = `
    <div class="stat-top">
      <div class="stat-total">重点观察 <b>${total}</b> 条</div>
    </div>
    <div style="display:flex; gap:16px; margin-bottom:12px; font-size:13px; color:var(--text-2);">
      <span>本周 <b style="font-size:17px;">${week}</b></span>
      <span>本月 <b style="font-size:17px;">${month}</b></span>
    </div>`;

  if (total === 0) {
    html += '<div style="color:var(--text-3);font-size:13px;text-align:center;padding:8px 0;">暂无重点观察<br><span style="font-size:12px;">在观测时勾选 ★ 即可标记</span></div>';
  } else {
    html += `<div id="hlList">`;
    all.slice(0, 3).forEach(r => {
      const meta = STATUS_META[r.status] || { sym: r.status };
      html += `
        <div class="hl-card glass" style="cursor:pointer;" data-hldate="${r.date}">
          <span class="hl-star">★</span>
          <div class="hl-main">
            <div class="hl-date">${r.date} <span class="st-${r.status}">${meta.sym}</span></div>
            <div class="hl-sub">${escapeHtml((r.tags || []).join(' · ') || (r.note || '无标签'))}</div>
          </div>
          <span style="color:var(--text-3);">›</span>
        </div>`;
    });
    if (all.length > 3) {
      html += `<button class="link-btn" id="showAllHl" style="margin-top:4px;">查看全部 ${total} 条 →</button>`;
    }
    html += `</div>`;
  }

  card.innerHTML = html;

  // 点击重点观察 → 跳到该日期当天页
  $$('#hlList .hl-card').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedDate = parseLocalDate(el.dataset.hldate);
      switchTab('today');
      renderToday();
    });
  });

  const showAll = $('#showAllHl');
  if (showAll) showAll.addEventListener('click', () => openHighlightList(all));
}

// 查看全部重点观察
function openHighlightList(all) {
  // 动态创建 Bottom Sheet
  let mask = document.getElementById('hlSheet');
  if (mask) mask.remove();

  mask = document.createElement('div');
  mask.className = 'sheet-mask open';
  mask.id = 'hlSheet';
  mask.innerHTML = `
    <div class="sheet">
      <div class="sheet-grabber"></div>
      <div class="sheet-title">全部重点观察</div>
      <div id="hlSheetList"></div>
    </div>`;
  document.body.appendChild(mask);

  const list = mask.querySelector('#hlSheetList');
  all.forEach(r => {
    const meta = STATUS_META[r.status] || { sym: r.status };
    const item = document.createElement('div');
    item.className = 'hl-card glass';
    item.style.cssText = 'cursor:pointer;';
    item.innerHTML = `
      <span class="hl-star">★</span>
      <div class="hl-main">
        <div class="hl-date">${r.date} <span class="st-${r.status}">${meta.sym}</span> ${escapeHtml((r.tags || []).join(' · '))}</div>
        <div class="hl-sub">${escapeHtml(r.note || '（无备注）')}</div>
      </div>
      <span style="color:var(--text-3);">›</span>`;
    item.addEventListener('click', () => {
      mask.remove();
      state.selectedDate = parseLocalDate(r.date);
      switchTab('today');
      renderToday();
    });
    list.appendChild(item);
  });

  mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });
}

// ============================================================================
// 设置
// ============================================================================

function renderTagLibrary() {
  const wrap = $('#tagLibrary');
  wrap.innerHTML = '';
  if (state.tags.length === 0) {
    const hint = document.createElement('div');
    hint.style.cssText = 'padding:12px;color:var(--text-3);font-size:13px;text-align:center;';
    hint.textContent = '标签库为空，记录时添加';
    wrap.appendChild(hint);
    return;
  }
  state.tags.forEach(tag => {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const name = document.createElement('span');
    name.className = 'lbl';
    name.textContent = tag;
    const del = document.createElement('button');
    del.className = 'btn btn-ghost btn-sm';
    del.textContent = '删除';
    del.style.cssText = 'color:#E0453C;background:rgba(255,59,48,0.06);border:none;';
    del.addEventListener('click', async () => {
      await removeTag(tag);
      renderTagLibrary();
      renderTagPicker();
      renderTagStats();
      await toast('已删除标签');
    });
    row.appendChild(name);
    row.appendChild(del);
    wrap.appendChild(row);
  });
}

function renderSettings() {
  $('#reminderEnabled').classList.toggle('on', !!state.settings.reminderEnabled);
  $('#reminderTime').value = state.settings.reminderTime || '21:00';
  $('#customCSS').value = state.settings.customCSS || '';
  renderTagLibrary();
}

// ============================================================================
// 提醒
// ============================================================================

async function scheduleReminder() {
  if (!state.settings.reminderEnabled) return;

  const [h, m] = (state.settings.reminderTime || '21:00').split(':').map(Number);
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
  if (target <= now) target.setDate(target.getDate() + 1);

  try {
    // 用唯一 id 覆盖旧任务
    await API.tasks.schedule({
      id: 'reminder_daily',
      delayMs: target.getTime() - now.getTime(),
      actions: [
        {
          type: 'notification',
          title: '创造观测',
          body: '回看今天：有什么值得观测的能量变化吗？',
          badgeDelta: 1
        }
      ]
    });
  } catch (e) {
    // 可能是同 id 重复任务被拒，用带时间戳的新 id 重试一次
    try {
      await API.tasks.schedule({
        id: 'reminder_daily_' + Date.now(),
        delayMs: target.getTime() - now.getTime(),
        actions: [
          {
            type: 'notification',
            title: '创造观测',
            body: '回看今天：有什么值得观测的能量变化吗？',
            badgeDelta: 1
          }
        ]
      });
    } catch (e2) {
      console.warn('scheduleReminder retry:', e2);
    }
  }
}

// ============================================================================
// AI 工具
// ============================================================================

function registerAITools() {
  // 查询创造记录
  API.tools.handle('queryCreationRecords', async (args) => {
    const range = args.range || '7d';
    const tag = args.tag || '';
    const date = args.date || '';
    const includeNote = !!args.includeNote;
    const highlightOnly = !!args.highlightOnly;
    const status = args.status || '';

    let list = [];
    const today = getTodayStr();

    if (range === 'date' && date) {
      (state.records[date] || []).forEach(r => list.push(Object.assign({ date }, r)));
    } else if (range === 'tag' && tag) {
      Object.entries(state.records).forEach(([d, arr]) => {
        arr.forEach(r => { if ((r.tags || []).includes(tag)) list.push(Object.assign({ date: d }, r)); });
      });
    } else {
      let minDate = '0000-00-00';
      if (range === '7d') minDate = shiftDate(today, -6);
      else if (range === '30d') minDate = shiftDate(today, -29);
      Object.entries(state.records).forEach(([d, arr]) => {
        if (d >= minDate) arr.forEach(r => list.push(Object.assign({ date: d }, r)));
      });
    }

    if (highlightOnly) list = list.filter(r => r.highlight);
    if (status) list = list.filter(r => r.status === status);
    list.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));

    return {
      success: true,
      data: {
        range, tag, date,
        recordCount: list.length,
        records: list.map(r => ({
          date: r.date,
          status: r.status,
          statusLabel: STATUS_META[r.status] ? `${STATUS_META[r.status].sym} ${STATUS_META[r.status].label}` : r.status,
          highlight: !!r.highlight,
          tags: r.tags || [],
          note: includeNote ? r.note : undefined
        }))
      },
      userNotice: `查询到 ${list.length} 条创造观测记录`
    };
  });

  // 建议沉淀模式（需用户确认）
  API.tools.handle('suggestPatternConsolidation', async (args) => {
    const { pattern, tag, effect, evidence } = args;
    try {
      await API.db.create('pattern_suggestions', {
        pattern, tag, effect, evidence,
        status: 'pending',
        createdAt: new Date().toISOString()
      });
    } catch (e) { /* 存不下就算了，仍可返回成功 */ }

    // 通过聊天历史让用户看到这条建议（由用户确认是否沉淀）
    return {
      success: true,
      data: { status: 'pending_user_confirmation', pattern, tag, effect },
      userNotice: `发现潜在模式：${pattern}（${effect}）。建议：若同意，请告诉我「确认沉淀」，我将写入长期记忆。`
    };
  });
}

// ============================================================================
// 导入导出
// ============================================================================

async function exportData() {
  const data = { records: state.records, tags: state.tags, settings: state.settings };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `创造观测备份_${getTodayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  await toast('已导出');
}

async function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      // 逐条写入，保留原有 id 与数据
      if (data.records) {
        for (const [date, arr] of Object.entries(data.records)) {
          for (const rec of arr) {
            const item = Object.assign({ date }, rec);
            if (!item.id) { item.id = 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10); item.createdAt = item.createdAt || new Date().toISOString(); }
            try { await API.db.create('records', item); } catch (err) { /* 重复 id 跳过 */ }
          }
        }
      }
      if (data.tags) { for (const t of data.tags) { try { await API.db.create('tags', { name: t }); } catch (err) {} } }
      if (data.settings) { state.settings = Object.assign(state.settings, data.settings); await saveSettings(); }

      await reloadRecords();
      // 重新加载 tags
      const tagsList = await API.db.list('tags', { limit: 1000 });
      state.tags = tagsList.map(t => t.name).sort((a, b) => a.localeCompare(b, 'zh'));

      renderAll();
      await toast('导入完成');
    } catch (err) {
      await toast('导入失败：' + err.message);
    }
  };
  input.click();
}

// ============================================================================
// 导航 & 启动
// ============================================================================

function switchTab(name) {
  $$('.tabnav button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  if (name === 'calendar') renderCalendar();
  if (name === 'today') renderToday();
  if (name === 'stats') renderStats();
}

function renderAll() {
  renderCalendar();
  renderToday();
  renderStats();
}

function bindEvents() {
  // 标签切换
  $$('.tabnav button').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // 月历翻月
  $('#prevMonthBtn').addEventListener('click', () => { state.currentMonth.setMonth(state.currentMonth.getMonth() - 1); renderCalendar(); });
  $('#nextMonthBtn').addEventListener('click', () => { state.currentMonth.setMonth(state.currentMonth.getMonth() + 1); renderCalendar(); });

  // 新增观测（记录到当前查看的日期）
  $('#addRecordBtn').addEventListener('click', () => openRecordSheet());

  // 当天页翻页：上一天 / 下一天
  $('#prevDayBtn').addEventListener('click', () => shiftToday(-1));
  $('#nextDayBtn').addEventListener('click', () => shiftToday(1));

  // 记录表单
  $('#recordForm').addEventListener('submit', handleRecordSubmit);
  $('#cancelRecordBtn').addEventListener('click', closeRecordSheet);
  $('#deleteRecordBtn').addEventListener('click', handleRecordDelete);
  $('#recordSheet').addEventListener('click', (e) => { if (e.target === $('#recordSheet')) closeRecordSheet(); });

  // 状态选择
  $$('#statusPicker button').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#statusPicker button').forEach(b => b.classList.remove('sel'));
      btn.classList.add('sel');
      state.selectedStatus = btn.dataset.status;
    });
  });

  // ★ 开关
  $('#isHighlight').addEventListener('click', () => $('#isHighlight').classList.toggle('on'));

  // 新标签
  $('#addTagBtn').addEventListener('click', async () => {
    const input = $('#newTagInput');
    const name = input.value.trim();
    if (!name) return;
    await saveTag(name);
    input.value = '';
    renderTagPicker();
    renderTagLibrary();
  });
  $('#newTagInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#addTagBtn').click(); }
  });

  // 设置
  $('#settingsBtn').addEventListener('click', () => { renderSettings(); $('#settingsSheet').classList.add('open'); });
  $('#settingsSheet').addEventListener('click', (e) => { if (e.target === $('#settingsSheet')) $('#settingsSheet').classList.remove('open'); });

  $('#reminderEnabled').addEventListener('click', async () => {
    state.settings.reminderEnabled = !state.settings.reminderEnabled;
    $('#reminderEnabled').classList.toggle('on', state.settings.reminderEnabled);
    await saveSettings();
    await scheduleReminder();
    await toast(state.settings.reminderEnabled ? '提醒已开启' : '提醒已关闭');
  });
  $('#reminderTime').addEventListener('change', async () => {
    state.settings.reminderTime = $('#reminderTime').value || '21:00';
    await saveSettings();
    await scheduleReminder();
    await toast('提醒时间已更新');
  });
  $('#cssExampleBtn').addEventListener('click', async () => {
    // 提取当前自定义 CSS 或默认样式，填入输入框
    const current = state.settings.customCSS || '';
    const example = current || `/* ===== ORBIT 自定义样式示例 ===== */
/* 修改主题色 */
:root {
  --color-accent-strong: #7C3AED;  /* 紫罗兰强调色 */
  --color-bg: #FAFAFA;
}

/* 调整月历格子 */
.cal-cell {
  border-radius: 4px;
}

/* 修改标签样式 */
.record-tag {
  background: rgba(124, 58, 237, 0.1);
  color: #7C3AED;
}`;
    $('#customCSS').value = example;
    await API.ui.toast('已填入示例，点「应用样式」生效');
  });

  $('#applyCSSBtn').addEventListener('click', async () => {
    state.settings.customCSS = $('#customCSS').value;
    applyCustomCSS(state.settings.customCSS);
    await saveSettings();
    await toast('样式已应用');
  });
  $('#exportDataBtn').addEventListener('click', exportData);
  $('#importDataBtn').addEventListener('click', importData);
}

async function toast(msg) {
  try { await API.ui.toast(msg); } catch (e) { console.log('[toast]', msg); }
}

async function init() {
  try {
    // 关联角色（从打开上下文获取；桌面打开则选择第一个可用角色）
    const ctx = await API.app.getLaunchContext();
    if (ctx && ctx.characterId) {
      state.characterId = ctx.characterId;
    } else {
      try {
        const chars = await API.characters.list();
        if (chars && chars.length > 0) state.characterId = chars[0].id;
      } catch (e) {}
    }
  } catch (e) {}

  await loadData();
  bindEvents();
  renderAll();
  registerAITools();
  scheduleReminder();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

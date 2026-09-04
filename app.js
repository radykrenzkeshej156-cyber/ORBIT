// ============================================================================
// ORBIT v1.5 - 修复完善版
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
  selectedCalDate: null,   // 月历底部预览选中的日期
  records: {},      // date -> [record]
  tags: [],
  groups: {},       // groupName -> [tagName]
  energyPct: {},    // date -> 0..100 手动能量百分比
  settings: { reminderEnabled: true, reminderTime: '21:00', customCSS: '', bgImage: '' },
  editingId: null,  // 正在编辑的记录 id
  selectedTags: new Set(),
  selectedStatus: '',
  isCreation: false,       // 记录表单中追溯创造开关
  selectedCreationDate: '',// 记录表单中追溯创造日期
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
    const groupsList = await API.db.list('groups', { limit: 500 });
    const pctList = await API.db.list('energy_pct', { limit: 5000 });

    state.records = {};
    recordsList.forEach(it => {
      const d = it.date;
      if (!state.records[d]) state.records[d] = [];
      state.records[d].push(it);
    });

    state.tags = tagsList.map(t => t.name).sort((a, b) => a.localeCompare(b, 'zh'));

    state.groups = {};
    groupsList.forEach(g => {
      state.groups[g.name] = g.tags || [];
    });

    state.energyPct = {};
    pctList.forEach(p => { state.energyPct[p.date] = p.pct; });

    if (settingsList.length > 0) {
      state.settings = Object.assign(state.settings, settingsList[0]);
    }
    applyCustomCSS(state.settings.customCSS);
    applyBackgroundImage();
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

// 「AI 制作指南」全文：设置 → 自定义 CSS → AI 制作指南 按钮填入。
// 目标：把这段指南单独发给任意 AI，AI 不读取任何仓库文件也能写出
// 改变整个 APP 全局外观、可直接使用的自定义 CSS。
const CSS_GUIDE = `/* ============================================================
   ORBIT 全局美化 CSS · AI 制作指南（v1.5）
   ------------------------------------------------------------
   用法：把本指南整段发给任意 AI，并附一句
   「请按指南为 ORBIT 写一份全局美化 CSS」，
   AI 无需读取任何仓库文件即可写出可直接使用的主题。
   拿到 CSS 后粘贴到本输入框，点「应用样式」全局生效。
   ============================================================ */

【一、运行机制（AI 必读）】
1. 你的 CSS 会被注入为 <style id="custom-styles">，位于 ORBIT 全部内置样式之后：同选择器同优先级时你的规则必胜，一般无需 !important。
2. 这是单页应用，共三个标签页：TRACE（月历）、MOMENT（当天）、ARC（统计），切换不刷新页面，所有节点常驻，直接写选择器即可。
3. 设置、观测表单、各类确认框都是页面内固定定位的弹层，不是新文档。
4. 只输出纯 CSS 规则；不要 @import、不要引用外部图片/字体、不要包含 HTML 或 JS。
5. 优先改 :root 设计变量，其次按类名覆盖组件；保持移动端可读性（正文不小于 12px）。

【二、设计变量（改 :root 即全局换装）】
--color-bg 页面背景｜--color-surface 卡片/弹窗表面｜--color-surface-2 次级表面(输入框/内嵌)｜--color-surface-3 三级表面(分段控件底)
--color-text-1 主文字｜--color-text-2 次级文字｜--color-text-3 弱化文字
--color-accent 中性强调｜--color-accent-strong 主按钮/选中态/今日描边｜--color-accent-soft 强调淡底
--color-border 卡片边框｜--color-hairline 细分隔线
--color-danger / --color-danger-soft 危险按钮
状态五档基础色（改这五个即可全局生效，月历箭头与统计条都会跟随）：
  --st-vd ↓↓被限制｜--st-d ↓下降｜--st-s →平稳｜--st-u ↑流动｜--st-vu ↑↑高度创造
  （等价别名 --st-very-down/--st-down/--st-stable/--st-up/--st-very-up，默认自动跟随基础档）
--star ★重点观察的金色
圆角：--radius-sm 8px｜--radius-md 12px｜--radius-lg 16px(卡片)｜--radius-xl 22px(弹窗顶角)
阴影：--shadow-sm｜--shadow-md｜--shadow-lg(弹窗)
间距：--sp-1 4px ~ --sp-6 28px｜字体：--font-ui｜动效：--ease 缓动、--dur 0.18s
旧别名（兼容旧 CSS，仍有效）：--primary --primary-soft --text-1 --text-2 --text-3 --bg --glass --glass-strong --hairline --radius --shadow

【三、组件类名清单】
骨架：body｜.app 应用容器｜.topbar 顶栏｜.topbar h1 大标题｜.icon-btn 设置圆钮
  .tabnav 标签分段控件｜.tabnav button.active 选中白块｜.page 页容器｜.page-scroll 滚动区
月历：.glass 通用卡片面｜.cal-head 月份栏｜.cal-nav-btn 翻页圆钮｜.cal-week 星期表头｜.cal-grid 月网格
  .cal-cell 日期格｜.cal-cell.is-today 今天｜.cal-cell.is-selected 选中
  .cal-cell .day-num 日期数字｜.day-star ★行｜.day-pct 能量百分比｜.day-trail 箭头轨迹｜.day-tags 标签行
  .cal-foot 选中日预览卡｜.cal-foot-rec 记录行｜.cal-foot-note 备注胶囊｜.cal-foot-creation 追溯行
当天页：.day-head 日期头｜.day-nav-btn 翻日圆钮｜.record 观测卡｜.record.starred 重点卡
  .record-status 状态行｜.record-tag 标签胶囊｜.record-note 备注块
统计页：.stat-title 小标题｜.stat-card｜.seg 分段控件｜.seg button.sel｜.bar-row/.bar-track/.bar-fill 状态条
  .tag-stat-row 标签统计行｜.hl-card 重点观察卡｜.link-btn 文字按钮
按钮：.btn 基类｜.btn-primary 主按钮｜.btn-soft 浅底｜.btn-ghost 描边｜.btn-danger 危险｜.btn-block 通栏｜.btn-sm 小号
弹窗：.sheet-mask 遮罩｜.sheet 弹窗面板｜.sheet-grabber 顶部横条｜.sheet-title 标题
表单：.field｜.field-label｜.status-picker 五状态选择｜.tag-pick 标签胶囊｜.switch iOS 开关(.on 开态, ::after 滑块)
  .settings-group 设置分组卡｜.settings-row 设置行
其他：.empty 空状态｜#bg-layer 背景图层(fixed, z-index:0)｜body.has-bg 已设置背景图时的根标记
安全区（宿主注入，勿改）：--ai-phone-app-safe-top / --ai-phone-app-safe-bottom

【四、固定颜色位置（暗色/深色主题需单独覆盖）】
.switch 底色固定浅灰｜.sheet-grabber 固定灰｜.cal-cell .day-pct.pct-low 与 .pct-high 固定灰阶
.btn-primary 文字固定白色（深底时通常没问题，浅底时改深色）
.record.starred 描边阴影为固定金色 rgba

【五、背景图模式】
设置背景图后 body 带 .has-bg，.app 背景透明，#bg-layer 铺底。
毛玻璃做法：
body.has-bg .glass,
body.has-bg .record,
body.has-bg .sheet { background: rgba(255,255,255,0.72); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
暗色主题把 rgba 换成深色半透明即可。未设背景图时不要全局加透明。

【六、完整示例 A · 暗色毛玻璃】
:root {
  --color-bg: #0B0B0E;
  --color-surface: rgba(28,28,34,0.92);
  --color-surface-2: rgba(44,44,52,0.9);
  --color-surface-3: rgba(52,52,60,0.85);
  --color-text-1: #F0F0F4;
  --color-text-2: #A6A6AF;
  --color-text-3: #5E5E68;
  --color-accent-strong: #DADAE2;
  --color-accent-soft: rgba(220,220,232,0.10);
  --color-border: rgba(255,255,255,0.10);
  --color-hairline: rgba(255,255,255,0.08);
  --shadow-md: 0 8px 24px rgba(0,0,0,0.45);
}
.glass, .record, .sheet, .settings-group { backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); }
.sheet { background: rgba(24,24,30,0.96); }
.switch { background: rgba(255,255,255,0.16); }
.sheet-grabber { background: rgba(255,255,255,0.22); }
.cal-cell .day-pct.pct-low { color: #6E6E78; }
.cal-cell .day-pct.pct-high { color: #D6D6DE; }

【七、完整示例 B · 纸感奶油】
:root {
  --color-bg: #F6F1E7;
  --color-surface: #FFFDF8;
  --color-surface-2: #F1EADC;
  --color-surface-3: #EAE1CF;
  --color-text-1: #3E3527;
  --color-text-2: #7A6F5D;
  --color-text-3: #B3A78F;
  --color-accent-strong: #8C6F3F;
  --color-accent-soft: rgba(140,111,63,0.10);
  --color-border: rgba(140,111,63,0.18);
  --radius-lg: 20px;
  --radius-xl: 26px;
  --star: #C79A3B;
}
.cal-cell { border-radius: 10px; }

【八、验收清单】
三个标签页 × 设置弹窗 × 新增/编辑观测弹窗 × 有无背景图，逐一看：文字对比度、按钮可读、弹窗不被裁切。有问题回到对应变量或类名微调。`;

// ---------- 背景图 ----------
let _bgResolvedUrl = '';   // 已解析为可加载地址的背景图缓存
async function applyBackgroundImage() {
  const ref = state.settings.bgImage || '';
  let el = document.getElementById('bg-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bg-layer';
    el.style.cssText = 'position:fixed; inset:0; z-index:0; pointer-events:none; background-size:cover; background-position:center;';
    document.body.insertBefore(el, document.body.firstChild);
  }
  if (!ref) { _bgResolvedUrl = ''; el.style.backgroundImage = 'none'; document.body.classList.remove('has-bg'); return; }
  // 相册图存的是 media-store 引用，需换回 dataURL 才能当背景
  if (ref.startsWith('media-store://')) {
    try {
      const got = await API.media.get({ ref });
      _bgResolvedUrl = got.dataUrl || '';
    } catch (e) { _bgResolvedUrl = ''; console.warn('bg resolve:', e); }
  } else {
    _bgResolvedUrl = ref;
  }
  const ok = !!_bgResolvedUrl;
  el.style.backgroundImage = ok ? `url("${_bgResolvedUrl.replace(/"/g, '')}")` : 'none';
  document.body.classList.toggle('has-bg', ok);
}

async function pickBackgroundImage() {
  try {
    const picked = await API.media.pick({ accept: 'image/*' });
    if (!picked || !picked.file || !picked.file.dataUrl) { await toast('未选择图片'); return; }
    try {
      const stored = await API.media.put({ dataUrl: picked.file.dataUrl });
      state.settings.bgImage = stored.ref;
    } catch (e) {
      // media.put 失败时用原始 dataUrl 兜底（临时生效，不持久）
      state.settings.bgImage = picked.file.dataUrl;
    }
    await saveSettings();
    await applyBackgroundImage();
    renderSettings();
    await toast('背景图已应用');
  } catch (err) {
    await toast('选择图片失败：' + (err.message || err));
  }
}

async function applyBgUrl() {
  const v = ($('#bgUrlInput') ? $('#bgUrlInput').value : '').trim();
  if (!v) { await toast('请输入背景图链接'); return; }
  state.settings.bgImage = v;
  await saveSettings();
  await applyBackgroundImage();
  renderSettings();
  await toast('背景图已应用');
}

async function clearBackgroundImage() {
  state.settings.bgImage = '';
  if ($('#bgUrlInput')) $('#bgUrlInput').value = '';
  await saveSettings();
  await applyBackgroundImage();
  await toast('背景图已清除');
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

  // 不再被动写入角色短期记忆：角色未调用工具时看不到任何记录，
  // 数据只在角色主动调用「查询创造记录」工具时返回
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
    cell.className = 'cal-cell'
      + (dateStr === todayStr ? ' is-today' : '')
      + (state.selectedCalDate === dateStr ? ' is-selected' : '');

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

    // 手动能量百分比：0-49%浅灰，50-100%深灰，显示在日期和箭头之间
    const pct = state.energyPct[dateStr];
    const pctEl = document.createElement('div');
    pctEl.className = 'day-pct';
    if (pct != null) {
      pctEl.textContent = pct + '%';
      pctEl.classList.add(pct <= 49 ? 'pct-low' : 'pct-high');
    }

    cell.appendChild(dayNum);
    cell.appendChild(star);
    cell.appendChild(pctEl);
    cell.appendChild(trail);
    cell.appendChild(tags);

    cell.addEventListener('click', () => {
      state.selectedDate = parseLocalDate(dateStr);
      state.selectedCalDate = dateStr;
      renderCalendar();      // 重新渲染以高亮选中格（如需）
      renderCalFoot();       // 底部预览
    });

    grid.appendChild(cell);
  }
}

// ============================================================================
// 月历底部：选中日的观测预览 + 能量百分比 + 追溯创造事件
// ============================================================================

function renderCalFoot() {
  const foot = $('#calFoot');
  if (!foot) return;
  const dateStr = state.selectedCalDate;
  if (!dateStr) { foot.style.display = 'none'; return; }

  foot.style.display = 'block';
  const recs = state.records[dateStr] || [];
  const pct = state.energyPct[dateStr];
  // 追溯创造：记录上带 createdDate 的观测（本日发现它们源自更早某天）
  const tracedRecs = recs.filter(r => r.createdDate);

  const mm = parseInt(dateStr.slice(5, 7), 10), dd = parseInt(dateStr.slice(8, 10), 10);
  let html = `<div class="cal-foot-title">
    <span>${mm}月${dd}日</span>
    <button class="cal-foot-editpct" id="footEditPct" aria-label="编辑创造能量">✨</button>
  </div>`;

  if (recs.length === 0) {
    html += `<div class="cal-foot-empty">这一天没有观测记录</div>`;
  } else {
    const sorted = recs.slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    sorted.forEach(r => {
      const meta = STATUS_META[r.status] || { sym: r.status, label: r.status };
      const tags = (r.tags || []).map(t => `<span class="tg">${escapeHtml(t)}</span>`).join('');
      const note = r.note ? `<span class="cal-foot-note" title="${escapeHtml(r.note)}">${escapeHtml(r.note)}</span>` : '';
      html += `<div class="cal-foot-rec">
        <span class="sym st-${r.status}">${meta.sym}</span>
        <span class="tags">${tags || '<span style="color:var(--text-3);">无标签</span>'}</span>
        ${note}
        ${r.highlight ? '<span style="color:var(--star);">★</span>' : ''}
      </div>`;
    });
  }

  // 追溯的创造事件（本日观测标记为源自更早某天）
  if (tracedRecs.length > 0) {
    tracedRecs.forEach(r => {
      html += `<div class="cal-foot-creation">
        <span>💡</span>
        <span>${escapeHtml((r.tags || []).join('、') || '观测')}</span>
        ${r.createdDate ? `<span class="jump" data-jump="${r.createdDate}">源自 ${r.createdDate}</span>` : ''}
      </div>`;
    });
  }

  // 🦋 反向：这一天是其他观测的「创造日」（双向链接的另一端）
  const butterflyRecs = [];
  Object.entries(state.records).forEach(([d, arr]) => {
    arr.forEach(r => { if (r.createdDate === dateStr) butterflyRecs.push(Object.assign({ date: d }, r)); });
  });
  if (butterflyRecs.length > 0) {
    butterflyRecs.forEach(r => {
      html += `<div class="cal-foot-creation">
        <span>🦋</span>
        <span>${escapeHtml((r.tags || []).join('、') || '观测')}</span>
        <span class="jump" data-jump="${r.date}">创造 ${r.date}</span>
      </div>`;
    });
  }

  foot.innerHTML = html;

  // 点击预览板块 → 进入当天详情
  foot.addEventListener('click', (e) => {
    if (e.target.closest('#footEditPct')) return;
    if (e.target.closest('[data-jump]')) return;
    state.selectedDate = parseLocalDate(dateStr);
    switchTab('today');
    renderToday();
  });

  // ✨ 输入能量百分比（内联 Bottom Sheet，避免沙箱 prompt 被拦截）
  $('#footEditPct').addEventListener('click', async (e) => {
    e.stopPropagation();
    const result = await openPctSheet(pct != null ? pct : '');
    if (result === null) return; // 取消
    if (result === '') {
      delete state.energyPct[dateStr];
      await removeEnergyPct(dateStr);
    } else {
      const n = Math.max(0, Math.min(100, parseInt(result, 10) || 0));
      state.energyPct[dateStr] = n;
      await saveEnergyPct(dateStr, n);
    }
    renderCalendar();
    renderCalFoot();
    await toast('能量已更新');
  });

  // 追溯日期跳转（跳到创造日）
  foot.querySelectorAll('[data-jump]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      state.selectedDate = parseLocalDate(el.dataset.jump);
      state.selectedCalDate = el.dataset.jump;
      renderCalendar();
      renderCalFoot();
    });
  });
}

// 能量百分比输入 Bottom Sheet；resolve(null)=取消，resolve('')=清除，否则为字符串
function openPctSheet(current) {
  return new Promise((resolve) => {
    let mask = document.getElementById('pctSheet');
    if (mask) mask.remove();
    mask = document.createElement('div');
    mask.className = 'sheet-mask open';
    mask.id = 'pctSheet';
    mask.innerHTML = `
      <div class="sheet">
        <div class="sheet-grabber"></div>
        <div class="sheet-title">创造能量百分比</div>
        <div class="field">
          <div class="field-label">输入 0-100 的数值（留空清除）</div>
          <input type="number" id="pctInput" min="0" max="100" value="${current}" placeholder="如 60" style="width:100%; border:1px solid var(--color-border); border-radius:12px; background:var(--color-surface); padding:12px 14px; font-size:16px; outline:none;">
        </div>
        <div style="display:flex; gap:10px; margin-top:8px;">
          <button class="btn btn-ghost" id="pctCancel" style="flex:1;">取消</button>
          <button class="btn btn-primary" id="pctSave" style="flex:1;">保存</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    mask.addEventListener('click', (e) => { if (e.target === mask) { mask.remove(); resolve(null); } });
    $('#pctCancel').addEventListener('click', () => { mask.remove(); resolve(null); });
    $('#pctSave').addEventListener('click', () => {
      const v = $('#pctInput').value.trim();
      mask.remove();
      resolve(v);
    });
    const inp = $('#pctInput');
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = inp.value.trim();
        mask.remove();
        resolve(v);
      }
    });
    setTimeout(() => inp.focus(), 100);
  });
}

async function saveEnergyPct(date, pct) {
  const list = await API.db.list('energy_pct', { limit: 5000 });
  const exist = list.find(p => p.date === date);
  if (exist) await API.db.update('energy_pct', exist.id, { date, pct });
  else await API.db.create('energy_pct', { date, pct });
}
async function removeEnergyPct(date) {
  const list = await API.db.list('energy_pct', { limit: 5000 });
  const exist = list.find(p => p.date === date);
  if (exist) await API.db.delete('energy_pct', exist.id);
}

// ============================================================================
// 页面渲染：当天（可查看任意日期，历史日期可编辑/新增）
// ============================================================================

function renderToday() {
  const dateStr = formatDate(state.selectedDate);
  const todayStr = getTodayStr();

  const m = state.selectedDate.getMonth() + 1, d = state.selectedDate.getDate();
  $('#todayDate').textContent = `${m}月${d}日`;
  const sub = $('#todayCount');
  const recs = state.records[dateStr] || [];
  sub.textContent = dateStr === todayStr ? '今天' : (recs.length ? `${recs.length} 条观测` : '无记录');

  const container = $('#todayRecords');
  container.innerHTML = '';

  if (recs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `<div class="icon">🪐</div>这一天没有观测记录`;
    container.appendChild(empty);
  } else {
    const sorted = recs.slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    sorted.forEach(rec => {
      const meta = STATUS_META[rec.status] || { sym: rec.status, label: rec.status };
      const card = document.createElement('div');
      card.className = 'record' + (rec.highlight ? ' starred' : '');

      card.innerHTML = `
        <div class="record-top">
          <span class="record-status st-${rec.status}">${meta.sym} <span style="font-size:13px; font-weight:500; color:var(--text-2);">${meta.label}</span>${rec.highlight ? '<span class="record-star">★</span>' : ''}</span>
          <div class="record-meta">
            <button class="btn btn-ghost btn-sm edit-rec" data-id="${rec.id}">编辑</button>
          </div>
        </div>
        ${rec.tags && rec.tags.length ? `<div class="record-tags">${rec.tags.map(t => `<span class="record-tag">${t}</span>`).join('')}</div>` : ''}
        ${rec.note ? `<div class="record-note">${escapeHtml(rec.note)}</div>` : ''}
        ${rec.createdDate ? `<div class="record-note" style="background:transparent; border:1px dashed var(--color-border); color:var(--text-2); font-size:12.5px;">💡 追溯创造 · 源自 <span class="jump" data-jump="${rec.createdDate}" style="color:var(--color-accent-strong); font-weight:600; cursor:pointer;">${rec.createdDate}</span></div>` : ''}
      `;
      container.appendChild(card);
    });

    // 编辑按钮
    container.querySelectorAll('.edit-rec').forEach(btn => {
      btn.addEventListener('click', () => openRecordSheet(btn.dataset.id));
    });
  }

  // 这一天是其他观测的「创造日」→ 显示🦋已创造（双向链接反向）
  const butterflyRecs = [];
  Object.entries(state.records).forEach(([d, arr]) => {
    arr.forEach(r => {
      if (r.createdDate === dateStr) butterflyRecs.push(Object.assign({ date: d }, r));
    });
  });
  if (butterflyRecs.length > 0) {
    const bfWrap = document.createElement('div');
    bfWrap.style.cssText = 'margin: 4px 8px 0;';
    bfWrap.innerHTML = `<div style="font-size:12px; color:var(--text-3); padding:4px 4px 6px;">这一天创造的事</div>`;
    butterflyRecs.forEach(r => {
      const row = document.createElement('div');
      row.className = 'record';
      row.style.cssText = 'padding:10px 14px; margin:0 0 8px; display:flex; align-items:center; gap:10px;';
      row.innerHTML = `<span>🦋</span>
        <span style="flex:1; font-size:13.5px;">${escapeHtml((r.tags || []).join('、') || '观测')}</span>
        <button class="btn btn-ghost btn-sm" data-jump="${r.date}" style="padding:4px 10px; font-size:12px;">→ ${r.date}</button>`;
      bfWrap.appendChild(row);
    });
    container.appendChild(bfWrap);
  }

  // 追溯日期跳转（源日期 / 创造日双向）
  container.querySelectorAll('[data-jump]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedDate = parseLocalDate(el.dataset.jump);
      renderToday();
    });
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
  state.isCreation = false;
  state.selectedCreationDate = '';

  $('#recordSheetTitle').textContent = recordId ? '编辑观测' : '新增观测';
  $('#recordNote').value = '';
  $('#isHighlight').classList.remove('on');
  $('#isCreation').classList.remove('on');
  $('#creationDateField').style.display = 'none';
  $('#recordCreationDate').value = '';
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
      if (found.createdDate) {
        state.isCreation = true;
        state.selectedCreationDate = found.createdDate;
        $('#isCreation').classList.add('on');
        $('#creationDateField').style.display = 'block';
        $('#recordCreationDate').value = found.createdDate;
      }
      $$('#statusPicker button').forEach(b => {
        if (b.dataset.status === found.status) b.classList.add('sel');
      });
    }
  }

  try {
    renderTagPicker();
  } catch (err) {
    console.warn('renderTagPicker:', err);
    // 标签分组异常不影响打开面板
    $('#tagPicker').innerHTML = '<span style="font-size:13px;color:var(--text-3);">标签加载失败</span>';
  }
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
  ensureDefaultGroup();
  const groupNames = Object.keys(state.groups);
  groupNames.forEach(gname => {
    if (gname === DEFAULT_GROUP && state.groups[gname].length === 0) return;
    const gtags = state.groups[gname] || [];
    if (gtags.length === 0) return;

    const block = document.createElement('div');
    block.className = 'tag-group-pick';
    block.style.cssText = 'margin-bottom:6px;';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex; align-items:center; gap:6px; cursor:pointer; padding:4px 0; user-select:none;';
    head.innerHTML = `<span style="font-size:13px; font-weight:600; color:var(--text-2); flex:1;">${escapeHtml(gname)}</span>
      <span style="font-size:11px; color:var(--text-3);" class="grp-cnt"></span>
      <span style="font-size:11px; color:var(--text-3);">▾</span>`;
    block.appendChild(head);

    const body = document.createElement('div');
    body.className = 'tag-picker-body';
    body.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px; padding-top:4px;';
    gtags.forEach(tag => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-pick' + (state.selectedTags.has(tag) ? ' sel' : '');
      btn.textContent = tag;
      btn.addEventListener('click', () => {
        if (state.selectedTags.has(tag)) { state.selectedTags.delete(tag); btn.classList.remove('sel'); }
        else { state.selectedTags.add(tag); btn.classList.add('sel'); }
        updateGroupCnt(head, gtags, state.selectedTags);
      });
      body.appendChild(btn);
    });
    block.appendChild(body);

    // 分组名点击展开/收起
    head.addEventListener('click', () => {
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'flex';
      head.querySelector('span:last-child').textContent = isOpen ? '▸' : '▾';
    });
    updateGroupCnt(head, gtags, state.selectedTags);
    wrap.appendChild(block);
  });
}

function updateGroupCnt(head, gtags, selectedTags) {
  const cnt = gtags.filter(t => selectedTags.has(t)).length;
  head.querySelector('.grp-cnt').textContent = cnt ? `已选 ${cnt}` : '';
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
    // 追溯创造日期（双向链接）
    if (state.isCreation && $('#recordCreationDate').value) {
      record.createdDate = $('#recordCreationDate').value;
    } else {
      delete record.createdDate;
    }
  } else {
    record = {
      date: dateStr,
      status: state.selectedStatus,
      tags: Array.from(state.selectedTags),
      note: $('#recordNote').value.trim(),
      highlight: $('#isHighlight').classList.contains('on'),
      createdAt: new Date().toISOString()
    };
    // 追溯创造日期
    if (state.isCreation && $('#recordCreationDate').value) {
      record.createdDate = $('#recordCreationDate').value;
    }
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

// ---------- 标签分组管理 ----------

const DEFAULT_GROUP = '默认分组';

async function saveGroups() {
  const list = await API.db.list('groups', { limit: 500 });
  const seen = new Set();
  for (const [name, tags] of Object.entries(state.groups)) {
    const exist = list.find(g => g.name === name);
    if (exist) await API.db.update('groups', exist.id, { name, tags });
    else await API.db.create('groups', { name, tags });
    seen.add(name);
  }
  for (const g of list) {
    if (!seen.has(g.name)) await API.db.delete('groups', g.id);
  }
}

function groupOfTag(tag) {
  for (const [g, tags] of Object.entries(state.groups)) {
    if (tags.includes(tag)) return g;
  }
  return DEFAULT_GROUP;
}

function ensureDefaultGroup() {
  if (!state.groups[DEFAULT_GROUP]) state.groups[DEFAULT_GROUP] = [];
  // 所有已被其他分组拥有的标签
  const grouped = new Set();
  Object.entries(state.groups).forEach(([g, tags]) => {
    if (g === DEFAULT_GROUP) return;
    (tags || []).forEach(t => grouped.add(t));
  });
  // 未分组标签（不属于任何非默认组）归入默认分组
  state.tags.forEach(t => {
    if (!grouped.has(t) && !state.groups[DEFAULT_GROUP].includes(t)) {
      state.groups[DEFAULT_GROUP].push(t);
    }
  });
  // 默认分组里若已有标签被移到其他组，则移出默认分组
  state.groups[DEFAULT_GROUP] = state.groups[DEFAULT_GROUP].filter(t => state.tags.includes(t) && !grouped.has(t));
  // 清理已删除的标签，避免脏数据
  Object.keys(state.groups).forEach(g => {
    state.groups[g] = (state.groups[g] || []).filter(t => state.tags.includes(t));
  });
  // 默认分组为空则隐藏（渲染时跳过）
}

async function moveTagToGroup(tag, newGroup) {
  // 从原组移除
  for (const [g, tags] of Object.entries(state.groups)) {
    state.groups[g] = tags.filter(t => t !== tag);
  }
  if (!state.groups[newGroup]) state.groups[newGroup] = [];
  state.groups[newGroup].push(tag);
  await saveGroups();
}

function renderTagLibrary() {
  const wrap = $('#tagGroupLibrary');
  if (!wrap) return;
  wrap.innerHTML = '';
  ensureDefaultGroup();

  const groupNames = Object.keys(state.groups);

  // 添加分组按钮（不用 prompt，内联输入）
  const addGroupRow = document.createElement('div');
  addGroupRow.style.cssText = 'padding:12px 0 4px; display:flex; gap:8px;';
  addGroupRow.innerHTML = `
    <input type="text" id="newGroupInput" placeholder="新分组名称" style="flex:1; border:1px solid var(--color-border); border-radius:8px; background:var(--color-surface); padding:9px 12px; font-size:13px; outline:none;">
    <button class="btn btn-soft btn-sm" id="addGroupBtn" style="flex-shrink:0;">新建分组</button>`;
  wrap.appendChild(addGroupRow);
  const ngi = $('#newGroupInput');
  if (ngi) {
    ngi.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const name = ngi.value.trim();
        if (!name) return;
        if (state.groups[name] !== undefined) { await toast('分组已存在'); return; }
        state.groups[name] = [];
        await saveGroups();
        renderTagLibrary();
        await toast('已新建分组');
      }
    });
  }

  // 分组整体可上下拖动排序
  wrap.addEventListener('dragover', (e) => e.preventDefault());
  wrap.addEventListener('drop', (e) => {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (!data.gname) return;
      const names = Object.keys(state.groups);
      const from = names.indexOf(data.gname);
      if (from < 0) return;
      names.splice(from, 1);
      names.push(data.gname); // 简单：拖到末尾
      const reordered = {};
      names.forEach(n => { reordered[n] = state.groups[n]; });
      state.groups = reordered;
      saveGroups().then(() => renderTagLibrary());
    } catch (err) {}
  });

  groupNames.forEach(gname => {
    // 默认分组为空则隐藏
    if (gname === DEFAULT_GROUP && state.groups[gname].length === 0) return;

    const groupBlock = document.createElement('div');
    groupBlock.className = 'tag-group-block';
    groupBlock.style.cssText = 'padding:6px 0 10px;';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px 0;';
    head.innerHTML = `
      <button class="btn btn-ghost btn-sm" data-act="gup" style="padding:2px 7px; font-size:12px;" title="分组上移">↑</button>
      <button class="btn btn-ghost btn-sm" data-act="gdown" style="padding:2px 7px; font-size:12px;" title="分组下移">↓</button>
      <span style="flex:1; font-weight:600; font-size:14px; color:var(--text-1);">${escapeHtml(gname)}</span>
      <button class="btn btn-ghost btn-sm" data-act="rename" style="padding:4px 10px; font-size:12px;">重命名</button>
      ${gname !== DEFAULT_GROUP ? `<button class="btn btn-ghost btn-sm" data-act="delgroup" style="padding:4px 10px; font-size:12px; color:var(--color-danger);">删除</button>` : ''}
    `;
    groupBlock.appendChild(head);

    // 分组上移/下移（替代拖拽）
    const gUp = head.querySelector('[data-act="gup"]');
    gUp.addEventListener('click', async () => {
      const names = Object.keys(state.groups);
      const idx = names.indexOf(gname);
      if (idx <= 0) return;
      const reordered = {};
      names.forEach((n, i) => {
        if (i === idx - 1) reordered[gname] = state.groups[gname];
        else if (i === idx) reordered[names[i - 1]] = state.groups[names[i - 1]];
        else reordered[n] = state.groups[n];
      });
      state.groups = reordered;
      await saveGroups();
      renderTagLibrary();
    });
    const gDown = head.querySelector('[data-act="gdown"]');
    gDown.addEventListener('click', async () => {
      const names = Object.keys(state.groups);
      const idx = names.indexOf(gname);
      if (idx < 0 || idx >= names.length - 1) return;
      const reordered = {};
      names.forEach((n, i) => {
        if (i === idx) reordered[names[i + 1]] = state.groups[names[i + 1]];
        else if (i === idx + 1) reordered[gname] = state.groups[gname];
        else reordered[n] = state.groups[n];
      });
      state.groups = reordered;
      await saveGroups();
      renderTagLibrary();
    });

    const tagList = document.createElement('div');
    tagList.className = 'tag-group-items';
    tagList.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
    const tags = state.groups[gname].slice();

    if (tags.length === 0) {
      tagList.innerHTML = `<div style="font-size:12px; color:var(--text-3); padding:4px 0;">（空）</div>`;
    } else {
      tags.forEach(tag => {
        const row = document.createElement('div');
        row.className = 'tag-group-item';
        row.style.cssText = 'display:flex; align-items:center; gap:8px; background:var(--color-surface-2); border-radius:8px; padding:6px 10px;';
        row.innerHTML = `
          <button class="btn btn-ghost btn-sm" data-act="up" style="padding:2px 7px; font-size:12px;" title="上移">↑</button>
          <button class="btn btn-ghost btn-sm" data-act="down" style="padding:2px 7px; font-size:12px;" title="下移">↓</button>
          <span style="flex:1; font-size:13.5px;" class="tag-name">${escapeHtml(tag)}</span>
          <button class="btn btn-ghost btn-sm" data-act="del" style="padding:3px 8px; font-size:11px; color:var(--color-danger);">删</button>
          <button class="btn btn-ghost btn-sm" data-act="rename" style="padding:3px 8px; font-size:11px;">名</button>
        `;
        // 上移 / 下移（替代拖拽）
        const moveUp = row.querySelector('[data-act="up"]');
        moveUp.addEventListener('click', async () => {
          const items = state.groups[gname];
          const idx = items.indexOf(tag);
          if (idx <= 0) return;
          items.splice(idx, 1);
          items.splice(idx - 1, 0, tag);
          await saveGroups();
          renderTagLibrary();
        });
        const moveDown = row.querySelector('[data-act="down"]');
        moveDown.addEventListener('click', async () => {
          const items = state.groups[gname];
          const idx = items.indexOf(tag);
          if (idx < 0 || idx >= items.length - 1) return;
          items.splice(idx, 1);
          items.splice(idx + 1, 0, tag);
          await saveGroups();
          renderTagLibrary();
        });
        // 移到其他组
        const move = document.createElement('select');
        move.style.cssText = 'font-size:11px; border:1px solid var(--color-border); border-radius:6px; background:var(--color-surface); padding:2px 4px;';
        move.innerHTML = `<option value="">移到</option>` + groupNames.filter(g => g !== gname).map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
        move.addEventListener('change', async () => {
          if (move.value) {
            await moveTagToGroup(tag, move.value);
            renderTagLibrary();
            await toast('已移动');
          }
        });
        row.appendChild(move);

        row.querySelector('[data-act="del"]').addEventListener('click', async () => {
          await removeTag(tag);
          ensureDefaultGroup();
          renderTagLibrary();
          renderTagPicker();
          renderTagStats();
          await toast('已删除标签');
        });

        // 标签重命名（内联输入，改完后同步所有引用）
        row.querySelector('[data-act="rename"]').addEventListener('click', async () => {
          const nameSpan = row.querySelector('.tag-name');
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.value = tag;
          inp.style.cssText = 'flex:1; font-size:13.5px; border:1px solid var(--color-border); border-radius:8px; padding:4px 8px; background:var(--color-surface); outline:none; color:var(--text-1); min-width:0;';
          nameSpan.replaceWith(inp);
          const btn = row.querySelector('[data-act="rename"]');
          btn.textContent = '存';
          inp.focus();
          const finish = async (doSave) => {
            if (!doSave) { renderTagLibrary(); return; }
            const newName = inp.value.trim();
            if (!newName || newName === tag) { renderTagLibrary(); return; }
            if (state.tags.includes(newName)) { await toast('标签已存在'); renderTagLibrary(); return; }
            // 重命名 tags 表
            const tagsList = await API.db.list('tags', { limit: 1000 });
            const titem = tagsList.find(t => t.name === tag);
            if (titem) await API.db.update('tags', titem.id, { name: newName });
            state.tags[state.tags.indexOf(tag)] = newName;
            state.tags.sort((a, b) => a.localeCompare(b, 'zh'));
            // 重命名分组里的引用
            Object.keys(state.groups).forEach(g => {
              const gi = state.groups[g].indexOf(tag);
              if (gi >= 0) state.groups[g][gi] = newName;
            });
            await saveGroups();
            // 重命名所有记录里的引用
            const recList = await API.db.list('records', { limit: 10000 });
            for (const rec of recList) {
              if (rec.tags && rec.tags.includes(tag)) {
                rec.tags = rec.tags.map(t => t === tag ? newName : t);
                await API.db.update('records', rec.id, rec);
              }
            }
            await reloadRecords();
            ensureDefaultGroup();
            renderTagLibrary();
            renderTagPicker();
            renderTagStats();
            renderCalendar();
            await toast('已重命名');
          };
          btn.onclick = () => finish(true);
          inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
        });

        tagList.appendChild(row);
      });
    }

    groupBlock.appendChild(tagList);
    wrap.appendChild(groupBlock);

    // 分组操作：重命名（内联输入，避免 prompt 在沙箱不生效）
    const renameBtn = head.querySelector('[data-act="rename"]');
    if (renameBtn) renameBtn.addEventListener('click', () => {
      const oldName = gname;
      const headEl = head;
      // 把标题换成输入框
      const nameSpan = headEl.querySelector('span:nth-child(3)');
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = oldName;
      inp.style.cssText = 'flex:1; font-size:14px; font-weight:600; border:1px solid var(--color-border); border-radius:8px; padding:4px 8px; background:var(--color-surface); outline:none; color:var(--text-1);';
      nameSpan.replaceWith(inp);
      renameBtn.textContent = '保存';
      renameBtn.dataset.mode = 'save';
      inp.focus();
      const finish = async (doSave) => {
        if (!doSave) { renderTagLibrary(); return; }
        const name = inp.value.trim();
        if (!name || name === oldName) { renderTagLibrary(); return; }
        if (state.groups[name] !== undefined) { await toast('分组已存在'); renderTagLibrary(); return; }
        state.groups[name] = state.groups[oldName];
        delete state.groups[oldName];
        await saveGroups();
        renderTagLibrary();
        await toast('已重命名');
      };
      renameBtn.onclick = () => finish(true);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    });
    const delBtn = head.querySelector('[data-act="delgroup"]');
    if (delBtn) delBtn.addEventListener('click', async () => {
      const ok = await API.ui.confirm({ title: '删除分组？', message: '组内标签将移回默认分组' });
      if (!ok) return;
      const moved = state.groups[gname] || [];
      if (!state.groups[DEFAULT_GROUP]) state.groups[DEFAULT_GROUP] = [];
      state.groups[DEFAULT_GROUP] = state.groups[DEFAULT_GROUP].concat(moved);
      delete state.groups[gname];
      await saveGroups();
      renderTagLibrary();
      await toast('已删除分组');
    });
  });

  // 添加分组
  const addBtn = $('#addGroupBtn');
  if (addBtn) addBtn.addEventListener('click', async () => {
    const name = $('#newGroupInput').value.trim();
    if (!name) return;
    if (state.groups[name] !== undefined) { await toast('分组已存在'); return; }
    state.groups[name] = [];
    await saveGroups();
    renderTagLibrary();
    await toast('已新建分组');
  });
}

function renderSettings() {
  $('#reminderEnabled').classList.toggle('on', !!state.settings.reminderEnabled);
  $('#reminderTime').value = state.settings.reminderTime || '21:00';
  $('#customCSS').value = state.settings.customCSS || '';
  const bgInput = $('#bgUrlInput');
  if (bgInput) bgInput.value = (state.settings.bgImage && !state.settings.bgImage.startsWith('media-store://')) ? state.settings.bgImage : '';
  renderTagLibrary();
}

// ============================================================================
// 提醒
// ============================================================================

// 关闭提醒时彻底清理：撤销所有遗留的定时任务 + 清掉已发出的通知与桌面红点
async function cancelPendingReminders(reason) {
  const ids = ['reminder_daily']; // 已知固定 id（旧版本遗留）
  try {
    const tasks = await API.tasks.list();
    if (Array.isArray(tasks)) {
      tasks.forEach(t => { if (t && t.id && String(t.id).startsWith('reminder_daily')) ids.push(t.id); });
    }
  } catch (e) { /* 宿主不支持列出任务时，只按已知 id 清理 */ }
  for (const id of [...new Set(ids)]) {
    try { await API.tasks.cancel(id); } catch (e) {}
  }
  try { await API.notifications.markAllRead(); } catch (e) {}
  try { await API.notifications.clearBadge(); } catch (e) {}
  console.log('[ORBIT] 提醒已关闭，已清理遗留定时任务/通知/红点', reason || '');
}

async function scheduleReminder() {
  if (!state.settings.reminderEnabled) {
    await cancelPendingReminders('reminderEnabled=false');
    return;
  }

  const [h, m] = (state.settings.reminderTime || '21:00').split(':').map(Number);
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
  if (target <= now) target.setDate(target.getDate() + 1);

  try {
    // 用唯一 id 覆盖旧任务；只发通知，不产生桌面红点
    await API.tasks.schedule({
      id: 'reminder_daily',
      delayMs: target.getTime() - now.getTime(),
      actions: [
        {
          type: 'notification',
          title: '创造观测',
          body: '回看今天：有什么值得观测的能量变化吗？'
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
            body: '回看今天：有什么值得观测的能量变化吗？'
          }
        ]
      });
    } catch (e2) {
      console.warn('scheduleReminder retry:', e2);
    }
  }
  // 开启提醒时也清一次遗留红点，保证角标干净
  try {
    await API.notifications.clearBadge();
  } catch (e) {}
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
    const includeNote = args.includeNote !== false; // 默认带备注
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
  const data = { records: state.records, tags: state.tags, settings: state.settings, groups: state.groups, energyPct: state.energyPct };
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

async function clearAllData() {
  // 要求输入「删除」确认
  const ok = await openConfirmSheet('确认清除所有数据？', '输入「删除」以确认，此操作不可恢复。', '删除');
  if (!ok) return;
  try {
    // 清空所有数据集合
    const cols = ['records', 'tags', 'groups', 'energy_pct', 'daily_summaries', 'pattern_suggestions', 'settings'];
    for (const col of cols) {
      try {
        const list = await API.db.list(col, { limit: 100000 });
        for (const it of list) {
          try { await API.db.delete(col, it.id); } catch (e) {}
        }
      } catch (e) {}
    }
    // 重置内存状态
    state.records = {};
    state.tags = [];
    state.groups = {};
    state.energyPct = {};
    state.settings = { reminderEnabled: true, reminderTime: '21:00', customCSS: '', bgImage: '' };
    state.selectedCalDate = null;
    await saveSettings();
    renderAll();
    await toast('已清除所有数据');
  } catch (err) {
    await toast('清除失败：' + err.message);
  }
}

// 确认输入 Sheet：要求用户输入指定文字才能确认
function openConfirmSheet(title, message, requiredText) {
  return new Promise((resolve) => {
    let mask = document.getElementById('confirmSheet');
    if (mask) mask.remove();
    mask = document.createElement('div');
    mask.className = 'sheet-mask open';
    mask.id = 'confirmSheet';
    mask.innerHTML = `
      <div class="sheet">
        <div class="sheet-grabber"></div>
        <div class="sheet-title">${escapeHtml(title)}</div>
        <div style="font-size:13px; color:var(--text-2); padding:4px 0 12px; line-height:1.6;">${escapeHtml(message)}</div>
        <div class="field">
          <input type="text" id="confirmInput" placeholder="请输入「${escapeHtml(requiredText)}」" style="width:100%; border:1px solid var(--color-border); border-radius:12px; background:var(--color-surface); padding:12px 14px; font-size:15px; outline:none;">
        </div>
        <div style="display:flex; gap:10px;">
          <button class="btn btn-ghost" id="confirmCancel" style="flex:1;">取消</button>
          <button class="btn btn-danger" id="confirmOk" style="flex:1;" disabled>确认清除</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    mask.addEventListener('click', (e) => { if (e.target === mask) { mask.remove(); resolve(false); } });
    $('#confirmCancel').addEventListener('click', () => { mask.remove(); resolve(false); });
    const input = $('#confirmInput');
    const okBtn = $('#confirmOk');
    input.addEventListener('input', () => {
      okBtn.disabled = input.value.trim() !== requiredText;
    });
    okBtn.addEventListener('click', () => {
      if (input.value.trim() !== requiredText) return;
      mask.remove();
      resolve(true);
    });
    setTimeout(() => input.focus(), 100);
  });
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
      if (data.groups) {
        for (const [gname, gtags] of Object.entries(data.groups)) {
          try { await API.db.create('groups', { name: gname, tags: gtags }); } catch (err) {}
        }
      }
      if (data.energyPct) {
        for (const [date, pct] of Object.entries(data.energyPct)) {
          try { await API.db.create('energy_pct', { date, pct }); } catch (err) {}
        }
      }
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
  if (state.selectedCalDate) renderCalFoot();
  else {
    state.selectedCalDate = getTodayStr();
    renderCalFoot();
  }
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

  // 💡 追溯创造开关
  $('#isCreation').addEventListener('click', () => {
    state.isCreation = !state.isCreation;
    $('#isCreation').classList.toggle('on', state.isCreation);
    $('#creationDateField').style.display = state.isCreation ? 'block' : 'none';
    if (!state.isCreation) $('#recordCreationDate').value = '';
  });

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

  // 背景图
  $('#pickBgBtn').addEventListener('click', pickBackgroundImage);
  $('#applyBgBtn').addEventListener('click', applyBgUrl);
  $('#clearBgBtn').addEventListener('click', clearBackgroundImage);

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
    if (state.settings.reminderEnabled) {
      await scheduleReminder();
      await toast('提醒时间已更新');
    }
  });
  // 「AI 制作指南」：把全局美化 CSS 指南整段填入输入框，复制发给任意 AI 即可生成全局主题
  $('#cssGuideBtn').addEventListener('click', async () => {
    const cur = $('#customCSS').value.trim();
    if (cur) {
      const overwrite = await API.ui.confirm({
        title: '填入 AI 制作指南？',
        message: '输入框里已有内容，填入指南会覆盖它；需要请先复制留底。'
      });
      if (!overwrite) return;
    }
    $('#customCSS').value = CSS_GUIDE;
    await toast('指南已填入，全选复制发给 AI 即可');
  });

  $('#applyCSSBtn').addEventListener('click', async () => {
    state.settings.customCSS = $('#customCSS').value;
    applyCustomCSS(state.settings.customCSS);
    await saveSettings();
    await toast('样式已应用');
  });
  $('#exportDataBtn').addEventListener('click', exportData);
  $('#importDataBtn').addEventListener('click', importData);
  $('#clearAllDataBtn').addEventListener('click', clearAllData);
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
  // 仅在用户开启提醒时调度；关闭状态下启动即清理遗留任务/通知/红点
  if (state.settings.reminderEnabled) {
    scheduleReminder();
  } else {
    cancelPendingReminders('init: reminderEnabled=false');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

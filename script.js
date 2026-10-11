const STORAGE_KEY = 'night-callers-dashboard-v1';
const DATA_FILE_URL = './data.json';
// Firebase Realtime Database URL (e.g. 'https://your-project-default-rtdb.firebaseio.com/nightcallers').
// When set, all changes are shared live with everyone viewing the dashboard.
const SYNC_URL = 'https://night-callers-dashboard-default-rtdb.firebaseio.com/nightcallers';
const DEFAULT_GOALS = { pulls: 100, contacts: 30, attachments: 15, lender: 12 };
const DEFAULT_ORIGINATORS = [
  { id: 'paula', name: 'Paula', initials: 'PB', subtitle: '' },
  { id: 'peyton', name: 'Peyton', initials: 'PC', subtitle: '' },
  { id: 'henry', name: 'Henry (Goat)', initials: 'HF', subtitle: '' },
  { id: 'dakota', name: 'Dakota', initials: 'DA', subtitle: '' },
  { id: 'evan', name: 'Evan', initials: 'ET', subtitle: '' },
  { id: 'jared', name: 'Jared', initials: 'JM', subtitle: '' },
  { id: 'ian', name: 'Ian', initials: 'IE', subtitle: '' },
];
const GOAL_ORDER = [
  { metric: 'pulls', label: 'Leads Pulled', goalKey: 'pulls' },
  { metric: 'contacts', label: 'Contacts', goalKey: 'contacts' },
  { metric: 'agents', label: 'Attachments', goalKey: 'attachments' },
  { metric: 'lender', label: 'Sent to Lender', goalKey: 'lender' },
];

const ui = {
  headerSubtitle: document.getElementById('headerSubtitle'),
  dateInput: document.getElementById('dateInput'),
  topStats: document.getElementById('topStats'),
  goalsSummary: document.getElementById('goalsSummary'),
  lastUpdated: document.getElementById('lastUpdated'),
  goalsList: document.getElementById('goalsList'),
  rosterBody: document.getElementById('rosterBody'),
  teamRecordsBody: document.getElementById('teamRecordsBody'),
  logEffortOriginator: document.getElementById('logEffortOriginator'),
  originatorDialog: document.getElementById('originatorDialog'),
  originatorForm: document.getElementById('originatorForm'),
  goalsDialog: document.getElementById('goalsDialog'),
  goalsForm: document.getElementById('goalsForm'),
  logEffortDialog: document.getElementById('logEffortDialog'),
  logEffortForm: document.getElementById('logEffortForm'),
  teamRecordDialog: document.getElementById('teamRecordDialog'),
  teamRecordForm: document.getElementById('teamRecordForm'),
  showActiveToggle: document.getElementById('showActiveToggle'),
};

let state;
let editOriginatorId = null;
let editTeamRecordId = null;

function todayISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function emptyMetrics() {
  return { pulls: 0, contacts: 0, agents: 0, lender: 0 };
}

function clamp(value) {
  const number = Number(value);
  return Math.max(0, Number.isFinite(number) ? Math.floor(number) : 0);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeState(raw) {
  const originators = Array.isArray(raw?.originators) && raw.originators.length
    ? raw.originators
    : DEFAULT_ORIGINATORS;
  const goals = raw?.goals || {};
  return {
    currentDate: raw?.currentDate || todayISO(),
    lastUpdated: raw?.lastUpdated || new Date().toISOString(),
    goals: {
      pulls: clamp(goals.pulls ?? DEFAULT_GOALS.pulls),
      contacts: clamp(goals.contacts ?? DEFAULT_GOALS.contacts),
      attachments: clamp(goals.attachments ?? DEFAULT_GOALS.attachments),
      lender: clamp(goals.lender ?? DEFAULT_GOALS.lender),
    },
    originators: originators.map((person, index) => ({
      id: String(person.id || `originator-${index}`),
      name: String(person.name || 'Originator'),
      initials: String(person.initials || '--'),
      subtitle: String(person.subtitle || ''),
    })),
    metricsByDate: raw?.metricsByDate && typeof raw.metricsByDate === 'object' ? raw.metricsByDate : {},
    teamRecords: Array.isArray(raw?.teamRecords)
      ? raw.teamRecords.filter((record) => record && typeof record === 'object').map((record, index) => ({
        id: String(record.id || `record-${index}`),
        originatorName: String(record.originatorName || ''),
        recordBroke: String(record.recordBroke || ''),
        recordNumber: clamp(record.recordNumber),
      })).filter((record) => record.originatorName && record.recordBroke)
      : [],
  };
}

async function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeState(JSON.parse(saved));
  } catch {
    console.warn('Unable to read saved dashboard data.');
  }

  try {
    const response = await fetch(`${DATA_FILE_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (response.ok) return normalizeState(await response.json());
  } catch {
    console.warn('Dashboard seed data unavailable; using default data.');
  }
  return normalizeState({});
}

let lastSynced = '';

function syncPayload() {
  const { currentDate, ...shared } = state;
  return JSON.stringify(shared);
}

function touchState() {
  state.lastUpdated = new Date().toISOString();
}

function pushRemote() {
  if (!SYNC_URL) return;
  const body = syncPayload();
  if (body === lastSynced) return;
  lastSynced = body;
  fetch(`${SYNC_URL}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
    .catch(() => console.warn('Unable to sync dashboard data.'));
}

async function pullRemote() {
  try {
    const response = await fetch(`${SYNC_URL}.json`, { cache: 'no-store' });
    if (!response.ok) return null;
    const remote = await response.json();
    if (!remote || typeof remote !== 'object') return null;
    const next = normalizeState({ ...remote, currentDate: state?.currentDate });
    return next;
  } catch {
    return null;
  }
}

function startSync() {
  if (!SYNC_URL || typeof EventSource === 'undefined') return;
  const stream = new EventSource(`${SYNC_URL}.json`);
  const onChange = () => {
    pullRemote().then((next) => {
      if (!next) return;
      const incoming = JSON.stringify((({ currentDate, ...r }) => r)(next));
      if (incoming === lastSynced) return;
      lastSynced = incoming;
      state = next;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
      render();
    });
  };
  stream.addEventListener('put', onChange);
  stream.addEventListener('patch', onChange);
}

function saveState() {
  touchState();
  pushRemote();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    console.warn('Unable to save dashboard data in this browser.');
  }
}

function getDateMetrics(date = state.currentDate) {
  if (!state.metricsByDate[date] || typeof state.metricsByDate[date] !== 'object') {
    state.metricsByDate[date] = {};
  }
  return state.metricsByDate[date];
}

function calculate() {
  const metrics = getDateMetrics();
  const totals = { pulls: 0, contacts: 0, agents: 0, lender: 0 };
  let membersWithLeads = 0;
  for (const person of state.originators) {
    const personMetrics = metrics[person.id] || emptyMetrics();
    for (const key of Object.keys(totals)) totals[key] += clamp(personMetrics[key]);
    if (clamp(personMetrics.pulls) > 0) membersWithLeads += 1;
  }
  return {
    totals,
    values: {
      average: membersWithLeads ? totals.pulls / membersWithLeads : 0,
      contactRate: totals.pulls ? totals.contacts / totals.pulls * 100 : 0,
      attachmentRate: totals.contacts ? totals.agents / totals.contacts * 100 : 0,
      lenderRate: totals.contacts ? totals.lender / totals.contacts * 100 : 0,
    },
  };
}

function goalProgress(currentValue, goalValue) {
  const current = clamp(currentValue);
  const goal = clamp(goalValue);
  const percent = goal ? (current / goal) * 100 : current > 0 ? 100 : 0;
  const tone = percent >= 100 ? 'good' : percent >= 70 ? 'warn' : 'danger';
  return {
    current,
    goal,
    percent,
    width: Math.min(100, percent),
    tone,
    displayPercent: Math.round(percent),
    label: percent >= 100 ? 'On track' : percent >= 70 ? 'Close to goal' : 'Below goal',
  };
}

function formatDateTime(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return 'just now';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function comparisonGoal(metric) {
  switch (metric) {
    case 'contacts':
      return state.goals.pulls ? (state.goals.contacts / state.goals.pulls) * 100 : 0;
    case 'agents':
      return state.goals.contacts ? (state.goals.attachments / state.goals.contacts) * 100 : 0;
    case 'lender':
      return state.goals.contacts ? (state.goals.lender / state.goals.contacts) * 100 : 0;
    default:
      return 0;
  }
}

function render() {
  const { totals, values } = calculate();
  const date = new Date(`${state.currentDate}T12:00:00`);
  ui.headerSubtitle.textContent = `Individual Daily Stats for ${date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })}.`;
  ui.dateInput.value = state.currentDate;

  ui.goalsSummary.textContent = `Team Progress Today · ${GOAL_ORDER.map(({ metric, label, goalKey }) => {
    const current = totals[metric];
    const goal = state.goals[goalKey];
    const progress = goalProgress(current, goal);
    return `${label}: ${current}/${goal} (${progress.displayPercent}%)`;
  }).join(' · ')}`;
  ui.lastUpdated.textContent = `Last updated ${formatDateTime(state.lastUpdated)}`;

  const stats = [
    ['Average Leads Pulled', values.average.toFixed(1), `${state.originators.length} team members tracked`],
    ['Contact to Lead %', `${Math.round(values.contactRate)}%`, `vs goal ${Math.round(comparisonGoal('contacts'))}%`],
    ['Contact to Attachment %', `${Math.round(values.attachmentRate)}%`, `vs goal ${Math.round(comparisonGoal('agents'))}%`],
    ['Sent to Lender %', `${Math.round(values.lenderRate)}%`, `vs goal ${Math.round(comparisonGoal('lender'))}%`],
  ];
  ui.topStats.innerHTML = stats.map(([title, value, caption]) => `
    <article class="card stat-card">
      <p class="stat-title">${title}</p>
      <p class="stat-value">${value}</p>
      <p class="goal-text">${caption}</p>
    </article>`).join('');

  ui.goalsList.innerHTML = GOAL_ORDER.map(({ metric, label, goalKey }) => {
    const current = totals[metric];
    const goal = state.goals[goalKey];
    const progress = goalProgress(current, goal);
    return `
      <section class="goal-item ${progress.tone}">
        <div class="goal-head-row">
          <h3>${label}</h3>
          <span class="goal-percent ${progress.tone}">${progress.displayPercent}%</span>
        </div>
        <p class="goal-line"><strong>${current}</strong> / <strong>${goal}</strong></p>
        <div class="goal-bar" aria-hidden="true">
          <span class="goal-fill ${progress.tone}" style="width: ${progress.width}%"></span>
        </div>
        <p class="goal-meta">${progress.label}</p>
      </section>`;
  }).join('');

  const metrics = getDateMetrics();
  const showOnlyActive = ui.showActiveToggle?.checked ?? true;
  const visibleOriginators = showOnlyActive
    ? state.originators.filter((person) => {
        const personMetrics = metrics[person.id] || emptyMetrics();
        return Object.values(personMetrics).some((value) => clamp(value) > 0);
      })
    : state.originators;

  ui.rosterBody.innerHTML = visibleOriginators.length
    ? visibleOriginators.map((person) => {
        const personMetrics = metrics[person.id] || emptyMetrics();
        const rowIndex = state.originators.findIndex((item) => item.id === person.id);
        return `<tr data-originator-id="${escapeHtml(person.id)}" data-index="${rowIndex}">
          <td><div class="originator">
            <span class="avatar">${escapeHtml(person.initials)}</span>
            <div><div class="name">${escapeHtml(person.name)}</div>
              ${person.subtitle ? `<div class="subtitle-mini">${escapeHtml(person.subtitle)}</div>` : ''}
            </div>
          </div></td>
          ${metricCell('pulls', personMetrics.pulls)}
          ${metricCell('contacts', personMetrics.contacts)}
          ${metricCell('agents', personMetrics.agents)}
          ${metricCell('lender', personMetrics.lender)}
          <td class="actions-cell">
            <button class="icon-btn" type="button" data-action="edit-originator" aria-label="Edit ${escapeHtml(person.name)}">✎</button>
            <button class="icon-btn" type="button" data-action="remove-originator" aria-label="Remove ${escapeHtml(person.name)}">✕</button>
          </td>
        </tr>`;
      }).join('') + `<tr class="team-total-row">
        <td><strong>Team Totals</strong></td>
        <td><strong>${totals.pulls}</strong></td>
        <td><strong>${totals.contacts}</strong></td>
        <td><strong>${totals.agents}</strong></td>
        <td><strong>${totals.lender}</strong></td>
        <td></td>
      </tr>`
    : '<tr><td colspan="6" class="empty-row">No active originators for this date.</td></tr>';

  ui.teamRecordsBody.innerHTML = state.teamRecords.length
    ? state.teamRecords.map((record, index) => `<tr data-index="${index}">
        <td>${escapeHtml(record.originatorName)}</td>
        <td>${escapeHtml(record.recordBroke)}</td>
        <td>${clamp(record.recordNumber)}</td>
        <td class="actions-cell">
          <button class="icon-btn" type="button" data-action="edit-record" aria-label="Edit ${escapeHtml(record.originatorName)} record">✎</button>
          <button class="icon-btn" type="button" data-action="remove-record" aria-label="Remove ${escapeHtml(record.originatorName)} record">✕</button>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="4" class="empty-row">No team records yet.</td></tr>';

  ui.logEffortOriginator.innerHTML = state.originators
    .map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`)
    .join('');

  const selectedOriginator = ui.logEffortOriginator.value || state.originators[0]?.id || '';
  if (selectedOriginator) ui.logEffortOriginator.value = selectedOriginator;
}

function metricCell(metric, value) {
  const goalKey = metric === 'agents' ? 'attachments' : metric;
  const goal = state.goals[goalKey] || 0;
  const progress = goalProgress(value, goal);
  return `<td class="metric-cell">
    <div class="metric-readout">${clamp(value)}</div>
    <div class="stepper">
      <button type="button" class="step-btn" data-metric="${metric}" data-delta="-1" aria-label="Decrease ${metric}">−</button>
      <input class="metric-input" type="number" min="0" step="1" inputmode="numeric"
        data-metric="${metric}" value="${clamp(value)}" aria-label="${metric}" />
      <button type="button" class="step-btn" data-metric="${metric}" data-delta="1" aria-label="Increase ${metric}">+</button>
    </div>
    <div class="metric-visual">
      <div class="metric-progress ${progress.tone}" aria-hidden="true">
        <span style="width: ${progress.width}%"></span>
      </div>
      <div class="metric-meta ${progress.tone}">${progress.displayPercent}%</div>
    </div>
  </td>`;
}

function updateMetric(personId, metric, value) {
  const metrics = getDateMetrics();
  if (!metrics[personId]) metrics[personId] = emptyMetrics();
  metrics[personId][metric] = clamp(value);
  saveState();
  render();
}

function bindEvents() {
  document.getElementById('prevDayBtn').addEventListener('click', () => changeDate(-1));
  document.getElementById('nextDayBtn').addEventListener('click', () => changeDate(1));
  ui.dateInput.addEventListener('change', () => {
    if (!ui.dateInput.value) return;
    state.currentDate = ui.dateInput.value;
    saveState();
    render();
  });
  if (ui.showActiveToggle) ui.showActiveToggle.addEventListener('change', render);
  document.getElementById('addOriginatorBtn').addEventListener('click', () => {
    editOriginatorId = null;
    ui.originatorForm.reset();
    document.getElementById('originatorDialogTitle').textContent = 'Add Originator';
    ui.originatorDialog.showModal();
  });
  document.getElementById('editGoalsBtn').addEventListener('click', () => {
    for (const key of Object.keys(state.goals)) ui.goalsForm.elements[key].value = state.goals[key];
    ui.goalsDialog.showModal();
  });
  document.getElementById('logEffortBtn').addEventListener('click', openLogEffort);
  document.getElementById('addTeamRecordBtn').addEventListener('click', () => {
    editTeamRecordId = null;
    ui.teamRecordForm.reset();
    document.getElementById('teamRecordDialogTitle').textContent = 'Add Team Record';
    ui.teamRecordDialog.showModal();
  });

  ui.rosterBody.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const row = button.closest('tr');
    const personId = row?.dataset.originatorId;
    const person = state.originators.find((item) => item.id === personId);
    if (!person) return;
    if (button.dataset.metric) {
      const metric = button.dataset.metric;
      const current = getDateMetrics()[person.id]?.[metric] || 0;
      updateMetric(person.id, metric, current + Number(button.dataset.delta));
    } else if (button.dataset.action === 'edit-originator') {
      editOriginatorId = person.id;
      ui.originatorForm.elements.name.value = person.name;
      ui.originatorForm.elements.initials.value = person.initials;
      ui.originatorForm.elements.subtitle.value = person.subtitle;
      document.getElementById('originatorDialogTitle').textContent = 'Edit Originator';
      ui.originatorDialog.showModal();
    } else if (button.dataset.action === 'remove-originator' && window.confirm(`Remove ${person.name}?`)) {
      state.originators = state.originators.filter((item) => item.id !== person.id);
      for (const dateMetrics of Object.values(state.metricsByDate)) delete dateMetrics[person.id];
      saveState();
      render();
    }
  });
  ui.rosterBody.addEventListener('change', (event) => {
    if (!event.target.matches('input[data-metric]')) return;
    const personId = event.target.closest('tr')?.dataset.originatorId;
    const person = state.originators.find((item) => item.id === personId);
    if (person) updateMetric(person.id, event.target.dataset.metric, event.target.value);
  });

  ui.teamRecordsBody.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const record = state.teamRecords[Number(button.closest('tr')?.dataset.index)];
    if (!record) return;
    if (button.dataset.action === 'edit-record') {
      editTeamRecordId = record.id;
      ui.teamRecordForm.elements.originatorName.value = record.originatorName;
      ui.teamRecordForm.elements.recordBroke.value = record.recordBroke;
      ui.teamRecordForm.elements.recordNumber.value = record.recordNumber;
      document.getElementById('teamRecordDialogTitle').textContent = 'Edit Team Record';
      ui.teamRecordDialog.showModal();
    } else if (button.dataset.action === 'remove-record'
      && window.confirm(`Remove ${record.originatorName}'s "${record.recordBroke}" record?`)) {
      state.teamRecords = state.teamRecords.filter((item) => item.id !== record.id);
      saveState();
      render();
    }
  });

  ui.originatorForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(ui.originatorForm);
    const name = String(form.get('name') || '').trim();
    const initials = String(form.get('initials') || '').trim().toUpperCase();
    if (!name || !initials) return;
    if (editOriginatorId) {
      const person = state.originators.find((item) => item.id === editOriginatorId);
      if (person) Object.assign(person, { name, initials, subtitle: String(form.get('subtitle') || '').trim() });
    } else {
      state.originators.push({
        id: `originator-${Date.now().toString(36)}`,
        name,
        initials,
        subtitle: String(form.get('subtitle') || '').trim(),
      });
    }
    saveState();
    render();
    ui.originatorDialog.close();
  });
  ui.goalsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(ui.goalsForm);
    for (const key of Object.keys(state.goals)) state.goals[key] = clamp(form.get(key));
    saveState();
    render();
    ui.goalsDialog.close();
  });
  ui.logEffortForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(ui.logEffortForm);
    const personId = String(form.get('originator') || '');
    const metrics = getDateMetrics();
    if (!metrics[personId]) metrics[personId] = emptyMetrics();
    for (const key of ['pulls', 'contacts', 'agents', 'lender']) metrics[personId][key] = clamp(form.get(key));
    saveState();
    render();
    ui.logEffortDialog.close();
  });
  ui.teamRecordForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(ui.teamRecordForm);
    const record = {
      originatorName: String(form.get('originatorName') || '').trim(),
      recordBroke: String(form.get('recordBroke') || '').trim(),
      recordNumber: clamp(form.get('recordNumber')),
    };
    if (!record.originatorName || !record.recordBroke) return;
    if (editTeamRecordId) {
      const existing = state.teamRecords.find((item) => item.id === editTeamRecordId);
      if (existing) Object.assign(existing, record);
    } else {
      state.teamRecords.push({ id: `record-${Date.now().toString(36)}`, ...record });
    }
    saveState();
    render();
    ui.teamRecordDialog.close();
  });
}

function openLogEffort() {
  if (!state.originators.length) {
    window.alert('Add an originator first.');
    return;
  }
  const personId = ui.logEffortOriginator.value || state.originators[0].id;
  const metrics = getDateMetrics()[personId] || emptyMetrics();
  ui.logEffortForm.elements.originator.value = personId;
  for (const key of ['pulls', 'contacts', 'agents', 'lender']) ui.logEffortForm.elements[key].value = metrics[key];
  ui.logEffortOriginator.onchange = () => {
    const selected = getDateMetrics()[ui.logEffortOriginator.value] || emptyMetrics();
    for (const key of ['pulls', 'contacts', 'agents', 'lender']) ui.logEffortForm.elements[key].value = selected[key];
  };
  ui.logEffortDialog.showModal();
}

function changeDate(delta) {
  const date = new Date(`${state.currentDate}T12:00:00`);
  date.setDate(date.getDate() + delta);
  state.currentDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  saveState();
  render();
}

(async () => {
  state = await loadState();
  if (ui.showActiveToggle) ui.showActiveToggle.checked = true;
  if (SYNC_URL) {
    const remote = await pullRemote();
    if (remote) state = remote;
    lastSynced = syncPayload();
    if (!remote) pushRemote();
  }
  bindEvents();
  render();
  startSync();
})();

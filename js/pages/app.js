import { supabase } from '../api/supabase.js';
import { getLeadActivitySummary } from '../api/dashboard.js';
import { getOpenTasksWithLeads } from '../api/tasks.js';
import { getBusinessProfile } from '../api/leads.js';
import { buildTodaySections } from '../lib/dashboardStatus.js';
import { renderTodayDashboard } from '../ui/dashboard.js';
import { setAttentionBadge } from '../ui/navigation.js';
import { createTaskController } from './taskController.js';

const { data: { session }, error } = await supabase.auth.getSession();
if (error || !session) location.replace('./login.html');
else {
  document.querySelector('#account-email').textContent = session.user.email ?? '';
  document.querySelector('#app-shell').hidden = false;
}
const logoutButton = document.querySelector('#logout-button');
const status = document.querySelector('#app-message');
logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  status.textContent = 'Signing out…';
  let signOutError;
  try { ({ error: signOutError } = await supabase.auth.signOut()); }
  catch (requestError) {
    status.textContent = requestError.message || 'Unable to sign out. Check your connection and try again.';
    logoutButton.disabled = false; return;
  }
  if (signOutError) { status.textContent = signOutError.message; logoutButton.disabled = false; return; }
  location.replace('./login.html');
});

const state = document.querySelector('#today-state');
const sectionsNode = document.querySelector('#today-sections');
const leadIndex = new Map();
let profile = { quiet_after_days: 5 };
let currentSections = null;
function setMessage(message, kind = '') { status.textContent = message || ''; status.dataset.kind = kind; }
function showDashboardState(kind, message) {
  state.replaceChildren();
  const node = document.createElement('div');
  node.className = kind === 'loading' ? 'ui-card today-state-card' : 'ui-card today-state-card';
  node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  if (kind === 'loading') {
    const row = document.createElement('div'); row.className = 'ui-loading';
    const spinner = document.createElement('span'); spinner.className = 'ui-spinner'; spinner.setAttribute('aria-hidden', 'true');
    row.append(spinner, document.createTextNode(message)); node.append(row);
  } else node.textContent = message;
  state.append(node);
}
async function loadDashboard(showLoading = false) {
  if (showLoading) showDashboardState('loading', 'Loading today’s follow-ups…');
  try {
    const [summary, tasks, loadedProfile] = await Promise.all([getLeadActivitySummary(), getOpenTasksWithLeads(), getBusinessProfile()]);
    profile = loadedProfile || { quiet_after_days: 5 };
    leadIndex.clear();
    summary.forEach((row) => leadIndex.set(row.lead_id, { id: row.lead_id, name: row.lead_name, stage: row.lead_stage, created_at: row.lead_created_at }));
    tasks.forEach((task) => { if (task.lead) leadIndex.set(task.lead.id, task.lead); });
    currentSections = buildTodaySections(summary, tasks, profile.quiet_after_days ?? 5);
    state.replaceChildren();
    renderTodayDashboard(sectionsNode, currentSections, {
      schedule: (lead) => taskController.openSchedule(lead),
      taskActions: taskController,
    });
    setAttentionBadge(currentSections);
  } catch (error) {
    sectionsNode.replaceChildren();
    showDashboardState('error', error?.message || 'Today’s follow-ups could not be loaded. Check your connection and try again.');
  }
}
const taskController = createTaskController({
  dialog: document.querySelector('#task-compose-dialog'),
  form: document.querySelector('#task-compose-form'),
  resolveLead: (leadId) => leadIndex.get(leadId),
  onChanged: () => loadDashboard(false),
  showNotice: setMessage,
});

document.querySelectorAll('[data-page]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  const page = link.dataset.page;
  const dashboardPage = document.querySelector('#dashboard-page');
  const otherPage = document.querySelector('#other-page');
  document.querySelectorAll('[data-page]').forEach((item) => item.setAttribute('aria-current', String(item.dataset.page === page)));
  if (page === 'dashboard') {
    dashboardPage.hidden = false; otherPage.hidden = true;
    document.querySelector('#page-title').textContent = 'Today';
    document.querySelector('#page-description').textContent = 'Your replies and follow-ups that need attention.';
    loadDashboard(false);
  } else {
    dashboardPage.hidden = true; otherPage.hidden = false;
    document.querySelector('#other-page-title').textContent = 'Settings';
    document.querySelector('#other-page-description').textContent = 'Business settings will appear here.';
  }
}));

if (!error && session) await loadDashboard(true);

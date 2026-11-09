import { supabase } from '../api/supabase.js';
import { getLeadActivitySummary } from '../api/dashboard.js';
import { getOpenTasksWithLeads } from '../api/tasks.js';
import { loadBusinessProfile, saveBusinessProfile, subscribeToBusinessProfile } from '../api/businessProfile.js';
import { buildTodaySections } from '../lib/dashboardStatus.js';
import { isProfileComplete } from '../lib/businessProfile.js';
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
let profile = null;
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
    try {
      profile = await loadBusinessProfile({ forceRefresh: true, source: 'dashboard' });
      document.querySelector('#dashboard-profile-state').textContent = '';
      document.querySelector('#dashboard-profile-state').dataset.kind = '';
      document.querySelector('#dashboard-profile-banner').hidden = isProfileComplete(profile);
    } catch (profileError) {
      profile = null;
      document.querySelector('#dashboard-profile-banner').hidden = true;
      document.querySelector('#dashboard-profile-state').textContent = profileError?.message || 'Business profile could not be loaded. Try again.';
      document.querySelector('#dashboard-profile-state').dataset.kind = 'error';
      throw profileError;
    }
    const [summary, tasks] = await Promise.all([getLeadActivitySummary(), getOpenTasksWithLeads()]);
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
const settingsForm = document.querySelector('#settings-form');
const settingsMessage = document.querySelector('#settings-message');
function setSettingsMessage(message, kind = '') {
  settingsMessage.textContent = message || '';
  settingsMessage.dataset.kind = kind;
}
async function loadSettings() {
  setSettingsMessage('Loading business profile…', 'loading');
  try {
    profile = await loadBusinessProfile({ forceRefresh: true, source: 'settings' });
    for (const field of ['business_name', 'business_type', 'products_services', 'pricing_notes', 'ideal_customer', 'tone', 'currency', 'quiet_after_days']) {
      if (field === 'currency' && profile.currency && !Array.from(settingsForm.elements.currency.options).some((option) => option.value === profile.currency)) {
        const option = document.createElement('option'); option.value = profile.currency; option.textContent = profile.currency + ' — Current business currency';
        settingsForm.elements.currency.append(option);
      }
      settingsForm.elements[field].value = profile[field] ?? (field === 'quiet_after_days' ? 5 : field === 'currency' ? 'USD' : '');
    }
    setSettingsMessage('');
  } catch (loadError) {
    setSettingsMessage(loadError?.message || 'Business profile could not be loaded. Try again.', 'error');
  }
}
settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!settingsForm.reportValidity()) return;
  const quietDays = Number(settingsForm.elements.quiet_after_days.value);
  if (!Number.isInteger(quietDays) || quietDays < 1 || quietDays > 60) {
    settingsForm.elements.quiet_after_days.setCustomValidity('Enter a number from 1 to 60.');
    settingsForm.elements.quiet_after_days.reportValidity();
    settingsForm.elements.quiet_after_days.setCustomValidity('');
    return;
  }
  const values = Object.fromEntries(['business_name', 'business_type', 'products_services', 'pricing_notes', 'ideal_customer', 'tone', 'currency'].map((field) => [field, settingsForm.elements[field].value.trim() || null]));
  values.quiet_after_days = quietDays;
  const button = document.querySelector('#settings-save');
  button.disabled = true; button.classList.add('is-loading'); button.textContent = 'Saving…';
  setSettingsMessage('Saving your business profile…', 'loading');
  try {
    profile = await saveBusinessProfile(values);
    document.querySelector('#dashboard-profile-banner').hidden = isProfileComplete(profile);
    document.querySelector('#dashboard-profile-state').textContent = '';
    document.querySelector('#dashboard-profile-state').dataset.kind = '';
    setSettingsMessage('Business profile saved.', 'success');
  } catch (saveError) {
    setSettingsMessage(saveError?.message || 'Business profile could not be saved. Check your connection and try again.', 'error');
  } finally {
    button.disabled = false; button.classList.remove('is-loading'); button.textContent = 'Save business profile';
  }
});
subscribeToBusinessProfile(({ profile: updatedProfile, error: profileError }) => {
  const profileState = document.querySelector('#dashboard-profile-state');
  const banner = document.querySelector('#dashboard-profile-banner');
  if (profileError || !updatedProfile) {
    profile = null;
    banner.hidden = true;
    profileState.textContent = profileError?.message || 'Business profile could not be loaded. Try again.';
    profileState.dataset.kind = 'error';
    return;
  }
  profile = updatedProfile;
  profileState.textContent = '';
  profileState.dataset.kind = '';
  banner.hidden = isProfileComplete(profile);
});
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
  history.replaceState(null, '', '#' + page);
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
    document.querySelector('#other-page-description').textContent = 'Keep your business details accurate for better AI assistance.';
    loadSettings();
  }
}));

document.querySelectorAll('[data-open-settings]').forEach((button) => button.addEventListener('click', () => {
  location.hash = 'settings';
  document.querySelector('[data-page="settings"]').click();
}));

if (!error && session) {
  if (location.hash === '#settings') document.querySelector('[data-page="settings"]').click();
  else await loadDashboard(true);
}

import { supabase } from '../api/supabase.js';
import { getLeadActivitySummary } from '../api/dashboard.js';
import { getOpenTasksWithLeads } from '../api/tasks.js';
import { loadBusinessProfile, saveBusinessProfile, subscribeToBusinessProfile, uploadBusinessLogo } from '../api/businessProfile.js';
import { buildTodaySections } from '../lib/dashboardStatus.js';
import { isProfileComplete } from '../lib/businessProfile.js';
import { renderTodayDashboard } from '../ui/dashboard.js';
import { initAppNavigation, setAttentionBadge, updateActiveNavigation } from '../ui/navigation.js';
import { createTaskController } from './taskController.js';
import { initAnalyticsPage } from './analytics.js';
import { redirectToLogin } from '../lib/authRedirect.js';

const { data: { session }, error } = await supabase.auth.getSession();
if (error || !session) redirectToLogin('Your session expired, please log in again.');
else {
  document.querySelector('#app-shell').hidden = false;
  initAppNavigation(session.user.email ?? '');
}
const status = document.querySelector('#app-message');

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
      profile = await loadBusinessProfile({ source: 'dashboard' });
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
const logoFile = document.querySelector('#setting-company-logo');
const logoUploadButton = document.querySelector('#settings-logo-upload');
const logoStatus = document.querySelector('#settings-logo-message');
const logoPreview = document.querySelector('#settings-logo-preview');
const logoInitials = document.querySelector('#settings-logo-initials');
function setSettingsMessage(message, kind = '') {
  settingsMessage.textContent = message || '';
  settingsMessage.dataset.kind = kind;
}
function renderSettingsLogo(currentProfile) {
  const name = String(currentProfile?.business_name || '').trim() || 'CoreFlow AI';
  const words = name.split(/\s+/).filter(Boolean);
  logoInitials.textContent = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2)).toLocaleUpperCase();
  logoPreview.alt = `${name} logo preview`;
  let safeUrl = '';
  try {
    const candidate = new URL(currentProfile?.logo_url || '', window.location.origin);
    if (['http:', 'https:'].includes(candidate.protocol)) safeUrl = candidate.href;
  } catch { /* Keep the initials preview when there is no usable logo URL. */ }
  logoPreview.hidden = !safeUrl;
  logoPreview.onerror = () => { logoPreview.hidden = true; logoInitials.hidden = false; };
  logoPreview.onload = () => { logoInitials.hidden = true; };
  logoPreview.removeAttribute('src');
  if (safeUrl) logoPreview.src = safeUrl;
  logoInitials.hidden = Boolean(safeUrl);
}
async function loadSettings() {
  setSettingsMessage('Loading business profile…', 'loading');
  try {
    profile = await loadBusinessProfile({ source: 'settings' });
    for (const field of ['business_name', 'business_type', 'products_services', 'pricing_notes', 'ideal_customer', 'tone', 'currency', 'quiet_after_days']) {
      if (field === 'currency' && profile.currency && !Array.from(settingsForm.elements.currency.options).some((option) => option.value === profile.currency)) {
        const option = document.createElement('option'); option.value = profile.currency; option.textContent = profile.currency + ' — Current business currency';
        settingsForm.elements.currency.append(option);
      }
      settingsForm.elements[field].value = profile[field] ?? (field === 'quiet_after_days' ? 5 : field === 'currency' ? 'USD' : '');
    }
    renderSettingsLogo(profile);
    setSettingsMessage('');
  } catch (loadError) {
    setSettingsMessage(loadError?.message || 'Business profile could not be loaded. Try again.', 'error');
  }
}
logoFile.addEventListener('change', () => {
  const file = logoFile.files?.[0];
  logoStatus.textContent = file ? `Selected: ${file.name}` : '';
  logoStatus.dataset.kind = file ? 'loading' : '';
});
logoUploadButton.addEventListener('click', async () => {
  const file = logoFile.files?.[0];
  if (!file) {
    logoStatus.textContent = 'Choose a logo image first.';
    logoStatus.dataset.kind = 'error';
    return;
  }
  logoUploadButton.disabled = true;
  logoUploadButton.classList.add('is-loading');
  logoUploadButton.textContent = 'Uploading…';
  logoStatus.textContent = 'Uploading your company logo…';
  logoStatus.dataset.kind = 'loading';
  try {
    profile = await uploadBusinessLogo(file);
    renderSettingsLogo(profile);
    logoFile.value = '';
    logoStatus.textContent = 'Company logo uploaded.';
    logoStatus.dataset.kind = 'success';
  } catch (uploadError) {
    logoStatus.textContent = uploadError?.message || 'Company logo could not be uploaded. Please try again.';
    logoStatus.dataset.kind = 'error';
  } finally {
    logoUploadButton.disabled = false;
    logoUploadButton.classList.remove('is-loading');
    logoUploadButton.textContent = 'Upload logo';
  }
});
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
  renderSettingsLogo(profile);
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
const analyticsPage = initAnalyticsPage();

function renderRoute(initial = false) {
  const route = updateActiveNavigation();
  document.querySelector('#dashboard-page').hidden = route !== 'dashboard';
  document.querySelector('#other-page').hidden = route !== 'settings';
  document.querySelector('#analytics-page').hidden = route !== 'analytics';
  if (route === 'dashboard') loadDashboard(initial);
  if (route === 'settings') loadSettings();
  if (route === 'analytics') analyticsPage.load();
}
window.addEventListener('hashchange', () => renderRoute(false));

document.querySelectorAll('[data-open-settings]').forEach((button) => button.addEventListener('click', () => {
  location.hash = 'settings';
}));

if (!error && session) {
  renderRoute(true);
}

import { supabase } from '../api/supabase.js';
import { deleteLead, getLead } from '../api/leads.js';
import { loadBusinessProfile, subscribeToBusinessProfile } from '../api/businessProfile.js';
import { createTask, getTasksForLead } from '../api/tasks.js';
import { createActivity, getActivitiesForLead } from '../api/activities.js';
import { getLeadStatuses, isOpen } from '../lib/leadStatus.js';
import { todayLocalDate, addDays } from '../lib/dates.js';
import { showPageState, labelForStage } from '../ui/leads.js';
import { toneForStage, ACTIVITY_TYPES, channelsForActivityType } from '../lib/constants.js';
import { renderLeadDetails, renderQuickActions, renderTimeline } from '../ui/leadDetail.js';
import { renderFollowupTasks } from '../ui/followups.js';
import { createTaskController } from './taskController.js';
import { refreshAttentionBadge } from '../ui/navigation.js';
import { scoreLead } from '../api/ai.js';
import { analysisIsStale, renderAiAnalysis } from '../ui/aiAnalysis.js';
import { isProfileComplete } from '../lib/businessProfile.js';

const app = document.querySelector('#app');
const content = document.querySelector('#detail-content');
const timeline = document.querySelector('#timeline');
const interactionForm = document.querySelector('#interaction-form');
const pageNotice = document.querySelector('#page-notice');
const quickActions = document.querySelector('#quick-actions');
const followupSection = document.querySelector('#followup-section');
const followupList = document.querySelector('#followup-list');
const scheduleTaskForm = document.querySelector('#schedule-task-form');
const taskPageNotice = document.querySelector('#task-page-notice');
const leadId = new URLSearchParams(location.search).get('id');
let lead = null;
let activities = [];
let profile = null;
let profileLoaded = false;
let followupTasks = [];
let taskController;

function setNotice(text, kind = '') {
  pageNotice.textContent = text || '';
  pageNotice.dataset.kind = kind;
}
function errorText(error) { return error?.message || 'Something went wrong. Please try again.'; }
function addOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.append(option);
}
function refreshChannelOptions() {
  const type = interactionForm.elements.type.value;
  const channelRow = document.querySelector('#interaction-channel-row');
  const directionRow = document.querySelector('#interaction-direction-row');
  const channel = interactionForm.elements.channel;
  const direction = interactionForm.elements.direction;
  channelRow.hidden = type === 'note';
  directionRow.hidden = type === 'note';
  direction.required = type !== 'note';
  channel.replaceChildren();
  addOption(channel, '', 'Choose channel');
  const relevantChannels = channelsForActivityType(type);
  relevantChannels.forEach(({ value, label }) => addOption(channel, value, label));
  if (lead?.preferred_channel && relevantChannels.some((item) => item.value === lead.preferred_channel)) {
    channel.value = lead.preferred_channel;
  }
}
function setDefaultOccurrence() {
  const date = new Date();
  const pad = (number) => String(number).padStart(2, '0');
  interactionForm.elements.occurred_at.value = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}
function setTaskNotice(text, kind = '') {
  taskPageNotice.textContent = text || '';
  taskPageNotice.dataset.kind = kind;
}
async function loadFollowupTasks() {
  if (!lead || !isOpen(lead)) {
    followupSection.hidden = true;
    followupTasks = [];
    return;
  }
  followupSection.hidden = false;
  renderFollowupTasks(followupList, [], taskController || {}, 'loading');
  try {
    followupTasks = await getTasksForLead(lead.id);
    renderFollowupTasks(followupList, followupTasks, taskController);
  } catch (error) {
    renderFollowupTasks(followupList, [], taskController || {}, 'error');
    const retry = document.createElement('button');
    retry.type = 'button'; retry.className = 'ui-button ui-button--secondary'; retry.textContent = 'Try again';
    retry.addEventListener('click', loadFollowupTasks);
    followupList.append(retry);
    setTaskNotice(error?.message || 'Follow-ups could not be loaded.', 'error');
  }
}
function renderAll() {
  renderLeadDetails(content, lead, activities, profile || { currency: 'USD', quiet_after_days: 5 });
  renderTimeline(timeline, activities);
  renderQuickActions(quickActions, lead, async (value, kind) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(kind.charAt(0).toUpperCase() + kind.slice(1) + ' copied.', 'success');
    } catch {
      setNotice('Clipboard access is unavailable. Select and copy the contact details from the lead record.', 'error');
    }
  });
  const statuses = getLeadStatuses(lead, activities, profile?.quiet_after_days ?? 5);
  const statusText = statuses.closed ? 'Closed' : statuses.needsReply ? 'Needs reply' : statuses.goneQuiet ? 'Gone quiet' : labelForStage(lead.stage);
  const statusBadge = document.querySelector('#detail-status');
  statusBadge.textContent = statusText;
  statusBadge.className = 'ui-badge ui-badge--' + (statuses.closed ? 'neutral' : statuses.needsReply ? 'warning' : statuses.goneQuiet ? 'danger' : toneForStage(lead.stage));
  const analysis = lead.ai_analysis && typeof lead.ai_analysis === 'object' ? lead.ai_analysis : null;
  renderAiAnalysis(document.querySelector('#ai-analysis-panel'), document.querySelector('#ai-score-badge'), analysis);
  document.querySelector('#ai-score-stale').hidden = !analysisIsStale(lead, activities, analysis);
  document.querySelector('#score-lead-button').textContent = analysis ? 'Score lead again' : 'Score lead';
  document.querySelector('#complete-profile-link').hidden = !profileLoaded || isProfileComplete(profile);
  document.querySelector('#score-lead-button').disabled = !profileLoaded;
}
async function loadDetail() {
  showPageState(content, 'loading', 'Loading lead details…');
  showPageState(timeline, 'loading', 'Loading activity…');
  if (!leadId) {
    showPageState(content, 'error', 'No lead was selected. Return to the leads list.');
    showPageState(timeline, 'error', 'Lead activity is unavailable without a selected lead.');
    return false;
  }
  try {
    const result = await Promise.all([getLead(leadId), getActivitiesForLead(leadId)]);
    lead = result[0];
    activities = result[1];
    if (!lead) {
      showPageState(content, 'error', 'This lead could not be found or is no longer available.');
      showPageState(timeline, 'error', 'Lead activity is unavailable.');
      return false;
    }
    try {
      profile = await loadBusinessProfile({ forceRefresh: true, source: 'lead-detail' });
      profileLoaded = true;
      const scoreMessage = document.querySelector('#ai-score-message');
      if (scoreMessage.dataset.kind === 'error' && scoreMessage.textContent.startsWith('Business profile')) {
        scoreMessage.textContent = '';
        scoreMessage.dataset.kind = '';
      }
    } catch (profileError) {
      profile = null;
      profileLoaded = false;
      const scoreMessage = document.querySelector('#ai-score-message');
      scoreMessage.textContent = profileError?.message || 'Business profile could not be loaded. Try again.';
      scoreMessage.dataset.kind = 'error';
    }
    content.replaceChildren();
    scheduleTaskForm.elements.title.value = 'Follow up with ' + lead.name;
    scheduleTaskForm.elements.due_date.value = scheduleTaskForm.elements.due_date.value || addDays(todayLocalDate(), 1);
    document.querySelector('#detail-heading-title').textContent = lead.name;
    document.querySelector('#detail-company').textContent = lead.company || 'Lead record';
    const status = document.querySelector('#detail-status');
    status.textContent = labelForStage(lead.stage);
    status.className = 'ui-badge ui-badge--' + toneForStage(lead.stage);
    renderAll();
    await loadFollowupTasks();
    await refreshAttentionBadge();
    refreshChannelOptions();
    setDefaultOccurrence();
    return true;
  } catch (error) {
    showPageState(content, 'error', errorText(error));
    showPageState(timeline, 'error', 'Activity timeline could not be loaded.');
    return false;
  }
}
async function runLeadScoring() {
  const message = document.querySelector('#ai-score-message');
  const button = document.querySelector('#score-lead-button');
  const retryButton = document.querySelector('#retry-score-button');
  retryButton.hidden = true;
  if (!profileLoaded || !profile) {
    message.textContent = 'Business profile could not be loaded. Retry loading this page before scoring.';
    message.dataset.kind = 'error';
    document.querySelector('#complete-profile-link').hidden = true;
    return;
  }
  if (!isProfileComplete(profile)) {
    message.textContent = 'Add at least 10 non-whitespace characters to products/services in Settings before scoring.';
    message.dataset.kind = 'error';
    document.querySelector('#complete-profile-link').hidden = false;
    return;
  }
  button.disabled = true; button.classList.add('is-loading'); button.textContent = 'Scoring lead…';
  message.textContent = 'Reviewing the lead details and recent activity…'; message.dataset.kind = 'loading';
  try {
    await scoreLead(lead.id);
    message.textContent = 'Lead score updated.'; message.dataset.kind = 'success';
    await loadDetail();
  } catch (scoreError) {
    const retryable = ['OVERLOADED', 'RATE_LIMITED', 'INVALID_OUTPUT'].includes(scoreError.providerReason);
    message.textContent = ['OVERLOADED', 'RATE_LIMITED'].includes(scoreError.providerReason)
      ? `The AI service is busy right now. Please try again in a minute.${scoreError.retryAfterSeconds ? ` Retry after about ${scoreError.retryAfterSeconds}s.` : ''}`
      : (scoreError.message || 'Scoring failed. Check your connection and try again.');
    message.dataset.kind = 'error';
    retryButton.hidden = !retryable;
  } finally {
    button.disabled = false; button.classList.remove('is-loading'); button.textContent = lead?.ai_analysis ? 'Score lead again' : 'Score lead';
  }
}
document.querySelector('#score-lead-button').addEventListener('click', runLeadScoring);
document.querySelector('#rescore-lead-button').addEventListener('click', runLeadScoring);
document.querySelector('#retry-score-button').addEventListener('click', runLeadScoring);
subscribeToBusinessProfile(({ profile: updatedProfile, error: profileError }) => {
  const message = document.querySelector('#ai-score-message');
  if (profileError || !updatedProfile) {
    profile = null;
    profileLoaded = false;
    document.querySelector('#complete-profile-link').hidden = true;
    document.querySelector('#score-lead-button').disabled = true;
    message.textContent = profileError?.message || 'Business profile could not be loaded. Try again.';
    message.dataset.kind = 'error';
    return;
  }
  profile = updatedProfile;
  profileLoaded = true;
  document.querySelector('#score-lead-button').disabled = false;
  if (message.dataset.kind === 'error' && message.textContent.startsWith('Business profile')) {
    message.textContent = '';
    message.dataset.kind = '';
  }
  if (lead) renderAll();
});
document.querySelector('#edit-lead-button').addEventListener('click', () => {
  location.href = './leads.html?edit=' + encodeURIComponent(leadId);
});
document.querySelector('#delete-lead-button').addEventListener('click', async () => {
  if (!lead || !window.confirm('Delete ' + lead.name + '? This will also delete its activity history and cannot be undone.')) return;
  const button = document.querySelector('#delete-lead-button');
  button.disabled = true;
  button.textContent = 'Deleting…';
  try {
    await deleteLead(lead.id);
    location.replace('./leads.html');
  } catch (error) {
    setNotice(errorText(error), 'error');
    button.disabled = false;
    button.textContent = 'Delete lead';
  }
});
ACTIVITY_TYPES.forEach(({ value, label }) => addOption(interactionForm.elements.type, value, label));
interactionForm.elements.type.addEventListener('change', refreshChannelOptions);
interactionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!lead || !interactionForm.reportValidity()) return;
  const type = interactionForm.elements.type.value;
  const rawDate = interactionForm.elements.occurred_at.value;
  const occurredAt = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();
  const values = {
    lead_id: lead.id,
    type,
    channel: type === 'note' ? null : (interactionForm.elements.channel.value || null),
    direction: type === 'note' ? null : (interactionForm.elements.direction.value || null),
    content: interactionForm.elements.content.value.trim() || null,
    occurred_at: occurredAt,
  };
  const button = document.querySelector('#log-interaction-button');
  button.disabled = true;
  button.classList.add('is-loading');
  button.textContent = 'Saving…';
  setNotice('Saving interaction…', 'loading');
  try {
    await createActivity(values);
    interactionForm.elements.content.value = '';
    setDefaultOccurrence();
    const refreshed = await loadDetail();
    if (refreshed) setNotice('Interaction added to the timeline.', 'success');
    else setNotice('Interaction was saved, but the page could not refresh. Reload to see the latest activity.', 'error');
  } catch (error) {
    setNotice(errorText(error), 'error');
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.textContent = 'Log interaction';
  }
});
document.querySelector('#logout-button').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Logging out…';
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    location.replace('./login.html');
  } catch (error) {
    setNotice(errorText(error), 'error');
    button.disabled = false;
    button.textContent = 'Log out';
  }
});
document.querySelector('#activity-back').addEventListener('click', () => location.href = './leads.html');
taskController = createTaskController({
  dialog: document.querySelector('#task-compose-dialog'),
  form: document.querySelector('#task-compose-form'),
  resolveLead: (id) => lead?.id === id ? lead : null,
  onChanged: async () => { await loadDetail(); },
  showNotice: setTaskNotice,
});
scheduleTaskForm.elements.due_date.value = addDays(todayLocalDate(), 1);
scheduleTaskForm.elements.title.value = 'Follow up with ' + (lead?.name || '');
scheduleTaskForm.addEventListener('click', (event) => {
  const quick = event.target.closest('[data-quick-due]');
  if (quick) scheduleTaskForm.elements.due_date.value = addDays(todayLocalDate(), Number(quick.dataset.quickDue));
});
scheduleTaskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!lead || !isOpen(lead) || !scheduleTaskForm.reportValidity()) return;
  const button = scheduleTaskForm.querySelector('button[type="submit"]');
  button.disabled = true; button.classList.add('is-loading'); button.textContent = 'Scheduling…';
  setTaskNotice('');
  try {
    await createTask({ lead_id: lead.id, title: scheduleTaskForm.elements.title.value.trim(), due_date: scheduleTaskForm.elements.due_date.value });
    scheduleTaskForm.elements.title.value = 'Follow up with ' + lead.name;
    scheduleTaskForm.elements.due_date.value = addDays(todayLocalDate(), 1);
    await loadFollowupTasks();
    await refreshAttentionBadge();
    setTaskNotice('Follow-up scheduled.', 'success');
  } catch (error) { setTaskNotice(error?.message || 'Follow-up could not be scheduled.', 'error'); }
  finally { button.disabled = false; button.classList.remove('is-loading'); button.textContent = 'Schedule follow-up'; }
});
document.querySelectorAll('[data-nav=leads]').forEach((item) => item.setAttribute('aria-current', 'page'));

const { data: { session }, error: sessionError } = await supabase.auth.getSession();
if (sessionError || !session) location.replace('./login.html');
else {
  app.hidden = false;
  document.querySelector('#account-email').textContent = session.user.email || '';
  await loadDetail();
}

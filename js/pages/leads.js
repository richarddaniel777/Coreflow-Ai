import { supabase } from '../api/supabase.js';
import { createLead, deleteLead, getLead, getLeads, updateLead } from '../api/leads.js';
import { loadBusinessProfile, subscribeToBusinessProfile } from '../api/businessProfile.js';
import { getActivitiesForLeads } from '../api/activities.js';
import { makeElement, renderLeadTable, showPageState } from '../ui/leads.js';
import { getLeadStatuses } from '../lib/leadStatus.js';
import { initCsvImport } from './csvImport.js';
import { refreshAttentionBadge } from '../ui/navigation.js';
import { scoreLead } from '../api/ai.js';
import { isProfileComplete } from '../lib/businessProfile.js';
import { LEAD_SOURCES, PREFERRED_CHANNELS, LEAD_STAGES, stageRequiresLostReason } from '../lib/constants.js';

const app = document.querySelector('#app');
const listContainer = document.querySelector('#lead-list');
const stateContainer = document.querySelector('#list-state');
const form = document.querySelector('#lead-form');
const dialog = document.querySelector('#lead-dialog');
const notice = document.querySelector('#page-notice');
const search = document.querySelector('#lead-search');
const stageFilter = document.querySelector('#stage-filter');
const sourceFilter = document.querySelector('#source-filter');
const statusFilter = document.querySelector('#status-filter');
const sortFilter = document.querySelector('#sort-filter');
const priorityFilter = document.querySelector('#priority-filter');
const scoreSort = document.querySelector('#sort-score');
const resetButton = document.querySelector('#reset-filters');
const activeFilterCount = document.querySelector('#active-filter-count');
const emptyContactWarning = document.querySelector('#contact-warning');
const lostReasonField = document.querySelector('#lost-reason-field');
let leads = [];
let profile = null;
let profileLoaded = false;
let activityMap = new Map();
let editingLead = null;
let cancelScoring = false;
let retryCandidates = [];

function populateSelect(select, options, placeholder) {
  select.replaceChildren();
  if (placeholder !== undefined) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = placeholder;
    select.append(option);
  }
  options.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  });
}
populateSelect(stageFilter, LEAD_STAGES, 'All stages');
populateSelect(sourceFilter, LEAD_SOURCES, 'All sources');
populateSelect(form.elements.stage, LEAD_STAGES);
populateSelect(form.elements.source, LEAD_SOURCES);
populateSelect(form.elements.preferred_channel, PREFERRED_CHANNELS, 'Not specified');

function setNotice(text, kind = '') {
  notice.textContent = text || '';
  notice.dataset.kind = kind;
}
function errorText(error) {
  return error?.message || 'Something went wrong. Please try again.';
}

async function loadLeads() {
  listContainer.replaceChildren();
  showPageState(stateContainer, 'loading', 'Loading your leads…');
  const profileState = document.querySelector('#leads-profile-state');
  profileState.textContent = 'Loading business profile…';
  profileState.dataset.kind = 'loading';
  try {
    const [leadsResult, profileResult] = await Promise.allSettled([
      getLeads(),
      loadBusinessProfile({ forceRefresh: true, source: 'leads' }),
    ]);
    if (profileResult.status === 'fulfilled') {
      profile = profileResult.value;
      profileLoaded = true;
      profileState.textContent = '';
      profileState.dataset.kind = '';
      document.querySelector('#leads-profile-banner').hidden = isProfileComplete(profile);
    } else {
      profile = null;
      profileLoaded = false;
      document.querySelector('#leads-profile-banner').hidden = true;
      profileState.textContent = profileResult.reason?.message || 'Business profile could not be loaded. Try again.';
      profileState.dataset.kind = 'error';
    }
    if (leadsResult.status === 'rejected') throw leadsResult.reason;
    leads = leadsResult.value;
    document.querySelectorAll('[data-currency-label]').forEach((label) => { label.textContent = profile?.currency || 'USD'; });
    const activities = await getActivitiesForLeads(leads.map((lead) => lead.id));
    activityMap = new Map();
    activities.forEach((activity) => {
      const list = activityMap.get(activity.lead_id) || [];
      list.push(activity);
      activityMap.set(activity.lead_id, list);
    });
    stateContainer.replaceChildren();
    applyFilters();
  } catch (error) {
    showPageState(stateContainer, 'error', errorText(error));
    const retry = makeElement('button', 'ui-button ui-button--secondary retry-button', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', loadLeads);
    stateContainer.append(retry);
  }
}
function applyFilters() {
  const activeCount = [search.value.trim(), stageFilter.value, sourceFilter.value, statusFilter.value, priorityFilter.value].filter(Boolean).length;
  const hasActiveControls = activeCount > 0 || Boolean(sortFilter.value) || Boolean(scoreSort.value);
  activeFilterCount.textContent = activeCount === 0 ? 'No active filters' : activeCount + (activeCount === 1 ? ' active filter' : ' active filters');
  resetButton.disabled = !hasActiveControls;
  resetButton.hidden = !hasActiveControls;
  const query = search.value.trim().toLowerCase();
  let filtered = leads.filter((lead) => {
    const matchesQuery = !query || [lead.name, lead.company, lead.phone, lead.email]
      .some((value) => String(value || '').toLowerCase().includes(query));
    const matchesStage = !stageFilter.value || lead.stage === stageFilter.value;
    const matchesSource = !sourceFilter.value || lead.source === sourceFilter.value;
    const activities = activityMap.get(lead.id) || [];
    const leadStatuses = getLeadStatuses(lead, activities, profile?.quiet_after_days ?? 5);
    const statuses = { needs_reply: leadStatuses.needsReply, gone_quiet: leadStatuses.goneQuiet };
    const matchesStatus = !statusFilter.value || statuses[statusFilter.value];
    const priority = lead.ai_analysis?.priority || '';
    const matchesPriority = !priorityFilter.value || (priorityFilter.value === 'unscored' ? lead.ai_score == null : priority === priorityFilter.value);
    return matchesQuery && matchesStage && matchesSource && matchesStatus && matchesPriority;
  });
  if (sortFilter.value === 'deal_value') filtered = filtered.slice().sort((a, b) => Number(b.deal_value || 0) - Number(a.deal_value || 0));
  else filtered = filtered.slice().sort((a, b) => new Date(b.last_activity_at || b.created_at).getTime() - new Date(a.last_activity_at || a.created_at).getTime());
  if (scoreSort.value === 'score_desc') filtered = filtered.slice().sort((a, b) => (b.ai_score ?? -1) - (a.ai_score ?? -1));
  if (scoreSort.value === 'score_asc') filtered = filtered.slice().sort((a, b) => (a.ai_score ?? 101) - (b.ai_score ?? 101));

  document.querySelector('#lead-count').textContent = String(filtered.length) + (filtered.length === 1 ? ' lead' : ' leads');
  if (!leads.length) {
    showPageState(stateContainer, 'empty', 'Keep every enquiry in view by adding your first lead.');
    listContainer.replaceChildren();
    return;
  }
  if (!filtered.length) {
    const empty = makeElement('div', 'ui-empty');
    empty.append(makeElement('div', 'ui-empty__icon', '⌕'));
    empty.append(makeElement('h3', '', 'No leads match your filters'));
    empty.append(makeElement('p', '', 'Try changing your search or filters, or reset to the full list.'));
    const resetEmpty = makeElement('button', 'ui-button ui-button--secondary', 'Reset filters');
    resetEmpty.type = 'button';
    resetEmpty.addEventListener('click', resetFilters);
    empty.append(resetEmpty);
    stateContainer.replaceChildren(empty);
    listContainer.replaceChildren();
    return;
  }
  stateContainer.replaceChildren();
  renderLeadTable(listContainer, filtered, activityMap, profile || { currency: 'USD', quiet_after_days: 5 });
}

subscribeToBusinessProfile(({ profile: updatedProfile, error: profileError }) => {
  const profileState = document.querySelector('#leads-profile-state');
  const banner = document.querySelector('#leads-profile-banner');
  if (profileError || !updatedProfile) {
    profile = null;
    profileLoaded = false;
    banner.hidden = true;
    profileState.textContent = profileError?.message || 'Business profile could not be loaded. Try again.';
    profileState.dataset.kind = 'error';
    return;
  }
  profile = updatedProfile;
  profileLoaded = true;
  profileState.textContent = '';
  profileState.dataset.kind = '';
  banner.hidden = isProfileComplete(profile);
  document.querySelectorAll('[data-currency-label]').forEach((label) => { label.textContent = profile.currency || 'USD'; });
  applyFilters();
});
function resetFilters() {
  search.value = '';
  stageFilter.value = '';
  sourceFilter.value = '';
  statusFilter.value = '';
  sortFilter.value = '';
  priorityFilter.value = '';
  scoreSort.value = '';
  applyFilters();
  search.focus();
}
resetButton.addEventListener('click', resetFilters);

[search, stageFilter, sourceFilter, statusFilter, sortFilter, priorityFilter, scoreSort].forEach((control) => {
  control.addEventListener(control === search ? 'input' : 'change', applyFilters);
});

async function runScoreBatch(candidates) {
  const button = document.querySelector('#score-all-button');
  const retryButton = document.querySelector('#retry-skipped-button');
  const progress = document.querySelector('#score-all-progress');
  const skippedNode = document.querySelector('#score-all-skipped');
  const cancelButton = document.querySelector('#cancel-score-all');
  if (!candidates.length) { progress.textContent = 'Every lead already has a score.'; return; }
  if (!profileLoaded || !profile) {
    progress.textContent = 'Business profile could not be loaded. Retry loading the Leads page before scoring.';
    return;
  }
  if (!isProfileComplete(profile)) {
    progress.textContent = 'Add at least 10 non-whitespace characters to products/services in Settings before scoring.';
    if (window.confirm('Complete your business profile in Settings before scoring leads. Open Settings now?')) location.href = './index.html#settings';
    return;
  }
  cancelScoring = false;
  retryCandidates = [];
  skippedNode.hidden = true;
  skippedNode.textContent = '';
  button.disabled = true; button.classList.add('is-loading');
  retryButton.disabled = true;
  cancelButton.hidden = false;
  cancelButton.disabled = false;
  progress.textContent = `Scoring 0 of ${candidates.length}…`;
  const minimumStartGapMs = 8000;
  const retryWaitMs = 30_000;
  let previousRequestStartedAt = 0;
  let cancelled = false;
  let completedThisRun = 0;
  let consecutiveFailures = 0;
  let stoppedAfterFailures = false;
  const skipped = [];
  const renderSkipped = () => {
    retryCandidates = skipped.map((item) => item.lead);
    skippedNode.hidden = skipped.length === 0;
    skippedNode.textContent = skipped.length
      ? `Skipped ${skipped.length}: ${skipped.map((item) => `${item.lead.name} (${item.reason})`).join('; ')}`
      : '';
    retryButton.hidden = skipped.length === 0;
  };
  try {
    for (let index = 0; index < candidates.length; index++) {
      if (cancelScoring) { cancelled = true; break; }
      while (previousRequestStartedAt && Date.now() - previousRequestStartedAt < minimumStartGapMs) {
        if (cancelScoring) { cancelled = true; break; }
        const secondsRemaining = Math.ceil((minimumStartGapMs - (Date.now() - previousRequestStartedAt)) / 1000);
        progress.textContent = `Scored ${completedThisRun} of ${candidates.length}. Next lead in ${secondsRemaining}s. Skipped: ${skipped.length}. You can cancel.`;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (cancelScoring) { cancelled = true; break; }
      progress.textContent = `Scoring ${index + 1} of ${candidates.length}: ${candidates[index].name}`;
      previousRequestStartedAt = Date.now();
      try {
        await scoreLead(candidates[index].id);
        completedThisRun++;
        consecutiveFailures = 0;
      } catch (scoreError) {
        const reason = scoreError.providerReason || scoreError.message || 'request failed';
        skipped.push({ lead: candidates[index], reason });
        consecutiveFailures++;
        renderSkipped();
        if (consecutiveFailures >= 3) {
          stoppedAfterFailures = true;
          break;
        }
        const shouldWait = scoreError.providerReason === 'OVERLOADED' || scoreError.providerReason === 'RATE_LIMITED';
        if (shouldWait && index < candidates.length - 1) {
          const waitUntil = Date.now() + retryWaitMs;
          while (Date.now() < waitUntil) {
            if (cancelScoring) { cancelled = true; break; }
            const secondsRemaining = Math.ceil((waitUntil - Date.now()) / 1000);
            progress.textContent = `${scoreError.providerReason === 'OVERLOADED' ? 'AI overloaded' : 'Rate limited'}; next lead in ${secondsRemaining}s. Completed ${completedThisRun} of ${candidates.length}.`;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          if (cancelled) break;
        }
      }
    }
    await loadLeads();
    const summary = `Completed ${completedThisRun} of ${candidates.length}. Skipped ${skipped.length}${stoppedAfterFailures ? ' and stopped after 3 consecutive failures' : ''}${cancelled ? ' (cancelled)' : ''}.`;
    progress.textContent = summary;
    renderSkipped();
    if (skipped.length) setNotice(summary, 'error');
  } catch (error) {
    const text = `Scoring stopped: ${error?.message || 'request failed'}`;
    progress.textContent = text;
    setNotice(text, 'error');
    await loadLeads();
  } finally {
    button.disabled = false; button.classList.remove('is-loading'); retryButton.disabled = false; cancelButton.hidden = true;
  }
}

document.querySelector('#score-all-button').addEventListener('click', () => {
  runScoreBatch(leads.filter((lead) => lead.ai_score == null));
});
document.querySelector('#retry-skipped-button').addEventListener('click', () => {
  runScoreBatch(retryCandidates);
});
document.querySelector('#cancel-score-all').addEventListener('click', (event) => {
  cancelScoring = true;
  event.currentTarget.disabled = true;
});

function refreshContactWarning() {
  const hasContact = ['phone', 'email', 'social_handle'].some((name) => form.elements[name].value.trim());
  emptyContactWarning.hidden = hasContact;
}
function updateLostReason() {
  const isLost = stageRequiresLostReason(form.elements.stage.value);
  lostReasonField.hidden = !isLost;
  form.elements.lost_reason.required = isLost;
}
function openEditor(lead = null) {
  editingLead = lead;
  form.reset();
  form.elements.source.value = 'other';
  form.elements.stage.value = 'new';
  form.elements.deal_value.value = '0';
  document.querySelector('#lead-dialog-title').textContent = lead ? 'Edit lead' : 'Add a lead';
  Object.entries({
    name: lead?.name, company: lead?.company, phone: lead?.phone, email: lead?.email,
    social_handle: lead?.social_handle, source: lead?.source || 'other', preferred_channel: lead?.preferred_channel,
    interest: lead?.interest, needs: lead?.needs, budget: lead?.budget, stage: lead?.stage,
    deal_value: lead?.deal_value, expected_close_date: lead?.expected_close_date,
    lost_reason: lead?.lost_reason, notes: lead?.notes,
  }).forEach(([name, value]) => { form.elements[name].value = value ?? ''; });
  refreshContactWarning();
  updateLostReason();
  dialog.showModal();
  form.elements.name.focus();
}
document.querySelector('#add-lead-button').addEventListener('click', () => openEditor());
document.querySelector('#cancel-lead').addEventListener('click', () => dialog.close());
form.elements.stage.addEventListener('change', updateLostReason);
['phone', 'email', 'social_handle'].forEach((name) => form.elements[name].addEventListener('input', refreshContactWarning));
document.querySelector('#contact-warning-close').addEventListener('click', () => { emptyContactWarning.hidden = true; });
document.querySelector('#cancel-lead-footer').addEventListener('click', () => dialog.close());

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const values = {
    name: form.elements.name.value.trim(),
    company: form.elements.company.value.trim() || null,
    phone: form.elements.phone.value.trim() || null,
    email: form.elements.email.value.trim() || null,
    social_handle: form.elements.social_handle.value.trim() || null,
    source: form.elements.source.value,
    preferred_channel: form.elements.preferred_channel.value || null,
    interest: form.elements.interest.value.trim() || null,
    needs: form.elements.needs.value.trim() || null,
    budget: form.elements.budget.value === '' ? null : Number(form.elements.budget.value),
    stage: form.elements.stage.value,
    deal_value: form.elements.deal_value.value === '' ? 0 : Number(form.elements.deal_value.value),
    expected_close_date: form.elements.expected_close_date.value || null,
    lost_reason: form.elements.lost_reason.value.trim() || null,
    notes: form.elements.notes.value.trim() || null,
  };
  const save = document.querySelector('#save-lead');
  save.disabled = true;
  save.classList.add('is-loading');
  save.textContent = editingLead ? 'Saving…' : 'Creating…';
  setNotice('');
  try {
    if (editingLead) await updateLead(editingLead.id, values, editingLead.stage);
    else await createLead(values);
    dialog.close();
    setNotice(editingLead ? 'Lead updated.' : 'Lead created.', 'success');
    await loadLeads();
    const editId = new URLSearchParams(location.search).get('edit');
    if (editId) history.replaceState(null, '', './leads.html');
  } catch (error) {
    setNotice(errorText(error), 'error');
  } finally {
    save.disabled = false;
    save.classList.remove('is-loading');
    save.textContent = 'Save lead';
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
document.querySelectorAll('[data-nav=leads]').forEach((item) => item.setAttribute('aria-current', 'page'));

initCsvImport({
  button: document.querySelector('#import-csv-button'),
  dialog: document.querySelector('#csv-import-dialog'),
  content: document.querySelector('#csv-import-content'),
  onImported: loadLeads,
});

const { data: { session }, error: sessionError } = await supabase.auth.getSession();
if (sessionError || !session) location.replace('./login.html');
else {
  app.hidden = false;
  document.querySelector('#account-email').textContent = session.user.email || '';
  await Promise.all([loadLeads(), refreshAttentionBadge()]);
  const editId = new URLSearchParams(location.search).get('edit');
  if (editId) {
    try {
      const lead = await getLead(editId);
      if (lead) openEditor(lead);
    } catch (error) { setNotice(errorText(error), 'error'); }
  }
}

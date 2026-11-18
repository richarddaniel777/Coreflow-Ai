import { supabase } from '../api/supabase.js';
import { createLead, deleteLead, getLead, getLeadsPage, getUnscoredLeadCandidates, updateLead } from '../api/leads.js';
import { loadBusinessProfile, subscribeToBusinessProfile } from '../api/businessProfile.js';
import { getLeadActivitySummary } from '../api/dashboard.js';
import { makeElement, renderLeadTable, showPageState } from '../ui/leads.js';
import { initCsvImport } from './csvImport.js';
import { initAppNavigation, refreshAttentionBadge } from '../ui/navigation.js';
import { scoreLead } from '../api/ai.js';
import { isProfileComplete } from '../lib/businessProfile.js';
import { LEAD_SOURCES, PREFERRED_CHANNELS, LEAD_STAGES, stageRequiresLostReason } from '../lib/constants.js';
import { redirectToLogin } from '../lib/authRedirect.js';

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
const pagination = document.querySelector('#lead-pagination');
const listViewStorageKey = 'coreflow-leads-list-view';
let currentPage = 1;
let pageSize = 50;
let totalCount = 0;
let pendingScrollRestore = null;

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

function currentFilterValues() {
  return {
    search: search.value.trim(), stage: stageFilter.value, source: sourceFilter.value,
    status: statusFilter.value, priority: priorityFilter.value, sort: sortFilter.value, scoreSort: scoreSort.value,
  };
}

function saveListView() {
  const wrapper = listContainer.querySelector('.ui-table-wrap');
  const state = {
    ...currentFilterValues(), page: currentPage, pageSize,
    mainScrollTop: document.querySelector('.main-content')?.scrollTop || 0, listScrollTop: wrapper?.scrollTop || 0,
  };
  try { sessionStorage.setItem(listViewStorageKey, JSON.stringify(state)); } catch { /* The list still works without session storage. */ }
}

function restoreListView() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(listViewStorageKey) || 'null');
    if (!saved) return;
    search.value = saved.search || '';
    stageFilter.value = saved.stage || '';
    sourceFilter.value = saved.source || '';
    statusFilter.value = saved.status || '';
    priorityFilter.value = saved.priority || '';
    sortFilter.value = saved.sort || '';
    scoreSort.value = saved.scoreSort || '';
    currentPage = Math.max(1, Number(saved.page) || 1);
    pageSize = [25, 50, 100].includes(Number(saved.pageSize)) ? Number(saved.pageSize) : 50;
    pendingScrollRestore = { mainScrollTop: Number(saved.mainScrollTop) || 0, listScrollTop: Number(saved.listScrollTop) || 0 };
  } catch { /* Ignore malformed or unavailable saved list state. */ }
}

function resetFilters() {
  search.value = '';
  stageFilter.value = '';
  sourceFilter.value = '';
  statusFilter.value = '';
  sortFilter.value = '';
  priorityFilter.value = '';
  scoreSort.value = '';
  currentPage = 1;
  saveListView();
  loadLeads();
  search.focus();
}

function renderPagination(pageCount, count) {
  pagination.replaceChildren();
  if (!count) return;
  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, count);
  const label = makeElement('span', 'pagination-summary', `Showing ${from} to ${to} of ${count}`);
  label.setAttribute('aria-live', 'polite');
  const controls = makeElement('div', 'pagination-controls');
  const addButton = (text, page, disabled = false, current = false) => {
    const button = makeElement('button', 'ui-button ui-button--secondary pagination-button', text);
    button.type = 'button';
    button.disabled = disabled;
    button.setAttribute('aria-label', current ? `Page ${page}, current page` : text === 'Previous' || text === 'Next' ? text + ' page' : `Go to page ${page}`);
    if (current) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => { currentPage = page; saveListView(); loadLeads(); });
    controls.append(button);
  };
  addButton('Previous', Math.max(1, currentPage - 1), currentPage <= 1);
  let pages = [];
  if (pageCount <= 7) pages = Array.from({ length: pageCount }, (_v, i) => i + 1);
  else {
    pages = [1];
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(pageCount - 1, currentPage + 1);
    if (start > 2) pages.push('…');
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < pageCount - 1) pages.push('…');
    pages.push(pageCount);
  }
  pages.forEach((page) => {
    if (page === '…') controls.append(makeElement('span', 'pagination-ellipsis', '…'));
    else addButton(String(page), page, false, page === currentPage);
  });
  addButton('Next', Math.min(pageCount, currentPage + 1), currentPage >= pageCount);

  const sizeLabel = document.createElement('label');
  sizeLabel.className = 'pagination-size-label';
  sizeLabel.textContent = 'Rows per page';
  const size = document.createElement('select');
  size.className = 'ui-select pagination-size';
  size.setAttribute('aria-label', 'Rows per page');
  [25, 50, 100].forEach((value) => {
    const option = document.createElement('option');
    option.value = String(value); option.textContent = String(value); option.selected = value === pageSize;
    size.append(option);
  });
  size.addEventListener('change', () => { pageSize = Number(size.value); currentPage = 1; saveListView(); loadLeads(); });
  sizeLabel.append(size);
  pagination.append(label, controls, sizeLabel);
}

async function loadLeads() {
  listContainer.replaceChildren();
  pagination.replaceChildren();
  showPageState(stateContainer, 'loading', 'Loading your leads…');
  const profileState = document.querySelector('#leads-profile-state');
  if (!profileLoaded) {
    profileState.textContent = 'Loading business profile…';
    profileState.dataset.kind = 'loading';
  }
  try {
    if (!profileLoaded) {
      try {
        profile = await loadBusinessProfile({ source: 'leads' });
        profileLoaded = true;
        profileState.textContent = '';
        profileState.dataset.kind = '';
        document.querySelector('#leads-profile-banner').hidden = isProfileComplete(profile);
      } catch (profileError) {
        profile = null;
        profileState.textContent = profileError?.message || 'Business profile could not be loaded. Try again.';
        profileState.dataset.kind = 'error';
      }
    }
    const result = await getLeadsPage({ page: currentPage, pageSize, ...currentFilterValues(), quietAfterDays: profile?.quiet_after_days ?? 5 });
    totalCount = result.count;
    const pageCount = Math.ceil(totalCount / pageSize);
    if (pageCount > 0 && currentPage > pageCount) {
      currentPage = pageCount;
      return await loadLeads();
    }
    leads = result.data;
    document.querySelectorAll('[data-currency-label]').forEach((label) => { label.textContent = profile?.currency || 'USD'; });
    const summaries = await getLeadActivitySummary(leads.map((lead) => lead.id));
    activityMap = new Map();
    summaries.forEach((summary) => {
      const latest = [];
      if (summary.last_real_activity_at) latest.push({ type: 'call', occurred_at: summary.last_real_activity_at });
      if (summary.last_direction) latest.push({ type: 'message', direction: summary.last_direction, occurred_at: summary.last_directional_at });
      activityMap.set(summary.lead_id, latest);
    });
    stateContainer.replaceChildren();
    const activeCount = Object.values(currentFilterValues()).filter(Boolean).length;
    activeFilterCount.textContent = activeCount ? `${activeCount} active ${activeCount === 1 ? 'filter' : 'filters'}` : 'No active filters';
    const active = activeCount > 0;
    resetButton.disabled = !active;
    resetButton.hidden = !active;
    document.querySelector('#lead-count').textContent = `${totalCount} ${totalCount === 1 ? 'lead' : 'leads'}`;
    if (!totalCount) {
      if (active) {
        const empty = makeElement('div', 'ui-empty');
        empty.append(makeElement('div', 'ui-empty__icon', '⌕'), makeElement('h3', '', 'No leads match your filters'), makeElement('p', '', 'Try changing your search or filters, or reset to the full list.'));
        const reset = makeElement('button', 'ui-button ui-button--secondary', 'Reset filters');
        reset.type = 'button'; reset.addEventListener('click', resetFilters); empty.append(reset); stateContainer.append(empty);
      } else showPageState(stateContainer, 'empty', 'Keep every enquiry in view by adding your first lead.');
      return;
    }
    renderLeadTable(listContainer, leads, activityMap, profile || { currency: 'USD', quiet_after_days: 5 });
    renderPagination(pageCount, totalCount);
    if (pendingScrollRestore) {
      const main = document.querySelector('.main-content');
      if (main) main.scrollTop = pendingScrollRestore.mainScrollTop;
      const wrapper = listContainer.querySelector('.ui-table-wrap');
      if (wrapper) wrapper.scrollTop = pendingScrollRestore.listScrollTop;
      pendingScrollRestore = null;
    }
    saveListView();
  } catch (error) {
    showPageState(stateContainer, 'error', errorText(error));
    const retry = makeElement('button', 'ui-button ui-button--secondary retry-button', 'Try again');
    retry.type = 'button'; retry.addEventListener('click', loadLeads); stateContainer.append(retry);
  }
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
resetButton.addEventListener('click', resetFilters);

let searchTimer = 0;
search.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => { currentPage = 1; saveListView(); loadLeads(); }, 300);
});
[stageFilter, sourceFilter, statusFilter, sortFilter, priorityFilter, scoreSort].forEach((control) => control.addEventListener('change', () => { currentPage = 1; saveListView(); loadLeads(); }));
listContainer.addEventListener('click', (event) => {
  if (event.target.closest('.lead-name-link')) saveListView();
});
restoreListView();

function applyFilters() {
  currentPage = 1;
  saveListView();
  loadLeads();
}

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

document.querySelector('#score-all-button').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  document.querySelector('#score-all-progress').textContent = 'Loading unscored leads…';
  try {
    await runScoreBatch(await getUnscoredLeadCandidates());
  } catch (error) {
    document.querySelector('#score-all-progress').textContent = `Could not load unscored leads: ${errorText(error)}`;
  } finally {
    button.disabled = false;
  }
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
    else { await createLead(values); currentPage = 1; }
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

initCsvImport({
  button: document.querySelector('#import-csv-button'),
  dialog: document.querySelector('#csv-import-dialog'),
  content: document.querySelector('#csv-import-content'),
  onImported: loadLeads,
});

const { data: { session }, error: sessionError } = await supabase.auth.getSession();
if (sessionError || !session) redirectToLogin('Your session expired, please log in again.');
else {
  app.hidden = false;
  initAppNavigation(session.user.email || '');
  await Promise.all([loadLeads(), refreshAttentionBadge()]);
  const editId = new URLSearchParams(location.search).get('edit');
  if (editId) {
    try {
      const lead = await getLead(editId);
      if (lead) openEditor(lead);
    } catch (error) { setNotice(errorText(error), 'error'); }
  }
}

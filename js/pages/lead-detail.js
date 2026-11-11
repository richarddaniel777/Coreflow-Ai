import { supabase } from '../api/supabase.js';
import { deleteLead, getLead, updateLead } from '../api/leads.js';
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
import { draftMessage } from '../api/messageWriter.js';
import { ACTIVITY_CHANNELS } from '../lib/constants.js';

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
let draftFormInitialized = false;
let messageWriterState = null;
let messageNoticeTimer = null;

const messageTypes = [
  { value: 'enquiry_reply', label: 'Reply to an enquiry' },
  { value: 'sales_message', label: 'First sales message' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'quotation_draft', label: 'Quotation draft' },
  { value: 're_engage_quiet_lead', label: 'Re-engage a quiet lead' },
  { value: 'closing_nudge', label: 'Decision nudge' },
];
const draftForm = document.querySelector('#message-writer-form');
const draftResult = document.querySelector('#draft-message-result');
const draftError = document.querySelector('#draft-message-error');
const draftSentNotice = document.querySelector('#draft-sent-notice');

function populateDraftOptions() {
  for (const item of messageTypes) addOption(draftForm.elements.message_type, item.value, item.label);
  ACTIVITY_CHANNELS.forEach(({ value, label }) => addOption(draftForm.elements.channel, value, label));
}
function defaultDraftChannel() {
  const allowed = new Set(ACTIVITY_CHANNELS.map(({ value }) => value));
  if (lead?.preferred_channel && allowed.has(lead.preferred_channel)) return lead.preferred_channel;
  if (lead?.source && allowed.has(lead.source)) return lead.source;
  return lead?.email ? 'email' : 'phone';
}
function createMessageWriterState(targetLead) {
  return {
    leadId: targetLead?.id || null,
    messageType: messageTypes[0].value,
    channel: defaultDraftChannel(),
    extraInstructions: '',
    hasDraft: false,
    subject: '',
    body: '',
    talkingPoints: [],
    objections: [],
    missingFacts: [],
    personalizationNotes: '',
    placeholdersConfirmed: false,
    dirty: false,
    baseline: '',
    loading: false,
    sending: false,
    retryGeneration: false,
    retryMarkSent: false,
    error: '',
    errorKind: '',
    notice: '',
    noticeKind: '',
  };
}
function currentDraftText(state = messageWriterState) {
  if (!state) return '';
  if (['phone', 'in_person'].includes(state.channel)) {
    const points = state.talkingPoints.map((point) => point.trim()).filter(Boolean);
    const objections = state.objections.filter((row) => row.objection.trim() || row.suggested_answer.trim())
      .map((row) => 'Objection: ' + row.objection.trim() + '\nSuggested answer: ' + row.suggested_answer.trim());
    return [...points, ...objections].join('\n\n');
  }
  const subject = state.subject.trim();
  const body = state.body.trim();
  return [subject ? 'Subject: ' + subject : '', body].filter(Boolean).join('\n\n');
}
function currentDraftSnapshot(state = messageWriterState) {
  return JSON.stringify({
    subject: state?.subject || '',
    body: state?.body || '',
    talkingPoints: state?.talkingPoints || [],
    objections: state?.objections || [],
  });
}
function computedPlaceholders(state = messageWriterState) {
  if (!state) return [];
  return [...new Set([state.subject, state.body].flatMap((text) =>
    [...text.matchAll(/\[CONFIRM[^\]]*\]/g)].map((match) => match[0])))];
}
function updateMessageWriterDirty() {
  if (!messageWriterState?.hasDraft) return;
  const pendingPlaceholderValue = [...document.querySelectorAll('#draft-placeholder-list input[data-placeholder]')]
    .some((input) => input.value.trim());
  messageWriterState.dirty = currentDraftSnapshot() !== messageWriterState.baseline || pendingPlaceholderValue;
}
function setDraftMessage(text, kind = '') {
  if (!messageWriterState) return;
  messageWriterState.error = text || '';
  messageWriterState.errorKind = kind;
  renderMessageWriter();
}
function appendHighlightedText(container, text) {
  const matches = [...text.matchAll(/\[CONFIRM[^\]]*\]/g)];
  let offset = 0;
  for (const match of matches) {
    container.append(document.createTextNode(text.slice(offset, match.index)));
    const mark = document.createElement('mark');
    mark.textContent = match[0];
    container.append(mark);
    offset = match.index + match[0].length;
  }
  container.append(document.createTextNode(text.slice(offset)));
}
function renderPlaceholderInputs() {
  const state = messageWriterState;
  const container = document.querySelector('#draft-placeholder-list');
  const placeholders = computedPlaceholders(state);
  const oldInputs = [...container.querySelectorAll('input[data-placeholder]')];
  const oldTokens = oldInputs.map((input) => input.dataset.placeholder);
  container.hidden = placeholders.length === 0;
  if (JSON.stringify(oldTokens) !== JSON.stringify(placeholders)) {
    if (oldTokens.length && state.placeholdersConfirmed) state.placeholdersConfirmed = false;
    container.replaceChildren();
    if (placeholders.length) {
      const heading = document.createElement('h3');
      heading.textContent = 'Placeholders to complete';
      container.append(heading);
      const warning = document.createElement('p');
      warning.className = 'message-writer__placeholder-warning';
      warning.setAttribute('role', 'status');
      warning.textContent = 'Complete these details in the text, or confirm that you have checked and completed them.';
      container.append(warning);
      placeholders.forEach((placeholder, index) => {
        const field = document.createElement('div');
        field.className = 'ui-field';
        const label = document.createElement('label');
        label.className = 'ui-label';
        label.htmlFor = 'draft-placeholder-' + index;
        label.textContent = placeholder;
        const input = document.createElement('input');
        input.className = 'ui-input';
        input.type = 'text';
        input.id = label.htmlFor;
        input.dataset.placeholder = placeholder;
        input.autocomplete = 'off';
        input.placeholder = 'Enter replacement';
        input.addEventListener('input', () => {
          updateMessageWriterDirty();
          renderMessageWriter();
        });
        input.addEventListener('change', () => {
          const replacement = input.value;
          if (!replacement.trim()) return;
          state.subject = state.subject.split(placeholder).join(replacement);
          state.body = state.body.split(placeholder).join(replacement);
          state.placeholdersConfirmed = false;
          updateMessageWriterDirty();
          renderMessageWriter();
        });
        field.append(label, input);
        container.append(field);
      });
    }
  }
  if (!placeholders.length) state.placeholdersConfirmed = false;
  return placeholders;
}
function renderTalkingPoints() {
  const state = messageWriterState;
  const list = document.querySelector('#draft-talking-points');
  let rows = [...list.querySelectorAll('.draft-point-row')];
  if (rows.length !== state.talkingPoints.length) {
    list.replaceChildren();
    rows = state.talkingPoints.map((_point, index) => {
      const row = document.createElement('div');
      row.className = 'draft-point-row';
      const input = document.createElement('input');
      input.className = 'ui-input';
      input.type = 'text';
      input.maxLength = 700;
      input.dataset.talkingPoint = String(index);
      input.setAttribute('aria-label', 'Talking point ' + (index + 1));
      input.addEventListener('input', () => {
        state.talkingPoints[index] = input.value;
        updateMessageWriterDirty();
        renderMessageWriter();
      });
      const remove = document.createElement('button');
      remove.className = 'ui-button ui-button--ghost';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove talking point ' + (index + 1));
      remove.addEventListener('click', () => {
        state.talkingPoints.splice(index, 1);
        updateMessageWriterDirty();
        renderMessageWriter();
      });
      row.append(input, remove);
      list.append(row);
      return row;
    });
  }
  rows.forEach((row, index) => {
    const input = row.querySelector('input[data-talking-point]');
    if (input.value !== state.talkingPoints[index]) input.value = state.talkingPoints[index];
  });
}
function renderObjections() {
  const state = messageWriterState;
  const list = document.querySelector('#draft-objections');
  let rows = [...list.querySelectorAll('.draft-objection-row')];
  if (rows.length !== state.objections.length) {
    list.replaceChildren();
    rows = state.objections.map((_objection, index) => {
      const row = document.createElement('div');
      row.className = 'draft-objection-row';
      const objectionInput = document.createElement('input');
      objectionInput.className = 'ui-input';
      objectionInput.type = 'text';
      objectionInput.maxLength = 500;
      objectionInput.dataset.objection = String(index);
      objectionInput.setAttribute('aria-label', 'Likely objection ' + (index + 1));
      objectionInput.addEventListener('input', () => {
        state.objections[index].objection = objectionInput.value;
        updateMessageWriterDirty();
        renderMessageWriter();
      });
      const answerInput = document.createElement('input');
      answerInput.className = 'ui-input';
      answerInput.type = 'text';
      answerInput.maxLength = 800;
      answerInput.dataset.objectionAnswer = String(index);
      answerInput.setAttribute('aria-label', 'Suggested answer ' + (index + 1));
      answerInput.addEventListener('input', () => {
        state.objections[index].suggested_answer = answerInput.value;
        updateMessageWriterDirty();
        renderMessageWriter();
      });
      row.append(objectionInput, answerInput);
      list.append(row);
      return row;
    });
  }
  rows.forEach((row, index) => {
    const objectionInput = row.querySelector('[data-objection]');
    const answerInput = row.querySelector('[data-objection-answer]');
    if (objectionInput.value !== state.objections[index].objection) objectionInput.value = state.objections[index].objection;
    if (answerInput.value !== state.objections[index].suggested_answer) answerInput.value = state.objections[index].suggested_answer;
  });
}
function updateDraftOpenLink() {
  const state = messageWriterState;
  const link = document.querySelector('#open-message-button');
  link.hidden = true;
  link.removeAttribute('href');
  link.onclick = null;
  link.removeAttribute('target');
  link.removeAttribute('rel');
  if (!state?.hasDraft) return;
  const subject = state.subject.trim();
  const body = state.body.trim();
  const content = [subject, body].filter(Boolean).join('\n\n');
  if (state.channel === 'email') {
    link.hidden = false;
    link.textContent = 'Open email app';
    link.href = 'mailto:' + encodeURIComponent(lead.email || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    link.onclick = (event) => {
      if (link.href.length > 1800) {
        event.preventDefault();
        setDraftMessage('This draft is too long for a mailto link. Copy it into your email app instead.', 'error');
      }
    };
  } else if (state.channel === 'whatsapp' && lead.phone) {
    const phone = String(lead.phone).replace(/\D/g, '');
    if (phone) {
      link.hidden = false;
      link.textContent = 'Open WhatsApp';
      link.href = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(content);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  } else if (state.channel === 'phone' && lead.phone) {
    link.hidden = false;
    link.textContent = 'Call';
    link.href = 'tel:' + String(lead.phone).replace(/[^\d+]/g, '');
  }
}
function growDraftBody() {
  const body = document.querySelector('#draft-body');
  body.style.height = 'auto';
  body.style.height = Math.max(body.scrollHeight, 120) + 'px';
}
function renderMessageWriter() {
  const state = messageWriterState;
  if (!state) return;
  const subjectField = document.querySelector('#draft-subject');
  const bodyField = document.querySelector('#draft-body');
  if (subjectField.value !== state.subject) subjectField.value = state.subject;
  if (bodyField.value !== state.body) bodyField.value = state.body;
  if (draftForm.elements.message_type.value !== state.messageType) draftForm.elements.message_type.value = state.messageType;
  if (draftForm.elements.channel.value !== state.channel) draftForm.elements.channel.value = state.channel;
  if (draftForm.elements.extra_instructions.value !== state.extraInstructions) draftForm.elements.extra_instructions.value = state.extraInstructions;
  draftError.textContent = state.error;
  draftError.dataset.kind = state.errorKind || '';
  draftSentNotice.textContent = state.notice;
  draftSentNotice.dataset.kind = state.noticeKind || '';
  draftResult.hidden = !state.hasDraft;
  const isBrief = ['phone', 'in_person'].includes(state.channel);
  document.querySelector('[data-draft-subject-wrap]').hidden = isBrief || !['email', 'website_form', 'other'].includes(state.channel);
  document.querySelector('[data-draft-body-wrap]').hidden = isBrief;
  document.querySelector('[data-draft-talking-wrap]').hidden = !isBrief;
  document.querySelector('[data-draft-objections-wrap]').hidden = !isBrief;
  const missing = document.querySelector('#draft-missing-facts');
  missing.replaceChildren();
  missing.hidden = state.missingFacts.length === 0;
  if (state.missingFacts.length) {
    const heading = document.createElement('strong');
    heading.textContent = 'Confirm before using this draft';
    missing.append(heading);
    const list = document.createElement('ul');
    state.missingFacts.forEach((fact) => {
      const item = document.createElement('li');
      item.textContent = fact;
      list.append(item);
    });
    missing.append(list);
  }
  document.querySelector('#draft-personalization').textContent = state.personalizationNotes
    ? 'Used from your data: ' + state.personalizationNotes : '';
  renderTalkingPoints();
  renderObjections();
  const placeholders = renderPlaceholderInputs();
  const preview = document.querySelector('#draft-preview');
  preview.replaceChildren();
  const draftText = currentDraftText(state);
  if (state.hasDraft && draftText) appendHighlightedText(preview, draftText);
  const checkWrap = document.querySelector('#draft-placeholder-check-wrap');
  const checkbox = document.querySelector('#draft-placeholder-check');
  checkWrap.hidden = placeholders.length === 0;
  checkbox.disabled = false;
  checkbox.checked = state.placeholdersConfirmed;
  document.querySelector('#mark-message-sent-button').disabled = state.sending || state.loading ||
    (placeholders.length > 0 && !state.placeholdersConfirmed);
  document.querySelector('#mark-message-sent-button').textContent = state.sending ? 'Logging…' : 'Mark as sent';
  document.querySelector('#retry-mark-sent-button').hidden = !state.retryMarkSent || state.sending;
  document.querySelector('#retry-mark-sent-button').disabled = state.sending || state.loading || (placeholders.length > 0 && !state.placeholdersConfirmed);
  document.querySelector('#generate-message-button').disabled = state.loading || state.sending;
  document.querySelector('#generate-message-button').textContent = state.loading ? 'Generating…' : state.retryGeneration ? 'Try again' : 'Generate draft';
  document.querySelector('#regenerate-message-button').disabled = state.loading || state.sending || !state.hasDraft;
  document.querySelector('#copy-message-button').disabled = !state.hasDraft || state.sending;
  updateDraftOpenLink();
  growDraftBody();
}
function resetMessageWriter(options = {}) {
  if (messageNoticeTimer) clearTimeout(messageNoticeTimer);
  messageNoticeTimer = null;
  messageWriterState = createMessageWriterState(lead);
  messageWriterState.notice = options.notice || '';
  messageWriterState.noticeKind = options.notice ? 'success' : '';
  document.querySelector('#draft-subject').value = '';
  document.querySelector('#draft-body').value = '';
  document.querySelector('#draft-talking-points').replaceChildren();
  document.querySelector('#draft-objections').replaceChildren();
  document.querySelector('#draft-missing-facts').replaceChildren();
  document.querySelector('#draft-placeholder-list').replaceChildren();
  document.querySelector('#draft-preview').replaceChildren();
  document.querySelector('#draft-placeholder-check').checked = false;
  document.querySelector('#draft-placeholder-check').disabled = false;
  draftForm.elements.extra_instructions.value = '';
  renderMessageWriter();
  if (options.notice) {
    const notice = options.notice;
    const shouldFocus = options.focus !== false;
    messageNoticeTimer = setTimeout(() => {
      if (!messageWriterState || messageWriterState.notice !== notice) return;
      messageWriterState.notice = '';
      messageWriterState.noticeKind = '';
      renderMessageWriter();
      if (shouldFocus && !document.querySelector('#task-compose-dialog').open) {
        document.querySelector('#generate-message-button').focus();
      }
    }, 4000);
  } else if (options.focus) {
    document.querySelector('#generate-message-button').focus();
  }
}
function draftHasEdits() {
  if (!messageWriterState?.hasDraft) return false;
  updateMessageWriterDirty();
  return messageWriterState.dirty;
}
function askReplaceDraft() {
  const dialog = document.querySelector('#draft-replace-dialog');
  dialog.returnValue = '';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'replace'), { once: true });
    dialog.showModal();
  });
}
async function handleWriterOptionChange(key, field) {
  const selectedValue = field.value;
  if (messageWriterState.hasDraft) {
    if (draftHasEdits() && !await askReplaceDraft()) {
      field.value = messageWriterState[key];
      return;
    }
    resetMessageWriter({ focus: false });
    messageWriterState[key] = selectedValue;
    renderMessageWriter();
    return;
  }
  messageWriterState[key] = selectedValue;
  renderMessageWriter();
}
async function generateDraft() {
  const state = messageWriterState;
  if (!lead || !state || state.loading || state.sending) return;
  if (draftHasEdits() && !await askReplaceDraft()) return;
  state.loading = true;
  state.error = '';
  state.errorKind = 'loading';
  state.retryGeneration = false;
  state.notice = '';
  state.noticeKind = '';
  renderMessageWriter();
  const request = {
    leadId: lead.id,
    messageType: state.messageType,
    channel: state.channel,
    extraInstructions: state.extraInstructions,
  };
  try {
    const data = await draftMessage(request);
    if (messageWriterState !== state) return;
    state.messageType = data.message_type;
    state.channel = data.channel;
    state.hasDraft = true;
    state.subject = data.subject || '';
    state.body = data.body || '';
    state.talkingPoints = Array.isArray(data.talking_points) ? data.talking_points.slice() : [];
    state.objections = Array.isArray(data.objections) ? data.objections.map((row) => ({
      objection: row.objection || '',
      suggested_answer: row.suggested_answer || '',
    })) : [];
    state.missingFacts = Array.isArray(data.missing_facts) ? data.missing_facts.slice() : [];
    state.personalizationNotes = data.personalization_notes || '';
    state.placeholdersConfirmed = false;
    document.querySelector('#draft-placeholder-list').replaceChildren();
    state.baseline = currentDraftSnapshot(state);
    state.dirty = false;
    state.error = '';
    state.errorKind = '';
    state.retryGeneration = false;
    state.notice = 'Draft ready. Review and edit it before use.';
    state.noticeKind = 'success';
  } catch (error) {
    if (messageWriterState !== state) return;
    state.error = error?.message || 'The draft could not be generated. Try again.';
    state.errorKind = 'error';
    state.retryGeneration = true;
  } finally {
    if (messageWriterState === state) {
      state.loading = false;
      renderMessageWriter();
    }
  }
}
async function markDraftSent() {
  const state = messageWriterState;
  if (!state?.hasDraft || state.sending || state.loading) return;
  const placeholders = computedPlaceholders(state);
  if (placeholders.length && !state.placeholdersConfirmed) return;
  const channel = state.channel;
  const messageType = state.messageType;
  const phoneBrief = channel === 'phone';
  const inPersonBrief = channel === 'in_person';
  if (phoneBrief && !window.confirm('Confirm that you made this call. Log it as an outbound call?')) return;
  if (inPersonBrief && !window.confirm('Confirm that this conversation happened. Log it to the timeline?')) return;
  const content = currentDraftText(state);
  const activityType = messageType === 'quotation_draft' ? 'quotation_sent'
    : phoneBrief ? 'call' : inPersonBrief ? 'meeting' : channel === 'email' ? 'email' : 'message';
  const firstContact = lead.stage === 'new' && ['enquiry_reply', 'sales_message'].includes(messageType) &&
    !activities.some((activity) => activity.direction === 'outbound');
  state.sending = true;
  state.retryMarkSent = false;
  state.error = '';
  state.errorKind = 'loading';
  state.notice = '';
  state.noticeKind = '';
  renderMessageWriter();
  try {
    await createActivity({
      lead_id: lead.id,
      type: activityType,
      channel,
      direction: 'outbound',
      content,
      occurred_at: new Date().toISOString(),
    });
  } catch (error) {
    if (messageWriterState === state) {
      state.sending = false;
      state.retryMarkSent = true;
      state.error = error?.message || 'The activity could not be logged. Retry when you are ready.';
      state.errorKind = 'error';
      renderMessageWriter();
    }
    return;
  }
  resetMessageWriter({ notice: 'Logged as sent', focus: false });
  if (firstContact && window.confirm('Move this lead from New to Contacted?')) {
    try { lead = await updateLead(lead.id, { stage: 'contacted' }, 'new'); }
    catch (error) { setNotice('Logged as sent, but the stage could not be updated: ' + (error?.message || 'Please try again.'), 'error'); }
  } else if (messageType === 'quotation_draft' && lead.stage !== 'quoted' && window.confirm('Move this lead to Quoted?')) {
    try { lead = await updateLead(lead.id, { stage: 'quoted' }, lead.stage); }
    catch (error) { setNotice('Logged as sent, but the stage could not be updated: ' + (error?.message || 'Please try again.'), 'error'); }
  }
  await loadDetail();
  if (isOpen(lead) && window.confirm('Schedule the next follow-up?')) {
    taskController.openSchedule(lead, true);
  } else {
    resetMessageWriter({ notice: 'Logged as sent', focus: true });
  }
}

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
    if (!messageWriterState || messageWriterState.leadId !== lead.id) {
      resetMessageWriter({ focus: false });
      draftFormInitialized = false;
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
    if (!draftFormInitialized) {
      const query = new URLSearchParams(location.search);
      const requestedType = query.get('draft');
      if (messageTypes.some((item) => item.value === requestedType)) {
        messageWriterState.messageType = requestedType;
        document.querySelector('#message-writer').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      renderMessageWriter();
      if (requestedType && messageTypes.some((item) => item.value === requestedType)) draftForm.elements.message_type.focus({ preventScroll: true });
      draftFormInitialized = true;
    }
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
populateDraftOptions();
interactionForm.elements.type.addEventListener('change', refreshChannelOptions);
draftForm.addEventListener('submit', (event) => { event.preventDefault(); generateDraft(); });
document.querySelector('#regenerate-message-button').addEventListener('click', generateDraft);
document.querySelector('#copy-message-button').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentDraftText());
    messageWriterState.notice = 'Draft copied to the clipboard.'; messageWriterState.noticeKind = 'success';
    renderMessageWriter();
  } catch { messageWriterState.notice = 'Clipboard access is unavailable. Select and copy the draft text.'; messageWriterState.noticeKind = 'error'; renderMessageWriter(); }
});
document.querySelector('#mark-message-sent-button').addEventListener('click', markDraftSent);
document.querySelector('#retry-mark-sent-button').addEventListener('click', markDraftSent);
const syncDraftSubject = (event) => {
  messageWriterState.subject = event.currentTarget.value;
  updateMessageWriterDirty();
  renderMessageWriter();
};
const syncDraftBody = (event) => {
  messageWriterState.body = event.currentTarget.value;
  updateMessageWriterDirty();
  renderMessageWriter();
};
document.querySelector('#draft-subject').addEventListener('input', syncDraftSubject);
document.querySelector('#draft-subject').addEventListener('change', syncDraftSubject);
document.querySelector('#draft-body').addEventListener('input', syncDraftBody);
document.querySelector('#draft-body').addEventListener('change', syncDraftBody);
draftForm.elements.extra_instructions.addEventListener('input', (event) => { messageWriterState.extraInstructions = event.currentTarget.value; });
draftForm.elements.extra_instructions.addEventListener('change', (event) => { messageWriterState.extraInstructions = event.currentTarget.value; });
document.querySelector('#add-talking-point').addEventListener('click', () => {
  messageWriterState.talkingPoints.push('');
  updateMessageWriterDirty();
  renderMessageWriter();
  document.querySelectorAll('#draft-talking-points input[data-talking-point]')[messageWriterState.talkingPoints.length - 1]?.focus();
});
document.querySelector('#draft-placeholder-check').addEventListener('change', (event) => {
  messageWriterState.placeholdersConfirmed = event.currentTarget.checked;
  renderMessageWriter();
});
document.querySelector('#draft-placeholder-check').addEventListener('input', (event) => {
  messageWriterState.placeholdersConfirmed = event.currentTarget.checked;
  renderMessageWriter();
});
document.querySelector('#draft-replace-cancel').addEventListener('click', () => document.querySelector('#draft-replace-dialog').close('cancel'));
document.querySelector('#draft-replace-confirm').addEventListener('click', () => document.querySelector('#draft-replace-dialog').close('replace'));
draftForm.elements.message_type.addEventListener('change', (event) => handleWriterOptionChange('messageType', event.currentTarget));
draftForm.elements.channel.addEventListener('change', (event) => handleWriterOptionChange('channel', event.currentTarget));
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
  onNextScheduleClosed: ({ task }) => resetMessageWriter({
    notice: task ? 'Logged as sent · Follow-up scheduled for ' + task.due_date : 'Logged as sent',
    focus: true,
  }),
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

window.addEventListener('pagehide', () => resetMessageWriter({ focus: false }));
window.addEventListener('pageshow', (event) => {
  if (event.persisted && lead) resetMessageWriter({ focus: false });
});

const { data: { session }, error: sessionError } = await supabase.auth.getSession();
if (sessionError || !session) location.replace('./login.html');
else {
  app.hidden = false;
  document.querySelector('#account-email').textContent = session.user.email || '';
  await loadDetail();
}

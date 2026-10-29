import { makeElement, appendText, labelForChannel, labelForSource, labelForStage, formatMoney, relativeDate, statusBadges } from './leads.js';

function addField(parent, label, value) {
  const item = makeElement('div', 'detail-field');
  appendText(item, 'dt', '', label);
  appendText(item, 'dd', '', value === null || value === undefined || value === '' ? 'Not provided' : value);
  parent.append(item);
}
function humanize(value) { return String(value || '').replaceAll('_', ' '); }

export function renderLeadDetails(container, lead, activities, profile) {
  container.replaceChildren();
  const card = makeElement('section', 'ui-card');
  const badges = makeElement('div', 'lead-badges detail-statuses');
  statusBadges(lead, activities, profile.quiet_after_days ?? 5).forEach((item) => badges.append(item));
  card.append(badges);
  const grid = makeElement('dl', 'detail-grid');
  const currency = profile.currency || 'USD';
  addField(grid, 'Company', lead.company);
  addField(grid, 'Phone', lead.phone);
  addField(grid, 'Email', lead.email);
  addField(grid, 'Social handle / username', lead.social_handle);
  addField(grid, 'Source', labelForSource(lead.source));
  addField(grid, 'Preferred channel', labelForChannel(lead.preferred_channel));
  addField(grid, 'Interest', lead.interest);
  addField(grid, 'Needs', lead.needs);
  addField(grid, 'Budget', lead.budget == null ? 'Not provided' : formatMoney(lead.budget, currency));
  addField(grid, 'Stage', labelForStage(lead.stage));
  addField(grid, 'Deal value', formatMoney(lead.deal_value, currency));
  addField(grid, 'Expected close date', lead.expected_close_date || 'Not provided');
  addField(grid, 'Lost reason', lead.lost_reason);
  addField(grid, 'Last activity', relativeDate(lead.last_activity_at || lead.created_at));
  addField(grid, 'Created', lead.created_at ? new Date(lead.created_at).toLocaleString() : 'Not provided');
  addField(grid, 'Updated', lead.updated_at ? new Date(lead.updated_at).toLocaleString() : 'Not provided');
  addField(grid, 'AI score', lead.ai_score);
  addField(grid, 'AI analysis', lead.ai_analysis == null ? null : (typeof lead.ai_analysis === 'string' ? lead.ai_analysis : JSON.stringify(lead.ai_analysis, null, 2)));
  card.append(grid);
  const notes = makeElement('div', 'detail-notes');
  appendText(notes, 'h2', 'ui-card__title', 'Notes');
  appendText(notes, 'p', 'detail-notes__body', lead.notes || 'No notes added.');
  card.append(notes);
  container.append(card);
}

export function renderTimeline(container, activities) {
  container.replaceChildren();
  if (!activities.length) {
    const empty = makeElement('div', 'ui-empty');
    appendText(empty, 'div', 'ui-empty__icon', '◷').setAttribute('aria-hidden', 'true');
    appendText(empty, 'h3', '', 'No interactions yet');
    appendText(empty, 'p', '', 'Log a call, message, meeting, visit or note to start the timeline.');
    container.append(empty);
    return;
  }
  const list = makeElement('ol', 'activity-timeline');
  activities.forEach((activity) => {
    const item = makeElement('li', 'activity-entry');
    const marker = makeElement('span', 'activity-marker');
    marker.setAttribute('aria-hidden', 'true');
    const body = makeElement('div', 'activity-entry__body');
    const header = makeElement('div', 'activity-entry__header');
    appendText(header, 'strong', '', activity.type === 'stage_change' ? 'Stage changed' : humanize(activity.type));
    appendText(header, 'time', 'muted', activity.occurred_at ? new Date(activity.occurred_at).toLocaleString() : 'Date unavailable');
    body.append(header);
    if (activity.channel) appendText(body, 'p', 'activity-meta', labelForChannel(activity.channel) + (activity.direction ? ' · ' + activity.direction : ''));
    if (activity.content) appendText(body, 'p', 'activity-content', activity.content);
    item.append(marker, body);
    list.append(item);
  });
  container.append(list);
}

export function renderQuickActions(container, lead, onCopy) {
  container.replaceChildren();
  const addCopy = (label, value, kind) => {
    if (!value) return;
    const button = makeElement('button', 'ui-button ui-button--secondary', 'Copy ' + label);
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.classList.add('is-loading');
      button.textContent = 'Copying…';
      try { await onCopy(value, kind); }
      finally { button.disabled = false; button.classList.remove('is-loading'); button.textContent = 'Copy ' + label; }
    });
    container.append(button);
  };
  if (lead.phone) {
    const tel = makeElement('a', 'ui-button ui-button--secondary', 'Call');
    tel.href = 'tel:' + lead.phone.replace(/[^+\d]/g, '');
    container.append(tel);
    addCopy('phone', lead.phone, 'phone');
  }
  if (lead.email) {
    const email = makeElement('a', 'ui-button ui-button--secondary', 'Email');
    email.href = 'mailto:' + encodeURIComponent(lead.email);
    container.append(email);
    addCopy('email', lead.email, 'email');
  }
  if (lead.social_handle) addCopy('handle / username', lead.social_handle, 'handle');
  const isTelegram = lead.preferred_channel === 'telegram' || lead.source === 'telegram';
  const telegramUsername = String(lead.social_handle || '').trim().replace(/^@/, '');
  if (isTelegram && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(telegramUsername)) {
    const telegram = makeElement('a', 'ui-button ui-button--secondary', 'Open Telegram');
    telegram.href = 'https://t.me/' + telegramUsername;
    telegram.target = '_blank';
    telegram.rel = 'noopener noreferrer';
    container.append(telegram);
  }
  if (lead.phone && (lead.preferred_channel === 'whatsapp' || lead.source === 'whatsapp')) {
    const number = lead.phone.replace(/\D/g, '');
    if (number) {
      const whatsapp = makeElement('a', 'ui-button ui-button--secondary', 'Open WhatsApp');
      whatsapp.href = 'https://wa.me/' + number;
      whatsapp.target = '_blank';
      whatsapp.rel = 'noopener noreferrer';
      container.append(whatsapp);
    }
  }
}

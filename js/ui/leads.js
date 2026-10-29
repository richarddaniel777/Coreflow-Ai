import { getLeadStatuses } from '../lib/leadStatus.js';
import { labelForSource, labelForStage, toneForStage } from '../lib/constants.js';

export { labelForChannel, labelForSource, labelForStage } from '../lib/constants.js';

export function makeElement(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}
export function appendText(parent, tag, className, text) {
  const node = makeElement(tag, className, text);
  parent.append(node);
  return node;
}
export function showPageState(container, kind, text) {
  container.replaceChildren();
  const state = makeElement('div', kind === 'empty' ? 'ui-empty' : 'ui-card');
  if (kind === 'loading') {
    const row = makeElement('div', 'ui-loading');
    const spinner = makeElement('span', 'ui-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    row.append(spinner, document.createTextNode(text));
    state.append(row);
  } else if (kind === 'empty') {
    appendText(state, 'div', 'ui-empty__icon', '◇').setAttribute('aria-hidden', 'true');
    appendText(state, 'h3', '', 'No leads yet');
    appendText(state, 'p', '', text);
  } else {
    appendText(state, 'p', kind === 'error' ? 'ui-error' : 'ui-hint', text);
    state.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }
  container.append(state);
}
function parsedDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
export function relativeDate(value) {
  const date = parsedDate(value);
  if (!date) return 'No activity yet';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  if (Math.abs(seconds) < 60) return 'Just now';
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  if (Math.abs(days) < 30) return formatter.format(days, 'day');
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, 'month');
  return formatter.format(Math.round(days / 365), 'year');
}
export function formatMoney(value, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(Number(value || 0));
  } catch {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(value || 0));
  }
}
function badge(label, tone) {
  return makeElement('span', 'ui-badge ui-badge--' + tone, label);
}
export function statusBadges(lead, activities, quietAfterDays) {
  const statuses = getLeadStatuses(lead, activities, quietAfterDays);
  if (statuses.closed) return [badge('Closed', 'neutral')];
  const badges = [];
  if (statuses.needsReply) badges.push(badge('Needs reply', 'warning'));
  if (statuses.goneQuiet) badges.push(badge('Gone quiet', 'danger'));
  if (statuses.onTrack) badges.push(badge('On track', 'neutral'));
  return badges;
}
export function renderLeadTable(container, leads, activityMap, options) {
  container.replaceChildren();
  const wrapper = makeElement('div', 'ui-table-wrap');
  const table = makeElement('table', 'ui-table ui-table--responsive leads-table');
  const thead = makeElement('thead');
  const headRow = makeElement('tr');
  ['Lead', 'Source', 'Stage', 'Deal value', 'Last activity', 'Status'].forEach((title) => appendText(headRow, 'th', '', title));
  thead.append(headRow);
  const tbody = makeElement('tbody');
  leads.forEach((lead) => {
    const row = makeElement('tr');
    const nameCell = makeElement('td', 'lead-cell-name');
    nameCell.dataset.label = 'Lead';
    const nameLink = makeElement('a', 'lead-name-link', lead.name);
    nameLink.href = './lead.html?id=' + encodeURIComponent(lead.id);
    nameCell.append(nameLink);
    if (lead.company) appendText(nameCell, 'span', 'lead-company', lead.company);
    const source = makeElement('td', '', labelForSource(lead.source));
    source.dataset.label = 'Source';
    const stage = makeElement('td');
    stage.dataset.label = 'Stage';
    stage.append(badge(labelForStage(lead.stage), toneForStage(lead.stage)));
    const value = makeElement('td', '', formatMoney(lead.deal_value, options.currency));
    value.dataset.label = 'Deal value';
    const activity = makeElement('td', '', relativeDate(lead.last_activity_at || lead.created_at));
    activity.dataset.label = 'Last activity';
    const status = makeElement('td', 'lead-status-cell');
    status.dataset.label = 'Status';
    const statusList = makeElement('div', 'lead-badges');
    statusBadges(lead, activityMap.get(lead.id) || [], options.quietAfterDays).forEach((item) => statusList.append(item));
    
    status.append(statusList);
    row.append(nameCell, source, stage, value, activity, status);
    tbody.append(row);
  });
  table.append(thead, tbody);
  wrapper.append(table);
  container.append(wrapper);
}

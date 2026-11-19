import { ANALYTICS_DEFINITIONS, labelForChannel, labelForSource, labelForStage } from '../lib/constants.js';

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

function setState(container, kind, message) {
  container.replaceChildren();
  const card = element('section', kind === 'empty' ? 'ui-empty analytics-state' : 'ui-card analytics-state');
  card.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  if (kind === 'loading') {
    const row = element('div', 'ui-loading');
    const spinner = element('span', 'ui-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    row.append(spinner, document.createTextNode(message));
    card.append(row);
  } else {
    if (kind === 'empty') {
      const icon = element('div', 'ui-empty__icon', '◇');
      icon.setAttribute('aria-hidden', 'true');
      card.append(icon, element('h2', '', 'No leads to analyze yet'), element('p', '', message));
      const link = element('a', 'ui-button ui-button--primary', 'Add your first lead');
      link.href = './leads.html';
      card.append(link);
    } else {
      card.append(element('p', 'analytics-error-message', message));
      const retry = element('button', 'ui-button ui-button--secondary', 'Retry');
      retry.type = 'button';
      retry.dataset.analyticsRetry = '';
      card.append(retry);
    }
  }
  container.append(card);
}

export function showAnalyticsLoading(container) {
  setState(container, 'loading', 'Loading sales analytics…');
}

export function showAnalyticsError(container, message) {
  setState(container, 'error', message || 'Analytics could not be loaded. Please try again.');
}

export function showAnalyticsEmpty(container, hasDateFilter = false) {
  const message = hasDateFilter
    ? 'There are no leads in this date range. Try a wider range or add leads from your enquiries.'
    : 'Add leads from your enquiries to see your pipeline, wins and follow-up trends here.';
  setState(container, 'empty', message);
}

function numberFormat(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat().format(number) : '0';
}

function moneyFormat(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const code = /^[A-Z]{3}$/.test(String(currency || '')) ? currency : 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${code} ${new Intl.NumberFormat().format(amount)}`;
  }
}

function rateFormat(value) {
  const rate = Number(value);
  return value === null || value === undefined || !Number.isFinite(rate) ? '—' : `${(rate * 100).toFixed(1)}%`;
}

function addTooltip(parent, key) {
  const definition = ANALYTICS_DEFINITIONS[key];
  const details = element('details', 'analytics-tooltip');
  const summary = element('summary', '', 'i');
  summary.setAttribute('aria-label', `${definition.label} definition`);
  details.append(summary, element('span', 'analytics-tooltip__text', definition.tooltip));
  parent.append(details);
}

const KPI_ICONS = {
  total_leads: [['path', 'd', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'], ['circle', 'cx', '9', 'cy', '7', 'r', '4'], ['path', 'd', 'M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75']],
  open_leads: [['path', 'd', 'M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z']],
  qualified_leads: [['path', 'd', 'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z']],
  won_count: [['path', 'd', 'm5 12 4 4L19 6']],
  won_value: [['circle', 'cx', '12', 'cy', '12', 'r', '9'], ['path', 'd', 'M16 8.5c-.7-.7-1.8-1.1-3.2-1.1-1.8 0-3 .8-3 2s1.1 1.8 3 2.2 3 1 3 2.2-1.2 2-3 2c-1.3 0-2.5-.4-3.3-1.2M12.8 5.5v13']],
  lost_count: [['path', 'd', 'M6 6l12 12M18 6 6 18']],
  conversion_rate: [['path', 'd', 'M4 17l5-5 4 3 7-8'], ['path', 'd', 'M14 7h6v6']],
  win_rate: [['path', 'd', 'M12 3v9l7.8 4.5A9 9 0 1 1 12 3z'], ['path', 'd', 'M15 3.5A9 9 0 0 1 20.5 9H15z']],
  open_pipeline_value: [['path', 'd', 'M4 19V5M10 19V9M16 19V3M22 19V7']],
  overdue_tasks: [['circle', 'cx', '12', 'cy', '12', 'r', '9'], ['path', 'd', 'M12 7v5l3 2']],
  needs_reply_count: [['path', 'd', 'M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 2v-5.5A7.5 7.5 0 1 1 20 11.5z'], ['path', 'd', 'm9 11 2 2 4-4']],
};

function metricIcon(key) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  KPI_ICONS[key].forEach((shape) => {
    const [tag, ...pairs] = shape;
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (let index = 0; index < pairs.length; index += 2) node.setAttribute(pairs[index], pairs[index + 1]);
    svg.append(node);
  });
  return svg;
}

function metricCard(key, value) {
  const definition = ANALYTICS_DEFINITIONS[key];
  const card = element('article', `ui-card analytics-kpi analytics-kpi--${key}`);
  const header = element('div', 'analytics-kpi__header');
  const label = element('div', 'analytics-kpi__label');
  const icon = element('span', 'analytics-kpi__icon');
  icon.append(metricIcon(key));
  label.append(icon, element('h2', '', definition.label));
  header.append(label);
  addTooltip(header, key);
  card.append(header, element('p', 'analytics-kpi__value', value));
  return card;
}

function panelHeading(key) {
  const definition = ANALYTICS_DEFINITIONS[key];
  const header = element('div', 'analytics-panel__heading');
  header.append(element('h2', '', definition.label));
  addTooltip(header, key);
  return header;
}

function makeTable(label, headings, rows) {
  const wrapper = element('div', 'analytics-table-wrap scroll-hidden');
  wrapper.tabIndex = 0;
  wrapper.setAttribute('aria-label', `${label}. Scroll horizontally to view all columns.`);
  const table = element('table', 'analytics-table');
  const thead = element('thead');
  const headerRow = element('tr');
  headings.forEach((heading) => {
    const th = element('th', '', heading);
    th.scope = 'col';
    headerRow.append(th);
  });
  thead.append(headerRow);
  const tbody = element('tbody');
  if (!rows.length) {
    const tr = element('tr');
    const td = element('td', 'analytics-table__empty', `No ${label.toLocaleLowerCase()} data for this range.`);
    td.colSpan = headings.length;
    tr.append(td);
    tbody.append(tr);
  } else rows.forEach((cells) => {
    const tr = element('tr');
    cells.forEach((cell) => tr.append(element('td', '', cell)));
    tbody.append(tr);
  });
  table.append(thead, tbody);
  wrapper.append(table);
  return wrapper;
}

function renderFunnel(data, currency) {
  const panel = element('section', 'ui-card analytics-panel analytics-funnel');
  panel.append(panelHeading('per_stage'));
  const rows = Array.isArray(data.per_stage) ? data.per_stage : [];
  const maxCount = Math.max(1, ...rows.map((row) => Number(row.count) || 0));
  rows.forEach((row) => {
    const count = Number(row.count) || 0;
    const item = element('div', 'analytics-funnel__row');
    const label = element('div', 'analytics-funnel__label');
    label.append(element('strong', '', labelForStage(row.stage)), element('span', '', `${numberFormat(count)} · ${moneyFormat(row.value, currency)}`));
    const track = element('div', 'analytics-funnel__track');
    const fill = element('span', 'analytics-funnel__fill');
    fill.style.width = `${Math.min(100, Math.max(0, count / maxCount * 100))}%`;
    track.setAttribute('role', 'meter');
    track.setAttribute('aria-label', `${labelForStage(row.stage)} leads`);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(maxCount));
    track.setAttribute('aria-valuenow', String(count));
    track.append(fill);
    item.append(label, track);
    panel.append(item);
  });
  return panel;
}

export function renderAnalyticsDashboard(container, data, currency) {
  container.replaceChildren();
  const kpis = element('div', 'analytics-kpis');
  [
    ['total_leads', numberFormat(data.total_leads)],
    ['open_leads', numberFormat(data.open_leads)],
    ['qualified_leads', numberFormat(data.qualified_leads)],
    ['won_count', numberFormat(data.won_count)],
    ['won_value', moneyFormat(data.won_value, currency)],
    ['lost_count', numberFormat(data.lost_count)],
    ['conversion_rate', rateFormat(data.conversion_rate)],
    ['win_rate', rateFormat(data.win_rate)],
    ['open_pipeline_value', moneyFormat(data.open_pipeline_value, currency)],
    ['overdue_tasks', numberFormat(data.overdue_tasks)],
    ['needs_reply_count', numberFormat(data.needs_reply_count)],
  ].forEach(([key, value]) => kpis.append(metricCard(key, value)));
  container.append(kpis);

  const grid = element('div', 'analytics-grid');
  grid.append(renderFunnel(data, currency));
  const sourcePanel = element('section', 'ui-card analytics-panel');
  sourcePanel.append(panelHeading('per_source'));
  const sources = (Array.isArray(data.per_source) ? data.per_source : []).map((row) => [
    labelForSource(row.source), numberFormat(row.leads), numberFormat(row.won), rateFormat(row.conversion),
  ]);
  sourcePanel.append(makeTable('source', ['Source', 'Leads', 'Won', 'Conversion'], sources));
  grid.append(sourcePanel);

  const channelPanel = element('section', 'ui-card analytics-panel');
  channelPanel.append(panelHeading('per_channel'));
  const channels = (Array.isArray(data.per_channel) ? data.per_channel : []).map((row) => [
    row.channel === 'not_set' ? 'No preference set' : labelForChannel(row.channel),
    numberFormat(row.leads), numberFormat(row.won), rateFormat(row.conversion),
  ]);
  channelPanel.append(makeTable('preferred channel', ['Preferred channel', 'Leads', 'Won', 'Conversion'], channels));
  grid.append(channelPanel);

  const lostPanel = element('section', 'ui-card analytics-panel analytics-lost-reasons');
  lostPanel.append(panelHeading('lost_reasons'));
  const reasons = (Array.isArray(data.lost_reasons) ? data.lost_reasons : []).map((row) => [row.reason || 'Unspecified', numberFormat(row.count)]);
  lostPanel.append(makeTable('lost reason', ['Lost reason', 'Leads'], reasons));
  grid.append(lostPanel);
  container.append(grid);
}

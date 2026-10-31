import { appendTaskActions } from './followups.js';
import { relativeDateLabel, wholeDayDifference } from '../lib/dates.js';

function make(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}
function openLeadButton(lead) {
  const link = make('a', 'ui-button ui-button--secondary task-open-lead', 'Open lead');
  link.href = './lead.html?id=' + encodeURIComponent(lead.id);
  return link;
}
function waitingReason(row, today) {
  const days = wholeDayDifference(row.last_directional_at, today);
  if (days === null || days <= 0) return 'Waiting for a reply since today';
  return 'Waiting for a reply for ' + days + (days === 1 ? ' day' : ' days');
}
function taskReason(section, task, today) {
  if (section === 'overdue') {
    const days = Math.max(0, wholeDayDifference(task.due_date, today) || 0);
    return days + (days === 1 ? ' day overdue' : ' days overdue');
  }
  if (section === 'dueToday') return 'Due today';
  return 'Due ' + relativeDateLabel(task.due_date, today + 'T12:00:00');
}
function leadItem(entry, reason, handlers) {
  const item = make('article', 'today-item');
  const top = make('div', 'today-item__top'); top.append(make('h3', '', entry.lead.name)); item.append(top);
  item.append(make('p', 'today-item__reason', reason));
  const actions = make('div', 'today-item__actions');
  actions.append(openLeadButton(entry.lead));
  const schedule = make('button', 'ui-button ui-button--secondary', 'Schedule follow-up');
  schedule.type = 'button'; schedule.addEventListener('click', () => handlers.schedule(entry.lead));
  actions.append(schedule); item.append(actions);
  return item;
}
function taskItem(section, task, handlers, today) {
  const item = make('article', 'today-item');
  const top = make('div', 'today-item__top');
  const titleWrap = make('div');
  titleWrap.append(make('h3', '', task.title));
  titleWrap.append(make('p', 'today-item__lead', task.lead.name));
  top.append(titleWrap); item.append(top);
  item.append(make('p', 'today-item__reason', taskReason(section, task, today)));
  const taskActions = make('div', 'today-item__actions');
  taskActions.append(openLeadButton(task.lead));
  appendTaskActions(taskActions, task, handlers.taskActions);
  item.append(taskActions);
  return item;
}
function section(title, description, items, emptyLabel, renderItem) {
  const card = make('section', 'ui-card today-section');
  card.setAttribute('aria-label', title);
  const head = make('div', 'today-section__head');
  const text = make('div'); text.append(make('h2', '', title), make('p', '', description));
  head.append(text, make('span', 'today-count', items.length)); card.append(head);
  const list = make('div', 'today-items');
  if (items.length) items.forEach((item) => list.append(renderItem(item)));
  else list.append(make('p', 'today-empty', emptyLabel));
  card.append(list); return card;
}

export function renderTodayDashboard(container, sections, handlers) {
  container.replaceChildren();
  const clear = !sections.needsReply.length && !sections.overdue.length && !sections.dueToday.length && !sections.goneQuiet.length && !sections.upcoming.length;
  if (clear) {
    const state = make('div', 'today-state-card today-clear', 'Everything is up to date. No replies or follow-ups need your attention.');
    container.append(state);
  }
  const grid = make('div', 'today-sections');
  grid.append(section('Needs reply', 'Open leads waiting for your response, oldest first.', sections.needsReply,
    'No open leads are waiting for a reply.', (entry) => leadItem(entry, waitingReason(entry.row, sections.today), handlers)));
  grid.append(section('Overdue follow-ups', 'Open tasks that are past their due date.', sections.overdue,
    'No follow-ups are overdue.', (task) => taskItem('overdue', task, handlers, sections.today)));
  grid.append(section('Due today', 'Follow-ups scheduled for today.', sections.dueToday,
    'Nothing is due today.', (task) => taskItem('dueToday', task, handlers, sections.today)));
  grid.append(section('Gone quiet', 'Open leads with no recent activity or open follow-up.', sections.goneQuiet,
    'No open leads have gone quiet without a follow-up.', (entry) => leadItem(entry, 'No real activity since ' + relativeDateLabel(entry.row.last_real_activity_at || entry.lead.created_at, sections.today + 'T12:00:00') + '; no open follow-up.', handlers)));
  grid.append(section('Upcoming', 'Open follow-ups due in the next 7 days.', sections.upcoming,
    'No follow-ups are coming up in the next 7 days.', (task) => taskItem('upcoming', task, handlers, sections.today)));
  container.append(grid);
}

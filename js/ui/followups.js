import { relativeDateLabel } from '../lib/dates.js';

function make(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}
function actionButton(label, callback, className = 'ui-button ui-button--secondary') {
  const button = make('button', className, label);
  button.type = 'button';
  button.addEventListener('click', async () => {
    button.disabled = true; button.classList.add('is-loading');
    const labelBeforeLoading = button.textContent; button.textContent = 'Working…';
    try { await callback(); } finally { button.disabled = false; button.classList.remove('is-loading'); button.textContent = labelBeforeLoading; }
  });
  return button;
}

export function appendTaskActions(container, task, actions) {
  const actionRow = make('div', 'task-actions');
  actionRow.append(actionButton('Complete', () => actions.complete(task), 'ui-button ui-button--primary task-complete'));
  const snooze = make('div', 'task-snooze-actions');
  snooze.setAttribute('aria-label', 'Snooze follow-up');
  [[1, '+1 day'], [3, '+3 days'], [7, '+7 days']].forEach(([days, label]) => {
    snooze.append(actionButton(label, () => actions.snooze(task, days), 'ui-button ui-button--ghost'));
  });
  actionRow.append(snooze, actionButton('Edit', () => actions.edit(task)), actionButton('Delete', () => actions.remove(task), 'ui-button ui-button--danger'));
  container.append(actionRow);
}

export function renderFollowupTasks(container, tasks, actions, kind = 'empty') {
  container.replaceChildren();
  if (!tasks.length) {
    const empty = make('div', 'ui-empty task-empty');
    if (kind === 'loading') { const spinner = make('span', 'ui-spinner'); spinner.setAttribute('aria-hidden', 'true'); empty.append(spinner); }
    empty.append(make('h3', '', kind === 'loading' ? 'Loading follow-ups…' : kind === 'error' ? 'Follow-ups could not be loaded' : 'No open follow-ups'));
    if (kind === 'error') empty.append(make('p', '', 'Check your connection and try again.'));
    container.append(empty);
    return;
  }
  const list = make('ul', 'followup-list');
  tasks.forEach((task) => {
    const item = make('li', 'followup-item');
    const heading = make('div', 'followup-item__heading');
    heading.append(make('strong', '', task.title), make('span', 'muted', 'Due ' + relativeDateLabel(task.due_date)));
    item.append(heading);
    if (task.lead?.name) item.append(make('p', 'followup-item__lead', task.lead.name));
    appendTaskActions(item, task, actions);
    list.append(item);
  });
  container.append(list);
}

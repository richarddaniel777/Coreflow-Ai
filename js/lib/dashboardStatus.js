import { isOpen, needsReply, isQuiet } from './leadStatus.js';
import { todayLocalDate, addDays, wholeDayDifference } from './dates.js';

function leadForSummary(row) {
  return { id: row.lead_id, name: row.lead_name, stage: row.lead_stage, created_at: row.lead_created_at };
}
function directionalActivities(row) {
  return row.last_direction && row.last_directional_at
    ? [{ direction: row.last_direction, occurred_at: row.last_directional_at, type: 'message' }]
    : [];
}
function realActivityForQuiet(row) {
  return row.last_real_activity_at
    ? [{ type: 'call', occurred_at: row.last_real_activity_at }]
    : [];
}

export function buildTodaySections(summaryRows = [], taskRows = [], quietAfterDays = 5, today = todayLocalDate()) {
  const summaries = summaryRows.map((row) => ({ row, lead: leadForSummary(row) }));
  const openSummaries = summaries.filter(({ lead }) => isOpen(lead));
  const needsReplyRows = openSummaries
    .filter(({ row, lead }) => needsReply(lead, directionalActivities(row)))
    .sort((a, b) => new Date(a.row.last_directional_at).getTime() - new Date(b.row.last_directional_at).getTime());
  const tasks = taskRows.filter((task) => !task.completed && task.lead && isOpen(task.lead));
  const overdue = tasks.filter((task) => task.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const dueToday = tasks.filter((task) => task.due_date === today);
  const upcomingEnd = addDays(today, 7);
  const upcoming = tasks.filter((task) => task.due_date > today && task.due_date <= upcomingEnd).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const goneQuiet = openSummaries.filter(({ row, lead }) =>
    Number(row.open_task_count || 0) === 0 && isQuiet(lead, realActivityForQuiet(row), quietAfterDays ?? 5)
  );
  return { needsReply: needsReplyRows, overdue, dueToday, goneQuiet, upcoming, today };
}

export function getAttentionCount(sections) {
  return sections.needsReply.length + sections.overdue.length;
}

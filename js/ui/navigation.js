import { getLeadActivitySummary } from '../api/dashboard.js';
import { getOpenTasksWithLeads } from '../api/tasks.js';
import { buildTodaySections, getAttentionCount } from '../lib/dashboardStatus.js';

export function setAttentionBadge(sections) {
  const count = getAttentionCount(sections);
  document.querySelectorAll('[data-attention-count]').forEach((badge) => {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count === 0;
    badge.setAttribute('aria-label', count + ' items need attention');
    badge.title = count + ' needs-reply leads and overdue follow-ups';
  });
}

export async function refreshAttentionBadge() {
  try {
    const [summary, tasks] = await Promise.all([getLeadActivitySummary(), getOpenTasksWithLeads()]);
    setAttentionBadge(buildTodaySections(summary, tasks, 5));
  } catch {
    document.querySelectorAll('[data-attention-count]').forEach((badge) => { badge.hidden = true; });
  }
}

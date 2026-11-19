import { getSalesAnalytics, SALES_ANALYTICS_RPC } from '../api/analytics.js';
import { loadBusinessProfile } from '../api/businessProfile.js';
import { addDays, todayLocalDate } from '../lib/dates.js';
import { renderAnalyticsDashboard, showAnalyticsEmpty, showAnalyticsError, showAnalyticsLoading } from '../ui/analytics.js';

function localMidnightInstant(localDate) {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(year, month - 1, day).toISOString();
}

function selectedStartDate(range, today) {
  if (range === 'all') return null;
  const days = Number(range);
  if (![7, 14, 30, 90].includes(days)) return null;
  return localMidnightInstant(addDays(today, 1 - days));
}

export function initAnalyticsPage() {
  const page = document.querySelector('#analytics-page');
  const dateRange = document.querySelector('#analytics-date-range');
  const state = document.querySelector('#analytics-state');
  const content = document.querySelector('#analytics-content');
  const debug = document.querySelector('#analytics-debug');
  let requestNumber = 0;
  const debugEnabled = new URLSearchParams(window.location.search).get('debug') === '1';
  debug.hidden = !debugEnabled;

  function updateDebug(status, rowCount = '—') {
    if (debugEnabled) debug.textContent = `RPC: ${SALES_ANALYTICS_RPC} · Status: ${status} · Row count: ${rowCount}`;
  }

  async function load() {
    const request = ++requestNumber;
    const today = todayLocalDate();
    showAnalyticsLoading(state);
    content.replaceChildren();
    updateDebug('loading');
    try {
      const [data, profile] = await Promise.all([
        getSalesAnalytics({ startDate: selectedStartDate(dateRange.value, today), today }),
        loadBusinessProfile({ source: 'analytics' }),
      ]);
      if (request !== requestNumber) return;
      const totalLeads = Number(data.total_leads) || 0;
      updateDebug('success', totalLeads);
      if (totalLeads === 0) showAnalyticsEmpty(state, dateRange.value !== 'all');
      else {
        state.replaceChildren();
        renderAnalyticsDashboard(content, data, profile.currency || 'USD');
      }
    } catch (error) {
      if (request !== requestNumber) return;
      console.error('Analytics page failed', { code: error?.code || 'unknown', message: error?.message || 'Unknown error' });
      updateDebug('error');
      showAnalyticsError(state, error?.message || 'Analytics could not be loaded. Please try again.');
    }
  }

  dateRange.addEventListener('change', load);
  state.addEventListener('click', (event) => {
    if (event.target.closest('[data-analytics-retry]')) load();
  });
  return { load, page };
}

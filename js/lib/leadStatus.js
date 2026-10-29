import { stageIsOpen } from './constants.js';

export function isOpen(lead) {
  return stageIsOpen(lead?.stage);
}

export function needsReply(lead, activities = []) {
  if (!isOpen(lead)) return false;
  const latestDirectional = (Array.isArray(activities) ? activities : [])
    .filter((activity) => activity?.direction === 'inbound' || activity?.direction === 'outbound')
    .filter((activity) => Number.isFinite(new Date(activity.occurred_at).getTime()))
    .sort((a, b) => {
      const occurred = new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
      if (occurred) return occurred;
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    })[0];
  return latestDirectional?.direction === 'inbound';
}

function parseLocalDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function latestRealActivityDate(lead, activities) {
  const dates = (Array.isArray(activities) ? activities : [])
    .filter((activity) => !['note', 'stage_change'].includes(activity?.type))
    .map((activity) => parseLocalDate(activity?.occurred_at))
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime());
  return dates[0] || parseLocalDate(lead?.created_at);
}

function localDayNumber(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

export function isQuiet(lead, activities = [], quietAfterDays = 5) {
  if (!isOpen(lead)) return false;
  const latestActivity = latestRealActivityDate(lead, activities);
  const threshold = quietAfterDays === null || quietAfterDays === undefined ? 5 : Number(quietAfterDays);
  if (!latestActivity || !Number.isFinite(threshold) || threshold < 0) return false;
  const wholeLocalDays = localDayNumber(new Date()) - localDayNumber(latestActivity);
  return wholeLocalDays > threshold;
}

export function getLeadStatuses(lead, activities = [], quietAfterDays = 5) {
  const closed = !isOpen(lead);
  const reply = needsReply(lead, activities);
  const quiet = isQuiet(lead, activities, quietAfterDays);
  return {
    closed,
    needsReply: reply,
    goneQuiet: quiet,
    onTrack: !closed && !reply && !quiet,
  };
}

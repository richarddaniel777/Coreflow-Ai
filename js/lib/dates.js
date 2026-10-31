function parseLocalDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const raw = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
    return date;
  }
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function formatLocalDate(date) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function localDayNumber(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

export function todayLocalDate(now = new Date()) {
  const date = parseLocalDate(now);
  return date ? formatLocalDate(date) : '';
}

export function addDays(dateValue, amount) {
  const date = parseLocalDate(dateValue);
  const days = Number(amount);
  if (!date || !Number.isInteger(days)) return '';
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

export function wholeDayDifference(fromValue, toValue = new Date()) {
  const from = parseLocalDate(fromValue);
  const to = parseLocalDate(toValue);
  if (!from || !to) return null;
  return localDayNumber(to) - localDayNumber(from);
}

export function relativeDateLabel(value, now = new Date()) {
  const days = wholeDayDifference(value, now);
  if (days === null) return 'Date unavailable';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days > 1) return days + ' days ago';
  if (days === -1) return 'Tomorrow';
  return 'In ' + Math.abs(days) + ' days';
}

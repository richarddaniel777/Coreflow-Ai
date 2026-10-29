import { LEAD_SOURCES, PREFERRED_CHANNELS, LEAD_STAGES } from './constants.js';

const LEAD_FIELDS = ['name', 'company', 'phone', 'email', 'social_handle', 'source', 'preferred_channel', 'interest', 'needs', 'budget', 'stage', 'deal_value', 'expected_close_date', 'notes'];

export function parseCsv(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(source);
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('The CSV has an unterminated quoted field.');
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const nonempty = rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ''));
  if (!nonempty.length) return { headers: [], rows: [], delimiter };
  const headers = nonempty[0].map((header) => String(header).trim());
  return { headers, rows: nonempty.slice(1).map((cells) => headers.map((_, index) => String(cells[index] ?? ''))) , delimiter };
}

function detectDelimiter(text) {
  let quoted = false, comma = 0, semicolon = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') i += 1;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') comma += 1;
    else if (c === ';') semicolon += 1;
    else if (c === '\r' || c === '\n') break;
  }
  return semicolon > comma ? ';' : ',';
}

function key(value) { return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''); }
const ALIASES = {
  ig: 'instagram', insta: 'instagram', fb: 'facebook', li: 'linkedin', x: 'x_twitter', twitter: 'x_twitter',
  walkin: 'walk_in', call: 'phone_call', web: 'website', wa: 'whatsapp',
};

export function resolveAlias(value, options, kind) {
  const raw = String(value ?? '').trim();
  if (!raw) return { value: '', recognized: true };
  const lookup = new Map(options.map(({ value: optionValue, label }) => [key(optionValue), optionValue]).concat(options.map(({ value: optionValue, label }) => [key(label), optionValue])));
  const normalized = key(raw);
  let candidate = lookup.get(normalized);
  if (!candidate) {
    let alias = ALIASES[normalized];
    if (kind === 'preferred_channel' && normalized === 'call') alias = 'phone';
    if (kind === 'preferred_channel' && normalized === 'walkin') alias = 'in_person';
    if (alias && options.some((option) => option.value === alias)) candidate = alias;
  }
  if (candidate) return { value: candidate, recognized: true };
  if (kind === 'source') return { value: 'other', recognized: false };
  if (kind === 'preferred_channel') return { value: '', recognized: false };
  return { value: '', recognized: false };
}

export function normalizeSource(value) { return resolveAlias(value, LEAD_SOURCES, 'source'); }
export function normalizePreferredChannel(value) { return resolveAlias(value, PREFERRED_CHANNELS, 'preferred_channel'); }

export function normalizeStage(value) {
  const found = resolveAlias(value, LEAD_STAGES, 'stage');
  return found.recognized && found.value ? found.value : 'new';
}

export function parseMoney(value) {
  let input = String(value ?? '').trim();
  if (!input) return '';
  input = input.replace(/[\s\u00a0\p{Sc}]/gu, '');
  if (/[^0-9,.-]/.test(input)) return ''; 
  if (!input || !/^-?[0-9.,]+$/.test(input)) return '';
  const comma = input.lastIndexOf(',');
  const dot = input.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    input = input.replace(decimal === ',' ? /\./g : /,/g, '');
    if (decimal === ',') input = input.replace(',', '.');
  } else if (comma >= 0) {
    const decimals = input.length - comma - 1;
    input = decimals > 0 && decimals <= 2 ? input.replace(/,/g, '.') : input.replace(/,/g, '');
  } else if (dot >= 0) {
    const decimals = input.length - dot - 1;
    if (decimals > 2) input = input.replace(/\./g, '');
  }
  const number = Number(input);
  return Number.isFinite(number) && number >= 0 ? number : '';
}

export function parseImportDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { value: null, valid: true };
  let year, month, day;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (match) [, year, month, day] = match;
  else {
    match = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/.exec(raw);
    if (!match) return { value: null, valid: false };
    const first = Number(match[1]), second = Number(match[2]);
    if (first <= 12 && second <= 12) return { value: null, valid: false };
    if (first > 12) { day = match[1]; month = match[2]; }
    else { month = match[1]; day = match[2]; }
    year = match[3];
  }
  year = Number(year); month = Number(month); day = Number(day);
  const date = new Date(year, month - 1, day);
  if (year < 1000 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return { value: null, valid: false };
  return { value: String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0'), valid: true };
}

export function normalizePhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  return digits ? (raw.startsWith('+') ? '+' : '') + digits : '';
}

export function guessField(header) {
  const h = key(header);
  const synonyms = {
    name: ['name', 'fullname', 'leadname', 'customername', 'prospectname', 'contactname'],
    company: ['company', 'business', 'organization', 'organisation', 'companyname'],
    phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'telephone', 'tel'],
    email: ['email', 'emailaddress', 'mail'],
    social_handle: ['socialhandle', 'handle', 'username', 'instagram', 'linkedin', 'facebook', 'twitter', 'xhandle'],
    source: ['source', 'leadsource', 'enquirysource', 'inquirySource'],
    preferred_channel: ['preferredchannel', 'contactchannel', 'channel'],
    interest: ['interest', 'product', 'service', 'productservice', 'interestedin'],
    needs: ['needs', 'requirement', 'requirements'], budget: ['budget'], stage: ['stage', 'status', 'leadstage'],
    deal_value: ['dealvalue', 'value', 'opportunityvalue'], expected_close_date: ['expectedclosedate', 'closedate', 'targetdate'], notes: ['notes', 'note', 'comments'],
  };
  return LEAD_FIELDS.find((field) => (synonyms[field] || [field]).some((name) => key(name) === h)) || 'ignore';
}

export function normalizeAndValidateRow(raw, mapping) {
  const lead = { name: '', company: null, phone: null, email: null, social_handle: null, source: 'other', preferred_channel: null, interest: null, needs: null, budget: null, stage: 'new', deal_value: 0, expected_close_date: null, notes: null };
  const reasons = [];
  let unrecognizedSource = false;
  let unrecognizedChannel = false;
  for (let col = 0; col < mapping.length; col += 1) {
    const field = mapping[col];
    if (!LEAD_FIELDS.includes(field)) continue;
    const value = String(raw[col] ?? '').trim();
    if (field === 'source') { const result = normalizeSource(value); lead.source = result.value; if (value && !result.recognized) unrecognizedSource = true; }
    else if (field === 'preferred_channel') { const result = normalizePreferredChannel(value); lead.preferred_channel = result.value || null; if (value && !result.recognized) unrecognizedChannel = true; }
    else if (field === 'stage') lead.stage = normalizeStage(value);
    else if (field === 'budget' || field === 'deal_value') { const amount = parseMoney(value); lead[field] = amount === '' ? null : amount; }
    else if (field === 'expected_close_date') {
      const date = parseImportDate(value);
      lead.expected_close_date = date.value;
      if (!date.valid) reasons.push('bad date');
    } else lead[field] = value || null;
  }
  lead.name = String(lead.name ?? '').trim();
  if (!lead.name) reasons.push('missing name');
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) reasons.push('bad email');
  return { lead, reasons: [...new Set(reasons)], unrecognizedSource, unrecognizedChannel };
}

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeSocialHandle(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^@/, '');
}

function normalizeDuplicateSource(value) {
  return String(value ?? '').trim().toLowerCase();
}

function addToIndex(index, keyValue, item) {
  if (!keyValue) return;
  const list = index.get(keyValue) || [];
  list.push(item);
  index.set(keyValue, list);
}

function addMatches(target, candidates, type) {
  for (const candidate of candidates || []) {
    target.push({ type, name: String(candidate.name || '').trim() || 'Unnamed lead' });
  }
}

export function findDuplicateMatches(records, existing = []) {
  const existingEmails = new Map(), existingPhones = new Map(), existingSocials = new Map();
  const priorEmails = new Map(), priorPhones = new Map();
  for (const lead of existing) {
    addToIndex(existingEmails, normalizeEmail(lead.email), lead);
    addToIndex(existingPhones, normalizePhone(lead.phone), lead);
    const socialKey = normalizeSocialHandle(lead.social_handle) + '|' + normalizeDuplicateSource(lead.source);
    if (normalizeSocialHandle(lead.social_handle) && normalizeDuplicateSource(lead.source)) addToIndex(existingSocials, socialKey, lead);
  }

  const matchesByIndex = new Map();
  records.forEach((record, index) => {
    const lead = record.lead || record.validation?.lead || record;
    const email = normalizeEmail(lead.email);
    const phone = normalizePhone(lead.phone);
    const handle = normalizeSocialHandle(lead.social_handle);
    const source = normalizeDuplicateSource(lead.source);
    const exactMatches = [];
    addMatches(exactMatches, [...(existingEmails.get(email) || []), ...(priorEmails.get(email) || [])], 'email');
    addMatches(exactMatches, [...(existingPhones.get(phone) || []), ...(priorPhones.get(phone) || [])], 'phone');

    const possibleMatches = [];
    if (handle && source) {
      const socialKey = handle + '|' + source;
      addMatches(possibleMatches, existingSocials.get(socialKey) || [], 'social_handle_and_source');
    }
    if (exactMatches.length || possibleMatches.length) {
      matchesByIndex.set(index, {
        kind: exactMatches.length ? 'exact' : 'possible',
        matches: exactMatches.length ? exactMatches : possibleMatches,
      });
    }

    addToIndex(priorEmails, email, lead);
    addToIndex(priorPhones, phone, lead);
  });
  return matchesByIndex;
}

export function findDuplicateIndexes(records, existing = []) {
  return new Set(findDuplicateMatches(records, existing).keys());
}

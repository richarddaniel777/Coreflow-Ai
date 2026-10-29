import { createLeadsBatch, getAllLeadsForDuplicateCheck } from '../api/leads.js';
import { LEAD_SOURCES, PREFERRED_CHANNELS, LEAD_STAGES } from '../lib/constants.js';
import { parseCsv, guessField, normalizeAndValidateRow, findDuplicateMatches } from '../lib/csv.js';

const FIELDS = [
  ['name', 'Name'], ['company', 'Company'], ['phone', 'Phone'], ['email', 'Email'], ['social_handle', 'Social handle / username'],
  ['source', 'Source'], ['preferred_channel', 'Preferred channel'], ['interest', 'Interest'], ['needs', 'Needs'], ['budget', 'Budget'],
  ['stage', 'Stage'], ['deal_value', 'Deal value'], ['expected_close_date', 'Expected close date'], ['notes', 'Notes'],
];
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;
const SAMPLE_URL = './samples/leads-sample.csv';

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}
function button(label, className, action) {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function labelForField(value) { return FIELDS.find(([key]) => key === value)?.[1] || 'Ignore column'; }
function humanHeaders(headers) { return headers.map((header, i) => header || 'Column ' + (i + 1)); }
function escapeCsvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
function downloadRows(headers, rows) {
  const output = [headers.concat('Import reason').map(escapeCsvCell).join(',')];
  rows.forEach(({ raw, reason }) => output.push(headers.map((_, i) => escapeCsvCell(raw[i] || '')).concat(escapeCsvCell(reason)).join(',')));
  const blob = new Blob(['\uFEFF' + output.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = el('a');
  anchor.href = url;
  anchor.download = 'coreflow-lead-import-results.csv';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function countReason(reports, phrase) { return reports.filter((item) => item.validation.reasons.includes(phrase)).length; }

function isDuplicateIncluded(match, includeExactDuplicates, includePossibleDuplicates) {
  return match.kind === 'exact' ? includeExactDuplicates : includePossibleDuplicates;
}
function formatDuplicateMatch(match) {
  const detail = match.matches.map((item) => {
    const kind = item.type === 'email' ? 'same email as ' : item.type === 'phone' ? 'same phone as ' : 'same handle and source as ';
    return kind + item.name;
  }).join('; ');
  return (match.kind === 'exact' ? 'Exact duplicate' : 'Possible duplicate') + (detail ? ' · ' + detail : '');
}

export function initCsvImport({ button: openButton, dialog, content, onImported }) {
  let file = null, parsed = null, headers = [], rawRows = [], mapping = [], reports = [];
  let includeExactDuplicates = false, includePossibleDuplicates = false, importing = false, resultRows = [];
  const closeButton = dialog.querySelector('[data-csv-close]');

  function close() {
    if (importing) return;
    dialog.close();
    reset();
  }
  function reset() {
    file = null; parsed = null; headers = []; rawRows = []; mapping = []; reports = []; includeExactDuplicates = false; includePossibleDuplicates = false; resultRows = [];
    content.replaceChildren();
  }
  function setError(message, target) {
    const area = target || content.querySelector('.csv-import-error');
    if (area) area.textContent = message || '';
  }
  function base() {
    content.replaceChildren();
    const wrapper = el('div', 'csv-import-content');
    content.append(wrapper);
    return wrapper;
  }
  function renderUpload(error = '') {
    const wrapper = base();
    const intro = el('p', 'muted', 'Choose a CSV file up to 5 MB. Your file is read in this browser and is not uploaded elsewhere.');
    const field = el('div', 'ui-field');
    const fileLabel = el('label', 'ui-label', 'CSV file');
    fileLabel.htmlFor = 'csv-file-input';
    const input = el('input', 'ui-input');
    input.id = 'csv-file-input'; input.type = 'file'; input.accept = '.csv,text/csv'; input.required = true;
    input.addEventListener('change', () => { file = input.files?.[0] || null; });
    field.append(fileLabel, input);
    const sample = el('a', 'ui-button ui-button--ghost', 'Download sample CSV');
    sample.href = SAMPLE_URL; sample.download = 'leads-sample.csv';
    const errorNode = el('p', 'csv-import-error', error); errorNode.setAttribute('role', 'alert');
    const actions = el('div', 'csv-import-actions');
    actions.append(sample, button('Continue', 'ui-button ui-button--primary', async () => {
      const candidate = input.files?.[0] || file;
      if (!candidate) return setError('Choose a .csv file to continue.', errorNode);
      if (!candidate.name.toLowerCase().endsWith('.csv')) return setError('Choose a file with the .csv extension.', errorNode);
      if (candidate.size > MAX_FILE_BYTES) return setError('This file is larger than 5 MB. Choose a smaller CSV file.', errorNode);
      const next = actions.querySelector('button:last-child');
      next.disabled = true; next.textContent = 'Reading…';
      try {
        parsed = parseCsv(await candidate.text());
        if (!parsed.headers.length) throw new Error('The CSV is empty or has no header row.');
        if (!parsed.rows.length) throw new Error('The CSV has a header row but no lead rows to import.');
        if (parsed.rows.length > MAX_ROWS) throw new Error('This CSV has ' + parsed.rows.length + ' data rows. The maximum is 2,000 rows per import.');
        file = candidate; headers = humanHeaders(parsed.headers); rawRows = parsed.rows; mapping = [];
        renderMapping();
      } catch (err) {
        next.disabled = false; next.textContent = 'Continue';
        setError(err?.message || 'The CSV could not be read.', errorNode);
      }
    }));
    wrapper.append(intro, field, errorNode, actions);
    input.focus();
  }
  function renderMapping(error = '') {
    const wrapper = base();
    wrapper.append(el('p', 'muted', 'Match each CSV column to a lead field. Nothing is remembered after this import. Map at least one column to Name.'));
    const list = el('div', 'csv-mapping-list');
    const used = new Set();
    if (mapping.length !== headers.length) mapping = headers.map((header) => {
      let guess = guessField(header);
      if (guess !== 'ignore' && used.has(guess)) guess = 'ignore';
      if (guess !== 'ignore') used.add(guess);
      return guess;
    });
    headers.forEach((header, index) => {
      const row = el('label', 'csv-mapping-row');
      const title = el('span', 'csv-mapping-header', header);
      const select = el('select', 'ui-select');
      select.dataset.column = String(index);
      [['ignore', 'Ignore column'], ...FIELDS].forEach(([value, label]) => {
        const option = el('option', '', label); option.value = value; select.append(option);
      });
      select.value = mapping[index];
      select.addEventListener('change', () => { mapping[index] = select.value; });
      row.append(title, select); list.append(row);
    });
    const errorNode = el('p', 'csv-import-error', error); errorNode.setAttribute('role', 'alert');
    const actions = el('div', 'csv-import-actions');
    actions.append(button('Back', 'ui-button ui-button--secondary', () => renderUpload()), button('Preview import', 'ui-button ui-button--primary', async (event) => {
      if (!mapping.includes('name')) return setError('Map a CSV column to Name before previewing.', errorNode);
      const previewButton = event.currentTarget;
      previewButton.disabled = true;
      const loading = base();
      const loadingRow = el('div', 'csv-loading');
      const spinner = el('span', 'ui-spinner'); spinner.setAttribute('aria-hidden', 'true');
      loadingRow.append(spinner, document.createTextNode('Checking all existing leads for duplicates…'));
      loading.append(loadingRow);
      try {
        const existing = await getAllLeadsForDuplicateCheck();
        reports = rawRows.map((raw) => ({ raw, validation: normalizeAndValidateRow(raw, mapping), match: null, failure: '' }));
        const validIndexMap = reports.map((report, index) => report.validation.reasons.length ? -1 : index).filter((index) => index >= 0);
        const validReports = validIndexMap.map((index) => reports[index]);
        const matches = findDuplicateMatches(validReports, existing);
        const validPositionByRow = new Map(validIndexMap.map((rowIndex, validIndex) => [rowIndex, validIndex]));
        reports.forEach((report, index) => { report.match = matches.get(validPositionByRow.get(index)) || null; });
        includeExactDuplicates = false;
        includePossibleDuplicates = false;
        renderPreview();
      } catch (error) {
        renderMapping(error?.message || 'Existing leads could not be loaded for duplicate checking. Try again.');
      }
    }));
    wrapper.append(list, errorNode, actions);
  }
  function renderPreview() {
    const wrapper = base();
    const invalidCount = reports.filter((item) => item.validation.reasons.length).length;
    const exactCount = reports.filter((item) => item.match?.kind === 'exact').length;
    const possibleCount = reports.filter((item) => item.match?.kind === 'possible').length;
    const unrecognized = reports.filter((item) => item.validation.unrecognizedSource).length;
    const unrecognizedValues = reports.filter((item) => item.validation.unrecognizedSource || item.validation.unrecognizedChannel).length;
    const stats = el('div', 'csv-import-summary');
    [['Total rows', reports.length], ['Valid', reports.length - invalidCount], ['Invalid', invalidCount], ['Exact duplicates', exactCount], ['Possible duplicates', possibleCount], ['Unrecognized sources', unrecognized], ['Rows with unrecognized source/channel', unrecognizedValues]].forEach(([title, number]) => {
      const stat = el('div', 'csv-import-stat'); stat.append(el('span', 'muted', title), el('strong', '', number)); stats.append(stat);
    });
    wrapper.append(el('p', 'muted', 'Previewing the first ' + Math.min(10, reports.length) + ' rows as they will be imported. Invalid rows are always skipped.'), stats);
    const reasons = el('p', 'muted', 'Invalid reasons: missing name ' + countReason(reports, 'missing name') + ', bad email ' + countReason(reports, 'bad email') + ', bad date ' + countReason(reports, 'bad date') + '.');
    wrapper.append(reasons);
    const choice = el('fieldset', 'csv-duplicate-choice');
    choice.append(el('legend', '', 'Duplicate choices (skipped by default)'));
    const exactOption = el('label');
    const exactCheckbox = document.createElement('input'); exactCheckbox.type = 'checkbox'; exactCheckbox.checked = includeExactDuplicates; exactCheckbox.disabled = exactCount === 0;
    exactCheckbox.addEventListener('change', () => { includeExactDuplicates = exactCheckbox.checked; });
    exactOption.append(exactCheckbox, document.createTextNode(' Import exact duplicates anyway (' + exactCount + ')'));
    const possibleOption = el('label');
    const possibleCheckbox = document.createElement('input'); possibleCheckbox.type = 'checkbox'; possibleCheckbox.checked = includePossibleDuplicates; possibleCheckbox.disabled = possibleCount === 0;
    possibleCheckbox.addEventListener('change', () => { includePossibleDuplicates = possibleCheckbox.checked; });
    possibleOption.append(possibleCheckbox, document.createTextNode(' Import possible duplicates (' + possibleCount + ')'));
    choice.append(exactOption, possibleOption);
    wrapper.append(choice);
    const tableWrap = el('div', 'csv-preview-wrap');
    const table = el('table', 'csv-preview');
    const fields = ['name', 'company', 'phone', 'email', 'social_handle', 'source', 'preferred_channel', 'budget', 'stage', 'deal_value', 'expected_close_date'];
    const thead = el('thead'), headRow = el('tr');
    [...fields.map(labelForField), 'Row status'].forEach((title) => headRow.append(el('th', '', title)));
    thead.append(headRow); table.append(thead);
    const tbody = el('tbody');
    reports.slice(0, 10).forEach((report, index) => {
      const tr = el('tr');
      if (report.validation.reasons.length || report.match) tr.classList.add('is-flagged');
      fields.forEach((field) => {
        let value = report.validation.lead[field];
        if (field === 'source') value = LEAD_SOURCES.find((item) => item.value === value)?.label || value;
        if (field === 'preferred_channel') value = PREFERRED_CHANNELS.find((item) => item.value === value)?.label || value || '';
        if (field === 'stage') value = LEAD_STAGES.find((item) => item.value === value)?.label || value;
        tr.append(el('td', '', value ?? ''));
      });
      const rowReasons = report.validation.reasons.slice();
      if (report.match) rowReasons.push(formatDuplicateMatch(report.match));
      if (report.validation.unrecognizedSource) rowReasons.push('unrecognized source → Other');
      if (report.validation.unrecognizedChannel) rowReasons.push('unrecognized preferred channel');
      tr.append(el('td', '', rowReasons.join('; ') || 'Ready'));
      tbody.append(tr);
    });
    table.append(tbody); tableWrap.append(table); wrapper.append(tableWrap);
    const errorNode = el('p', 'csv-import-error', ''); errorNode.setAttribute('role', 'alert');
    const actions = el('div', 'csv-import-actions');
    actions.append(button('Back to mapping', 'ui-button ui-button--secondary', () => renderMapping()), button('Import leads', 'ui-button ui-button--primary', () => runImport(errorNode)));
    wrapper.append(errorNode, actions);
  }
  async function runImport(errorNode) {
    const eligible = reports.map((report, index) => ({ report, index })).filter(({ report }) => !report.validation.reasons.length && (!report.match || (report.match.kind === 'exact' ? includeExactDuplicates : includePossibleDuplicates)));
    importing = true;
    dialog.querySelectorAll('button').forEach((node) => { if (node !== closeButton) node.disabled = true; });
    closeButton.disabled = true;
    const wrapper = base();
    wrapper.append(el('p', '', 'Importing leads in batches of up to 100…'));
    const progress = document.createElement('progress'); progress.className = 'csv-progress'; progress.max = Math.max(1, eligible.length); progress.value = 0; wrapper.append(progress);
    const progressText = el('p', 'muted', '0 of ' + eligible.length + ' processed'); wrapper.append(progressText);
    if (!eligible.length) progressText.textContent = 'No rows need inserting. Preparing the result summary…';
    let imported = 0;
    for (let offset = 0; offset < eligible.length; offset += 100) {
      const batch = eligible.slice(offset, offset + 100);
      try {
        await createLeadsBatch(batch.map(({ report }) => report.validation.lead));
        imported += batch.length;
      } catch (error) {
        const reason = error?.message || 'Batch insert failed.';
        batch.forEach(({ report }) => { report.failure = reason; });
      }
      progress.value = Math.min(offset + batch.length, eligible.length);
      progressText.textContent = progress.value + ' of ' + eligible.length + ' processed';
    }
    importing = false;
    closeButton.disabled = false;
    resultRows = reports.flatMap((report) => {
      const reasons = report.validation.reasons.slice();
      if (report.match && !isDuplicateIncluded(report.match, includeExactDuplicates, includePossibleDuplicates)) reasons.push(formatDuplicateMatch(report.match) + ' · skipped');
      if (report.failure) reasons.push('insert failed: ' + report.failure);
      return reasons.length ? [{ raw: report.raw, reason: reasons.join('; ') }] : [];
    });
    let refreshError = '';
    try { await onImported?.(); } catch (error) { refreshError = error?.message || 'The leads list could not refresh.'; }
    renderFinished(imported, reports.filter((report) => report.match?.kind === 'exact' && !includeExactDuplicates).length, reports.filter((report) => report.match?.kind === 'possible' && !includePossibleDuplicates).length, reports.filter((report) => report.failure).length, reports.filter((report) => report.validation.reasons.length).length, refreshError);
  }
  function renderFinished(imported, exactSkipped, possibleSkipped, failed, invalid, refreshError) {
    const wrapper = base();
    wrapper.append(el('h3', '', 'Import complete'));
    wrapper.append(el('p', '', imported + ' imported · ' + exactSkipped + ' exact duplicates skipped · ' + possibleSkipped + ' possible duplicates skipped · ' + invalid + ' invalid rows skipped · ' + failed + ' failed.'));
    if (refreshError) wrapper.append(el('p', 'csv-import-error', 'Import finished, but the leads list could not refresh: ' + refreshError));
    if (resultRows.length) {
      wrapper.append(el('p', 'muted', 'Invalid, skipped duplicate, and failed rows are included with their reason.'));
      wrapper.append(button('Download failed/skipped rows as CSV', 'ui-button ui-button--secondary', () => downloadRows(headers, resultRows)));
    } else wrapper.append(el('p', 'muted', 'All rows were imported successfully.'));
    const actions = el('div', 'csv-import-actions');
    actions.append(button('Done', 'ui-button ui-button--primary', close)); wrapper.append(actions);
  }

  openButton.addEventListener('click', () => { reset(); renderUpload(); dialog.showModal(); content.querySelector('input[type="file"]')?.focus(); });
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => { if (importing) event.preventDefault(); else reset(); });
  renderUpload();
}

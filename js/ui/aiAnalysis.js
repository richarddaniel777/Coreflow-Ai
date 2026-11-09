function node(tag, text = '', className = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== null && text !== undefined) element.textContent = String(text);
  return element;
}

function section(title, entries, renderEntry = (entry) => String(entry ?? '')) {
  const block = node('section', '', 'ai-analysis-section');
  block.append(node('h3', title));
  if (!entries?.length) block.append(node('p', 'No items to show.'));
  else {
    const list = node('ul');
    entries.forEach((entry) => list.append(node('li', renderEntry(entry))));
    block.append(list);
  }
  return block;
}

export function renderAiAnalysis(container, badge, analysis) {
  container.replaceChildren();
  if (!analysis || typeof analysis !== 'object') {
    badge.hidden = true;
    return;
  }
  const priority = ['high', 'medium', 'low'].includes(analysis.priority) ? analysis.priority : 'neutral';
  badge.hidden = false;
  badge.className = 'ui-badge ui-badge--' + (priority === 'high' ? 'danger' : priority === 'medium' ? 'warning' : priority === 'low' ? 'success' : 'neutral');
  badge.textContent = Number.isInteger(analysis.score) ? `${analysis.score}/100 · ${priority} priority` : 'Analysis available';
  container.append(node('p', analysis.summary || '', 'ai-analysis-summary'));
  const grid = node('div', '', 'ai-analysis-grid');
  grid.append(section('Evidence', analysis.evidence, (entry) => `${entry.point} (Source: ${entry.source_field})`));
  grid.append(section('Assumptions', analysis.assumptions, (entry) => `${entry.point} (Confidence: ${entry.confidence})`));
  grid.append(section('Missing information', analysis.missing_info));
  grid.append(section('Recommended next action', analysis.recommended_next_action ? [analysis.recommended_next_action] : []));
  container.append(grid);
  if (analysis.analyzed_at || analysis.model) container.append(node('p', `Analyzed ${analysis.analyzed_at ? new Date(analysis.analyzed_at).toLocaleString() : ''}${analysis.model ? ` · ${analysis.model}` : ''}`, 'score-meta'));
}

export function analysisIsStale(lead, activities, analysis) {
  if (!analysis?.analyzed_at) return false;
  const snapshot = analysis.source_lead_snapshot;
  if (snapshot && Object.entries(snapshot).some(([key, value]) => String(lead[key] ?? '') !== String(value ?? ''))) return true;
  const analyzedAt = new Date(analysis.analyzed_at).getTime();
  if (!Number.isFinite(analyzedAt)) return false;
  return activities.some((activity) => {
    const createdAt = activity.created_at ? new Date(activity.created_at).getTime() : new Date(activity.occurred_at).getTime();
    return Number.isFinite(createdAt) && createdAt > analyzedAt;
  });
}

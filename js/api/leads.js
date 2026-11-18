import { supabase } from './supabase.js';
import { createActivity } from './activities.js';
import { todayLocalDate, addDays } from '../lib/dates.js';

export async function getLeads({ from = 0, pageSize = 50 } = {}) {
  const { data, error } = await supabase.from('leads').select('*').order('last_activity_at', { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw error;
  return data || [];
}

function localMidnightIso(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day).toISOString();
}

async function getStatusLeadIds(status, quietAfterDays) {
  const pageSize = 1000;
  const ids = [];
  const quietCutoff = localMidnightIso(addDays(todayLocalDate(), -Math.max(0, Number(quietAfterDays ?? 5))));
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from('lead_activity_summary').select('lead_id').order('lead_id', { ascending: true }).range(from, from + pageSize - 1);
    query = query.not('lead_stage', 'in', '("won","lost")');
    if (status === 'needs_reply') query = query.eq('last_direction', 'inbound');
    else if (status === 'gone_quiet') {
      query = query.eq('open_task_count', 0).or(`last_real_activity_at.lt.${quietCutoff},and(last_real_activity_at.is.null,lead_created_at.lt.${quietCutoff})`);
    } else return null;
    const { data, error } = await query;
    if (error) throw error;
    const page = data || [];
    ids.push(...page.map((row) => row.lead_id));
    if (page.length < pageSize) return ids;
  }
}

export async function getLeadsPage({ page = 1, pageSize = 50, search = '', stage = '', source = '', status = '', priority = '', sort = '', scoreSort = '', quietAfterDays = 5 } = {}) {
  const safePageSize = [25, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 50;
  const safePage = Math.max(1, Number(page) || 1);
  const statusIds = status ? await getStatusLeadIds(status, quietAfterDays) : null;
  if (statusIds && statusIds.length === 0) return { data: [], count: 0, page: safePage, pageSize: safePageSize };

  let query = supabase.from('leads').select('*', { count: 'exact' });
  if (statusIds) query = query.in('id', statusIds);
  if (search.trim()) {
    const term = search.trim().replace(/[^\p{L}\p{N}\s@.+-]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (term) query = query.or(['name', 'company', 'phone', 'email'].map((field) => `${field}.ilike.%${term}%`).join(','));
  }
  if (stage) query = query.eq('stage', stage);
  if (source) query = query.eq('source', source);
  if (priority === 'unscored') query = query.is('ai_score', null);
  else if (priority) query = query.eq('ai_analysis->>priority', priority);

  if (scoreSort === 'score_asc') query = query.order('ai_score', { ascending: true, nullsFirst: false });
  else if (scoreSort === 'score_desc') query = query.order('ai_score', { ascending: false, nullsFirst: false });
  else if (sort === 'deal_value') query = query.order('deal_value', { ascending: false }).order('last_activity_at', { ascending: false });
  else query = query.order('last_activity_at', { ascending: false });
  query = query.order('id', { ascending: true }).range((safePage - 1) * safePageSize, safePage * safePageSize - 1);

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: data || [], count: count || 0, page: safePage, pageSize: safePageSize };
}

export async function getUnscoredLeadCandidates() {
  const pageSize = 50;
  const candidates = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from('leads').select('id,name,ai_score').is('ai_score', null).order('id', { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    candidates.push(...page);
    if (page.length < pageSize) return candidates;
  }
}

export async function getAllLeadsForDuplicateCheck() {
  const pageSize = 1000;
  const leads = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, email, phone, social_handle, source')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    leads.push(...page);
    if (page.length < pageSize) return leads;
  }
}

export async function getLead(id) {
  const { data, error } = await supabase.from('leads').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createLead(values) {
  const { data, error } = await supabase.from('leads').insert(values).select('*').single();
  if (error) throw error;
  return data;
}

export async function createLeadsBatch(values) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const { data, error } = await supabase.from('leads').insert(values).select('*');
  if (error) throw error;
  return data || [];
}

export async function updateLead(id, values, previousStage) {
  const { data, error } = await supabase.from('leads').update(values).eq('id', id).select('*').single();
  if (error) throw error;
  if (previousStage && values.stage && previousStage !== values.stage) {
    try {
      await createActivity({ lead_id: id, type: 'stage_change', content: previousStage + ' to ' + values.stage, occurred_at: new Date().toISOString() });
    } catch {
      throw new Error('Lead saved, but the stage-change activity could not be recorded. Reload and check the lead timeline.');
    }
  }
  return data;
}

export async function deleteLead(id) {
  const { error } = await supabase.from('leads').delete().eq('id', id);
  if (error) throw error;
}

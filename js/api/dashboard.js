import { supabase } from './supabase.js';

export async function getLeadActivitySummary(leadIds = null) {
  if (Array.isArray(leadIds) && leadIds.length === 0) return [];
  let query = supabase.from('lead_activity_summary').select('*');
  if (Array.isArray(leadIds)) query = query.in('lead_id', leadIds);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

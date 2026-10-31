import { supabase } from './supabase.js';

export async function getLeadActivitySummary() {
  const { data, error } = await supabase.from('lead_activity_summary').select('*');
  if (error) throw error;
  return data || [];
}

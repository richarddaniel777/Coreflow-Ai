import { supabase } from './supabase.js';

export async function getActivitiesForLead(leadId) {
  const { data, error } = await supabase.from('activities').select('*').eq('lead_id', leadId).order('occurred_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getActivitiesForLeads(leadIds) {
  if (!leadIds.length) return [];
  const { data, error } = await supabase.from('activities').select('*').in('lead_id', leadIds).order('occurred_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createActivity(values) {
  const { data, error } = await supabase.from('activities').insert(values).select('*').single();
  if (error) throw error;
  return data;
}

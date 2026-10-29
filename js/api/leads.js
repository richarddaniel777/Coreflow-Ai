import { supabase } from './supabase.js';
import { createActivity } from './activities.js';

export async function getLeads() {
  const { data, error } = await supabase.from('leads').select('*').order('last_activity_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getLead(id) {
  const { data, error } = await supabase.from('leads').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getBusinessProfile() {
  const { data, error } = await supabase.from('business_profiles').select('currency, quiet_after_days').maybeSingle();
  if (error) throw error;
  return data || { currency: 'USD', quiet_after_days: 5 };
}

export async function createLead(values) {
  const { data, error } = await supabase.from('leads').insert(values).select('*').single();
  if (error) throw error;
  return data;
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

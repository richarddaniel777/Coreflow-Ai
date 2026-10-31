import { supabase } from './supabase.js';
import { createActivity } from './activities.js';

export async function getTasksForLead(leadId) {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, lead_id, title, due_date, completed, completed_at, created_at')
    .eq('lead_id', leadId)
    .eq('completed', false)
    .order('due_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getOpenTasksWithLeads() {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, lead_id, title, due_date, completed, completed_at, lead:leads!tasks_lead_user_fkey!inner(id, name, stage)')
    .eq('completed', false)
    .order('due_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createTask(values) {
  const { data, error } = await supabase.from('tasks').insert(values).select('*').single();
  if (error) throw error;
  return data;
}

export async function updateTask(id, values) {
  const { data, error } = await supabase.from('tasks').update(values).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export async function completeTask(task) {
  const completedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('tasks')
    .update({ completed: true, completed_at: completedAt })
    .eq('id', task.id)
    .select('*')
    .single();
  if (error) throw error;
  try {
    await createActivity({
      lead_id: task.lead_id,
      type: 'note',
      content: 'Completed: ' + task.title,
      occurred_at: completedAt,
    });
  } catch {
    throw new Error('The task was completed, but its timeline note could not be saved. Reload the lead and check the activity timeline.');
  }
  return data;
}

export async function deleteTask(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

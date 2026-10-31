import { createTask, updateTask, completeTask, deleteTask } from '../api/tasks.js';
import { addDays, todayLocalDate } from '../lib/dates.js';
import { isOpen } from '../lib/leadStatus.js';

export function createTaskController({ dialog, form, resolveLead, onChanged, showNotice }) {
  let currentLead = null;
  let currentTask = null;
  const titleNode = dialog.querySelector('[data-task-dialog-title]');
  const messageNode = dialog.querySelector('[data-task-dialog-message]');
  const leadNameNode = dialog.querySelector('[data-task-dialog-lead]');
  const submitButton = dialog.querySelector('[data-task-submit]');
  const dueField = form.elements.due_date;
  const taskTitle = form.elements.title;

  function openSchedule(lead, next = false) {
    if (!lead || !isOpen(lead)) return;
    currentLead = lead; currentTask = null;
    titleNode.textContent = next ? 'Schedule the next follow-up?' : 'Schedule follow-up';
    leadNameNode.textContent = lead.name;
    taskTitle.value = 'Follow up with ' + lead.name;
    dueField.value = addDays(todayLocalDate(), 1);
    messageNode.textContent = '';
    submitButton.textContent = 'Schedule follow-up';
    dialog.showModal();
    taskTitle.focus();
  }
  function edit(task) {
    const lead = task.lead || resolveLead(task.lead_id);
    if (!lead || !isOpen(lead)) return;
    currentLead = lead; currentTask = task;
    titleNode.textContent = 'Edit follow-up';
    leadNameNode.textContent = lead.name;
    taskTitle.value = task.title;
    dueField.value = task.due_date;
    messageNode.textContent = '';
    submitButton.textContent = 'Save changes';
    dialog.showModal();
    taskTitle.focus();
  }
  async function changed(message = '') {
    await onChanged?.();
    if (message) showNotice?.(message, 'success');
  }
  async function complete(task) {
    const lead = task.lead || resolveLead(task.lead_id);
    if (!lead || !isOpen(lead)) return;
    try {
      await completeTask(task);
      await changed('Follow-up completed and added to the activity timeline.');
      openSchedule(lead, true);
    } catch (error) {
      try { await onChanged?.(); } catch { /* Keep the original action error visible. */ }
      showNotice?.(error?.message || 'The follow-up could not be completed.', 'error');
    }
  }
  async function snooze(task, days) {
    const lead = task.lead || resolveLead(task.lead_id);
    if (!lead || !isOpen(lead)) return;
    try {
      await updateTask(task.id, { due_date: addDays(todayLocalDate(), days) });
      await changed('Follow-up snoozed by ' + days + (days === 1 ? ' day.' : ' days.'));
    } catch (error) { showNotice?.(error?.message || 'The follow-up could not be snoozed.', 'error'); }
  }
  async function remove(task) {
    const lead = task.lead || resolveLead(task.lead_id);
    if (!lead || !isOpen(lead)) return;
    if (!window.confirm('Delete the follow-up “' + task.title + '”?')) return;
    try {
      await deleteTask(task.id);
      await changed('Follow-up deleted.');
    } catch (error) { showNotice?.(error?.message || 'The follow-up could not be deleted.', 'error'); }
  }

  form.addEventListener('click', (event) => {
    const quick = event.target.closest('[data-due-offset]');
    if (quick) dueField.value = addDays(todayLocalDate(), Number(quick.dataset.dueOffset));
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentLead || !isOpen(currentLead) || !form.reportValidity()) return;
    const title = taskTitle.value.trim();
    const dueDate = dueField.value;
    if (!title || !dueDate) return;
    submitButton.disabled = true; submitButton.classList.add('is-loading');
    submitButton.textContent = currentTask ? 'Saving…' : 'Scheduling…';
    messageNode.textContent = '';
    try {
      const isEditing = Boolean(currentTask);
      if (currentTask) await updateTask(currentTask.id, { title, due_date: dueDate });
      else await createTask({ lead_id: currentLead.id, title, due_date: dueDate });
      dialog.close();
      await changed(isEditing ? 'Follow-up updated.' : 'Follow-up scheduled.');
    } catch (error) { messageNode.textContent = error?.message || 'The follow-up could not be saved.'; }
    finally {
      submitButton.disabled = false; submitButton.classList.remove('is-loading');
      submitButton.textContent = currentTask ? 'Save changes' : 'Schedule follow-up';
    }
  });
  dialog.querySelectorAll('[data-task-dialog-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => { currentTask = null; currentLead = null; });

  return { openSchedule, edit, complete, snooze, remove };
}

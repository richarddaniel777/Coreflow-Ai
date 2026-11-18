import { supabase } from '../api/supabase.js';
import { loadBusinessProfile, subscribeToBusinessProfile } from '../api/businessProfile.js';
import { getLeadActivitySummary } from '../api/dashboard.js';
import { getOpenTasksWithLeads } from '../api/tasks.js';
import { buildTodaySections, getAttentionCount } from '../lib/dashboardStatus.js';
import { initScrollHints } from '../lib/scrollHints.js';

export function currentAppRoute() {
  const page = window.location.pathname.split('/').pop()?.toLowerCase() || 'index.html';
  if (page === 'leads.html' || page === 'lead.html') return 'leads';
  if (page === 'index.html' || page === '') {
    const route = window.location.hash.slice(1).toLowerCase();
    return ['settings', 'analytics'].includes(route) ? route : 'dashboard';
  }
  return '';
}

export function updateActiveNavigation() {
  closeProfileMenu();
  const activeRoute = currentAppRoute();
  document.querySelectorAll('[data-app-route]').forEach((link) => {
    if (link.dataset.appRoute === activeRoute) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  return activeRoute;
}

function closeProfileMenu() {
  const menu = document.querySelector('[data-profile-menu]');
  const button = document.querySelector('[data-profile-menu-button]');
  if (!menu || !button) return;
  menu.hidden = true;
  document.querySelector('[data-profile-backdrop]')?.setAttribute('hidden', '');
  button.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('profile-menu-open');
}

function initialsFor(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'CF';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toLocaleUpperCase();
}

function renderCompanyProfile(profile) {
  const name = String(profile?.business_name || '').trim() || 'CoreFlow AI';
  document.querySelectorAll('[data-company-name]').forEach((node) => {
    node.textContent = name;
    node.title = name;
  });
  document.querySelectorAll('[data-profile-menu-button]').forEach((button) => { button.setAttribute('aria-label', `Open ${name} profile menu`); });
  document.querySelectorAll('[data-company-avatar]').forEach((node) => { node.textContent = initialsFor(name); });
  document.querySelectorAll('[data-profile-company]').forEach((node) => { node.textContent = name; });
  document.querySelectorAll('[data-company-logo]').forEach((image) => {
    const rawUrl = typeof profile?.logo_url === 'string' ? profile.logo_url.trim() : '';
    let safeUrl = '';
    try {
      const parsed = new URL(rawUrl, window.location.origin);
      if (['http:', 'https:'].includes(parsed.protocol)) safeUrl = parsed.href;
    } catch { /* An absent or invalid logo keeps the initials avatar visible. */ }
    image.alt = name + ' logo';
    const fallback = image.parentElement?.querySelector('[data-company-avatar]');
    image.onerror = () => {
      image.hidden = true;
      if (fallback) fallback.hidden = false;
    };
    image.onload = () => {
      if (fallback) fallback.hidden = true;
    };
    image.hidden = !safeUrl;
    image.removeAttribute('src');
    if (safeUrl) image.src = safeUrl;
    if (fallback) fallback.hidden = Boolean(safeUrl);
  });
}

function initProfileMenu(userEmail) {
  const button = document.querySelector('[data-profile-menu-button]');
  const menu = document.querySelector('[data-profile-menu]');
  const backdrop = document.querySelector('[data-profile-backdrop]');
  const wrapper = button?.closest('[data-profile-menu-wrap]');
  if (!button || !menu || !wrapper) return;
  const close = (restoreFocus = false) => {
    menu.hidden = true;
    if (backdrop) backdrop.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('profile-menu-open');
    if (restoreFocus) button.focus();
  };
  const open = () => {
    menu.hidden = false;
    if (backdrop) backdrop.hidden = false;
    document.body.classList.add('profile-menu-open');
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector('[role="menuitem"]')?.focus();
  };
  const menuItems = () => [...menu.querySelectorAll('[role="menuitem"]:not([disabled])')];
  button.addEventListener('click', () => menu.hidden ? open() : close());
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      open();
    }
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key === 'Tab') {
      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      const allFocusable = [...document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.getClientRects().length > 0);
      const triggerIndex = allFocusable.indexOf(button);
      const next = direction > 0
        ? allFocusable.slice(triggerIndex + 1).find((element) => !wrapper.contains(element))
        : allFocusable.slice(0, triggerIndex).reverse().find((element) => !wrapper.contains(element));
      close(false);
      (next || button).focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = menuItems();
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items[next].focus();
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key.length !== 1 || !/^[\p{L}\p{N}]$/u.test(event.key)) return;
    const item = menuItems().find((candidate) => candidate.textContent.trim().toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
    if (item) { event.preventDefault(); item.focus(); }
  });
  document.addEventListener('click', (event) => { if (!wrapper.contains(event.target)) close(false); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); close(true); } });
  backdrop?.addEventListener('click', () => close(true));
  document.querySelectorAll('[data-app-route]').forEach((link) => link.addEventListener('click', () => close(false)));
  const email = menu.querySelector('[data-profile-email]');
  if (email) email.textContent = String(userEmail || '');
  menu.querySelector('[data-app-route="settings"]')?.addEventListener('click', () => close(false));
  const logout = menu.querySelector('#logout-button');
  const message = menu.querySelector('[data-profile-menu-message]');
  logout?.addEventListener('click', async () => {
    logout.disabled = true;
    logout.textContent = 'Logging out…';
    if (message) message.textContent = '';
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      window.location.replace('./login.html');
    } catch {
      if (message) message.textContent = 'Could not log out. Check your connection and try again.';
      logout.disabled = false;
      logout.textContent = 'Log out';
    }
  });
}

function installDialogScrollLock() {
  const update = () => document.body.classList.toggle('has-open-dialog', Boolean(document.querySelector('dialog[open]')));
  new MutationObserver(update).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('close', update));
  update();
}

export function initAppNavigation(userEmail = '') {
  initProfileMenu(userEmail);
  initScrollHints();
  installDialogScrollLock();
  updateActiveNavigation();
  window.addEventListener('hashchange', updateActiveNavigation);
  subscribeToBusinessProfile(({ profile, error }) => {
    if (!error && profile) renderCompanyProfile(profile);
  });
  loadBusinessProfile().then(renderCompanyProfile).catch(() => renderCompanyProfile(null));
}

export function setAttentionBadge(sections) {
  const count = getAttentionCount(sections);
  document.querySelectorAll('[data-attention-count]').forEach((badge) => {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count === 0;
    badge.setAttribute('aria-label', count + ' items need attention');
    badge.title = count + ' needs-reply leads and overdue follow-ups';
  });
}

export async function refreshAttentionBadge() {
  try {
    const [summary, tasks] = await Promise.all([getLeadActivitySummary(), getOpenTasksWithLeads()]);
    setAttentionBadge(buildTodaySections(summary, tasks, 5));
  } catch {
    document.querySelectorAll('[data-attention-count]').forEach((badge) => { badge.hidden = true; });
  }
}

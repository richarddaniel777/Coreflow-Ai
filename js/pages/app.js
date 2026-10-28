import { supabase } from '../api/supabase.js';

const { data: { session }, error } = await supabase.auth.getSession();
if (error || !session) location.replace('./login.html');
else {
  document.querySelector('#account-email').textContent = session.user.email ?? '';
  document.querySelector('#app-shell').hidden = false;
}
const logoutButton = document.querySelector('#logout-button');
const status = document.querySelector('#app-message');
logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  status.textContent = 'Signing out…';
  let signOutError;
  try {
    ({ error: signOutError } = await supabase.auth.signOut());
  } catch (requestError) {
    status.textContent = requestError.message || 'Unable to sign out. Check your connection and try again.';
    logoutButton.disabled = false;
    return;
  }
  if (signOutError) { status.textContent = signOutError.message; logoutButton.disabled = false; return; }
  location.replace('./login.html');
});
const pageContent = {
  dashboard: ['Dashboard', 'Your sales dashboard will appear here.'],
  leads: ['Leads', 'Lead management will appear here.'],
  settings: ['Settings', 'Business settings will appear here.'],
};
document.querySelectorAll('[data-page]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  const [title, description] = pageContent[link.dataset.page];
  document.querySelector('#page-title').textContent = title;
  document.querySelector('#page-description').textContent = description;
  document.querySelectorAll('[data-page]').forEach((item) => item.setAttribute('aria-current', String(item === link))); 
}));

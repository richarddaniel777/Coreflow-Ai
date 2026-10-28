import { supabase } from '../api/supabase.js';

const form = document.querySelector('#auth-form');
const message = document.querySelector('#form-message');
const submit = form.querySelector('[type="submit"]');
const modeButtons = document.querySelectorAll('[data-mode]');
let mode = new URLSearchParams(location.search).get('mode') === 'signup' ? 'signup' : 'login';

function setMessage(text, kind = '') { message.textContent = text; message.dataset.kind = kind; }
function renderMode() {
  const signup = mode === 'signup';
  document.querySelector('#form-title').textContent = signup ? 'Create your account' : 'Welcome back';
  submit.textContent = signup ? 'Create account' : 'Log in';
  document.querySelector('#auth-switch').textContent = signup ? 'Already have an account?' : 'New to CoreFlow AI?';
  modeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
}
modeButtons.forEach((button) => button.addEventListener('click', () => { mode = button.dataset.mode; setMessage(''); renderMode(); }));
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  submit.disabled = true;
  setMessage(mode === 'signup' ? 'Creating your account…' : 'Signing in…', 'loading');
  let result;
  try {
    result = mode === 'signup'
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
  } catch (requestError) {
    submit.disabled = false;
    setMessage(requestError.message || 'Unable to reach Supabase. Check your connection and project settings.', 'error');
    return;
  }
  submit.disabled = false;
  if (result.error) { setMessage(result.error.message, 'error'); return; }
  if (mode === 'signup' && !result.data.session) {
    setMessage('Account created. Check your email to confirm your address, then log in.', 'success');
    return;
  }
  location.replace('./index.html');
});
const { data: { session } } = await supabase.auth.getSession();
if (session) location.replace('./index.html');
renderMode();

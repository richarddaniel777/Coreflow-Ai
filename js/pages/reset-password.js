import { supabase } from '../api/supabase.js';

const form = document.querySelector('#reset-form');
const message = document.querySelector('#recovery-message');
const submit = document.querySelector('#reset-submit');
const passwordInput = form.elements.password;
let recoveryReady = false;

function setMessage(text, kind = '') {
  message.textContent = text;
  message.dataset.kind = kind;
}

function showRecoveryForm() {
  recoveryReady = true;
  form.hidden = false;
  message.textContent = 'Reset link verified. Choose a new password.';
  message.dataset.kind = 'success';
}

function passwordError(error) {
  const code = String(error?.code || '').toLowerCase();
  const text = String(error?.message || '').toLowerCase();
  if (code.includes('weak_password') || text.includes('weak password') || text.includes('password should be at least')) {
    return 'Choose a password with at least 8 characters.';
  }
  if (error?.name === 'AuthRetryableFetchError' || text.includes('fetch') || text.includes('network')) {
    return 'Could not reach the account service. Check your connection and try again.';
  }
  return 'We could not update your password. Request a new reset link and try again.';
}

document.querySelectorAll('[data-password-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    button.textContent = showing ? 'Show' : 'Hide';
    button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    button.setAttribute('aria-pressed', String(!showing));
  });
});

// Subscribe before checking the current session so Supabase's recovery event is not missed.
const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY' && session) showRecoveryForm();
});

const urlParams = new URLSearchParams(location.search);
const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
const hasRecoveryMarker = urlParams.get('type') === 'recovery'
  || hashParams.get('type') === 'recovery'
  || urlParams.has('code');
if (urlParams.has('error') || hashParams.has('error')) {
  setMessage('This reset link is invalid or has expired. Request another reset link.', 'error');
} else {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) setMessage('We could not verify this reset link. Request another one.', 'error');
    else if (session && hasRecoveryMarker) showRecoveryForm();
    else if (!recoveryReady) setMessage('This reset link is invalid or has expired. Request another reset link.', 'error');
  } catch {
    setMessage('We could not verify this reset link. Check your connection and try again.', 'error');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!recoveryReady) return;
  const password = passwordInput.value;
  if (password.length < 8) {
    setMessage('Choose a password with at least 8 characters.', 'error');
    passwordInput.focus();
    return;
  }

  submit.disabled = true;
  submit.textContent = 'Updating password…';
  setMessage('Updating your password…', 'loading');
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage(passwordError(error), 'error');
      submit.disabled = false;
      submit.textContent = 'Update password';
      return;
    }
    setMessage('Password updated. Returning to log in…', 'success');
    try { await supabase.auth.signOut(); } catch { /* Password update already succeeded. */ }
    location.replace('./login.html?password=updated');
  } catch (error) {
    setMessage(passwordError(error), 'error');
    submit.disabled = false;
    submit.textContent = 'Update password';
  }
});

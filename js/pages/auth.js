import { supabase } from '../api/supabase.js';

const form = document.querySelector('#auth-form');
const message = document.querySelector('#form-message');
const submit = document.querySelector('#auth-submit');
const emailInput = form.elements.email;
const passwordInput = form.elements.password;
const confirmPasswordInput = form.elements.confirmPassword;
const confirmPasswordRow = document.querySelector('#confirm-password-row');
const modeButtons = document.querySelectorAll('[data-mode]');
const forgotButton = document.querySelector('#forgot-password-link');
const forgotRow = document.querySelector('#forgot-row');
const passwordRule = document.querySelector('#password-rule');
let mode = new URLSearchParams(location.search).get('mode') === 'signup' ? 'signup' : 'login';

function setMessage(text, kind = '') {
  message.textContent = text;
  message.dataset.kind = kind;
}

function readableAuthError(error, action) {
  const code = String(error?.code || '').toLowerCase();
  const text = String(error?.message || '').toLowerCase();
  if (code.includes('weak_password') || text.includes('weak password') || text.includes('password should be at least')) {
    return 'Choose a password with at least 8 characters.';
  }
  if (code.includes('user_already_exists') || code.includes('email_exists') || text.includes('already registered') || text.includes('already been registered')) {
    return 'An account already uses this email. Log in or reset your password.';
  }
  if (code.includes('email_not_confirmed') || text.includes('email not confirmed')) {
    return 'Confirm your email address from the link we sent, then try logging in.';
  }
  if (code.includes('invalid_credentials') || text.includes('invalid login credentials') || text.includes('invalid email or password')) {
    return 'That email and password do not match. Try again or reset your password.';
  }
  if (error?.name === 'AuthRetryableFetchError' || text.includes('fetch') || text.includes('network') || text.includes('failed to connect')) {
    return 'Could not reach the sign-in service. Check your connection and try again.';
  }
  return action === 'reset'
    ? 'We could not send the reset email right now. Check your connection and try again.'
    : 'We could not complete that request. Check your details and try again.';
}

function renderMode() {
  const signup = mode === 'signup';
  document.querySelector('#form-title').textContent = signup ? 'Create your account' : 'Welcome back';
  submit.textContent = signup ? 'Create account' : 'Log in';
  document.querySelector('#auth-switch').textContent = signup ? 'Already have an account?' : 'New to CoreFlow AI?';
  const switchLink = document.querySelector('#auth-switch-link');
  switchLink.textContent = signup ? 'Log in' : 'Sign up';
  switchLink.dataset.mode = signup ? 'login' : 'signup';
  forgotRow.hidden = signup;
  passwordRule.hidden = !signup;
  confirmPasswordRow.hidden = !signup;
  confirmPasswordInput.required = signup;
  passwordInput.autocomplete = signup ? 'new-password' : 'current-password';
  if (signup) passwordInput.setAttribute('minlength', '8');
  else passwordInput.removeAttribute('minlength');
  modeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
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

modeButtons.forEach((button) => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  setMessage('');
  renderMode();
}));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (mode === 'signup' && password.length < 8) {
    setMessage('Choose a password with at least 8 characters.', 'error');
    passwordInput.focus();
    return;
  }
  if (mode === 'signup' && password !== confirmPasswordInput.value) {
    setMessage('Passwords do not match. Please re-enter them.', 'error');
    confirmPasswordInput.focus();
    return;
  }

  submit.disabled = true;
  setMessage(mode === 'signup' ? 'Creating your account…' : 'Signing in…', 'loading');
  let result;
  try {
    result = mode === 'signup'
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
  } catch (error) {
    setMessage(readableAuthError(error, mode), 'error');
    submit.disabled = false;
    return;
  }
  submit.disabled = false;

  if (result.error) {
    setMessage(readableAuthError(result.error, mode), 'error');
    return;
  }
  if (mode === 'signup' && !result.data.session) {
    setMessage('Account created. Check your email to confirm your address, then log in.', 'success');
    return;
  }
  location.replace('./index.html');
});

forgotButton.addEventListener('click', async () => {
  if (!emailInput.value.trim() || !emailInput.checkValidity()) {
    setMessage('Enter the email address for your account above.', 'error');
    emailInput.focus();
    return;
  }
  forgotButton.disabled = true;
  setMessage('Sending reset link…', 'loading');
  try {
    const redirectTo = window.location.origin + '/reset-password.html';
    const { error } = await supabase.auth.resetPasswordForEmail(emailInput.value.trim(), { redirectTo });
    if (error) setMessage(readableAuthError(error, 'reset'), 'error');
    else setMessage('If that email exists, we sent a link.', 'success');
  } catch (error) {
    setMessage(readableAuthError(error, 'reset'), 'error');
  } finally {
    forgotButton.disabled = false;
  }
});

const resetComplete = new URLSearchParams(location.search).get('password') === 'updated';
const { data: { session } } = await supabase.auth.getSession();
if (session && !resetComplete) location.replace('./index.html');
renderMode();
if (resetComplete) setMessage('Your password has been updated. You can log in with your new password.', 'success');

import { supabase } from './supabase.js';

const LOGIN_NOTICE_KEY = 'coreflow-auth-redirect-message';

async function redirectToLogin(message) {
  try { sessionStorage.setItem(LOGIN_NOTICE_KEY, message); } catch { /* The login page still provides its regular session error handling. */ }
  try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* The redirect does not depend on local sign-out. */ }
  window.location.replace(new URL('./login.html', window.location.href).href);
}

async function readErrorBody(error) {
  try {
    const response = error?.context;
    if (response && typeof response.clone === 'function') return await response.clone().json();
  } catch { /* The SDK error still carries a useful status and message. */ }
  return null;
}

export async function invokeFunction(name, body) {
  let session = null;
  try {
    const { data, error } = await supabase.auth.getSession();
    session = error ? null : data?.session || null;
  } catch { /* Try one refresh below if reading the current session failed. */ }

  if (!session?.access_token) {
    try {
      const { data } = await supabase.auth.refreshSession();
      session = data?.session || null;
    } catch { session = null; }
  }

  const authorizationAttached = Boolean(session?.access_token);
  console.debug('[CoreFlow AI] Edge Function request', {
    function_name: name,
    session_exists: Boolean(session),
    authorization_attached: authorizationAttached,
  });

  if (!authorizationAttached) {
    await redirectToLogin('Your session expired, please log in again.');
    throw new Error('Your session expired, please log in again.');
  }

  const result = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!result.error) return result.data;

  const errorBody = await readErrorBody(result.error);
  if (errorBody?.code === 'UNAUTHORIZED_NO_AUTH_HEADER') {
    await redirectToLogin('Please log in again.');
    throw new Error('Please log in again.');
  }

  throw result.error;
}

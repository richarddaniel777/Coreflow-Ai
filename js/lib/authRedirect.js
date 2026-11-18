import { supabase } from '../api/supabase.js';

const LOGIN_NOTICE_KEY = 'coreflow-auth-redirect-message';

export async function redirectToLogin(message = 'Your session expired, please log in again.') {
  try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* The redirect does not depend on clearing a stale session. */ }
  try { sessionStorage.setItem(LOGIN_NOTICE_KEY, message); } catch { /* Login still works if storage is disabled. */ }
  window.location.replace(new URL('./login.html', window.location.href).href);
}

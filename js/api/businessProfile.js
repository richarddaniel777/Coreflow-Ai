import { supabase } from './supabase.js';
import { debugProfileState } from '../lib/businessProfile.js';

const allowedFields = [
  'business_name', 'business_type', 'products_services', 'pricing_notes',
  'ideal_customer', 'tone', 'currency', 'quiet_after_days',
];
const listeners = new Set();
const refreshKey = 'coreflow-business-profile-refresh';
let cachedProfile = null;
let cachedUserId = null;
let profileBroadcast = null;

function emptyProfile() {
  return { currency: 'USD', quiet_after_days: 5, products_services: '', ideal_customer: '' };
}

function notifyProfileChanged(profile, error = null) {
  listeners.forEach((listener) => listener({ profile, error }));
}

async function refreshFromPeer(source) {
  try {
    const profile = await loadBusinessProfile({ forceRefresh: true, source });
    notifyProfileChanged(profile);
  } catch (error) {
    notifyProfileChanged(null, error);
  }
}

if (typeof BroadcastChannel !== 'undefined') {
  profileBroadcast = new BroadcastChannel('coreflow-business-profile');
  profileBroadcast.addEventListener('message', (event) => {
    if (event.data?.type === 'refresh') refreshFromPeer('other-tab-refresh');
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === refreshKey) refreshFromPeer('other-tab-refresh');
  });
}

export function subscribeToBusinessProfile(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadBusinessProfile({ forceRefresh = false, source = 'profile-load' } = {}) {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    cachedProfile = null;
    cachedUserId = null;
    debugProfileState(null, false, source);
    throw new Error('Business profile could not be loaded. Please sign in again and retry.');
  }

  if (cachedProfile && cachedUserId === user.id && !forceRefresh) {
    debugProfileState(cachedProfile, true, source, user.id);
    return cachedProfile;
  }

  const { data, error } = await supabase
    .from('business_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    debugProfileState(null, false, source, user.id);
    throw new Error(`Business profile could not be loaded. ${error.message || 'Check your connection and retry.'}`);
  }

  cachedProfile = data || emptyProfile();
  cachedUserId = user.id;
  debugProfileState(cachedProfile, true, source, user.id);
  return cachedProfile;
}

export async function saveBusinessProfile(values) {
  const profileValues = Object.fromEntries(
    allowedFields
      .filter((field) => Object.prototype.hasOwnProperty.call(values, field))
      .map((field) => [field, values[field]]),
  );
  if (Object.keys(profileValues).length === 0) {
    throw new Error('There are no business profile changes to save.');
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error('Your session could not be verified. Please sign in again before saving Settings.');
  }

  const { data, error } = await supabase
    .from('business_profiles')
    .update(profileValues)
    .eq('user_id', user.id)
    .select('*')
    .maybeSingle();
  if (error) {
    throw new Error(`Business profile could not be saved. ${error.message || 'Please try again.'}`);
  }

  let savedProfile = data;
  if (!savedProfile) {
    const { data: inserted, error: insertError } = await supabase
      .from('business_profiles')
      .insert(profileValues)
      .select('*')
      .single();
    if (insertError) {
      if (insertError.code === '23505') {
        const { data: retried, error: retryError } = await supabase
          .from('business_profiles')
          .update(profileValues)
          .eq('user_id', user.id)
          .select('*')
          .maybeSingle();
        if (retryError || !retried) {
          throw new Error(`Business profile could not be saved. ${retryError?.message || insertError.message || 'Please try again.'}`);
        }
        savedProfile = retried;
      } else {
        throw new Error(`Business profile could not be created. ${insertError.message || 'Please try again.'}`);
      }
    } else savedProfile = inserted;
  }

  try {
    const refreshedProfile = await loadBusinessProfile({ forceRefresh: true, source: 'settings-save-refresh' });
    cachedProfile = refreshedProfile;
  } catch (refreshError) {
    // Keep the successful write visible in this tab even if the follow-up read fails.
    cachedProfile = savedProfile;
    cachedUserId = user.id;
    debugProfileState(null, false, 'settings-save-refresh', user.id);
    notifyProfileChanged(null, refreshError);
    throw new Error(`Business profile was saved, but could not be refreshed. ${refreshError.message}`);
  }

  notifyProfileChanged(cachedProfile);
  try {
    profileBroadcast?.postMessage({ type: 'refresh' });
    localStorage.setItem(refreshKey, `${Date.now()}-${Math.random()}`);
  } catch { /* Same-tab profile listeners have already been updated. */ }
  return cachedProfile;
}

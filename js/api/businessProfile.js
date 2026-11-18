import { supabase } from './supabase.js';

const allowedFields = [
  'business_name', 'business_type', 'products_services', 'pricing_notes',
  'ideal_customer', 'tone', 'currency', 'quiet_after_days',
];
const listeners = new Set();
const refreshKey = 'coreflow-business-profile-refresh';
let cachedProfile = null;
let cachedUserId = null;
let profileBroadcast = null;

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    cachedProfile = null;
    cachedUserId = null;
    notifyProfileChanged(null, new Error('Your session ended. Please sign in again.'));
  }
});

function emptyProfile() {
  return { currency: 'USD', quiet_after_days: 5, products_services: '', ideal_customer: '', logo_path: null, logo_url: '' };
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
    throw new Error('Business profile could not be loaded. Please sign in again and retry.');
  }

  if (cachedProfile && cachedUserId === user.id && !forceRefresh) {
    return cachedProfile;
  }

  const { data, error } = await supabase
    .from('business_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    throw new Error(`Business profile could not be loaded. ${error.message || 'Check your connection and retry.'}`);
  }

  cachedProfile = data || emptyProfile();
  if (cachedProfile.logo_path) {
    const { data: signedLogo, error: logoError } = await supabase.storage
      .from('company-logos')
      .createSignedUrl(cachedProfile.logo_path, 60 * 60 * 24 * 7);
    cachedProfile.logo_url = logoError ? '' : signedLogo?.signedUrl || '';
  } else cachedProfile.logo_url = '';
  cachedUserId = user.id;
  return cachedProfile;
}

function broadcastProfileRefresh() {
  try {
    profileBroadcast?.postMessage({ type: 'refresh' });
    localStorage.setItem(refreshKey, `${Date.now()}-${Math.random()}`);
  } catch { /* Same-tab profile listeners are notified before broadcasting. */ }
}

export async function uploadBusinessLogo(file) {
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  if (!(file instanceof File) || !allowedTypes.has(file.type)) {
    throw new Error('Choose a PNG, JPG or WebP image.');
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('The logo must be 2 MB or smaller.');
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Your session could not be verified. Please sign in again.');

  const logoPath = `${user.id}/company-logo`;
  const { error: uploadError } = await supabase.storage
    .from('company-logos')
    .upload(logoPath, file, { upsert: true, cacheControl: '3600', contentType: file.type });
  if (uploadError) throw new Error(`Company logo could not be uploaded. ${uploadError.message || 'Please try again.'}`);

  const { data: updated, error: updateError } = await supabase
    .from('business_profiles')
    .update({ logo_path: logoPath })
    .eq('user_id', user.id)
    .select('*')
    .maybeSingle();
  if (updateError) throw new Error(`Logo uploaded, but the business profile could not be updated. ${updateError.message || 'Please try again.'}`);

  if (!updated) {
    const { error: insertError } = await supabase
      .from('business_profiles')
      .insert({ logo_path: logoPath })
      .select('*')
      .single();
    if (insertError?.code === '23505') {
      const { data: retried, error: retryError } = await supabase
        .from('business_profiles')
        .update({ logo_path: logoPath })
        .eq('user_id', user.id)
        .select('*')
        .maybeSingle();
      if (retryError || !retried) throw new Error(`Logo uploaded, but the business profile could not be saved. ${retryError?.message || insertError.message || 'Please try again.'}`);
    } else if (insertError) throw new Error(`Logo uploaded, but the business profile could not be created. ${insertError.message || 'Please try again.'}`);
  }

  let profile;
  try {
    profile = await loadBusinessProfile({ forceRefresh: true, source: 'settings-logo-upload' });
  } catch (refreshError) {
    notifyProfileChanged(null, refreshError);
    throw new Error(`Logo was uploaded, but the profile could not be refreshed. ${refreshError.message}`);
  }
  notifyProfileChanged(profile);
  broadcastProfileRefresh();
  return profile;
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

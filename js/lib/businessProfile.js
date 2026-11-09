export function isProfileComplete(profile) {
  const text = typeof profile?.products_services === 'string' ? profile.products_services : '';
  return [...text].filter((character) => !/\s/u.test(character)).length >= 10;
}

export function debugProfileState(profile, loaded, source, userId = null) {
  const productsLength = typeof profile?.products_services === 'string'
    ? profile.products_services.length
    : 0;
  console.debug('[CoreFlow AI] business profile state', {
    source,
    loaded: Boolean(loaded),
    user_id_last4: typeof userId === 'string' ? userId.slice(-4) : null,
    products_services_length: productsLength,
    is_profile_complete: loaded ? isProfileComplete(profile) : null,
  });
}

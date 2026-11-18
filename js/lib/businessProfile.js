export function isProfileComplete(profile) {
  const text = typeof profile?.products_services === 'string' ? profile.products_services : '';
  return [...text].filter((character) => !/\s/u.test(character)).length >= 10;
}

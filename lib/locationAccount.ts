/** LA location account numbers look like 0000111620-0001-4. */
const LOCATION_ACCOUNT = /^[0-9]{4,12}(?:-[0-9]{1,8}){0,4}$/;

export function isLocationAccount(id: string): boolean {
  return LOCATION_ACCOUNT.test(id);
}

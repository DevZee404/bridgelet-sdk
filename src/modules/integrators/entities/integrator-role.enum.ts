/**
 * Roles for integrator API keys.
 *
 * - `admin`:  Can access administrative endpoints (e.g. list all accounts).
 * - `integrator`: Standard caller — limited to the normal /accounts API.
 */
export enum IntegratorRole {
  Admin = 'admin',
  Integrator = 'integrator',
}

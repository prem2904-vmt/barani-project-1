/**
 * The dynamic imports of the Users & access editors — the list prefetches
 * them (idle + hover / focus of a row's Edit / Manage permissions) so the
 * editor opens without waiting on a chunk download (ND-PATTERN "Loading
 * feedback"; same pattern as test-editor.loader.ts).
 *
 * The routes in app.routes.ts use these loaders, so a prefetched chunk is
 * the very module the router renders.
 */
export const loadUserEdit = () =>
  import('./user-edit.component').then(m => m.UserEditComponent);
export const loadUserInvite = () =>
  import('./user-invite.component').then(m => m.UserInviteComponent);
export const loadRoleEditor = () =>
  import('./role-editor.component').then(m => m.RoleEditorComponent);

/** Prefetch keys for the loaders above. */
export const USER_EDIT_PREFETCH_KEY = 'user-edit';
export const USER_INVITE_PREFETCH_KEY = 'user-invite';
export const ROLE_EDITOR_PREFETCH_KEY = 'role-editor';

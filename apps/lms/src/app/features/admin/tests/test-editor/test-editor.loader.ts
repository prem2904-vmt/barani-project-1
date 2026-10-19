/**
 * The ONE dynamic import of the test editor — shared by its routes
 * (app.routes.ts) and by Test Master's prefetch (idle + hover / focus of
 * "Edit"), so a prefetched editor is the very module the router renders.
 */
export const loadTestEditor = () =>
  import('./test-editor.component').then(m => m.TestEditorComponent);

/** Prefetch key for {@link loadTestEditor}. */
export const TEST_EDITOR_PREFETCH_KEY = 'test-editor';

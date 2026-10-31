/**
 * PAGE SKELETONS — the shape of the screen a navigation is opening
 * (owner, 2026-09-30: "I need a page-OPEN animation and SKELETONS, not a
 * loading bar").
 *
 * While a navigation waits on a lazy chunk / guards, the shell draws the
 * DESTINATION's frame — its band + a skeleton of its body in that screen's
 * layout — so the tap opens the new screen at once. When the screen itself
 * arrives it shows its own first-load skeleton (same shapes) and the view
 * transition cross-fades one into the other.
 *
 * One table, keyed by the URL path (the destination is known at
 * NavigationStart, before any lazy code is fetched). Anything unlisted gets
 * the generic work-screen frame (band + a card of rows).
 */

/** The body layouts the frame can draw (all from the skeleton kit). */
export type PageSkeletonKind =
  | 'queue'      // band + one card of list rows (work queues)
  | 'grid'       // band + a table card (AG-Grid screens)
  | 'grid-side'  // band + a filter side card + a table card (Test Master)
  | 'tiles'      // band + a tile grid (hubs, menus)
  | 'detail'     // band + a record card and a side card (record screens)
  | 'form'       // band + a form card and a side card (editors, settings)
  | 'chat'       // band + a conversation list and a thread (messages)
  | 'dashboard'; // band + KPI tiles over a card of rows (landings, boards)

export interface PageSkeleton {
  readonly kind: PageSkeletonKind;
  /** Screen-reader status while the frame is up ("Opening Test Master…"). */
  readonly label: string;
}

type Rule = readonly [RegExp, PageSkeletonKind, string];

/** First match wins; paths are compared without query / hash / trailing slash. */
const RULES: readonly Rule[] = [
  // Front desk
  [/^\/frontdesk$/, 'dashboard', 'Front desk'],
  [/^\/frontdesk\/order$/, 'form', 'Order & Payments'],
  [/^\/frontdesk\/consult$/, 'form', 'Consultation'],
  [/^\/frontdesk\/patients\/new$/, 'form', 'Patient registration'],
  [/^\/frontdesk\/patients\/[^/]+$/, 'detail', 'Patient'],
  [/^\/frontdesk\/appointments\/new$/, 'form', 'New appointment'],
  [/^\/frontdesk\/appointments$/, 'grid', 'Appointments'],
  [/^\/frontdesk\/post-payment$/, 'detail', 'Payment'],
  [/^\/frontdesk\/(queue|home-collection)$/, 'queue', 'Queue'],
  // Lab
  [/^\/lab\/my-work$/, 'queue', 'My Work'],
  [/^\/(lab\/collect|sample-collection)$/, 'queue', 'Collect'],
  [/^\/lab\/receive$/, 'queue', 'Receive'],
  [/^\/lab\/(sample|result|culture)\/[^/]+$/, 'detail', 'Result entry'],
  [/^\/lab\/critical-results$/, 'queue', 'Critical results'],
  [/^\/lab\/settings$/, 'tiles', 'Lab settings'],
  [/^\/pathologist$/, 'queue', 'Validation'],
  [/^\/pathologist\/validate\/[^/]+$/, 'detail', 'Validation'],
  // Reports, billing, messages, dashboards
  [/^\/reports$/, 'grid', 'Reports'],
  [/^\/reports\/view\/[^/]+$/, 'detail', 'Report'],
  [/^\/billing-counter$/, 'grid', 'Billing'],
  [/^\/messages$/, 'chat', 'Messages'],
  [/^\/dashboard$/, 'dashboard', 'Dashboard'],
  [/^\/finance$/, 'tiles', 'Finance'],
  [/^\/finance\/daily$/, 'grid', 'Daily statement'],
  [/^\/(finance\/)?expenses$/, 'grid-side', 'Expenses'],
  [/^\/w\/[^/]+$/, 'tiles', 'Menu'],
  [/^\/(o|p)\/[^/]+$/, 'detail', 'Record'],
  [/^\/doctor\/consult\/[^/]+$/, 'detail', 'Consultation'],
  // Admin — catalogue + people
  [/^\/admin\/tests$/, 'grid-side', 'Test Master'],
  [/^\/admin\/tests\/(new|[^/]+\/edit)$/, 'form', 'Test editor'],
  [/^\/admin\/users$/, 'grid', 'Users & roles'],
  [/^\/admin\/(users\/invite|users\/[^/]+\/edit|roles\/new|roles\/[^/]+\/edit)$/, 'form', 'User editor'],
  [/^\/admin(\/manage|\/modules)?$/, 'tiles', 'Admin'],
  [/^\/admin\/(opd|ipd|pharmacy|payroll|insurance|radiology|emergency|blood-bank)$/, 'tiles', 'Module settings'],
  [/^\/admin\/(branches|vendors|referral-labs|inventory|partners|audit|home-collection|referring-network|opd\/doctors)$/, 'grid', 'Settings'],
  [/^\/admin\/lab-settings$/, 'form', 'Lab settings'],
  [/^\/admin\/ai-connectors$/, 'form', 'AI connectors'],
  [/^\/admin\/bridges$/, 'grid', 'Bridges'],
  [/^\/admin\/bridges\/add$/, 'form', 'Add a Bridge'],
  [/^\/admin\/bridges\/[^/]+$/, 'detail', 'Bridge'],
  [/^\/admin\//, 'form', 'Settings'],
  [/^\/(printing|signature|setup)$/, 'form', 'Settings'],
  [/^\/stores$/, 'grid', 'Stores'],
];

/** Hops that must never draw a frame: the branch switch has its own veil,
 *  and the landing guard ("/") only redirects. */
const NO_FRAME: readonly RegExp[] = [/^\/_branch$/, /^\/$/, /^\/login$/, /^\/403$/];

export function pagePath(url: string | null | undefined): string {
  const p = (url || '').split(/[?#]/)[0].replace(/\/+$/, '');
  return p || '/';
}

/** The frame for `url`, or null when this destination draws none. */
export function pageSkeletonFor(url: string | null | undefined): PageSkeleton | null {
  const p = pagePath(url);
  if (NO_FRAME.some(r => r.test(p))) return null;
  // Public, sign-in-free pages live outside the shell.
  if (/^\/(track|reports\/public)\//.test(p) || p === '/set-password' || p === '/oauth/consent') return null;
  for (const [re, kind, name] of RULES) {
    if (re.test(p)) return { kind, label: `Opening ${name}…` };
  }
  return { kind: 'queue', label: 'Opening page…' };
}

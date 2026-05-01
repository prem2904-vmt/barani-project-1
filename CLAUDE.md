<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

## Nx Monorepo Conventions

### Workspace Structure
- Organize the workspace into clear top-level folders: `apps/` and `libs/`
- Group libraries by domain or feature area: `libs/{scope}/{type}-{name}` (e.g., `libs/billing/feature-checkout`, `libs/shared/ui-buttons`)
- Apps must remain thin — they compose libs and contain almost no business logic
- Apps must NEVER depend on other apps; cross-app sharing happens through libs only

### Library Types
Use these standard library types and **enforce them with module boundary rules**:
- **`feature`** — Smart components, routed pages, feature-specific state. May depend on: `feature`, `ui`, `data-access`, `util`
- **`ui`** — Dumb/presentational components, directives, pipes. May depend on: `ui`, `util`
- **`data-access`** — Services, HTTP clients, state management, API models/DTOs. May depend on: `data-access`, `util`
- **`util`** — Pure utilities, helpers, types, constants. May depend on: `util` only
- **`shell`** — App composition root and root routing. May depend on: `feature`, `ui`, `data-access`, `util`

### Module Boundaries & Tags
- **Always** tag every project in `project.json` with both a `scope:*` and `type:*` tag
- Enforce boundaries with the `@nx/enforce-module-boundaries` ESLint rule in the root ESLint config
- Example tags: `scope:billing`, `scope:shared`, `type:feature`, `type:ui`, `type:data-access`, `type:util`
- A `scope:billing` lib must NOT import from `scope:checkout` directly — share through `scope:shared` or a defined public contract
- `scope:shared` libs must not depend on any domain scope
- Never import from a library's internal files (deep imports); always import from its public API (`index.ts`)

### Library Generation
- Use Nx generators — never create projects manually. Invoke the `nx-generate` skill first
- Standard commands (always run via the workspace package manager):
  - `pnpm nx g @nx/angular:lib libs/{scope}/{type}-{name} --standalone`
  - `pnpm nx g @nx/angular:app apps/{name} --standalone --routing`
  - `pnpm nx g @nx/angular:component {name} --project={lib-name}`
- Use `--standalone` for all new apps and libs
- Apply `--tags` flag at generation time so boundaries are enforced from day one

### Running Tasks
- **Always** run tasks through Nx, never the underlying tool directly:
  - Single project: `pnpm nx <target> <project>` (e.g., `pnpm nx test billing-feature-checkout`)
  - Many projects: `pnpm nx run-many -t <target>`
  - Only what changed: `pnpm nx affected -t <target> --base=main`
- Use `nx affected` in CI to skip unchanged projects
- Leverage the Nx cache — never disable it without a specific reason
- Configure remote caching (Nx Cloud) for shared cache across CI and developers

### Dependency Management
- Keep a single version of each dependency at the workspace root `package.json`
- Avoid per-project `package.json` files unless publishing the lib as a package
- Use `pnpm nx graph` to visualize and audit the dependency graph before large refactors
- Watch for circular dependencies; the dep graph should be acyclic

## Core Development Principles

### Responsive Design
- **Always** build with responsive design as a baseline, not an afterthought
- Avoid fixed widths; prefer fluid layouts with `max-width` constraints
- Use Angular CDK's `BreakpointObserver` for responsive logic in TypeScript when needed

### Styling: Tailwind Utility-First
- **Always** use Tailwind utility classes as the primary styling approach
- Configure Tailwind once at the workspace level via a shared preset; apps and libs extend it
- Use the `createGlobPatternsForDependencies` helper from `@nx/angular/tailwind` in each app's `tailwind.config.js` so classes used in libs are picked up
- Prefer composition of utilities in component templates over component-scoped CSS
- Use `@apply` sparingly in component `.scss`/`.css` files — only for truly repeated patterns
- Avoid inline `[style]` bindings unless dynamic values require it
- Use Tailwind's design tokens (spacing, colors, typography) instead of arbitrary values
- Use `[ngClass]` or `[class.x]` bindings for conditional Tailwind classes
- Only use arbitrary values (e.g., `w-[437px]`) when the design system genuinely cannot accommodate the requirement
- Keep `ViewEncapsulation` default (Emulated) unless there's a strong reason to change it

### Theming: Dark & Light Mode
- **Always** build with both dark and light mode compatibility from the start
- Use Tailwind's `dark:` variant for dark mode styles
- Configure Tailwind with `darkMode: 'class'` for explicit theme control
- Define semantic color tokens (e.g., `bg-background`, `text-foreground`) via CSS variables in a shared `ui-theme` (or similar) lib
- Provide a `ThemeService` in a shared `data-access` lib to toggle and persist user preference (localStorage)
- Respect `prefers-color-scheme` as the default before user override
- Test every component in both themes before considering it complete
- Ensure sufficient contrast ratios in both modes (WCAG AA minimum: 4.5:1 for text)

## Angular-Specific Standards

### Modern Angular Patterns
- **Always** use standalone components, directives, and pipes (no `NgModule` for new code)
- Use the new control flow syntax: `@if`, `@for`, `@switch` over `*ngIf`, `*ngFor`, `*ngSwitch`
- Prefer `signal()`, `computed()`, and `effect()` over `BehaviorSubject` for component state
- Use `input()` and `output()` signal-based APIs over `@Input()` and `@Output()` decorators
- Use `inject()` function over constructor injection for cleaner code
- Use `viewChild()` and `contentChild()` signal queries over `@ViewChild`/`@ContentChild` decorators
- Apply `ChangeDetectionStrategy.OnPush` to all components by default

### Component Architecture
- Keep components small and focused — single responsibility principle
- Separate **smart (container)** and **dumb (presentational)** components — smart components live in `feature` libs, dumb in `ui` libs
- Co-locate related files: component, template, styles, spec, and types in the same folder
- Components should not exceed ~300 lines; extract child components or services if larger
- Use the `host` property in component metadata over `@HostBinding`/`@HostListener`
- Avoid logic in templates — compute values in the component class with `computed()`

### Services & Dependency Injection
- Use `providedIn: 'root'` for app-wide singletons placed in `data-access` libs
- Provide services at component level only when scoped instances are needed
- Keep services focused on a single domain (auth, http, state, etc.)
- Inject services using `inject()` function in field initializers
- Avoid circular dependencies between services

### RxJS & Async
- Use signals for component state; use RxJS for streams of events (HTTP, WebSocket, user input)
- Convert observables to signals with `toSignal()` at component boundaries
- Always unsubscribe: use `takeUntilDestroyed()` with `DestroyRef` over manual subscription management
- Prefer `async` pipe in templates over manual subscription
- Use higher-order operators (`switchMap`, `mergeMap`, `concatMap`, `exhaustMap`) deliberately — each has different semantics
- Avoid nested subscriptions; flatten with operators

### Routing
- Use functional route guards (`CanActivateFn`) over class-based guards
- Use functional resolvers and interceptors
- Lazy-load feature routes with `loadComponent` and `loadChildren` — each `feature` lib should expose lazy-loadable routes
- Type route data and params; avoid `any` in route configuration
- Use `withComponentInputBinding()` to bind route params directly to component inputs

### Forms
- Use **Reactive Forms** for anything beyond trivial inputs; avoid Template-driven forms in complex flows
- Type form controls with `FormControl<T>` for full type safety
- Build forms with `NonNullableFormBuilder` to avoid null pollution
- Centralize validation logic in reusable validator functions (place in a shared `util` lib)
- Display validation errors consistently via a shared error component (in a `ui` lib)

### HTTP & Data
- Use `HttpClient` with functional interceptors (`withInterceptors`)
- Type all API responses; never return `any` from HTTP services
- Centralize API URLs in environment files or a config service
- Place HTTP clients and DTOs in `data-access` libs, not in feature libs
- Handle errors at the interceptor level for cross-cutting concerns; handle domain errors in services
- Use `firstValueFrom` for one-shot HTTP calls when promises are cleaner than observables

## Code Quality Standards

### TypeScript
- Enable `strict` mode in the workspace root `tsconfig.base.json` (including `strictNullChecks`, `noImplicitAny`)
- Avoid `any` — prefer `unknown` when type is genuinely unclear
- Define explicit return types for public methods and exported functions
- Use `interface` for object shapes that may be extended; `type` for unions and intersections
- Avoid type assertions (`as`) unless absolutely necessary; prefer type guards
- Use TypeScript path mappings (`@my-org/billing/feature-checkout`) defined in `tsconfig.base.json` — never use relative paths across libs

### Naming Conventions
- Components: `PascalCase` class, `kebab-case` selector with org/scope prefix (e.g., `billing-checkout-form`)
- Files: `kebab-case` with type suffix (e.g., `user-profile.component.ts`, `auth.service.ts`)
- Services: `PascalCase` ending in `Service` (e.g., `AuthService`)
- Interfaces: `PascalCase`, no `I` prefix (e.g., `User` not `IUser`)
- Boolean variables: prefix with `is`, `has`, `should`, `can` (e.g., `isLoading`, `hasError`)
- Event handlers: prefix with `on` for outputs (e.g., `onSubmit`), `handle` for internal handlers
- Library names: `{scope}-{type}-{name}` (e.g., `billing-feature-checkout`)

### File Organization
- Inside each lib, group by **feature**, not by file type
- Structure inside a feature lib: `src/lib/{feature-name}/`
- Each lib must expose a clean public API via its `src/index.ts` barrel — only export what consumers need
- Internal-only files should NOT be exported from `index.ts`
- Avoid barrel files for individual components within a lib — keep tree-shaking optimal

## Accessibility (a11y)
- Use semantic HTML elements (`<button>`, `<nav>`, `<main>`) over generic `<div>`s
- All interactive elements must be keyboard accessible
- Provide `alt` text for all images; use `alt=""` for decorative images
- Use ARIA attributes via Angular CDK's `a11y` module when semantic HTML is insufficient
- Ensure focus states are clearly visible — never remove `:focus` outlines without replacement
- Use Angular CDK's `LiveAnnouncer` for screen reader announcements
- Test with keyboard navigation and screen readers

## Performance
- Apply `ChangeDetectionStrategy.OnPush` to all components
- Use `trackBy` in `@for` loops with stable identifiers
- Lazy-load feature routes; avoid eager imports of large libraries
- Use `@defer` blocks for deferring non-critical UI
- Optimize images: use `NgOptimizedImage` directive for static images
- Avoid heavy computation in templates — use `computed()` signals or pure pipes
- Profile with Angular DevTools before optimizing
- Use `pnpm nx graph` to spot accidental large dependency chains pulling unused code into bundles

## Error Handling
- Implement a global `ErrorHandler` (place it in a shared `data-access` or `core` lib)
- Use HTTP interceptors for cross-cutting error handling (auth refresh, retry, logging)
- Wrap async operations with proper error operators (`catchError`)
- Never swallow errors silently — log or surface them
- Provide user-friendly error messages; log technical details separately
- Validate inputs at boundaries (API responses, form data, route params)

## Testing
- Use Jest (Nx default for new workspaces) or Karma per workspace setup — be consistent
- Run tests through Nx: `pnpm nx test <project>` or `pnpm nx affected -t test`
- Test components with `TestBed` and Angular Testing Library for behavior-focused tests
- Test services in isolation; mock HTTP with `HttpTestingController`
- Use `provideRouter([])` and standalone test setups over module-based test configuration
- Write tests for business logic, not implementation details
- Use descriptive test names: `it('should show error when email is invalid')`
- Mock external dependencies; avoid mocking what you don't own
- Co-locate `.spec.ts` files next to the source they test

## Git & Commits
- Write clear, imperative commit messages: "Add user profile page" not "Added user profile page"
- Use Conventional Commits with project scope: `feat(billing-feature-checkout): add coupon support`
- Keep commits atomic — one logical change per commit
- Reference issue numbers where applicable
- Avoid committing commented-out code; use version control history instead
- Run `pnpm nx affected -t lint test build --base=main` locally before pushing

## Documentation
- Document **why**, not **what** — code should be self-explanatory
- Add JSDoc comments for exported services, public methods, and complex types
- Each lib should have a `README.md` explaining its purpose, scope, and public API
- Keep workspace `README.md` up to date with setup, build, and deployment instructions
- Document non-obvious architectural decisions in an `ADR/` folder at the workspace root

## Security
- Never commit secrets, API keys, or credentials — use `environment.ts` (gitignored for prod values)
- Trust Angular's built-in sanitization; avoid `bypassSecurityTrust*` unless absolutely necessary
- Sanitize all user inputs; validate on both client and server
- Keep dependencies updated; audit regularly with `pnpm audit` (or `npm audit`)
- Use HTTPS everywhere; enforce CSP headers in production
- Configure CORS correctly on the backend; never use wildcard origins for authenticated endpoints
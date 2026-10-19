# Prefrontal Shared Library

Reusable Angular components, directives, pipes, utilities, company theme tokens, and PF styles for LMS, OPD, IPD, and Pharmacy applications.

## Component catalogue

The public API is grouped by usage, following the category-oriented organization in NG-ZORRO:

- **General:** button, logo mark, loading logo, scan icon
- **Layout:** ambient background, card surfaces
- **Navigation:** action menu and trigger
- **Data entry:** text input directive, select/dropdown, segmented choices, numeric input, numpad, PIN dots, barcode scanner, date, time, date-time, image editor, signature pad
- **Data display:** avatar, chip, clock, tile, status chip, barcode and QR display
- **Feedback:** confirmation dialog, skeletons, busy indicator

Import only the standalone APIs a screen needs from `@prefrontal/shared`:

```ts
import { PfButtonComponent, PfInputDirective, SelectComponent } from '@prefrontal/shared';
```

## Theme and Tailwind

The default violet and fuchsia palette, light/dark surface tokens, and PF component styles are in the library styles entry point. Apps can override the CSS custom properties in their root theme.

Load Tailwind and include the library source in Tailwind's scan so its utility classes are generated. For an app under `apps/<app>/src`, add this to its global stylesheet:

```scss
@import url('tailwindcss');
@source '../../../libs/shared/src';
@import '@prefrontal/shared/styles';
```

Prefer Tailwind utilities for layout, spacing, typography, responsive behavior, and focus states. Keep component CSS for interaction-specific geometry, animations, or styles that need to remain encapsulated.

## Architecture

Project: `prefrontal-shared` at `libs/shared`. Components are standalone and use explicit exports. Keep app workflows, API clients, and domain models in their owning app or feature library. LMS import paths currently re-export the library APIs for a gradual migration.

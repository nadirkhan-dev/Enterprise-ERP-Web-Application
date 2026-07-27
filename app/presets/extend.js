// Extend tokens — custom tokens outside PrimeVue's semantic slots.
// These become --p-* CSS variables (e.g. --p-font-size-sm, --p-spacing-4).
export const extend = {
  font: {
    family: '"TT Norms Pro", sans-serif',
    size: {
      xxxs: '0.5rem', // 8px
      xxs: '0.625rem', // 10px
      xs: '0.75rem', // 12px
      '2xs': '13px', // special case for monospace version numbers (see AppSideNav.vue) & BaseDataTableFooterLoader.vue
      sm: '0.875rem', // 14px
      base: '1rem', // 16px
      lg: '1.125rem', // 18px
      xl: '1.25rem', // 20px
      '2xl': '1.5rem', // 24px
      '3xl': '1.875rem', // 30px
      '4xl': '2.25rem', // 36px
      '5xl': '3rem', // 48px
      '6xl': '4.5rem', // 72px — display-size headings (e.g. login wordmark)
    },
    // Weights match the @font-face declarations in fonts.css
    // Note: 'light' is a reserved PrimeVue token key — use 'thin' instead
    weight: {
      thin: '100', // TT Norms Pro Light
      normal: '300', // TT Norms Pro Regular (default body weight)
      medium: '400',
      book: '450', // Figma body-md/regular — between medium and bold
      bold: '500', // TT Norms Pro Bold
      semibold: '600', // Figma button/medium weight
      black: '900', // TT Norms Pro Black
    },
    lineHeight: {
      none: '1', // text box hugs the glyphs — no extra leading above/below
      tight: '1.25',
      snug: '1.375',
      normal: '1.5',
      relaxed: '1.625',
      loose: '2',
    },
    letterSpacing: {
      tight: '-0.025em',
      normal: '0em',
      wide: '0.025em',
      wider: '0.05em',
      widest: '0.1em',
    },
  },

  // Monospace variant — technical / data labels (version numbers, record counts)
  // Usage: var(--p-mono-family)
  mono: {
    family: '"TT Norms Pro Mono", "TT Norms Pro", monospace',
  },

  // Skeleton loader — "Undertow" animation tokens
  // Usage: var(--p-undertow-base), var(--p-undertow-peak), etc.
  undertow: {
    base: '#f3f5f6', // resting bar color (gray.50)
    peak: '#d4d6d8', // darkest point of the wave (gray.200)
    duration: '2.8s', // full animation cycle
    stagger: '0.14s', // delay between consecutive rows
  },

  // Invalid-field attention pulse (e.g. phone number validation error)
  // Usage: var(--p-field-pulse-duration)
  fieldPulse: {
    duration: '1.75s', // full pulse cycle (border 1px → 2px → 1px)
  },

  // Spacing scale — 4px base unit
  // Usage: var(--p-spacing-4) = 16px
  spacing: {
    0: '0',
    px: '1px',
    0.5: '0.125rem', // 2px
    1: '0.25rem', // 4pxe
    1.5: '0.375rem', // 6px
    1.75: '0.4375rem', // 7px
    2: '0.5rem', // 8px
    2.25: '0.5625rem', // 9px
    2.5: '0.625rem', // 10px
    2.625: '0.65625rem', // 10.5px
    3: '0.75rem', // 12px
    3.5: '0.875rem', // 14px
    4: '1rem', // 16px
    4.375: '1.09375rem', // 17.5px
    5: '1.25rem', // 20px
    5.5: '1.375rem', // 22px — Figma paragraph line-height
    6: '1.5rem', // 24px
    6.25: '1.5625rem', // 25px
    7: '1.75rem', // 28px
    8: '2rem', // 32px
    9: '2.25rem', // 36px
    10: '2.5rem', // 40px
    12: '3rem', // 48px
    16: '4rem', // 64px
    20: '5rem', // 80px
  },

  // Elevation / shadow scale
  // Usage: var(--p-shadow-md)
  shadow: {
    none: 'none',
    xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    sm: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
    inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',
    top: '0 -4px 6px -5px rgba(0, 0, 0, 0.3)',
    bottom: '0 4px 6px -5px rgba(0, 0, 0, 0.3)',
    drag: '0 12px 16px -4px rgba(16, 24, 40, 0.08), 0 4px 6px -2px rgba(16, 24, 40, 0.03)',
    // Figma "button/raised/shadow" — Material-style elevation for raised buttons.
    raised: '0 3px 1px -2px rgba(0, 0, 0, 0.2), 0 2px 2px 0 rgba(0, 0, 0, 0.14), 0 1px 5px 0 rgba(0, 0, 0, 0.12)',
  },

  // Opacity scale
  // Usage: var(--p-opacity-50)
  opacity: {
    0: '0',
    5: '0.05',
    10: '0.1',
    20: '0.2',
    25: '0.25',
    50: '0.5',
    75: '0.75',
    90: '0.9',
    95: '0.95',
    100: '1',
    disabled: '0.4',
    overlay: '0.8',
  },

  // Layout tokens — structural dimensions outside PrimeVue's component token namespaces
  // Usage: var(--p-layout-drawer-width)
  layout: {
    drawer: {
      width: '35rem', // 560px
    },
    popoverFilter: {
      width: '16rem', // 256px,
      minWidth: '12rem', // 192px
    },
    sequenceNav: {
      width: '6.4375rem', // 103px — fixed-width detail-page prev/next nav buttons
    },
    toolsPanel: {
      // /tools empty state matches a tool section BasePanel height. Taller on
      // mobile (form fields stack) than tablet+ (fields sit in one row).
      minHeight: '13.5rem', // 216px — tablet and up
      minHeightMobile: '21rem', // 336px — mobile
    },
    topNav: {
      // Fallback for --app-top-nav-height, which AppTopNav measures and publishes
      // on mount. Used by anything that must clear the fixed top nav (the mobile
      // toast stack, the content padding) before that measurement lands.
      height: '3.75rem', // 60px
    },
  },

  // Responsive breakpoints (min-width, mobile-first)
  // Usage: var(--p-breakpoint-tablet) — also exported as JS constants in utils/breakpoints.js
  breakpoint: {
    mobile: '0px', // 0–767px
    tablet: '768px', // 768–1023px
    laptop: '1024px', // 1024–1439px
    desktop: '1440px', // 1440px+
  },

  // Motion / animation scale
  // Usage: var(--p-transition-duration-normal), var(--p-transition-timing-ease-out)
  transition: {
    duration: {
      instant: '0ms',
      fast: '100ms',
      normal: '200ms', // matches semantic.transitionDuration
      slow: '300ms',
      slower: '500ms',
      slowest: '700ms',
    },
    timing: {
      linear: 'linear',
      ease: 'cubic-bezier(.17, .67, .83, .67)',
      easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
      easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
      easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
      spring: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    },
    property: {
      colors: 'color, background-color, border-color, text-decoration-color, fill, stroke',
      opacity: 'opacity',
      shadow: 'box-shadow',
      transform: 'transform',
      all: 'all',
    },
  },
}

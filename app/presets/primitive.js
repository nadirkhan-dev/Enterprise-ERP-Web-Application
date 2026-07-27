// Primitive tokens — raw color palettes from Figma "LS Design System".
// All palettes match the Figma source of truth (file LTwOI2W4G94tKHrQeSi9yf).
export const primitive = {
  // Brand deepblue — sidebar, identity colors
  // Anchor: #1c3c70 at 900
  deepblue: {
    50: '#e8f2f9',
    100: '#bbd8ec',
    200: '#93bfdf',
    300: '#6ea7d1',
    400: '#5695c8',
    500: '#4185c0',
    600: '#3a78b4',
    700: '#3068a2',
    800: '#295891',
    900: '#1c3c70',
  },

  tideblue: {
    50: '#e3f7f8',
    100: '#b7e9ef',
    200: '#8bdae6',
    300: '#64cbdf',
    400: '#47c0dc',
    500: '#2eb5da',
    600: '#23a7cd',
    700: '#1394bb',
    800: '#1183a8',
    900: '#006388',
  },

  // Skyblue — interactive / CTA color
  // Anchor: #009bd4 at 600
  skyblue: {
    50: '#edfaff',
    100: '#b3e5f5',
    200: '#82d4ee',
    300: '#54c2e8',
    400: '#31b5e5',
    500: '#0ba9e2',
    600: '#009bd4',
    700: '#0088c1',
    800: '#0077ae',
    900: '#00588c',
  },

  tidegreen: {
    50: '#e6f5e4',
    100: '#c3e5be',
    200: '#9bd494',
    300: '#71c468',
    400: '#4fb746',
    500: '#26aa1c',
    600: '#1a9c12',
    700: '#008a00',
    800: '#007900',
    900: '#005b00',
  },

  // Mildgreen — tertiary green (no 600 in Figma)
  mildgreen: {
    50: '#e6f6e5',
    100: '#c4e8be',
    200: '#9cd994',
    300: '#70cb67',
    400: '#4bc042',
    500: '#17b410',
    700: '#009300',
    800: '#008200',
    900: '#006300',
  },

  // Vividgreen — success / active states
  // Anchor: #00aa00 at 500
  vividgreen: {
    50: '#efffed',
    100: '#c1e5bb',
    200: '#98d490',
    300: '#6ac461',
    400: '#44b73c',
    500: '#00aa00',
    600: '#009b00',
    700: '#008b00',
    800: '#007900',
    900: '#005b00',
  },

  // UI gray — neutral text, borders, surfaces
  gray: {
    50: '#f3f5f6',
    100: '#e1e3e4',
    200: '#d4d6d8',
    300: '#c4c6c8',
    400: '#abb1b4',
    500: '#9ca3a7',
    600: '#8a9297',
    700: '#7a8389',
    800: '#677279',
    900: '#50585d',
  },

  // Red — danger / inactive states
  red: {
    50: '#ffeeed',
    100: '#ffc8b9',
    200: '#ffa38b',
    300: '#ff7b5d',
    400: '#ff5838',
    500: '#ff2b12',
    600: '#ff230e',
    700: '#ff0000',
    800: '#ee0000',
    900: '#d70000',
  },

  yellow: {
    50: '#fff7e1',
    100: '#ffebb2',
    200: '#ffde80',
    300: '#ffd24d',
    400: '#ffc625',
    500: '#ffbd00',
    600: '#ffaf00',
    700: '#ff9c00',
    800: '#ff8b00',
    900: '#fe6a03',
  },

  lavender: {
    50: '#e9ecfb',
    100: '#d0d5f6',
    200: '#a3afef',
    300: '#7e8fe6',
    400: '#6275dc',
    500: '#475cd2',
    600: '#4153c7',
    700: '#3748ba',
    800: '#303eae',
    900: '#242b97',
  },

  // Orange — accent / preferred indicators
  // Closest to old amber.500 (#f5a623) is orange.400 (#f9a225)
  orange: {
    50: '#fff9ef',
    100: '#ffd69c',
    200: '#fcc97e',
    300: '#fab34b',
    400: '#f9a225',
    500: '#f89200',
    600: '#f48700',
    700: '#ee7700',
    800: '#e86700',
    900: '#de4d01',
  },

  // Neutral — pure white and black
  neutral: {
    0: '#ffffff',
    1000: '#000000',
  },

  // Alpha — semi-transparent utility colors
  alpha: {
    a8skyblue: '#009bd414',
    a11vividgreen: '#00aa001c',
    a7red: '#ff000012',
    a30lavender: '#a3afef4d',
  },

  // Shadow — opacity-based shadow colors
  shadow: {
    4: '#0000000a',
    6: '#0000000f',
    8: '#00000014',
    10: '#0000001a',
    12: '#0000001f',
    14: '#00000024',
    15: '#00000026',
  },
}

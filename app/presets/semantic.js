// Semantic tokens — named by intent, referencing primitives.
// Never reference primitives directly from component tokens.
export const semantic = {
  primary: {
    50: '{skyblue.50}',
    100: '{skyblue.100}',
    200: '{skyblue.200}',
    300: '{skyblue.300}',
    400: '{skyblue.400}',
    500: '{skyblue.600}',
    600: '{skyblue.700}',
    700: '{skyblue.800}',
    800: '{skyblue.900}',
  },

  borderRadius: {
    none: '0',
    xs: '2px',
    sm: '4px',
    md: '6px',
    lg: '8px',
    xl: '12px',
    '2xl': '16px',
    full: '9999px',
  },

  disabledOpacity: '0.4',
  transitionDuration: '0.2s',

  colorScheme: {
    light: {
      primary: {
        color: '{primary.500}',
        inverseColor: '#ffffff',
        hoverColor: '{primary.600}',
        activeColor: '{primary.700}',
      },
      surface: {
        0: '#ffffff',
        50: '{gray.50}',
        100: '{gray.100}',
        200: '{gray.200}',
        300: '{gray.300}',
        400: '{gray.400}',
        500: '{gray.500}',
        600: '{gray.600}',
        700: '{gray.700}',
        800: '{gray.800}',
        900: '{gray.900}',
      },
      //

      text: {
        color: '{surface.700}',
        mutedColor: '{surface.500}',
        hoverMutedColor: '{surface.600}',
      },
      content: {
        background: '{surface.0}',
        hoverBackground: '{surface.100}',
        borderColor: '{surface.200}',
        color: '{text.color}',
        hoverColor: '{text.color}',
      },
      overlay: {
        select: {
          background: '{surface.0}',
          borderColor: '{surface.200}',
          color: '{text.color}',
        },
        popover: {
          background: '{surface.0}',
          borderColor: '{surface.200}',
          color: '{text.color}',
        },
        modal: {
          background: '{surface.0}',
          borderColor: '{surface.200}',
          color: '{text.color}',
        },
      },
      highlight: {
        background: '{primary.50}',
        focusBackground: '{primary.100}',
        color: '{primary.700}',
        focusColor: '{primary.800}',
      },
      formField: {
        background: '{surface.0}',
        disabledBackground: '{surface.200}',
        filledBackground: '{surface.50}',
        filledHoverBackground: '{surface.50}',
        filledFocusBackground: '{surface.50}',
        borderColor: '{surface.300}',
        hoverBorderColor: '{primary.color}',
        focusBorderColor: '{primary.color}',
        invalidBorderColor: '{red.200}',
        color: '{deepblue.900}',
        disabledColor: '{surface.400}',
        placeholderColor: '{surface.400}',
        floatLabelColor: '{surface.400}',
        floatLabelFocusColor: '{primary.600}',
        floatLabelInvalidColor: '{red.700}',
        iconColor: '{surface.400}',
        shadow: '0 0 #0000, 0 0 #0000, 0 1px 2px 0 rgba(18, 18, 23, 0.05)',
      },
      border: {
        default: '{surface.200}',
        muted: '{surface.100}',
        strong: '{surface.300}',
        focus: '{primary.color}',
        error: '{red.700}',
        success: '{vividgreen.400}',
        warning: '{yellow.400}',
      },
    },
  },
}

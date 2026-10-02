import { BREAKPOINT_TABLET } from '~/utils/breakpoints'

/**
 * Reactively tracks whether the viewport width is below the tablet breakpoint.
 */
export function useIsMobile() {
  const tabletPx = parseInt(BREAKPOINT_TABLET)
  const isMobile = ref(false)

  function checkMobile() {
    isMobile.value = window.innerWidth < tabletPx
  }

  onMounted(() => {
    checkMobile()
    window.addEventListener('resize', checkMobile)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', checkMobile)
  })

  return { isMobile }
}

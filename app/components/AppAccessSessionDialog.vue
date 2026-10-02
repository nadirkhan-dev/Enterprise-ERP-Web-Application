<script setup lang="ts">
import { useCloudflareAccess } from '~/composables/useCloudflareAccess'

/**
 * Surfaces the Cloudflare Access deadline: a dismissible warning for the last
 * five minutes, and an unskippable prompt once it has passed. Mounted once in
 * the default layout beside AppUpdateBanner, whose card it shares.
 */
const { promptState, remainingMs, isRenewing, handleAccessRenew, handleAccessDismiss } = useCloudflareAccess()

const isVisible = computed(() => promptState.value !== 'hidden')
const isExpired = computed(() => promptState.value === 'expired')

/**
 * Whole minutes only — 5, 4, 3, 2, 1, and then the deadline. Rounded up, so
 * each label holds for its full minute rather than a running seconds count:
 * the point of the warning is to prompt a decision, and a ticking clock reads
 * as pressure rather than information.
 *
 * The watch still re-checks every second underneath, so the forced prompt lands
 * on the deadline instead of up to a minute after it.
 */
function formatRemaining(milliseconds: number): string {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60000))
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

/**
 * Keeps clear of "session", "expired" and "sign in": the Login screen promises
 * that ticking "Keep me logged in" will "stop booting you", so a user who
 * ticked it reads that vocabulary here as the promise being broken.
 */
const heading = computed(() =>
  isExpired.value ? 'Refresh CONNECT to continue' : 'Refresh CONNECT to stay logged in',
)

const message = computed(() => {
  if (isExpired.value) {
    return 'Saving and downloads will not work until you do.'
  }
  return `Refresh within ${formatRemaining(remainingMs.value)} to allow CONNECT to keep working.`
})
</script>

<template>
  <DialogRefreshPrompt
    :visible="isVisible"
    :heading="heading"
    :message="message"
    :is-dismissible="!isExpired"
    :is-confirming="isRenewing"
    @confirm="handleAccessRenew"
    @dismiss="handleAccessDismiss"
  />
</template>

import { generateTwoFactorSecret, enableTwoFactor } from '@directus/sdk'
import { useDirectus } from '~/composables/useDirectus'

const authenticatorSecret = ref('')
const authenticatorOtpauthUrl = ref('')
const isVerifyingAuthenticator = ref(false)
const isTfaRequired = ref(false)

interface VerifyCodeResult {
  success: boolean
  errorMessage?: string
}

const FRIENDLY_TFA_MESSAGES: Record<string, string> = {
  INVALID_OTP: 'Incorrect code. Please try again.',
  INVALID_CREDENTIALS: 'Session expired. Please log in again.',
  INVALID_PAYLOAD: 'Invalid code. Enter the 6-digit code from your app.',
  FORBIDDEN: 'Permission denied for this action.',
  SERVICE_UNAVAILABLE: 'Service unavailable. Try again shortly.',
}

function getFriendlyMessage(rawMessage: string, errorCode: string | null): string {
  if (errorCode && FRIENDLY_TFA_MESSAGES[errorCode]) {
    return FRIENDLY_TFA_MESSAGES[errorCode]
  }

  const lowerMessage = rawMessage.toLowerCase()

  if (lowerMessage.includes('otp') || lowerMessage.includes('one-time') || lowerMessage.includes('invalid_otp')) {
    return FRIENDLY_TFA_MESSAGES.INVALID_OTP
  }

  if (lowerMessage.includes('credential') || lowerMessage.includes('token') || lowerMessage.includes('unauthorized')) {
    return FRIENDLY_TFA_MESSAGES.INVALID_CREDENTIALS
  }

  if (lowerMessage.includes('payload') || lowerMessage.includes('validation')) {
    return FRIENDLY_TFA_MESSAGES.INVALID_PAYLOAD
  }

  return 'Verification failed. Please try again.'
}

function getTfaErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    let rawMessage = ''
    let errorCode: string | null = null

    if (
      'errors' in error &&
      Array.isArray(error.errors) &&
      error.errors[0] &&
      typeof error.errors[0] === 'object'
    ) {
      const firstError = error.errors[0] as Record<string, unknown>
      if (typeof firstError.message === 'string') {
        rawMessage = firstError.message
      }
      if (firstError.extensions && typeof firstError.extensions === 'object') {
        const extensions = firstError.extensions as Record<string, unknown>
        if (typeof extensions.code === 'string') {
          errorCode = extensions.code
        }
      }
    }

    if (!rawMessage && 'message' in error && typeof error.message === 'string') {
      rawMessage = error.message
    }

    if (rawMessage || errorCode) {
      return getFriendlyMessage(rawMessage, errorCode)
    }
  }

  return 'Verification failed. Please try again.'
}

interface TfaCheckResult {
  needsSetup: boolean
  required: boolean
}

export function useTfaSetup() {
  async function checkAndGenerateSecret(password: string): Promise<TfaCheckResult> {
    const directus = useDirectus()

    try {
      const config = useRuntimeConfig()
      const token = await directus.getToken()
      const { fetchPolicyGlobals } = usePermissions()

      // Whether 2FA is mandatory comes from the user's POLICIES, via the endpoint
      // Directus computes for them — see fetchPolicyGlobals() for why reading
      // `users/me?fields=policies.policy.enforce_tfa` (as this did) is unreliable:
      // app users cannot read directus_policies, so it came back empty and 2FA was
      // silently treated as optional for the very users a policy enforces it on.
      const [policyGlobals, response] = await Promise.all([
        fetchPolicyGlobals(),
        fetch(
          `${config.public.directusUrl}/users/me?fields=tfa_secret`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      ])

      // Fail CLOSED. If enforcement can't be determined, require setup rather than
      // waving the user through — skipping 2FA is not a safe default.
      isTfaRequired.value = policyGlobals?.enforce_tfa ?? true

      const { data: userData } = await response.json() as {
        data: { tfa_secret: string | null }
      }

      if (userData?.tfa_secret) {
        return { needsSetup: false, required: false }
      }
    } catch {
      isTfaRequired.value = true
    }

    try {
      const tfaResponse = await directus.request(generateTwoFactorSecret(password))
      const secret = tfaResponse?.secret ?? ''
      const otpauthUrl = tfaResponse?.otpauth_url ?? ''
      // If Directus didn't return a usable secret + QR URL (e.g. SSO/external
      // accounts, or an unexpected empty response), don't show a broken setup
      // step that strands the user on an empty/stuck QR box — skip it instead.
      if (!secret || !otpauthUrl) {
        resetSetup()
        return { needsSetup: false, required: false }
      }
      authenticatorSecret.value = secret
      authenticatorOtpauthUrl.value = otpauthUrl
      return { needsSetup: true, required: isTfaRequired.value }
    } catch {
      return { needsSetup: false, required: false }
    }
  }

  async function verifyCode(code: string): Promise<VerifyCodeResult> {
    if (isVerifyingAuthenticator.value) {
      return { success: false }
    }

    isVerifyingAuthenticator.value = true

    try {
      const directus = useDirectus()
      await directus.request(enableTwoFactor(authenticatorSecret.value, code))
      // They're enrolled — lift the middleware's gate now rather than leaving the
      // cached verdict to lapse, which would bounce them straight back here.
      useTfaEnforcement().markTfaEnrolled()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        errorMessage: getTfaErrorMessage(error),
      }
    } finally {
      isVerifyingAuthenticator.value = false
    }
  }

  function resetSetup(): void {
    authenticatorSecret.value = ''
    authenticatorOtpauthUrl.value = ''
    isTfaRequired.value = false
  }

  return {
    authenticatorSecret: readonly(authenticatorSecret),
    authenticatorOtpauthUrl: readonly(authenticatorOtpauthUrl),
    isVerifyingAuthenticator: readonly(isVerifyingAuthenticator),
    isTfaRequired: readonly(isTfaRequired),
    checkAndGenerateSecret,
    verifyCode,
    resetSetup,
  }
}

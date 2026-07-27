// Verifies a Cloudflare Turnstile token server-side against the siteverify
// endpoint. The secret key never reaches the browser. Returns true only when
// Cloudflare confirms the token is valid.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

interface TurnstileVerifyResponse {
  success: boolean
  'error-codes'?: string[]
}

export async function verifyTurnstileToken(
  token: string,
  secretKey: string,
  remoteIp: string | null = null,
): Promise<boolean> {
  const form = new URLSearchParams()
  form.append('secret', secretKey)
  form.append('response', token)
  if (remoteIp) {
    form.append('remoteip', remoteIp)
  }

  try {
    const verifyResult = await $fetch<TurnstileVerifyResponse>(SITEVERIFY_URL, {
      method: 'POST',
      body: form,
    })
    if (!verifyResult.success) {
      console.warn('Turnstile verification failed:', verifyResult['error-codes'])
    }
    return verifyResult.success === true
  } catch (verifyError) {
    console.error('Turnstile verification request failed:', verifyError)
    return false
  }
}

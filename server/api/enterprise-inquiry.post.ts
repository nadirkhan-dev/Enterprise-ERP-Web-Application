// Receives an enterprise "Let's Talk" inquiry from the login page, verifies the
// Cloudflare Turnstile token to block bot spam, then forwards the data to the
// Microsoft Form. Verification is skipped only when no secret key is configured
// (local dev without keys).

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface InquiryBody {
  companyName?: string
  yourName?: string
  phoneNumber?: string
  emailAddress?: string
  turnstileToken?: string
}

// Public "Let's Talk" Microsoft Form (anonymous responses enabled). The
// responses endpoint URL lives in env (NUXT_MS_FORM_RESPONSES_URL) so it stays
// out of the repo; the question IDs map our fields to the form's questions. If
// the form is recreated, BOTH the env URL and these IDs must be updated together.
const MS_FORM_QUESTION_IDS = {
  companyName: 're2534182ec2741499d1be20791cd2c00',
  yourName: 'r210b5514d9a44bd98b18ea3c84fc8cff',
  phoneNumber: 'rbf86a9eddf9143fb9442758390f1df72',
  emailAddress: 'rf4b21b86cab64e728058a95d043ecb34',
  submittedDate: 'rbdbb3be520184d60b996c79f784e4a41',
}

interface VerifiedInquiry {
  companyName: string
  yourName: string
  phoneNumber: string
  emailAddress: string
}

// Submit the inquiry to the Microsoft Form as an anonymous response. The date
// question is filled with the submission date (YYYY-MM-DD). `answers` must be a
// JSON-encoded string, matching what the form's own response page sends.
async function forwardToMicrosoftForm(responsesUrl: string, inquiry: VerifiedInquiry): Promise<void> {
  const now = new Date()
  const answers = [
    { questionId: MS_FORM_QUESTION_IDS.companyName, answer1: inquiry.companyName },
    { questionId: MS_FORM_QUESTION_IDS.yourName, answer1: inquiry.yourName },
    { questionId: MS_FORM_QUESTION_IDS.phoneNumber, answer1: inquiry.phoneNumber },
    { questionId: MS_FORM_QUESTION_IDS.emailAddress, answer1: inquiry.emailAddress },
    { questionId: MS_FORM_QUESTION_IDS.submittedDate, answer1: now.toISOString().slice(0, 10) },
  ]

  await $fetch(responsesUrl, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'odata-version': '4.0',
      'origin': 'https://forms.office.com',
    },
    body: {
      startDate: now.toISOString(),
      submitDate: now.toISOString(),
      answers: JSON.stringify(answers),
      emailReceiptConsent: false,
    },
  })
}

export default defineEventHandler(async (event) => {
  const body = await readBody<InquiryBody>(event)

  const companyName = body?.companyName?.trim() || ''
  const yourName = body?.yourName?.trim() || ''
  const phoneNumber = body?.phoneNumber?.trim() || ''
  const emailAddress = body?.emailAddress?.trim() || ''

  if (!companyName || !yourName || !phoneNumber || !EMAIL_PATTERN.test(emailAddress)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'All fields are required and the email address must be valid.',
    })
  }

  const config = useRuntimeConfig()
  const secretKey = config.turnstileSecretKey as string
  const responsesUrl = config.msFormResponsesUrl as string

  if (!responsesUrl) {
    console.error('NUXT_MS_FORM_RESPONSES_URL is not configured — cannot forward enterprise inquiry.')
    throw createError({
      statusCode: 500,
      statusMessage: 'Inquiry destination is not configured.',
    })
  }

  // Bot check — only enforced when a secret key is configured.
  if (secretKey) {
    const token = body?.turnstileToken
    if (!token) {
      throw createError({ statusCode: 400, statusMessage: 'Captcha verification is required.' })
    }
    const isHuman = await verifyTurnstileToken(
      token,
      secretKey,
      getRequestIP(event, { xForwardedFor: true }) ?? null,
    )
    if (!isHuman) {
      throw createError({ statusCode: 403, statusMessage: 'Captcha verification failed.' })
    }
  } else {
    console.warn('NUXT_TURNSTILE_SECRET_KEY is not set — enterprise inquiry submitted without bot verification.')
  }

  // Forward to the Microsoft Form. A failure here means the lead would be lost,
  // so surface it as an error and let the user retry rather than silently
  // showing success.
  try {
    await forwardToMicrosoftForm(responsesUrl, { companyName, yourName, phoneNumber, emailAddress })
  } catch (forwardError) {
    console.error('Failed to forward enterprise inquiry to Microsoft Forms:', forwardError)
    throw createError({
      statusCode: 502,
      statusMessage: 'Could not submit your inquiry. Please try again.',
    })
  }

  return { success: true }
})

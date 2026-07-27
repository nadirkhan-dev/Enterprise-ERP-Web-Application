/**
 * Square Web Payments SDK loader + Card element controller.
 *
 * The SDK is loaded from Square's CDN on first use. The raw card data
 * never touches our server — it's captured in Square's hosted iframe and
 * exchanged for a one-time nonce via `tokenize()`.
 */

interface SquareCardElement {
  attach: (selector: string | HTMLElement) => Promise<void>
  destroy: () => Promise<void>
  tokenize: () => Promise<{
    status: 'OK' | 'Errors'
    token?: string
    errors?: Array<{ message: string, field?: string, type?: string }>
  }>
  configure: (options: Record<string, unknown>) => Promise<void>
}

interface SquarePayments {
  card: (options?: Record<string, unknown>) => Promise<SquareCardElement>
}

interface SquareGlobal {
  payments: (applicationId: string, locationId: string) => SquarePayments
}

declare global {
  interface Window {
    Square?: SquareGlobal
  }
}

let sdkLoadPromise: Promise<SquareGlobal> | null = null

function loadSquareSdk(applicationId: string): Promise<SquareGlobal> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Square SDK can only be loaded in the browser'))
  }
  if (window.Square) {return Promise.resolve(window.Square)}
  if (sdkLoadPromise) {return sdkLoadPromise}

  const src = applicationId.startsWith('sandbox-')
    ? 'https://sandbox.web.squarecdn.com/v1/square.js'
    : 'https://web.squarecdn.com/v1/square.js'

  sdkLoadPromise = new Promise<SquareGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing) {
      existing.addEventListener('load', () => {
        if (window.Square) {resolve(window.Square)}
        else {reject(new Error('Square SDK loaded but window.Square is undefined'))}
      })
      existing.addEventListener('error', () => reject(new Error('Failed to load Square SDK')))
      return
    }

    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => {
      if (window.Square) {resolve(window.Square)}
      else {reject(new Error('Square SDK loaded but window.Square is undefined'))}
    }
    script.onerror = () => {
      sdkLoadPromise = null
      reject(new Error('Failed to load Square SDK'))
    }
    document.head.appendChild(script)
  })

  return sdkLoadPromise
}

export interface SquareCardController {
  attach: (container: string | HTMLElement, style?: Record<string, unknown>) => Promise<void>
  tokenize: () => Promise<string>
  destroy: () => Promise<void>
}

export class SquareTokenizeError extends Error {
  details: Array<{ message: string, field?: string }>
  constructor(message: string, details: Array<{ message: string, field?: string }>) {
    super(message)
    this.name = 'SquareTokenizeError'
    this.details = details
  }
}

/**
 * Returns helpers to mount the Square Card iframe and tokenize on submit.
 *
 * Usage:
 *   const card = useSquareWebPayments()
 *   await card.attach('#card-container')
 *   const nonce = await card.tokenize()
 *   ...
 *   await card.destroy()
 */
export function useSquareWebPayments(): SquareCardController {
  const config = useRuntimeConfig()
  const appId = config.public.squareAppId as string
  const locationId = config.public.squareLocationId as string

  if (!appId || !locationId) {
    throw new Error(
      'Square public config is missing — set NUXT_PUBLIC_SQUARE_APPLICATION_ID and NUXT_PUBLIC_SQUARE_LOCATION_ID',
    )
  }

  let cardElement: SquareCardElement | null = null

  async function attach(container: string | HTMLElement, style?: Record<string, unknown>): Promise<void> {
    const Square = await loadSquareSdk(appId)
    const payments = Square.payments(appId, locationId)
    try {
      // `style` themes the fields inside Square's hosted iframe (the only way
      // to reach them — they're cross-origin).
      cardElement = await payments.card(style ? { style } : undefined)
    } catch (styleError) {
      // Square rejects the whole call if any style key is unsupported; fall
      // back to default styling so the card form still loads.
      console.warn('Square card style rejected, using defaults:', styleError)
      cardElement = await payments.card()
    }
    await cardElement.attach(container)
  }

  async function tokenize(): Promise<string> {
    if (!cardElement) {
      throw new Error('Square card element is not attached yet')
    }
    const result = await cardElement.tokenize()
    if (result.status === 'OK' && result.token) {
      return result.token
    }
    const details = result.errors || []
    const message = details[0]?.message || 'Card tokenization failed'
    throw new SquareTokenizeError(message, details)
  }

  async function destroy(): Promise<void> {
    if (!cardElement) {return}
    try {
      await cardElement.destroy()
    } catch {
      // SDK throws if destroy is called twice — safe to ignore.
    }
    cardElement = null
  }

  return { attach, tokenize, destroy }
}

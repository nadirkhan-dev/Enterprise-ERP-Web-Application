import { LookerNodeSDK } from '@looker/sdk-node'
import type { Looker40SDK } from '@looker/sdk'

let sdk: Looker40SDK | null = null

export function getLookerSdk(): Looker40SDK {
  if (sdk) return sdk

  const config = useRuntimeConfig()

  // Set env vars the SDK expects before initializing
  process.env.LOOKERSDK_BASE_URL = String(config.lookerBaseUrl)
  process.env.LOOKERSDK_CLIENT_ID = String(config.lookerClientId)
  process.env.LOOKERSDK_CLIENT_SECRET = String(config.lookerClientSecret)

  sdk = LookerNodeSDK.init40()
  return sdk
}

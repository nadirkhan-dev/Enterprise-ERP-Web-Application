

export interface PromptMessage {
  /** Role code from `prompt_message_roles` — `system`, `user`. */
  role: string
  content: string
}

interface CachedPrompt {
  messages: PromptMessage[] | null
  expiresAt: number
}

// Matches providerConfig's TTL: prompts are edited by hand, so a few minutes of
// staleness is fine and the lookup stays off the request path.
const PROMPT_CACHE_TTL_MS = 5 * 60 * 1000
const promptCache = new Map<string, CachedPrompt>()

interface DirectusPromptResponse {
  data?: Array<{
    messages?: Array<{
      message?: string | null
      prompt_message_roles_id?: { code?: string | null } | null
    }> | null
  }>
}

/**
 * The ordered messages of one prompt, by slug.
 *
 * @param slug the prompt's immutable handle (e.g. `notes-improve`).
 * @returns the messages in registry order, or null when the prompt does not
 *          exist, carries no messages, or Directus could not be reached.
 */
export async function fetchPromptMessages(slug: string): Promise<PromptMessage[] | null> {
  const cached = promptCache.get(slug)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.messages
  }

  const messages = await lookupPrompt(slug)
  promptCache.set(slug, { messages, expiresAt: Date.now() + PROMPT_CACHE_TTL_MS })
  return messages
}

async function lookupPrompt(slug: string): Promise<PromptMessage[] | null> {
  const runtime = useRuntimeConfig()
  const directusUrl = String(runtime.directusUrl || '').replace(/\/$/, '')
  const directusToken = String(runtime.directusToken || '')
  if (!directusUrl || !directusToken) {
    return null
  }

  const url = new URL(`${directusUrl}/items/prompts`)
  url.searchParams.set('fields', 'messages.message,messages.prompt_message_roles_id.code')
  url.searchParams.set('filter[slug][_eq]', slug)
  // `prompt_messages_sort` is the collection's own ordering field; without it
  // the messages come back in insertion order, which is not the same thing once
  // someone reorders them in the admin UI.
  url.searchParams.set('deep[messages][_sort]', 'prompt_messages_sort')
  url.searchParams.set('limit', '1')

  let response: Response
  try {
    response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${directusToken}` },
    })
  } catch (error) {
    console.warn(`[promptRegistry] Directus network error for "${slug}": ${(error as Error).message}`)
    return null
  }

  if (!response.ok) {
    console.warn(`[promptRegistry] Directus lookup for "${slug}" failed (${response.status})`)
    return null
  }

  const payload = (await response.json()) as DirectusPromptResponse
  const rows = payload.data?.[0]?.messages ?? []

  const messages = rows
    .map((row) => ({
      role: String(row.prompt_message_roles_id?.code ?? '').trim(),
      content: String(row.message ?? '').trim(),
    }))
    // A row missing either half cannot be sent to the model; dropping it beats
    // sending an empty or role-less message the API would reject outright.
    .filter((message) => message.role && message.content)

  return messages.length ? messages : null
}

/** Test seam — drops the cached prompts so the next call re-reads Directus. */
export function resetPromptCache(): void {
  promptCache.clear()
}

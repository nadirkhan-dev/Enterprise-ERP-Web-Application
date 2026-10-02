/**
 * Extract the lowercase domain portion of an email address.
 * Returns null when the input doesn't contain an `@`.
 */
export function getEmailDomain(email: string): string | null {
  const trimmed = email.trim()
  const atIndex = trimmed.indexOf('@')
  if (atIndex === -1) { return null }
  return trimmed.substring(atIndex + 1).toLowerCase()
}

/**
 * Extract the lowercase username (local part) of an email address — everything
 * before the `@`. Returns null when there's no `@` or the local part is empty.
 */
export function getEmailUsername(email: string): string | null {
  const trimmed = email.trim()
  const atIndex = trimmed.indexOf('@')
  if (atIndex <= 0) { return null }
  return trimmed.substring(0, atIndex).toLowerCase()
}

/**
 * Whether an email domain belongs to a generic provider (gmail, yahoo, etc.).
 *
 * Generic providers host unrelated people under one domain, so matching them by
 * domain during duplicate detection would flag hundreds of unrelated partners.
 * Instead they're matched by *username* across generic providers (see
 * {@link buildContactEmailDuplicateFilter} / {@link getEmailMatchSegments}). The
 * provider list is admin-managed in the `company_settings` singleton and
 * surfaced via the company settings store as a lowercased set for O(1) lookups.
 */
export function isGenericEmailDomain(
  domain: string | null,
  genericDomains: Set<string>,
): boolean {
  if (!domain) { return false }
  return genericDomains.has(domain.trim().toLowerCase())
}

/**
 * Build the contact-email leg of a duplicate search — the filter that goes
 * under `contacts.contacts_id`. Two modes:
 *
 * - **Corporate domain** → matches any contact sharing the domain (`@acme.com`),
 *   since same domain implies same organization.
 * - **Generic provider** (gmail, …) → matches the same username across generic
 *   providers only (`sarah@gmail.com`, `sarah@yahoo.com`, …), never a corporate
 *   domain, so a shared free-provider domain can't flood the results.
 *
 * Returns null when the input has no usable email.
 */
export function buildContactEmailDuplicateFilter(
  email: string,
  genericDomains: Set<string>,
): Record<string, unknown> | null {
  const domain = getEmailDomain(email)
  if (!domain) { return null }

  if (!isGenericEmailDomain(domain, genericDomains)) {
    return { email_address: { _icontains: `@${domain}` } }
  }

  const username = getEmailUsername(email)
  if (!username) { return null }

  const genericList = [...genericDomains]
  // Same username, but restricted to the configured generic providers. The
  // `_istarts_with` pins the username exactly (no bigsarah@ false positives);
  // the `_iends_with` OR restricts the domain to generic providers.
  if (genericList.length === 0) {
    return { email_address: { _istarts_with: `${username}@` } }
  }
  return {
    _and: [
      { email_address: { _istarts_with: `${username}@` } },
      { _or: genericList.map((genericDomain) => ({ email_address: { _iends_with: `@${genericDomain}` } })) },
    ],
  }
}

/**
 * Split a candidate email into `{ text, match }` segments for the duplicate
 * table, marking which portion matches the entered email. Mirrors the server
 * filter from {@link buildContactEmailDuplicateFilter}:
 *
 * - **Generic provider** → highlight the **username** when it matches on any
 *   generic provider.
 * - **Corporate, exact address** → highlight the **whole email**.
 * - **Corporate, same domain** (different user) → highlight the **domain**.
 * - Otherwise a single unhighlighted segment.
 */
export function getEmailMatchSegments(
  candidateEmail: string,
  enteredEmail: string,
  genericDomains: Set<string>,
): { text: string, match: boolean }[] {
  const candidate = (candidateEmail || '').trim()
  const entered = (enteredEmail || '').trim()
  const noMatch = [{ text: candidateEmail || '', match: false }]

  if (!candidate || !entered) { return noMatch }

  const enteredDomain = getEmailDomain(entered)
  const atIndex = candidate.indexOf('@')
  if (!enteredDomain || atIndex === -1) { return noMatch }

  const candidateLocal = candidate.substring(0, atIndex)
  const candidateDomain = candidate.substring(atIndex + 1).toLowerCase()

  // Generic provider: the username is the identity — highlight it when it
  // matches on any generic provider.
  if (isGenericEmailDomain(enteredDomain, genericDomains)) {
    const enteredUsername = getEmailUsername(entered)
    const isMatch = !!enteredUsername
      && candidateLocal.toLowerCase() === enteredUsername
      && isGenericEmailDomain(candidateDomain, genericDomains)
    if (!isMatch) { return noMatch }
    return [
      { text: candidateLocal, match: true },
      { text: candidate.substring(atIndex), match: false }, // `@domain`
    ]
  }

  // Corporate, exact address → highlight everything.
  if (candidate.toLowerCase() === entered.toLowerCase()) {
    return [{ text: candidate, match: true }]
  }

  // Corporate, same domain (different user) → highlight the domain.
  if (candidateDomain === enteredDomain) {
    return [
      { text: candidate.substring(0, atIndex + 1), match: false }, // `user@`
      { text: candidate.substring(atIndex + 1), match: true }, // `domain`
    ]
  }

  return noMatch
}

export function normalizeWebsite<T>(url: T): T | string {
  if (typeof url !== 'string') { return url }
  const trimmed = url.trim()
  if (!trimmed) { return trimmed }
  return trimmed.replace(/\/+$/, '')
}

/**
 * Extract the lowercase hostname of a URL, with `www-` prefix stripped.
 * Returns null when the input is not a parseable URL.
 */
export function getWebsiteDomain(url: string): string | null {
  try {
    const hostname = new URL(url.trim()).hostname
    return hostname.replace(/^www-/, '').toLowerCase()
  } catch {
    return null
  }
}

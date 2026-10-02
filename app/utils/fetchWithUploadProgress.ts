/**
 * POST a body and report how much of it has left the browser.
 *
 * `fetch` has no upload-progress event — `Response.body` measures the download
 * side only — so an upload is opaque to it. Chromium's streaming request bodies
 * (`duplex: 'half'`) are the only fetch-based alternative and are unsupported in
 * Firefox and Safari, which leaves XMLHttpRequest as the one cross-browser way
 * to watch bytes go out.
 *
 * Rejects like `$fetch` does, so callers wrap it in `tryCatch` unchanged.
 *
 * @example
 * const { data, error } = await tryCatch(
 *   fetchWithUploadProgress('/api/requests/attachments', {
 *     body: form,
 *     headers,
 *     onProgress: (percent) => { row.progress = percent },
 *   }),
 * )
 */

interface UploadProgressOptions {
  body: FormData | Blob | File
  headers?: Record<string, string>
  /** Called with 0–100 as the body uploads. Omitted for a body of unknown length. */
  onProgress?: ((percent: number) => void) | null
}

/** Pull Nitro's `statusMessage` out of an error body, falling back to the status. */
function readErrorMessage(request: XMLHttpRequest): string {
  const fallback = `Upload failed (${request.status})`
  const payload = request.response
  if (payload && typeof payload === 'object') {
    const body = payload as { statusMessage?: string, message?: string }
    return body.statusMessage || body.message || fallback
  }
  return fallback
}

export function fetchWithUploadProgress<T>(
  url: string,
  options: UploadProgressOptions,
): Promise<T> {
  const { body, headers = {}, onProgress = null } = options

  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', url)
    // Parsed for us on success and on error, so both paths read the same way.
    request.responseType = 'json'

    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value)
    }

    if (onProgress) {
      request.upload.addEventListener('progress', (event) => {
        // False for a body of unknown length — reporting 0% forever would read as
        // a stalled upload, so nothing is reported at all.
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100))
        }
      })
    }

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(request.response as T)
        return
      }
      reject(new Error(readErrorMessage(request)))
    })

    // Network-level failures carry no status or body — the browser withholds the
    // reason (CORS, DNS, connection dropped) from script.
    request.addEventListener('error', () => {
      reject(new Error('Upload failed — the request could not be sent.'))
    })
    request.addEventListener('timeout', () => {
      reject(new Error('Upload timed out.'))
    })
    request.addEventListener('abort', () => {
      reject(new Error('Upload was cancelled.'))
    })

    request.send(body)
  })
}

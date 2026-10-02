import { fetchWithUploadProgress } from '~/utils/fetchWithUploadProgress'

/**
 * Stand-in for XMLHttpRequest: records what the wrapper set up, and lets a test
 * drive the upload/load/error events the browser would fire.
 */
class MockXhr {
  static instances: MockXhr[] = []

  method = ''
  url = ''
  responseType = ''
  sentBody: unknown = null
  requestHeaders: Record<string, string> = {}
  status = 200
  response: unknown = null

  listeners: Record<string, ((event: unknown) => void)[]> = {}
  uploadListeners: Record<string, ((event: unknown) => void)[]> = {}

  // Its own bag per instance, mirroring xhr.upload's separate event target.
  upload = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      (this.uploadListeners[type] ||= []).push(handler)
    },
  }

  constructor() {
    MockXhr.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name] = value
  }

  addEventListener(type: string, handler: (event: unknown) => void) {
    (this.listeners[type] ||= []).push(handler)
  }

  send(body: unknown) {
    this.sentBody = body
  }

  emit(type: string, event: unknown = {}) {
    for (const handler of this.listeners[type] ?? []) handler(event)
  }

  emitUpload(event: unknown) {
    for (const handler of this.uploadListeners.progress ?? []) handler(event)
  }
}

function getLastRequest(): MockXhr {
  return MockXhr.instances[MockXhr.instances.length - 1] as MockXhr
}

beforeEach(() => {
  MockXhr.instances = []
  globalThis.XMLHttpRequest = MockXhr as unknown as typeof XMLHttpRequest
})

describe('Scenario: Watching an upload progress', () => {
  it('reports the percentage of the body that has been sent', async () => {
    const reported: number[] = []
    const pending = fetchWithUploadProgress('/api/requests/attachments', {
      body: new FormData(),
      onProgress: (percent) => reported.push(percent),
    })

    const request = getLastRequest()
    request.emitUpload({ lengthComputable: true, loaded: 25, total: 100 })
    request.emitUpload({ lengthComputable: true, loaded: 100, total: 100 })
    request.response = { attachmentGid: '1' }
    request.emit('load')
    await pending

    expect(reported).toEqual([25, 100])
  })

  it('stays silent when the body length is unknown, rather than reporting a stalled 0%', async () => {
    const reported: number[] = []
    const pending = fetchWithUploadProgress('/api/requests/attachments', {
      body: new FormData(),
      onProgress: (percent) => reported.push(percent),
    })

    const request = getLastRequest()
    request.emitUpload({ lengthComputable: false, loaded: 0, total: 0 })
    request.emit('load')
    await pending

    expect(reported).toEqual([])
  })
})

describe('Scenario: Sending the request', () => {
  it('posts the body to the given url with the caller\'s headers', async () => {
    const form = new FormData()
    const pending = fetchWithUploadProgress('/api/requests/attachments', {
      body: form,
      headers: { Authorization: 'Bearer token-123' },
    })

    const request = getLastRequest()
    request.emit('load')
    await pending

    expect(request.method).toBe('POST')
    expect(request.url).toBe('/api/requests/attachments')
    expect(request.sentBody).toBe(form)
    expect(request.requestHeaders).toEqual({ Authorization: 'Bearer token-123' })
  })

  it('resolves with the parsed response body on success', async () => {
    const pending = fetchWithUploadProgress<{ attachmentGid: string }>('/api/x', {
      body: new FormData(),
    })

    const request = getLastRequest()
    request.status = 201
    request.response = { attachmentGid: '99' }
    request.emit('load')

    await expect(pending).resolves.toEqual({ attachmentGid: '99' })
  })
})

describe('Scenario: A failed upload', () => {
  it('rejects with the server\'s message when the request is refused', async () => {
    const pending = fetchWithUploadProgress('/api/x', { body: new FormData() })

    const request = getLastRequest()
    request.status = 413
    request.response = { statusMessage: 'File is too large (max 50 MB).' }
    request.emit('load')

    await expect(pending).rejects.toThrow('File is too large (max 50 MB).')
  })

  it('falls back to the status code when the error carries no message', async () => {
    const pending = fetchWithUploadProgress('/api/x', { body: new FormData() })

    const request = getLastRequest()
    request.status = 500
    request.response = null
    request.emit('load')

    await expect(pending).rejects.toThrow('Upload failed (500)')
  })

  it('rejects when the request never reaches the server', async () => {
    const pending = fetchWithUploadProgress('/api/x', { body: new FormData() })

    getLastRequest().emit('error')

    await expect(pending).rejects.toThrow('the request could not be sent')
  })
})

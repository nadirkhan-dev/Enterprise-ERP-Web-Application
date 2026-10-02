// @ts-nocheck

/**
 * Upload behaviour of the request drawers' attachment list: files are sent one
 * at a time once the request has been filed, each row carrying its own progress,
 * and one failure must not take the rest of the submission with it.
 */
describe('Scenario: Uploading a request\'s supporting files', () => {
  let useRequestAttachments: typeof import('../../app/composables/useRequestAttachments').useRequestAttachments

  /** Uploads that stay in flight until the test releases them by name. */
  let pendingUploads: Map<string, {
    resolve: () => void
    reject: (error: Error) => void
    report: (percent: number) => void
  }>
  let inFlight: number
  let uploadOrder: string[]

  function createPngFile(name: string): File {
    return new File(['screenshot-bytes'], name, { type: 'image/png' })
  }

  /** The filename the composable put in the request body. */
  function readSentFilename(body: FormData): string {
    return (body.get('file') as File).name
  }

  beforeAll(async () => {
    vi.mock('~/composables/useDirectus', () => ({
      useDirectus: () => ({ getToken: async () => 'token-abc' }),
    }))
    // The composable ties object-URL cleanup to a component that does not exist
    // here, and happy-dom has no object URLs to revoke.
    globalThis.onBeforeUnmount = () => {}
    globalThis.URL.createObjectURL = () => 'blob:preview'
    globalThis.URL.revokeObjectURL = () => {}
    globalThis.tryCatch = async (operation) => {
      try {
        return { data: await operation, error: null }
      } catch (error) {
        return { data: null, error }
      }
    }

    const composableModule = await import('../../app/composables/useRequestAttachments')
    useRequestAttachments = composableModule.useRequestAttachments
  })

  beforeEach(() => {
    pendingUploads = new Map()
    inFlight = 0
    uploadOrder = []

    globalThis.fetchWithUploadProgress = vi.fn((url, options) => {
      const filename = readSentFilename(options.body)
      uploadOrder.push(filename)
      inFlight += 1

      return new Promise((resolve, reject) => {
        pendingUploads.set(filename, {
          report: (percent) => options.onProgress?.(percent),
          resolve: () => {
            inFlight -= 1
            resolve({ attachmentGid: `gid-${filename}` })
          },
          reject: (error) => {
            inFlight -= 1
            reject(error)
          },
        })
      })
    })
  })

  /** Let the loop start the next upload. */
  async function settle() {
    for (let tick = 0; tick < 5; tick++) {
      await Promise.resolve()
    }
  }

  it('moves a row to uploading and reports its progress as the bytes go out', async () => {
    const { attachments, addFiles, uploadAttachments } = useRequestAttachments()
    addFiles([createPngFile('a.png')])

    const pending = uploadAttachments('12345')
    await settle()

    const row = attachments.value[0]
    expect(row.status).toBe('uploading')
    expect(row.progress).toBe(0)

    pendingUploads.get('a.png').report(45)
    expect(row.progress).toBe(45)

    pendingUploads.get('a.png').resolve()
    await pending

    // Finishes at a full bar, which is what the row shows on completion.
    expect(row.progress).toBe(100)
    expect(row.status).toBe('uploaded')
  })

  it('sends one file at a time rather than opening them all at once', async () => {
    const { addFiles, uploadAttachments } = useRequestAttachments()
    addFiles(['a.png', 'b.png', 'c.png'].map(createPngFile))

    const pending = uploadAttachments('12345')
    await settle()

    expect(inFlight).toBe(1)
    expect(uploadOrder).toEqual(['a.png'])

    for (const name of ['a.png', 'b.png', 'c.png']) {
      await settle()
      pendingUploads.get(name)?.resolve()
    }
    await pending

    expect(uploadOrder).toEqual(['a.png', 'b.png', 'c.png'])
  })

  it('keeps going when one file fails, and reports only that file', async () => {
    const { attachments, addFiles, uploadAttachments } = useRequestAttachments()
    addFiles(['a.png', 'b.png', 'c.png'].map(createPngFile))

    const pending = uploadAttachments('12345')
    await settle()
    pendingUploads.get('a.png').resolve()
    await settle()
    pendingUploads.get('b.png').reject(new Error('Upload failed (502)'))
    await settle()
    pendingUploads.get('c.png').resolve()
    const failed = await pending

    expect(failed.map((row) => row.name)).toEqual(['b.png'])
    expect(attachments.value.filter((row) => row.status === 'uploaded')).toHaveLength(2)
  })

  it('posts the file and its task as multipart, authenticated as the user', async () => {
    const { addFiles, uploadAttachments } = useRequestAttachments()
    addFiles([createPngFile('report.png')])

    const pending = uploadAttachments('12345')
    await settle()

    const [url, options] = globalThis.fetchWithUploadProgress.mock.calls[0]
    expect(url).toBe('/api/requests/attachments')
    expect(options.body.get('taskGid')).toBe('12345')
    expect(options.headers.Authorization).toBe('Bearer token-abc')

    pendingUploads.get('report.png').resolve()
    await pending
  })

  it('does not re-send a file that already made it onto the task', async () => {
    const { attachments, addFiles, uploadAttachments } = useRequestAttachments()
    addFiles(['a.png', 'b.png'].map(createPngFile))

    const firstAttempt = uploadAttachments('12345')
    await settle()
    pendingUploads.get('a.png').resolve()
    await settle()
    pendingUploads.get('b.png').reject(new Error('Upload failed (502)'))
    await firstAttempt

    uploadOrder = []
    const retry = uploadAttachments('12345')
    await settle()

    expect(uploadOrder).toEqual(['b.png'])
    pendingUploads.get('b.png').resolve()
    await retry

    expect(attachments.value.every((row) => row.status === 'uploaded')).toBe(true)
  })

  it('leaves a file rejected on drop out of the upload entirely', async () => {
    const { attachments, addFiles, uploadAttachments } = useRequestAttachments()
    addFiles([
      createPngFile('good.png'),
      new File(['x'], 'installer.exe', { type: 'application/x-msdownload' }),
    ])

    const pending = uploadAttachments('12345')
    await settle()

    expect(uploadOrder).toEqual(['good.png'])
    pendingUploads.get('good.png').resolve()
    const failed = await pending

    // Reported as failed even though it was never sent — it still didn't make it.
    expect(failed.map((row) => row.name)).toEqual(['installer.exe'])
    expect(attachments.value.find((row) => row.name === 'installer.exe').errorMessage)
      .toBe('This file format is not supported')
  })
})

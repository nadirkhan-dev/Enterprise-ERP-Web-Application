/**
 * Generic typed wrapper around a Web Worker.
 *
 * Turns the postMessage/onmessage callback pattern into a
 * Promise-based API. Each `send()` call returns a Promise that
 * resolves when the worker posts back a response with a matching
 * `requestId`.
 *
 * Usage:
 *   const client = createWorkerClient(myWorker)
 *   const result = await client.send('countries', 'normalize', { rawData })
 *   client.terminate() // when done (e.g. on logout)
 */
import type {
  WorkerAction,
  WorkerRequest,
  WorkerResponse,
} from '~/types/worker'

interface PendingRequest<T = unknown> {
  resolve: (data: T) => void
  reject: (error: Error) => void
}

let requestCounter = 0

function generateRequestId(): string {
  return `req_${++requestCounter}_${Date.now()}`
}

export interface WorkerClient {
  send: <TResult = unknown, TPayload = unknown>(
    collection: string,
    action: WorkerAction,
    payload: TPayload,
  ) => Promise<TResult>
  terminate: () => void
}

export function createWorkerClient(worker: Worker): WorkerClient {
  const pending = new Map<string, PendingRequest>()

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data
    const request = pending.get(response.requestId)
    if (!request) return

    pending.delete(response.requestId)

    if (response.type === 'error') {
      request.reject(new Error(response.error))
    } else {
      request.resolve(response.data)
    }
  }

  worker.onerror = (event: ErrorEvent) => {
    // Reject all pending requests on unhandled worker error
    const workerError = new Error(event.message || 'Worker error')
    for (const [requestId, request] of pending) {
      request.reject(workerError)
      pending.delete(requestId)
    }
  }

  function send<TResult = unknown, TPayload = unknown>(
    collection: string,
    action: WorkerAction,
    payload: TPayload,
  ): Promise<TResult> {
    return new Promise((resolve, reject) => {
      const requestId = generateRequestId()
      pending.set(requestId, {
        resolve: resolve as (data: unknown) => void,
        reject,
      })

      // Strip Vue/Pinia reactive proxies — structured clone rejects them.
      // JSON roundtrip is fast enough for reference data sizes and keeps
      // callers from having to remember to unwrap their inputs.
      const plainPayload = JSON.parse(JSON.stringify(payload)) as TPayload

      const message: WorkerRequest<TPayload> = {
        type: 'request',
        requestId,
        collection,
        action,
        payload: plainPayload,
      }

      worker.postMessage(message)
    })
  }

  function terminate(): void {
    const terminationError = new Error('Worker terminated')
    for (const [requestId, request] of pending) {
      request.reject(terminationError)
      pending.delete(requestId)
    }
    worker.terminate()
  }

  return { send, terminate }
}

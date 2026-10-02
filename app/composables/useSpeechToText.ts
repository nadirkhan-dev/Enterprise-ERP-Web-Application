import type { Ref, ComputedRef } from 'vue'
import { useDirectus } from '~/composables/useDirectus'


/** Matches the rate the relay opens the upstream session at. */
const SAMPLE_RATE = 24000

const FRAME_SIZE = 4096

const MAX_QUEUED_FRAMES = 200

const FINISH_TIMEOUT_MS = 35000

const LEVEL_BAR_COUNT = 96

const LEVEL_INTERVAL_MS = 60

interface UseSpeechToTextOptions {
  /** Called once per finished utterance, with its final text. */
  onSegment: (text: string) => void
  /** Called when dictation fails; the message is written for the user. */
  onError?: (message: string) => void
}

interface UseSpeechToTextReturn {
  isSupported: Ref<boolean>
  isRecording: Ref<boolean>
  isConnecting: Ref<boolean>
  isFinishing: Ref<boolean>
  interimText: Ref<string>
  audioLevels: Ref<number[]>
  isBusy: ComputedRef<boolean>
  startRecording: () => Promise<void>
  stopRecording: () => void
  /** Drop the session immediately, tail transcript and all (drawer closed). */
  cancelRecording: () => void
}

/** PCM16 little-endian, base64 — the shape the realtime API accepts. */
function encodeAudioFrame(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    // Clamp before scaling: values just outside [-1, 1] wrap to the opposite
    // sign as 16-bit ints, which sounds like a loud click.
    const sample = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF
  }
  const bytes = new Uint8Array(pcm.buffer)
  let binary = ''
  // Chunked: String.fromCharCode with tens of thousands of args overflows the
  // call stack.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function useSpeechToText(options: UseSpeechToTextOptions): UseSpeechToTextReturn {
  const isSupported = ref(false)
  const isRecording = ref(false)
  const isConnecting = ref(false)
  const isFinishing = ref(false)
  const interimText = ref('')
  let pendingUtterances: { id: string, text: string, isFinal: boolean }[] = []

  /** What is on screen but not yet committed: every utterance still pending. */
  function syncInterimText() {
    interimText.value = pendingUtterances.map((utterance) => utterance.text).join(' ').trim()
  }

  function commitSettledUtterances() {
    while (pendingUtterances[0]?.isFinal) {
      const [settled] = pendingUtterances.splice(0, 1)
      if (settled.text.trim()) {
        options.onSegment(settled.text.trim())
      }
    }
    syncInterimText()
  }
  function commitPendingUtterances() {
    for (const utterance of pendingUtterances) {
      if (utterance.text.trim()) {
        options.onSegment(utterance.text.trim())
      }
    }
    pendingUtterances = []
    syncInterimText()
  }
  const audioLevels = ref<number[]>([])
  // Finishing counts as busy: the session is still open, so a second start
  // would talk over a transcript that has not landed yet.
  const isBusy = computed(() => isRecording.value || isConnecting.value || isFinishing.value)

  let socket: WebSocket | null = null
  let pendingSocket: Promise<WebSocket> | null = null
  let audioContext: AudioContext | null = null
  let stream: MediaStream | null = null
  let processor: ScriptProcessorNode | null = null
  let queued: string[] = []
  /** Drives the waveform; lives on the same graph as the upload processor. */
  let analyser: AnalyserNode | null = null
  let levelFrame: number | null = null
  let lastLevelAt = 0
  let finishTimer: ReturnType<typeof setTimeout> | null = null

  onMounted(() => {
    isSupported.value = Boolean(navigator.mediaDevices?.getUserMedia)
      && typeof AudioContext !== 'undefined'
      && typeof WebSocket !== 'undefined'
  })

  function fail(message: string) {
    options.onError?.(message)
    teardown()
  }

  /** Sample the microphone into the scrolling level meter the waveform draws. */
  function startLevelMeter() {
    if (!analyser) {
      return
    }
    const samples = new Uint8Array(analyser.fftSize)
    audioLevels.value = []

    const tick = (now: number) => {
      levelFrame = requestAnimationFrame(tick)
      if (now - lastLevelAt < LEVEL_INTERVAL_MS || !analyser) {
        return
      }
      lastLevelAt = now

      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const sample of samples) {
        // 128 is silence in unsigned 8-bit PCM; deviation either way is signal.
        const deviation = (sample - 128) / 128
        sum += deviation * deviation
      }
      // RMS is small for speech at normal levels, so it is scaled to fill the
      // meter rather than leaving every bar a stub.
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 4)
      const next = [...audioLevels.value, level]
      // Grows to full width, then scrolls: the oldest bar drops off the left.
      audioLevels.value = next.length > LEVEL_BAR_COUNT
        ? next.slice(next.length - LEVEL_BAR_COUNT)
        : next
    }

    lastLevelAt = 0
    levelFrame = requestAnimationFrame(tick)
  }

  function stopLevelMeter() {
    if (levelFrame !== null) {
      cancelAnimationFrame(levelFrame)
      levelFrame = null
    }
    audioLevels.value = []
  }

  function releaseCapture() {
    stopLevelMeter()
    processor?.disconnect()
    processor = null
    analyser?.disconnect()
    analyser = null
    queued = []
    audioContext?.close().catch(() => {})
    audioContext = null
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
  }

  function teardown() {
    if (finishTimer) {
      clearTimeout(finishTimer)
      finishTimer = null
    }
    releaseCapture()
    if (socket && socket.readyState <= WebSocket.OPEN) {
      socket.close(1000)
    }
    socket = null
    pendingSocket?.then((orphan) => orphan.close(1000)).catch(() => {})
    pendingSocket = null
    // Anything still on screen is committed rather than cleared: the words were
    // heard, and the field is where they belong.
    commitPendingUtterances()
    isRecording.value = false
    isConnecting.value = false
    isFinishing.value = false
    interimText.value = ''
  }

  /** Our own relay, carrying the caller's Directus token for the upgrade. */
  async function openSocket(): Promise<WebSocket> {
    const directus = useDirectus()
    const token = await directus.getToken()
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${location.host}/_ws/transcribe?token=${encodeURIComponent(token ?? '')}`

    return new Promise((resolve, reject) => {
      const next = new WebSocket(url)
      next.onopen = () => resolve(next)
      next.onerror = () => reject(new Error('Dictation could not connect.'))
    })
  }

  function handleServerMessage(raw: string) {
    let event: { type?: string, id?: string, text?: string, message?: string }
    try {
      event = JSON.parse(raw)
    } catch {
      return
    }

    switch (event.type) {
      case 'ready':
        isConnecting.value = false
        // The meter is hidden while connecting, so whatever it collected in
        // that window would otherwise appear as an instant full-width wave.
        // Cleared here so it draws from the left the moment it becomes visible.
        audioLevels.value = []
        break
      case 'delta': {
        const id = event.id ?? ''
        const pending = pendingUtterances.find((utterance) => utterance.id === id && !utterance.isFinal)
        if (pending) {
          pending.text += event.text ?? ''
        } else {
          pendingUtterances.push({ id, text: event.text ?? '', isFinal: false })
        }
        syncInterimText()
        break
      }
      case 'segment': {
        const id = event.id ?? ''
        const pending = pendingUtterances.find((utterance) => utterance.id === id && !utterance.isFinal)
        const finalText = event.text ?? ''

        if (pending) {
          // An empty final is the relay's script guard rejecting this utterance
          // as noise — drop the live words with it, but only ITS words.
          pending.text = finalText
          pending.isFinal = true
        } else if (finalText.trim()) {
          // A transcript with no live words behind it (the tail after stop).
          pendingUtterances.push({ id, text: finalText, isFinal: true })
        }

        commitSettledUtterances()
        break
      }
      case 'done':
        // The tail transcript (if there was one) has already been handed over
        // by the `segment` above — the session is finished.
        teardown()
        break
      case 'error':
        fail(event.message || 'Dictation failed.')
        break
    }
  }

  /** Open the microphone and start streaming. */
  async function startRecording(): Promise<void> {
    if (isBusy.value) {
      return
    }
    if (!isSupported.value) {
      options.onError?.('This browser cannot record audio.')
      return
    }

    isConnecting.value = true

    // The socket needs nothing from the microphone, and the audio graph below
    // queues frames until it opens — so the two slow steps run together and the
    // wait is the longer of them rather than their sum. Both are seconds-scale
    // on a cold start: a device open with echo cancellation on one side, and
    // Directus auth plus the OpenAI realtime handshake on the other.
    pendingSocket = openSocket()
    // Handled where it is awaited below; this only keeps a rejection arriving
    // while getUserMedia is still pending from surfacing as unhandled.
    pendingSocket.catch(() => {})

    const { data: microphone, error } = await tryCatch(
      navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      }),
    )

    if (error || !microphone) {
      // teardown rather than clearing the flag: the socket may be mid-handshake.
      teardown()
      const isDenied = (error as Error & { name?: string })?.name === 'NotAllowedError'
        || (error as Error & { name?: string })?.name === 'SecurityError'
      options.onError?.(isDenied
        ? 'Microphone access was blocked. Allow it in your browser settings to dictate notes.'
        : 'No microphone is available.')
      return
    }
    stream = microphone

    const { error: audioError } = tryCatchSync(() => {
      // Ask for the session's rate directly; browsers resample the device for
      // us, which avoids shipping a resampler for a fixed, known target.
      audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
      const source = audioContext.createMediaStreamSource(microphone)
      processor = audioContext.createScriptProcessor(FRAME_SIZE, 1, 1)

      processor.onaudioprocess = (audioEvent) => {
        const frame = encodeAudioFrame(audioEvent.inputBuffer.getChannelData(0))
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'audio', audio: frame }))
          return
        }
        // Bounded: a connection that never opens must not grow this forever.
        if (queued.length < MAX_QUEUED_FRAMES) {
          queued.push(frame)
        }
      }

      // A ScriptProcessorNode only runs while connected to a destination, but
      // routing the microphone to the speakers would echo it back at the user —
      // so it terminates in a muted gain node instead.
      const muted = audioContext.createGain()
      muted.gain.value = 0
      source.connect(processor)
      processor.connect(muted)
      muted.connect(audioContext.destination)

      // Read off the same source, purely for the waveform: it taps the signal
      // and goes nowhere, so it can never affect what is uploaded.
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
    })

    if (audioError) {
      teardown()
      options.onError?.('Recording could not be started.')
      return
    }

    // The context is built after `getUserMedia` resolves, which is outside the
    // click that started this — enough for a browser's autoplay policy to hand
    // back a SUSPENDED context. A suspended context never runs the processor, so
    // not one frame would be captured and the transcript would stay empty.
    if (audioContext.state === 'suspended') {
      await audioContext.resume().catch(() => {})
    }

    // Live from here — the red stop button shows immediately, before the socket
    // has finished connecting.
    isRecording.value = true
    startLevelMeter()

    const { data: opened, error: socketError } = await tryCatch(pendingSocket)
    pendingSocket = null

    // Torn down while the socket was still opening — the drawer closed, or stop
    // was pressed. The session is over, so close what arrived instead of wiring
    // it up to a graph that no longer exists.
    if (!isBusy.value) {
      opened?.close(1000)
      return
    }

    if (socketError || !opened) {
      teardown()
      options.onError?.('Dictation could not connect.')
      return
    }
    socket = opened
    socket.onmessage = (messageEvent) => handleServerMessage(String(messageEvent.data))
    socket.onclose = () => { if (isBusy.value) { teardown() } }

    // Whatever was said while connecting, in order, before any new frame.
    for (const frame of queued) {
      socket.send(JSON.stringify({ type: 'audio', audio: frame }))
    }
    queued = []
  }

  /**
   * Stop dictating — but not before the last sentence has been transcribed.
   *
   * Transcription runs on a committed buffer, so whatever was said since the
   * speaker's last pause is still upstream when they press stop. Closing here
   * would drop it. Instead the microphone is released immediately (the browser's
   * recording indicator goes out, and nothing further is uploaded) while the
   * socket stays open for the relay to commit that tail and send it back as a
   * normal segment, followed by `done`. The backstop timer covers a relay that
   * never answers.
   */
  function stopRecording(): void {
    if (!isRecording.value || socket?.readyState !== WebSocket.OPEN) {
      teardown()
      return
    }

    releaseCapture()
    isRecording.value = false
    isConnecting.value = false
    isFinishing.value = true

    socket.send(JSON.stringify({ type: 'stop' }))
    finishTimer = setTimeout(teardown, FINISH_TIMEOUT_MS)
  }

  /**
   * End the session now, without waiting for the tail — the drawer was closed or
   * the component is going away, so there is nowhere for a late segment to land.
   */
  function cancelRecording(): void {
    teardown()
  }

  // A drawer can close mid-dictation; without this the microphone stays open.
  onBeforeUnmount(teardown)

  return {
    isSupported,
    isRecording,
    isConnecting,
    isFinishing,
    interimText,
    audioLevels,
    isBusy,
    startRecording,
    stopRecording,
    cancelRecording,
  }
}

import { createEventStream } from 'h3'
import { deployBus } from '../../utils/deployBus'

export default defineEventHandler(async (event) => {
  const stream = createEventStream(event)

  const onDeploy = (payload: { version: string; env: string }) => {
    stream.push(JSON.stringify(payload))
  }

  deployBus.on('deploy', onDeploy)

  // Ping every 30s to prevent reverse proxy timeout (Cloudflare, Nginx, etc.)
  const heartbeat = setInterval(() => {
    stream.push({ event: 'ping', data: '' })
  }, 30000)

  stream.onClosed(async () => {
    clearInterval(heartbeat)
    deployBus.off('deploy', onDeploy)
    await stream.close()
  })

  return stream.send()
})

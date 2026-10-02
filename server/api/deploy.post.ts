import { deployBus } from '../utils/deployBus'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const token = config.deployToken

  if (token) {
    const authorization = getHeader(event, 'authorization')
    if (authorization !== `Bearer ${token}`) {
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
  }

  const body = await readBody(event)

  deployBus.emit('deploy', {
    version: body?.version || '',
    env: body?.env || '',
  })

  return { ok: true }
})

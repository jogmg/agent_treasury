import { createServer } from 'node:http'
import { loadBffConfig } from './config'
import { createBffApp } from './app'

const config = loadBffConfig()
const { app, close } = createBffApp(config)
const server = createServer(app)

server.requestTimeout = 120_000
server.headersTimeout = 15_000

server.listen(config.port, config.host, () => {
  console.log(
    `hermes-bff listening on http://${config.host}:${config.port} ` +
      `(public origin ${config.publicOrigin}, chat ${config.hermesUserUrl ? 'configured' : 'not configured'})`,
  )
})

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`hermes-bff shutting down (${signal})`)
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
  try {
    await close()
  } catch (error) {
    console.error('hermes-bff shutdown cleanup failed', error)
  }
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { WebSocketServer } from 'ws'
import fs from 'node:fs'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: true,
  },
  plugins: [react(), syncWsPlugin()],
})

function syncWsPlugin(): Plugin {
  return {
    name: 'allin-sync-ws',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true })
      let latestSnapshot: unknown = null
      const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
      const historyDir = path.resolve(process.cwd(), 'history')

      const ensureHistoryDir = () => {
        try {
          fs.mkdirSync(historyDir, { recursive: true })
        } catch {
          //
        }
      }

      const sendJson = (
        res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string) => void },
        status: number,
        data: unknown,
      ) => {
        res.statusCode = status
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(data))
      }

      const readBody = async (req: AsyncIterable<Uint8Array>): Promise<string> => {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        return Buffer.concat(chunks).toString('utf-8')
      }

      const safeBasename = (v: string): string | null => {
        const base = path.basename(v)
        if (!base.endsWith('.json')) return null
        if (base.includes('..')) return null
        return base
      }

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/history')) return next()
        ensureHistoryDir()

        const url = new URL(req.url, 'http://localhost')
        if (req.method === 'GET' && url.pathname === '/api/history') {
          try {
            const names = fs
              .readdirSync(historyDir)
              .filter((n) => n.endsWith('.json'))
              .map((name) => {
                const full = path.join(historyDir, name)
                const stat = fs.statSync(full)
                return { name, mtimeMs: stat.mtimeMs, size: stat.size }
              })
              .sort((a, b) => b.mtimeMs - a.mtimeMs)
            return sendJson(res, 200, { files: names })
          } catch {
            return sendJson(res, 500, { error: '读取历史记录失败' })
          }
        }

        if (req.method === 'GET' && url.pathname.startsWith('/api/history/')) {
          const rawName = decodeURIComponent(url.pathname.slice('/api/history/'.length))
          const name = safeBasename(rawName)
          if (!name) return sendJson(res, 400, { error: '文件名无效' })
          const full = path.join(historyDir, name)
          if (!fs.existsSync(full)) return sendJson(res, 404, { error: '文件不存在' })
          try {
            const text = fs.readFileSync(full, 'utf-8')
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(text)
            return
          } catch {
            return sendJson(res, 500, { error: '读取文件失败' })
          }
        }

        if (req.method === 'POST' && url.pathname === '/api/history') {
          try {
            const bodyText = await readBody(req)
            const data = JSON.parse(bodyText) as unknown
            const name = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}.json`
            const full = path.join(historyDir, name)
            fs.writeFileSync(full, JSON.stringify(data, null, 2), 'utf-8')
            return sendJson(res, 200, { name })
          } catch {
            return sendJson(res, 400, { error: '保存失败' })
          }
        }

        return sendJson(res, 405, { error: 'Method not allowed' })
      })

      server.httpServer?.on('upgrade', (req, socket, head) => {
        const url = req.url ? new URL(req.url, 'http://localhost') : null
        if (!url || url.pathname !== '/sync') return

        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req)
        })
      })

      wss.on('connection', (ws) => {
        if (latestSnapshot) ws.send(JSON.stringify({ type: 'snapshot', snapshot: latestSnapshot }))

        ws.on('message', (data) => {
          let msg: unknown
          try {
            msg = JSON.parse(String(data))
          } catch {
            return
          }

          if (!isRecord(msg)) return
          if (msg.type === 'ping') {
            try {
              ws.send(JSON.stringify({ type: 'pong', t: Date.now() }))
            } catch {
              //
            }
            return
          }
          if (msg.type === 'snapshot' && msg.snapshot) {
            latestSnapshot = msg.snapshot
            const payload = JSON.stringify({ type: 'snapshot', snapshot: latestSnapshot })
            for (const client of wss.clients) {
              if (client.readyState === 1) client.send(payload)
            }
          }
        })
      })
    },
  }
}

/**
 * dsh-archive-manager — server entry.
 *
 * Registers two same-origin routes on the host web server:
 *   GET  /plugins/dsh-archive-manager/list       -> archived session ids (+ best-effort metadata)
 *   POST /plugins/dsh-archive-manager/unarchive  -> move one session out of the archive set
 *
 * DeepSeek Harness 0.1.1-rc.2 ships only a one-way `workspace.archiveSession`
 * (no unarchive API). This plugin therefore performs the removal through the
 * workspace registry's own durable state writer (`enqueueOperation` +
 * `setState`). That is intentionally version-bound to 0.1.1-rc.2 internals.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-archive-manager'

/** Web-server service key candidates (newest first, mirrors dsh-agent-teams). */
const WEB_SERVER_KEYS = ['webServer', 'httpServer']
/** Workspace registry service key candidates. */
const WORKSPACE_KEYS = ['workspaceRegistry', 'workspaces']

const LIST_PATH = '/plugins/dsh-archive-manager/list'
const UNARCHIVE_PATH = '/plugins/dsh-archive-manager/unarchive'

// ---- diagnostic log (removed once verified) ----
const LOG_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'logs')
function log(msg) {
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    appendFileSync(join(LOG_DIR, 'dsh-archive-manager.log'), `[${new Date().toISOString()}] ${msg}\n`)
  } catch { /* logging must never break the plugin */ }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  res.end(body)
}

/** Read a small JSON request body; rejects over the limit. */
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > limit) reject(new Error('request body is too large'))
    })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

/** Best-effort metadata lookup for an archived session. */
function describeArchivedSession(registry, sessionId) {
  let createdAt
  let cwd
  try {
    const header = registry.headers?.get?.(sessionId)
    if (header !== undefined) {
      createdAt = typeof header.createdAt === 'number' ? header.createdAt : undefined
      cwd = header.cwd
    }
  } catch { /* ignore */ }
  let workspaceTitle
  let workspacePath
  try {
    for (const entity of registry.list()) {
      if (entity.sessionIds.includes(sessionId)) {
        workspaceTitle = entity.title
        workspacePath = entity.path
        break
      }
    }
  } catch { /* ignore */ }
  return { sessionId, createdAt, cwd, workspaceTitle, workspacePath }
}

/** Move one session out of the durable archive set (0.1.1-rc.2 workspace internals). */
async function unarchiveSession(registry, sessionId) {
  await registry.enqueueOperation(async () => {
    const state = registry.requireState()
    if (!state.archivedSessionIds.includes(sessionId)) return
    await registry.setState({
      ...state,
      archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId)
    })
  })
}

export function apply(ctx, config = {}) {
  log('apply called')
  let mounted = false
  const mount = () => {
    if (mounted) return
    const webServer = (ctx.get?.(WEB_SERVER_KEYS[0]) ?? ctx.get?.(WEB_SERVER_KEYS[1]))
    const registry = (ctx.get?.(WORKSPACE_KEYS[0]) ?? ctx.get?.(WORKSPACE_KEYS[1]))
    if (webServer === undefined || registry === undefined) {
      log(`mount deferred: webServer=${webServer === undefined ? 'missing' : 'ok'} registry=${registry === undefined ? 'missing' : 'ok'}`)
      return
    }
    log('mount: services ready, registering routes')
    mounted = true

    // Archived-session list.
    try {
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: LIST_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET' })
            res.end()
            return
          }
          try {
            const sessions = registry.archivedSessionIds.map((id) => describeArchivedSession(registry, id))
            sendJson(res, 200, { sessions })
          } catch (error) {
            sendJson(res, 500, { error: `failed to list archived sessions: ${String(error)}` })
          }
        }
      }), 'dsh-archive-manager: list route')
      log('list route registered')
    } catch (error) {
      log(`list route register threw: ${String(error && error.stack ? error.stack : error)}`)
    }

    // Restore (unarchive) one session.
    try {
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: UNARCHIVE_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }
          let payload
          try {
            const raw = await readJsonBody(req)
            payload = raw.trim() === '' ? {} : JSON.parse(raw)
          } catch {
            sendJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
          if (sessionId === '') {
            sendJson(res, 400, { error: 'sessionId is required' })
            return
          }
          try {
            await unarchiveSession(registry, sessionId)
            sendJson(res, 200, { ok: true, sessionId })
          } catch (error) {
            log(`unarchive ${sessionId} failed: ${String(error && error.stack ? error.stack : error)}`)
            sendJson(res, 500, { error: `failed to restore session: ${String(error)}` })
          }
        }
      }), 'dsh-archive-manager: unarchive route')
      log('unarchive route registered')
    } catch (error) {
      log(`unarchive route register threw: ${String(error && error.stack ? error.stack : error)}`)
    }
  }

  // Try immediately, then retry for a short window (services may bind late).
  mount()
  let attempts = 0
  const timer = setInterval(() => {
    attempts += 1
    if (mounted || attempts > 20) {
      clearInterval(timer)
      log(`retry loop ended: mounted=${mounted} attempts=${attempts}`)
      return
    }
    mount()
  }, 500)
  if (timer.unref) timer.unref()
}

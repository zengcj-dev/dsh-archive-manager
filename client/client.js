/* dsh-archive-manager — browser bundle (hand-written, no build step).
 *
 * Adds a "归档会话" section under Settings:
 *  - lists every archived session (title joined from the live session store),
 *  - each row has a "恢复" button that calls the same-origin unarchive route.
 * After a restore the host broadcasts host/archived-sessions-changed, so the
 * sidebar session tree updates immediately without a page reload.
 */
window.__ModuleLoader__.load({
  id: 'dsh-archive-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const { createElement: h, useCallback, useEffect, useState, useSyncExternalStore } = require('react')

    const NS = 'dsh-archive-manager'
    const LIST_URL = '/plugins/dsh-archive-manager/list'
    const UNARCHIVE_URL = '/plugins/dsh-archive-manager/unarchive'
    const ROW_STYLE = {
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 2px', borderBottom: '1px solid rgba(128,128,128,.18)'
    }
    const BTN_STYLE = {
      marginLeft: 'auto', padding: '5px 14px', borderRadius: '6px', border: 'none',
      cursor: 'pointer', background: 'var(--dsw-alias-accent, #2f6fed)', color: '#fff', fontSize: '13px'
    }
    const BTN_DISABLED = { ...BTN_STYLE, opacity: 0.5, cursor: 'default' }
    const META_STYLE = { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #8a8f98)' }
    const TITLE_STYLE = { fontWeight: 600, fontSize: '13px', lineHeight: 1.4 }
    const SUB_STYLE = { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #8a8f98)', marginTop: 2 }
    const NOTICE_STYLE = {
      padding: '6px 10px', borderRadius: '6px', margin: '8px 0', fontSize: '13px'
    }

    function pad(n) { return n < 10 ? '0' + n : String(n) }
    function fmtTime(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
      try {
        const d = new Date(ms)
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
          ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
      } catch { return '' }
    }
    function shortId(id) {
      const m = /^session-([0-9a-f]{8})/.exec(String(id))
      return m ? m[1] : String(id).slice(0, 12)
    }

    function ArchiveSection({ sessions }) {
      const [rows, setRows] = useState(null) // null = loading
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState('')
      const [notice, setNotice] = useState(null)

      // Live session summaries (title lookup). Re-subscribes on store change.
      const list = useSyncExternalStore(
        (fn) => sessions.list.subscribe(fn),
        () => sessions.list.getSnapshot()
      )
      const byId = (list && list.byId) || {}

      const refresh = useCallback(async () => {
        try {
          const res = await fetch(LIST_URL, { cache: 'no-store' })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const data = await res.json()
          setRows(Array.isArray(data.sessions) ? data.sessions : [])
          setError(null)
        } catch (e) {
          setError('无法读取归档列表：' + (e && e.message ? e.message : String(e)))
          setRows([])
        }
      }, [])

      useEffect(() => { void refresh() }, [refresh])

      const showNotice = (text, kind) => {
        setNotice({ text, kind })
        const timer = setTimeout(() => setNotice(null), 2600)
        return () => clearTimeout(timer)
      }

      const restore = async (sessionId) => {
        if (busy) return
        setBusy(sessionId)
        try {
          const res = await fetch(UNARCHIVE_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId }),
            cache: 'no-store'
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status))
          void showNotice('会话已恢复，已回到侧边栏会话列表', 'ok')
          void refresh()
        } catch (e) {
          void showNotice('恢复失败：' + (e && e.message ? e.message : String(e)), 'err')
        } finally {
          setBusy('')
        }
      }

      // ---- render ----
      const children = []
      if (error) {
        children.push(h('div', { key: 'err', style: { ...NOTICE_STYLE, background: 'rgba(220,38,38,.12)', color: '#dc2626' } }, error))
      }
      if (notice) {
        children.push(h('div', {
          key: 'notice', style: {
            ...NOTICE_STYLE,
            background: notice.kind === 'ok' ? 'rgba(22,163,74,.14)' : 'rgba(220,38,38,.12)',
            color: notice.kind === 'ok' ? '#16a34a' : '#dc2626'
          }
        }, notice.text))
      }
      if (rows === null) {
        children.push(h('div', { key: 'loading', style: { ...META_STYLE, padding: '16px 2px' } }, '加载中…'))
      } else if (rows.length === 0) {
        children.push(h('div', { key: 'empty', style: { ...META_STYLE, padding: '16px 2px' } },
          error ? '' : '没有已归档的会话'))
      } else {
        for (const item of rows) {
          const summary = byId[item.sessionId]
          const title = summary && summary.title ? summary.title : null
          const time = fmtTime(item.createdAt) || (summary && summary.createdAt ? fmtTime(summary.createdAt) : '')
          const meta = [
            title ? '' : '会话 ' + shortId(item.sessionId),
            time ? '创建于 ' + time : '',
            item.workspaceTitle ? '工作区：' + item.workspaceTitle : ''
          ].filter(Boolean).join(' · ')
          children.push(h('div', { key: item.sessionId, style: ROW_STYLE },
            h('div', { style: { minWidth: 0 } },
              h('div', { style: TITLE_STYLE }, title || ('未命名会话 (' + shortId(item.sessionId) + ')')),
              meta ? h('div', { style: SUB_STYLE }, meta) : null
            ),
            h('button', {
              type: 'button',
              style: busy === item.sessionId ? BTN_DISABLED : BTN_STYLE,
              disabled: busy !== '',
              onClick: () => void restore(item.sessionId)
            }, busy === item.sessionId ? '恢复中…' : '恢复')
          ))
        }
      }

      return h('div', { style: { padding: '4px 2px 20px' } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '4px' } },
          h('div', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary, #8a8f98)' } },
            rows === null ? '正在读取归档会话…' : ('共 ' + rows.length + ' 个归档会话')),
          h('button', {
            type: 'button',
            style: { ...BTN_STYLE, marginLeft: 'auto', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #8a8f98)' },
            onClick: () => void refresh()
          }, '刷新')
        ),
        ...children
      )
    }

    function apply(ctx) {
      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: NS,
        order: 65,
        label: () => '归档会话'
      }, () => h(ArchiveSection, { sessions: ctx.sessions }))), 'dsh-archive-manager: settings section')
    }

    module.exports = {
      name: NS,
      inject: ['slots', 'sessions'],
      apply
    }
    return module.exports
  }
})

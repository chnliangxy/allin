import { useCallback, useEffect, useRef, useState } from 'react'
import type { Action, GameState } from '../poker/engine'
import type { Route, SyncStatus } from '../uiTypes'

type Params = {
  state: GameState
  dispatch: (a: Action) => void
  reducer: (s: GameState, a: Action) => GameState
  route: Route
  setRoute: (r: Route) => void
}

function useGameSync(params: Params) {
  const { state, dispatch, reducer, route, setRoute } = params

  const stateRef = useRef<GameState>(state)
  const routeRef = useRef<Route>(route)
  const wsRef = useRef<WebSocket | null>(null)
  const pendingSnapshotRef = useRef<GameState | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const heartbeatTimerRef = useRef<number | null>(null)

  const [syncStatus, setSyncStatus] = useState<SyncStatus>('connecting')

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    routeRef.current = route
  }, [route])

  useEffect(() => {
    if (typeof WebSocket === 'undefined') return

    const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

    const clearTimers = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (heartbeatTimerRef.current !== null) {
        window.clearInterval(heartbeatTimerRef.current)
        heartbeatTimerRef.current = null
      }
    }

    const startHeartbeat = () => {
      if (heartbeatTimerRef.current !== null) return
      heartbeatTimerRef.current = window.setInterval(() => {
        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        ws.send(JSON.stringify({ type: 'ping', t: Date.now() }))
      }, 20_000)
    }

    const stopHeartbeat = () => {
      if (heartbeatTimerRef.current !== null) {
        window.clearInterval(heartbeatTimerRef.current)
        heartbeatTimerRef.current = null
      }
    }

    const connect = () => {
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return
      }

      setSyncStatus('connecting')

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/sync`)
      wsRef.current = ws

      ws.addEventListener('open', () => {
        setSyncStatus('connected')
        const snapshot = pendingSnapshotRef.current
        if (snapshot) {
          pendingSnapshotRef.current = null
          ws.send(JSON.stringify({ type: 'snapshot', snapshot }))
        }
        startHeartbeat()
      })

      ws.addEventListener('message', (ev) => {
        let msg: unknown
        try {
          msg = JSON.parse(String(ev.data))
        } catch {
          return
        }
        if (!isRecord(msg)) return
        if (msg.type === 'snapshot' && msg.snapshot) {
          const snapshot = msg.snapshot as GameState
          const normalized = { ...snapshot, rollbackStack: snapshot.rollbackStack ?? [] }
          pendingSnapshotRef.current = null
          stateRef.current = normalized
          dispatch({ type: 'SYNC_SET_SNAPSHOT', state: normalized })
          if (snapshot.session?.endedAt && routeRef.current === 'game') setRoute('summary')
        }
      })

      ws.addEventListener('close', () => {
        wsRef.current = null
        stopHeartbeat()
        setSyncStatus('disconnected')
        if (reconnectTimerRef.current === null) {
          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null
            connect()
          }, 800)
        }
      })

      ws.addEventListener('error', () => {
        setSyncStatus('disconnected')
      })
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') connect()
    }

    connect()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearTimers()
      const ws = wsRef.current
      wsRef.current = null
      try {
        ws?.close()
      } catch {
        //
      }
    }
  }, [dispatch, setRoute])

  const dispatchWithSync = useCallback(
    (action: Action) => {
      const ws = wsRef.current
      const next = reducer(stateRef.current, action)
      stateRef.current = next
      dispatch(action)

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'snapshot', snapshot: next }))
      } else {
        setSyncStatus('disconnected')
        pendingSnapshotRef.current = next
      }
    },
    [dispatch, reducer],
  )

  return { syncStatus, dispatchWithSync, stateRef }
}

export default useGameSync


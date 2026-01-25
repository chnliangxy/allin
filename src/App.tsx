import './App.css'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  computePotSize,
  computeSidePots,
  createInitialState,
  minRaiseTo,
  reducer,
  toCall,
  type Action,
  type GameConfig,
  type GameState,
  type PlayerAction,
  type Session,
} from './poker/engine'
import { computeWinnersFromInputs, type HandRank } from './poker/handEval'

type SyncStatus = 'connecting' | 'connected' | 'disconnected'
type Route = 'home' | 'game' | 'summary' | 'history' | 'rules'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type HistoryFile = { name: string; mtimeMs: number; size: number }
type PlayersSaveFeedback = { kind: 'success' | 'error'; text: string }

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState)
  const [route, setRoute] = useState<Route>(() => {
    const v = localStorage.getItem('allin.route')
    if (v === 'home' || v === 'game' || v === 'summary' || v === 'history' || v === 'rules') return v
    return 'home'
  })
  const routeRef = useRef<Route>(route)
  const stateRef = useRef<GameState>(state)
  const wsRef = useRef<WebSocket | null>(null)
  const pendingSnapshotRef = useRef<GameState | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const heartbeatTimerRef = useRef<number | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('connecting')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [savedFileName, setSavedFileName] = useState<string | null>(null)
  const [playersSaveFeedback, setPlayersSaveFeedback] = useState<PlayersSaveFeedback | null>(null)

  const potSize = useMemo(() => computePotSize(state.players), [state.players])
  const sidePots = useMemo(() => computeSidePots(state.players), [state.players])
  const setupKey = useMemo(() => {
    const playersKey = state.players.map((p) => `${p.name}:${p.stack}`).join('|')
    const configKey = `${state.config.smallBlind}-${state.config.bigBlind}-${state.config.ante}`
    return `${playersKey}-${configKey}-${state.dealerSeat}`
  }, [state.players, state.config, state.dealerSeat])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    localStorage.setItem('allin.route', route)
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
  }, [])

  const dispatchWithSync = (action: Action) => {
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
  }

  const startHandWithSession = () => {
    setPlayersSaveFeedback(null)
    const cur = stateRef.current
    if (!cur.session || cur.session.endedAt) {
      const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? (crypto as Crypto).randomUUID() : `${Date.now()}`
      dispatchWithSync({ type: 'SESSION_START', id, startedAt: Date.now() })
    }
    dispatchWithSync({ type: 'START_HAND' })
    setRoute('game')
  }

  const startNewSession = () => {
    setPlayersSaveFeedback(null)
    setSaveStatus('idle')
    setSavedFileName(null)
    dispatchWithSync({ type: 'RESET_GAME' })
    setRoute('game')
  }

  const computeSessionSummary = (s: GameState): Array<{
    seat: number
    name: string
    initial: number
    rebuy: number
    final: number
    net: number
  }> => {
    const session = s.session
    const initialStacks = session?.initialStacks ?? s.players.map(() => 0)
    const rebuys = session?.rebuys ?? s.players.map(() => 0)
    return s.players.map((p) => {
      const initial = initialStacks[p.seat] ?? 0
      const rebuy = rebuys[p.seat] ?? 0
      const final = p.stack
      const net = final - (initial + rebuy)
      return { seat: p.seat, name: p.name, initial, rebuy, final, net }
    })
  }

  const saveHistory = async (snapshot: GameState, endedAt: number) => {
    setSaveStatus('saving')
    setSavedFileName(null)
    const session = snapshot.session
    if (!session) {
      setSaveStatus('error')
      return
    }

    const record = {
      version: 1,
      session: { ...session, endedAt },
      config: snapshot.config,
      players: computeSessionSummary(snapshot),
      snapshot,
    }

    try {
      const res = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      })
      const data = (await res.json()) as unknown
      let name: string | null = null
      if (typeof data === 'object' && data !== null) {
        const v = (data as Record<string, unknown>).name
        if (typeof v === 'string') name = v
      }
      if (!res.ok || !name) {
        setSaveStatus('error')
        return
      }
      setSavedFileName(name)
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }

  const endSession = async () => {
    const cur = stateRef.current
    if (!cur.session || cur.session.endedAt) {
      setRoute('summary')
      return
    }
    const endedAt = Date.now()
    dispatchWithSync({ type: 'SESSION_END', endedAt })
    setSaveStatus('idle')
    setSavedFileName(null)
    setRoute('summary')
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-title">All-in</div>
          <div className="brand-sub">德州扑克线下筹码助手</div>
        </div>
        <div className="topbar-right">
          <div className={syncStatus === 'connected' ? 'sync connected' : syncStatus === 'connecting' ? 'sync connecting' : 'sync disconnected'}>
            同步：{syncStatus === 'connected' ? '已连接' : syncStatus === 'connecting' ? '连接中' : '未连接'}
          </div>
          <div className="tabs">
            <button className={route === 'home' ? 'tab active' : 'tab'} onClick={() => setRoute('home')}>
              主页
            </button>
            <button className={route === 'game' ? 'tab active' : 'tab'} onClick={() => setRoute('game')}>
              游戏
            </button>
            <button className={route === 'history' ? 'tab active' : 'tab'} onClick={() => setRoute('history')}>
              历史
            </button>
            <button className={route === 'rules' ? 'tab active' : 'tab'} onClick={() => setRoute('rules')}>
              规则
            </button>
          </div>
        </div>
      </header>

      {state.lastError ? <div className="banner error">{state.lastError}</div> : null}

      <main className="main">
        {route === 'home' ? (
          <HomeView
            state={state}
            syncStatus={syncStatus}
            onContinue={() => setRoute(state.session?.endedAt ? 'summary' : 'game')}
            onStartNew={startNewSession}
            onOpenHistory={() => setRoute('history')}
          />
        ) : route === 'history' ? (
          <HistoryView onBackHome={() => setRoute('home')} />
        ) : route === 'rules' ? (
          <RulesView />
        ) : route === 'summary' ? (
          <SessionSummaryView
            state={state}
            rows={computeSessionSummary(state)}
            saveStatus={saveStatus}
            savedFileName={savedFileName}
            onBackHome={() => setRoute('home')}
            onStartNew={startNewSession}
            onSave={() => {
              const session = state.session
              if (!session || !session.endedAt) return
              void saveHistory(state, session.endedAt)
            }}
          />
        ) : (
          <GameView
            state={state}
            potSize={potSize}
            sidePots={sidePots}
            setupKey={setupKey}
            canEditSetup={!state.session || !!state.session.endedAt}
            canRollback={state.rollbackStack.length > 0}
            onGoHome={() => setRoute('home')}
            onEndSession={() => void endSession()}
            onCancelHand={() => dispatchWithSync({ type: 'CANCEL_HAND' })}
            onRollback={() => dispatchWithSync({ type: 'ROLLBACK' })}
            playersSaveFeedback={playersSaveFeedback}
            onSetPlayersSaveFeedback={setPlayersSaveFeedback}
            onApplyConfig={(c) => dispatchWithSync({ type: 'SETUP_SET_CONFIG', config: c })}
            onApplyPlayers={(ps) => dispatchWithSync({ type: 'SETUP_SET_PLAYERS', players: ps })}
            onSetDealer={(s) => dispatchWithSync({ type: 'SETUP_SET_DEALER', dealerSeat: s })}
            onStartHand={startHandWithSession}
            onRebuy={(seat, amount) => dispatchWithSync({ type: 'REBUY', seat, amount })}
            onReset={() => dispatchWithSync({ type: 'RESET_GAME' })}
            onAct={(seat, action) => dispatchWithSync({ type: 'PLAYER_ACT', seat, action })}
            onNextStreet={() => dispatchWithSync({ type: 'NEXT_STREET' })}
            onSetBoard={(text) => dispatchWithSync({ type: 'SET_BOARD', text })}
            onSetHole={(seat, text) => dispatchWithSync({ type: 'SET_HOLE', seat, text })}
            onSetWinners={(seats) => dispatchWithSync({ type: 'SET_WINNERS', seats })}
            onSettle={() => dispatchWithSync({ type: 'SETTLE_HAND' })}
          />
        )}
      </main>
    </div>
  )
}

export default App

function SetupView(props: {
  config: GameConfig
  players: Array<{ name: string; stack: number }>
  dealerSeat: number
  canEditPlayers: boolean
  playersSaveFeedback: PlayersSaveFeedback | null
  onSetPlayersSaveFeedback: (v: PlayersSaveFeedback | null) => void
  onApplyConfig: (c: GameConfig) => void
  onApplyPlayers: (ps: Array<{ name: string; stack: number }>) => void
  onSetDealer: (seat: number) => void
  onStartHand: () => void
  onRebuy: (seat: number, amount: number) => void
  onReset: () => void
}) {
  type DraftPlayer = { name: string; stack: number; deleted: boolean; isNew: boolean }

  const [draftConfig, setDraftConfig] = useState<GameConfig>(props.config)
  const [draftPlayers, setDraftPlayers] = useState<DraftPlayer[]>(() => props.players.map((p) => ({ ...p, deleted: false, isNew: false })))
  const [rebuyAmount, setRebuyAmount] = useState(100)

  const canStart = draftPlayers.filter((p) => !p.deleted).filter((p) => p.stack > 0 && p.name.trim()).length >= 2
  const clearSavePlayersFeedback = () => props.onSetPlayersSaveFeedback(null)

  const savePlayers = () => {
    if (!props.canEditPlayers) {
      props.onSetPlayersSaveFeedback({ kind: 'error', text: '本局游戏进行中，不能修改玩家' })
      return
    }
    const remaining = draftPlayers.filter((p) => !p.deleted)
    if (remaining.length < 2) {
      props.onSetPlayersSaveFeedback({ kind: 'error', text: '至少需要2名玩家' })
      return
    }
    if (remaining.length > 10) {
      props.onSetPlayersSaveFeedback({ kind: 'error', text: '最多支持10名玩家' })
      return
    }

    const normalized: Array<{ name: string; stack: number }> = []
    for (const p of remaining) {
      const stack = p.stack
      if (!Number.isFinite(stack)) {
        props.onSetPlayersSaveFeedback({ kind: 'error', text: '筹码必须是数字' })
        return
      }
      normalized.push({ name: p.name, stack: Math.max(0, Math.trunc(stack)) })
    }

    props.onSetPlayersSaveFeedback({ kind: 'success', text: '保存成功' })
    props.onApplyPlayers(normalized)
  }

  return (
    <div className="panel">
      <details className="fold">
        <summary>规则设置</summary>
        <div className="fold-body">
          <div className="grid">
            <div className="field">
              <div className="label">小盲</div>
              <input
                type="number"
                value={draftConfig.smallBlind}
                min={0}
                onChange={(e) => setDraftConfig({ ...draftConfig, smallBlind: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <div className="label">大盲</div>
              <input
                type="number"
                value={draftConfig.bigBlind}
                min={0}
                onChange={(e) => setDraftConfig({ ...draftConfig, bigBlind: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <div className="label">前注</div>
              <input
                type="number"
                value={draftConfig.ante}
                min={0}
                onChange={(e) => setDraftConfig({ ...draftConfig, ante: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <div className="label">庄家位</div>
              <select value={props.dealerSeat} onChange={(e) => props.onSetDealer(Number(e.target.value))}>
                {draftPlayers.map((p, idx) => (
                  <option key={idx} value={idx}>
                    {idx + 1} - {p.name || `玩家${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="actions">
            <button onClick={() => props.onApplyConfig(draftConfig)}>保存盲注设置</button>
          </div>
        </div>
      </details>

      <details className="fold">
        <summary>玩家设置</summary>
        <div className="fold-body">
          <div className="players-edit">
            {draftPlayers.map((p, idx) => (
              <div
                className={
                  p.deleted
                    ? 'player-edit pending-delete'
                    : p.isNew
                      ? 'player-edit pending-add'
                      : (() => {
                          const saved = props.players[idx]
                          if (!saved) return 'player-edit'
                          const dirtyName = p.name.trim() !== saved.name
                          const dirtyStack = Math.max(0, Math.trunc(p.stack)) !== saved.stack
                          return dirtyName || dirtyStack ? 'player-edit dirty' : 'player-edit'
                        })()
                }
                key={idx}
              >
                <div className="seat">#{idx + 1}</div>
                <input
                  className={
                    (() => {
                      const saved = props.players[idx]
                      const dirty = !p.deleted && !p.isNew && !!saved && p.name.trim() !== saved.name
                      return dirty ? 'name dirty' : 'name'
                    })()
                  }
                  value={p.name}
                  placeholder={`玩家${idx + 1}`}
                  onChange={(e) => {
                    clearSavePlayersFeedback()
                    const next = [...draftPlayers]
                    next[idx] = { ...next[idx]!, name: e.target.value }
                    setDraftPlayers(next)
                  }}
                  disabled={p.deleted}
                />
                <input
                  className={
                    (() => {
                      const saved = props.players[idx]
                      const dirty = !p.deleted && !p.isNew && !!saved && Math.max(0, Math.trunc(p.stack)) !== saved.stack
                      return dirty ? 'stack dirty' : 'stack'
                    })()
                  }
                  type="number"
                  value={p.stack}
                  min={0}
                  onChange={(e) => {
                    clearSavePlayersFeedback()
                    const next = [...draftPlayers]
                    next[idx] = { ...next[idx]!, stack: Number(e.target.value) }
                    setDraftPlayers(next)
                  }}
                  disabled={p.deleted}
                />
                <button
                  className="danger"
                  disabled={!p.isNew && !p.deleted && draftPlayers.filter((x) => !x.deleted).length <= 2}
                  onClick={() => {
                    clearSavePlayersFeedback()
                    const next = [...draftPlayers]
                    const cur = next[idx]
                    if (!cur) return
                    if (cur.isNew) {
                      next.splice(idx, 1)
                    } else {
                      next[idx] = { ...cur, deleted: !cur.deleted }
                    }
                    setDraftPlayers(next)
                  }}
                >
                  {p.isNew ? '删除' : p.deleted ? '恢复' : '删除'}
                </button>
              </div>
            ))}
          </div>

          <div className="actions">
            <button
              disabled={draftPlayers.filter((p) => !p.deleted).length >= 10}
              onClick={() => {
                clearSavePlayersFeedback()
                setDraftPlayers([...draftPlayers, { name: `玩家${draftPlayers.length + 1}`, stack: 200, deleted: false, isNew: true }])
              }}
            >
              添加玩家
            </button>
            <button onClick={savePlayers}>保存玩家</button>
          </div>

          {props.playersSaveFeedback ? (
            <div className={props.playersSaveFeedback.kind === 'error' ? 'banner error' : 'banner'}>{props.playersSaveFeedback.text}</div>
          ) : null}
        </div>
      </details>

      <details className="fold">
        <summary>补码</summary>
        <div className="fold-body">
          <div className="rebuy">
            <div className="field">
              <div className="label">补码数量</div>
              <input type="number" min={0} value={rebuyAmount} onChange={(e) => setRebuyAmount(Number(e.target.value))} />
            </div>
            <div className="rebuy-list">
              {draftPlayers.map((p, idx) => (
                <button key={idx} onClick={() => props.onRebuy(idx, rebuyAmount)}>
                  {p.name || `玩家${idx + 1}`} +{rebuyAmount}
                </button>
              ))}
            </div>
          </div>
        </div>
      </details>

      <div className="actions">
        <button className="primary" disabled={!canStart} onClick={props.onStartHand}>
          开始这一手
        </button>
        <button className="danger" onClick={props.onReset}>
          重置
        </button>
      </div>
    </div>
  )
}

function TableView(props: {
  state: GameState
  potSize: number
  sidePots: Array<{ amount: number; eligibleSeats: number[] }>
  onAct: (seat: number, action: PlayerAction) => void
  onNextStreet: () => void
  onSetBoard: (text: string) => void
  onSetHole: (seat: number, text: string) => void
  onSetWinners: (seats: number[]) => void
  onSettle: () => void
  canRollback: boolean
  onRequestRollback: () => void
}) {
  const state = props.state
  const betToRef = useRef<HTMLInputElement>(null)
  const suggestedBetTo = minRaiseTo(state)
  const [rankMap, setRankMap] = useState<Map<number, HandRank>>(new Map())
  const [autoEvalError, setAutoEvalError] = useState<string | null>(null)

  const actor = state.players[state.actionSeat]
  const actorToCall = actor ? toCall(state, actor.seat) : 0

  const eligibleShowdown = state.players.filter((p) => p.status !== 'folded' && p.status !== 'out')

  return (
    <div className="table">
      <div className="summary">
        <div className="summary-left">
          <div className="kpi">
            <div className="kpi-label">阶段</div>
            <div className="kpi-value">{streetLabel(state.street)}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">底池</div>
            <div className="kpi-value">{props.potSize}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">当前下注</div>
            <div className="kpi-value">{state.currentBet}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">庄家位</div>
            <div className="kpi-value">#{state.dealerSeat + 1}</div>
          </div>
        </div>
        <div className="summary-right">
          <button onClick={props.onNextStreet}>强制下一街</button>
          <button className="danger" disabled={!props.canRollback} onClick={props.onRequestRollback}>
            Rollback
          </button>
        </div>
      </div>

      {props.sidePots.length > 1 ? (
        <div className="sidepots">
          {props.sidePots.map((p, idx) => (
            <div key={idx} className="sidepot">
              <div className="sidepot-title">{idx === 0 ? '主池' : `边池${idx}`}</div>
              <div className="sidepot-amount">{p.amount}</div>
              <div className="sidepot-eligible">
                参与：{p.eligibleSeats.map((s) => `#${s + 1}`).join(' ')}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="players">
        {state.players.map((p) => (
          <div key={p.seat} className={p.seat === state.actionSeat ? 'player active' : 'player'}>
            <div className="p-head">
              <div className="p-name">
                #{p.seat + 1} {p.name} {p.seat === state.dealerSeat ? 'D' : ''}
              </div>
              <div className="p-status">{statusLabel(p.status)}</div>
            </div>
            <div className="p-body">
              <div className="p-metric">
                <div className="label">筹码</div>
                <div className="value">{p.stack}</div>
              </div>
              <div className="p-metric">
                <div className="label">本街</div>
                <div className="value">{p.streetBet}</div>
              </div>
              <div className="p-metric">
                <div className="label">总投入</div>
                <div className="value">{p.totalCommitted}</div>
              </div>
              {state.phase === 'showdown' ? (
                <div className="p-metric wide">
                  <div className="label">手牌（可选）</div>
                  <input
                    value={p.holeCardsText}
                    placeholder="例如 As Kd"
                    onChange={(e) => props.onSetHole(p.seat, e.target.value)}
                  />
                </div>
              ) : null}
              {state.phase === 'showdown' && rankMap.has(p.seat) ? (
                <div className="p-metric wide">
                  <div className="label">判定</div>
                  <div className="value">{rankMap.get(p.seat)!.name}</div>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {state.phase === 'hand' && actor ? (
        <div className="actionbar">
          <div className="turn">
            轮到：#{actor.seat + 1} {actor.name}（需跟注 {actorToCall}）
          </div>
          <div className="btns">
            <div className="betto">
              <input
                key={`${state.street}-${state.currentBet}`}
                type="number"
                min={0}
                defaultValue={suggestedBetTo}
                ref={betToRef}
              />
              <button
                onClick={() => {
                  const v = Number(betToRef.current?.value ?? suggestedBetTo)
                  props.onAct(actor.seat, { type: 'BET_TO', betTo: v })
                }}
              >
                Bet/Raise
              </button>
            </div>
            <button onClick={() => props.onAct(actor.seat, actorToCall === 0 ? { type: 'CHECK' } : { type: 'CALL' })}>
              {actorToCall === 0 ? 'Check' : `Call ${actorToCall}`}
            </button>
            <button onClick={() => props.onAct(actor.seat, { type: 'ALLIN' })}>All-in ({actor.stack})</button>
            <button className="danger" onClick={() => props.onAct(actor.seat, { type: 'FOLD' })}>
              Fold
            </button>
            <div className="btns-spacer" />
            <button className="danger" disabled={!props.canRollback} onClick={props.onRequestRollback}>
              Rollback
            </button>
          </div>
        </div>
      ) : null}

      {state.phase === 'showdown' ? (
        <div className="showdown">
          <div className="panel-title">摊牌与结算</div>
          <div className="field">
            <div className="label">公共牌（5张，可选用于自动判定）</div>
            <input value={state.boardCardsText} placeholder="例如 As Kd 7h 7c 2s" onChange={(e) => props.onSetBoard(e.target.value)} />
          </div>

          <div className="winners">
            <div className="label">胜者（可多选用于平分底池）</div>
            <div className="winner-grid">
              {eligibleShowdown.map((p) => {
                const checked = state.winners.includes(p.seat)
                return (
                  <label key={p.seat} className="winner">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...state.winners, p.seat]
                          : state.winners.filter((s: number) => s !== p.seat)
                        props.onSetWinners(next)
                      }}
                    />
                    #{p.seat + 1} {p.name}
                  </label>
                )
              })}
            </div>
          </div>

          {autoEvalError ? <div className="banner error">{autoEvalError}</div> : null}

          <div className="actions">
            <button
              onClick={() => {
                const res = computeWinnersFromInputs({
                  boardText: state.boardCardsText,
                  playerHoles: eligibleShowdown.map((p) => ({
                    seat: p.seat,
                    holeText: p.holeCardsText,
                    folded: p.status === 'folded' || p.status === 'out',
                  })),
                })
                if (res.error) {
                  setAutoEvalError(res.error)
                  setRankMap(new Map())
                  return
                }
                setAutoEvalError(null)
                setRankMap(res.ranks)
                props.onSetWinners(res.winners)
              }}
            >
              自动判定胜者
            </button>
            <button className="primary" disabled={state.winners.length === 0} onClick={props.onSettle}>
              结算发筹码
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function RulesView() {
  return (
    <div className="panel">
      <div className="panel-title">德州扑克速查</div>
      <div className="rules">
        <div className="rule-block">
          <div className="rule-title">基本流程</div>
          <div className="rule-text">
            一局分为：发两张手牌（Preflop）→ 翻3张公共牌（Flop）→ 转牌（Turn）→ 河牌（River）→ 摊牌（Showdown）。
            每一街下注轮结束后，进入下一街；若只剩1名未弃牌玩家，则直接赢得底池。
          </div>
        </div>

        <div className="rule-block">
          <div className="rule-title">常用动作</div>
          <div className="rule-text">
            Check：当前无人下注或你已跟到当前下注。Call：跟注到当前下注。Fold：弃牌不再参与。All-in：投入所有剩余筹码。
            Bet/Raise：下注或加注到指定金额（本助手以“加到 betTo”为准）。
          </div>
        </div>

        <div className="rule-block">
          <div className="rule-title">牌型大小（高到低）</div>
          <div className="rule-text">同花顺 &gt; 四条 &gt; 葫芦 &gt; 同花 &gt; 顺子 &gt; 三条 &gt; 两对 &gt; 一对 &gt; 高牌。</div>
        </div>

        <div className="rule-block">
          <div className="rule-title">输入格式</div>
          <div className="rule-text">
            牌面用“点数+花色”表示：A K Q J T 9…2；花色用 s/h/d/c（也可用♠♥♦♣）。例如：As Kd 7h 7c 2s。
          </div>
        </div>
      </div>
    </div>
  )
}

function streetLabel(street: string): string {
  if (street === 'preflop') return 'Preflop'
  if (street === 'flop') return 'Flop'
  if (street === 'turn') return 'Turn'
  if (street === 'river') return 'River'
  return street
}

function statusLabel(status: string): string {
  if (status === 'active') return '进行中'
  if (status === 'folded') return '弃牌'
  if (status === 'allin') return 'All-in'
  if (status === 'out') return '出局'
  return status
}

function HomeView(props: {
  state: GameState
  syncStatus: SyncStatus
  onContinue: () => void
  onStartNew: () => void
  onOpenHistory: () => void
}) {
  const session = props.state.session
  const hasActive = !!session && !session.endedAt
  const hasEnded = !!session && !!session.endedAt

  return (
    <div className="panel">
      <div className="panel-title">汇总</div>
      <div className="home-kpis">
        <div className="kpi">
          <div className="kpi-label">同步</div>
          <div className="kpi-value">{props.syncStatus === 'connected' ? '已连接' : props.syncStatus === 'connecting' ? '连接中' : '未连接'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">玩家数</div>
          <div className="kpi-value">{props.state.players.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">状态</div>
          <div className="kpi-value">{hasActive ? '游戏中' : hasEnded ? '已结束' : '未开始'}</div>
        </div>
      </div>

      <div className="actions">
        {hasActive ? (
          <button className="primary" onClick={props.onContinue}>
            继续游戏
          </button>
        ) : null}
        <button className="primary" onClick={props.onStartNew}>
          开始新一局游戏
        </button>
        <button onClick={props.onOpenHistory}>历史记录</button>
      </div>

      {session ? (
        <div className="home-meta">
          <div className="label">本局ID</div>
          <div className="value">{session.id}</div>
          <div className="label">开始时间</div>
          <div className="value">{new Date(session.startedAt).toLocaleString()}</div>
          {session.endedAt ? (
            <>
              <div className="label">结束时间</div>
              <div className="value">{new Date(session.endedAt).toLocaleString()}</div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function GameView(props: {
  state: GameState
  potSize: number
  sidePots: Array<{ amount: number; eligibleSeats: number[] }>
  setupKey: string
  canEditSetup: boolean
  canRollback: boolean
  onGoHome: () => void
  onEndSession: () => void
  onCancelHand: () => void
  onRollback: () => void
  playersSaveFeedback: PlayersSaveFeedback | null
  onSetPlayersSaveFeedback: (v: PlayersSaveFeedback | null) => void
  onApplyConfig: (c: GameConfig) => void
  onApplyPlayers: (ps: Array<{ name: string; stack: number }>) => void
  onSetDealer: (s: number) => void
  onStartHand: () => void
  onRebuy: (seat: number, amount: number) => void
  onReset: () => void
  onAct: (seat: number, action: PlayerAction) => void
  onNextStreet: () => void
  onSetBoard: (text: string) => void
  onSetHole: (seat: number, text: string) => void
  onSetWinners: (seats: number[]) => void
  onSettle: () => void
}) {
  type ConfirmState = {
    title: string
    message: string
    confirmText: string
    confirmVariant: 'primary' | 'danger'
    onConfirm: () => void
  }

  const [confirm, setConfirm] = useState<ConfirmState | null>(null)

  const scoreboardRows = useMemo(() => {
    const rebuys = props.state.session?.rebuys ?? []
    return props.state.players
      .map((p) => {
        const rebuy = rebuys[p.seat] ?? 0
        const score = p.stack
        const net = score - rebuy
        return { seat: p.seat, name: p.name, score, rebuy, net }
      })
      .sort((a, b) => b.net - a.net || b.score - a.score || a.seat - b.seat)
  }, [props.state.players, props.state.session])

  return (
    <div className="panel">
      <div className="game-controls">
        <button onClick={props.onGoHome}>返回主页</button>
        {props.state.phase !== 'setup' ? (
          <button
            onClick={() => {
              setConfirm({
                title: '结束这一手游戏',
                message: '确认结束这一手游戏？本手积分不计，并返回准备页面。',
                confirmText: '确认结束',
                confirmVariant: 'danger',
                onConfirm: props.onCancelHand,
              })
            }}
          >
            结束这一手游戏
          </button>
        ) : null}
        <button
          className="danger"
          onClick={() => {
            setConfirm({
              title: '结束整局游戏',
              message: '确认结束整局游戏？结束后将进入积分汇总并保存历史。',
              confirmText: '确认结束',
              confirmVariant: 'danger',
              onConfirm: props.onEndSession,
            })
          }}
        >
          结束整局游戏
        </button>
      </div>

      <div className="scoreboard">
        <div className="scoreboard-table">
          <div className="scoreboard-head">
            <div>玩家</div>
            <div>筹码</div>
            <div>补码</div>
            <div>积分</div>
          </div>
          {scoreboardRows.map((r) => (
            <div className="scoreboard-row" key={r.seat}>
              <div>
                #{r.seat + 1} {r.name}
              </div>
              <div>{r.score}</div>
              <div>{r.rebuy}</div>
              <div className={r.net >= 0 ? 'net pos' : 'net neg'}>{r.net}</div>
            </div>
          ))}
        </div>
      </div>

      {props.state.phase === 'setup' ? (
        <SetupView
          key={props.setupKey}
          config={props.state.config}
          players={props.state.players.map((p) => ({ name: p.name, stack: p.stack }))}
          dealerSeat={props.state.dealerSeat}
          canEditPlayers={props.canEditSetup}
          playersSaveFeedback={props.playersSaveFeedback}
          onSetPlayersSaveFeedback={props.onSetPlayersSaveFeedback}
          onApplyConfig={props.onApplyConfig}
          onApplyPlayers={props.onApplyPlayers}
          onSetDealer={props.onSetDealer}
          onStartHand={props.onStartHand}
          onRebuy={props.onRebuy}
          onReset={() => {
            setConfirm({
              title: '重置',
              message: '确认重置？将清空当前局面与玩家筹码记录。',
              confirmText: '确认重置',
              confirmVariant: 'danger',
              onConfirm: props.onReset,
            })
          }}
        />
      ) : (
        <TableView
          state={props.state}
          potSize={props.potSize}
          sidePots={props.sidePots}
          onAct={props.onAct}
          onNextStreet={props.onNextStreet}
          onSetBoard={props.onSetBoard}
          onSetHole={props.onSetHole}
          onSetWinners={props.onSetWinners}
          onSettle={props.onSettle}
          canRollback={props.canRollback}
          onRequestRollback={() => {
            setConfirm({
              title: 'Rollback',
              message: '确认回滚上一次操作？',
              confirmText: '确认回滚',
              confirmVariant: 'danger',
              onConfirm: props.onRollback,
            })
          }}
        />
      )}

      {!props.canEditSetup && props.state.phase === 'setup' ? <div className="banner">本局进行中：盲注与玩家设置将锁定</div> : null}

      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmText={confirm.confirmText}
          confirmVariant={confirm.confirmVariant}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const action = confirm.onConfirm
            setConfirm(null)
            action()
          }}
        />
      ) : null}
    </div>
  )
}

function ConfirmDialog(props: {
  title: string
  message: string
  confirmText: string
  confirmVariant: 'primary' | 'danger'
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={props.onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{props.title}</div>
        <div className="modal-text">{props.message}</div>
        <div className="modal-actions">
          <button onClick={props.onCancel}>取消</button>
          <button className={props.confirmVariant} onClick={props.onConfirm}>
            {props.confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

type SummaryRow = {
  seat: number
  name: string
  initial: number
  rebuy: number
  final: number
  net: number
}

function SessionSummaryView(props: {
  state: GameState
  rows: SummaryRow[]
  saveStatus: SaveStatus
  savedFileName: string | null
  onBackHome: () => void
  onStartNew: () => void
  onSave: () => void
}) {
  const session = props.state.session

  return (
    <div className="panel">
      <div className="panel-title">积分汇总</div>

      {session ? (
        <div className="home-meta">
          <div className="label">本局ID</div>
          <div className="value">{session.id}</div>
          <div className="label">开始时间</div>
          <div className="value">{new Date(session.startedAt).toLocaleString()}</div>
          {session.endedAt ? (
            <>
              <div className="label">结束时间</div>
              <div className="value">{new Date(session.endedAt).toLocaleString()}</div>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="summary-table">
        <div className="summary-head">
          <div>玩家</div>
          <div>初始</div>
          <div>补码</div>
          <div>最终</div>
          <div>净值</div>
        </div>
        {props.rows.map((r) => (
          <div key={r.seat} className="summary-row">
            <div>
              #{r.seat + 1} {r.name}
            </div>
            <div>{r.initial}</div>
            <div>{r.rebuy}</div>
            <div>{r.final}</div>
            <div className={r.net >= 0 ? 'net pos' : 'net neg'}>{r.net}</div>
          </div>
        ))}
      </div>

      <div className="actions">
        <button onClick={props.onBackHome}>返回主页</button>
        <button className="primary" onClick={props.onStartNew}>
          开始新一局游戏
        </button>
        <button onClick={props.onSave} disabled={props.saveStatus === 'saving'}>
          {props.saveStatus === 'saving' ? '保存中…' : '保存到历史'}
        </button>
      </div>

      {props.saveStatus === 'saved' ? (
        <div className="banner">已保存：{props.savedFileName ?? ''}</div>
      ) : props.saveStatus === 'error' ? (
        <div className="banner error">保存失败</div>
      ) : null}
    </div>
  )
}

type HistoryRecord = {
  version: number
  session: Session
  config: GameConfig
  players: SummaryRow[]
  snapshot: GameState
}

function HistoryView(props: { onBackHome: () => void }) {
  const [files, setFiles] = useState<HistoryFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<HistoryRecord | null>(null)
  const [selectedName, setSelectedName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/history')
        const data = (await res.json()) as unknown
        if (!res.ok || typeof data !== 'object' || data === null || !('files' in data) || !Array.isArray((data as { files?: unknown }).files)) {
          if (!cancelled) setError('读取历史记录失败')
          return
        }
        const next = (data as { files: unknown[] }).files
          .map((f) => {
            if (typeof f !== 'object' || f === null) return null
            const r = f as { name?: unknown; mtimeMs?: unknown; size?: unknown }
            if (typeof r.name !== 'string' || typeof r.mtimeMs !== 'number' || typeof r.size !== 'number') return null
            return { name: r.name, mtimeMs: r.mtimeMs, size: r.size }
          })
          .filter((v): v is HistoryFile => !!v)
        if (!cancelled) setFiles(next)
      } catch {
        if (!cancelled) setError('读取历史记录失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const openFile = async (name: string) => {
    setSelected(null)
    setSelectedName(name)
    setError(null)
    try {
      const res = await fetch(`/api/history/${encodeURIComponent(name)}`)
      const data = (await res.json()) as unknown
      if (!res.ok) {
        setError('读取文件失败')
        return
      }
      if (typeof data !== 'object' || data === null) {
        setError('文件格式无效')
        return
      }
      setSelected(data as HistoryRecord)
    } catch {
      setError('读取文件失败')
    }
  }

  return (
    <div className="panel">
      <div className="panel-title">历史记录</div>
      <div className="actions">
        <button onClick={props.onBackHome}>返回主页</button>
        <button onClick={() => window.location.reload()} disabled={loading}>
          刷新
        </button>
      </div>

      {loading ? <div className="banner">加载中…</div> : null}
      {error ? <div className="banner error">{error}</div> : null}

      <div className="history">
        <div className="history-list">
          {files.length === 0 && !loading ? <div className="banner">暂无历史记录</div> : null}
          {files.map((f) => (
            <button
              key={f.name}
              className={selectedName === f.name ? 'history-item active' : 'history-item'}
              onClick={() => void openFile(f.name)}
            >
              <div className="history-name">{f.name}</div>
              <div className="history-meta">
                {new Date(f.mtimeMs).toLocaleString()} · {f.size}B
              </div>
            </button>
          ))}
        </div>

        <div className="history-detail">
          {selected ? (
            <>
              <div className="panel-title">详情</div>
              <div className="home-meta">
                <div className="label">开始时间</div>
                <div className="value">{new Date(selected.session.startedAt).toLocaleString()}</div>
                <div className="label">结束时间</div>
                <div className="value">{selected.session.endedAt ? new Date(selected.session.endedAt).toLocaleString() : '—'}</div>
                <div className="label">盲注</div>
                <div className="value">
                  {selected.config.smallBlind}/{selected.config.bigBlind}（前注 {selected.config.ante}）
                </div>
              </div>

              <div className="summary-table">
                <div className="summary-head">
                  <div>玩家</div>
                  <div>初始</div>
                  <div>补码</div>
                  <div>最终</div>
                  <div>净值</div>
                </div>
                {selected.players.map((r) => (
                  <div key={r.seat} className="summary-row">
                    <div>
                      #{r.seat + 1} {r.name}
                    </div>
                    <div>{r.initial}</div>
                    <div>{r.rebuy}</div>
                    <div>{r.final}</div>
                    <div className={r.net >= 0 ? 'net pos' : 'net neg'}>{r.net}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="banner">选择一条记录查看详情</div>
          )}
        </div>
      </div>
    </div>
  )
}

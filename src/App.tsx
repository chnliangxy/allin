import './App.css'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  computePotSize,
  computeSidePots,
  createInitialState,
  reducer,
  type GameState,
} from './poker/engine'
import ConfirmDialog from './components/ConfirmDialog'
import useGameSync from './hooks/useGameSync'
import HomeView from './views/HomeView'
import RulesView from './views/RulesView'
import SessionSummaryView, { type SummaryRow } from './views/SessionSummaryView'
import GameView from './views/GameView'
import HistoryView from './views/HistoryView'
import type {
  ConfirmState,
  PlayersSaveFeedback,
  Route,
  SaveStatus,
  TurnToastInfo,
  UiStyle,
} from './uiTypes'

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState)
  const [route, setRoute] = useState<Route>(() => {
    const v = localStorage.getItem('allin.route')
    if (v === 'home' || v === 'game' || v === 'summary' || v === 'history' || v === 'rules') return v
    return 'home'
  })
  const turnToastTimerRef = useRef<number | null>(null)
  const lastActionSeatRef = useRef<number | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [savedFileName, setSavedFileName] = useState<string | null>(null)
  const [playersSaveFeedback, setPlayersSaveFeedback] = useState<PlayersSaveFeedback | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [continuousGame, setContinuousGame] = useState(false)
  const [turnToast, setTurnToast] = useState<TurnToastInfo | null>(null)
  const [uiStyle, setUiStyle] = useState<UiStyle>(() => {
    const v = localStorage.getItem('allin.uiStyle')
    return v === 'text' ? 'text' : 'scene'
  })

  const { syncStatus, dispatchWithSync, stateRef } = useGameSync({ state, dispatch, reducer, route, setRoute })

  const potSize = useMemo(() => computePotSize(state.players), [state.players])
  const sidePots = useMemo(() => computeSidePots(state.players), [state.players])
  const setupKey = useMemo(() => {
    const playersKey = state.players.map((p) => `${p.name}:${p.stack}`).join('|')
    const configKey = `${state.config.smallBlind}-${state.config.bigBlind}-${state.config.ante}`
    return `${playersKey}-${configKey}-${state.dealerSeat}`
  }, [state.players, state.config, state.dealerSeat])

  useEffect(() => {
    localStorage.setItem('allin.route', route)
  }, [route])

  useEffect(() => {
    localStorage.setItem('allin.uiStyle', uiStyle)
  }, [uiStyle])

  useEffect(() => {
    if (state.phase !== 'hand') {
      lastActionSeatRef.current = null
      if (turnToastTimerRef.current !== null) {
        window.clearTimeout(turnToastTimerRef.current)
        turnToastTimerRef.current = null
      }
      window.setTimeout(() => setTurnToast(null), 0)
      return
    }
    const seat = state.actionSeat
    if (seat < 0 || seat >= state.players.length) return
    if (lastActionSeatRef.current === seat) return
    lastActionSeatRef.current = seat
    if (turnToastTimerRef.current !== null) {
      window.clearTimeout(turnToastTimerRef.current)
      turnToastTimerRef.current = null
    }
    const player = state.players[seat]
    const name = player?.name || `玩家${seat + 1}`
    window.setTimeout(() => setTurnToast({ seat, name }), 0)
    turnToastTimerRef.current = window.setTimeout(() => {
      setTurnToast(null)
      turnToastTimerRef.current = null
    }, 2000)
  }, [state.phase, state.actionSeat, state.players])

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

  const settleHandWithMaybeContinue = () => {
    const before = stateRef.current
    dispatchWithSync({ type: 'SETTLE_HAND' })
    if (!continuousGame) return
    const after = stateRef.current
    if (before.phase !== 'showdown') return
    if (!after.session || after.session.endedAt) return
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

  const requestStartNewSession = () => {
    const cur = stateRef.current
    if (cur.session && !cur.session.endedAt) {
      setConfirm({
        title: '开始新一局游戏',
        message: '确认开始新一局游戏？将直接放弃正在进行的游戏。',
        confirmText: '确认开始',
        confirmVariant: 'danger',
        onConfirm: startNewSession,
      })
      return
    }
    startNewSession()
  }

  const computeSessionSummary = (s: GameState): SummaryRow[] => {
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
          <div className="style-toggle">
            <button className={uiStyle === 'scene' ? 'seg active' : 'seg'} onClick={() => setUiStyle('scene')}>
              场景
            </button>
            <button className={uiStyle === 'text' ? 'seg active' : 'seg'} onClick={() => setUiStyle('text')}>
              文字
            </button>
          </div>
          <div className="tabs">
            <button className={route === 'home' ? 'tab active' : 'tab'} onClick={() => setRoute('home')}>
              主页
            </button>
            <button className={route === 'game' ? 'tab active' : 'tab'} onClick={() => setRoute(state.session?.endedAt ? 'summary' : 'game')}>
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
      {turnToast ? (
        <div className="turn-toast">
          <span className="turn-toast-line1">轮到：#{turnToast.seat + 1}</span>
          <span className="turn-toast-line2">{turnToast.name}</span>
        </div>
      ) : null}

      <main className="main">
        {route === 'home' ? (
          <HomeView
            state={state}
            syncStatus={syncStatus}
            onContinue={() => setRoute(state.session?.endedAt ? 'summary' : 'game')}
            onStartNew={requestStartNewSession}
            onOpenHistory={() => setRoute('history')}
          />
        ) : route === 'history' ? (
          <HistoryView />
        ) : route === 'rules' ? (
          <RulesView />
        ) : route === 'summary' ? (
          <SessionSummaryView
            state={state}
            rows={computeSessionSummary(state)}
            saveStatus={saveStatus}
            savedFileName={savedFileName}
            onStartNew={requestStartNewSession}
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
            canEditConfig={!state.session || !!state.session.endedAt}
            playersEditMode={state.session && !state.session.endedAt ? 'addRemove' : 'full'}
            canRollback={state.rollbackStack.length > 0}
            onEndSession={() => void endSession()}
            onCancelHand={() => dispatchWithSync({ type: 'CANCEL_HAND' })}
            onRollback={() => dispatchWithSync({ type: 'ROLLBACK' })}
            onRequestConfirm={(c) => setConfirm(c)}
            continuousGame={continuousGame}
            onToggleContinuous={() => setContinuousGame((v) => !v)}
            uiStyle={uiStyle}
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
            onSettle={settleHandWithMaybeContinue}
          />
        )}
      </main>

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

export default App

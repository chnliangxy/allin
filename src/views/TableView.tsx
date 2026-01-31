import { useRef, useState, type CSSProperties } from 'react'
import { minRaiseTo, toCall, type GameState, type PlayerAction } from '../poker/engine'
import { computePotWinnersFromInputs, type HandRank } from '../poker/handEval'
import type { BoundPlayer, UiStyle } from '../uiTypes'

type Props = {
  state: GameState
  potSize: number
  sidePots: Array<{ amount: number; eligibleSeats: number[] }>
  uiStyle: UiStyle
  boundPlayer: BoundPlayer | null
  onAct: (seat: number, action: PlayerAction) => void
  onNextStreet: () => void
  onSetBoard: (text: string) => void
  onSetHole: (seat: number, text: string) => void
  onSetPotWinners: (potIndex: number, seats: number[]) => void
  onSetPotWinnersAll: (potWinners: number[][]) => void
  onSettle: () => void
  canRollback: boolean
  onRequestRollback: () => void
}

function TableView(props: Props) {
  const state = props.state
  const isScene = props.uiStyle === 'scene'
  const betToRef = useRef<HTMLInputElement>(null)
  const suggestedBetTo = minRaiseTo(state)
  const [rankMap, setRankMap] = useState<Map<number, HandRank>>(new Map())
  const [autoEvalError, setAutoEvalError] = useState<string | null>(null)
  const dealerName = state.players[state.dealerSeat]?.name ?? `玩家${state.dealerSeat + 1}`
  const rebuys = state.session?.rebuys ?? []

  const actor = state.players[state.actionSeat]
  const actorToCall = actor ? toCall(state, actor.seat) : 0
  const canAct = !props.boundPlayer || (actor ? actor.seat === props.boundPlayer.seat : false)
  const actorMaxBetTo = actor ? actor.streetBet + actor.stack : 0
  const defaultBetTo = actor ? Math.min(suggestedBetTo, actorMaxBetTo) : suggestedBetTo
  const canRaise = !!actor && actorMaxBetTo > state.currentBet
  const canBetOrRaise = canAct && canRaise
  const callPay = actor ? Math.min(actorToCall, actor.stack) : 0
  const callIsAllIn = !!actor && actorToCall > 0 && actorToCall >= actor.stack

  const eligibleShowdown = state.players.filter((p) => p.status !== 'folded' && p.status !== 'out')
  const canSettle =
    props.sidePots.length > 0 &&
    props.sidePots.every((p, idx) => p.eligibleSeats.length <= 1 || (state.potWinners[idx]?.length ?? 0) > 0)

  const stageText = state.phase === 'showdown' ? 'Showdown' : streetLabel(state.street)
  const shouldFlashStage = state.phase === 'hand' || state.phase === 'showdown'
  const stageFlashKey = shouldFlashStage ? `${state.phase}-${state.street}` : 'static'

  const boardInput = (
    <div className={isScene ? 'scene-board' : 'field'}>
      <div className="label">公共牌（5张，可选用于自动判定）</div>
      <input value={state.boardCardsText} placeholder="例如 As Kd 7h 7c 2s" onChange={(e) => props.onSetBoard(e.target.value)} />
    </div>
  )

  const scenePlayerStyle = (seat: number): CSSProperties => {
    const count = Math.max(1, state.players.length)
    const overflow = Math.max(0, count - 6)
    const rx = Math.max(28, 44 - overflow * 1.8)
    const ry = Math.max(30, 36 - overflow * 0.8)
    const angle = Math.PI / 2 + (2 * Math.PI * seat) / count
    const x = Math.cos(angle)
    const y = Math.sin(angle)
    const yWarp = Math.sign(y) * Math.pow(Math.abs(y), 1.25)
    const extremeBoost = (1 - Math.abs(x)) * Math.min(4.2, 1.8 + overflow * 0.6) * Math.sign(y)

    const leftRaw = 50 + x * rx
    const topRaw = 50 + yWarp * ry + extremeBoost
    const left = Math.min(83, Math.max(17, leftRaw))
    const top = Math.min(90, Math.max(10, topRaw))
    return { left: `${left}%`, top: `${top}%` }
  }

  return (
    <div className={isScene ? 'table scene' : 'table'}>
      {isScene ? (
        <>
          {state.phase !== 'setup' ? (
            <details className="scene-collapsible">
              <summary>公共信息</summary>
              <div className="scene-info">
                <div className="scene-kpis">
                  <div className="kpi">
                    <div className="kpi-label">阶段</div>
                    <div key={stageFlashKey} className={shouldFlashStage ? 'kpi-value stage-flash' : 'kpi-value'}>
                      {stageText}
                    </div>
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
                    <div className="kpi-value">
                      #{state.dealerSeat + 1} {dealerName}
                    </div>
                  </div>
                </div>

                {props.sidePots.length > 1 ? (
                  <div className="scene-sidepots">
                    {props.sidePots.map((p, idx) => (
                      <div key={idx} className="scene-sidepot">
                        <div className="scene-sidepot-title">{idx === 0 ? '主池' : `边池${idx}`}</div>
                        <div className="scene-sidepot-amount">{p.amount}</div>
                        <div className="scene-sidepot-eligible">参与：{p.eligibleSeats.map((s) => `#${s + 1}`).join(' ')}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {state.phase === 'showdown' ? boardInput : null}

                <div className="scene-controls">
                  <button onClick={props.onNextStreet}>强制下一街</button>
                  <button className="danger" disabled={!props.canRollback} onClick={props.onRequestRollback}>
                    回滚操作
                  </button>
                </div>
              </div>
            </details>
          ) : null}

          <div className="scene-table">
            <div className="scene-center-min">
              <div key={stageFlashKey} className={shouldFlashStage ? 'scene-center-street stage-flash' : 'scene-center-street'}>
                {stageText}
              </div>
              <div className="scene-center-pot">{props.potSize}</div>
              <div className="scene-center-bet">{state.currentBet}</div>
            </div>

            {state.players.map((p) => (
              <div
                key={p.seat}
                className={p.seat === state.actionSeat ? 'player active scene-player' : 'player scene-player'}
                style={scenePlayerStyle(p.seat)}
              >
                <div className="p-head">
                  <div className="p-name">
                    #{p.seat + 1} {p.name} {p.seat === state.dealerSeat ? 'D' : ''}
                  </div>
                  <div className="p-status">{statusLabel(p.status)}</div>
                </div>
                <div className="p-body">
                  {state.phase === 'setup' ? (
                    <>
                      <div className="p-metric">
                        <div className="label">筹码</div>
                        <div className="value">{p.stack}</div>
                      </div>
                      <div className="p-metric">
                        <div className="label">补码</div>
                        <div className="value">{rebuys[p.seat] ?? 0}</div>
                      </div>
                      <div className="p-metric">
                        <div className="label">积分</div>
                        <div className="value">{p.stack - (rebuys[p.seat] ?? 0)}</div>
                      </div>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                  {state.phase === 'showdown' ? (
                    <div className="p-metric wide">
                      <div className="label">手牌（可选）</div>
                      <input value={p.holeCardsText} placeholder="例如 As Kd" onChange={(e) => props.onSetHole(p.seat, e.target.value)} />
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
        </>
      ) : (
        <>
          <div className="summary">
            <div className="summary-left">
              <div className="kpi">
                <div className="kpi-label">阶段</div>
                <div key={stageFlashKey} className={shouldFlashStage ? 'kpi-value stage-flash' : 'kpi-value'}>
                  {stageText}
                </div>
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
                <div className="kpi-value">
                  #{state.dealerSeat + 1} {dealerName}
                </div>
              </div>
            </div>
            <div className="summary-right">
              <button onClick={props.onNextStreet}>强制下一街</button>
              <button className="danger" disabled={!props.canRollback} onClick={props.onRequestRollback}>
                回滚操作
              </button>
            </div>
          </div>

          {props.sidePots.length > 1 ? (
            <div className="sidepots">
              {props.sidePots.map((p, idx) => (
                <div key={idx} className="sidepot">
                  <div className="sidepot-title">{idx === 0 ? '主池' : `边池${idx}`}</div>
                  <div className="sidepot-amount">{p.amount}</div>
                  <div className="sidepot-eligible">参与：{p.eligibleSeats.map((s) => `#${s + 1}`).join(' ')}</div>
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
                      <input value={p.holeCardsText} placeholder="例如 As Kd" onChange={(e) => props.onSetHole(p.seat, e.target.value)} />
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
        </>
      )}

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
                max={actorMaxBetTo}
                defaultValue={defaultBetTo}
                ref={betToRef}
                disabled={!canBetOrRaise}
              />
              <button
                disabled={!canBetOrRaise}
                onClick={() => {
                  if (!canAct) return
                  const raw = Number(betToRef.current?.value ?? defaultBetTo)
                  const v = Number.isFinite(raw) ? Math.trunc(raw) : defaultBetTo
                  const capped = Math.max(0, Math.min(actorMaxBetTo, v))
                  props.onAct(actor.seat, { type: 'BET_TO', betTo: capped })
                }}
              >
                Bet/Raise
              </button>
            </div>
            <button
              disabled={!canAct}
              onClick={() => {
                if (!canAct) return
                if (actorToCall === 0) {
                  props.onAct(actor.seat, { type: 'CHECK' })
                  return
                }
                if (callIsAllIn) {
                  props.onAct(actor.seat, { type: 'ALLIN' })
                  return
                }
                props.onAct(actor.seat, { type: 'CALL' })
              }}
            >
              {actorToCall === 0 ? 'Check' : callIsAllIn ? `Call ${callPay} (All-in)` : `Call ${actorToCall}`}
            </button>
            <button
              disabled={!canAct}
              onClick={() => {
                if (!canAct) return
                props.onAct(actor.seat, { type: 'ALLIN' })
              }}
            >
              All-in ({actor.stack})
            </button>
            <button
              className="danger"
              disabled={!canAct}
              onClick={() => {
                if (!canAct) return
                props.onAct(actor.seat, { type: 'FOLD' })
              }}
            >
              Fold
            </button>
          </div>
        </div>
      ) : null}

      {state.phase === 'showdown' ? (
        <div className="showdown">
          <div className="panel-title">摊牌与结算</div>
          {!isScene ? boardInput : null}

          {props.sidePots.map((pot, potIndex) => {
            const title = potIndex === 0 ? '主池' : `边池${potIndex}`
            const autoSeat = pot.eligibleSeats.length === 1 ? pot.eligibleSeats[0]! : null
            const selected = state.potWinners[potIndex] ?? []
            return (
              <div className="winners" key={potIndex}>
                <div className="label">
                  {title}（{pot.amount}）胜者（可多选用于平分）
                </div>
                {autoSeat !== null ? (
                  <div className="banner">
                    自动分配：#{autoSeat + 1} {state.players[autoSeat]?.name ?? `玩家${autoSeat + 1}`}
                  </div>
                ) : (
                  <div className="winner-grid">
                    {pot.eligibleSeats.map((seat) => {
                      const p = state.players[seat]
                      if (!p) return null
                      const checked = selected.includes(seat)
                      return (
                        <label key={seat} className="winner">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked ? [...selected, seat] : selected.filter((s) => s !== seat)
                              props.onSetPotWinners(potIndex, next)
                            }}
                          />
                          #{seat + 1} {p.name}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {autoEvalError ? <div className="banner error">{autoEvalError}</div> : null}

          <div className="actions">
            <button
              onClick={() => {
                const res = computePotWinnersFromInputs({
                  boardText: state.boardCardsText,
                  playerHoles: eligibleShowdown.map((p) => ({
                    seat: p.seat,
                    holeText: p.holeCardsText,
                    folded: p.status === 'folded' || p.status === 'out',
                  })),
                  pots: props.sidePots,
                })
                if (res.error) {
                  setAutoEvalError(res.error)
                  setRankMap(new Map())
                  return
                }
                setAutoEvalError(null)
                setRankMap(res.ranks)
                props.onSetPotWinnersAll(res.potWinners)
              }}
            >
              自动判定胜者
            </button>
            <button className="primary" disabled={!canSettle} onClick={props.onSettle}>
              结算发筹码
            </button>
          </div>
        </div>
      ) : null}
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

export default TableView


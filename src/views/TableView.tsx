import { useRef, useState, type CSSProperties } from 'react'
import { minRaiseTo, toCall, type GameState, type PlayerAction } from '../poker/engine'
import { computeWinnersFromInputs, type HandRank } from '../poker/handEval'
import type { UiStyle } from '../uiTypes'

type Props = {
  state: GameState
  potSize: number
  sidePots: Array<{ amount: number; eligibleSeats: number[] }>
  uiStyle: UiStyle
  onAct: (seat: number, action: PlayerAction) => void
  onNextStreet: () => void
  onSetBoard: (text: string) => void
  onSetHole: (seat: number, text: string) => void
  onSetWinners: (seats: number[]) => void
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

  const eligibleShowdown = state.players.filter((p) => p.status !== 'folded' && p.status !== 'out')

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
              <div className="scene-center-street">{streetLabel(state.street)}</div>
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
          </div>
        </div>
      ) : null}

      {state.phase === 'showdown' ? (
        <div className="showdown">
          <div className="panel-title">摊牌与结算</div>
          {!isScene ? boardInput : null}

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


import { useRef, useState } from 'react'
import { minRaiseTo, toCall, type GameState, type PlayerAction } from '../poker/engine'
import { computeWinnersFromInputs, type HandRank } from '../poker/handEval'

type Props = {
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
}

function TableView(props: Props) {
  const state = props.state
  const betToRef = useRef<HTMLInputElement>(null)
  const suggestedBetTo = minRaiseTo(state)
  const [rankMap, setRankMap] = useState<Map<number, HandRank>>(new Map())
  const [autoEvalError, setAutoEvalError] = useState<string | null>(null)
  const dealerName = state.players[state.dealerSeat]?.name ?? `玩家${state.dealerSeat + 1}`

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


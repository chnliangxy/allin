import { useState } from 'react'
import type { GameConfig } from '../poker/engine'
import type { PlayersSaveFeedback } from '../uiTypes'

type Props = {
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
}

type DraftPlayer = { name: string; stack: number; deleted: boolean; isNew: boolean }

function SetupView(props: Props) {
  const [draftConfig, setDraftConfig] = useState<GameConfig>(props.config)
  const [draftPlayers, setDraftPlayers] = useState<DraftPlayer[]>(() =>
    props.players.map((p) => ({ ...p, deleted: false, isNew: false })),
  )
  const [rebuyAmount, setRebuyAmount] = useState(100)

  const canStart = draftPlayers
    .filter((p) => !p.deleted)
    .filter((p) => p.stack > 0 && p.name.trim()).length >= 2
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
                setDraftPlayers([
                  ...draftPlayers,
                  { name: `玩家${draftPlayers.length + 1}`, stack: 200, deleted: false, isNew: true },
                ])
              }}
            >
              添加玩家
            </button>
            <button onClick={savePlayers}>保存玩家</button>
          </div>

          {props.playersSaveFeedback ? (
            <div className={props.playersSaveFeedback.kind === 'error' ? 'banner error' : 'banner'}>
              {props.playersSaveFeedback.text}
            </div>
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

export default SetupView


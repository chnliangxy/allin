import { useState } from 'react'
import type { GameConfig } from '../poker/engine'
import type { BoundPlayer, PlayersSaveFeedback } from '../uiTypes'

type Props = {
  config: GameConfig
  players: Array<{ name: string; stack: number }>
  dealerSeat: number
  canEditConfig: boolean
  playersEditMode: 'full' | 'addRemove'
  boundPlayer: BoundPlayer | null
  onSetBoundPlayer: (v: BoundPlayer | null) => void
  playersSaveFeedback: PlayersSaveFeedback | null
  onSetPlayersSaveFeedback: (v: PlayersSaveFeedback | null) => void
  onApplyConfig: (c: GameConfig) => void
  onApplyPlayers: (ps: Array<{ name: string; stack: number }>) => void
  onMovePlayer: (from: number, to: number) => void
  onSetDealer: (seat: number) => void
  onStartHand: () => void
  onRebuy: (seat: number, amount: number) => void
  onReset: () => void
}

type DraftPlayer = { id: string; name: string; stack: number; savedName: string; savedStack: number; deleted: boolean; isNew: boolean }

const makeDraftId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? (crypto as Crypto).randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`

function SetupView(props: Props) {
  const [draftConfig, setDraftConfig] = useState<GameConfig>(props.config)
  const [draftPlayers, setDraftPlayers] = useState<DraftPlayer[]>(() =>
    props.players.map((p) => ({
      id: makeDraftId(),
      name: p.name,
      stack: p.stack,
      savedName: p.name,
      savedStack: p.stack,
      deleted: false,
      isNew: false,
    })),
  )
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [rebuyAmount, setRebuyAmount] = useState(100)
  const isAddRemove = props.playersEditMode === 'addRemove'
  const baseCount = props.players.length

  const canStart = draftPlayers
    .filter((p) => !p.deleted)
    .filter((p) => p.stack > 0 && p.name.trim()).length >= 2
  const clearSavePlayersFeedback = () => props.onSetPlayersSaveFeedback(null)
  const effectiveName = (name: string, idx: number) => name.trim() || `玩家${idx + 1}`

  const savePlayers = () => {
    if (isAddRemove) {
      let hasRename = false
      let hasAddOrDelete = false
      for (let i = 0; i < baseCount; i++) {
        const draft = draftPlayers[i]
        const saved = props.players[i]
        if (!draft || !saved) {
          props.onSetPlayersSaveFeedback({ kind: 'error', text: '玩家列表无效' })
          return
        }
        if (draft.deleted) {
          hasAddOrDelete = true
          continue
        }
        const nextName = draft.name.trim()
        const nextStack = Math.max(0, Math.trunc(draft.stack))
        if (nextStack !== saved.stack) {
          props.onSetPlayersSaveFeedback({ kind: 'error', text: '本局游戏进行中，不能修改现有玩家筹码（可通过补码调整）' })
          return
        }
        if (nextName !== saved.name) hasRename = true
      }
      if (draftPlayers.slice(baseCount).some((p) => !p.deleted)) hasAddOrDelete = true
      if (hasRename && hasAddOrDelete) {
        props.onSetPlayersSaveFeedback({ kind: 'error', text: '本局游戏进行中：重命名与新增/删除请分开保存' })
        return
      }
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
    if (props.boundPlayer) {
      const seat = props.boundPlayer.seat
      const row = normalized[seat]
      if (row) props.onSetBoundPlayer({ seat, name: effectiveName(row.name, seat) })
    }
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
                disabled={!props.canEditConfig}
              />
            </div>
            <div className="field">
              <div className="label">大盲</div>
              <input
                type="number"
                value={draftConfig.bigBlind}
                min={0}
                onChange={(e) => setDraftConfig({ ...draftConfig, bigBlind: Number(e.target.value) })}
                disabled={!props.canEditConfig}
              />
            </div>
            <div className="field">
              <div className="label">前注</div>
              <input
                type="number"
                value={draftConfig.ante}
                min={0}
                onChange={(e) => setDraftConfig({ ...draftConfig, ante: Number(e.target.value) })}
                disabled={!props.canEditConfig}
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
            <button disabled={!props.canEditConfig} onClick={() => props.onApplyConfig(draftConfig)}>
              保存规则设置
            </button>
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
                          const dirtyName = p.name.trim() !== p.savedName
                          const dirtyStack = Math.max(0, Math.trunc(p.stack)) !== p.savedStack
                          return dirtyName || dirtyStack ? 'player-edit dirty' : 'player-edit'
                        })()
                }
                key={p.id}
                onDragOver={(e) => {
                  if (dragFrom === null) return
                  e.preventDefault()
                }}
                onDrop={(e) => {
                  const raw = e.dataTransfer.getData('text/plain')
                  const from = dragFrom ?? (raw ? Number(raw) : null)
                  setDragFrom(null)
                  if (from === null || !Number.isFinite(from)) return
                  const fromIdx = Math.trunc(from)
                  if (fromIdx === idx) return
                  if (isAddRemove && (fromIdx < baseCount) !== (idx < baseCount)) return
                  clearSavePlayersFeedback()
                  const next = [...draftPlayers]
                  const [moved] = next.splice(fromIdx, 1)
                  if (!moved) return
                  next.splice(idx, 0, moved)
                  setDraftPlayers(next)
                  if (isAddRemove && fromIdx < baseCount && idx < baseCount) props.onMovePlayer(fromIdx, idx)
                }}
              >
                <div
                  className="seat"
                  draggable={!p.deleted}
                  onDragStart={(e) => {
                    if (p.deleted) return
                    setDragFrom(idx)
                    e.dataTransfer.setData('text/plain', String(idx))
                    e.dataTransfer.effectAllowed = 'move'
                    clearSavePlayersFeedback()
                  }}
                  onDragEnd={() => setDragFrom(null)}
                  role="button"
                  tabIndex={0}
                >
                  #{idx + 1}
                </div>
                <input
                  className={
                    (() => {
                      const dirty = !p.deleted && !p.isNew && p.name.trim() !== p.savedName
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
                      const dirty = !p.deleted && !p.isNew && Math.max(0, Math.trunc(p.stack)) !== p.savedStack
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
                  disabled={p.deleted || (isAddRemove && !p.isNew)}
                />
                <button
                  className={props.boundPlayer?.seat === idx ? 'primary bind' : 'bind'}
                  disabled={p.deleted}
                  onClick={() => {
                    clearSavePlayersFeedback()
                    const nextName = p.name.trim() || `玩家${idx + 1}`
                    if (props.boundPlayer?.seat === idx) {
                      props.onSetBoundPlayer(null)
                    } else {
                      props.onSetBoundPlayer({ seat: idx, name: nextName })
                    }
                  }}
                >
                  {props.boundPlayer?.seat === idx ? '解绑' : '绑定'}
                </button>
                <button
                  className="danger"
                  disabled={!p.isNew && !p.deleted && draftPlayers.filter((x) => !x.deleted).length <= 2}
                  onClick={() => {
                    clearSavePlayersFeedback()
                    const next = [...draftPlayers]
                    const cur = next[idx]
                    if (!cur) return
                    if (cur.isNew) {
                      if (props.boundPlayer?.seat === idx) props.onSetBoundPlayer(null)
                      next.splice(idx, 1)
                    } else {
                      if (props.boundPlayer?.seat === idx) props.onSetBoundPlayer(null)
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
                  {
                    id: makeDraftId(),
                    name: `玩家${draftPlayers.length + 1}`,
                    stack: 200,
                    savedName: '',
                    savedStack: 0,
                    deleted: false,
                    isNew: true,
                  },
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


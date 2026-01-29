import { useMemo } from 'react'
import type { GameConfig, GameState, PlayerAction } from '../poker/engine'
import type { BoundPlayer, ConfirmState, PlayersSaveFeedback, UiStyle } from '../uiTypes'
import SetupView from './SetupView'
import TableView from './TableView'

type Props = {
  state: GameState
  potSize: number
  sidePots: Array<{ amount: number; eligibleSeats: number[] }>
  setupKey: string
  canEditConfig: boolean
  playersEditMode: 'full' | 'addRemove'
  canRollback: boolean
  boundPlayer: BoundPlayer | null
  onSetBoundPlayer: (v: BoundPlayer | null) => void
  onEndSession: () => void
  onCancelHand: () => void
  onRollback: () => void
  onRequestConfirm: (c: ConfirmState) => void
  continuousGame: boolean
  onToggleContinuous: () => void
  uiStyle: UiStyle
  playersSaveFeedback: PlayersSaveFeedback | null
  onSetPlayersSaveFeedback: (v: PlayersSaveFeedback | null) => void
  onApplyConfig: (c: GameConfig) => void
  onApplyPlayers: (ps: Array<{ name: string; stack: number }>) => void
  onMovePlayer: (from: number, to: number) => void
  onSetDealer: (s: number) => void
  onStartHand: () => void
  onRebuy: (seat: number, amount: number) => void
  onReset: () => void
  onAct: (seat: number, action: PlayerAction) => void
  onNextStreet: () => void
  onSetBoard: (text: string) => void
  onSetHole: (seat: number, text: string) => void
  onSetPotWinners: (potIndex: number, seats: number[]) => void
  onSetPotWinnersAll: (potWinners: number[][]) => void
  onSettle: () => void
}

function GameView(props: Props) {
  const isScene = props.uiStyle === 'scene'
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
        {props.state.phase !== 'setup' ? (
          <button
            onClick={() => {
              props.onRequestConfirm({
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
            props.onRequestConfirm({
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
        <button className={props.continuousGame ? 'continuous-toggle on' : 'continuous-toggle'} onClick={props.onToggleContinuous}>
          连续游戏：{props.continuousGame ? '开' : '关'}
        </button>
      </div>

      {!isScene || props.state.phase !== 'setup' ? (
        isScene ? (
          <details className="scene-collapsible">
            <summary>玩家汇总</summary>
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
          </details>
        ) : (
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
        )
      ) : null}

      {props.state.phase === 'setup' ? (
        isScene ? (
          <>
            <TableView
              state={props.state}
              potSize={props.potSize}
              sidePots={props.sidePots}
              uiStyle={props.uiStyle}
              boundPlayer={props.boundPlayer}
              onAct={props.onAct}
              onNextStreet={props.onNextStreet}
              onSetBoard={props.onSetBoard}
              onSetHole={props.onSetHole}
              onSetPotWinners={props.onSetPotWinners}
              onSetPotWinnersAll={props.onSetPotWinnersAll}
              onSettle={props.onSettle}
              canRollback={props.canRollback}
              onRequestRollback={() => {
                props.onRequestConfirm({
                  title: 'Rollback',
                  message: '确认回滚上一次操作？',
                  confirmText: '确认回滚',
                  confirmVariant: 'danger',
                  onConfirm: props.onRollback,
                })
              }}
            />
            <SetupView
              key={props.setupKey}
              config={props.state.config}
              players={props.state.players.map((p) => ({ name: p.name, stack: p.stack }))}
              dealerSeat={props.state.dealerSeat}
              canEditConfig={props.canEditConfig}
              playersEditMode={props.playersEditMode}
              boundPlayer={props.boundPlayer}
              onSetBoundPlayer={props.onSetBoundPlayer}
              playersSaveFeedback={props.playersSaveFeedback}
              onSetPlayersSaveFeedback={props.onSetPlayersSaveFeedback}
              onApplyConfig={props.onApplyConfig}
              onApplyPlayers={props.onApplyPlayers}
              onMovePlayer={props.onMovePlayer}
              onSetDealer={props.onSetDealer}
              onStartHand={props.onStartHand}
              onRebuy={props.onRebuy}
              onReset={() => {
                props.onRequestConfirm({
                  title: '重置',
                  message: '确认重置？将清空当前局面与玩家筹码记录。',
                  confirmText: '确认重置',
                  confirmVariant: 'danger',
                  onConfirm: props.onReset,
                })
              }}
            />
          </>
        ) : (
          <SetupView
            key={props.setupKey}
            config={props.state.config}
            players={props.state.players.map((p) => ({ name: p.name, stack: p.stack }))}
            dealerSeat={props.state.dealerSeat}
            canEditConfig={props.canEditConfig}
            playersEditMode={props.playersEditMode}
            boundPlayer={props.boundPlayer}
            onSetBoundPlayer={props.onSetBoundPlayer}
            playersSaveFeedback={props.playersSaveFeedback}
            onSetPlayersSaveFeedback={props.onSetPlayersSaveFeedback}
            onApplyConfig={props.onApplyConfig}
            onApplyPlayers={props.onApplyPlayers}
            onMovePlayer={props.onMovePlayer}
            onSetDealer={props.onSetDealer}
            onStartHand={props.onStartHand}
            onRebuy={props.onRebuy}
            onReset={() => {
              props.onRequestConfirm({
                title: '重置',
                message: '确认重置？将清空当前局面与玩家筹码记录。',
                confirmText: '确认重置',
                confirmVariant: 'danger',
                onConfirm: props.onReset,
              })
            }}
          />
        )
      ) : (
        <TableView
          state={props.state}
          potSize={props.potSize}
          sidePots={props.sidePots}
          uiStyle={props.uiStyle}
          boundPlayer={props.boundPlayer}
          onAct={props.onAct}
          onNextStreet={props.onNextStreet}
          onSetBoard={props.onSetBoard}
          onSetHole={props.onSetHole}
          onSetPotWinners={props.onSetPotWinners}
          onSetPotWinnersAll={props.onSetPotWinnersAll}
          onSettle={props.onSettle}
          canRollback={props.canRollback}
          onRequestRollback={() => {
            props.onRequestConfirm({
              title: '回滚操作',
              message: '确认回滚上一次操作？',
              confirmText: '确认回滚',
              confirmVariant: 'danger',
              onConfirm: props.onRollback,
            })
          }}
        />
      )}

      {!props.canEditConfig && props.state.phase === 'setup' ? <div className="banner">本局进行中：规则设置将锁定（可新增/删除玩家）</div> : null}
    </div>
  )
}

export default GameView

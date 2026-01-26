import type { GameState } from '../poker/engine'
import type { SyncStatus } from '../uiTypes'

type Props = {
  state: GameState
  syncStatus: SyncStatus
  onContinue: () => void
  onStartNew: () => void
  onOpenHistory: () => void
}

function HomeView(props: Props) {
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

export default HomeView


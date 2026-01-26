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

export default RulesView


export type Street = 'preflop' | 'flop' | 'turn' | 'river'

export type PlayerStatus = 'active' | 'folded' | 'allin' | 'out'

export type Player = {
  seat: number
  name: string
  stack: number
  streetBet: number
  totalCommitted: number
  status: PlayerStatus
  acted: boolean
  holeCardsText: string
}

export type GameConfig = {
  smallBlind: number
  bigBlind: number
  ante: number
}

export type Phase = 'setup' | 'hand' | 'showdown'

export type SidePot = {
  amount: number
  eligibleSeats: number[]
}

export type Session = {
  id: string
  startedAt: number
  endedAt: number | null
  initialStacks: number[]
  rebuys: number[]
}

export type RollbackPoint = {
  phase: Phase
  street: Street
  currentBet: number
  actionSeat: number
  dealerSeat: number
  boardCardsText: string
  winners: number[]
  players: Array<{
    seat: number
    stack: number
    streetBet: number
    totalCommitted: number
    status: PlayerStatus
    acted: boolean
    holeCardsText: string
  }>
}

export type GameState = {
  phase: Phase
  config: GameConfig
  players: Player[]
  dealerSeat: number
  street: Street
  currentBet: number
  actionSeat: number
  boardCardsText: string
  winners: number[]
  session: Session | null
  rollbackStack: RollbackPoint[]
  lastError: string | null
}

export type PlayerAction =
  | { type: 'FOLD' }
  | { type: 'CHECK' }
  | { type: 'CALL' }
  | { type: 'ALLIN' }
  | { type: 'BET_TO'; betTo: number }

export type Action =
  | { type: 'SETUP_SET_CONFIG'; config: GameConfig }
  | { type: 'SETUP_SET_PLAYERS'; players: Array<{ name: string; stack: number }> }
  | { type: 'SETUP_SET_DEALER'; dealerSeat: number }
  | { type: 'SESSION_START'; id: string; startedAt: number }
  | { type: 'SESSION_END'; endedAt: number }
  | { type: 'START_HAND' }
  | { type: 'CANCEL_HAND' }
  | { type: 'PLAYER_ACT'; seat: number; action: PlayerAction }
  | { type: 'ROLLBACK' }
  | { type: 'NEXT_STREET' }
  | { type: 'SET_BOARD'; text: string }
  | { type: 'SET_HOLE'; seat: number; text: string }
  | { type: 'SET_WINNERS'; seats: number[] }
  | { type: 'SETTLE_HAND' }
  | { type: 'REBUY'; seat: number; amount: number }
  | { type: 'RESET_GAME' }
  | { type: 'SYNC_SET_SNAPSHOT'; state: GameState }

const defaultConfig: GameConfig = {
  smallBlind: 1,
  bigBlind: 2,
  ante: 0,
}

export function createInitialState(): GameState {
  return {
    phase: 'setup',
    config: defaultConfig,
    players: [
      {
        seat: 0,
        name: '玩家1',
        stack: 200,
        streetBet: 0,
        totalCommitted: 0,
        status: 'active',
        acted: false,
        holeCardsText: '',
      },
      {
        seat: 1,
        name: '玩家2',
        stack: 200,
        streetBet: 0,
        totalCommitted: 0,
        status: 'active',
        acted: false,
        holeCardsText: '',
      },
    ],
    dealerSeat: 0,
    street: 'preflop',
    currentBet: 0,
    actionSeat: 0,
    boardCardsText: '',
    winners: [],
    session: null,
    rollbackStack: [],
    lastError: null,
  }
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  const x = Math.trunc(n)
  return Math.max(min, Math.min(max, x))
}

function isEligibleForShowdown(p: Player): boolean {
  return p.status !== 'folded' && p.status !== 'out'
}

function nextSeatFrom(players: Player[], fromSeat: number, predicate: (p: Player) => boolean): number {
  if (players.length === 0) return 0
  for (let i = 1; i <= players.length; i++) {
    const s = (fromSeat + i) % players.length
    if (predicate(players[s])) return s
  }
  return fromSeat
}

function countRemaining(players: Player[]): number {
  return players.filter((p) => p.status === 'active' || p.status === 'allin').length
}

function normalizeAfterError(state: GameState): GameState {
  return { ...state, lastError: null }
}

function postForcedBet(player: Player, amount: number): Player {
  if (player.status === 'out') return player
  const pay = Math.max(0, Math.min(amount, player.stack))
  const nextStack = player.stack - pay
  return {
    ...player,
    stack: nextStack,
    streetBet: player.streetBet + pay,
    totalCommitted: player.totalCommitted + pay,
    status: nextStack === 0 ? 'allin' : player.status,
  }
}

function beginHand(state: GameState): GameState {
  if (state.session?.endedAt) {
    return { ...state, lastError: '本局游戏已结束，请开始新一局' }
  }

  const players = state.players.map((p) => {
    const status: PlayerStatus = p.stack <= 0 ? 'out' : 'active'
    return {
      ...p,
      streetBet: 0,
      totalCommitted: 0,
      acted: false,
      status,
    }
  })

  const activeSeats = players.filter((p) => p.status === 'active').map((p) => p.seat)
  if (activeSeats.length < 2) {
    return { ...state, lastError: '需要至少2个有筹码的玩家才能开始' }
  }

  const dealerSeat = activeSeats.includes(state.dealerSeat)
    ? state.dealerSeat
    : activeSeats[0] ?? 0

  const sbSeat = nextSeatFrom(players, dealerSeat, (p) => p.status === 'active')
  const bbSeat = nextSeatFrom(players, sbSeat, (p) => p.status === 'active')

  const withAntes =
    state.config.ante > 0
      ? players.map((p) => (p.status === 'active' ? postForcedBet(p, state.config.ante) : p))
      : players

  const withSB = withAntes.map((p) => (p.seat === sbSeat ? postForcedBet(p, state.config.smallBlind) : p))
  const withBB = withSB.map((p) => (p.seat === bbSeat ? postForcedBet(p, state.config.bigBlind) : p))

  const currentBet = state.config.bigBlind
  const actionSeat = nextSeatFrom(withBB, bbSeat, (p) => p.status === 'active')

  return {
    ...state,
    phase: 'hand',
    players: withBB.map((p) => ({ ...p, acted: false })),
    dealerSeat,
    street: 'preflop',
    currentBet,
    actionSeat,
    winners: [],
    boardCardsText: '',
    rollbackStack: [],
    lastError: null,
  }
}

function toCallFor(player: Player, state: GameState): number {
  return Math.max(0, state.currentBet - player.streetBet)
}

function needsAction(player: Player, state: GameState): boolean {
  if (player.status !== 'active') return false
  if (!player.acted) return true
  return player.streetBet !== state.currentBet
}

function findNextActionSeat(state: GameState, fromSeat: number): number {
  return nextSeatFrom(state.players, fromSeat, (p) => needsAction(p, state))
}

function isBettingRoundComplete(state: GameState): boolean {
  const actionable = state.players.filter((p) => needsAction(p, state))
  return actionable.length === 0
}

function moveToNextStreet(state: GameState): GameState {
  const remaining = state.players.filter((p) => p.status === 'active' || p.status === 'allin')
  if (remaining.length <= 1) {
    return {
      ...state,
      phase: 'showdown',
      street: state.street,
      currentBet: 0,
      players: state.players.map((p) => ({ ...p, streetBet: 0, acted: true })),
      actionSeat: state.actionSeat,
      winners: remaining[0] ? [remaining[0].seat] : [],
      lastError: null,
    }
  }

  if (state.street === 'river') {
    return {
      ...state,
      phase: 'showdown',
      street: 'river',
      currentBet: 0,
      players: state.players.map((p) => ({ ...p, streetBet: 0, acted: true })),
      lastError: null,
    }
  }

  const nextStreet: Street =
    state.street === 'preflop'
      ? 'flop'
      : state.street === 'flop'
        ? 'turn'
        : state.street === 'turn'
          ? 'river'
          : 'river'

  const players = state.players.map((p) => ({
    ...p,
    streetBet: 0,
    acted: p.status !== 'active',
  }))

  const actionSeat = nextSeatFrom(players, state.dealerSeat, (p) => p.status === 'active')

  return {
    ...state,
    phase: 'hand',
    street: nextStreet,
    players,
    currentBet: 0,
    actionSeat,
    lastError: null,
  }
}

export function computePotSize(players: Player[]): number {
  return players.reduce((sum, p) => sum + p.totalCommitted, 0)
}

export function computeSidePots(players: Player[]): SidePot[] {
  const contributions = players
    .filter((p) => p.totalCommitted > 0)
    .map((p) => ({ seat: p.seat, amount: p.totalCommitted, eligible: isEligibleForShowdown(p) }))

  const levels = Array.from(new Set(contributions.map((c) => c.amount))).sort((a, b) => a - b)
  const pots: SidePot[] = []
  let prev = 0

  for (const level of levels) {
    const contributors = contributions.filter((c) => c.amount >= level)
    const amount = (level - prev) * contributors.length
    const eligibleSeats = contributors.filter((c) => c.eligible).map((c) => c.seat)
    if (amount > 0) pots.push({ amount, eligibleSeats })
    prev = level
  }

  return pots
}

export function distributePots(
  pots: SidePot[],
  winnerSeats: number[],
  dealerSeat: number,
  totalSeats: number,
): Map<number, number> {
  const payouts = new Map<number, number>()

  const seatOrder = (seats: number[]): number[] => {
    const ordered: number[] = []
    for (let i = 1; i <= totalSeats; i++) {
      const s = (dealerSeat + i) % totalSeats
      if (seats.includes(s)) ordered.push(s)
    }
    return ordered
  }

  for (const pot of pots) {
    const eligibleWinners = winnerSeats.filter((s) => pot.eligibleSeats.includes(s))
    if (eligibleWinners.length === 0) continue

    const share = Math.floor(pot.amount / eligibleWinners.length)
    const remainder = pot.amount - share * eligibleWinners.length

    for (const s of eligibleWinners) payouts.set(s, (payouts.get(s) ?? 0) + share)

    if (remainder > 0) {
      const order = seatOrder(eligibleWinners)
      for (let i = 0; i < remainder; i++) {
        const s = order[i % order.length] ?? eligibleWinners[i % eligibleWinners.length]!
        payouts.set(s, (payouts.get(s) ?? 0) + 1)
      }
    }
  }

  return payouts
}

function applyPlayerAction(state: GameState, seat: number, action: PlayerAction): GameState {
  const actor = state.players[seat]
  if (!actor || actor.seat !== seat) return { ...state, lastError: '座位无效' }
  if (state.phase !== 'hand') return { ...state, lastError: '当前不在行动阶段' }
  if (seat !== state.actionSeat) return { ...state, lastError: '还没轮到该玩家行动' }
  if (actor.status !== 'active') return { ...state, lastError: '该玩家无法行动' }

  const toCall = toCallFor(actor, state)

  if (action.type === 'CHECK' && toCall !== 0) return { ...state, lastError: '当前不能check，需要跟注或弃牌' }

  if (action.type === 'BET_TO' && action.betTo <= state.currentBet) {
    return { ...state, lastError: '下注/加注金额需要大于当前下注' }
  }

  const players = [...state.players]

  const updateActor = (patch: Partial<Player>) => {
    players[seat] = { ...players[seat]!, ...patch }
  }

  const pay = (amount: number) => {
    const p = players[seat]!
    const payAmount = Math.max(0, Math.min(amount, p.stack))
    const nextStack = p.stack - payAmount
    updateActor({
      stack: nextStack,
      streetBet: p.streetBet + payAmount,
      totalCommitted: p.totalCommitted + payAmount,
      status: nextStack === 0 ? 'allin' : p.status,
    })
  }

  let currentBet = state.currentBet
  let raised = false

  if (action.type === 'FOLD') {
    updateActor({ status: 'folded', acted: true })
  } else if (action.type === 'CHECK') {
    updateActor({ acted: true })
  } else if (action.type === 'CALL') {
    pay(toCall)
    updateActor({ acted: true })
  } else if (action.type === 'ALLIN') {
    const p = players[seat]!
    const betTo = p.streetBet + p.stack
    pay(p.stack)
    updateActor({ acted: true })
    if (betTo > currentBet) {
      currentBet = betTo
      raised = true
    }
  } else if (action.type === 'BET_TO') {
    const p = players[seat]!
    const delta = action.betTo - p.streetBet
    pay(delta)
    updateActor({ acted: true })
    currentBet = Math.max(currentBet, action.betTo)
    raised = true
  }

  if (countRemaining(players) <= 1) {
    const remainingSeat = players.find((p) => p.status === 'active' || p.status === 'allin')?.seat
    return {
      ...state,
      players: players.map((p) => ({ ...p, acted: true })),
      currentBet,
      phase: 'showdown',
      winners: remainingSeat !== undefined ? [remainingSeat] : [],
      lastError: null,
    }
  }

  if (raised) {
    for (const p of players) {
      if (p.status === 'active' && p.seat !== seat) {
        p.acted = false
      }
    }
  }

  const nextSeat = findNextActionSeat({ ...state, players, currentBet }, seat)
  const nextState: GameState = { ...state, players, currentBet, actionSeat: nextSeat, lastError: null }

  if (isBettingRoundComplete(nextState)) return moveToNextStreet(nextState)
  return nextState
}

function settleHand(state: GameState): GameState {
  if (state.players.length < 2) return state
  const pots = computeSidePots(state.players)
  const payoutMap = distributePots(pots, state.winners, state.dealerSeat, state.players.length)

  const players = state.players.map((p) => {
    const payout = payoutMap.get(p.seat) ?? 0
    const nextStack = p.stack + payout
    const status: PlayerStatus = nextStack <= 0 ? 'out' : 'active'
    return {
      ...p,
      stack: nextStack,
      streetBet: 0,
      totalCommitted: 0,
      acted: false,
      status,
    }
  })

  const dealerSeat = nextSeatFrom(players, state.dealerSeat, (p) => p.status !== 'out')

  return {
    ...state,
    phase: 'setup',
    players,
    dealerSeat,
    street: 'preflop',
    currentBet: 0,
    actionSeat: dealerSeat,
    winners: [],
    boardCardsText: '',
    rollbackStack: [],
    lastError: null,
  }
}

function cancelHand(state: GameState): GameState {
  if (state.phase !== 'hand' && state.phase !== 'showdown') return state

  const players = state.players.map((p) => {
    const nextStack = p.stack + p.totalCommitted
    const status: PlayerStatus = nextStack <= 0 ? 'out' : 'active'
    return {
      ...p,
      stack: nextStack,
      streetBet: 0,
      totalCommitted: 0,
      acted: false,
      status,
      holeCardsText: '',
    }
  })

  const dealerSeat = clampInt(state.dealerSeat, 0, Math.max(0, players.length - 1))

  return {
    ...state,
    phase: 'setup',
    players,
    dealerSeat,
    street: 'preflop',
    currentBet: 0,
    actionSeat: dealerSeat,
    winners: [],
    boardCardsText: '',
    rollbackStack: [],
    lastError: null,
  }
}

function makeRollbackPoint(state: GameState): RollbackPoint {
  return {
    phase: state.phase,
    street: state.street,
    currentBet: state.currentBet,
    actionSeat: state.actionSeat,
    dealerSeat: state.dealerSeat,
    boardCardsText: state.boardCardsText,
    winners: [...state.winners],
    players: state.players.map((p) => ({
      seat: p.seat,
      stack: p.stack,
      streetBet: p.streetBet,
      totalCommitted: p.totalCommitted,
      status: p.status,
      acted: p.acted,
      holeCardsText: p.holeCardsText,
    })),
  }
}

function rollbackOnce(state: GameState): GameState {
  const stack = state.rollbackStack
  const last = stack[stack.length - 1]
  if (!last) return state

  const bySeat = new Map<number, RollbackPoint['players'][number]>()
  for (const p of last.players) bySeat.set(p.seat, p)

  const players = state.players.map((p) => {
    const prev = bySeat.get(p.seat)
    if (!prev) return p
    return {
      ...p,
      stack: prev.stack,
      streetBet: prev.streetBet,
      totalCommitted: prev.totalCommitted,
      status: prev.status,
      acted: prev.acted,
      holeCardsText: prev.holeCardsText,
    }
  })

  return {
    ...state,
    phase: last.phase,
    street: last.street,
    currentBet: last.currentBet,
    actionSeat: last.actionSeat,
    dealerSeat: last.dealerSeat,
    boardCardsText: last.boardCardsText,
    winners: [...last.winners],
    players,
    rollbackStack: stack.slice(0, -1),
    lastError: null,
  }
}

export function reducer(state: GameState, action: Action): GameState {
  const cleared = normalizeAfterError(state)

  if (action.type === 'RESET_GAME') return createInitialState()
  if (action.type === 'SYNC_SET_SNAPSHOT') return { ...action.state, rollbackStack: action.state.rollbackStack ?? [], lastError: null }

  if (action.type === 'SESSION_START') {
    if (cleared.session && !cleared.session.endedAt) return cleared
    const initialStacks = cleared.players.map((p) => p.stack)
    const rebuys = cleared.players.map(() => 0)
    return {
      ...cleared,
      phase: 'setup',
      street: 'preflop',
      currentBet: 0,
      boardCardsText: '',
      winners: [],
      rollbackStack: [],
      actionSeat: cleared.dealerSeat,
      session: {
        id: action.id,
        startedAt: action.startedAt,
        endedAt: null,
        initialStacks,
        rebuys,
      },
    }
  }

  if (action.type === 'SESSION_END') {
    if (!cleared.session || cleared.session.endedAt) return cleared
    return {
      ...cleared,
      phase: 'setup',
      street: 'preflop',
      currentBet: 0,
      boardCardsText: '',
      winners: [],
      rollbackStack: [],
      session: { ...cleared.session, endedAt: action.endedAt },
      lastError: null,
    }
  }

  if (action.type === 'SETUP_SET_CONFIG') {
    if (cleared.session && !cleared.session.endedAt) return { ...cleared, lastError: '本局游戏进行中，不能修改盲注设置' }
    const smallBlind = clampInt(action.config.smallBlind, 0, 1_000_000)
    const bigBlind = clampInt(action.config.bigBlind, 0, 1_000_000)
    const ante = clampInt(action.config.ante, 0, 1_000_000)
    const config: GameConfig = { smallBlind, bigBlind, ante }
    return { ...cleared, config }
  }

  if (action.type === 'SETUP_SET_PLAYERS') {
    if (cleared.session && !cleared.session.endedAt) return { ...cleared, lastError: '本局游戏进行中，不能修改玩家' }
    const max = Math.min(10, Math.max(2, action.players.length))
    const players: Player[] = action.players.slice(0, max).map((p, idx) => ({
      seat: idx,
      name: p.name.trim() || `玩家${idx + 1}`,
      stack: clampInt(p.stack, 0, 1_000_000_000),
      streetBet: 0,
      totalCommitted: 0,
      status: p.stack > 0 ? 'active' : 'out',
      acted: false,
      holeCardsText: '',
    }))
    return { ...cleared, players, dealerSeat: 0, phase: 'setup', rollbackStack: [] }
  }

  if (action.type === 'SETUP_SET_DEALER') {
    const dealerSeat = clampInt(action.dealerSeat, 0, Math.max(0, cleared.players.length - 1))
    return { ...cleared, dealerSeat }
  }

  if (action.type === 'START_HAND') return beginHand(cleared)

  if (action.type === 'CANCEL_HAND') return cancelHand(cleared)

  if (action.type === 'PLAYER_ACT') {
    if (cleared.phase !== 'hand') return applyPlayerAction(cleared, action.seat, action.action)
    if (action.seat !== cleared.actionSeat) return applyPlayerAction(cleared, action.seat, action.action)
    const actor = cleared.players[action.seat]
    if (!actor || actor.seat !== action.seat || actor.status !== 'active') return applyPlayerAction(cleared, action.seat, action.action)

    const point = makeRollbackPoint(cleared)
    const rollbackStack = [...cleared.rollbackStack, point]
    const maxRollback = 50
    const nextStack = rollbackStack.length > maxRollback ? rollbackStack.slice(rollbackStack.length - maxRollback) : rollbackStack
    return applyPlayerAction({ ...cleared, rollbackStack: nextStack }, action.seat, action.action)
  }

  if (action.type === 'ROLLBACK') return rollbackOnce(cleared)

  if (action.type === 'NEXT_STREET') return moveToNextStreet(cleared)

  if (action.type === 'SET_BOARD') return { ...cleared, boardCardsText: action.text }

  if (action.type === 'SET_HOLE') {
    const players = cleared.players.map((p) => (p.seat === action.seat ? { ...p, holeCardsText: action.text } : p))
    return { ...cleared, players }
  }

  if (action.type === 'SET_WINNERS') {
    const seats = Array.from(new Set(action.seats)).filter((s) => s >= 0 && s < cleared.players.length)
    return { ...cleared, winners: seats }
  }

  if (action.type === 'SETTLE_HAND') return settleHand(cleared)

  if (action.type === 'REBUY') {
    const amount = clampInt(action.amount, 0, 1_000_000_000)
    const players = cleared.players.map((p) => {
      if (p.seat !== action.seat) return p
      const nextStack = p.stack + amount
      return { ...p, stack: nextStack, status: nextStack > 0 && p.status === 'out' ? 'active' : p.status }
    })
    const session =
      cleared.session && !cleared.session.endedAt
        ? {
            ...cleared.session,
            rebuys: cleared.session.rebuys.map((v, idx) => (idx === action.seat ? v + amount : v)),
          }
        : cleared.session
    return { ...cleared, players, session }
  }

  return cleared
}

export function toCall(state: GameState, seat: number): number {
  const p = state.players[seat]
  if (!p) return 0
  return toCallFor(p, state)
}

export function minRaiseTo(state: GameState): number {
  const min = state.currentBet === 0 ? state.config.bigBlind : state.currentBet + Math.max(1, state.config.bigBlind)
  return min
}

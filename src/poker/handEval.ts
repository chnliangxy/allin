export type Suit = 's' | 'h' | 'd' | 'c'

export type Card = {
  r: number
  s: Suit
  text: string
}

export type HandCategory =
  | '高牌'
  | '一对'
  | '两对'
  | '三条'
  | '顺子'
  | '同花'
  | '葫芦'
  | '四条'
  | '同花顺'

export type HandRank = {
  category: number
  tiebreak: number[]
  name: HandCategory
}

const rankMap: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
}

function normalizeSuitChar(ch: string): Suit | null {
  const c = ch.toLowerCase()
  if (c === 's') return 's'
  if (c === 'h') return 'h'
  if (c === 'd') return 'd'
  if (c === 'c') return 'c'
  if (ch === '♠') return 's'
  if (ch === '♥') return 'h'
  if (ch === '♦') return 'd'
  if (ch === '♣') return 'c'
  return null
}

function normalizeRankText(text: string): string | null {
  const t = text.trim().toUpperCase()
  if (t === '10') return 'T'
  if (t.length === 1 && rankMap[t]) return t
  return null
}

export function parseCardsText(input: string): { cards: Card[]; error: string | null } {
  const raw = input
    .replaceAll(',', ' ')
    .replaceAll('，', ' ')
    .replaceAll('\n', ' ')
    .replaceAll('\t', ' ')
    .trim()

  if (!raw) return { cards: [], error: null }

  const parts = raw.split(/\s+/g).filter(Boolean)
  const cards: Card[] = []
  const seen = new Set<string>()

  for (const p of parts) {
    const token = p.trim()
    if (!token) continue

    let rankText = ''
    let suitText = ''

    if (token.length === 2) {
      rankText = token[0] ?? ''
      suitText = token[1] ?? ''
    } else if (token.length === 3 && token.startsWith('10')) {
      rankText = '10'
      suitText = token[2] ?? ''
    } else {
      return { cards: [], error: `无法解析牌面：${token}` }
    }

    const rKey = normalizeRankText(rankText)
    const sKey = normalizeSuitChar(suitText)
    if (!rKey || !sKey) return { cards: [], error: `无法解析牌面：${token}` }

    const r = rankMap[rKey]
    const id = `${rKey}${sKey}`
    if (seen.has(id)) return { cards: [], error: `重复牌：${token}` }
    seen.add(id)
    cards.push({ r, s: sKey, text: id })
  }

  return { cards, error: null }
}

function ranksDesc(cards: Card[]): number[] {
  return cards
    .map((c) => c.r)
    .sort((a, b) => b - a)
}

function isFlush(cards: Card[]): boolean {
  return cards.every((c) => c.s === cards[0]!.s)
}

function straightHigh(ranks: number[]): number | null {
  const uniq = Array.from(new Set(ranks)).sort((a, b) => b - a)
  if (uniq.length !== 5) return null

  const top = uniq[0]!
  const wheel = uniq.join(',') === '14,5,4,3,2'
  if (wheel) return 5

  for (let i = 1; i < uniq.length; i++) {
    if (uniq[i - 1]! - uniq[i]! !== 1) return null
  }
  return top
}

function groupByRank(cards: Card[]): Array<{ r: number; c: number }> {
  const m = new Map<number, number>()
  for (const card of cards) m.set(card.r, (m.get(card.r) ?? 0) + 1)
  return Array.from(m.entries())
    .map(([r, c]) => ({ r, c }))
    .sort((a, b) => (b.c !== a.c ? b.c - a.c : b.r - a.r))
}

export function evaluate5(cards: Card[]): HandRank {
  const ranks = ranksDesc(cards)
  const flush = isFlush(cards)
  const sh = straightHigh(ranks)
  const groups = groupByRank(cards)

  if (flush && sh) return { category: 8, tiebreak: [sh], name: '同花顺' }

  if (groups[0]?.c === 4) {
    const quad = groups[0].r
    const kicker = groups.find((g) => g.r !== quad)!.r
    return { category: 7, tiebreak: [quad, kicker], name: '四条' }
  }

  if (groups[0]?.c === 3 && groups[1]?.c === 2) {
    return { category: 6, tiebreak: [groups[0].r, groups[1].r], name: '葫芦' }
  }

  if (flush) return { category: 5, tiebreak: ranks, name: '同花' }

  if (sh) return { category: 4, tiebreak: [sh], name: '顺子' }

  if (groups[0]?.c === 3) {
    const trip = groups[0].r
    const kickers = groups.filter((g) => g.c === 1).map((g) => g.r).sort((a, b) => b - a)
    return { category: 3, tiebreak: [trip, ...kickers], name: '三条' }
  }

  if (groups[0]?.c === 2 && groups[1]?.c === 2) {
    const pairHigh = Math.max(groups[0].r, groups[1].r)
    const pairLow = Math.min(groups[0].r, groups[1].r)
    const kicker = groups.find((g) => g.c === 1)!.r
    return { category: 2, tiebreak: [pairHigh, pairLow, kicker], name: '两对' }
  }

  if (groups[0]?.c === 2) {
    const pair = groups[0].r
    const kickers = groups.filter((g) => g.c === 1).map((g) => g.r).sort((a, b) => b - a)
    return { category: 1, tiebreak: [pair, ...kickers], name: '一对' }
  }

  return { category: 0, tiebreak: ranks, name: '高牌' }
}

export function compareHands(a: HandRank, b: HandRank): number {
  if (a.category !== b.category) return a.category - b.category
  const len = Math.max(a.tiebreak.length, b.tiebreak.length)
  for (let i = 0; i < len; i++) {
    const av = a.tiebreak[i] ?? 0
    const bv = b.tiebreak[i] ?? 0
    if (av !== bv) return av - bv
  }
  return 0
}

function choose5FromN(n: number): number[][] {
  const idx = Array.from({ length: n }, (_, i) => i)
  const out: number[][] = []
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            out.push([idx[a]!, idx[b]!, idx[c]!, idx[d]!, idx[e]!])
          }
        }
      }
    }
  }
  return out
}

export function evaluateBestOf7(cards: Card[]): HandRank {
  if (cards.length !== 7) throw new Error('evaluateBestOf7 expects 7 cards')
  const combos = choose5FromN(7)
  let best = evaluate5(combos[0]!.map((i) => cards[i]!))
  for (let i = 1; i < combos.length; i++) {
    const rank = evaluate5(combos[i]!.map((j) => cards[j]!))
    if (compareHands(rank, best) > 0) best = rank
  }
  return best
}

export function computeWinnersFromInputs(args: {
  boardText: string
  playerHoles: Array<{ seat: number; holeText: string; folded: boolean }>
}): { winners: number[]; ranks: Map<number, HandRank>; error: string | null } {
  const boardParsed = parseCardsText(args.boardText)
  if (boardParsed.error) return { winners: [], ranks: new Map(), error: boardParsed.error }
  if (boardParsed.cards.length !== 5) return { winners: [], ranks: new Map(), error: '公共牌需要正好5张' }

  const board = boardParsed.cards
  const ranks = new Map<number, HandRank>()

  for (const p of args.playerHoles) {
    if (p.folded) continue
    const holeParsed = parseCardsText(p.holeText)
    if (holeParsed.error) return { winners: [], ranks: new Map(), error: `玩家${p.seat + 1}：${holeParsed.error}` }
    if (holeParsed.cards.length !== 2) return { winners: [], ranks: new Map(), error: `玩家${p.seat + 1}：手牌需要正好2张` }

    const all = [...board, ...holeParsed.cards]
    const seen = new Set<string>()
    for (const c of all) {
      if (seen.has(c.text)) return { winners: [], ranks: new Map(), error: '公共牌与手牌存在重复牌' }
      seen.add(c.text)
    }

    ranks.set(p.seat, evaluateBestOf7(all))
  }

  let bestSeat: number | null = null
  let bestRank: HandRank | null = null
  for (const [seat, r] of ranks) {
    if (!bestRank || compareHands(r, bestRank) > 0) {
      bestRank = r
      bestSeat = seat
    }
  }

  if (bestSeat === null || !bestRank) return { winners: [], ranks, error: '没有可比对的玩家' }
  const winners = Array.from(ranks.entries())
    .filter(([, r]) => compareHands(r, bestRank) === 0)
    .map(([s]) => s)
    .sort((a, b) => a - b)

  return { winners, ranks, error: null }
}

export function computePotWinnersFromInputs(args: {
  boardText: string
  playerHoles: Array<{ seat: number; holeText: string; folded: boolean }>
  pots: Array<{ eligibleSeats: number[] }>
}): { potWinners: number[][]; ranks: Map<number, HandRank>; error: string | null } {
  const boardParsed = parseCardsText(args.boardText)
  if (boardParsed.error) return { potWinners: [], ranks: new Map(), error: boardParsed.error }
  if (boardParsed.cards.length !== 5) return { potWinners: [], ranks: new Map(), error: '公共牌需要正好5张' }

  const board = boardParsed.cards
  const ranks = new Map<number, HandRank>()

  for (const p of args.playerHoles) {
    if (p.folded) continue
    const holeParsed = parseCardsText(p.holeText)
    if (holeParsed.error) return { potWinners: [], ranks: new Map(), error: `玩家${p.seat + 1}：${holeParsed.error}` }
    if (holeParsed.cards.length !== 2) return { potWinners: [], ranks: new Map(), error: `玩家${p.seat + 1}：手牌需要正好2张` }

    const all = [...board, ...holeParsed.cards]
    const seen = new Set<string>()
    for (const c of all) {
      if (seen.has(c.text)) return { potWinners: [], ranks: new Map(), error: '公共牌与手牌存在重复牌' }
      seen.add(c.text)
    }

    ranks.set(p.seat, evaluateBestOf7(all))
  }

  const potWinners = args.pots.map((pot) => {
    if (pot.eligibleSeats.length === 1) return [pot.eligibleSeats[0]!] as number[]
    const seats = pot.eligibleSeats.filter((s) => ranks.has(s))
    let best: HandRank | null = null
    for (const s of seats) {
      const r = ranks.get(s)!
      if (!best || compareHands(r, best) > 0) best = r
    }
    if (!best) return [] as number[]
    return seats
      .filter((s) => compareHands(ranks.get(s)!, best) === 0)
      .sort((a, b) => a - b)
  })

  if (potWinners.some((w, idx) => args.pots[idx]?.eligibleSeats.length > 1 && w.length === 0)) {
    return { potWinners: [], ranks, error: '没有可比对的玩家' }
  }

  return { potWinners, ranks, error: null }
}


import { EPOCHS, EPOCH_PHASES, FACTIONS, NAMES, PIVOTAL, REGIONS } from './data.mjs'
import { card } from './cards.mjs'
import { makeScenarioDeck, scenarioDeckSize, scenarioInfo, validateRevealedDeck } from './scenarios.mjs'
import { addProsperity, boardTotals, changeTrack, clone, control, countStrongholds, ensure, goldAvailable, groupLabel, humanFactions, inRange, isHumanFaction, isFragmentation, isRoman, loaded, on, own, plunderTo, scores, setImperium, spendCivitates, spendDux, duxFunds, sum, validatePosition } from './position.mjs'

export const ACTIONS = {
  pass: 'Pass', command: 'Command only', feat: 'Command + Feat', limited: 'Limited Command', limitedFeat: 'Limited Command + Feat', event: 'Event',
}
export const isPivotalCard = id => Number.isInteger(id) && id >= 73 && id <= 76
const omensForCard = state => state.omens?.head && (!state.omens.card || state.omens.card === state.current)
export const inCardOrder = state => state.current && card(state.current)
  ? (omensForCard(state) ? [state.omens.head,...card(state.current).order.filter(f => f !== state.omens.head)] : card(state.current).order)
  : []
export function turn(state) {
  return inCardOrder(state).find(f => state.eligibility.includes(f) && !state.acts.some(a => a.faction === f)) || null
}
export function actionOptions(state) {
  const faction = turn(state)
  if (!faction || state.epochPhase || state.result || state.complete || state.entropy) return []
  if (isPivotalCard(state.current) && !state.acts.length) return ['event']
  const first = state.acts.find(act => act.option !== 'pass')
  const full = ['command','feat']
  const second = isHumanFaction(state,faction) || state.difficulty === 'Introductory'
    ? ['limited'] : state.difficulty === 'Easy' ? ['limited','limitedFeat'] : full
  if (!first) return [...full,'event','pass']
  if (first.option === 'event') return [...full,'pass']
  if (first.option === 'feat' || first.option === 'limitedFeat') return [...second,'event','pass']
  return [...second,'pass']
}
export const canTakeFeat = state => actionOptions(state).some(option => option === 'feat' || option === 'limitedFeat')
export const canUseOmens = state => Boolean(state.current && card(state.current) && !isPivotalCard(state.current) && !state.acts.length && state.omens?.holder && state.eligibility.includes(state.omens.holder))
export function resolveOmens(state, use) {
  ensure(canUseOmens(state), 'No Omens decision is due.')
  const faction = state.omens.holder
  if (use) state.omens = { holder:null, head:faction, card:state.current }
  return use
}
export function log(state, title, detail = '', dice = []) {
  state.log.push({ title, detail, dice, card: state.current, epoch: state.epoch })
}
function reveal(state,id,allowedEnd = false) {
  if (id === null && allowedEnd) {
    ensure(state.revealed.length === scenarioDeckSize(state), 'The scenario deck still has cards to reveal.')
    return
  }
  validateRevealedDeck(state,[...state.revealed,id])
  if (state.deck) ensure(state.deck[state.revealed.length] === id, 'The next card must match the digital deck.')
  state.revealed.push(id)
}
export const upcomingDigitalCard = state => state.deck?.[state.revealed.length] ?? null
export function startDigitalDeck(state) {
  ensure(!state.revealed.length && state.deckMode === 'digital', 'Choose the digital deck when starting a new game.')
  const draw = length => {
    let n = state.rng
    n ^= n << 13
    n ^= n >>> 17
    n ^= n << 5
    state.rng = n >>> 0
    return Math.floor(state.rng / 0x100000000 * length)
  }
  state.deck = makeScenarioDeck(state,draw)
  startCards(state,state.deck[0],state.deck[1])
}
function assignPair(state, current, next) {
  state.acts = []
  state.complete = false
  state.epochPhase = null
  state.overrides = {}
  if (state.omens?.head && state.omens.card !== current && state.omens.card !== state.postponed?.card) state.omens = null
  if (own(EPOCHS, next)) {
    state.current = next
    state.next = current
    state.epoch++
    state.epochPhase = 'Annona'
    log(state, `Epoch ${state.epoch} begins`, `Resolve #${next} before Event #${current} (§2.3.7).`)
  } else {
    state.current = current
    state.next = next
    if (current !== null) {
      state.eventIndex++
      if (!turn(state)) closeCardIfDone(state)
    }
  }
}
export function startCards(state, current, next) {
  ensure(state.current === null && !state.revealed.length, 'The game already has revealed cards.')
  ensure(card(current) && card(next) && !isPivotalCard(current) && !isPivotalCard(next), 'The first two cards must be ordinary Events in this scenario.')
  reveal(state, current)
  reveal(state, next)
  state.eligibility = [...FACTIONS]
  assignPair(state, current, next)
  log(state, `Revealed #${current} and #${next}`, 'All factions begin eligible (§2.1).')
  settleEntropy(state)
}
const pivotalPreconditions = {
  s: () => true,
  x: state => state.tracks.x >= 15,
  d: state => state.tracks.prestige >= 5 && !isRoman(state),
  c: state => !isRoman(state),
}
const pivotalRank = ['c','d','x','s']
export function pivotalOptions(state) {
  if (!state.current || !card(state.current) || state.epochPhase || state.acts.length || state.result || state.complete || state.entropy) return []
  const currentRank = isPivotalCard(state.current) ? pivotalRank.indexOf(state.postponed?.declarer) : -1
  return FACTIONS.filter(faction => state.eligibility.includes(faction) && state.pivotal?.[faction] === 'ready' && pivotalPreconditions[faction](state) && pivotalRank.indexOf(faction) > currentRank)
}
export function declarePivotal(state,faction) {
  ensure(pivotalOptions(state).includes(faction), 'This Pivotal Event cannot interrupt the current card.')
  if (!state.postponed) state.postponed = { card:state.current, next:state.next, declarer:faction }
  state.postponed.declarer = faction
  state.current = PIVOTAL[faction]
  state.next = state.postponed.card
  log(state,`Pivotal Event: ${card(state.current).title}`,`Event #${state.next} is postponed (§2.3.8).`)
}
export function advanceCard(state,newNext) {
  ensure(!state.result && state.current && !state.epochPhase && state.complete && !state.entropy, 'Finish the current card before advancing.')
  if (state.postponed) {
    const waiting = state.postponed
    state.postponed = null
    state.eventIndex--
    assignPair(state,waiting.card,waiting.next)
    log(state,`Resumed #${state.current}`, 'The previously revealed next card remains in view.')
    return
  }
  ensure(state.next !== null, 'No Event remains to advance to.')
  reveal(state,newNext,true)
  assignPair(state,state.next,newNext)
  if (!state.epochPhase) log(state,`Advanced to #${state.current}`)
}
export function settleEntropy(state,chosen = null) {
  const humans = humanFactions(state)
  if (humans.length !== 2) return
  const triggered = humans.includes('d') ? isFragmentation(state) : state.pivotal?.x === 'used' && state.pivotal?.s === 'used'
  if (!triggered) return
  const values = scores(state)
  const relative = faction => {
    const score = values[faction]
    if (faction === 'd') return score.score - (isFragmentation(state) ? 17 : isRoman(state) ? 75 : 60)
    if (faction === 'c') return score.score - (isFragmentation(state) ? 16 : isRoman(state) ? 36 : 27)
    return score.margin
  }
  const [a,b] = humans
  const comparison = relative(a)-relative(b)
  if (!comparison && !humans.includes(chosen)) {
    state.entropy = [...humans]
    return
  }
  const keep = comparison > 0 ? b : comparison < 0 ? a : chosen
  state.humans = [keep]
  state.human = keep
  state.entropy = null
  log(state,'Entropy',`${NAMES[humans.find(faction => faction !== keep)]} becomes a Non-player. You continue as ${NAMES[keep]} (§8.9).`)
}
export function finishAction(state, option, description, detail = '', dice = [], overrides = {}) {
  const faction = turn(state)
  ensure(actionOptions(state).includes(option), 'That choice is unavailable in the current sequence slot.')
  if (option === 'pass') {
    const track = faction === 'c' || (faction === 'd' && !isFragmentation(state)) ? 'blue' : faction === 'd' ? 'red' : faction
    changeTrack(state, track, ['d','c'].includes(faction) ? 3 : 1)
  }
  if (isPivotalCard(state.current) && option === 'event') state.pivotal[faction] = 'used'
  Object.assign(state.overrides, overrides)
  state.acts.push({ faction, option, description })
  log(state, `${NAMES[faction]} · ${description}`, detail, dice)
  const done = closeCardIfDone(state)
  settleEntropy(state)
  return done
}
function closeCardIfDone(state) {
  const executed = state.acts.filter(a => a.option !== 'pass').map(a => a.faction)
  const done = executed.length >= 2 || !turn(state)
  if (done) {
    state.complete = true
    state.eligibility = FACTIONS.filter(f => state.overrides[f] !== false && (!executed.includes(f) || state.overrides[f] === true))
  }
  return done
}
export const activeFaction = state => state.epochPhase || state.result || state.complete || state.entropy ? null : turn(state)

export function annonaGroups(state) {
  const groups = []
  for (const employer of ['d','c']) {
    for (const { name } of REGIONS) {
      for (const nation of ['s','x']) {
        const key = employer + nation + 'w'
        const space = state.land[name]
        if (!on(space, key)) continue
        groups.push({ id: `${name}/${key}`, name, key, employer, nation, due: on(space, key) - loaded(space, key) })
      }
    }
  }
  return groups
}
const annonaPayers = ['d','c']
const annonaMarked = value => [true,'yes','on','true','1'].includes(value)
const nationGroups = (state,nation) => annonaGroups(state).filter(group => !nation || nation === group.nation)

function annonaAccount(state,options) {
  const account = {...state,tracks:{...state.tracks}}
  let gold = goldAvailable(state)
  let blueLimit = options.blueSpend === '' || options.blueSpend == null ? 80 : Number(options.blueSpend)
  ensure(inRange(blueLimit,0,80),'Enter a maximum blue payment between 0 and 80.')
  const consent = Boolean(options.blueConsent)
  return {
    tracks:account.tracks,
    canPay(payer,cost) {
      const funds = payer === 'd' ? duxFunds(account,consent,blueLimit) : account.tracks.blue+account.tracks.wealth
      return cost <= funds && cost <= gold
    },
    charge(payer,cost) {
      ensure(gold >= cost,'There are too few off-board gold cubes to pay these Warbands.')
      if (payer === 'd') {
        const before = account.tracks.blue
        spendDux(account,cost,consent,blueLimit)
        blueLimit -= before-account.tracks.blue
      } else spendCivitates(account,cost)
      gold -= cost
    },
  }
}
function annonaPayment(groups,payment,payerHint) {
  const id = typeof payment === 'string' ? payment : payment.id
  const group = groups.find(group => group.id === id)
  const payer = typeof payment === 'string' ? payerHint ?? group?.employer : payment.payer
  const amount = (typeof payment === 'string' ? null : payment.amount) ?? group?.due
  ensure(group && annonaPayers.includes(payer) && inRange(amount,1,group.due),'Invalid Annona payment.')
  return {id,payer,amount}
}
export function resolveAnnona(state, paid, options = {}) {
  const groups = nationGroups(state,options.nation)
  const payments = paid.map(payment => annonaPayment(groups,payment,options.payer))
  const paidGroups = new Map()
  const costs = {d:0,c:0}
  for (const {id,payer,amount} of payments) {
    paidGroups.set(id,(paidGroups.get(id) ?? 0)+amount)
    costs[payer] += amount
  }
  ensure(groups.every(group => !paidGroups.has(group.id) || paidGroups.get(group.id) === group.due),
    'Annona must cover the entire group of the same color and nationality in its space.')
  const account = annonaAccount(state,options)
  for (const payer of annonaPayers) account.charge(payer,costs[payer])
  Object.assign(state.tracks,account.tracks)
  let releasedGroups = 0
  for (const group of groups) {
    const { id, nation, name, key, employer, due } = group
    const space = state.land[name]
    if (due === 0 || paidGroups.has(id)) {
      changeTrack(state, nation, on(space, key))
    } else {
      releasedGroups++
      space.units[nation + 'w'][0] += on(space, key)
      space.units[nation + 'w'][1] += loaded(space, key)
      for (const site of space.sites) {
        if (site?.employer === employer && site.piece === nation + 's') site.employer = null
      }
    }
    space.units[key][1] = 0
    if (due && !paidGroups.has(id)) space.units[key][0] = 0
  }
  for (const { name } of REGIONS) {
    const space = state.land[name]
    for (const nation of ['s','x']) {
      const released = groups.filter(g => g.name === name && g.nation === nation && g.due && !paidGroups.has(g.id))
      const unloaded = sum(released.map(g => g.due))
      if (unloaded) plunderTo(space, nation + 'w', Math.min(space.pop, unloaded))
    }
  }
  if (!groups.length) return 'No Foederati Warbands to resolve.'
  const notes = annonaPayers.filter(payer => costs[payer]).map(payer => {
    const count = new Set(payments.filter(payment => payment.payer === payer).map(payment => payment.id)).size
    return `${NAMES[payer]} pays ${costs[payer]} for ${count} Foederati ${count === 1 ? 'group' : 'groups'}.`
  })
  if (releasedGroups) notes.push(`${releasedGroups} unpaid Foederati ${releasedGroups === 1 ? 'group revolts' : 'groups revolt'}.`)
  return notes.join(' ') || 'All Foederati Warbands already carry their payment.'
}
export function annonaPolicy(state,humanPicks,options = {},roll) {
  const groups = nationGroups(state,options.nation).filter(group => group.due)
  const humans = annonaPayers.filter(payer => isHumanFaction(state,payer))
  const picks = humanPicks.map(payment => annonaPayment(groups,payment,humans.length === 1 ? humans[0] : undefined))
  const account = annonaAccount(state,options)
  const paid = []
  const covered = new Map()
  const pay = payment => {
    account.charge(payment.payer,payment.amount)
    paid.push(payment)
    covered.set(payment.id,(covered.get(payment.id) ?? 0)+payment.amount)
  }
  for (const payer of annonaPayers) {
    if (humans.includes(payer)) {
      for (const payment of picks.filter(payment => payment.payer === payer)) pay(payment)
      continue
    }
    const candidates = groups.filter(group => group.employer === payer && (covered.get(group.id) ?? 0) < group.due)
      .map(group => ({id:group.id,amount:group.due-(covered.get(group.id) ?? 0),tie:roll ? roll(6,'Annona · '+group.name) : 0}))
      .sort((a,b) => a.amount-b.amount || a.tie-b.tie)
    for (const group of candidates) {
      if (account.canPay(payer,group.amount)) pay({id:group.id,payer,amount:group.amount})
    }
  }
  return paid
}
const annonaPayerKey = group => 'annona-payer-'+group.id
function annonaPayerChoice(group,input) {
  if (input[annonaPayerKey(group)] != null) return input[annonaPayerKey(group)]
  if (annonaMarked(input['annona-'+group.id]) || annonaMarked(input['pay-'+group.id])) return group.employer
  return ''
}
export function annonaChoices(state,input = {},nation = null) {
  const groups = nationGroups(state,nation).filter(group => group.due)
  const humans = annonaPayers.filter(payer => isHumanFaction(state,payer))
  const fields = groups.flatMap(group => {
    if (!humans.length) return []
    const options = [['','No player payment'],...humans.map(payer => [payer,NAMES[payer]+' pays '+group.due])]
    if (humans.length === 2) {
      for (let d = 1; d < group.due; d++) options.push(['split-'+d,`Dux pays ${d}, Civitates pays ${group.due-d}`])
    }
    return [{name:annonaPayerKey(group),label:group.name+' · '+groupLabel(group.key),type:'select',options,defaultValue:annonaPayerChoice(group,input)}]
  })
  if (groups.length && humans.includes('d') && !isFragmentation(state)) {
    fields.push({name:'annona-blue-spend',label:'Maximum blue Resources for Dux (blank = blue first)',type:'number',min:0,max:80,defaultValue:''})
  }
  if (state.imperium === 'ac' && state.tracks.blue > 0 && humans.includes('c') && (humans.includes('d') ? groups.length : groups.some(group => group.employer === 'd'))) {
    fields.push({name:'blueConsent',label:'Civitates permits Dux to use blue Resources',type:'checkbox',defaultValue:false})
  }
  const scope = nation === 'x' ? 'Only Saxon Foederati resolve Annona now. ' : ''
  const help = groups.length ? scope+'Dux pays first, then Civitates. A player can cover either color. Non-players pay their own groups.' :
    scope+'No Foederati Warbands require payment.'
  return {help,fields}
}
export function planAnnona(state,input,roll,nation = null) {
  const humans = annonaPayers.filter(payer => isHumanFaction(state,payer))
  const picks = nationGroups(state,nation).filter(group => group.due).flatMap(group => {
    const value = annonaPayerChoice(group,input)
    if (humans.includes(value)) return [{id:group.id,payer:value,amount:group.due}]
    if (humans.length === 2 && typeof value === 'string' && value.startsWith('split-')) {
      const amount = Number(value.slice(6))
      ensure(inRange(amount,1,group.due-1),'Choose a valid split for the Annona group.')
      return [{id:group.id,payer:'d',amount},{id:group.id,payer:'c',amount:group.due-amount}]
    }
    return []
  })
  const blueConsent = humans.includes('c') ? annonaMarked(input.blueConsent) : scores(state).d.margin < scores(state).c.margin
  const options = {nation,blueConsent,blueSpend:humans.includes('d') ? input['annona-blue-spend'] : undefined}
  return {...options,paid:annonaPolicy(state,picks,options,roll)}
}
export function maxHoard(state) {
  const stronghold = state.markers[76] ? 'hill' : 'town'
  return Math.min(state.tracks.blue,Math.ceil(countStrongholds(state,stronghold) / 2),80-state.tracks.wealth)
}
export function resolveImperium(state, hoard, modifiers = {}) {
  ensure(inRange(hoard, 0, maxHoard(state)), 'Hoarding exceeds the current limit.')
  state.tracks.blue -= hoard
  state.tracks.wealth += hoard
  if (isFragmentation(state)) return
  const { pop, total } = boardTotals(state)
  const combined = total + state.tracks.prestige + (modifiers.prosperity ?? 0)
  const britonControl = pop.c + (modifiers.control ?? 0)
  const old = state.imperium
  if (britonControl <= 20 || combined <= 30) setImperium(state, 'f')
  else if (isRoman(state) && (britonControl <= 30 || combined <= 55)) setImperium(state, 'a' + old[1])
  if (old !== state.imperium) {
    state.tracks.prestige = Math.ceil(state.tracks.prestige / 2)
    state.tracks.wealth = Math.ceil(state.tracks.wealth / 2)
  }
  if (isFragmentation(state)) return
  const difference = state.tracks.wealth - state.tracks.prestige
  if (state.imperium[1] === 'm' && difference >= 10) setImperium(state, state.imperium[0] + 'c')
  else if (state.imperium[1] === 'c' && difference < 6) setImperium(state, state.imperium[0] + 'm')
}
export function resolveVictory(state,beforeRecovery) {
  const humans = humanFactions(state)
  const bots = FACTIONS.filter(faction => !humans.includes(faction))
  const last = state.epoch >= scenarioInfo(state).epochs
  let values = scores(state)
  const qualifiedBots = bots.filter(faction => values[faction].eligible)
  const humanQualifies = humans.every(faction => {
    if (humans.length !== 2 || !britonPair(humans) || isFragmentation(state)) return values[faction].eligible
    return values[faction].margin > 0
  }) && state.difficulty !== 'Difficult'
  const early = qualifiedBots.length || humanQualifies
  if (!early && !last) return
  if (!early && scenarioInfo(state).finalRecovery && !isFragmentation(state)) {
    beforeRecovery?.()
    resolveRecovery(state,{ prosperityOnly:true })
    values = scores(state)
  }
  const marginHuman = Math.min(...humans.map(faction => values[faction].margin))
  const tie = ['c','d','x','s']
  const candidates = early
    ? (qualifiedBots.length ? qualifiedBots : [humans[0]])
    : [...bots,humans[0]]
  const margin = faction => !early && humans.includes(faction) ? marginHuman : values[faction].margin
  const rank = candidates.sort((a,b) => margin(b)-margin(a) ||
    Number(humans.includes(a))-Number(humans.includes(b)) || tie.indexOf(a)-tie.indexOf(b))
  const winner = rank[0]
  state.result = { winner, won:humans.includes(winner), reason:early ? 'threshold' : 'final', rank }
}
const britonPair = humans => humans.includes('d') && humans.includes('c')
export function resolveRevenue(state) {
  const { pros } = boardTotals(state)
  if (state.imperium[1] === 'm') changeTrack(state, 'prestige', isRoman(state) ? 5 : 2)
  if (isFragmentation(state)) {
    const towns = sum(REGIONS.filter(({ name }) => control(state,name) === 'd').map(({ name }) => state.land[name].sites.filter(site => site?.piece === 'town').length))
    changeTrack(state, 'red', pros.d + towns + countStrongholds(state, 'fort'))
  }
  changeTrack(state,'blue',pros.c+countStrongholds(state,state.markers[76] ? 'hill' : 'town'))
  if (isRoman(state)) changeTrack(state, 'blue', state.imperium[1] === 'm' ? -30 : -20)
  changeTrack(state, 'x', pros.x)
  changeTrack(state, 's', countStrongholds(state, 'ss', null))
}
export function resolveRecovery(state,{ prosperityOnly = false } = {}) {
  for (const { name, terrain } of REGIONS) {
    const space = state.land[name]
    if (terrain !== 'City') space.pros = space.pros.map(row => Math.min(row,space.pop))
  }
  for (const { name, terrain, printed } of REGIONS) {
    const space = state.land[name]
    if (control(state,name)) addProsperity(state,name,terrain === 'City' ? 2 * printed : space.pop,!isRoman(state))
  }
  if (prosperityOnly) return
  for (const [key, marker] of Object.entries(state.markers)) {
    if (marker.type === 'momentum') delete state.markers[key]
  }
  state.eligibility = [...FACTIONS]
  state.eventIndex = 0
}
export function advanceEpoch(state, info = {}, replacement = null) {
  const phase = state.epochPhase
  ensure(EPOCH_PHASES.includes(phase) && !state.result, 'No Epoch phase is due.')
  const annonaNote = phase === 'Annona' && state.markers[10]?.side !== 'unshaded' ? resolveAnnona(state,info.paid || [],info) : ''
  if (phase === 'Imperium') {
    resolveImperium(state,info.hoard ?? 0)
    settleEntropy(state)
  }
  if (phase === 'Victory') resolveVictory(state,info.beforeRecovery)
  if (phase === 'Revenue') resolveRevenue(state)
  if (phase === 'Epoch Event') settleEntropy(state)
  if (phase === 'Recovery & Reset') {
    info.beforeRecovery?.()
    resolveRecovery(state)
    reveal(state, replacement, true)
  }
  log(state,phase,[info.note,annonaNote,info.recoveryNote].filter(Boolean).join(' '),info.dice || [])
  if (state.result) {
    state.epochPhase = null
    log(state, `${NAMES[state.result.winner]} wins`, state.result.reason === 'final' ? 'Final scoring at the last Epoch (§6.3, §7.3).' : 'Victory threshold reached (§7.1–7.2).')
  } else if (phase === 'Recovery & Reset') {
    assignPair(state, state.next, replacement)
    if (!state.epochPhase) log(state, `Resumed #${state.current}`, 'All factions begin the new Epoch eligible (§6.7).')
  } else {
    state.epochPhase = EPOCH_PHASES[EPOCH_PHASES.indexOf(phase) + 1]
  }
  return state
}
export function validateSave(state, options) {
  validatePosition(state,options)
  ensure(inRange(state.rng,1,0xffffffff), 'The save has an invalid die state.')
  ensure(Array.isArray(state.eligibility) && isUnique(state.eligibility) && state.eligibility.every(f => FACTIONS.includes(f)), 'Invalid faction eligibility.')
  validateRevealedDeck(state,state.revealed)
  if (state.deck) {
    validateRevealedDeck(state,state.deck)
    ensure(state.deckMode === 'digital' && state.deck.length === scenarioDeckSize(state) && state.revealed.every((id,index) => state.deck[index] === id), 'The digital deck is inconsistent.')
  }
  for (const id of [state.current,state.next]) ensure(id === null || state.revealed.includes(id) || (id === state.current && isPivotalCard(id) && state.postponed), 'A current or next card is missing from the revealed deck.')
  ensure(state.current !== state.next || state.current === null, 'Current and next card cannot match.')
  ensure(inRange(state.epoch,0,scenarioInfo(state).epochs) && inRange(state.eventIndex,0,16) && (state.epochPhase === null || (EPOCH_PHASES.includes(state.epochPhase) && own(EPOCHS,state.current) && Boolean(card(state.next)))), 'Invalid Epoch phase or count.')
  if (state.pivotal !== undefined) ensure(FACTIONS.every(faction => ['ready','used','absent'].includes(state.pivotal?.[faction])), 'Invalid Pivotal Event availability.')
  if (state.postponed) ensure(isPivotalCard(state.current) && PIVOTAL[state.postponed.declarer] === state.current && [state.postponed.card,state.postponed.next].every(id => id === null || state.revealed.includes(id)), 'Invalid postponed Event.')
  if (state.entropy) ensure(Array.isArray(state.entropy) && state.entropy.length === 2 && state.entropy.every(faction => humanFactions(state).includes(faction)), 'Invalid Entropy choice.')
  ensure(state.omens === null || (state.omens && ((FACTIONS.includes(state.omens.holder) && state.omens.head === null) || (state.omens.holder === null && FACTIONS.includes(state.omens.head)))), 'Invalid Omens marker.')
  ensure(typeof state.complete === 'boolean' && Array.isArray(state.acts) && state.acts.length <= 4 && isUnique(state.acts.map(a => a.faction)) && state.acts.every(a => FACTIONS.includes(a.faction) && own(ACTIONS,a.option) && typeof a.description === 'string'), 'Invalid action sequence.')
  ensure(state.overrides && typeof state.overrides === 'object' && Object.entries(state.overrides).every(([key,value]) => FACTIONS.includes(key) && typeof value === 'boolean'), 'Invalid eligibility overrides.')
  ensure(state.markers && typeof state.markers === 'object' && Object.entries(state.markers).every(([key,value]) => inRange(Number(key),1,83) && ['capability','momentum'].includes(value?.type) && ['shaded','unshaded'].includes(value?.side)), 'Invalid Event markers.')
  ensure(state.result === null || (FACTIONS.includes(state.result?.winner) && ['threshold','final'].includes(state.result.reason) && state.result.won === isHumanFaction(state,state.result.winner) && Array.isArray(state.result.rank) && state.result.rank.every(f => FACTIONS.includes(f))), 'Invalid victory result.')
  ensure(Array.isArray(state.log) && state.log.length < 1050 && state.log.every(entry => {
    return typeof entry?.title === 'string' && entry.title.length < 250 && typeof entry.detail === 'string' && entry.detail.length < 3000 &&
      Array.isArray(entry.dice) && entry.dice.every(die => typeof die?.label === 'string' && [4,6].includes(die.sides) && inRange(die.value,1,die.sides))
  }), 'Invalid campaign journal.')
  return state
}
const isUnique = values => new Set(values).size === values.length

export function preview(state, label, description, mutate, dice = []) {
  const after = clone(state)
  mutate(after)
  validateSave(after)
  return { label, description, after, dice }
}

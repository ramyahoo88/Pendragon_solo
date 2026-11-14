import { BY_NAME, FACTIONS, GROUPS, REGIONS, SCENARIO } from './data.mjs'

const EARLY_EPOCHS = [77,78,79,80]
const LATE_EPOCHS = [81,82,83]

export const SCENARIOS = {
  [SCENARIO]: {
    epochs: 2,
    epochPiles: [EARLY_EPOCHS, EARLY_EPOCHS],
    finalRecovery: false,
    pivots: {},
    active: {},
  },
  'Petty Tyrants': {
    epochs: 2,
    epochPiles: [[82,83],[82,83]],
    finalRecovery: true,
    pivots: { s:'used', c:'used' },
    active: { 73:'unshaded', 76:'unshaded', 81:'unshaded' },
    optional: {
      removed: [4,5,13,20,22,30,35,49,54],
      active: { 7:'unshaded', 21:'unshaded', 56:'shaded', 68:'shaded' },
    },
  },
  'The Harder They Fall': {
    epochs: 4,
    epochPiles: [[79,80], LATE_EPOCHS, LATE_EPOCHS, LATE_EPOCHS],
    finalRecovery: true,
    pivots: { d:'ready', c:'ready', x:'ready', s:'used' },
    active: { 73:'unshaded' },
    optional: { removed: [4,13,20], active: {} },
  },
  'De Excidio Britanniae': {
    epochs: 6,
    epochPiles: [EARLY_EPOCHS, EARLY_EPOCHS, EARLY_EPOCHS, LATE_EPOCHS, LATE_EPOCHS, LATE_EPOCHS],
    finalRecovery: true,
    pivots: { d:'ready', c:'ready', x:'ready', s:'ready' },
    active: {},
  },
}

export const TEARS_REGIONS = ['Textoverdi','Deceangli','Iceni','Durotriges']
export const printedPopulation = (state,name) =>
  (state.markers?.[81] || state.scenario === 'Petty Tyrants') && TEARS_REGIONS.includes(name) ? 1 : BY_NAME[name].printed

export const scenarioInfo = state => SCENARIOS[state.scenario]
export const scenarioDeckSize = state => 13 * scenarioInfo(state).epochs
export const allowedEpochs = (state,pileIndex) => scenarioInfo(state).epochPiles[pileIndex] ?? []

// Columns are Region, Prosperity, Population override, occupied sites in board order, and troop groups.
// Living Rules pp. 39–40 include the Iceni Prosperity correction and retain seven Saxon Settlements.
const PETTY_BOARD = [
  ['Dumnonii',2,2,[null,'hill'],{com:2}],
  ['Durotriges',1,1,['town','hill'],{com:2,mil:3}],
  ['Atrebates',2,2,['fort','town'],{cav:2,mil:2}],
  ['Regni',1,1,['xs',null],{xw:2}],
  ['Cantiaci',2,null,['xs',null],{xw:4}],
  ['Londinium',4,null,['town'],{mil:2}],
  ['Trinovantes',2,null,['xs:c','town'],{cxw:2,mil:2}],
  ['Iceni',1,1,['xs',null],{xw:3}],
  ['Catuvellauni',3,null,['town','xs:c'],{com:2,mil:2,cxw:4}],
  ['Dobunni',4,null,['town','town'],{com:1,mil:3}],
  ['Cornovii',2,null,['town','hill'],{com:1,mil:2}],
  ['Corieltauvi',2,null,['xs',null],{xw:3}],
  ['Silures',1,null,['ss:d','town'],{dsw:2,mil:2}],
  ['Demetae',1,null,['ss',null],{sw:2}],
  ['Ordovices',1,null,['hill','hill'],{com:2,mil:2}],
  ['Deceangli',1,1,['fort',null],{cav:2}],
  ['Brigantes',1,null,[null,'hill'],{com:1,mil:1}],
  ['Parisi',2,null,['hill','xs:d'],{mil:1,dxw:3}],
  ['Eboracum',2,null,['fort'],{cav:1}],
  ['Textoverdi',1,1,['fort','town'],{cav:3,mil:2}],
  ['Carvetii',1,null,['fort','fort'],{cav:2}],
  ['Votadini',2,null,['hill','hill'],{com:2,mil:2}],
  ['Novantae',1,null,[null,'ss'],{sw:3}],
]

const HARDER_BOARD = [
  ['Dumnonii',1,null,[null,'hill'],{mil:2}],
  ['Durotriges',4,null,['town','hill'],{mil:3}],
  ['Atrebates',6,null,['fort','town'],{cav:1,mil:1}],
  ['Regni',2,null,['xs:c',null],{cxw:3}],
  ['Cantiaci',2,null,[null,'town'],{mil:2}],
  ['Londinium',4,null,['town'],{mil:2}],
  ['Trinovantes',2,null,['fort','town'],{cav:1,mil:2}],
  ['Iceni',0,null,[null,null],{xw:2}],
  ['Catuvellauni',6,null,['town','xs:c'],{mil:2,cxw:3}],
  ['Dobunni',4,null,['town','town'],{mil:3}],
  ['Cornovii',4,null,['town',null],{mil:1}],
  ['Corieltauvi',2,null,['fort','town'],{cav:1,mil:1}],
  ['Silures',1,null,[null,'town'],{mil:2}],
  ['Demetae',1,null,['ss',null],{sw:1}],
  ['Ordovices',1,null,[null,'hill'],{mil:2}],
  ['Deceangli',4,null,['fort',null],{cav:1}],
  ['Brigantes',2,null,['hill',null],{mil:1}],
  ['Parisi',4,null,['fort',null],{cav:1}],
  ['Eboracum',2,null,['fort'],{}],
  ['Textoverdi',2,null,['fort',null],{cav:1}],
  ['Carvetii',1,null,['fort',null],{cav:1}],
  ['Votadini',2,null,['hill',null],{mil:2}],
  ['Novantae',0,null,[null,null],{}],
]

function makeLand(rows) {
  const openingRows = rows ?? REGIONS.map(region => [
    region.name,
    region.prosperity,
    null,
    region.sites.map(site => site.initial),
    { cav:region.cavalry, mil:region.militia },
  ])
  return Object.fromEntries(openingRows.map(([name,prosperity,population,occupants,forces]) => {
    const region = BY_NAME[name]
    const pop = population ?? region.printed
    const bottom = region.terrain === 'City' ? prosperity : Math.min(pop,prosperity)
    const sites = occupants.map(site => {
      if (!site) return null
      const [piece,employer = null] = site.split(':')
      return { piece, employer }
    })
    const units = Object.fromEntries(GROUPS.map(([key]) => [key,[forces[key] ?? 0,0]]))
    return [name,{ pop, pros:[bottom,prosperity-bottom], sites, units }]
  }))
}

export function configureScenario(state,name,variant = false) {
  if (!Object.hasOwn(SCENARIOS,name)) throw new Error('Choose a Pendragon scenario.')
  const info = SCENARIOS[name]
  state.scenario = name
  state.variant = Boolean(variant && info.optional)
  state.pivotal = Object.fromEntries(FACTIONS.map(faction => [faction,info.pivots[faction] ?? 'absent']))
  const startingCapabilities = { ...info.active, ...(state.variant ? info.optional.active : {}) }
  state.markers = Object.fromEntries(Object.entries(startingCapabilities).map(([id,side]) => [id,{type:'capability',side}]))
  state.seas = { brit:true, germ:true, hib:false, sept:false }
  const petty = name === 'Petty Tyrants'
  const harder = name === 'The Harder They Fall'
  state.imperium = petty ? 'f' : harder ? 'rc' : 'rm'
  state.roads = !petty
  state.land = makeLand(petty ? PETTY_BOARD : harder ? HARDER_BOARD : null)
  state.tracks = {
    blue:petty ? 30 : harder ? 32 : 25, red:petty ? 20 : 0,
    x:petty ? 25 : harder ? 12 : 10, s:petty ? 32 : harder ? 15 : 6,
    prestige:petty ? 2 : harder ? 10 : 0, wealth:petty ? 15 : harder ? 13 : 0,
    refugees:0, dalRiada:0, niall:0,
  }
  state.pools = { casualties:0, out:petty || harder ? 5 : 0, notYet:petty ? 0 : 15 }
  return state
}

export function removedScenarioEvents(state) {
  const optional = state.variant && scenarioInfo(state).optional
  return optional ? [...optional.removed,...Object.keys(optional.active).map(Number)] : []
}

export function validateRevealedDeck(state,cards) {
  if (!Array.isArray(cards)) throw new Error('The revealed deck must be a list of card numbers.')
  const size = scenarioDeckSize(state)
  if (cards.length > size) throw new Error(`This scenario has only ${size} cards to reveal.`)
  const removed = removedScenarioEvents(state)
  const seen = new Set()
  // An Epoch inserted into the bottom four event cards can occupy any of five slots (9–13).
  let epochInPile = false
  for (const [index,id] of cards.entries()) {
    const pile = Math.floor(index / 13)
    const slot = index % 13
    if (!slot) epochInPile = false
    if (!Number.isInteger(id) || id < 1 || id > 83 || (id >= 73 && id <= 76)) {
      throw new Error('Enter an ordinary Event (#1–72) or a scenario Epoch card.')
    }
    if (seen.has(id)) throw new Error(`Card #${id} has already been entered.`)
    seen.add(id)
    if (removed.includes(id)) throw new Error(`Event #${id} is set aside in this scenario variant.`)
    if (id >= 77) {
      if (!allowedEpochs(state,pile).includes(id)) throw new Error(`Epoch #${id} is unavailable in pile ${pile + 1} for this scenario.`)
      if (slot < 8 || epochInPile) throw new Error('Each 13-card pile has one Epoch among its last four Event cards.')
      epochInPile = true
    } else if (slot === 12 && !epochInPile) {
      throw new Error('The last card of this pile must be an Epoch because one has yet to appear.')
    }
  }
  return cards
}

export function makeScenarioDeck(state,rollIndex) {
  function indexIn(size) {
    const index = rollIndex(size)
    if (!Number.isInteger(index) || index < 0 || index >= size) throw new Error('Invalid random card index.')
    return index
  }
  const removed = removedScenarioEvents(state)
  const events = Array.from({length:72},(_,i) => i + 1).filter(id => !removed.includes(id))
  for (let i = events.length - 1; i > 0; i--) {
    const index = indexIn(i + 1)
    const event = events[i]
    events[i] = events[index]
    events[index] = event
  }
  const usedEpochs = new Set()
  const cards = []
  for (let pile = 0; pile < scenarioInfo(state).epochs; pile++) {
    const options = allowedEpochs(state,pile).filter(id => !usedEpochs.has(id))
    const chosen = options[indexIn(options.length)]
    usedEpochs.add(chosen)
    const chunk = events.slice(pile * 12,pile * 12 + 12)
    chunk.splice(8 + indexIn(5),0,chosen)
    cards.push(...chunk)
  }
  return validateRevealedDeck(state,cards)
}

// Dal Riada #59 explicitly counts its card settlement as on-map for victory (§5.1.1).
export function scenarioBarbarianScores(state,pop,saxonSettlements,scottiSettlements) {
  const short = state.scenario === SCENARIO
  const fragment = state.imperium === 'f'
  const { x, s, dalRiada } = state.tracks
  const scottiVictorySettlements = scottiSettlements + (dalRiada ?? 0)
  const saxonControlTarget = short ? 3 : 10
  const saxonRenownTarget = short ? 24 : 30
  const saxonSettlementTarget = short ? 3 : 4
  const scottiRenownTarget = short ? 24 : 45
  const scottiSettlementTarget = short ? 2 : 4
  return {
    x: {
      score:pop.x, target:saxonControlTarget, settlements:saxonSettlements,
      renownTarget:saxonRenownTarget, settlementTarget:saxonSettlementTarget,
      margin:fragment ? pop.x - saxonControlTarget : Math.max(pop.x - saxonControlTarget,x - saxonRenownTarget + 5 * (saxonSettlements - saxonSettlementTarget)),
      eligible:pop.x > saxonControlTarget || (!fragment && x > saxonRenownTarget && saxonSettlements >= saxonSettlementTarget),
    },
    s: {
      score:s, target:scottiRenownTarget, settlements:scottiSettlements,
      settlementTarget:scottiSettlementTarget, victorySettlements:scottiVictorySettlements,
      margin:s - scottiRenownTarget + 5 * (scottiVictorySettlements - scottiSettlementTarget),
      eligible:s > scottiRenownTarget && scottiVictorySettlements >= scottiSettlementTarget,
    },
  }
}

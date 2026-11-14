import { BY_NAME, DIFFICULTIES, EDITION, FACTIONS, GROUP, GROUPS, NAMES, PIECES, POOLS, REGIONS, SCENARIO, SCHEMA, SEAS, SOLO_SEATS, STATUS, STOCK, TRACKS } from './data.mjs'
import { configureScenario, printedPopulation, scenarioBarbarianScores, SCENARIOS } from './scenarios.mjs'

export const clone = value => JSON.parse(JSON.stringify(value))
export const sum = values => values.reduce((total, value) => total + value, 0)
export const own = (obj, key) => Object.hasOwn(obj, key)
export const inRange = (n, min, max) => Number.isInteger(n) && n >= min && n <= max
export const clamp = (n, min = 0, max = 80) => Math.max(min, Math.min(n, max))
export const ensure = (condition, message) => { if (!condition) throw new Error(message) }
export const isRoman = state => state.imperium[0] === 'r'
export const isFragmentation = state => state.imperium === 'f'
export const preemption = state => isRoman(state) || state.imperium === 'am'
export const toOwner = (piece, employer) => employer || ({ fort: 'd', town: 'c', hill: 'c', xs: 'x', ss: 's' }[piece])
export const totalProsperity = space => space.pros[0] + space.pros[1]
export const isRaider = key => key === 'xr' || key === 'sr'
export const on = (space, key) => space.units[key][0]
export const loaded = (space, key) => space.units[key][1]
export const spaceLabel = key => BY_NAME[key]?.name || key
export const groupLabel = key => {
  const { piece, owner } = GROUP[key]
  return key === piece ? PIECES[piece] : `${PIECES[piece]} (${NAMES[owner]} Foederati)`
}
export const humanFactions = state => state.humans ?? [state.human]
export const isHumanFaction = (state,faction) => humanFactions(state).includes(faction)
export function opening(seed = Date.now() >>> 0, settings = {}) {
  const { scenario = SCENARIO, variant = false, seat = 'c', difficulty = 'Standard', deckMode = 'physical' } = settings
  ensure(own(SOLO_SEATS,seat) && DIFFICULTIES.includes(difficulty) && ['physical','digital'].includes(deckMode), 'Invalid solo settings.')
  const humans = [...SOLO_SEATS[seat]]
  return configureScenario({
    schema:SCHEMA, edition:EDITION, human:humans[0], humans, difficulty, deckMode, deck:null,
    rng:(seed >>> 0) || 1, omens:null, eligibility:[], revealed:[], current:null, next:null, postponed:null,
    epoch:0, epochPhase:null, eventIndex:0, acts:[], complete:false, overrides:{}, result:null, log:[],
  },scenario,variant)
}
export function moveUnits(state,origin,destination,key,count,plunder = 0) {
  const from = state.land[origin]
  const to = state.land[destination]
  ensure(from && to && origin !== destination && own(GROUP,key), 'Choose distinct valid origin and destination spaces.')
  ensure(inRange(count,0,on(from,key)) && inRange(plunder,0,Math.min(count,loaded(from,key))) && count-plunder <= on(from,key)-loaded(from,key), 'The moving force or its Plunder is unavailable.')
  from.units[key][0] -= count
  from.units[key][1] -= plunder
  to.units[key][0] += count
  to.units[key][1] += plunder
}
export function piecesByOwner(space, { raiders = true, strongholds = true } = {}) {
  const counts = { d: 0, c: 0, x: 0, s: 0 }
  for (const [key, owner] of GROUPS) {
    if (raiders || !isRaider(key)) counts[owner] += on(space, key)
  }
  if (strongholds) {
    for (const site of space.sites) if (site) counts[toOwner(site.piece, site.employer)]++
  }
  return counts
}
export function hasStronghold(space, owners) {
  return space.sites.some(site => site && owners.includes(toOwner(site.piece, site.employer)))
}
export function control(state, name) {
  const space = state.land[name]
  const counts = piecesByOwner(space, { raiders: false })
  const total = sum(Object.values(counts))
  const sides = isFragmentation(state)
    ? [['d',['d']], ['c',['c']], ['x',['x']], ['s',['s']]]
    : [['b',['d','c']], ['x',['x']], ['s',['s']]]
  for (const [id, owners] of sides) {
    if (hasStronghold(space, owners) && (BY_NAME[name].terrain === 'City' || sum(owners.map(owner => counts[owner])) * 2 > total)) return id
  }
  return null
}
export const controlName = id => id === 'b' || id === 'c' ? 'Briton' : id ? NAMES[id] : 'Uncontrolled'
export const friendlyControl = (state, name, faction) => {
  const id = control(state, name)
  return id === faction || (id === 'b' && (faction === 'c' || faction === 'd'))
}
export function countStrongholds(state, piece, employer) {
  return sum(REGIONS.map(({ name }) => state.land[name].sites.filter(site => site?.piece === piece && (employer === undefined || site.employer === employer)).length))
}
export function boardTotals(state) {
  const pop = { d: 0, c: 0, x: 0, s: 0 }
  const pros = { d: 0, c: 0, x: 0, s: 0 }
  let total = 0
  let plunder = 0
  for (const { name } of REGIONS) {
    const space = state.land[name]
    total += totalProsperity(space)
    plunder += sum(GROUPS.map(([key]) => loaded(space, key)))
    const owner = control(state, name)
    if (owner) {
      const faction = owner === 'b' ? 'c' : owner
      pop[faction] += space.pop
      pros[faction] += totalProsperity(space)
    }
  }
  return { pop, pros, total, plunder }
}
export function availability(state) {
  const free = { ...STOCK }
  for (const space of Object.values(state.land)) {
    for (const [key, , piece] of GROUPS) free[piece] -= on(space, key)
    for (const site of space.sites) if (site) free[site.piece]--
  }
  free.cav -= state.pools.casualties + state.pools.out
  free.com -= state.pools.notYet
  free.ss -= state.tracks.dalRiada
  free.sr -= state.tracks.niall
  return free
}
export function goldAvailable(state) {
  const totals = boardTotals(state)
  return 90 - totals.total - totals.plunder
}
export function changeTrack(state, key, delta) {
  state.tracks[key] = clamp(state.tracks[key] + delta)
}
export function setImperium(state, value) {
  state.imperium = value
  if (isRoman(state)) state.roads = true
  if (isFragmentation(state)) state.roads = false
}
export function spendDux(state, cost, blueConsent = false, maxBlue = 80) {
  const fromBlue = preemption(state) || (state.imperium === 'ac' && blueConsent) ? Math.min(cost, state.tracks.blue,maxBlue) : 0
  ensure(state.tracks.red >= cost - fromBlue, 'Dux cannot pay with the available Resources.')
  state.tracks.blue -= fromBlue
  state.tracks.red -= cost - fromBlue
}
export const duxFunds = (state,blueConsent = false,maxBlue=80) => state.tracks.red +
  (preemption(state) || (state.imperium === 'ac' && blueConsent) ? Math.min(state.tracks.blue,maxBlue) : 0)
export function spendCivitates(state, cost) {
  ensure(state.tracks.blue + state.tracks.wealth >= cost, 'Civitates cannot pay with the available Resources.')
  const blue = Math.min(cost, state.tracks.blue)
  state.tracks.blue -= blue
  state.tracks.wealth -= cost - blue
}
export function addProsperity(state, name, amount, bottomOnly = false) {
  const space = state.land[name]
  const city = BY_NAME[name].terrain === 'City'
  const cap = city ? BY_NAME[name].printed * 2 : space.pop
  let left = Math.min(amount, goldAvailable(state))
  const before = totalProsperity(space)
  for (const row of city || bottomOnly ? [0] : [0,1]) {
    const add = Math.min(left, Math.max(0, cap - space.pros[row]))
    space.pros[row] += add
    left -= add
  }
  return totalProsperity(space) - before
}
export function removeProsperity(space, amount) {
  const fromTop = Math.min(space.pros[1], amount)
  space.pros[1] -= fromTop
  space.pros[0] -= Math.min(space.pros[0], amount - fromTop)
}
export function plunderTo(space, key, amount) {
  const taken = Math.min(amount, totalProsperity(space), on(space, key) - loaded(space, key))
  removeProsperity(space, taken)
  space.units[key][1] += taken
  return taken
}
export function scores(state) {
  const { pop, total } = boardTotals(state)
  const { prestige } = state.tracks
  const saxonSettlements = countStrongholds(state, 'xs')
  const scottiSettlements = countStrongholds(state, 'ss')
  const fragment = isFragmentation(state)
  const roman = isRoman(state)
  const military = state.imperium[1] === 'm'
  const dScore = (fragment ? pop.d : total) + prestige
  const dTarget = fragment ? 17 : roman ? (military ? 75 : 85) : (military ? 60 : 70)
  const cTarget = fragment ? 16 : roman ? (military ? 38 : 36) : (military ? 31 : 27)
  return {
    d: { score: dScore, target: dTarget, margin: dScore - dTarget, eligible: (fragment || military) && dScore > dTarget },
    c: { score: pop.c, target: cTarget, margin: pop.c - cTarget, eligible: (fragment || !military) && pop.c > cTarget },
    ...scenarioBarbarianScores(state,pop,saxonSettlements,scottiSettlements),
  }
}

function validateLand(state, draft) {
  ensure(Object.keys(state.land || {}).length === REGIONS.length, 'Save has an incorrect set of spaces.')
  for (const region of REGIONS) {
    const space = state.land[region.name]
    const city = region.terrain === 'City'
    ensure(space && inRange(space.pop, 0, printedPopulation(state,region.name) + (city ? 0 : 1)), `${region.name} has an invalid Population.`)
    ensure(Array.isArray(space.pros) && space.pros.length === 2 && space.pros.every(n => inRange(n, 0, city ? region.printed * 2 : region.printed + 1)) && (!city || space.pros[1] === 0), `${region.name} has an invalid prosperity row.`)
    ensure(Array.isArray(space.sites) && space.sites.length === region.sites.length, `${region.name} has an incorrect set of sites.`)
    for (const [i, site] of space.sites.entries()) {
      if (site === null) continue
      ensure(site && ['fort','town','hill','xs','ss'].includes(site.piece), `Unknown Stronghold at ${region.sites[i].name}.`)
      ensure(site.employer === null || (['xs','ss'].includes(site.piece) && ['d','c'].includes(site.employer)), `Invalid Foederati marker at ${region.sites[i].name}.`)
      ensure(site.piece !== 'town' || region.sites[i].type === 'T', `A Town requires a Town Site at ${region.sites[i].name}.`)
      ensure(!city || site.piece !== 'hill', `A City cannot hold a Hillfort at ${region.name}.`)
    }
    ensure(Object.keys(space.units || {}).length === GROUPS.length, `${region.name} has an incorrect set of unit groups.`)
    for (const [key, , piece] of GROUPS) {
      const pair = space.units[key]
      ensure(Array.isArray(pair) && pair.length === 2 && inRange(pair[0], 0, draft ? 30 : STOCK[piece]) && inRange(pair[1], 0, draft ? 30 : pair[0]), `Check ${groupLabel(key)} at ${region.name}. Plunder cannot exceed units.`)
    }
  }
}
export function validatePosition(state, { draft = false } = {}) {
  ensure(state?.schema === SCHEMA && state.edition === EDITION && own(SCENARIOS,state.scenario) && FACTIONS.includes(state.human) && DIFFICULTIES.includes(state.difficulty), 'This save has an unrecognized scenario, edition, or difficulty.')
  const humans = humanFactions(state)
  ensure(Array.isArray(humans) && humans[0] === state.human && Object.values(SOLO_SEATS).some(seat => seat.length === humans.length && seat.every(faction => humans.includes(faction))), 'Invalid human faction seats.')
  ensure(own(STATUS, state.imperium) && typeof state.roads === 'boolean', 'Invalid Imperium or Roads status.')
  ensure((!isRoman(state) || state.roads) && (!isFragmentation(state) || !state.roads), 'Roads and Imperium status disagree.')
  for (const key of Object.keys(SEAS)) ensure(typeof state.seas?.[key] === 'boolean', 'Check the patrol statuses.')
  for (const key of Object.keys(POOLS)) ensure(inRange(state.pools?.[key], 0, key === 'notYet' ? 15 : 20), `Invalid ${POOLS[key]} count.`)
  const ceilings = { refugees: 4, dalRiada: 6, niall: 30 }
  for (const key of Object.keys(TRACKS)) ensure(inRange(state.tracks?.[key], 0, ceilings[key] ?? 80), `Check the value for ${TRACKS[key]}.`)
  validateLand(state,draft)
  if (!draft) {
    for (const [key, count] of Object.entries(availability(state))) ensure(count >= 0, `${PIECES[key]} exceeds the piece supply by ${-count}.`)
    ensure(goldAvailable(state) >= 0, 'The board and Plunder exceed the 90 gold cubes in the game.')
  }
  return state
}

export function boardDiff(before, after) {
  const changes = []
  for (const { name, sites } of REGIONS) {
    const a = before.land[name]
    const b = after.land[name]
    const rows = []
    if (a.pop !== b.pop) rows.push(['Population', a.pop, b.pop])
    if (a.pros.some((v, i) => v !== b.pros[i])) rows.push(['Prosperity', totalProsperity(a), totalProsperity(b)])
    for (const [key] of GROUPS) {
      if (on(a, key) !== on(b, key)) rows.push([groupLabel(key), on(a, key), on(b, key)])
      if (loaded(a, key) !== loaded(b, key)) rows.push([`${groupLabel(key)} with Plunder`, loaded(a, key), loaded(b, key)])
    }
    const siteText = site => site ? PIECES[site.piece] + (site.employer ? ` (${NAMES[site.employer]})` : '') : 'Vacant'
    for (let i = 0; i < sites.length; i++) {
      if (siteText(a.sites[i]) !== siteText(b.sites[i])) rows.push([sites[i].name, siteText(a.sites[i]), siteText(b.sites[i])])
    }
    const from = control(before, name)
    const to = control(after, name)
    if (from !== to) rows.push(['Control', controlName(from), controlName(to)])
    if (rows.length) changes.push({ name, rows })
  }
  const tracks = []
  for (const [key, label] of Object.entries(TRACKS)) {
    if (before.tracks[key] !== after.tracks[key]) tracks.push([label, before.tracks[key], after.tracks[key]])
  }
  const fromTotals = boardTotals(before)
  const toTotals = boardTotals(after)
  if (fromTotals.total !== toTotals.total) tracks.push(['Total Prosperity', fromTotals.total, toTotals.total])
  for (const faction of ['c','d','x','s']) {
    if (fromTotals.pop[faction] !== toTotals.pop[faction]) tracks.push([`${faction === 'c' ? 'Briton' : NAMES[faction]} Control`, fromTotals.pop[faction], toTotals.pop[faction]])
  }
  if (before.imperium !== after.imperium) tracks.push(['Imperium', STATUS[before.imperium], STATUS[after.imperium]])
  if (before.roads !== after.roads) tracks.push(['Roads', before.roads ? 'Maintained' : 'Not maintained', after.roads ? 'Maintained' : 'Not maintained'])
  for (const [key, label] of Object.entries(SEAS)) {
    if (before.seas[key] !== after.seas[key]) tracks.push([label, before.seas[key] ? 'Patrolled' : 'No patrol', after.seas[key] ? 'Patrolled' : 'No patrol'])
  }
  for (const [key, label] of Object.entries(POOLS)) {
    if (before.pools[key] !== after.pools[key]) tracks.push([label, before.pools[key], after.pools[key]])
  }
  return { changes, tracks }
}

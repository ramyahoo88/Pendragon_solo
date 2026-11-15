import { BY_NAME, GROUPS, NAMES, RANDOM_SPACES, REGIONS, ROADS, SEAS } from './data.mjs'
import { card } from './cards.mjs'
import { printedPopulation, scenarioInfo } from './scenarios.mjs'
import { battleEnemies, battleForecast, battleTargets, withdrawalCapacity } from './battle.mjs'
import { botEventInput, eventBattleRequests, eventChoices, eventSides, rivalCaesarsLosses, runEvent } from './events.mjs'
import { hasEventEffect, selectBotEventInput } from './event-policy.mjs'
import { grantRule, setGrantMarkers } from './grants.mjs'
import { civitatesMusterCapacity, runCommand, runCommandFeat, settleSpaceLimit } from './commands.mjs'
import { botForcesRaidBattle, raidBonusPlunder, raidResponders } from './operations.mjs'
import { addProsperity, availability, boardTotals, changeTrack, clone, control, countStrongholds, duxFunds, friendlyControl, goldAvailable, hasStronghold, isFragmentation, loaded, makeRoller as positionRoller, on, piecesByOwner, plunderTo, preemption, removeProsperity, scores, spendCivitates, spendDux, sum, toOwner, totalProsperity } from './position.mjs'
import { actionOptions, activeFaction, finishAction, isPivotalCard, pivotalOptions, resolveImperium } from './sequence.mjs'

export const makeRoller = positionRoller
export function chooseSpace(names, roll, label) {
  if (!names.length) return null
  if (names.length === 1) return names[0]
  if (names.length <= 6) {
    let value
    do { value = roll(names.length <= 4 ? 4 : 6,label) } while (value > names.length)
    return names[value - 1]
  }
  if (!names.every(name => Object.hasOwn(BY_NAME,name))) {
    const bucket = Math.ceil(names.length/6)
    for (;;) {
      const high = chooseSpace(Array.from({length:bucket},(_,index)=>index),roll,label+' · group')
      const index = high*6+roll(6,label+' · position')-1
      if (index < names.length) return names[index]
    }
  }
  const column = roll(4,label + ' · column') - 1
  const row = roll(6,label + ' · row') - 1
  const table = RANDOM_SPACES.flat()
  const start = column * 6 + row
  for (let i = 0; i < table.length; i++) {
    const space = table[(start + i) % table.length]
    if (names.includes(space)) return space
  }
  throw new Error('The Random Spaces Table has no eligible entry.')
}
const botHasHuman = (state,faction) => (state.humans || [state.human]).includes(faction)
function botAllowance(state) {
  const first = state.acts.find(act => act.option !== 'pass')
  const isLimitedSlot = Boolean(first && first.option !== 'event')
  return {
    oneSpace:isLimitedSlot && ['Introductory','Easy'].includes(state.difficulty),
    allowedFeat:!isLimitedSlot || state.difficulty !== 'Introductory',
  }
}
const shield = symbol => symbol === 'h' || symbol === 'b'
const eventBlocked = (cardInfo, faction) => cardInfo?.symbols[faction] === 'r'

function precedence(info, other) {
  for (let i = 0; i < info.length; i++) {
    if (info[i] !== other[i]) return other[i] - info[i]
  }
  return 0
}
function pickBest(candidates, roll, label) {
  if (!candidates.length) return null
  const [first, ...rest] = [...candidates].sort((a,b) => precedence(a.rank,b.rank))
  const equal = [first, ...rest.filter(item => precedence(item.rank,first.rank) === 0)]
  const name = chooseSpace([...new Set(equal.map(item => item.name))],roll,label)
  const matching = equal.filter(item => item.name === name)
  if (matching.length === 1) return matching[0]
  const indices = matching.map((_,index) => String(index))
  return matching[Number(chooseSpace(indices,roll,label+' · choice'))]
}
const fortsIn = (state, names) => sum(names.map(name => state.land[name].sites.filter(site => site?.piece === 'fort').length))
const recruitMilitia = state => state.markers[4] ? 2 : 1
const blueStronghold = space => hasStronghold(space,['c'])
const duxFriendly = (state, name) => friendlyControl(state,name,'d')
const native = (state, name, faction) => piecesByOwner(state.land[name])[faction]

const localOrAdjacent = name => [name,...BY_NAME[name].adj]
const ownedStrongholds = (space,faction) => space.sites.filter(site => site && toOwner(site.piece,site.employer) === faction)
const nativeSettlements = (space,faction) => space.sites.filter(site => site?.piece === faction+'s' && !site.employer).length
const hasSettleMajority = (space,faction) => {
  const counts = piecesByOwner(space)
  return counts[faction]*2 > sum(Object.values(counts))
}
const availableSite = (space,name,wanted) => {
  const preferred = BY_NAME[name].sites.findIndex((slot,i) => slot.type === wanted && !space.sites[i])
  return preferred < 0 ? space.sites.indexOf(null) : preferred
}
const populationCeiling = (state,name) => printedPopulation(state,name) + Number(BY_NAME[name].terrain !== 'City')
const effectiveMarker = (state,id,side,faction) => state.markers[id]?.side === side &&
  (!faction || state.markers[id].faction === faction)

function removeUnloadedFirst(space,key,amount) {
  const number = Math.min(amount,on(space,key))
  space.units[key][0] -= number
  space.units[key][1] = Math.min(space.units[key][1],space.units[key][0])
}

function settlementChange(state,name,faction,retainingControl) {
  let space = state.land[name]
  const band = faction+'w'
  const holding = faction+'s'
  const settlements = nativeSettlements(space,faction)
  const preferred = availableSite(space,name,'T')
  const saxon = faction === 'x'
  const notes = []
  const attempt = (number,change,description) => {
    const before = clone(space)
    removeUnloadedFirst(space,band,number)
    change()
    const remaining = on(space,band)
    const succeeds = !retainingControl ||
      (control(state,name) === faction && remaining >= (saxon ? 2 : 1) * nativeSettlements(space,faction))
    if (!succeeds) {
      state.land[name] = before
      space = before
      return false
    }
    notes.push(description)
    return true
  }
  // Test these separately so a failed increase does not undo a legal Settlement.
  if (preferred >= 0 && availability(state)[holding] > 0 && on(space,band) >= (saxon ? 4 : 3)) {
    if (attempt(2,() => { space.sites[preferred] = {piece:holding,employer:null} },'place one Settlement')) {
      if (!saxon) return notes
    }
  }
  const updated = state.land[name]
  if (saxon && BY_NAME[name].terrain !== 'City' && updated.pop < populationCeiling(state,name) &&
      on(updated,band) >= 3 + 2 * nativeSettlements(updated,faction)) {
    const old = clone(updated)
    removeUnloadedFirst(updated,band,3)
    updated.pop++
    if (control(state,name) === faction) notes.push('increase Population by one')
    else state.land[name] = old
  }
  if (notes.length) return notes
  return []
}

function buySettledWarbands(state,name,faction,controlledAtOutset) {
  const space = state.land[name]
  const count = nativeSettlements(space,faction)
  if (!count || state.tracks[faction] < 3) return 0
  const number = Math.min(availability(state)[faction+'w'],count + (controlledAtOutset ? space.pop : 0))
  if (number < (faction === 'x' ? 2 : 1)) return 0
  state.tracks[faction] -= 3
  space.units[faction+'w'][0] += number
  return number
}

function doEntreat(state,roll) {
  if (state.tracks.s < 4) return null
  const pools = availability(state)
  const names = REGIONS.filter(({name,terrain}) => {
    const space = state.land[name]
    return terrain === 'Hills' && on(space,'sw') && (space.sites.some(site => site?.piece === 'hill') || (pools.sw && on(space,'mil')))
  }).map(region => region.name)
  const name = chooseSpace(names,roll,'Scotti Entreat')
  if (!name) return null
  const space = state.land[name]
  const slot = space.sites.findIndex(site => site?.piece === 'hill')
  const militia = Math.min(2,on(space,'mil'))
  if (slot >= 0) space.sites[slot] = pools.ss ? {piece:'ss',employer:null} : null
  removeUnloadedFirst(space,'mil',militia)
  const warbands = Math.min(militia,pools.sw)
  space.units.sw[0] += warbands
  state.tracks.s -= 4
  return `${name} · Entreat removes ${slot >= 0 ? 'one Hillfort and ' : ''}${militia} Militia; adds ${slot >= 0 && pools.ss ? 'one Settlement and ' : ''}${warbands} Warbands.`
}

export function barbarianReturn(state,faction,roll,{allowedFeat = true, oneSpace = false, forSettle = false} = {}) {
  const raider = faction+'r'
  const band = faction+'w'
  const eligibleReturn = REGIONS.filter(({name}) => {
    const space = state.land[name]
    return on(space,raider) || on(space,band)
  }).map(r => r.name)
  const baseReturn = eligibleReturn.filter(name => {
    const space = state.land[name]
    return loaded(space,raider) || (BY_NAME[name].terrain === 'Clear' && on(space,raider))
  })
  const returnedFrom = new Set()
  if (oneSpace && (baseReturn.length || eligibleReturn.length)) {
    const chosen = pickBest((baseReturn.length ? baseReturn : eligibleReturn).map(name => ({
      name,rank:[loaded(state.land[name],raider)+loaded(state.land[name],band)],
    })),roll,`${NAMES[faction]} Limited Return`)
    returnedFrom.add(chosen.name)
  } else {
    for (const name of baseReturn) returnedFrom.add(name)
  }
  const choices = []
  const counted = new Set()
  const limit = settleSpaceLimit(state,faction)
  const controlledAtOutset = new Set(REGIONS.filter(({name}) => control(state,name) === faction).map(r => r.name))
  if (allowedFeat) {
    for (let round = 0; round < limit; round++) {
      const candidates = REGIONS.filter(({name}) => !choices.some(choice => choice.name === name)).flatMap(({name,terrain}) => {
        const space = state.land[name]
        if (!hasSettleMajority(space,faction)) return []
        const raiderOrigins = localOrAdjacent(name).filter(source => !counted.has(source) && on(state.land[source],raider) && (!oneSpace || returnedFrom.has(source)))
        const raiders = sum(raiderOrigins.map(source => on(state.land[source],raider)))
        const expectedReturn = new Set([...returnedFrom,...raiderOrigins])
        const possibleRenown = sum([...expectedReturn].map(source => loaded(state.land[source],raider) + loaded(state.land[source],band)))
        const estimate = clone(state)
        changeTrack(estimate,faction,possibleRenown)
        const improves = settlementChange(estimate,name,faction,faction === 'x').length > 0 ||
          buySettledWarbands(estimate,name,faction,controlledAtOutset.has(name)) > 0
        const mayConvert = !forSettle && raiders && availability(state)[band] > 0
        if (!improves && !mayConvert) return []
        const improvement = (control(estimate,name) === faction ? estimate.land[name].pop : 0) -
          (controlledAtOutset.has(name) ? space.pop : 0)
        const preferredTerrain = terrain === (faction === 'x' ? 'Fens' : 'Hills')
        const rank = faction === 'x'
          ? [+improves,improves ? improvement : 0,raiders,+preferredTerrain]
          : [raiders,+preferredTerrain,+(space.sites.includes(null) || nativeSettlements(space,faction) > 0)]
        return [{name,rank,raiderOrigins,raiders}]
      })
      const choice = pickBest(candidates,roll,`${NAMES[faction]} Settle target`)
      if (!choice) break
      choices.push(choice)
      for (const name of choice.raiderOrigins) {
        counted.add(name)
        returnedFrom.add(name)
      }
    }
  }
  if (!returnedFrom.size && choices.length) {
    const wars = eligibleReturn.filter(name => on(state.land[name],band) || on(state.land[name],raider))
    if (wars.length) returnedFrom.add(wars.includes(choices[0].name) ? choices[0].name : chooseSpace(wars,roll,'Return with Settle'))
  }
  if (!returnedFrom.size && eligibleReturn.length && (!forSettle && eligibleReturn.some(name => loaded(state.land[name],band)))) {
    const name = pickBest(eligibleReturn.filter(n => loaded(state.land[n],band)).map(n => ({name:n,rank:[loaded(state.land[n],band)]})),roll,'Return carrying Warbands').name
    returnedFrom.add(name)
  }
  if (!returnedFrom.size) return null
  const notes = []
  for (const name of returnedFrom) {
    const space = state.land[name]
    const count = on(space,raider)
    const cargo = loaded(space,raider) + loaded(space,band)
    space.units[raider] = [0,0]
    space.units[band][1] = 0
    changeTrack(state,faction,cargo)
    notes.push(`${name} · ${count} Raiders return, +${cargo} Renown`)
  }
  let addedBySettle = false
  for (const choice of choices) {
    const {name,raiders} = choice
    const space = state.land[name]
    const threshold = faction === 'x' ? 4 : 5
    let converted = 0
    for (let i = 0; i < raiders; i++) {
      const success = roll(6,`Settle · ${name}, Raider ${i+1}`) >= threshold
      if (success && availability(state)[band] > 0) {
        space.units[band][0]++
        converted++
      }
    }
    if (raiders) notes.push(`${name} · ${converted} of ${raiders} Raiders become Warbands`)
    const changes = settlementChange(state,name,faction,faction === 'x')
    if (changes.length) notes.push(`${name} · ${changes.join(', ')}`)
    const bought = changes.length ? 0 : buySettledWarbands(state,name,faction,controlledAtOutset.has(name))
    if (bought) notes.push(`${name} · pay 3 Renown for ${bought} Warbands`)
    addedBySettle ||= converted > 0 || changes.length > 0 || bought > 0
  }
  if (addedBySettle || (faction === 's' && choices.length)) return {feat:'Settle',notes}
  const entreat = allowedFeat && faction === 's' && doEntreat(state,roll)
  if (entreat) notes.push(entreat)
  return {feat:entreat ? 'Entreat' : null,notes}
}

function friendlyPieceLead(state, name, faction) {
  const counts = piecesByOwner(state.land[name])
  const otherBriton = faction === 'd' ? 'c' : 'd'
  const friendly = counts[faction] + (isFragmentation(state) ? 0 : counts[otherBriton])
  return friendly * 2 > sum(Object.values(counts))
}
const civGroups = ['com','cxw','csw','mil']
const duxGroups = ['cav','dxw','dsw']
const poolOf = (state,faction,blueConsent = false) => faction === 'c' ? state.tracks.blue + state.tracks.wealth : duxFunds(state,blueConsent)
function stackingGain(state,name,owner,mutate) {
  if (friendlyControl(state,name,owner)) return 0
  const space = clone(state.land[name])
  mutate(space)
  const projected = {...state,land:{...state.land,[name]:space}}
  return friendlyControl(projected,name,owner) ? space.pop : 0
}
function civMusterCandidates(state, chosen, phase) {
  const avail = availability(state)
  return REGIONS.filter(({name}) => !chosen.has(name) && native(state,name,'c') && poolOf(state,'c') >= 2).flatMap(({name,terrain,sites}) => {
    const space = state.land[name]
    if (phase === 'hill') {
      const slot = availableSite(space,name,'H')
      if (terrain === 'City' || !avail.hill || slot < 0 || !on(space,'mil') || !friendlyPieceLead(state,name,'c')) return []
      const gain = stackingGain(state,name,'c',target => { target.sites[slot] = {piece:'hill',employer:null}; removeUnloadedFirst(target,'mil',1) })
      return gain > 0 ? [{name,slot,rank:[gain]}] : []
    }
    if (phase === 'troops') {
      const capacity = civitatesMusterCapacity(state,name)
      // Reserve Wealth needed to cover the 2-Resource entry cost.
      const comitates = Math.min(avail.com,Math.max(0,state.tracks.wealth-Math.max(0,2-state.tracks.blue)),capacity)
      const militia = state.tracks.blue >= 2 ? Math.min(avail.mil,(capacity-comitates)*recruitMilitia(state)) : 0
      if (!comitates && !militia) return []
      const gain = stackingGain(state,name,'c',target => { target.units.com[0] += comitates; target.units.mil[0] += militia })
      return [{name,comitates,militia,rank:[comitates,militia,gain]}]
    }
    if (!avail.town || countStrongholds(state,'town') >= 6 || !friendlyPieceLead(state,name,'c') ||
        state.tracks.wealth - Math.max(0,2-state.tracks.blue) < 2) return []
    const vacant = sites.findIndex((site,index) => site.type === 'T' && !space.sites[index])
    const hill = space.sites.findIndex((site,index) => site?.piece === 'hill' && (vacant >= 0 || sites[index].type === 'T'))
    const militiaOnly = on(space,'mil') >= 2 && vacant >= 0
    if (!militiaOnly && (hill < 0 || !on(space,'mil'))) return []
    const choice = {name,slot:vacant >= 0 ? vacant : hill,hill:militiaOnly ? -1 : hill,rank:[+militiaOnly]}
    return [{...choice,gain:stackingGain(state,name,'c',target => placeMusterTown(target,choice))}]
  })
}
function placeMusterTown(space,{slot,hill}) {
  removeUnloadedFirst(space,'mil',hill < 0 ? 2 : 1)
  if (hill >= 0) space.sites[hill] = null
  space.sites[slot] = {piece:'town',employer:null}
}
function civMusterImprovesControl(state) {
  const chosen = new Set()
  if (civMusterCandidates(state,chosen,'hill').length) return true
  return civMusterCandidates(state,chosen,'troops').some(choice => choice.rank[2] > 0) ||
    civMusterCandidates(state,chosen,'town').some(choice => choice.gain > 0)
}
export function civitatesMuster(state,roll,{oneSpace = false} = {}) {
  const notes = []
  const chosen = new Set()
  for (const phase of ['hill','troops','town']) {
    while (!oneSpace || !chosen.size) {
      const pick = pickBest(civMusterCandidates(state,chosen,phase),roll,`Civitates Muster · ${phase}`)
      if (!pick) break
      const space = state.land[pick.name]
      chosen.add(pick.name)
      spendCivitates(state,2)
      if (phase === 'hill') {
        removeUnloadedFirst(space,'mil',1)
        space.sites[pick.slot] = {piece:'hill',employer:null}
        notes.push(`${pick.name} · one Militia becomes a Hillfort`)
      }
      if (phase === 'troops') {
        state.tracks.wealth -= pick.comitates
        space.units.com[0] += pick.comitates
        space.units.mil[0] += pick.militia
        notes.push(`${pick.name} · +${pick.comitates} Comitates and +${pick.militia} Militia`)
      }
      if (phase === 'town') {
        state.tracks.wealth -= 2
        placeMusterTown(space,pick)
        notes.push(`${pick.name} · build one Town`)
      }
    }
  }
  return notes
}

function enemyControlOwner(id,faction) {
  return Boolean(id && id !== faction && !(id === 'b' && ['c','d'].includes(faction)))
}
function ownsControlId(id,faction) {
  return id === faction || (id === 'b' && ['d','c'].includes(faction))
}
function shiftUnits(state,origin,to,key,count) {
  if (!count) return
  const from = state.land[origin]
  const dest = state.land[to]
  const cargo = Math.max(0,count-(on(from,key)-loaded(from,key)))
  from.units[key][0] -= count
  from.units[key][1] -= cargo
  dest.units[key][0] += count
  dest.units[key][1] += cargo
}
function removalLosesControl(state,name,faction,groups) {
  const start = control(state,name)
  const board = state.land[name]
  const displaced = clone(board)
  for (const [key,count] of Object.entries(groups)) removeUnloadedFirst(board,key,count)
  const end = control(state,name)
  state.land[name] = displaced
  return (ownsControlId(start,faction) && start !== end) || (!start && enemyControlOwner(end,faction))
}
function majorityControlAfter(state,name,faction,band,arrivals) {
  const before = state.land[name]
  const copy = clone(before)
  before.units[band][0] += arrivals
  const result = control(state,name)
  state.land[name] = copy
  return result
}
function threateningHumanControl(state,owner) {
  const margins = shieldsOf(state)
  const ranks = scores(state)
  return (state.humans || [state.human]).some(faction => ownsControlId(owner,faction) &&
    (margins[faction] ?? ranks[faction].margin) > 0)
}
function couldPlaceSettlement(state,name,faction,arrivals) {
  const space = clone(state.land[name])
  space.units[faction+'w'][0] += arrivals
  if (!hasSettleMajority(space,faction)) return false
  const projected = {...state,land:{...state.land,[name]:space}}
  return settlementChange(projected,name,faction,true).includes('place one Settlement')
}
function barbarianMarchChoices(state,faction,unmoved,seaUsed,canSettleAfter) {
  const band = faction+'w'
  const saxon = faction === 'x'
  const candidates = []
  for (const {name,terrain,adj,seas} of REGIONS) {
    if (terrain === 'City') continue
    const space = state.land[name]
    const sources = []
    for (const [region,n] of Object.entries(unmoved)) {
      if (!n || region === name) continue
      const sharedSea = seas.some(sea => BY_NAME[region].seas.includes(sea))
      const bySea = !adj.includes(region)
      if (bySea && (!sharedSea || seaUsed || fortsIn(state,[name]))) continue
      let count = Math.min(n,on(state.land[region],band)-(saxon ? 2 : 1)*nativeSettlements(state.land[region],faction))
      for (;count > 0;count--) {
        if (!removalLosesControl(state,region,faction,{[band]:count})) break
      }
      if (count > 0) sources.push({region,count,bySea})
    }
    if (!sources.length) continue
    const old = control(state,name)
    const hostile = enemyTroops(state,name,faction)
    const nativeUnits = piecesByOwner(space,{strongholds:false})[faction]
    const counts = piecesByOwner(space,{strongholds:false})
    const otherUnits = sum(Object.values(counts)) - nativeUnits
    const need = saxon ? hostile+4-on(space,band) : Math.max(1,otherUnits-nativeUnits+1)
    if (need <= 0) continue
    const byLand = sources.filter(src => !src.bySea)
    const adjacentCount = sum(byLand.map(source => source.count))
    const naval = sources.filter(src => src.bySea && adjacentCount+src.count >= need)
    const usingSea = adjacentCount < need
    if (usingSea && (!naval.length || state.tracks[faction] < 2)) continue
    const extra = usingSea ? Math.max(...naval.map(src => src.count)) : 0
    const amount = saxon ? need : adjacentCount+extra
    const end = majorityControlAfter(state,name,faction,band,amount)
    const removed = enemyControlOwner(old,faction) && old !== end
    if (!removed) {
      const enablesSettlement = canSettleAfter && space.sites.includes(null) &&
        couldPlaceSettlement(state,name,faction,amount) && !couldPlaceSettlement(state,name,faction,0)
      if (!enablesSettlement) continue
    }
    candidates.push({
      name,stock:sources,usingSea,need,amount,
      rank:[removed && threateningHumanControl(state,old) ? space.pop : 0,+(terrain === (saxon ? 'Fens' : 'Hills'))],
    })
  }
  return candidates
}
function controlledAt(state,name,faction) { return control(state,name) === faction }

function settleWithoutReturnChoices(state,faction,needSettlement,selected) {
  const candidates = []
  for (const {name,terrain} of REGIONS) {
    const before = state.land[name]
    if (selected?.has(name) || !hasSettleMajority(before,faction)) continue
    const estimate = clone(state)
    const change = settlementChange(estimate,name,faction,true)
    if (needSettlement && !change.includes('place one Settlement')) continue
    const controlled = controlledAt(state,name,faction)
    const bought = change.length ? 0 : buySettledWarbands(estimate,name,faction,controlled)
    if (!change.length && !bought) continue
    const newControl = controlledAt(estimate,name,faction)
    candidates.push({
      name,controlled,kind:change.length ? 'change' : 'purchase',
      rank:faction === 'x' ? [(newControl ? estimate.land[name].pop : 0) - (controlled ? before.pop : 0),+(terrain === 'Fens')]
        : [+change.includes('place one Settlement'),bought,+(terrain === 'Hills')],
    })
  }
  return candidates
}
function settleWithoutReturn(state,faction,roll,needSettlement = false) {
  const selected = new Set()
  const notes = []
  while (selected.size < settleSpaceLimit(state,faction)) {
    const candidates = settleWithoutReturnChoices(state,faction,needSettlement,selected)
    const pick = pickBest(candidates,roll,`${NAMES[faction]} Settle target`)
    if (!pick) break
    const {name,kind,controlled} = pick
    selected.add(name)
    if (kind === 'change') {
      notes.push(name+' · '+settlementChange(state,name,faction,true).join(', '))
    } else {
      const count = buySettledWarbands(state,name,faction,controlled)
      notes.push(`${name} · pay 3 Renown to place ${count} Warbands`)
    }
  }
  return notes
}
function marchBarbarianWarbands(draft,faction,roll,{oneSpace,canSettleAfter}) {
  const band = faction+'w'
  const saxon = faction === 'x'
  const available = Object.fromEntries(REGIONS.map(({name}) => [name,on(draft.land[name],band)]))
  const notes = []
  const usedDestinations = new Set()
  let usedSea = false
  while (draft.tracks[faction] > 0 && (!oneSpace || !usedDestinations.size)) {
    const candidates = barbarianMarchChoices(draft,faction,available,usedSea,canSettleAfter)
      .filter(candidate => !usedDestinations.has(candidate.name))
    const movable = pickBest(candidates,roll,`${NAMES[faction]} March destination`)
    if (!movable) break
    let origins = movable.stock.filter(src => !src.bySea)
    if (movable.usingSea) {
      const needed = movable.need-sum(origins.map(src => src.count))
      const boats = movable.stock.filter(src => src.bySea && src.count >= needed)
      const best = Math.max(...boats.map(src => src.count))
      const boat = chooseSpace(boats.filter(src => src.count === best).map(src => src.region),roll,'March sea origin')
      const landing = boats.find(src => src.region === boat)
      const number = saxon ? needed : landing.count
      shiftUnits(draft,landing.region,movable.name,band,number)
      available[landing.region] -= number
      movable.amount -= number
      notes.push(`${landing.region} → ${movable.name} · ${number} Warbands by sea`)
      usedSea = true
    }
    let needed = movable.amount
    while (origins.length && needed > 0) {
      const name = chooseSpace(origins.map(src => src.region),roll,`${NAMES[faction]} March origin`)
      const origin = origins.find(src => src.region === name)
      const moving = Math.min(origin.count,needed)
      shiftUnits(draft,origin.region,movable.name,band,moving)
      available[origin.region] -= moving
      needed -= moving
      origins = origins.filter(src => src.region !== name)
      notes.push(`${name} → ${movable.name} · ${moving} Warbands${origin.bySea ? ' by sea' : ''}`)
    }
    usedDestinations.add(movable.name)
    draft.tracks[faction] -= movable.usingSea ? 2 : 1
  }
  return notes
}
function planBarbarianMarch(state,faction,roll,{oneSpace,allowedFeat}) {
  if (allowedFeat) {
    // A Settle before March is provisional until Warbands can still move.
    const settled = clone(state)
    const settling = settleWithoutReturn(settled,faction,roll,faction === 's')
    if (settling.length) {
      const march = marchBarbarianWarbands(settled,faction,roll,{oneSpace,canSettleAfter:false})
      if (march.length) {
        return {state:settled,title:'March + Settle',desc:[...settling,...march].join('. '),feat:'Settle'}
      }
    }
  }
  const draft = clone(state)
  const march = marchBarbarianWarbands(draft,faction,roll,{oneSpace,canSettleAfter:allowedFeat})
  if (!march.length) return null
  const settling = allowedFeat ? settleWithoutReturn(draft,faction,roll) : []
  return {
    state:draft,title:settling.length ? 'March + Settle' : 'March',
    desc:[...march,...settling].join('. '),feat:settling.length ? 'Settle' : null,
  }
}

const isBritonFaction = faction => faction === 'd' || faction === 'c'
function defenderSides(state,attacker,defender) {
  if (isFragmentation(state) || isBritonFaction(attacker) === isBritonFaction(defender)) return [defender]
  return isBritonFaction(defender) ? ['d','c'] : [defender]
}
function opponentRank(state,attacker,defender) {
  const side = defenderSides(state,attacker,defender)
  const margins = scores(state)
  const edges = shieldsOf(state)
  return [Number(side.some(faction => botHasHuman(state,faction))),Math.max(...side.map(faction => edges[faction] ?? margins[faction].margin))]
}
function saxonBattleGoal(outcome,{count,mayEvade}) {
  return outcome.destroyed.length > 0 ||
    (count > 0 && !mayEvade && outcome.defenderLosses-outcome.destroyed.length >= count)
}
function reinforceFormation(space,allies) {
  const order = [
    allies ? ['cav'] : [],
    ['com'],
    allies ? ['dxw','dsw','cxw','csw'] : ['cxw','csw'],
    ['mil'],
  ]
  const troops = []
  let remaining = 4 // The most that D6 minus two can move.
  for (const groups of order) {
    for (const carrying of [false,true]) {
      for (const key of groups) {
        const stock = carrying ? loaded(space,key) : on(space,key)-loaded(space,key)
        const count = Math.min(stock,remaining)
        if (!count) continue
        troops.push({key,count,cargo:carrying ? count : 0})
        remaining -= count
        if (!remaining) return troops
      }
    }
  }
  return troops
}
function adjacentReinforce(state,requests,roll,reinforceConsent) {
  if (state.tracks.blue < 2) return null
  const battleSpaces = requests.map(request => request.name)
  const candidates = []
  for (const request of requests) {
    const destination = request.name
    const allies = !isFragmentation(state) && request.defender !== 'd' &&
      (!botHasHuman(state,'d') || reinforceConsent !== false)
    const origins = BY_NAME[destination].adj.filter(name =>
      !battleSpaces.includes(name) && friendlyControl(state,name,'c'))
    if (!origins.length) continue
    const losses = battleForecast(state,request).defenderLosses
    for (const name of origins) {
      const troops = reinforceFormation(state.land[name],allies)
      if (!troops.length) continue
      // Give the Feat calculator an ordered formation so a low roll moves
      // unloaded Troops of the same type before those carrying Plunder.
      const formation = destination+' '+troops.map(({key,count,cargo}) => `${key}=${count}:${cargo}`).join(' ')
      const spec = {
        faction:'c',command:'Battle',feat:'Reinforce',battleSpaces,
        input:{wealthSpend:0,alliedConsent:allies},
        rows:[{space:name,mode:'move',formation}],
      }
      const estimate = clone(state)
      runCommandFeat(estimate,spec,() => 6)
      if (battleForecast(estimate,request).defenderLosses > losses) {
        candidates.push({name,destination,spec,usesDux:troops.some(({key}) => duxGroups.includes(key)),rank:[]})
      }
    }
  }
  return pickBest(candidates,roll,'Civitates Reinforce origin')
}
function policyBattleRequests(state,faction,{oneSpace,allowedFeat,onlySpace,enemyFilter,requireDestruction = false,interceptBattles,reinforceConsent},roll) {
  const candidates = []
  const militiaRoll = () => roll(6,'Civitates Battle · Plunder threshold')
  let lootThreshold
  for (const name of battleTargets(state,faction)) {
    if (onlySpace && name !== onlySpace) continue
    const space = state.land[name]
    const targets = []
    for (const defender of battleEnemies(state,name,faction)) {
      if (enemyFilter && !enemyFilter(defender)) continue
      const civ = faction === 'c'
      const dux = faction === 'd'
      const scotti = faction === 's'
      const beforeFrag = !isFragmentation(state)
      const civilWar = isBritonFaction(faction) && isBritonFaction(defender) && beforeFrag
      if (civilWar && !botHasHuman(state,defender)) continue
      if (civilWar && dux && (!friendlyControl(state,name,'c') || hasStronghold(space,['d']) ||
          (shieldsOf(state).c <= 0 && state.tracks.wealth-state.tracks.prestige < 5))) continue
      if (civilWar && civ && shieldsOf(state).d <= 0) continue
      const request = {name,attacker:faction,defender,source:'Battle'}
      const sides = defenderSides(state,faction,defender)
      const units = piecesByOwner(space,{strongholds:false})
      const count = sum(sides.map(side => units[side]))
      const whenFeasible = ({retaliate = false,surprise = false,assumeCoup = false} = {}) => battleForecast(state,{...request,retaliate,surprise,assumeCoup})
      const outcome = whenFeasible(allowedFeat && dux && (!civilWar || !beforeFrag) ? {retaliate:true} : {})
      const pureOutcome = allowedFeat && dux && (!civilWar || !beforeFrag) ? whenFeasible() : outcome
      if (requireDestruction && !outcome.destroyed.length) continue
      const hitFort = outcome.destroyed.some(index => space.sites[index]?.piece === 'fort')
      const cargo = sum([...(civ ? civGroups : duxGroups),...(beforeFrag ? civ ? duxGroups : civGroups : [])].map(key => loaded(space,key)))
      const plunder = Math.max(0,outcome.attackerPlunder-cargo)
      const canTakePlunder = plunder > 0 || outcome.defenderPlunderRemoved > 0
      const sideWins = Boolean(outcome.controlAfter && ownsControlId(outcome.controlAfter,faction) && !friendlyControl(state,name,faction))
      const possibleRaiders = ['xr','sr'].some(key => sides.includes(key[0]) && on(space,key))
      const mayEvade = !civ && !dux && possibleRaiders
      let want = false
      if (dux) want = civilWar || outcome.prestigeChange > 0 || canTakePlunder ||
        interceptBattles?.some(target => target.name === name && target.defender === defender)
      let opensCivitatesBattle = false
      if (civ) {
        // The check ignores Ambush and Evasion. Withdrawal remains a legitimate defence.
        if (plunder > 0 && lootThreshold === undefined) lootThreshold = militiaRoll()
        opensCivitatesBattle = !civilWar && (sideWins || (lootThreshold !== undefined && plunder > lootThreshold))
        want = civilWar ? hitFort : sideWins || canTakePlunder
      }
      if (scotti) {
        const ambush = BY_NAME[name].terrain === 'Hills' && !effectiveMarker(state,56,'unshaded')
        const trap = BY_NAME[name].terrain === 'Hills' && on(space,'sw') && effectiveMarker(state,56,'shaded')
        const coup = allowedFeat && (outcome.destroyed.length || whenFeasible({surprise:true,assumeCoup:true}).destroyed.length)
        want = ambush || trap || outcome.destroyed.length > 0 || Boolean(coup)
      }
      if (faction === 'x') {
        const coup = allowedFeat && whenFeasible({surprise:true,assumeCoup:true}).destroyed.length
        want = saxonBattleGoal(outcome,{count,mayEvade}) || Boolean(coup)
      }
      if (!want) continue
      const [player,margin] = opponentRank(state,faction,defender)
      const rank = civ || dux ? [+civilWar,margin,player] : [player,margin]
      targets.push({request,outcome,pureOutcome,rank,opensCivitatesBattle,count,mayEvade})
    }
    if (targets.length) candidates.push(targets.sort((a,b) => precedence(a.rank,b.rank))[0])
  }
  // Dux does not start a Battle solely for civil-war movement. Civitates civil war
  // is an additional target after the ordinary Control/Plunder condition is met.
  if (faction === 'd' && !interceptBattles && !candidates.some(item => item.outcome.prestigeChange > 0)) return null
  if (faction === 'c' && !candidates.some(item => item.opensCivitatesBattle)) return null
  if (!candidates.length) return null
  const queue = []
  while (candidates.length && (!oneSpace || !queue.length)) {
    const pick = pickBest(candidates.map(choice => ({...choice,name:choice.request.name})),roll,`${NAMES[faction]} Battle target`)
    queue.push(pick)
    candidates.splice(candidates.findIndex(c => c.request.name === pick.request.name),1)
  }
  const requests = queue.map(target => target.request)
  const notes = [requests.map(request => `${request.name} against ${NAMES[request.defender]}`).join('; ')]
  let feat
  if (allowedFeat && faction === 'd') {
    const targets = queue.filter(({outcome,request}) => outcome.destroyed.length && (request.defender !== 'c' || isFragmentation(state)))
    if (targets.length) {
      targets[0].request.retaliate = true
      feat = 'Retaliate'
    } else {
      const note = duxRequisition(state)
      if (note) {
        notes.push(note)
        feat = 'Requisition'
      }
    }
  }
  if (allowedFeat && faction === 's') {
    const note = doEntreat(state,roll)
    if (note) {
      for (let i = requests.length-1; i >= 0; i--) {
        const {name,defender,source} = requests[i]
        if (!battleEnemies(state,name,faction,source).includes(defender)) requests.splice(i,1)
      }
      if (!requests.length) return null
      notes[0] = requests.map(request => `${request.name} against ${NAMES[request.defender]}`).join('; ')
      notes.push(note)
      feat = 'Entreat'
    } else {
      const surprise = queue.find(({request,outcome}) => {
        const coup = battleForecast(state,{...request,surprise:true,assumeCoup:true})
        return coup.destroyed.length && (coup.destroyed.length > outcome.destroyed.length || coup.attackerLosses < outcome.attackerLosses)
      })
      if (surprise) {
        surprise.request.surprise = true
        feat = 'Surprise'
      } else if (requests.some(({name}) => ransomPayer(state,name))) {
        for (const request of requests) {
          const payer = ransomPayer(state,request.name)
          if (payer && ransoms(state,request.name,roll)) {
            changeTrack(state,payer,-1)
            changeTrack(state,'s',1)
            notes.push(request.name+' · Ransom succeeds')
          }
        }
        feat = 'Ransom'
      }
    }
  }
  if (allowedFeat && faction === 'x') {
    const withWall = queue.map(({request}) => battleForecast(state,{...request,shieldWall:true}))
    const smallerWithWall = queue.some((target,index) => {
      const {name,defender} = target.request
      const room = sum(defenderSides(state,'x',defender).flatMap(side =>
        ownedStrongholds(state.land[name],side).map(site => withdrawalCapacity(state,name,site.piece))))
      return target.count > room && withWall[index].attackerLosses < target.outcome.attackerLosses && saxonBattleGoal(withWall[index],target)
    })
    let keep
    if (smallerWithWall) {
      for (const request of requests) request.shieldWall = true
      feat = 'Shield Wall'
      keep = (target,index) => saxonBattleGoal(withWall[index],target)
    } else {
      const ravageSpaces = new Set(ravageChoices(state,requests,faction,roll,{battle:true}))
      const ravaging = queue.filter(target => ravageSpaces.has(target.request.name) &&
        saxonBattleGoal(battleForecast(state,{...target.request,ravage:true}),target))
      if (ravaging.length) {
        for (const {request} of ravaging) request.ravage = true
        feat = 'Ravage'
        keep = target => target.request.ravage || saxonBattleGoal(target.outcome,target)
      } else {
        const exposed = pickBest(queue.filter(({request}) => hasStronghold(state.land[request.name],defenderSides(state,faction,request.defender))).map(({request}) => ({
          name:request.name,rank:[-enemyTroops(state,request.name,faction)],request,
        })),roll,'Saxon Surprise · Battle with a Stronghold')
        if (exposed) {
          exposed.request.surprise = true
          feat = 'Surprise'
        }
        keep = target => target.request.surprise || saxonBattleGoal(target.outcome,target)
      }
    }
    requests.splice(0,requests.length,...queue.filter(keep).map(target => target.request))
    if (!requests.length) return null
    notes[0] = requests.map(request => `${request.name} against ${NAMES[request.defender]}`).join('; ')
  }
  if (allowedFeat && faction === 'c') {
    const booty = applyCivitatesPillage(state,roll)
    if (booty.length) {
      notes.push(...booty)
      feat = 'Pillage'
    } else {
      for (const {request,outcome} of queue) {
        if (state.tracks.blue < 2) break
        const count = Math.min(availability(state).mil,civitatesMusterCapacity(state,request.name)*recruitMilitia(state))
        if (count <= 0) continue
        const testing = clone(state)
        testing.land[request.name].units.mil[0] += count
        if (battleForecast(testing,request).defenderLosses <= outcome.defenderLosses) continue
        state.tracks.blue -= 2
        state.land[request.name].units.mil[0] += count
        notes.push(`${request.name} · pay 2 Resources to muster ${count} reinforcing Militia`)
        feat = 'Reinforce'
      }
      const move = adjacentReinforce(state,requests,roll,reinforceConsent)
      if (move) {
        if (move.usesDux && botHasHuman(state,'d') && typeof reinforceConsent !== 'boolean') {
          return {consent:{
            mode:'consent',faction,title:'Reinforce',
            question:'Allow Civitates to move Dux Troops?',
            description:`Civitates can attempt to Reinforce the Battle in ${move.destination} with Troops from ${move.name} (§4.3.3).`,
            key:'reinforceConsent',
          }}
        }
        notes.push(`Reinforce toward ${move.destination}. ${runCommandFeat(state,move.spec,roll)}`)
        feat = 'Reinforce'
      }
    }
  }
  return {requests,feat,notes}
}
function applyCivitatesPillage(state,roll) {
  const changes = []
  for (const {name,terrain} of REGIONS) {
    if (terrain === 'City' || friendlyControl(state,name,'c')) continue
    const space = state.land[name]
    let room = space.pop
    let taken = 0
    for (const key of civGroups) {
      const pieces = plunderTo(space,key,room)
      room -= pieces
      taken += pieces
    }
    if (!taken) continue
    const enemy = [...new Set(space.sites.filter(Boolean).map(site => toOwner(site.piece,site.employer)))]
      .filter(side => side !== 'c' && (side !== 'd' || isFragmentation(state)))
      .filter(side => state.tracks[side === 'd' ? 'prestige' : side] > 0)
    if (enemy.length) {
      const value = side => Math.min(taken,state.tracks[side === 'd' ? 'prestige' : side])
      const max = Math.max(...enemy.map(value))
      const tied = enemy.filter(side => value(side) === max)
      const foe = tied.length === 1 ? tied[0] : chooseSpace(tied,roll,'Civitates Pillage · enemy')
      changeTrack(state,foe === 'd' ? 'prestige' : foe,-taken)
    }
    changes.push(`${name} · take ${taken} Plunder`)
  }
  return changes
}
function duxRequisition(state) {
  const qualified = REGIONS.filter(({name}) => native(state,name,'d') && blueStronghold(state.land[name])).length
  const moved = Math.min(6,qualified,80-state.tracks.red,state.tracks.blue+state.tracks.wealth)
  const blue = Math.min(moved,state.tracks.blue)
  state.tracks.blue -= blue
  state.tracks.wealth -= moved-blue
  let cargo = 0
  for (const space of Object.values(state.land)) {
    for (const key of duxGroups) {
      cargo += loaded(space,key)
      space.units[key][1] = 0
    }
  }
  changeTrack(state,'red',moved+cargo)
  return moved || cargo ? `Requisition ${moved+cargo} Dux Resources, including any stowed Plunder.` : null
}

const roadAdjacent = Object.fromEntries(REGIONS.map(({name}) => [name,ROADS.filter(road => road.includes(name)).map(road => road[0] === name ? road[1] : road[0])]))
function britonReachable(state,origin,owner,localOnly = false) {
  const reachable = new Set(BY_NAME[origin].adj)
  if (!state.roads || localOnly) return reachable
  const seen = new Set([origin])
  const queue = [origin]
  while (queue.length) {
    const head = queue.shift()
    for (const next of BY_NAME[head].adj) {
      reachable.add(next)
      if (roadAdjacent[head].includes(next) && friendlyControl(state,next,owner) && !seen.has(next)) {
        queue.push(next)
        seen.add(next)
      }
    }
  }
  reachable.delete(origin)
  return reachable
}
function marchReserve(state,name,faction,owners) {
  const holdings = sum(owners.map(owner => ownedStrongholds(state.land[name],owner).length))
  return (faction === 'd' ? 1 : 2)*holdings
}
function marchGroups(state,origin,to,faction,partners) {
  const space = state.land[origin]
  const owners = isFragmentation(state) ? [faction] : ['d','c']
  const keys = faction === 'd'
    ? (partners ? ['cav','dxw','dsw','cxw','csw','com','mil'] : duxGroups)
    : (partners ? ['mil','cav','com','dxw','dsw','cxw','csw'] : ['mil','com','cxw','csw'])
  const friendlyTroops = sum(owners.map(owner => piecesByOwner(space,{strongholds:false,raiders:false})[owner]))
  const budget = Math.max(0,friendlyTroops-marchReserve(state,origin,faction,owners))
  const adjacent = BY_NAME[origin].adj.includes(to)
  let count = 0
  const groups = {}
  for (const key of keys) {
    if (key === 'mil' && !adjacent) continue
    const possible = Math.min(on(space,key),budget-count)
    if (!possible) continue
    let n = possible
    if (faction === 'c' || isFragmentation(state)) {
      for (;n > 0;n--) {
        if (!removalLosesControl(state,origin,faction,{...groups,[key]:n})) break
      }
    }
    if (!n) continue
    groups[key] = n
    count += n
  }
  if (!(faction === 'c' ? civGroups : duxGroups).some(key => groups[key])) return null
  return {groups,count}
}
function planBritonMarch(state,faction,roll,{oneSpace,allowedFeat,blueConsent,free = false,costMultiplier = 1,targetLimit,targetFilter,targetRank}) {
  const dux = faction === 'd'
  const fee = free ? 0 : 2*costMultiplier
  const canSpend = () => dux ? duxFunds(draft,blueConsent) : draft.tracks.blue
  const startFunds = dux ? duxFunds(state,blueConsent) : state.tracks.blue
  if (startFunds < fee) return null
  const draft = clone(state)
  const notes = []
  let feat = null
  // §8.8.6 selects destinations after Invite has changed the position.
  if (dux && allowedFeat) {
    const invite = botInvite(draft,'d',roll,blueConsent)
    if (invite) {feat = 'Invite';notes.push(invite)}
  }
  if (canSpend() < fee) return null
  const shared = !isFragmentation(draft)
  const tension = dux && shared && botHasHuman(draft,'c') &&
    (draft.tracks.wealth > draft.tracks.prestige || shieldsOf(draft).c > 0)
  const scoresByFaction = scores(draft)
  const targets = REGIONS.flatMap(({name,terrain}) => {
    if (terrain === 'City' || targetFilter && !targetFilter(name)) return []
    const space = draft.land[name]
    const isCivil = tension && friendlyControl(draft,name,'c') && !hasStronghold(space,['d'])
    const threat = ['x','s',...(!shared ? [dux ? 'c' : 'd'] : [])]
    const enemy = threat.filter(side => native(draft,name,side))
    const strongEnemy = enemy.filter(side => hasStronghold(space,[side]))
    const priority = isCivil ? 3 : strongEnemy.length ? 2 : (!dux && !friendlyControl(draft,name,'c')) || enemy.length ? 1 : 0
    if (!priority) return []
    const priority2 = dux
      ? priority === 2 && strongEnemy.some(side => ['s','x'].includes(side) && draft.tracks[side] > 20)
        ? 3 : +(!friendlyControl(draft,name,'d'))
      : priority === 2 ? Math.max(...strongEnemy.map(side => scoresByFaction[side].margin)) : +(enemy.some(side => ['s','x'].includes(side)))
    return [{name,isCivil,enemy,rank:[...(targetRank?.(name) ?? []),priority,priority2]}]
  })
  if (!targets.length) return null
  const rolled = dux ? roll(4,'Dux March · space limit') : 4
  const destinationLimit = oneSpace ? 1 : Math.min(rolled,targetLimit ?? rolled)
  const originLimit = dux && !oneSpace ? rolled : destinationLimit
  const origins = REGIONS.filter(({name}) => (dux || friendlyControl(draft,name,'c')) &&
    (dux ? duxGroups : civGroups).some(key => on(draft.land[name],key))).map(r => r.name)
  const known = new Map(origins.map(name => [name,britonReachable(draft,name,faction)]))
  const sourcesUsed = new Set()
  const destinationsUsed = new Set()
  let strongDestination = null
  let currentDestination = null
  let seaUsed = false
  const priority = target => target.rank[target.rank.length-2]
  while (targets.length && sourcesUsed.size < originLimit && canSpend() >= fee) {
    const plans = targets.flatMap(target => {
      if (destinationsUsed.size >= destinationLimit && !destinationsUsed.has(target.name)) return []
      if (strongDestination && target.name !== strongDestination && priority(target) === 2 && !targetFilter) return []
      const plausible = origins.filter(name => !sourcesUsed.has(name) && !destinationsUsed.has(name) && name !== target.name).flatMap(name => {
        const bySea = !known.get(name).has(target.name) && dux && !seaUsed && effectiveMarker(draft,60,'unshaded') && BY_NAME[name].seas.length && BY_NAME[target.name].seas.length
        if (!known.get(name).has(target.name) && !bySea) return []
        const mayBringAlly = !isFragmentation(draft) && !target.isCivil && target.enemy.some(side => ['x','s'].includes(side)) &&
          !botHasHuman(state,dux ? 'c' : 'd') && !bySea
        const movement = marchGroups(draft,name,target.name,faction,mayBringAlly)
        return movement ? [{name,bySea,...movement}] : []
      })
      if (!plausible.length) return []
      if (dux) {
        const present = sum(duxGroups.map(key => on(draft.land[target.name],key)))
        const enemies = target.isCivil ? ['c'] : target.enemy
        const legal = battleEnemies(draft,target.name,'d')
        if (present && enemies.length && enemies.some(side => {
          if (!legal.includes(side)) return false
          const outcome = battleForecast(draft,{name:target.name,attacker:'d',defender:side,source:'Battle'})
          const count = piecesByOwner(draft.land[target.name],{strongholds:false})[side]
          return outcome.defenderLosses >= count+ownedStrongholds(draft.land[target.name],side).length
        })) return []
      }
      return [{...target,plausible}]
    })
    const target = plans.find(plan => plan.name === currentDestination) ?? pickBest(plans,roll,`${NAMES[faction]} March destination`)
    if (!target) break
    const selected = pickBest(target.plausible.map(source => ({...source,rank:[source.count]})),roll,`${NAMES[faction]} March origin`)
    // Dux brings more origins to this destination until its Battle objective is met.
    if (dux) currentDestination = target.name
    else targets.splice(targets.findIndex(option => option.name === target.name),1)
    if (priority(target) === 2) strongDestination = target.name
    if (dux) spendDux(draft,fee,blueConsent)
    else draft.tracks.blue -= fee
    for (const [key,count] of Object.entries(selected.groups)) shiftUnits(draft,selected.name,target.name,key,count)
    sourcesUsed.add(selected.name)
    destinationsUsed.add(target.name)
    seaUsed ||= Boolean(selected.bySea)
    notes.push(`${selected.name} → ${target.name} · ${selected.count} Troops${selected.bySea ? ' by sea' : ''}`)
  }
  if (!sourcesUsed.size) return null
  if (allowedFeat && !feat) {
    if (dux) {
      const construction = duxBuild(draft,roll,blueConsent)
      feat = construction.length ? 'Build' : null
      notes.push(...construction)
      if (!feat) {
        const requisition = duxRequisition(draft)
        if (requisition) {notes.push(requisition);feat = 'Requisition'}
      }
    } else {
      const plunder = applyCivitatesPillage(draft,roll)
      if (plunder.length) {notes.push(...plunder);feat = 'Pillage'}
      else {
        const ruling = civitatesRule(draft,roll)
        if (ruling.length) {notes.push(...ruling);feat = 'Rule'}
        else {
          const invite = botInvite(draft,'c',roll)
          if (invite) {notes.push(invite);feat = 'Invite'}
        }
      }
    }
  }
  return {state:draft,title:`March${feat ? ' + '+feat : ''}`,desc:notes.join('. '),feat,arrivals:[...destinationsUsed]}
}
function interceptReach(state,origin,target) {
  if (origin === target) return true
  if (BY_NAME[origin].adj.includes(target)) return true
  if (!state.roads) return false
  const queue = [origin]
  const known = new Set(queue)
  while (queue.length) {
    const head = queue.shift()
    for (const next of roadAdjacent[head]) {
      if (known.has(next) || !duxFriendly(state,next)) continue
      if (next === target) return true
      known.add(next)
      queue.push(next)
    }
  }
  return false
}
function planDuxIntercept(start,roll,{oneSpace,allowedFeat,blueConsent,free=false}) {
  const potential = REGIONS.filter(({name}) => duxFriendly(start,name) &&
    (on(start.land[name],'xr') || on(start.land[name],'sr'))).map(r => r.name)
  const count = sum(potential.map(name => Math.max(on(start.land[name],'xr'),on(start.land[name],'sr'))))
  if (count <= 2) return null
  const threshold = roll(6,'Dux Intercept · first die')+roll(6,'Dux Intercept · second die')
  if (count <= threshold) return null
  const draft = clone(start)
  const notes = []
  const choices = potential.flatMap(name => battleEnemies(start,name,'d','Intercept').map(defender => ({
    name,defender,raiders:on(start.land[name],defender+'r'),
  })))
  let feat = null
  let retaliate = null
  if (allowedFeat) {
    const eligible = choices.filter(({name,defender}) => hasStronghold(draft.land[name],[defender]))
    const name = chooseSpace([...new Set(eligible.map(item => item.name))],roll,'Dux Intercept · Retaliate')
    retaliate = eligible.find(item => item.name === name) ?? null
    if (!retaliate) {
      const invited = botInvite(draft,'d',roll,blueConsent)
      if (invited) {
        feat = 'Invite'
        notes.push(invited)
      }
    }
  }
  const ready = Object.fromEntries(REGIONS.filter(({name}) => duxFriendly(draft,name)).map(({name}) => {
    const troops = piecesByOwner(draft.land[name],{strongholds:false,raiders:false})
    const ownTroops = troops.d
    const reserve = Math.max(0,fortsIn(draft,[name])-(isFragmentation(draft) ? 0 : troops.c))
    return [name,{remaining:Math.max(0,ownTroops-reserve),groups:Object.fromEntries(duxGroups.map(key => [key,on(draft.land[name],key)]))}]
  }))
  const usedOrigins = new Set()
  const requests = []
  let moved = false
  let seaUsed = false
  const ordered = []
  const strongest = choices.filter(item => !choices.some(other => other.name === item.name && other.raiders > item.raiders))
  while (strongest.length) {
    const target = pickBest(strongest.map(item => ({
      ...item,rank:[item === retaliate ? 1 : 0,item.raiders,...opponentRank(start,'d',item.defender)],
    })),roll,'Dux Intercept target')
    ordered.push(target)
    for (let index = strongest.length-1;index >= 0;index--) if (strongest[index].name === target.name) strongest.splice(index,1)
  }
  if (oneSpace) ordered.splice(1)
  for (const target of ordered) {
    const {name,defender,raiders} = target
    const local = draft.land[name]
    let needed = Math.max(1,Math.ceil(raiders / 2))-sum(duxGroups.map(key => on(local,key)))
    while (needed > 0) {
      const affordable = free || duxFunds(draft,blueConsent) >= 2
      const eligible = Object.entries(ready).flatMap(([origin,moving]) => {
        if (origin === name || !affordable && !usedOrigins.has(origin) || moving.remaining <= 0) return []
        const byLand = interceptReach(start,origin,name)
        const bySea = !byLand && !seaUsed && effectiveMarker(start,60,'unshaded') && BY_NAME[origin].seas.length && BY_NAME[name].seas.length
        return byLand || bySea ? [{name:origin,moving,bySea,rank:[+usedOrigins.has(origin),moving.remaining,sum(['dxw','dsw'].map(key => moving.groups[key]))]}] : []
      })
      const pick = pickBest(eligible,roll,'Dux Intercept origin')
      if (!pick) break
      if (!usedOrigins.has(pick.name)) {
        if (!free) spendDux(draft,2,blueConsent)
        usedOrigins.add(pick.name)
      }
      let number = 0
      for (const key of ['dxw','dsw','cav']) {
        const n = Math.min(needed,pick.moving.remaining,pick.moving.groups[key],on(draft.land[pick.name],key))
        if (!n) continue
        shiftUnits(draft,pick.name,name,key,n)
        pick.moving.remaining -= n
        pick.moving.groups[key] -= n
        needed -= n
        number += n
      }
      if (!number) break
      moved = true
      seaUsed ||= Boolean(pick.bySea)
      notes.push(`${pick.name} → ${name} · ${number} Intercepting Troops${pick.bySea ? ' by sea' : ''}`)
    }
    if (!duxGroups.some(key => on(local,key))) continue
    const isRetaliation = retaliate?.name === name && retaliate.defender === defender
    const request = {name,attacker:'d',defender,source:'Intercept',...(isRetaliation ? {retaliate:true} : {})}
    if (isRetaliation) feat = 'Retaliate'
    requests.push(request)
  }
  // An origin may also be a planned target. Check the final position after all moves.
  const battles = requests.filter(({name}) => duxGroups.some(key => on(draft.land[name],key)))
  if (feat === 'Retaliate' && !battles.some(request => request.retaliate)) feat = null
  const engagements = sum(battles.map(({name,defender}) => on(draft.land[name],defender+'r')))
  for (const {name,defender} of battles) notes.push(`${name} · engage ${on(draft.land[name],defender+'r')} ${NAMES[defender]} Raiders`)
  if (engagements <= threshold) return null
  // §8.8.1 sends an eligible Intercept straight to Battle if no Troops move and no Feat applies.
  return {state:draft,requests:battles,feat,notes,battleInstead:!free && !moved && !feat}
}

function duxBuild(state,roll,blueConsent = false) {
  const notes = []
  const used = new Set()
  for (let i = 0; i < 2 && duxFunds(state,blueConsent) >= 3; i++) {
    const stock = availability(state)
    const candidates = REGIONS.filter(({name}) => !used.has(name) && on(state.land[name],'cav') && friendlyPieceLead(state,name,'d')).flatMap(({name,seas,sites,terrain}) => {
      const space = state.land[name]
      if (stock.fort > 0) {
        const slot = availableSite(space,name,'H')
        if (slot < 0) return []
        const value = isFragmentation(state)
          ? stackingGain(state,name,'d',land => { land.sites[slot] = {piece:'fort',employer:null} })
          : Number(seas.some(sea => state.seas[sea]) || ['Carvetii','Textoverdi'].includes(name))
        return [{name,slot,piece:'fort',rank:[value]}]
      }
      if (isFragmentation(state) || stock.town <= 0) return []
      const townSlot = sites.findIndex((site,index) => site.type === 'T' && !space.sites[index])
      const hillSlot = space.sites.findIndex((site,index) => site?.piece === 'hill' && (townSlot >= 0 || sites[index].type === 'T'))
      if (hillSlot >= 0 && on(space,'mil') > 0) return [{name,slot:townSlot < 0 ? hillSlot : townSlot,hillSlot,piece:'town',rank:[1]}]
      if (townSlot >= 0 && on(space,'mil') >= 2) return [{name,slot:townSlot,hillSlot:-1,piece:'town',rank:[0]}]
      return []
    })
    const option = pickBest(candidates,roll,'Dux Build')
    if (!option) break
    const space = state.land[option.name]
    spendDux(state,3,blueConsent)
    if (option.piece === 'town') {
      if (option.hillSlot >= 0) space.sites[option.hillSlot] = null
      removeUnloadedFirst(space,'mil',option.hillSlot >= 0 ? 1 : 2)
      changeTrack(state,'prestige',2)
    }
    if (option.piece === 'fort' && effectiveMarker(state,7,'shaded')) removeUnloadedFirst(space,'cav',1)
    space.sites[option.slot] = {piece:option.piece,employer:null}
    used.add(option.name)
    notes.push(`${option.name} · build a ${option.piece === 'fort' ? 'Fort' : 'Town'}`)
  }
  return notes
}

function civitatesRule(state,roll) {
  const notes = []
  const selected = new Set()
  const spent = new Set()
  const eligible = ({name}) => friendlyControl(state,name,'c')
  const available = (name,paid) => (!paid || !spent.has(name)) && (selected.has(name) || selected.size < 3)
  const mark = pick => { selected.add(pick.name); return state.land[pick.name] }
  const plunder = ({name}) => sum(civGroups.map(key => loaded(state.land[name],key)))
  for (;;) {
    const cargo = REGIONS.filter(region => eligible(region) && !selected.has(region.name) && available(region.name,false) && plunder(region))
    const pick = pickBest(cargo.map(({name}) => ({name,rank:[plunder({name})]})),roll,'Civitates Rule · Plunder')
    if (!pick) break
    const gain = plunder(pick)
    const space = mark(pick)
    for (const key of civGroups) space.units[key][1] = 0
    changeTrack(state,'wealth',gain)
    notes.push(`${pick.name} · turn ${gain} Plunder into Wealth`)
  }
  for (const mode of ['population','prestige','wealth']) {
    for (;;) {
      const candidates = REGIONS.filter(region => {
        const {name,terrain} = region
        if (!eligible(region) || !available(name,true)) return false
        const space = state.land[name]
        if (mode === 'population') return state.tracks.blue >= 5 && state.tracks.refugees > 0 &&
          terrain !== 'City' && space.pop < populationCeiling(state,name) && hasStronghold(space,['c'])
        if (mode === 'prestige') return botHasHuman(state,'d') && shieldsOf(state).d >= -2 &&
          state.tracks.wealth > 0 && state.tracks.prestige > 0 && !native(state,name,'d')
        return state.tracks.blue >= 10 && state.tracks.wealth < 80
      })
      const target = pickBest(candidates.map(({name}) => ({name,rank:[+selected.has(name)]})),roll,`Civitates Rule · ${mode}`)
      if (!target) break
      const space = mark(target)
      spent.add(target.name)
      if (mode === 'population') {
        state.tracks.blue -= 5
        state.tracks.refugees--
        space.pop++
        notes.push(`${target.name} · pay 5 Resources and resettle one Refugee`)
      }
      if (mode === 'prestige') {
        state.tracks.wealth--
        state.tracks.prestige--
        notes.push(`${target.name} · pay one Wealth to reduce Dux Prestige by one`)
      }
      if (mode === 'wealth') {
        state.tracks.blue -= 2
        state.tracks.wealth++
        notes.push(`${target.name} · convert 2 Resources to one Wealth`)
      }
    }
  }
  return notes
}

function botInvite(state,faction,roll,blueConsent = false) {
  if (isFragmentation(state)) return null
  const nation = roll(6,`${NAMES[faction]} Invite nationality`) <= 3 ? 's' : 'x'
  const barband = nation+'w'
  const piece = nation+'s'
  const partner = faction === 'd' ? 'c' : 'd'
  const pool = availability(state)
  const suitable = REGIONS.filter(({name}) => native(state,name,faction) && friendlyControl(state,name,faction))
  const vacant = suitable.filter(({name,terrain}) => terrain !== 'City' && state.land[name].sites.includes(null))
  if (pool[piece] > 0 && !countStrongholds(state,piece,faction) && vacant.length) {
    const name = chooseSpace(vacant.map(region => region.name),roll,`${NAMES[faction]} Invite space`)
    const space = state.land[name]
    const slot = availableSite(space,name,'H')
    space.sites[slot] = {piece,employer:faction}
    const number = Math.min(nation === 'x' ? 3 : 2,pool[barband])
    space.units[faction+barband][0] += number
    return `Invite ${NAMES[nation]} Foederati at ${name}.`
  }
  if (!botHasHuman(state,partner)) return null
  const convert = suitable.flatMap(({name}) => ['x','s'].map(nation => {
    const space = state.land[name]
    const key = nation+'w'
    const oldHolding = space.sites.filter(site => site?.piece === nation+'s' && site.employer === partner).length
    const total = oldHolding + on(space,partner+key)
    return {name,nation,rank:[total],total}
  })).filter(item => item.total > 0 && item.total <= poolOf(state,faction,blueConsent))
  if (!convert.length) return null
  const best = Math.max(...convert.map(item => item.total))
  const names = [...new Set(convert.filter(item => item.total === best).map(item => item.name))]
  const where = chooseSpace(names,roll,`${NAMES[faction]} convert Foederati · space`)
  const candidates = convert.filter(choice => choice.total === best && choice.name === where)
  const target = candidates.length === 1 ? candidates[0] : candidates[roll(4,'Foederati nationality') > 2 ? 1 : 0]
  const from = state.land[target.name]
  const oldGroup = partner+target.nation+'w'
  const newGroup = faction+target.nation+'w'
  const spend = faction === 'd' ? spendDux : spendCivitates
  spend(state,target.total,blueConsent)
  from.units[newGroup][0] += on(from,oldGroup)
  from.units[newGroup][1] += loaded(from,oldGroup)
  from.units[oldGroup] = [0,0]
  for (const slot of from.sites) {
    if (slot?.piece === target.nation+'s' && slot.employer === partner) slot.employer = faction
  }
  return `${target.name} · convert ${target.total} ${NAMES[target.nation]} Foederati for ${target.total} Resources.`
}

export function civitatesTrade(state,roll,{oneSpace = false} = {}) {
  const rooms = REGIONS.map(({name}) => ({name,count:state.land[name].sites.filter(site => site?.piece === 'town').length}))
  const chosen = rooms.filter(({count}) => count)
  if (!chosen.length) return []
  const selected = oneSpace ? [pickBest(chosen.map(room => ({...room,rank:[room.count]})),roll,'Civitates Trade · Towns')] : chosen
  const gain = Math.min(80-state.tracks.blue,sum(selected.map(room => room.count)))
  if (gain < 4) return []
  changeTrack(state,'blue',gain)
  const notes = [`Trade at ${selected.length} Town spaces for ${gain} Resources`]
  const totals = boardTotals(state)
  if (!isFragmentation(state) && (totals.pop.c <= 20 || totals.total + state.tracks.prestige <= 30)) {
    const used = new Set()
    for (let n = 0; n < 2 && state.tracks.blue && goldAvailable(state) > 0; n++) {
      const candidates = selected.filter(({name}) => !used.has(name) && friendlyControl(state,name,'c')).flatMap(({name}) => {
        const space = state.land[name]
        const possible = Math.min(space.pop,goldAvailable(state),BY_NAME[name].terrain === 'City' ? BY_NAME[name].printed*2-space.pros[0] : sum(space.pros.map(cube => Math.max(0,space.pop-cube))))
        return possible > 0 ? [{name,rank:[possible]}] : []
      })
      const pick = pickBest(candidates,roll,'Civitates Trade · Prosperity')
      if (!pick) break
      used.add(pick.name)
      state.tracks.blue--
      const added = addProsperity(state,pick.name,state.land[pick.name].pop)
      notes.push(`${pick.name} · pay one Resource to add ${added} Prosperity`)
    }
  }
  return notes
}

export function duxTrain(state, roll, {oneSpace = false, allowedFeat = true, blueConsent = false} = {}) {
  const placements = []
  const notes = []
  let feat = null
  if (allowedFeat) {
    const invitation = botInvite(state,'d',roll,blueConsent)
    if (invitation) {
      feat = 'Invite'
      notes.push(invitation)
    }
  }
  let militia = availability(state).mil
  let cavalry = availability(state).cav
  const candidates = REGIONS.filter(({name}) => fortsIn(state,[name])).map(r => r.name)
  const trained = []
  while (cavalry > 0 && duxFunds(state,blueConsent) >= 3 && candidates.length) {
    const name = chooseSpace(candidates,roll,'Dux Train space')
    candidates.splice(candidates.indexOf(name),1)
    trained.push(name)
    const space = state.land[name]
    const add = Math.min(cavalry,cavalryTrainCapacity(state,name))
    spendDux(state,3,blueConsent)
    space.units.cav[0] += add
    cavalry -= add
    const mil = !isFragmentation(state) && space.sites.some(site => ['town','hill'].includes(site?.piece)) ? Math.min(2*recruitMilitia(state),militia) : 0
    space.units.mil[0] += mil
    militia -= mil
    placements.push(`${name} +${add} Cavalry${mil ? ` and +${mil} Militia` : ''}`)
    if (oneSpace) break
  }
  if (!isFragmentation(state)) {
    const used = new Set()
    for (let i = 0; i < 2 && duxFunds(state,blueConsent) >= 2 && goldAvailable(state) >= 2; i++) {
      const restoration = REGIONS.filter(({name,terrain}) => terrain !== 'City' && (!oneSpace || trained.includes(name)) && !used.has(name) && duxFriendly(state,name) && (fortsIn(state,[name]) || on(state.land[name],'cav'))).map(({name,terrain,printed}) => {
        const space = state.land[name]
        const room = terrain === 'City' ? 2 * printed - space.pros[0] : sum(space.pros.map(row => Math.max(0,space.pop - row)))
        const possible = Math.min(room,space.pop,goldAvailable(state))
        return { name, possible, rank: [possible] }
      }).filter(candidate => candidate.possible >= 2)
      const target = pickBest(restoration,roll,'Dux prosperity restoration')
      if (!target) break
      used.add(target.name)
      const added = addProsperity(state,target.name,target.possible)
      spendDux(state,2,blueConsent)
      notes.push(`Restore ${added} Prosperity in ${target.name}.`)
    }
  }
  if (!feat && allowedFeat) {
    const construction = duxBuild(state,roll,blueConsent)
    if (construction.length) {
      feat = 'Build'
      notes.push(...construction)
    } else {
      const requisition = duxRequisition(state)
      if (requisition) {
        feat = 'Requisition'
        notes.push(requisition)
      }
    }
  }
  return { feat, placements, notes }
}
function canTrain(state,oneSpace = false,blueConsent = false) {
  return availability(state).cav >= 2 && REGIONS.some(({name}) => cavalryTrainCapacity(state,name) >= 2 && duxFunds(state,blueConsent) >= 3) ||
    !oneSpace && availability(state).cav >= 2 && duxFunds(state,blueConsent) >= 6 && REGIONS.filter(({name}) => fortsIn(state,[name])).length >= 2
}
function cavalryTrainCapacity(state,name) {
  return fortsIn(state,[name])*(effectiveMarker(state,2,'unshaded') ? 2 : 1)
}

function raidDefenceModifier(state,faction,name,sea,landBased) {
  let modifier = 0
  if (sea === 'brit' && effectiveMarker(state,8,'unshaded')) modifier += 4
  if (faction === 's' && sea === 'hib' && effectiveMarker(state,18,'shaded')) modifier--
  if (faction === 'x' && effectiveMarker(state,38,'unshaded')) modifier += 2
  if (faction === 'x' && effectiveMarker(state,38,'shaded')) modifier -= 2
  if (sea && effectiveMarker(state,55,'unshaded') && state.markers[55].sea === sea) modifier += 3
  if (faction === 's' && effectiveMarker(state,58,'unshaded')) modifier += 2
  if (faction === 's' && effectiveMarker(state,58,'shaded')) modifier -= 2
  if (faction === 's' && ['Novantae','Votadini','Carvetii'].includes(name) && effectiveMarker(state,59,'unshaded')) modifier += 3
  if (faction === 's' && effectiveMarker(state,68,'unshaded')) modifier++
  if (landBased && effectiveMarker(state,69,'unshaded')) modifier += 2
  return modifier
}
const raidSeas = { x: ['brit','germ'], s: ['hib','sept'] }
function raidRoutes(state,faction) {
  const base = REGIONS.filter(({name}) => on(state.land[name],faction+'w') && hasStronghold(state.land[name],[faction]))
  const coasts = Object.fromEntries(Object.keys(SEAS).map(sea => [sea,REGIONS.filter(r => r.seas.includes(sea)).map(r => r.name)]))
  const natural = [...raidSeas[faction]]
  if (faction === 's' && state.markers[73]) natural.splice(natural.indexOf('sept'),1)
  if (faction === 's' && effectiveMarker(state,55,'shaded')) natural.push('brit')
  if (faction === 'x' && effectiveMarker(state,37,'shaded')) natural.push('sept')
  function patrol(names) {
    if (!state.markers[67]) return fortsIn(state,names)
    return sum(names.map(name => state.land[name].sites.filter(site => site?.employer && ['xs','ss'].includes(site.piece)).length))
  }
  const direct = {}
  for (const region of REGIONS) {
    const {name} = region
    if (region.terrain === 'City' || friendlyControl(state,name,faction)) continue
    const crossing = region.seas.filter(sea => natural.includes(sea) || base.some(r => r.seas.includes(sea))).map(sea => {
      const waters = faction === 'x' && sea === 'sept' && effectiveMarker(state,37,'shaded') ? ['sept','germ'] : [sea]
      const defended = [...new Set(waters.filter(selected => state.seas[selected]).flatMap(selected => coasts[selected]))]
      const minus = patrol(defended) + raidDefenceModifier(state,faction,name,sea,false)
      return { via:SEAS[sea], minus, sea }
    })
    if (base.some(r => r.name === name || region.adj.includes(r.name))) crossing.push({via:'Local Settlement',minus:raidDefenceModifier(state,faction,name,null,true)})
    if (faction === 's' && ['Novantae','Votadini'].includes(name)) {
      const wall = effectiveMarker(state,69,'shaded') ? 0 : fortsIn(state,['Carvetii','Textoverdi'])
      crossing.push({via:'Caledonia',minus:wall + raidDefenceModifier(state,faction,name,null,true)})
    }
    if (crossing.length) direct[name] = crossing.sort((a,b) => a.minus-b.minus)[0]
  }
  return direct
}
const enemyTroops = (state,name,faction) => {
  const counts = piecesByOwner(state.land[name],{raiders:false,strongholds:false})
  return sum(Object.values(counts))-counts[faction]
}
const shieldsOf = state => {
  const values = scores(state)
  return {d:values.d.score-values.d.victoryTarget,c:values.c.score-values.c.victoryTarget}
}
function raidPriority(state,name,faction,big,mode) {
  const region = BY_NAME[name]
  const space = state.land[name]
  const prosperity = totalProsperity(space)
  const enemyControl = Boolean(control(state,name) && control(state,name) !== faction)
  if (!big) return faction === 's' ? [prosperity,+(region.terrain === 'Hills')] : [+(region.terrain === 'Fens')]
  const defense = space.pop-enemyTroops(state,name,faction)
  if (faction === 'x') return [mode <= 4 ? defense : +(region.terrain === 'Fens')]
  const nearby = localOrAdjacent(name).some(other => native(state,other,faction))
  return [mode <= 4 ? +nearby : prosperity,+enemyControl,defense]
}
function raidAllowed(state,name,route,faction,big,mode) {
  const prosperity = totalProsperity(state.land[name])
  if (faction === 's') return !big || mode <= 4 || prosperity >= 2
  if (!big) return route.minus <= 0 && prosperity >= 1
  return prosperity >= 2 || Boolean(control(state,name) && control(state,name) !== faction)
}
function ransomPayers(state,name) {
  const space = state.land[name]
  const choices = []
  if (hasStronghold(space,['c']) && (state.tracks.blue || state.tracks.wealth)) choices.push({owner:'c',track:state.tracks.blue ? 'blue' : 'wealth'})
  if (hasStronghold(space,['d']) && (state.tracks.red || (preemption(state) && state.tracks.blue))) choices.push({owner:'d',track:state.tracks.red ? 'red' : 'blue'})
  if (hasStronghold(space,['x']) && state.tracks.x) choices.push({owner:'x',track:'x'})
  return choices
}
function ransomPayer(state,name) {
  const choices = ransomPayers(state,name)
  return (choices.find(choice => botHasHuman(state,choice.owner)) || choices[0])?.track || null
}
const ransoms = (state,name,roll) => roll(6,'Ransom · '+name) + Number(effectiveMarker(state,36,'shaded')) -
  Number(effectiveMarker(state,36,'unshaded')) >= 4
function ravageChoices(state,targets,faction,roll,{battle = false} = {}) {
  const fertile = targets.filter(({name}) => BY_NAME[name].terrain !== 'City' && totalProsperity(state.land[name]) > state.land[name].pop)
  if (battle) return fertile.filter(({name}) => {
    const space = state.land[name]
    return on(space,'xw')-loaded(space,'xw') > space.pop && !friendlyControl(state,name,'x')
  }).map(target => target.name)
  if (fertile.length) return fertile.map(t => t.name)
  const hostile = targets.filter(({name}) => enemyControlOwner(control(state,name),faction))
  const chosen = pickBest(hostile.map(({name}) => {
    const counts = piecesByOwner(state.land[name])
    return {name,rank:[sum(Object.values(counts))-counts[faction]]}
  }),roll,'Saxon Ravage · enemy Control')
  return chosen ? [chosen.name] : []
}
function guaranteedRaidAssault(state,request) {
  const positions = [{noWithdraw:true},{forceWithdraw:true},{}]
  return positions.every(defence => [false,true].every(defenderAmbush =>
    battleForecast(state,{...request,...defence,defenderAmbush,assumeCoup:request.surprise}).destroyed.length > 0))
}
function raidOpposition(state,name,faction) {
  return battleEnemies(state,name,faction,'Raid').filter(defender => hasStronghold(state.land[name],defenderSides(state,faction,defender)))
}
function raidRequest(state,faction,target,arrived,loadedOnArrival,feat,standingControl) {
  const {name} = target
  const enemies = raidOpposition(state,name,faction)
  const sorted = enemies.map(defender => ({defender,rank:opponentRank(state,faction,defender)})).sort((a,b) => precedence(a.rank,b.rank))
  const buildRequest = defender => ({
    name,attacker:faction,defender,source:'Raid',attackers:{[faction+'r']:[arrived,loadedOnArrival]},
    ...(feat === 'Surprise' && target.surprised ? {surprise:true} : {}),
    ...(feat === 'Ravage' && target.ravaging ? {ravage:true,noAssault:true} : {}),
  })
  if (target.route.deep) {
    const reactions = []
    for (const react of raidResponders(state,name,faction,true)) {
      const defender = isBritonFaction(react) && !isFragmentation(state) ? 'd' : react
      const deep = {
        ...buildRequest(defender),source:'Deep Raid',afterDeepRaid:true,landed:arrived,raidController:standingControl,reactionFaction:react,
        raidOpponent:standingControl === (faction === 'x' ? 's' : 'x') ? standingControl : null,
      }
      if (botHasHuman(state,react)) {
        deep.choice = 'deep-reaction'
        reactions.push(deep)
      } else if (botForcesRaidBattle(state,deep,react)) {
        reactions.push(deep)
        break
      }
    }
    if (reactions.length) {
      let fallback = sorted.map(({defender}) => buildRequest(defender)).find(request => guaranteedRaidAssault(state,request))
      for (const reaction of reactions.reverse()) {
        if (reaction.choice && fallback) reaction.ifDeclined = fallback
        fallback = reaction
      }
      return fallback
    }
  }
  if (feat === 'Ravage' && target.ravaging) {
    const reactions = []
    for (const react of raidResponders(state,name,faction,false)) {
      const counter = {
        name,attacker:react,defender:faction,source:'Ravage',ravage:true,noAssault:true,noSiege:true,
        defenders:{[faction+'r']:[arrived,loadedOnArrival]},reactionFaction:react,
      }
      if (botHasHuman(state,react)) {
        counter.choice = 'ravage-reaction'
        reactions.push(counter)
      } else if (botForcesRaidBattle(state,counter,react)) {
        reactions.push(counter)
        break
      }
    }
    return reactions.reduceRight((next,reaction) => next ? {...reaction,ifDeclined:next} : reaction,null)
  }
  return sorted.map(({defender}) => buildRequest(defender)).find(request => guaranteedRaidAssault(state,request)) || null
}
export function planRaid(start,faction,roll,{oneSpace = false,allowedFeat = true,free = false,capOverride,diceOverride,onlyTargets,targetRank,forceRaidBattle=false} = {}) {
  const state = clone(start)
  const scotti = faction === 's'
  const cap = oneSpace ? 1 : capOverride ?? (scotti ? 4 : 3)
  const diceCount = diceOverride ?? (scotti ? 2 : 3)
  const bigCost = free ? 0 : scotti ? 1 : 2
  const surcharge = scotti && effectiveMarker(state,63,'unshaded') && !free ? 1 : 0
  const direct = Object.fromEntries(Object.entries(raidRoutes(start,faction)).filter(([name]) => !onlyTargets || onlyTargets(name)))
  const targets = []
  const notes = []
  const requests = []
  const raider = faction+'r'
  const other = scotti ? 'x' : 's'
  const usingNiall = scotti && effectiveMarker(state,68,'shaded')
  let fromNiall = usingNiall ? state.tracks.niall : 0
  let budget = state.tracks[faction]
  const canRavage = allowedFeat && !scotti && Object.values(shieldsOf(start)).some(margin => margin >= -2)
  if (!Object.keys(direct).length || (!scotti && budget === 0 && !free)) return {targets,notes}
  if (effectiveMarker(state,55,'unshaded') && !state.markers[55].sea) {
    return {targets,notes,guide:['Niall’s Raid needs the affected sea recorded in the card marker before its Raid subtraction can be calculated.']}
  }
  if (!onlyTargets && usingNiall && !fromNiall && budget >= bigCost+surcharge) {
    targets.push({name:'Niall’s holding box',route:{via:'Off-board box',minus:raidDefenceModifier(state,faction,'Niall’s holding box',null,false)},dice:2,cost:bigCost+surcharge})
    budget -= bigCost+surcharge
  }
  const mode = roll(6,`${NAMES[faction]} Raid target priority`)
  const paidLimit = scotti && mode <= 4 ? Math.min(mode,cap) : cap
  let feat = null
  for (const big of [true,false]) {
    const cost = (big ? bigCost : free || scotti ? 0 : 1)+surcharge
    if (!big && scotti && !targets.length && !free && !forceRaidBattle) break
    while (targets.length < (big ? paidLimit : cap) && budget >= cost) {
      const remaining = Object.entries(direct).filter(([name,route]) => !targets.some(t => t.name === name) && (free || forceRaidBattle || raidAllowed(start,name,route,faction,big,mode)))
      const rank = (name,route) => [ ...(targetRank?.(name) ?? []), ...(free && !scotti ? [totalProsperity(start.land[name]),+(BY_NAME[name].terrain === 'Fens')] : [-route.minus,...raidPriority(start,name,faction,big,mode)]) ]
      const directTargets = remaining.map(([name,route]) => ({name,route,rank:rank(name,route)}))
      let pool = directTargets
      if (allowedFeat && !free && !targets.length && big && !canRavage) {
        const deep = []
        for (const {name,terrain,adj} of REGIONS) {
          if (terrain === 'City' || direct[name] || friendlyControl(start,name,faction) || (scotti && totalProsperity(start.land[name]) <= enemyTroops(start,name,faction))) continue
          const approaches = adj.filter(n => direct[n]).map(n => ({via:direct[n].via+' via '+n,minus:direct[n].minus,deep:true}))
          const route = approaches.sort((a,b) => a.minus-b.minus)[0]
          if (route && raidAllowed(start,name,route,faction,big,mode)) deep.push({name,route,rank:rank(name,route)})
        }
        const bestDirect = [...directTargets].sort((a,b) => precedence(a.rank,b.rank))[0]
        pool = [...directTargets,...deep.filter(c => !bestDirect || precedence(c.rank,bestDirect.rank) < 0)]
      }
      const target = pickBest(pool,roll,`${NAMES[faction]} ${big ? 'paid' : 'additional'} Raid`)
      if (!target) break
      budget -= cost
      targets.push({...target,cost,dice:big || free ? diceCount : 1,surprised:Boolean(target.route.deep)})
      if (target.route.deep) feat = 'Surprise'
    }
  }
  if (!targets.length) return {targets,notes}
  const main = targets.filter(target => state.land[target.name])
  for (const target of targets) {
    target.rolls = Array.from({length:target.dice},() => roll(4,'Raid · '+target.name))
    target.potential = Math.max(0,sum(target.rolls)-target.route.minus)
  }
  const ravage = canRavage ? ravageChoices(start,main,faction,roll) : []
  if (ravage.length) {
    feat = 'Ravage'
    for (const target of main) target.ravaging = ravage.includes(target.name)
  }
  if (allowedFeat && !scotti && !feat) {
    const candidate = pickBest(main.filter(({name}) => raidOpposition(start,name,faction).length).map(({name}) => ({
      name,rank:[-enemyTroops(start,name,faction)],
    })),roll,'Saxon Surprise · Raid with a Stronghold')
    if (candidate) {
      feat = 'Surprise'
      main.find(target => target.name === candidate.name).surprised = true
    }
  }
  // Fees come due before any Ransom or Plunder income.
  state.tracks[faction] = budget
  const preRaidAvailability = availability(start)[raider]
  let left = preRaidAvailability
  if (allowedFeat && scotti && !feat && main.some((t,i) => (t.potential > 0 || (i === 0 && fromNiall)) && ransomPayer(state,t.name))) feat = 'Ransom'
  for (const target of targets) {
    const space = state.land[target.name]
    const normal = Math.min(left,target.potential)
    left -= normal
    if (!space) {
      state.tracks.niall += normal
      notes.push(`Hold ${normal} Scotti Raiders in Niall’s box.`)
      continue
    }
    const extra = target === main[0] ? fromNiall : 0
    const arriving = normal+extra
    if (!arriving) continue
    if (extra) {
      state.tracks.niall -= extra
      fromNiall = 0
    }
    const oldCargo = loaded(space,raider)
    const startingControl = control(start,target.name)
    space.units[raider][0] += arriving
    const tentative = target.route.deep ? raidRequest(state,faction,target,arriving,0,feat,startingControl) : null
    if (tentative?.afterDeepRaid) {
      requests.push(tentative)
      notes.push(`${target.name}: ${arriving} land. Resolve Deep Raid reactions before Plunder.`)
      continue
    }
    const limit = target.ravaging ? arriving : Math.min(arriving,space.pop)
    const basePlunder = plunderTo(space,raider,limit)
    const taken = basePlunder+raidBonusPlunder(state,target.name,faction,startingControl,arriving-basePlunder)
    if (startingControl === other) changeTrack(state,other,-taken)
    notes.push(`${target.name}: ${arriving} land and take ${taken} Plunder.`)
    if (target.ravaging && roll(6,'Ravage · '+target.name) >= 4 && space.pop) {
      space.pop--
      state.tracks.refugees = Math.min(4,state.tracks.refugees+1)
      notes.push(`${target.name} loses one Population to Ravage.`)
    }
    if (feat === 'Ransom') {
      const payer = ransomPayer(state,target.name)
      if (payer && ransoms(state,target.name,roll)) {
        changeTrack(state,payer,-1)
        changeTrack(state,'s',1)
      }
    }
    const newGold = loaded(space,raider)-oldCargo
    const battle = forceRaidBattle && pickBest(battleEnemies(state,target.name,faction,'Raid').map(defender=>({
      name:target.name,defender,rank:[raidExposure(state,target.name,faction,defender),...opponentRank(state,faction,defender)],
    })),roll,'Mistborn · Battle opponent')
    const request = battle ? {name:target.name,attacker:faction,defender:battle.defender,source:'Raid',attackers:{[raider]:[arriving,newGold]},trap:[raider],trapSide:'attacker'} :
      raidRequest(state,faction,target,arriving,newGold,feat,startingControl)
    if (request) requests.push({...request,raidController:startingControl,raidedFaction:other,raidPlunder:newGold})
  }
  const description = targets.map(target =>
    `${target.name} · ${target.route.via}, ${target.dice}D4 (${target.rolls.join('+')})${target.route.minus ? ` adjusted by ${-target.route.minus}` : ''} · up to ${target.potential} Raiders`).join('; ')
  return {state,targets,feat,notes,description,requests}
}

function eventPrerequisites(faction, state) {
  const id = state.current
  if (faction === 'd' && [4,14,55,64].includes(id) && state.eventIndex > 4) return false
  if (id === 13 && faction === 'd') return !friendlyControl(state,'Ordovices','d')
  if (id === 14 && faction === 's') return state.eventIndex <= 2 && sum(REGIONS.map(({name}) => on(state.land[name],'sw'))) >= 6
  if (faction === 'd' && [21,28,29,47,65].includes(id) && (botHasHuman(state,'c') || isFragmentation(state))) return false
  if (faction === 'd' && [36,59,62].includes(id) && !botHasHuman(state,'s')) return false
  if (faction === 'd' && id === 53 && !botHasHuman(state,'x')) return false
  if (id === 8 && faction === 'c' && state.eventIndex > 4) return false
  if (id === 37 && isBritonFaction(faction) && state.markers[73]) return false
  if (id === 16 && barbarians.includes(faction) && isFragmentation(state)) return false
  if (faction === 's' && [16,33,70].includes(id) && state.eventIndex > 4) return false
  if (faction === 'x' && [16,70].includes(id) && state.eventIndex > 4) return false
  if (['s','x'].includes(faction) && [21,28].includes(id) && state.epoch+1 >= scenarioInfo(state).epochs) return false
  if (['s','x'].includes(faction) && id === 28 && state.next === 21) return false
  if (faction === 'x' && [18,63,69,71].includes(id) && botHasHuman(state,'s')) return false
  if (id === 46 && faction === 's' && (botHasHuman(state,'x') || state.epoch+1 >= scenarioInfo(state).epochs)) return false
  if ([18,56,69].includes(id) && faction === 'x' && (botHasHuman(state,'s') || state.epoch+1 >= scenarioInfo(state).epochs)) return false
  if (faction === 's' && id === 38 && botHasHuman(state,'x')) return false
  if (id === 15 && ['x','s'].includes(faction)) return !isFragmentation(state) && shieldsOf(state).d > 0
  if (id === 15 && faction === 'd') return !isFragmentation(state)
  return true
}
function recalledSaxons(state,name) {
  return on(state.land[name],'dxw')+on(state.land[name],'cxw')
}
function saxonRevolt(state,roll) {
  const candidates = REGIONS.map(({name}) => ({name,rank:[recalledSaxons(state,name),totalProsperity(state.land[name])]}))
    .filter(({name,rank}) => rank[0] || state.land[name].sites.some(site => site?.piece === 'xs' && site.employer))
  const input = {}
  for (let i = 1; i <= 3 && candidates.length; i++) {
    const choice = pickBest(candidates,roll,'Adventus Saxonum · revolt')
    input['space'+i] = choice.name
    candidates.splice(candidates.indexOf(choice),1)
  }
  const requests = eventBattleRequests(state,74,'x','single',input)
  const description = runEvent(state,74,'x','single',input,roll)
  return {option:'event',label:card(74).title,description,requests}
}
function eventSeaPatrol(state,faction,roll) {
  const seas = Object.keys(SEAS)
  const briton = isBritonFaction(faction)
  const flippable = briton ? seas.filter(sea => sea !== 'sept' && !state.seas[sea]) :
    (faction === 's' ? ['hib'] : ['germ','brit']).filter(sea => state.seas[sea])
  if (!briton) return Object.fromEntries(flippable.map((sea,index) => ['sea'+(index+1),sea]))
  const plans = [[],...flippable.map(sea => [sea]),...flippable.flatMap((sea,i) => flippable.slice(i+1).map(other => [sea,other]))]
  const reachable = (name,additional) => BY_NAME[name].seas.some(sea => state.seas[sea] || additional.includes(sea))
  const forts = sum(REGIONS.filter(({name}) => reachable(name,[])).map(({name}) => fortsIn(state,[name])))
  const settlements = additional => sum(REGIONS.filter(({name}) => reachable(name,additional)).map(({name}) => state.land[name].sites.filter(site => site?.employer).length))
  const max = Math.max(...plans.map(settlements))
  if (max < forts + Number(faction === 'c')) return null
  const best = plans.filter(plan => settlements(plan) === max)
  const leastFlips = Math.min(...best.map(plan => plan.length))
  const shortest = best.filter(plan => plan.length === leastFlips).map(plan => plan.join(','))
  const chosen = chooseSpace(shortest,roll,'Dogs and Wolves · patrol').split(',').filter(Boolean)
  return Object.fromEntries(chosen.map((sea,index) => ['sea'+(index+1),sea]))
}
function eventSpaceOptions(state,id,faction,side,key,input = {}) {
  return eventChoices(state,id,faction,side,input)?.fields.find(field => field.name === key)?.options
    .map(option => option.value).filter(Boolean) ?? []
}
function chooseEventSpace(state,id,faction,side,key,rank,roll,predicate = () => true) {
  const candidates = eventSpaceOptions(state,id,faction,side,key).filter(predicate).map(name => ({name,rank:rank(name)}))
  return pickBest(candidates,roll,card(id).title)?.name
}
function eventRomanitasInput(state,faction,side,roll) {
  if (side === 'unshaded') {
    const offMap = availability(state).cav+state.pools.casualties+state.pools.out
    const candidates = eventSpaceOptions(state,12,faction,side,'group').map(group => {
      const [name,pair] = group.split('/')
      const space = state.land[name]
      const forts = Math.min(availability(state).fort,space.sites.filter(site => site?.employer === 'd' && site.piece === pair[1]+'s').length)
      return {name,group,rank:[forts,Math.min(offMap,on(space,pair+'w'))]}
    }).filter(({rank}) => rank.some(Boolean))
    const choice = pickBest(candidates,roll,'Romanitas · replacements')
    return choice ? {group:choice.group} : null
  }
  const stock = availability(state)
  const order = faction === 's' ? ['ss','xs'] : ['xs','ss']
  const name = chooseEventSpace(state,12,faction,side,'space',name => {
    const {sites} = state.land[name]
    const holdings = sites.filter(site => site?.piece === 'fort').length
    return [Math.min(stock[order[0]],holdings),holdings,Math.min(stock[faction+'w'],on(state.land[name],'cav')),on(state.land[name],'cav')]
  },roll)
  if (!name) return null
  const space = state.land[name]
  const input = {space:name,saxon:faction === 'x' ? Math.min(stock.xw,on(space,'cav')) : Math.min(stock.xw,Math.max(0,on(space,'cav')-stock.sw))}
  for (const [index,site] of space.sites.entries()) {
    if (site?.piece !== 'fort') continue
    const piece = order.find(key => stock[key] > 0)
    if (piece) {input['fort'+index] = piece;stock[piece]--}
  }
  return input
}
function eventUtherInput(state,faction,side,roll) {
  if (side === 'shaded') {
    const name = chooseEventSpace(state,6,faction,side,'space',name => {
      const space = state.land[name]
      const cavalry = on(space,'cav')
      return faction === 'c'
        ? [isFragmentation(state) ? cavalry : -cavalry,piecesByOwner(space).d-cavalry]
        : [+(fortsIn(state,[name]) > 0),cavalry,piecesByOwner(space).d]
    },roll)
    return name ? {space:name} : {}
  }
  const candidates = eventSpaceOptions(state,6,faction,side,'space1').map(name => ({name,rank:[+Boolean(totalProsperity(state.land[name]))]}))
  const input = {}
  let wealth = state.tracks.wealth
  for (let i = 1; i <= 3 && candidates.length; i++) {
    const choice = pickBest(candidates,roll,'Uther · transfer')
    input['space'+i] = choice.name
    input['payer-'+choice.name] = wealth ? 'wealth' : 'blue'
    wealth = Math.max(0,wealth-5)
    candidates.splice(candidates.indexOf(choice),1)
  }
  return input
}
function eventConversionInput(state,id,faction,side,roll) {
  const options = eventSpaceOptions(state,id,faction,side,'group')
  const candidates = options.map(group => {
    const [name,pair] = group.split('/')
    const space = state.land[name]
    if (side === 'unshaded') {
      if (faction === 'd' && pair[0] === 'd') return null
      return {name,group,rank:[space.sites.filter(site => site?.employer === pair[0] && site.piece === pair[1]+'s').length,on(space,pair+'w')]}
    }
    return {name,group,rank:[+(pair === faction),space.sites.filter(site => ['town','hill'].includes(site?.piece)).length,on(space,'mil')+on(space,'com')]}
  }).filter(Boolean)
  const choice = pickBest(candidates,roll,card(id).title)
  return choice ? {group:choice.group} : null
}
function verifiedEventInput(state,id,faction,side,roll) {
  if (id === 6) return eventUtherInput(state,faction,side,roll)
  if (id === 12) return eventRomanitasInput(state,faction,side,roll)
  if (id === 47 || id === 65) return eventConversionInput(state,id,faction,side,roll)
  if (id === 67) return eventSeaPatrol(state,faction,roll)
  if (id === 11 && side === 'shaded') {
    const name = chooseEventSpace(state,id,faction,side,'space',name => [ownedStrongholds(state.land[name],'d').length,native(state,name,'d')],roll,name => native(state,name,'d') > 0)
    return name ? {space:name} : null
  }
  if (id === 11) {
    const candidates = eventSpaceOptions(state,id,faction,side,'space').flatMap(name => state.land[name].sites.flatMap((site,index) => {
      if (!site || !['xs','ss'].includes(site.piece)) return []
      const nation = site.piece[0]
      const space = state.land[name]
      const bands = on(space,nation+'w')+on(space,(faction === 'd' ? 'c' : 'd')+nation+'w')
      if (faction === 'd' && bands < 2) return []
      return [{name,index,rank:[Number(site.employer !== faction),bands]}]
    }))
    const choice = pickBest(candidates,roll,card(id).title)
    return choice ? {space:choice.name,site:choice.index,employer:faction} : faction === 'c' && !eventSpaceOptions(state,id,faction,side,'space').length && state.tracks.prestige > 0 ? {} : null
  }
  if (id === 63 && side === 'shaded') {
    const name = chooseEventSpace(state,id,faction,side,'space',name => {
      const space = state.land[name]
      return [Number(space.sites.some(site => site?.piece === 'hill')),sum(civGroups.map(key => on(space,key)))]
    },roll)
    if (!name) return null
    const space = state.land[name]
    let loss = Math.ceil(sum(civGroups.map(key => on(space,key)))/2)
    const input = {space:name}
    for (const key of ['com','cxw','csw','mil']) {
      input['remove-'+key] = Math.min(loss,on(space,key))
      loss -= input['remove-'+key]
    }
    return input
  }
  if (id === 66 && side === 'shaded') {
    const candidates = eventSpaceOptions(state,id,faction,side,'pair').map(pair => {
      const [name,adjacent] = pair.split('/')
      const losses = rivalCaesarsLosses(native(state,name,'d'))+rivalCaesarsLosses(native(state,adjacent,'d'))
      return {name,pair,rank:[losses]}
    })
    const chosen = pickBest(candidates,roll,card(id).title)
    if (!chosen) return null
    const input = {pair:chosen.pair}
    for (const name of chosen.pair.split('/')) {
      const loss = rivalCaesarsLosses(native(state,name,'d'))
      for (let i = 1; i <= loss; i++) {
        const key = 'loss-'+name+'-'+i
        const options = eventSpaceOptions(state,id,faction,side,key,input)
        const priority = entry => entry === 'cav' ? 2 : entry.startsWith('site') ? 3 : 1
        const most = Math.max(...options.map(priority))
        input[key] = chooseSpace(options.filter(entry => priority(entry) === most),roll,'Rival Caesars · Dux losses')
      }
    }
    return input
  }
  if (id === 71) {
    const name = chooseEventSpace(state,id,faction,side,'space',name => {
      const space = state.land[name]
      if (side === 'shaded') return [+(availability(state).ss > 0),+(control(state,name) !== 's')]
      const warbands = on(space,'xw')
      const holdings = nativeSettlements(space,'x')
      return [Math.min(Math.max(0,5-warbands),holdings),Math.min(5,warbands+holdings)]
    },roll)
    if (!name || side === 'shaded' && !availability(state).ss && !availability(state).sw) return null
    const choices = eventSpaceOptions(state,id,faction,side,'site',{space:name})
    return choices.length ? {space:name,site:choices[0]} : {space:name}
  }
  return undefined
}
const barbarians = ['x','s']
const homeTerrain = { x:'Fens',s:'Hills',c:'Hills' }
const enemyHomeTerrain = (state,name,faction) => BY_NAME[name].terrain === homeTerrain[faction] &&
  (faction !== 'x' || !effectiveMarker(state,46,'unshaded')) &&
  (faction !== 's' || !effectiveMarker(state,56,'unshaded')) && (faction !== 'c' || state.markers[76])
const freeOrder = {oneSpace:false,allowedFeat:false,free:true}
const eligibleTownSites = (state,name) => state.land[name].sites.some(site => ['town','hill'].includes(site?.piece))

function freeBattle(state,owner,roll,extra={}) {
  const base = clone(state)
  const result = policyBattleRequests(base,owner,{...freeOrder,...extra},roll)
  return result ? {base,requests:result.requests,note:result.notes.join('. ')} : null
}
function freeIntercept(state,roll) {
  const result = planDuxIntercept(state,roll,freeOrder)
  return result ? {base:result.state,requests:result.requests,note:result.notes.join('. ')} : null
}
function selectPatrol(state,faction,rule,roll) {
  const seats = faction === 's' ? ['hib'] : ['brit','germ']
  const priority = sea => sum(REGIONS.filter(region => region.seas.includes(sea))
    .map(region => totalProsperity(state.land[region.name]) + fortsIn(state,[region.name])))
  const candidates = rule.patrol.from.flatMap(fromSea => rule.patrol.to.map(toSea => ({
    name:fromSea,input:{fromSea,toSea},
    rank:[Number(seats.includes(fromSea)),priority(fromSea),Number(!seats.includes(toSea)),priority(toSea)],
  })))
  return pickBest(candidates,roll,'Mariners by Sea · shift a Patrol')?.input
}
function attackWhereArrived(state,owner,arrivals,id,roll) {
  const requests = []
  for (const name of arrivals) {
    const options = battleEnemies(state,name,owner).filter(enemy => id === 9 ? enemyHomeTerrain(state,name,enemy) : hasStronghold(state.land[name],[enemy]))
      .map(enemy => ({ name,enemy,rank:[scores(state)[enemy].margin,+Boolean(enemyHomeTerrain(state,name,enemy))] }))
    const chosen = pickBest(options,roll,card(id).title+' · opponent')
    if (!chosen) continue
    const config = {name,attacker:owner,defender:chosen.enemy,source:'Battle',...(id === 9 ? {defenderTacticsModifier:-1} :
      {trap:GROUPS.map(([key])=>key),trapSide:'attacker',noDefenderEvade:true})}
    requests.push(config)
  }
  return requests
}
function eventMarchBattle(state,owner,id,roll,options) {
  const enemies = name => (id === 9 ? battleEnemies(state,name,owner).filter(enemy => enemyHomeTerrain(state,name,enemy)) :
    (owner === 'd' ? ['x','s','c'] : ['x','s','d']).filter(enemy => hasStronghold(state.land[name],[enemy]) &&
      (!isBritonFaction(enemy) || isFragmentation(state))))
  const march = planBritonMarch(state,owner,roll,{...freeOrder,free:false,oneSpace:id === 41,targetLimit:id === 9 ? 2 : 1,
    costMultiplier:id === 41 ? 2 : 1,blueConsent:options.blueConsent,
    targetFilter:name=> enemies(name).length > 0,
    targetRank:name => id === 41 ? [Math.max(...enemies(name).map(enemy=>scores(state)[enemy].margin)),
      Number(enemies(name).some(enemy=>enemyHomeTerrain(state,name,enemy)))] : [],
  })
  if (!march) return null
  const requests = attackWhereArrived(march.state,owner,march.arrivals,id,roll)
  return requests.length ? {base:march.state,requests,note:march.desc} : null
}
function estimateEventBattle(state,owner,name,enemy,threshold) {
  const request = {name,attacker:owner,defender:enemy,source:'Battle'}
  const outcome = battleForecast(state,request)
  const allied = !isFragmentation(state) && isBritonFaction(owner) && !isBritonFaction(enemy) ? ['d','c'] : [owner]
  const cargo = sum(GROUPS.filter(([,owner]) => allied.includes(owner)).map(([key])=>loaded(state.land[name],key)))
  const loot = Math.max(0,outcome.attackerPlunder-cargo)+outcome.defenderPlunderRemoved
  const gain = !friendlyControl(state,name,owner) && ownsControlId(outcome.controlAfter,owner) ? state.land[name].pop : 0
  const profitable = owner === 'd' ? outcome.prestigeChange > 0 : gain || loot > threshold
  return {request, outcome, rank:[gain,loot,outcome.defenderLosses-outcome.attackerLosses],profitable}
}
function mistbornBriton(state,owner,roll) {
  const command = owner === 'd' ? 'Train' : 'Muster'
  const stock = availability(state)
  const options = {free:true,spaceLimit:1,regionsOnly:true,troopsOnly:true}
  const plans = []
  for (const {name,terrain} of REGIONS) {
    if (terrain === 'City' || !barbarians.some(enemy => native(state,name,enemy))) continue
    const land = state.land[name]
    const row = owner === 'd'
      ? {space:name,cavalry:Math.min(stock.cav,cavalryTrainCapacity(state,name)),militia:eligibleTownSites(state,name) ? Math.min(stock.mil,2*recruitMilitia(state)) : 0}
      : {space:name,mode:'troops',militia:Math.min(stock.mil,civitatesMusterCapacity(state,name)*recruitMilitia(state)),comitates:0}
    if (!(row.cavalry || row.militia)) continue
    if (owner === 'd' && !fortsIn(state,[name]) && !duxFriendly(state,name) || owner === 'c' && !native(state,name,'c')) continue
    const base = clone(state)
    const note = runCommand(base,{faction:owner,command,feat:'',options,rows:[row]},roll)
    if (!battleTargets(base,owner).includes(name)) continue
    for (const enemy of battleEnemies(base,name,owner).filter(enemy=>barbarians.includes(enemy))) {
      const candidate = estimateEventBattle(base,owner,name,enemy,0)
      plans.push({name,base,note, ...candidate})
    }
  }
  const threshold = owner === 'c' && plans.some(plan => plan.rank[1]>0 && !plan.rank[0]) ? roll(6,'Mistborn · Civitates Plunder threshold') : 0
  const chosen = pickBest(plans.filter(candidate => owner === 'd' ? candidate.profitable : candidate.rank[0] || candidate.rank[1] > threshold),
    roll,'Mistborn · '+command+' and Battle')
  return chosen ? {base:chosen.base,requests:[chosen.request],note:chosen.note} : null
}
function germanus(state,roll) {
  const plans = []
  const options = {free:true,allowFeat:true,reinforceBonus:4}
  for (const {name} of REGIONS) {
    const foes = battleEnemies(state,name,'c').filter(enemy=>barbarians.includes(enemy))
    if (!foes.length) continue
    const rows = []
    const muster = Math.min(availability(state).mil,civitatesMusterCapacity(state,name)*recruitMilitia(state))
    if (muster > 0) rows.push({space:name,mode:'muster',militia:muster})
    for (const origin of BY_NAME[name].adj.filter(origin=>friendlyControl(state,origin,'c'))) {
      const space = state.land[origin]
      const groups = Object.fromEntries(civGroups.map(key=>[key,on(space,key)]))
      if (Object.values(groups).some(Boolean)) rows.push({space:origin,mode:'move',destination:name,...groups})
    }
    const spec = {faction:'c',command:'Battle',feat:'Reinforce',options,rows,battleSpaces:[name]}
    const preview = clone(state)
    if (rows.length) runCommandFeat(preview,spec,()=>1)
    if (!civGroups.some(key=>on(preview.land[name],key))) continue
    for (const enemy of foes) {
      const test = estimateEventBattle(preview,'c',name,enemy,0)
      if (!test.rank.some(value=>value>0)) continue
      plans.push({name,enemy,spec,rank:test.rank})
    }
  }
  const plan = pickBest(plans,roll,'St Germanus · Battle and Reinforce')
  if (!plan) return null
  const note = plan.spec.rows.length ? runCommandFeat(state,plan.spec,roll) : ''
  return {base:state,requests:[{name:plan.name,attacker:'c',defender:plan.enemy,source:'Battle'}],note}
}
function raidExposure(state,name,faction,defender) {
  const sides = defenderSides(state,faction,defender)
  const land = state.land[name]
  const count = piecesByOwner(land,{raiders:false,strongholds:false})
  const capacity = sum(land.sites.filter(site=>site && sides.includes(toOwner(site.piece,site.employer))).map(site =>
    withdrawalCapacity(state,name,site.piece)))
  return Math.max(0,sum(sides.map(owner=>count[owner]))-capacity)
}

export function planBotGrant(state,id,faction,side,roll,options={}) {
  const rule = grantRule(state,id,faction,side)
  if (!rule) return null
  const sideLabel = side === 'single' ? '' : ' · '+side
  const label = card(id).title+sideLabel
  const base = clone(state)
  const chosenPatrol = rule.patrol ? options.input?.fromSea ? options.input : selectPatrol(base,faction,rule,roll) : null
  if (rule.patrol && !chosenPatrol) return null
  const markerNote = setGrantMarkers(base,id,rule,chosenPatrol ?? options.input ?? {}) ||
    (rule.marker ? 'Set the '+rule.marker.type+' marker.' : '')
  const light = side !== 'shaded'
  const note = action => [markerNote,action].filter(Boolean).join(' ')
  const wrap = action => ({option:'event',label,base:action.base ?? base,requests:action.requests ?? [],
    description:note(action.note),...(action.afterRaid ? {afterRaid:action.afterRaid} : {}),
    ...(action.overrides ? {overrides:action.overrides} : {})})
  const handTo = recipient => ({
    option:'event',label,base:state,player:{side,recipient,command:options.command || (id === 23 ? 'Battle' : id === 38 ? 'Intercept' : ''),
      input:chosenPatrol ? {fromSea:chosenPatrol.fromSea,toSea:chosenPatrol.toSea} : {},
      instructions:[NAMES[recipient]+' may take the granted action. Choose its targets and preview the result.']},
  })

  if (id === 57) {
    const selected = proposeBot(state,[],{myrddin:true,blueConsent:options.blueConsent},roll)
    if (!selected || selected.option === 'pass' || selected.mode === 'guide') return null
    return wrap({base:selected.after ?? selected.base,requests:selected.requests,note:selected.title+'. '+selected.description,overrides:{[faction]:true}})
  }
  if ([9,41].includes(id) && light && isBritonFaction(faction)) {
    const march = eventMarchBattle(base,faction,id,roll,options)
    return march ? wrap(march) : null
  }
  if (id === 23) {
    if (botHasHuman(state,'c')) return handTo('c')
    const result = germanus(base,roll)
    return result ? wrap(result) : null
  }
  if (id === 60 || !light && [9,37,38,52,58].includes(id)) {
    const recipient = options.recipient ?? (id === 58 ? 's' : [37,38].includes(id) ? 'x' : faction)
    if (!barbarians.includes(recipient)) return null
    if (botHasHuman(state,recipient)) return handTo(recipient)
    const raid = planRaid(base,recipient,roll,{free:id !== 52,oneSpace:[9,52].includes(id),allowedFeat:false,
      ...(id === 9 ? {onlyTargets:name=>Boolean(BY_NAME[name])} : {}),
      ...(id === 52 ? {forceRaidBattle:true,onlyTargets:name=>battleEnemies(base,name,recipient,'Raid').length > 0,
        targetRank:name=>[Math.max(0,...battleEnemies(base,name,recipient,'Raid').map(enemy=>raidExposure(base,name,recipient,enemy)))]} : {})})
    const afterRaid = id === 9 && raid.targets?.[0] && base.land[raid.targets[0].name] ?
      {type:'swift-return',faction:recipient,name:raid.targets[0].name} : null
    return raid.state || markerNote ? wrap({base:raid.state,requests:raid.requests,
      note:[raid.description,...(raid.notes ?? [])].filter(Boolean).join(' '),afterRaid}) : null
  }
  if (id === 41 && !light) {
    const result = freeBattle(base,faction,roll,{requireDestruction:true})
    return result ? wrap(result) : null
  }

  let recipients = [...new Set(rule.choices.map(([owner])=>owner))]
  if (options.recipient) recipients = recipients.filter(owner=>owner === options.recipient)
  else if (recipients.includes(faction)) recipients = [faction,...recipients.filter(owner=>owner !== faction)]
  if (!options.recipient && (id === 58 && light || id === 38 && light && faction === 'd')) {
    recipients = recipients.filter(owner=>owner === faction)
  }
  if (id === 33 && (isFragmentation(base) || !isBritonFaction(faction))) return null
  for (const recipient of recipients) {
    const selection = rule.choices.filter(([owner,command])=>owner === recipient && (!options.command || options.command === command)).map(([,command])=>command)
    if (!selection.length) continue
    if (botHasHuman(base,recipient)) {
      if (id === 16 || id === 38 && recipient === 'd' || id === 52) return handTo(recipient)
      continue
    }
    if (id === 52 && light) {
      const result = mistbornBriton(base,recipient,roll)
      if (result) return wrap(result)
      continue
    }
    if (recipient === 'd' && selection.includes('Intercept')) {
      const intercept = freeIntercept(base,roll)
      if (intercept) return wrap(intercept)
      if ([38,58].includes(id)) continue
    }
    if (selection.includes('Battle')) {
      const battle = freeBattle(base,recipient,roll)
      if (battle) {
        if (id === 33) battle.requests = battle.requests.filter(({name,defender})=>barbarians.includes(defender) &&
          on(base.land[name],'cav') && (on(base.land[name],'com') || on(base.land[name],'mil')))
        if (battle.requests.length) return wrap({...battle,note:battle.requests.map(request=>request.name+' against '+NAMES[request.defender]).join('; ')})
      }
    }
    if (selection.includes('March')) {
      const march = planBritonMarch(base,recipient,roll,{...freeOrder,blueConsent:options.blueConsent})
      if (march) return wrap({base:march.state,note:march.desc})
    }
  }
  return markerNote && ![38,58].includes(id) ? wrap({note:''}) : null
}

export function eventPlan(state, faction, roll, options = {}) {
  const info = card(state.current)
  if (!info || eventBlocked(info,faction) || !eventPrerequisites(faction,state)) return null
  if (info.id === 73 && faction === 's') {
    const raid = planRaid(state,'s',roll,{free:true,capOverride:5,diceOverride:3})
    if (raid.guide) return {title:info.title,guide:raid.guide}
    return {
      option:'event',label:info.title,description:[raid.description,...raid.notes].filter(Boolean).join(' '),
      base:raid.state ?? state,requests:raid.requests ?? [],afterRaid:{type:'conspiratio-barbarica',saxonMayRaid:true},
    }
  }
  if (info.id === 74 && faction === 'x') return saxonRevolt(state,roll)
  const kind = isBritonFaction(faction) ? 'unshaded' : 'shaded'
  const side = info.id === 6 && faction === 'c' ? 'shaded' : eventSides(info.id).includes(kind) ? kind : eventSides(info.id)[0]
  if (grantRule(state,info.id,faction,side)) return planBotGrant(state,info.id,faction,side,roll,options)
  if (info.id === 10 && side === 'shaded' && eventChoices(state,10,faction,side).fields.length) {
    return {option:'event',label:info.title+' · shaded',player:{side,instructions:['Choose which Saxon Foederati groups to pay. The app resolves payments and any revolts.']}}
  }
  if (state.current === 15 && faction === 'c') {
    if (isFragmentation(state)) return null
    const totals = boardTotals(state)
    if (totals.pop.c > 20 && totals.total + state.tracks.prestige > 30) return null
  }
  if (state.current === 15) {
    const briton = kind === 'unshaded'
    const priority = REGIONS.filter(({name,terrain}) => terrain !== 'City' && (briton
      ? state.land[name].pros.some(row => row < state.land[name].pop)
      : control(state,name) && control(state,name) !== faction && totalProsperity(state.land[name]) > 0))
    if (!priority.length || (briton && goldAvailable(state) <= 0)) return null
    const added = []
    const removed = []
    const used = new Set()
    const max = briton ? 6 : 4
    for (let i = 0; i < max; i++) {
      const candidates = priority.filter(r => !used.has(r.name)).map(r => ({name:r.name,rank:[faction === 'd' ? native(state,r.name,'d') : faction === 'c' ? +friendlyControl(state,r.name,'c') : 0]}))
      const chosen = pickBest(candidates,roll,'Fickle Weather')
      if (!chosen) break
      used.add(chosen.name)
      if (briton) {
        if (!addProsperity(state,chosen.name,1)) break
        added.push(chosen.name)
      } else {
        removeProsperity(state.land[chosen.name],1)
        removed.push(chosen.name)
      }
    }
    return { option:'event', label:`Fickle Weather · ${kind}`, description:added.length ? `Add 1 Prosperity to ${added.join(', ')}.` : `Remove 1 Prosperity from ${removed.join(', ')}.` }
  }
  const pick = (candidates,label) => pickBest(candidates,roll,label)
  let input = selectBotEventInput(state,info.id,faction,side,pick)
  if (input === undefined) input = verifiedEventInput(state,info.id,faction,side,roll)
  if (input === undefined) input = botEventInput(state,info.id,faction,side,roll)
  if (input === undefined) {
    const descriptor = eventChoices(state,info.id,faction,side)
    if (!descriptor || descriptor.needsBattle || descriptor.fields.length) return null
    input = {}
  }
  if (input === null) return null
  const chosen = input._side ?? side
  if (!hasEventEffect(state,info.id,faction,chosen,input)) return null
  const requests = eventBattleRequests(state,info.id,faction,chosen,input)
  const description = runEvent(state,info.id,faction,chosen,input,roll)
  return {option:'event',label:info.title+(chosen === 'single' ? '' : ' · '+chosen),description,requests}
}

export function botPivotalChoice(state, eligible = pivotalOptions(state)) {
  const visible = [card(state.current),card(state.next)].filter(Boolean)
  const stock = availability(state)
  const margins = shieldsOf(state)
  const qualifies = {
    s: () => !state.eligibility.includes('x') && stock.sr + state.tracks.niall >= 20 &&
      (stock.fort > 0 || stock.cav + state.pools.casualties + state.pools.out >= 3),
    x: () => REGIONS.map(({name}) => recalledSaxons(state,name))
      .sort((a,b) => b-a).slice(0,3).reduce((total,n) => total+n,0) > scenarioInfo(state).epochs-state.epoch,
    d: () => isFragmentation(state) || state.tracks.wealth-state.tracks.prestige > 5 || margins.c-margins.d > 20,
    c: () => stock.hill > 0 && REGIONS.some(({name,terrain}) => terrain === 'Hills' &&
      friendlyControl(state,name,'c') && state.land[name].sites.includes(null)),
  }
  return ['s','x','d','c'].find(faction => eligible.includes(faction) && !botHasHuman(state,faction) &&
    !visible.some(info => info.order.slice(0,2).includes(faction) && shield(info.symbols[faction])) &&
    qualifies[faction]()) ?? null
}

export function proposeBot(state, scripted = [], choices = {}, grantRoll = null) {
  const faction = activeFaction(state)
  if (!faction || botHasHuman(state,faction)) throw new Error('A Non-player faction is not active.')
  const draft = clone(state)
  const dice = []
  const roll = grantRoll ?? makeRoller(draft,dice,scripted)
  const allowance = choices.myrddin ? {oneSpace:false,allowedFeat:true} : botAllowance(state)
  if (faction === 'c') allowance.reinforceConsent = choices.myrddin ? false : choices.reinforceConsent
  if (faction === 'd' && state.imperium === 'ac' && state.tracks.blue) {
    const edges = scores(state)
    allowance.blueConsent = botHasHuman(state,'c') ? Boolean(choices.blueConsent)
      : edges.d.margin < edges.c.margin
  }
  const current = card(state.current)
  const next = card(state.next)
  const currentShield = shield(current.symbols[faction])
  const eventAllowed = !choices.myrddin && actionOptions(state).includes('event') &&
    (state.current >= 73 && state.current <= 76 || !eventBlocked(current,faction))
  const rule = {s:'8.5',x:'8.6',c:'8.7',d:'8.8'}[faction]
  const priorityEvent = {s:'8.5.2',x:'8.6.2',c:'8.7.2',d:'8.8.2'}[faction]
  const optionalEvent = {s:'8.5.5',x:'8.6.6',c:'8.7.5',d:'8.8.5'}[faction]
  const explain = (plan,section,detail) => ({...plan,decision:{rule:'§'+section,detail}})
  const guide = (title, instructions, extra = {}) => ({ mode:'guide', faction, title, instructions, dice, rng:draft.rng, ...extra })
  const actionSlot = option => option === 'command' && allowance.oneSpace ? 'limited' : option === 'feat' && allowance.oneSpace ? 'limitedFeat' : option
  const auto = (option, title, detail, proposed = draft, overrides = {}) => {
    proposed.rng = grantRoll ? state.rng : draft.rng
    const recordAs = actionSlot(option)
    if (!choices.myrddin) finishAction(proposed,recordAs,title,detail,dice,overrides)
    return {mode:'auto', faction, title, description:detail, after:proposed, option:recordAs,dice}
  }
  const battlePlan = (title,requests,description,feat,base = draft) => {
    base.rng = grantRoll ? state.rng : draft.rng
    return {mode:'battle',faction,title,description,dice,requests,rng:draft.rng,base,option:actionSlot(feat ? 'feat' : 'command')}
  }
  const tryPolicyBattle = interceptBattles => {
    const base = clone(draft)
    const chosen = policyBattleRequests(base,faction,{...allowance,interceptBattles},roll)
    if (!chosen) return null
    if (chosen.consent) return chosen.consent
    const plan = battlePlan(`Battle${chosen.feat ? ' + '+chosen.feat : ''}`,chosen.requests,chosen.notes.join('. '),chosen.feat,base)
    if (interceptBattles) return explain(plan,'8.8.1','Intercept could engage enough Raiders, but would add no movement or Feat. Resolve Battle.')
    const [section,detail] = {
      d:['8.8.3','A Battle forecast gains Prestige.'],
      c:['8.7.1','A Battle forecast gains Control or exceeds the Plunder roll.'],
      x:['8.6.4','The Warbands can remove the last enemy unit or Assault.'],
      s:['8.5.3','A Scotti Warband can Trap, attempt Ambush, or Assault.'],
    }[faction]
    return explain(plan,section,detail + (chosen.feat === 'Ravage' ? ' Ravage lets the Warbands carry extra Plunder.' : ''))
  }
  const resolveEvent = () => {
    const plan = eventPlan(draft,faction,roll,allowance)
    if (!plan) return null
    let result
    if (plan.guide) result = guide(plan.title,plan.guide,{suggested:'event'})
    else if (plan.player) result = {mode:'player-event',faction,title:plan.label,player:plan.player,dice,rng:draft.rng}
    else if (plan.requests?.length || plan.afterRaid) {
      result = {...battlePlan(plan.label,plan.requests,plan.description,null,plan.base),option:'event',afterRaid:plan.afterRaid,overrides:plan.overrides}
    } else result = auto(plan.option,plan.label,plan.description,plan.base ?? draft,plan.overrides)
    if (isPivotalCard(current.id)) return explain(result,'8.1.3',`The declared Pivotal #${current.id} resolves first.`)
    if (currentShield) return explain(result,priorityEvent,`Revealed Event #${current.id} shows a Shield for ${NAMES[faction]}.`)
    return explain(result,optionalEvent,`The Event check selected effective Event #${current.id}.`)
  }
  if (!choices.myrddin && state.current >= 73 && state.current <= 76 && !state.acts.length) {
    return resolveEvent() || explain(auto('event',current.title,'The declared Pivotal Event resolved with no further board changes.'),'8.1.3','The Pivotal was declared.')
  }
  if (!choices.myrddin && faction === 'd' && state.imperium === 'ac' && state.tracks.blue &&
      botHasHuman(state,'c') && typeof choices.blueConsent !== 'boolean') {
    return {mode:'consent',faction,title:'Briton Resources',question:'Let Dux spend Briton Resources this action?',
      description:'At Autonomy under Civilian Dominance the Civitates decide whether Dux can use the shared economy (§6.8.2).',
      key:'blueConsent'}
  }
  if (faction === 'd') {
    const intercept = planDuxIntercept(draft,roll,allowance)
    if (intercept?.battleInstead) {
      const battle = tryPolicyBattle(intercept.requests)
      if (battle) return battle
    } else if (intercept) return explain(battlePlan(`Intercept${intercept.feat ? ' + '+intercept.feat : ''}`,intercept.requests,intercept.notes.join('. '),intercept.feat,intercept.state),
      '8.8.1','The Raiders that Dux can engage in Friendly Control exceed the 2D6 roll.')
  }
  if (['x','s'].includes(faction)) {
    const raider = faction+'r'
    const band = faction+'w'
    const onMap = sum(REGIONS.map(({name}) => on(state.land[name],raider)))
    const clear = REGIONS.filter(({name,terrain}) => terrain === 'Clear' && on(state.land[name],raider)).length
    const plunder = sum(REGIONS.map(({name}) => loaded(state.land[name],raider) + loaded(state.land[name],band)))
    const returnReason = clear >= 2 ? `Raiders occupy ${clear} Clear Regions.` : onMap >= 15 ? `${onMap} Raiders are on the map.` :
      plunder > 2 && plunder > roll(6,'Return · first die') + roll(6,'Return · second die') ? `${plunder} Plunder exceeds the 2D6 roll.` : ''
    if (returnReason) {
      const returning = barbarianReturn(draft,faction,roll,allowance)
      if (returning) {
        return explain(auto(returning.feat ? 'feat' : 'command',`Return${returning.feat ? ' + '+returning.feat : ''}`,returning.notes.join('. ')),rule+'.1',returnReason)
      }
    }
  }
  if (faction === 'c') {
    const battle = tryPolicyBattle()
    if (battle) return battle
  }
  if (eventAllowed && currentShield) {
    const result = resolveEvent()
    if (result) return result
  }
  if (!choices.myrddin && next && next.order.slice(0,2).includes(faction) && shield(next.symbols[faction])) {
    return explain(auto('pass','Pass',`Priority Event #${next.id} shows ${NAMES[faction]} in the first two positions.`),priorityEvent,
      `The next revealed card has a Shield in position ${next.order.indexOf(faction)+1}.`)
  }
  if (faction === 'c') {
    if (roll(6,'Civitates March decision') <= 2 && state.tracks.blue > 10) {
      const marching = planBritonMarch(draft,'c',roll,allowance)
      if (marching) return explain(auto(marching.feat ? 'feat' : 'command',marching.title,marching.desc,marching.state),
        '8.7.3','The D6 roll is 1 or 2, blue Resources exceed 10, and troops can move.')
    }
    const pool = availability(state)
    const availableTroops = pool.mil+pool.com
    const musterRoll = roll(6,'Civitates Muster · first die')+roll(6,'Civitates Muster · second die')
    const tryMuster = availableTroops > musterRoll || civMusterImprovesControl(state)
    if (!tryMuster && eventAllowed && !currentShield) {
      const result = resolveEvent()
      if (result) return result
    }
    const notes = tryMuster ? civitatesMuster(draft,roll,allowance) : []
    const command = notes.length ? 'Muster' : 'Trade'
    if (!notes.length) notes.push(...civitatesTrade(draft,roll,allowance))
    if (!notes.length) return explain(auto('pass','Pass','Neither Muster nor Trade met its printed requirements.'),'8.7.6','Trade has no eligible Town or restoration to add.')
    let feat = null
    if (allowance.allowedFeat) {
      const rule = civitatesRule(draft,roll)
      if (rule.length) {
        feat = 'Rule'
        notes.push(...rule)
      } else {
        const invitation = botInvite(draft,'c',roll)
        if (invitation) {
          feat = 'Invite'
          notes.push(invitation)
        }
      }
    }
    const plan = auto(feat ? 'feat' : 'command',`${command}${feat ? ' + '+feat : ''}`,notes.join('. '))
    if (command === 'Trade') return explain(plan,'8.7.6','The preceding Battle, Event, March and Muster checks yielded no action. Trade can collect Resources or restore Prosperity.')
    return explain(plan,'8.7.4',availableTroops > musterRoll ? `${availableTroops} Available Troops exceed the 2D6 total of ${musterRoll}.` : 'Muster can add Briton Control.')
  }
  if (faction === 'd') {
    const battle = tryPolicyBattle()
    if (battle) return battle
    if (canTrain(state,allowance.oneSpace,allowance.blueConsent)) {
      const training = duxTrain(draft,roll,allowance)
      if (training.guided) return explain(guide('Dux · Train',[
        ...(training.placements?.length ? ['Projected Cavalry placements: ' + training.placements.join('; ')] : []),
        ...(training.notes || []),training.guided,
      ],{suggested:'feat',command:'Train'}),'8.8.4','Dux can afford to place at least two Cavalry.')
      return explain(auto(training.feat ? 'feat' : 'command',`Train${training.feat ? ' + '+training.feat : ''}`,[...training.placements,...training.notes].join(' ')),
        '8.8.4','Dux can afford to place at least two Cavalry.')
    }
    if (eventAllowed && roll(6,'Dux Event choice') <= 4 && !currentShield) {
      const result = resolveEvent()
      if (result) return result
    }
    const march = planBritonMarch(draft,'d',roll,allowance)
    if (march) return explain(auto(march.feat ? 'feat' : 'command',march.title,march.desc,march.state),
      '8.8.6','A priority destination can be reached within the D4 origin and destination limits.')
    return explain(auto('pass','Pass','The verified checks yielded no available Command or Event.'),'8.8.6','No affordable March from an eligible origin met the priorities.')
  }

  const hasWarbands = REGIONS.some(({name}) => on(state.land[name],faction+'w'))
  if (hasWarbands && faction === 'x' && allowance.allowedFeat && roll(6,'Saxons March decision') <= 2) {
    const march = planBarbarianMarch(draft,faction,roll,allowance)
    if (march?.feat) return explain(auto('feat',march.title,march.desc,march.state),'8.6.3','The March roll is 1 or 2 and Settle can add a piece or Population.')
    if (settleWithoutReturnChoices(draft,faction,false).length) {
      const returning = clone(draft)
      const result = barbarianReturn(returning,faction,roll,{...allowance,forSettle:true})
      if (result?.feat) return explain(auto('feat','Return + '+result.feat,result.notes.join('. '),returning),'8.6.3','Settle can add something without moving Warbands, so Return accompanies it.')
    }
  }
  if (hasWarbands) {
    const battle = tryPolicyBattle()
    if (battle) return battle
    if (faction === 's' && availability(state).sw === 0) {
      const march = planBarbarianMarch(draft,faction,roll,allowance)
      if (march) return explain(auto(march.feat ? 'feat' : 'command',march.title,march.desc,march.state),'8.5.4','No Warbands remain Available, and existing Warbands can March.')
    }
  }
  const freeRaiders = availability(state)[faction+'r']
  if (eventAllowed && (freeRaiders+(faction === 's' ? state.tracks.niall : 0) < (faction === 's' ? 25 : 20) || roll(6,'Raid or Event') >= 5) && !currentShield) {
    const result = resolveEvent()
    if (result) return result
  }
  if (freeRaiders || faction === 's' && state.tracks.niall) {
    const raid = planRaid(draft,faction,roll,allowance)
    const raidRule = faction === 'x' ? '8.6.5' : '8.5.4'
    const raidReason = 'Raiders and an eligible route are available for the selected target.'
    if (raid.guide) return explain(guide(`${NAMES[faction]} · Raid${raid.feat ? ' + '+raid.feat : ''}`,raid.guide,{
      suggested:actionSlot(raid.feat ? 'feat':'command'),command:'Raid',
    }),raidRule,raidReason)
    const raidLabel = `Raid${raid.feat ? ' + '+raid.feat : ''}`
    const raidDescription = [raid.description,...raid.notes].join(' ')
    if (raid.requests?.length) return explain(battlePlan(raidLabel,raid.requests,raidDescription,raid.feat,raid.state),raidRule,raidReason)
    if (raid.state) return explain(auto(raid.feat ? 'feat':'command',raidLabel,raidDescription,raid.state),raidRule,raidReason)
  }
  if (hasWarbands && faction === 's') {
    const march = planBarbarianMarch(draft,faction,roll,allowance)
    if (march) return explain(auto(march.feat ? 'feat' : 'command',march.title,march.desc,march.state),'8.5.6','No Raid target qualifies, and Warbands can move to a priority destination.')
  }
  return explain(auto('pass','Pass','No Raid target met the available Renown and targeting requirements.'),faction === 'x' ? '8.6.5' : '8.5.6','No eligible target could be reached with the available forces and Renown.')
}

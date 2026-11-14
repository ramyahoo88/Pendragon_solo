import { BY_NAME, GROUP, NAMES, PIECES } from './data.mjs'
import { addProsperity, changeTrack, clone, control, ensure, friendlyControl, goldAvailable, groupLabel, isFragmentation, isRaider, loaded, on, plunderTo, toOwner, totalProsperity } from './position.mjs'

const briton = faction => faction === 'd' || faction === 'c'
const humanSide = (state,faction) => (state.humans ?? [state.human]).includes(faction)
const activeSide = (state,number,side) => state.markers[number]?.side === side
const present = units => units.filter(unit => !unit.dead && !unit.evaded)
const inField = units => present(units).filter(unit => unit.site === null)
const fromNation = key => GROUP[key].piece[0]
const isBand = key => GROUP[key].piece === 'xw' || GROUP[key].piece === 'sw'
const unitStrength = unit => isRaider(unit.key) || unit.key === 'mil' ? 2 : 4
const qty = value => String(value / 4)
const pieceOrder = { cav:0, com:1, xw:2, sw:2, mil:3, xr:4, sr:4 }
const siteOrder = { fort:0, town:1, hill:2, xs:3, ss:3 }
const byFriendlyPiece = (a,b) => pieceOrder[GROUP[a.key].piece] - pieceOrder[GROUP[b.key].piece] || Number(b.gold) - Number(a.gold) || a.id.localeCompare(b.id)
const byLossPriority = (a,b) => pieceOrder[GROUP[b.key].piece] - pieceOrder[GROUP[a.key].piece] || Number(a.gold)-Number(b.gold) || a.id.localeCompare(b.id)
const commandBattle = source => source === 'Battle' || source === 'Event Battle'

export class BattleChoice extends Error {
  constructor(prompt) {
    super(prompt.title)
    this.prompt = prompt
  }
}
function battleSides(state, attacker, defender) {
  const shared = !isFragmentation(state) && briton(attacker) !== briton(defender)
  const side = faction => shared && briton(faction) ? ['d','c'] : [faction]
  return [side(attacker),side(defender)]
}
export function battleEnemies(state,name,attacker,source = 'Battle') {
  const land = state.land[name]
  if (!land) return []
  const order = ['d','c','x','s'].filter(faction => faction !== attacker)
  const factions = order.filter(faction => {
    if (activeSide(state,33,'shaded') && commandBattle(source) && [attacker,faction].includes('c') && [attacker,faction].includes('s')) return false
    if (source === 'Intercept' && !['x','s'].includes(faction)) return false
    if (source === 'Intercept') return on(land,faction+'r') > 0
    const [,defenders] = battleSides(state,attacker,faction)
    return Object.keys(GROUP).some(key => defenders.includes(GROUP[key].owner) && on(land,key)) ||
      land.sites.some(site => site && defenders.includes(toOwner(site.piece,site.employer)))
  })
  if (!briton(attacker) && !isFragmentation(state) && factions.includes('d') && factions.includes('c')) {
    return factions.filter(f => f !== 'c')
  }
  return factions
}
export function battleTargets(state,faction) {
  return Object.keys(BY_NAME).filter(name => {
    const land = state.land[name]
    return Object.keys(GROUP).some(key => !isRaider(key) && GROUP[key].owner === faction && on(land,key)) && battleEnemies(state,name,faction).length > 0
  })
}
export function strongholdStats(state,name,piece) {
  if (name === 'Eboracum') return { escalade:2,garrison:3,capacity:6,coupCapacity:4 }
  if (name === 'Londinium') return { escalade:2,garrison:4,capacity:8,coupCapacity:4 }
  if (piece === 'town') return { escalade:2,garrison:2,capacity:4,coupCapacity:4 }
  if (piece === 'fort') return { escalade:4,garrison:1,capacity:2,coupCapacity:2 }
  if (piece === 'hill') return {
    escalade:activeSide(state,21,'unshaded') ? 4 : 2,
    garrison:activeSide(state,28,'shaded') && !activeSide(state,21,'unshaded') ? 0 : 1,
    capacity:2,coupCapacity:2,
  }
  return { escalade:2,garrison:0,capacity:2,coupCapacity:2 }
}
function landTokens(land, owners, prefix, subset) {
  return Object.entries(GROUP).filter(([,group]) => owners.includes(group.owner)).flatMap(([key,group]) => {
    const [count,carries] = subset ? (subset[key] ?? [0,0]) : land.units[key]
    ensure(Number.isInteger(count) && Number.isInteger(carries) && carries >= 0 && carries <= count &&
      count <= on(land,key) && carries <= loaded(land,key) && count-carries <= on(land,key)-loaded(land,key),
    'Participating units must be present in the space.')
    return Array.from({length:count},(_,index) => ({
      id:prefix+key+'-'+index,key,owner:group.owner,gold:index < carries,dead:false,evaded:false,ambush:false,site:null,
    }))
  })
}
function homeTerrain(state,name,unit) {
  const terrain = BY_NAME[name].terrain
  const nation = fromNation(unit.key)
  if (nation === 'x') return terrain === 'Fens' && !activeSide(state,46,'unshaded')
  if (nation === 's') return terrain === 'Hills' && !activeSide(state,56,'unshaded')
  return ['mil','com'].includes(unit.key) && terrain === 'Hills' && Boolean(state.markers[76])
}
export function withdrawalCapacity(state,name,piece) {
  const region = BY_NAME[name]
  const ruined = region.terrain !== 'City' && totalProsperity(state.land[name]) === 0 && activeSide(state,64,'shaded')
  return ruined ? (piece === 'town' ? 2 : 1) : strongholdStats(state,name,piece).capacity
}
function favouredRemoval(units,room,cost,forcedFirst=null) {
  const result = []
  const ordered = [...units].sort(byLossPriority)
  const scores = Array.from({length:room+1},() => null)
  if (forcedFirst) {
    if (room < cost(forcedFirst)) return result
    room -= cost(forcedFirst)
    result.push(forcedFirst)
    ordered.splice(ordered.indexOf(forcedFirst),1)
  }
  scores[0] = []
  for (const unit of ordered) {
    const value = cost(unit)
    if (!value || value > room) continue
    for (let j = room; j >= value; j--) {
      if (!scores[j] && scores[j-value]) scores[j] = [...scores[j-value],unit]
    }
  }
  for (let n = room; n >= 0; n--) {
    if (scores[n]) return [...result,...scores[n]]
  }
  return result
}
function kill(unit, state, land) {
  unit.dead = true
  land.units[unit.key][0]--
  if (unit.gold) land.units[unit.key][1]--
  if (unit.key === 'cav' && !activeSide(state,1,'unshaded')) state.pools.casualties++
}
function labelUnit(unit) { return groupLabel(unit.key)+(unit.gold ? ' · carrying Plunder' : '') }
function distinctChoices(units) {
  const seen = new Set()
  return units.filter(unit => {
    const key = unit.key+':'+unit.gold
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
function scoreLoss(units,cost) { return units.reduce((n,unit) => n+cost(unit),0) }

export function runBattle(state,config,roll,reply = null) {
  const {name,attacker,defender} = config
  const braveFaction = config.braveFaction ?? (activeSide(state,41,'shaded') ? state.markers[41].faction : null)
  const land = state.land[name]
  ensure(land && battleEnemies(state,name,attacker,config.source).includes(defender), 'Choose an enemy faction in the Battle space.')
  const [attacking,defending] = battleSides(state,attacker,defender)
  const civilBattle = !isFragmentation(state) && attacking.every(briton) && defending.every(briton)
  const battleMilitia = (units,primary) => activeSide(state,16,'shaded') && primary === 'd' ? units.filter(unit => unit.key !== 'mil') : units
  const participants = battleMilitia(landTokens(land,attacking,'a-',config.attackers),attacker)
  const defenders = battleMilitia(landTokens(land,defending,'d-',config.defenders),defender)
  ensure(participants.length,'The attacking side must have participating Units.')
  ensure(!commandBattle(config.source) || participants.some(unit => unit.owner === attacker && !isRaider(unit.key)), 'A Battle Command requires a Troop of the executing faction.')
  const sites = land.sites.flatMap((site,index) =>
    site && defending.includes(toOwner(site.piece,site.employer))
      ? [{ ...site,...strongholdStats(state,name,site.piece),index,owner:toOwner(site.piece,site.employer),used:false,destroyed:false }]
      : [])
  const details = []
  const destroyed = []
  const destroyedPieces = []
  const fought = new Set()
  const prestigeBefore = state.tracks.prestige
  const renownBefore = state.tracks[attacker] ?? 0
  const choose = (stage,title,options,defaultValue,ask) => {
    if (!ask || !reply || options.length < 2) return defaultValue
    const request = { stage, title, options, defaultValue, progress:[...details] }
    const value = reply(request)
    ensure(options.some(option => option.value === value), 'The Battle choice no longer matches this position.')
    return value
  }
  const pickUnit = (stage,title,units,preferred,ask,allowNone=false) => {
    const options = distinctChoices(units)
    const menu = options.map(unit => ({value:unit.id,label:labelUnit(unit)}))
    if (allowNone) menu.push({value:'none',label:'Done with this step'})
    const picked = choose(stage,title,menu,(options.find(unit => preferred && unit.key === preferred.key && unit.gold === preferred.gold)?.id ?? 'none'),ask)
    return options.find(unit => unit.id === picked)
  }
  const omens = { field:new Set(), assault:new Set() }
  const useOmens = (phase, eligibleUnits) => {
    const holder = state.omens?.holder
    if (!holder || holder === attacker || !eligibleUnits.length || !humanSide(state,holder) || config.ignoreTactics) return
    const decision = choose(phase,'Discard Omens to halve chosen Units?',[
      {value:'skip',label:'Keep Omens'}, {value:'play',label:'Discard Omens for this fight'},
    ],'skip',true)
    if (decision !== 'play') return
    const remaining = [...eligibleUnits]
    for (;;) {
      const unit = pickUnit(phase,'Choose a Unit to halve',remaining,null,true,true)
      if (!unit) break
      omens[phase].add(unit.id)
      remaining.splice(remaining.indexOf(unit),1)
    }
    state.omens = null
    details.push(`Omens halves ${omens[phase].size} Units during ${phase === 'field' ? 'Field Battle' : 'Assault'}.`)
  }
  const affectedWarband = unit => activeSide(state,64,'unshaded') && ['xw','sw'].includes(unit.key) && !land.sites.some(site => site?.piece === fromNation(unit.key)+'s' && toOwner(site.piece,site.employer) === unit.owner)
  const forceOf = unit => participants.includes(unit) ? participants : defenders
  const alliedStriker = unit => activeSide(state,33,'unshaded') && ['cav','mil','com'].includes(unit.key) &&
    present(forceOf(unit)).some(other => other.owner !== unit.owner && ['cav','mil','com'].includes(other.key))
  const fieldUnit = unit => {
    let value = unitStrength(unit)
    if (unit.key === 'mil' && (activeSide(state,28,'unshaded') && land.sites.some(site => site?.piece === 'hill') ||
      activeSide(state,16,'unshaded') && present(forceOf(unit)).some(other => ['cav','dxw','dsw'].includes(other.key)))) value = 4
    if (activeSide(state,46,'shaded') && unit.key === 'cav' && BY_NAME[name].terrain === 'Fens') value = 2
    if (affectedWarband(unit)) value /= 2
    return value / (omens.field.has(unit.id) ? 2 : 1)
  }
  // One damage unit is a quarter loss. Multiply by two again when some effects stack.
  const strikeOf = (unit,phase) => {
    if (phase === 'field') return fieldUnit(unit)*2+(alliedStriker(unit) ? (omens.field.has(unit.id) ? 2 : 4) : 0)
    let value = 8+(alliedStriker(unit) ? 4 : 0)
    if (affectedWarband(unit)) value /= 2
    if (omens.assault.has(unit.id)) value /= 2
    return value
  }
  const lossOf = (unit,phase) => {
    let value = phase === 'field' ? fieldUnit(unit)*2 : 8 / (affectedWarband(unit) ? 2 : 1) / (omens.assault.has(unit.id) ? 2 : 1)
    if (phase === 'field' && config.shieldWall && unit.owner === 'x' && unit.key === 'xw') value *= 2
    if (phase === 'escalade' && isRaider(unit.key)) value /= 2
    if (phase !== 'field' && braveFaction === unit.owner && participants.includes(unit) && !isRaider(unit.key)) value *= 2
    return value
  }
  const markFought = units => { for (const unit of units) if (unit.key === 'cav') fought.add(unit.id) }
  function removeLosses(pool,budget,phase,stage,distributed=false,first=null,weights=null) {
    if (!budget || !pool.length) return 0
    weights ??= new Map(pool.map(unit => [unit,lossOf(unit,phase)]))
    const cost = unit => weights.get(unit)*(unit === first && braveFaction !== unit.owner ? 2 : 1)
    const before = budget
    let remaining = [...pool]
    if (first) {
      if (budget < cost(first)) return budget
      budget -= cost(first)
      kill(first,state,land)
      remaining = remaining.filter(unit => unit !== first)
    }
    if (distributed && remaining.some(unit => unit.owner === 'd') && remaining.some(unit => unit.owner === 'c')) {
      // Allocate the shared Briton loss as close to half as available unit weights permit.
      let best = null
      for (let want = 0; want <= budget; want++) {
        const dux = favouredRemoval(remaining.filter(unit => unit.owner === 'd'),want,cost)
        const civ = favouredRemoval(remaining.filter(unit => unit.owner === 'c'),budget-want,cost)
        const red = scoreLoss(dux,cost)
        const blue = scoreLoss(civ,cost)
        const quality = [red+blue,-Math.abs(red-blue),red]
        if (!best || quality.some((value,i) => value > best.quality[i] && quality.slice(0,i).every((v,j) => v === best.quality[j]))) best = {quality,dux:dux,civ}
      }
      if (best) {
        const red = scoreLoss(best.dux,cost)
        const blue = scoreLoss(best.civ,cost)
        removeLosses(remaining.filter(unit => unit.owner === 'd'),red,phase,stage,false,null,weights)
        removeLosses(remaining.filter(unit => unit.owner === 'c'),blue,phase,stage,false,null,weights)
        return before-budget+red+blue
      }
    }
    while (budget > 0 && remaining.length) {
      const suggested = favouredRemoval(remaining,budget,cost)
      if (!suggested.length) break
      const maxLoss = scoreLoss(suggested,cost)
      const choices = remaining.filter(unit => cost(unit) <= maxLoss && cost(unit)+scoreLoss(favouredRemoval(remaining.filter(x => x !== unit),budget-cost(unit),cost),cost) === maxLoss)
      const unit = pickUnit(stage,`Allocate ${qty(budget/2)} losses`,choices,suggested[0],choices.some(piece => humanSide(state,piece.owner)) && !config.ignoreTactics)
      kill(unit,state,land)
      remaining = remaining.filter(other => other !== unit)
      budget -= cost(unit)
    }
    return before-budget
  }
  const traps = unit => (config.trap?.includes(unit.key) && (!config.trapSide || config.trapSide === 'attacker' && participants.includes(unit) || config.trapSide === 'defender' && defenders.includes(unit))) ||
    (activeSide(state,56,'shaded') && attacker === 's' && BY_NAME[name].terrain === 'Hills' && commandBattle(config.source) && unit.key === 'sw')
  function tactics(units,isAttacker) {
    if (config.ignoreTactics) {
      if (!isAttacker && config.defenderAmbush) for (const unit of units) unit.ambush = homeTerrain(state,name,unit)
      return
    }
    const rough = ['Fens','Hills'].includes(BY_NAME[name].terrain)
    for (const raiders of [true,false]) {
      for (const faction of [...new Set(units.map(unit => unit.owner))]) {
        const eligible = units.filter(unit => unit.owner === faction && (raiders ? isRaider(unit.key) : !isRaider(unit.key) && homeTerrain(state,name,unit)))
        if (!eligible.length) continue
        const home = homeTerrain(state,name,eligible[0])
        const mayEvade = !(config.ravage && faction === 'x') && !(config.noAttackEvade && isAttacker) && !(config.noDefenderEvade && !isAttacker)
        const options = [{value:'none',label:'Stand and fight'}]
        if (mayEvade) options.push({value:'evade',label:'Attempt Evasion'})
        if (home) options.push({value:'ambush',label:'Attempt Ambush'})
        const enemies = isAttacker ? defenders : participants
        const enemyWeight = enemies.reduce((total,unit) => total+unitStrength(unit),0)
        const ownWeight = units.reduce((total,unit) => total+unitStrength(unit),0)
        const defaultMove = isAttacker ? (home && !eligible.every(traps) ? 'ambush' : 'none') : (mayEvade && (raiders && (!home || ownWeight < enemyWeight) || !raiders && !sites.length && ownWeight < enemyWeight) ? 'evade' : home ? 'ambush' : 'none')
        const tactic = choose('Pre-Battle',`${NAMES[faction]} ${raiders ? 'Raiders' : 'Troops in Home Terrain'}`,options,defaultMove,humanSide(state,faction))
        if (tactic === 'none') continue
        const threshold = tactic === 'ambush' ? raiders ? 5 : 3 : raiders ? home ? 4 : rough ? 5 : 6 : 5
        const raw = roll(6,`${NAMES[faction]} ${tactic} · ${name}`)
        const n = raw+(isAttacker ? 0 : config.defenderTacticsModifier ?? 0)
        for (const unit of eligible) {
          if (n >= threshold) {
            if (tactic === 'evade') unit.evaded = true
            else unit.ambush = true
          }
        }
        details.push(`${NAMES[faction]} ${tactic === 'evade' ? 'Evasion' : 'Ambush'} ${n >= threshold ? 'succeeds' : 'fails'} (${raw} on D6${n === raw ? '' : ', modified to '+n}).`)
      }
    }
  }

  if (['x','s'].includes(attacker) && commandBattle(config.source) && config.barbarianPlunder !== false && BY_NAME[name].terrain !== 'City' && !friendlyControl(state,name,attacker)) {
    const taken = plunderTo(land,attacker+'w',config.ravage ? on(land,attacker+'w') : land.pop)
    for (const unit of participants.filter(unit => unit.key === attacker+'w' && !unit.gold).slice(0,taken)) unit.gold = true
    if (taken) details.push(`Battle Command takes ${taken} Plunder before combat.`)
  }
  if (config.ravage && attacker === 'x' && config.source === 'Battle' && BY_NAME[name].terrain !== 'City' && roll(6,'Ravage · '+name) >= 4 && land.pop) {
    land.pop--
    state.tracks.refugees = Math.min(4,state.tracks.refugees+1)
    details.push('Ravage reduces Population by one.')
  }
  if (config.afterPlunder) config.afterPlunder()
  tactics(participants,true)
  tactics(defenders,false)
  const fieldStages = [
    ['Trap',traps],
    ['Charge / Ambush',unit => unit.key === 'cav' || unit.ambush],
    ['Melee',unit => !isRaider(unit.key)],
    ['Harass',unit => isRaider(unit.key)],
  ]
  const struck = new Set()
  function fieldStep(stage,selector) {
    const a = inField(participants)
    const d = inField(defenders)
    if (!a.length || !d.length) return
    const aHits = a.filter(unit => !struck.has(unit.id) && selector(unit))
    const dHits = d.filter(unit => !struck.has(unit.id) && selector(unit))
    if (!aHits.length && !dHits.length) return
    const aLoss = dHits.reduce((total,unit) => total+strikeOf(unit,'field'),0)
    const dLoss = aHits.reduce((total,unit) => total+strikeOf(unit,'field'),0)
    for (const unit of [...aHits,...dHits]) struck.add(unit.id)
    markFought([...aHits,...dHits,...(aLoss ? a : []),...(dLoss ? d : [])])
    // Strikes and loss absorption use the same position for the whole step.
    const weights = new Map([...a,...d].map(unit => [unit,lossOf(unit,'field')]))
    removeLosses(a,aLoss,'field',stage,attacking.length > 1,null,weights)
    removeLosses(d,dLoss,'field',stage,defending.length > 1,null,weights)
    details.push(`${stage}: attackers take ${qty(aLoss/2)}, defenders take ${qty(dLoss/2)}.`)
  }
  if (inField(participants).length && inField(defenders).length) useOmens('field',[...present(participants),...present(defenders)])
  fieldStep(...fieldStages[0])
  const siteSort = (a,b) => siteOrder[a.piece]-siteOrder[b.piece] || a.index-b.index
  const sortedSites = [...sites].sort(siteSort)
  const onlySite = config.onlySite ?? config.allowedAssaultSite
  const insideOf = site => present(defenders).filter(unit => unit.site === site.index)
  const escaladeHits = (site,inside) => site.garrison*site.escalade*2 + inside.reduce((total,unit) => total+site.escalade*strikeOf(unit,'escalade')/4,0)
  const stormHits = (site,inside) => site.garrison*8 + inside.reduce((total,unit) => total+strikeOf(unit,'storm'),0)
  const automaticCoup = config.assumeCoup && config.source === 'Event Battle' && onlySite !== undefined
  const coupPossible = (site,inside) => config.surprise && (automaticCoup || site.coupCapacity-inside.length+1 > 0)
  function projectedAssault(site,inside) {
    const attacking = present(participants)
    const double = braveFaction === 'd' ? null : attacking.find(unit=>unit.key === 'cav')
    const escalade = coupPossible(site,inside) ? [] : favouredRemoval(attacking,escaladeHits(site,inside),unit=>lossOf(unit,'escalade')*(unit === double ? 2 : 1),double)
    const storming = attacking.filter(unit=>!escalade.includes(unit))
    const damage = storming.reduce((total,unit)=>total+strikeOf(unit,'storm'),0)
    const storm = favouredRemoval(storming,stormHits(site,inside),unit=>lossOf(unit,'storm'))
    const allDefenders = site.garrison*8 + inside.reduce((total,unit)=>total+lossOf(unit,'storm'),0)
    return {captures:storming.length > storm.length && damage >= allDefenders,losses:escalade.length+storm.length}
  }
  function usefulWithdrawal(site,group) {
    const inside = insideOf(site)
    if (onlySite !== undefined && onlySite !== site.index || !group.length) return false
    const exposed = projectedAssault(site,inside)
    if (!exposed.captures) return false
    const defended = projectedAssault(site,[...inside,...group])
    const opponents = present(participants)
    const fieldHits = group.filter(unit=>!struck.has(unit.id)).reduce((n,unit)=>n+strikeOf(unit,'field'),0)
    const fieldLosses = favouredRemoval(opponents,fieldHits,unit=>lossOf(unit,'field')).length
    return !defended.captures || defended.losses-exposed.losses > fieldLosses
  }
  function defendersWithdraw() {
    if (!present(participants).length || !sites.length) return
    for (const side of [...new Set(inField(defenders).map(unit => unit.owner))]) {
      if (config.ravage && side === 'x') continue
      const factionUnits = inField(defenders).filter(unit => unit.owner === side)
      const stay = new Set()
      const consent = new Map()
      for (const unit of factionUnits.sort(byFriendlyPiece)) {
        if (unit.site !== null || stay.has(unit.id)) continue
        if (unit.key === 'cav' && !humanSide(state,'d') && activeSide(state,7,'unshaded') && !config.forceWithdraw) continue
        const remainingCapacity = site => withdrawalCapacity(state,name,site.piece)-insideOf(site).length
        const homeSettlement = site => isBand(unit.key) && site.piece === fromNation(unit.key)+'s' && site.owner === side
        const holes = sortedSites.filter(site => remainingCapacity(site) > 0 && consent.get(site.index) !== 'no')
          .sort((a,b)=>Number(homeSettlement(b))-Number(homeSettlement(a)))
        if (!holes.length) break
        const options = [{value:'field',label:'Stay in the field'},...holes.map(site => ({value:String(site.index),label:BY_NAME[name].sites[site.index].name+' · '+PIECES[site.piece]}))]
        const matching = factionUnits.filter(other => other.key === unit.key && other.gold === unit.gold && other.site === null && !stay.has(other.id))
        if (matching.length > 1) {
          options.push({value:'field-all',label:'Keep all '+matching.length+' in the field'})
          for (const site of holes.filter(site => remainingCapacity(site) > 1)) {
            options.push({value:'all-'+site.index,label:'Withdraw '+Math.min(matching.length,remainingCapacity(site))+' to '+BY_NAME[name].sites[site.index].name})
          }
        }
        const worth = config.forceWithdraw || config.siegeOnly ? holes[0] : holes.find(site => usefulWithdrawal(site,
          factionUnits.filter(other => other.site === null && !stay.has(other.id) && !(other.key === 'cav' && !humanSide(state,'d') && activeSide(state,7,'unshaded'))).slice(0,remainingCapacity(site))))
        const preferred = worth ? String(worth.index) : 'field'
        const selection = choose('Withdrawal','Withdraw '+labelUnit(unit)+'?',options,preferred,humanSide(state,side) && !config.ignoreTactics)
        if (selection === 'field' || selection === 'field-all') {
          for (const piece of selection === 'field' ? [unit] : matching) stay.add(piece.id)
          continue
        }
        const together = selection.startsWith('all-')
        const site = holes.find(site => site.index === Number(together ? selection.slice(4) : selection))
        if (site.owner !== side && humanSide(state,site.owner) && !humanSide(state,side) && !config.ignoreTactics && !consent.has(site.index)) {
          consent.set(site.index,choose('Withdrawal',`Admit allied ${NAMES[side]} Units at ${BY_NAME[name].sites[site.index].name}?`,[
            {value:'yes',label:'Admit allied units'}, {value:'no',label:'Keep the space for your units'},
          ],'yes',true))
        }
        if (consent.get(site.index) === 'no') { stay.add(unit.id); continue }
        for (const piece of together ? matching.slice(0,remainingCapacity(site)) : [unit]) piece.site = site.index
      }
    }
    const withdrawn = defenders.filter(unit => unit.site !== null && !unit.dead).length
    if (withdrawn) details.push(`${withdrawn} defending ${withdrawn === 1 ? 'Unit withdraws' : 'Units withdraw'}.`)
  }
  if (!config.noWithdraw && !(config.ravage && defender === 'x')) defendersWithdraw()
  fieldStep(...fieldStages[1])
  if (activeSide(state,7,'unshaded') && !config.noWithdraw) {
    for (const unit of inField(defenders).filter(unit => unit.key === 'cav')) {
      const allowed = sortedSites.filter(site => ['fort','town'].includes(site.piece) &&
        present(defenders).filter(unit => unit.site === site.index).length < withdrawalCapacity(state,name,site.piece))
      const choice = choose('Charge / Ambush','Withdraw Cavalry after its Charge?',[
        {value:'field',label:'Stay in the field'},
        ...allowed.map(site => ({value:String(site.index),label:BY_NAME[name].sites[site.index].name})),
      ],allowed.length ? String(allowed[0].index) : 'field',humanSide(state,'d') && !config.ignoreTactics)
      if (choice !== 'field') {
        unit.site = Number(choice)
        details.push('Cavalry withdraws after its Charge into '+BY_NAME[name].sites[unit.site].name+'.')
      }
    }
  }
  for (const stage of fieldStages.slice(2)) fieldStep(...stage)

  function capturedGold(amount,allowCavalry,limitedToAttacker=false) {
    const eligible = present(participants).filter(unit => !unit.gold && (allowCavalry || unit.key !== 'cav') && (!limitedToAttacker || unit.owner === attacker)).sort(byFriendlyPiece)
    const take = Math.min(amount,goldAvailable(state),eligible.length)
    for (const unit of eligible.slice(0,take)) {
      unit.gold = true
      land.units[unit.key][1]++
    }
    return take
  }
  if (present(participants).length && !inField(defenders).length && !config.ravage && !config.noAssault && !config.siegeOnly) {
    let left = onlySite === undefined ? sortedSites : sortedSites.filter(site => site.index === onlySite)
    for (let attempt=0; attempt<sites.length && present(participants).length; attempt++) {
      if (!left.length) break
      const preferred = [...left].sort((a,b)=>insideOf(a).length-insideOf(b).length).find(site=>projectedAssault(site,insideOf(site)).captures)
      const options = [{value:'none',label:'Skip Assault'},...left.map(site => ({value:String(site.index),label:BY_NAME[name].sites[site.index].name+' · '+PIECES[site.piece]}))]
      const selected = choose('Assault','Choose a Stronghold to assault',options,preferred ? String(preferred.index) : 'none',humanSide(state,attacker) && !config.ignoreTactics)
      if (selected === 'none') break
      const site = left.find(item => item.index === Number(selected))
      if (attempt === 0) useOmens('assault',[...present(participants),...present(defenders).filter(unit => unit.site === site.index)])
      site.used = true
      const inside = insideOf(site)
      const assailants = present(participants)
      markFought([...assailants,...inside])
      const coupLimit = site.coupCapacity-inside.length+1
      const coup = config.surprise && (automaticCoup || (config.assumeCoup ? coupLimit > 0 : roll(6,'Coup de Main · '+BY_NAME[name].sites[site.index].name) <= coupLimit))
      if (config.surprise) details.push(`Coup de Main ${coup ? 'succeeds' : 'fails'} (needs ${coupLimit} or less).`)
      if (!coup) {
        const hits = escaladeHits(site,inside)
        const cavalry = braveFaction === 'd' ? null : assailants.find(unit => unit.key === 'cav')
        const autoDouble = hits > 0 && Boolean(cavalry)
        const double = cavalry && hits && choose('Escalade','Have one Cavalry absorb double losses?',[
          {value:'yes',label:'Absorb double loss with the first Cavalry'}, {value:'no',label:'Allocate normal losses'},
        ],autoDouble ? 'yes' : 'no',humanSide(state,'d') && !config.ignoreTactics) === 'yes'
        removeLosses(assailants,hits,'escalade','Escalade',attacking.length > 1,double ? cavalry : null)
        details.push(`Escalade at ${BY_NAME[name].sites[site.index].name}: attackers take ${qty(hits/2)}.`)
      }
      const alive = present(participants)
      if (!alive.length) break
      const townHits = stormHits(site,inside)
      const attackHits = alive.reduce((total,unit) => total+strikeOf(unit,'storm'),0)
      const garrisonLost = Math.min(site.garrison,Math.floor(attackHits/8))
      const remaining = site.garrison === garrisonLost ? attackHits-garrisonLost*8 : 0
      removeLosses(alive,townHits,'storm','Storm',attacking.length > 1)
      removeLosses(inside,remaining,'storm','Storm',defending.length > 1)
      if (garrisonLost !== site.garrison || present(inside).length || !present(participants).length) {
        details.push(`${PIECES[site.piece]} holds.`)
        break
      }
      site.destroyed = true
      destroyed.push(site.index)
      land.sites[site.index] = null
      if (site.piece === 'fort' || site.piece === 'town' && !isFragmentation(state)) changeTrack(state,'prestige',-2)
      if (attacker === 'd' && !civilBattle) changeTrack(state,'prestige',1)
      let cityGold = 0
      if (BY_NAME[name].terrain === 'City') {
        cityGold = totalProsperity(land)
        land.pros = [0,0]
      }
      const taken = capturedGold((site.piece === 'town' ? 3 : 2)+cityGold,Boolean(config.retaliate))
      destroyedPieces.push({piece:site.piece,employer:site.employer,plunder:taken})
      details.push(`${PIECES[site.piece]} falls at ${BY_NAME[name].sites[site.index].name}${taken ? ' · '+taken+' Plunder taken' : ''}.`)
      left = left.filter(other => other !== site)
    }
  }
  const attackerLosses = participants.filter(unit => unit.dead).length
  const defenderLosses = defenders.filter(unit => unit.dead).length+destroyed.length
  if (fought.size) {
    const cavalryAttacked = participants.some(unit => fought.has(unit.id))
    const balance = (cavalryAttacked ? 1 : -1)*Math.sign(defenderLosses-attackerLosses)
    if (balance < 0 || balance > 0 && !civilBattle) changeTrack(state,'prestige',balance > 0 && activeSide(state,14,'unshaded') ? 2 : balance)
  }
  if (!briton(attacker) && defenderLosses > attackerLosses && (present(participants).length || hasStandingHold(attacker))) changeTrack(state,attacker,attacker === 's' && activeSide(state,14,'shaded') ? 2 : 1)
  if (!briton(defender) && attackerLosses > defenderLosses && (present(defenders).length || hasStandingHold(defender))) changeTrack(state,defender,defender === 's' && activeSide(state,14,'shaded') ? 2 : 1)
  const removedGold = defenders.filter(unit => unit.dead && unit.gold).length
  if (removedGold > 0) {
    const options = [{value:'carry',label:'Keep up to half on participating Units'}, {value:'leave',label:'Leave removed Plunder off board'}]
    if (briton(attacker)) options.push({value:'restore',label:'Return one cube as Prosperity'})
    if (!briton(attacker) && friendlyControl(state,name,attacker)) options.push({value:'renown',label:'Gain Renown for each removed cube'})
    const carry = Math.floor(removedGold / 2)
    const canCarry = carry && present(participants).some(unit => !unit.gold && unit.key !== 'cav')
    const preferred = attacker === 'd' && !canCarry ? 'restore' : options.some(item => item.value === 'renown') ? 'renown' : canCarry ? 'carry' : 'leave'
    const result = choose('Consequences',`Use ${removedGold} removed Plunder?`,options,preferred,humanSide(state,attacker) && !config.ignoreTactics)
    if (result === 'carry') capturedGold(carry,false)
    if (result === 'restore') addProsperity(state,name,1)
    if (result === 'renown') changeTrack(state,attacker,removedGold)
  }
  if (config.retaliate && attacker === 'd' && destroyed.length && sites.filter(site => site.owner === defender).every(site => site.destroyed)) {
    changeTrack(state,'prestige',3)
    changeTrack(state,defender === 'c' ? 'wealth' : defender,-5)
  }
  if (!inField(defenders).length && !config.noSiege) {
    let spare = present(participants).filter(unit => !isRaider(unit.key)).length
    for (const site of sortedSites) {
      if (site.used || site.destroyed || spare < site.capacity) continue
      const troops = present(defenders).filter(unit => unit.site === site.index)
      if (!troops.length) continue
      const siege = choose('Siege','Besiege '+BY_NAME[name].sites[site.index].name+'?',[
        {value:'yes',label:'Besiege · commit '+site.capacity+' Troops'}, {value:'no',label:'Skip Siege'},
      ],'yes',humanSide(state,attacker) && !config.ignoreTactics)
      if (siege === 'no') continue
      spare -= site.capacity
      const target = pickUnit('Siege','Select one Unit lost to Siege',troops,[...troops].sort(byLossPriority)[0],troops.some(unit => humanSide(state,unit.owner)) && !config.ignoreTactics)
      kill(target,state,land)
      details.push(`Siege removes ${labelUnit(target)} at ${BY_NAME[name].sites[site.index].name}.`)
    }
  }
  const removedAtt = participants.filter(unit => unit.dead).map(labelUnit)
  const removedDef = defenders.filter(unit => unit.dead).map(labelUnit)
  if (removedAtt.length) details.push(`Attacker losses · ${removedAtt.join(', ')}.`)
  if (removedDef.length) details.push(`Defender losses · ${removedDef.join(', ')}.`)
  return {
    name, attacker, defender, details, destroyed, destroyedPieces, cavalryLosses:[...participants,...defenders].filter(unit => unit.key === 'cav' && unit.dead).length, attackerLosses:removedAtt.length, defenderLosses:removedDef.length+destroyed.length,
    prestigeChange:state.tracks.prestige-prestigeBefore, renownChange:(state.tracks[attacker] ?? 0)-renownBefore,
    defenderField:inField(defenders).length, attackerField:inField(participants).length,
    defenderStanding:present(defenders).length, attackerPlunder:present(participants).filter(unit => unit.gold).length,
    defenderPlunderRemoved:removedGold, controlAfter:control(state,name),
    attackingRaiderSurvivors:present(participants).filter(unit => isRaider(unit.key)).length,
    attackerEvaded:participants.length > 0 && participants.every(unit => unit.evaded),
  }
  function hasStandingHold(faction) {
    return land.sites.some(site => site && toOwner(site.piece,site.employer) === faction)
  }
}
export function battleForecast(state,config) {
  const after = clone(state)
  return runBattle(after,{...config,ignoreTactics:true},() => 6)
}

export function raidReactionSafe(state,config,reacting) {
  const {name,attacker,defender} = config
  const britons = battleSides(state,attacker,defender).find(side => side.includes(reacting))
  const protectedTroops = reacting === 'd' ? ['cav'] :
    Object.keys(GROUP).filter(key => britons.includes(GROUP[key].owner) && !isRaider(key))
  const remaining = position => protectedTroops.reduce((total,key) => total+on(position.land[name],key),0)
  const start = remaining(state)
  if (!start) return true

  // Follow the actual Battle procedure, including Non-player tactics and casualty order.
  // The dice in these Battles only test success/failure, so 1 and 6 span both outcomes.
  const paths = [[]]
  let attempts = 0
  while (paths.length) {
    const path = paths.pop()
    let index = 0
    const branch = choices => {
      if (index === path.length) throw new BattleChoice({choices})
      return path[index++]
    }
    const after = {...state,land:{...state.land,[name]:clone(state.land[name])},tracks:{...state.tracks},pools:{...state.pools}}
    try {
      runBattle(after,config,sides => branch([sides,1]),prompt => {
        if (prompt.stage === 'Consequences') return prompt.defaultValue
        const values = prompt.options.map(option => option.value)
        return branch([prompt.defaultValue,...values.filter(value => value !== prompt.defaultValue)])
      })
      if (remaining(after) < (reacting === 'd' ? start : 1)) return false
    } catch (error) {
      if (!(error instanceof BattleChoice)) throw error
      for (const choice of error.prompt.choices.reverse()) paths.push([...path,choice])
    }
    // Decline if a large position cannot be shown safe within the preview budget.
    if (++attempts >= 512 && paths.length) return false
  }
  return true
}

// Replays a saved set of selections. A preview halts at the first unanswered choice.
export function battleSession(start,requests,answers,rollFor) {
  const state = clone(start)
  const dice = []
  const reports = []
  const roll = rollFor(state,dice)
  let index = 0
  try {
    for (const config of requests) {
      const report = runBattle(state,config,roll,question => {
        const answer = answers[index]
        if (answer === undefined) throw new BattleChoice({ ...question, id:index, name:config.name, progress:[...reports.flatMap(item => item.details),...question.progress] })
        index++
        return answer
      })
      if (config.afterDeepRaid && !report.attackerEvaded && report.attackingRaiderSurvivors && BY_NAME[config.name].terrain !== 'City') {
        const space = state.land[config.name]
        const group = config.attacker+'r'
        const gain = Math.min(report.attackingRaiderSurvivors,space.pop)
        const amount = plunderTo(space,group,gain)
        if (amount) report.details.push(`Surviving Deep Raiders take ${amount} Plunder.`)
      }
      reports.push(report)
    }
  } catch (error) {
    if (error instanceof BattleChoice) return { prompt:error.prompt, dice }
    throw error
  }
  ensure(index === answers.length,'The saved Battle choices no longer match this position.')
  return { state, dice, reports }
}

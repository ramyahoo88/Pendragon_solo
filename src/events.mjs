import { BY_NAME, GROUP, GROUPS, NAMES, RANDOM_SPACES, REGIONS, SEAS } from './data.mjs'
import { printedPopulation } from './scenarios.mjs'
import { battleEnemies } from './battle.mjs'
import { annonaChoices, planAnnona, resolveAnnona, resolveImperium } from './sequence.mjs'
import {
  addProsperity, availability, boardTotals, clone, control, ensure,
  friendlyControl, goldAvailable, groupLabel, isFragmentation, isHumanFaction, isRaider, isRoman, loaded, on, piecesByOwner,
  removeProsperity, scores, setImperium, spendCivitates, sum, toOwner, totalProsperity,
} from './position.mjs'

const regions = REGIONS.filter(space => space.terrain !== 'City')
const landNames = list => list.map(space => space.name)
const hasTown = space => space.sites.some(site => site?.piece === 'town')
const hasFort = space => space.sites.some(site => site?.piece === 'fort')
const holdNames = { fort:'Fort', town:'Town', hill:'Hillfort', xs:'Saxon Settlement', ss:'Scotti Settlement' }
const listed = (values, label = value => value) => values.map(value => ({value,label:label(value)}))
const selectField = (name,label,choices,defaultValue = '') => ({name,label,type:'select',options:choices,defaultValue})
const amountField = (name,label,min,max,defaultValue = 0) => ({name,label,type:'number',min,max,defaultValue})
const option = (value,label) => ({value,label})
const noSelection = option('', 'Choose an option')
const landField = (name,label,names,allowBlank = false) => selectField(name,label,[...(allowBlank ? [option('','Leave blank')] : [noSelection]),...listed(names)])
const popCeiling = (state,name) => printedPopulation(state,name) + 1

function reducePopulation(state,name,refugees = true) {
  const space = state.land[name]
  if (!space.pop) return false
  space.pop--
  if (refugees) state.tracks.refugees = Math.min(4,state.tracks.refugees + 1)
  return true
}
function eventMarker(state,id,side,type,extra = {}) {
  state.markers[id] = {type,side,...extra}
}
function dominance(state,letter) {
  if (!isFragmentation(state)) setImperium(state,state.imperium[0] + letter)
}
function releaseComitates(state,quantity) {
  const released = Math.min(state.pools.notYet,quantity)
  state.pools.notYet -= released
  return released
}
function removeUnit(state,name,key,count,to = null) {
  const space = state.land[name]
  const removed = Math.min(count,on(space,key))
  const empty = on(space,key)-loaded(space,key)
  space.units[key][1] -= Math.max(0,removed-empty)
  space.units[key][0] -= removed
  if (to) state.pools[to] += removed
  return removed
}
function convertGroup(space,from,to) {
  space.units[to][0] += on(space,from)
  space.units[to][1] += loaded(space,from)
  space.units[from] = [0,0]
}
function allEligibleSites(state,name,piece,onlyVacant = false) {
  const space = state.land[name]
  const legal = BY_NAME[name].sites.map((site,index) => ({site,index})).filter(({site}) =>
    (piece !== 'town' || site.type === 'T') && (piece !== 'hill' || BY_NAME[name].terrain !== 'City'))
  const empty = legal.filter(({index}) => !space.sites[index])
  return empty.length || onlyVacant ? empty : legal
}
function holdField(state,name,key,piece,onlyVacant = false) {
  const choices = allEligibleSites(state,name,piece,onlyVacant)
  if (!choices.length) return []
  return [selectField(key,'Site in '+name,choices.map(({site,index}) => {
    const current = state.land[name].sites[index]
    return option(String(index), site.name + (current ? ' · replace '+holdNames[current.piece] : ' · vacant'))
  }),String(choices[0].index))]
}
function placeEventHold(state,name,piece,input,key,{onlyVacant = false,employer = null} = {}) {
  if (availability(state)[piece] <= 0) return false
  const candidates = allEligibleSites(state,name,piece,onlyVacant)
  if (!candidates.length) return false
  const id = input[key] === '' || input[key] == null ? candidates[0].index : Number(input[key])
  ensure(candidates.some(({index}) => index === id),'Choose a legal site in '+name+'.')
  state.land[name].sites[id] = {piece,employer}
  return true
}
const eligibleRegions = (state,predicate) => landNames(regions.filter(({name}) => predicate(state.land[name],name)))
const validInputNumber = (input,key,min,max,defaultValue = 0) => {
  const answer = input[key] === undefined || input[key] === '' ? defaultValue : Number(input[key])
  ensure(Number.isInteger(answer) && min <= answer && answer <= max,'Invalid quantity for '+key+'.')
  return answer
}

function eventUnitPlacement(state,faction,destination,group,requested,input) {
  const { owner,piece } = GROUP[group]
  const label = groupLabel(group)
  const available = Math.min(requested,availability(state)[piece])
  const shortfall = requested-available
  const sources = shortfall && owner === faction && isHumanFaction(state,faction)
    ? REGIONS.filter(({name}) => name !== destination && on(state.land[name],group))
    : []
  const donors = sources.map(({name}) => option(name,`${name} · ${on(state.land[name],group)} here`))
  const slots = Math.min(shortfall,sum(sources.map(({name}) => on(state.land[name],group))))
  const fields = Array.from({length:slots},(_,index) =>
    selectField(`event-recycle-${destination}-${group}-${index+1}`,
      `Reuse ${label}${slots > 1 ? ' '+(index+1) : ''} from`,[option('','Leave unplaced'),...donors]))
  return {
    fields,
    check() {
      const removals = new Map()
      for (const field of fields) {
        const origin = defaultChoice(input,field.name,field.options)
        if (!origin) continue
        const count = (removals.get(origin) ?? 0)+1
        ensure(count <= on(state.land[origin],group),`Choose no more ${label} than ${origin} has to reuse.`)
        removals.set(origin,count)
      }
      return removals
    },
    place(removals) {
      for (const [origin,count] of removals) removeUnit(state,origin,group,count)
      const placed = available+sum([...removals.values()])
      state.land[destination].units[group][0] += placed
      const details = [`${placed} of ${requested} ${label} placed in ${destination}.`]
      for (const [origin,count] of removals) details.push(`Reused ${count} ${label} from ${origin}.`)
      if (placed < requested) {
        details.push(`Available ${label} supply exhausted.`)
        if (group === 'com' && state.pools.notYet) details.push(`${state.pools.notYet} Comitates remain Not Yet in Play.`)
      }
      return details.join(' ')
    },
  }
}

function eventHoldResult(placed,piece,name) {
  return placed ? `${holdNames[piece]} placed in ${name}.` : `No Available ${holdNames[piece]} to place in ${name}.`
}

function eventPlaceList(state,input,names,maximum,{minimum = Math.min(names.length,maximum),prefix = 'space',label = 'Region'} = {}) {
  const count = Math.min(names.length,maximum)
  const fields = Array.from({length:count},(_,i) => landField(prefix+(i+1),label+' '+(i+1),names,i >= minimum))
  const selected = Array.from({length:count},(_,i) => input[prefix+(i+1)]).filter(Boolean)
  return {fields,selected,check:() => {
    ensure(selected.length >= minimum && new Set(selected).size === selected.length &&
      selected.every(name => names.includes(name)), 'Choose '+(minimum === count ? count : `between ${minimum} and ${count}`)+' distinct eligible spaces.')
    return selected
  }}
}
function eventProsperity(state,input,side,number,quantity,{needsTown = false} = {}) {
  const add = side === 'unshaded'
  const names = eligibleRegions(state,space => (!needsTown || hasTown(space)) && (add
    ? space.pros.some(amount => amount < space.pop) && goldAvailable(state) > 0
    : totalProsperity(space) > 0))
  const limit = add ? Math.min(number,goldAvailable(state)) : number
  const choice = eventPlaceList(state,input,names,limit)
  const each = quantity === 'population' ? 'up to its Population' : 'up to '+quantity
  return {
    fields:choice.fields, help:`${add ? 'Restore' : 'Remove'} Prosperity in up to ${number} eligible Regions${needsTown ? ' with a Town' : ''}. Adjust each by ${each}.`,
    run:() => {
      const selected = choice.check()
      const applied = selected.map(name => {
        const n = quantity === 'population' ? state.land[name].pop : quantity
        if (add) return [name,addProsperity(state,name,n)]
        const before = totalProsperity(state.land[name])
        removeProsperity(state.land[name],n)
        return [name,before-totalProsperity(state.land[name])]
      }).filter(([,n]) => n)
      return applied.length ? applied.map(([name,count]) => `${name} ${add ? '+' : '−'}${count} Prosperity`).join(', ') : 'No eligible Prosperity adjustment.'
    },
  }
}
function changeEventTrack(state,key,amount,min = 0) {
  const before = state.tracks[key]
  state.tracks[key] = Math.min(80,Math.max(min,before+amount))
  return state.tracks[key]-before
}
function trackEvent(state,key,amount,label,min = 0) {
  const help = (amount > 0 ? 'Add ' : 'Remove ')+Math.abs(amount)+' '+label+(min ? ', keeping at least '+min : '')+'.'
  return {fields:[],help,run:() => {
    const difference = changeEventTrack(state,key,amount,min)
    return difference ? `${label} ${difference > 0 ? '+' : '−'}${Math.abs(difference)}.` : `${label} stays at ${state.tracks[key]}.`
  }}
}
const perform = (help,run,fields = []) => ({help,fields,run})
function lasting(state,id,side,type,help,extra = {}) {
  return perform(help,() => {
    eventMarker(state,id,side,type,extra)
    return `${type === 'capability' ? 'Capability' : 'Momentum'} #${id} in effect.`
  })
}
function defaultChoice(input,key,choices) {
  const value = input[key] ?? choices[0]?.value
  ensure(choices.some(choice => String(choice.value) === String(value)), 'Choose a valid '+key+'.')
  return value
}

function removeSelectedCavalry(state,input,limit,to) {
  const names = landNames(REGIONS.filter(({name}) => on(state.land[name],'cav')))
  const required = Math.min(limit,sum(names.map(name => on(state.land[name],'cav'))))
  const fields = names.map(name => amountField('cav-'+name,name,0,Math.min(required,on(state.land[name],'cav'))))
  return perform('Allocate '+required+' Cavalry removals.',() => {
    const selections = names.map(name => [name,validInputNumber(input,'cav-'+name,0,Math.min(required,on(state.land[name],'cav')))])
    ensure(sum(selections.map(([,n])=>n)) === required,`Select exactly ${required} Cavalry.`)
    for (const [name,n] of selections) removeUnit(state,name,'cav',n,to)
    return `${required} Cavalry moved to ${to === 'casualties' ? 'Casualties' : 'Available'}.`
  },required ? fields : [])
}

const SPECIAL_CAPABILITIES = {
  2:{unshaded:'A Fort can support two Cavalry in a Train.'},
  7:{unshaded:'Cavalry can withdraw into a Fort or Town after Charge.',shaded:'A Cavalry is returned to Available for each Fort placed by Build.'},
  8:{unshaded:'Britannicus departures lose four Raiders during this Epoch.'},
  10:{unshaded:'Skip the next Annona phase.'},
  14:{unshaded:'Dux gains two Prestige per Battle victory during this Epoch.',shaded:'Scotti gains two Renown per Battle victory during this Epoch.'},
  16:{shaded:'Militia cannot fight alongside Dux units during this Epoch.'},
  18:{shaded:'Scotti departures through Hibernicus gain one Raider.'},
  21:{shaded:'Civitates pays for Hillforts during Upkeep.'},
  33:{shaded:'Civitates and Scotti cannot target one another with a Battle Command during this Epoch.'},
  36:{unshaded:'Apply a −1 modifier to Ransom rolls.',shaded:'Apply a +1 modifier to Ransom rolls.'},
  46:{unshaded:'Fens stop counting as Saxon Home Terrain.',shaded:'Halve Cavalry in Fens Field Battles.'},
  55:{shaded:'Scotti may launch Raids through Britannicus.'},
  56:{unshaded:'Hills stop counting as Scotti Home Terrain.',shaded:'Scotti Warbands may spring a Trap in their Hills Battle Commands.'},
  59:{unshaded:'Reduce Scotti arrivals in Novantae, Votadini, and Carvetii by three.'},
  60:{unshaded:'Dux may cross between Coastal spaces once per March or Intercept.'},
  63:{unshaded:'Every Scotti Raid target costs one additional Renown.'},
  64:{unshaded:'Native Warbands in spaces without their own Settlement are halved in Battle until the Epoch.',shaded:'Empty Regions halve garrison withdrawal capacity.'},
  68:{unshaded:'Reduce every Scotti Raid by one Raider after patrol.',shaded:'Scotti Raids may stockpile and later deploy the Niall box.'},
  69:{unshaded:'Reduce Raids that bypass the Seas by two Raiders.',shaded:'Fort reductions no longer affect Caledonian Raids.'},
}
const MOMENTUM = new Set([8,10,14,16,33])
const TRIBAL_REGIONS = {
  19:['Catuvellauni','Cantiaci'], 20:['Catuvellauni','Atrebates'], 26:['Textoverdi','Parisi'],
  34:['Dobunni','Atrebates'], 40:['Dobunni','Catuvellauni'], 42:['Regni','Cantiaci'],
  44:['Parisi','Corieltauvi'], 48:['Iceni','Trinovantes'],
}
const SINGLE = new Set([4,25,43,54,57,67,73,74,75,76])
const HIRED_MUSCLE = {
  19:['Catuvellauni','Cantiaci'], 20:['Catuvellauni','Atrebates'], 26:['Textoverdi','Parisi'],
  34:['Atrebates'], 40:['Catuvellauni'], 42:['Regni','Cantiaci'], 44:['Parisi','Corieltauvi'],
  48:['Iceni','Trinovantes'], 49:['Cantiaci'],
}

function hiredMuscle(state,id,input) {
  const names = HIRED_MUSCLE[id]
  const name = input.space ?? names[0]
  const valid = names.includes(name)
  const fields = names.length > 1 ? [selectField('space','Region',listed(names),name)] : []
  const employers = listed(['d','c'],id => NAMES[id])
  fields.push(selectField('employer','Foederati employer',employers,input.employer ?? employers[0].value))
  const special = id === 49
  const existingFoederati = valid ? state.land[name].sites.some(site => site?.piece === 'xs' && site.employer) : false
  if (!special && valid && !existingFoederati) fields.push(...holdField(state,name,'site','xs'))
  return perform('Assign the Saxon Foederati employer and record any new Settlement.',() => {
    ensure(valid,'Choose a named Region on the card.')
    const employer = defaultChoice(input,'employer',employers)
    const space = state.land[name]
    let built = false
    if (special && availability(state).xs > 0) {
      const rutupiae = BY_NAME.Cantiaci.sites.findIndex(site => site.name === 'Rutupiae')
      space.sites[rutupiae] = {piece:'xs',employer}
      built = true
    } else if (!special && !existingFoederati) {
      built = placeEventHold(state,name,'xs',input,'site',{employer})
    }
    const amount = Math.min(availability(state).xw,special ? 6 : 3)
    space.units[employer+'xw'][0] += amount
    return `${NAMES[employer]} receives ${amount} Saxon Warbands${built ? ' and a Settlement' : ''} in ${name}.`
  },fields)
}
function pivotCymbrogi(state,input) {
  const possible = eligibleRegions(state,(space,name) => BY_NAME[name].terrain === 'Hills' && friendlyControl(state,name,'c') &&
    (space.sites.some(site => !site) && availability(state).hill > 0 || state.pools.notYet + availability(state).com > 0))
  const selection = eventPlaceList(state,input,possible,5,{minimum:0})
  const fields = [...selection.fields]
  for(const name of selection.selected) {
    if (possible.includes(name)) fields.push(...holdField(state,name,'site-'+name,'hill',true))
  }
  return perform('Release Comitates, then choose up to five Briton-controlled Hills for eligible placements.',() => {
    const selected = selection.check()
    const released = releaseComitates(state,9)
    let hills = 0
    let units = 0
    for (const name of selected) {
      if (placeEventHold(state,name,'hill',input,'site-'+name,{onlyVacant:true})) hills++
      if (availability(state).com > 0) {
        state.land[name].units.com[0]++
        units++
      }
    }
    dominance(state,'c')
    eventMarker(state,76,'unshaded','capability')
    return `${released} Comitates released. Place ${hills} Hillforts and ${units} Comitates.`
  },fields)
}
function revoltAdventus(state,input) {
  const names = eligibleRegions(state,space => on(space,'dxw') + on(space,'cxw') ||
    space.sites.some(site => site?.piece === 'xs' && site.employer))
  const selected = eventPlaceList(state,input,names,3,{minimum:0})
  const fields = [...selected.fields]
  const requests = []
  for (const name of selected.selected) {
    if (!names.includes(name)) continue
    const space = state.land[name]
    if (on(space,'xw') + on(space,'dxw') + on(space,'cxw') === 0) continue
    const pieces = piecesByOwner(space)
    const loyal = ['d','c'].filter(faction => pieces[faction] > on(space,faction+'xw') +
      space.sites.filter(site=>site?.piece === 'xs' && site.employer === faction).length)
    if (!loyal.length) continue
    let defender = isFragmentation(state) ? loyal[0] : 'd'
    if (isFragmentation(state) && loyal.length > 1) {
      const key = 'defender-'+name
      fields.push(selectField(key,'Briton defender in '+name,listed(loyal,faction=>NAMES[faction]),defender))
      if (loyal.includes(input[key])) defender = input[key]
    }
    requests.push({name,attacker:'x',defender,source:'Event Battle',shieldWall:true})
  }
  return {
    fields,requests,
    help:'Choose up to three Regions where Saxon Foederati revolt. Then carry out the Shield Wall Battles shown.',
    run:()=>{
      const targets = selected.check()
      for (const name of targets) {
        const space = state.land[name]
        convertGroup(space,'dxw','xw')
        convertGroup(space,'cxw','xw')
        for (const site of space.sites) if (site?.piece === 'xs') site.employer = null
        removeProsperity(space,1)
      }
      return targets.length ? 'Saxon Foederati revolt in '+targets.join(', ')+'.' : 'No Saxon Foederati were recalled.'
    },
  }
}

function removeAllOwned(state,name,faction,includeFoederati = true) {
  const space = state.land[name]
  let removals = 0
  for (const [key,owner,base] of GROUPS) {
    if (owner === faction && (includeFoederati || key === base)) removals += removeUnit(state,name,key,on(space,key),key === 'cav' ? 'casualties' : null)
  }
  space.sites = space.sites.map(site => {
    if (!site || toOwner(site.piece,site.employer) !== faction || (!includeFoederati && site.employer)) return site
    removals++
    return null
  })
  return removals
}
function mandatorySpace(state,input,names,help,apply,key = 'space') {
  if (!names.length) return perform(help,() => 'No eligible space.')
  return perform(help,() => {
    const name = defaultChoice(input,key,listed(names))
    return apply(name)
  },[selectField(key,'Space',listed(names),names[0])])
}
function populationEvents(state,id,side,input) {
  if (id === 24) {
    if (side === 'shaded') {
      const names = eligibleRegions(state,(space,name) => control(state,name) === 'x' && space.pop < popCeiling(state,name))
      return mandatorySpace(state,input,names,'Increase Population in a Saxon-controlled Region.',name => {
        state.land[name].pop++
        return name+' gains one Population.'
      })
    }
    const emigrants = eligibleRegions(state,(space,name) => space.pop && !friendlyControl(state,name,'c'))
    const receiving = eligibleRegions(state,(space,name) => space.pop < popCeiling(state,name) && friendlyControl(state,name,'c'))
    const help = 'Transfer one Population between Regions without adding Refugees.'
    if (!emigrants.length || !receiving.length) return perform(help,() => 'No eligible pair for migration.')
    return perform(help,() => {
      const origin = defaultChoice(input,'origin',listed(emigrants))
      const target = defaultChoice(input,'target',listed(receiving))
      reducePopulation(state,origin,false)
      state.land[target].pop++
      return `One Population moves from ${origin} to ${target}.`
    },[selectField('origin','From Region',listed(emigrants),emigrants[0]),selectField('target','To Region',listed(receiving),receiving[0])])
  }
  const filter = {
    35: (space,name) => side === 'shaded' ? on(space,'xw') > 0 : space.sites.some(site => ['xs','ss'].includes(site?.piece) && !site.employer),
    53: (space,name) => side === 'shaded' ? BY_NAME[name].seas.includes('brit') : ['x','s'].includes(control(state,name)),
    61: (space,name) => !['x','s'].includes(control(state,name)),
  }[id]
  const count = id === 35 && side === 'shaded' ? 3 : id === 53 && side === 'shaded' ? 1 : 2
  const names = eligibleRegions(state,(space,name) => space.pop > 0 && filter(space,name))
  const choice = eventPlaceList(state,input,names,count)
  return perform('Reduce Population by one in each chosen Region.',() => {
    const picks = choice.check()
    for (const name of picks) reducePopulation(state,name,side !== 'shaded' || ![35,53].includes(id))
    if(id === 35 && side === 'shaded') {
      if (picks.length) state.tracks.refugees = Math.min(4,state.tracks.refugees + 1)
      dominance(state,'m')
    }
    return picks.length ? 'Population falls in '+picks.join(', ')+'.' : 'No eligible Population reduction.'
  },choice.fields)
}
function seaFlips(state,input) {
  const all = Object.keys(SEAS)
  const allow = [option('','Do not flip'),...listed(all,id => SEAS[id])]
  return perform('Optionally change patrols in two seas. Patrols will use Foederati Settlements for the rest of the game.',() => {
    const seas = ['sea1','sea2'].map(key => defaultChoice(input,key,allow)).filter(Boolean)
    ensure(new Set(seas).size === seas.length,'Choose two different seas.')
    for (const sea of seas) state.seas[sea] = !state.seas[sea]
    eventMarker(state,67,'unshaded','capability')
    return `New naval defense capability${seas.length ? '; flip '+seas.map(sea=>SEAS[sea]).join(', ') : ''}.`
  },[selectField('sea1','First patrol change',allow),selectField('sea2','Second patrol change',allow)])
}
function commandModifiers(state,id,side,faction,input) {
  if (id === 45 && side === 'shaded') {
    return ['x','s'].includes(faction) ? lasting(state,id,side,'capability','The executing faction can Settle in two spaces.',{faction}) :
      perform('This capability applies to the executing faction’s Settle Feat.',() => 'The executing faction has no Settle Feat.')
  }
  if (id === 55 && side === 'unshaded') {
    const seas = listed(Object.keys(SEAS),id => SEAS[id])
    return perform('Choose the departure sea whose raids lose three Raiders until the Epoch.',() => {
      const sea = defaultChoice(input,'sea',seas)
      eventMarker(state,id,side,'momentum',{sea})
      return `Raid reduction in ${SEAS[sea]} until the Epoch.`
    },[selectField('sea','Departure sea',seas,seas[0].value)])
  }
  if (id === 70 && side === 'shaded') {
    if (!['x','s'].includes(faction)) return perform('This Raid modifier only benefits a Barbarian faction.',() => 'The executing faction has no Raid Command.')
    return lasting(state,id,side,'momentum','The executing faction’s successful raids against Briton Control may gain extra Plunder and reduce Wealth.',{faction})
  }
  return null
}

function eventOnlyBattle(state,id,faction,input) {
  const unitsFor = name => {
    const space = state.land[name]
    return GROUPS.some(([key,owner]) => owner === faction && !isRaider(key) && on(space,key))
  }
  const spaces = id === 22 ? regions : REGIONS
  const source = 'Event Battle'
  const candidates = spaces.filter(({name}) => unitsFor(name)).flatMap(({name}) => {
    const enemies = battleEnemies(state,name,faction,source)
    if (id === 22) return enemies.map(defender=>({name,defender}))
    const space = state.land[name]
    return space.sites.flatMap((site,index) => {
      if (!site) return []
      let defender = toOwner(site.piece,site.employer)
      if (!isFragmentation(state) && ['x','s'].includes(faction) && defender === 'c' && enemies.includes('d')) defender = 'd'
      if (!enemies.includes(defender)) return []
      return [{name,defender,index}]
    })
  })
  if (!candidates.length) return perform('No eligible Battle is possible.',() => 'No eligible Battle.')
  const help = id === 22 ? 'Choose one Region. Attacking units may strike at Trap.' :
    'Choose an enemy Stronghold. If assaulted in this Battle, Escalade is skipped there.'
  const value = ({name,defender,index})=>name+'/'+defender+(index === undefined ? '' : '/'+index)
  const choices = candidates.map(target=>option(value(target),`${target.name} · ${target.index === undefined ? NAMES[target.defender] :
    BY_NAME[target.name].sites[target.index].name+' '+holdNames[state.land[target.name].sites[target.index].piece]}`))
  const selected = candidates.find(target=>value(target) === (input.target ?? choices[0].value))
  const requests = []
  if (selected) {
    const {name,defender,index} = selected
    requests.push(id === 22 ? {name,attacker:faction,defender,source,trap:GROUPS.map(([key])=>key),trapSide:'attacker'} :
      {name,attacker:faction,defender,source,surprise:true,assumeCoup:true,onlySite:index})
  }
  return {
    help,fields:[selectField('target','Battle target',choices,choices[0].value)],requests,
    run:()=> {
      ensure(selected,'Choose a legal Battle target.')
      return 'Battle in '+selected.name+'.'
    },
  }
}

function resolveBaseEvent(state,id,faction,side,input) {
  const unshaded = side === 'unshaded'
  if (side === 'shaded' && [22,29,72].includes(id)) return eventOnlyBattle(state,id,faction,input)
  if (TRIBAL_REGIONS[id] && !unshaded && state.markers?.[27]?.side === 'unshaded') {
    return perform('The active Gratia Capability blocks this Tribal War.',() => 'Gratia blocks this Event face.')
  }
  if (unshaded && HIRED_MUSCLE[id]) return hiredMuscle(state,id,input)
  if (!unshaded && TRIBAL_REGIONS[id]) return tribalWar(state,id,input)
  const lastingHelp = SPECIAL_CAPABILITIES[id]?.[side]
  if (lastingHelp) return lasting(state,id,side,MOMENTUM.has(id) || (id === 64 && unshaded) ? 'momentum':'capability',lastingHelp)
  const modifier = commandModifiers(state,id,side,faction,input)
  if (modifier) return modifier

  switch(id) {
    case 1: {
      if (unshaded) return perform('Set Military Dominance and immediately return Cavalry in Casualties.',() => {
        dominance(state,'m')
        const casualties = state.pools.casualties
        state.pools.casualties = 0
        eventMarker(state,id,side,'momentum')
        return `Military Dominance where possible, ${casualties} Cavalry made Available, and Battle Casualties are recycled until the Epoch.`
      })
      const names = landNames(REGIONS.filter(({name}) => on(state.land[name],'com') && on(state.land[name],'cav')))
      const removal = mandatorySpace(state,input,names,'Choose a space with Cavalry and Comitates and remove both unit types there.',name => {
        const removed = removeUnit(state,name,'cav',Infinity,'casualties') + removeUnit(state,name,'com',Infinity)
        return `${removed} units removed at ${name}.`
      })
      return {...removal, run:() => {
        dominance(state,'c')
        return removal.run()
      }}
    }
    case 2: return removeSelectedCavalry(state,input,5,'casualties')
    case 3: {
      if (unshaded) return eventProsperity(state,input,side,4,'population')
      const names = landNames(REGIONS.filter(({name}) => {
        const space = state.land[name]
        return on(space,'mil') + on(space,'com') || space.sites.some(site=>['town','hill'].includes(site?.piece))
      }))
      const choice = eventPlaceList(state,input,names,2,{label:'Space'})
      return perform('Remove Civitates Militia, Comitates, Towns, and Hillforts from two spaces.',()=>{
        const picked = choice.check()
        const count = sum(picked.map(name => removeAllOwned(state,name,'c',false)))
        return `${count} Civitates pieces removed${picked.length ? ' from '+picked.join(', ') : ''}.`
      },choice.fields)
    }
    case 4: return eventStilicho(state,faction,input)
    case 5:
      if (unshaded) return trackEvent(state,'red',20,'Dux Resources')
      return perform('Count local Towns and Hillforts, then add Briton Resources and Wealth.',()=>{
        const income = 5*sum(['Durotriges','Dumnonii','Silures','Demetae'].map(name =>
          state.land[name].sites.filter(site=>['town','hill'].includes(site?.piece)).length))
        const resources = changeEventTrack(state,'blue',income)
        const wealth = changeEventTrack(state,'wealth',5)
        return `+ ${resources} Briton Resources and + ${wealth} Wealth.`
      })
    case 6: return eventUther(state,input,side)
    case 8:
      return perform('End Patrols in all four Seas.',()=>{
        for(const sea of Object.keys(SEAS)) state.seas[sea] = false
        return 'All Seas set to No Patrol.'
      })
    case 10: return eventAnnona(state,input)
    case 11: {
      if (!unshaded) {
        const names = eligibleRegions(state,space => space.sites.some(site=>site?.employer) ||
          GROUPS.some(([key,,piece])=>['xw','sw'].includes(piece) && on(space,key)))
        return mandatorySpace(state,input,names,'Remove all Dux pieces from a Region with Warbands or Foederati Troops.',name =>
          `${removeAllOwned(state,name,'d')} Dux pieces removed from ${name}.`)
      }
      const names = eligibleRegions(state,space => space.sites.some(site=>['xs','ss'].includes(site?.piece)))
      const name = input.space ?? names[0]
      const space = state.land[name]
      const picks = space?.sites.flatMap((site,index) => ['xs','ss'].includes(site?.piece) ? [option(String(index),BY_NAME[name].sites[index].name)] : []) ?? []
      const employers = listed(['d','c'],id=>NAMES[id])
      return perform('Mark a Settlement and its nationality’s Warbands as Foederati. Prestige drops whether or not a Settlement is available.',()=>{
        if (names.length) {
          ensure(names.includes(name) && picks.length,'Choose an eligible Region and Settlement.')
          const index = Number(defaultChoice(input,'site',picks))
          const employer = defaultChoice(input,'employer',employers)
          const site = space.sites[index]
          const nation = site.piece[0]
          site.employer = employer
          for (const from of [nation+'w','d'+nation+'w','c'+nation+'w']) {
            if (from !== employer+nation+'w') convertGroup(space,from,employer+nation+'w')
          }
        }
        const delta = changeEventTrack(state,'prestige',-2)
        return `Foederati marked where possible. Dux Prestige changes by ${delta}.`
      },names.length ? [selectField('space','Region',listed(names),name),selectField('site','Settlement',picks,picks[0]?.value),selectField('employer','Employer',employers,'d')] : [])
    }
    case 12: return eventRomanitas(state,input,side)
    case 13: {
      if (unshaded) return eventCunedda(state,input)
      const employers = listed(['d','c'],id=>NAMES[id])
      return perform('Add Scotti Foederati in Ordovices.',()=>{
        const employer = defaultChoice(input,'employer',employers)
        const placed = placeEventHold(state,'Ordovices','ss',input,'site',{employer})
        const units = Math.min(3,availability(state).sw)
        state.land.Ordovices.units[employer+'sw'][0] += units
        return `${NAMES[employer]} receives ${units} Scotti Warbands${placed ? ' and a Settlement' : ''} in Ordovices.`
      },[selectField('employer','Employer',employers,'d'),...holdField(state,'Ordovices','site','ss')])
    }
    case 15: return eventProsperity(state,input,side,unshaded ? 6 : 4,1)
    case 17: {
      if (unshaded) {
        const names = landNames(REGIONS.filter(({name}) => hasFort(state.land[name])))
        const quota = Math.min(4,availability(state).cav,names.length*2)
        return perform('Assign up to four Available Cavalry to Fort spaces, with a limit of two per space.',()=>{
          const allocations = names.map(name=>[name,validInputNumber(input,'cav-'+name,0,2)])
          const count = sum(allocations.map(([,n])=>n))
          ensure(count <= quota,`At most ${quota} Cavalry can be placed.`)
          for (const [name,n] of allocations) state.land[name].units.cav[0] += n
          return `${count} Cavalry placed at Forts.`
        },quota ? names.map(name=>amountField('cav-'+name,name,0,Math.min(2,quota))) : [])
      }
      const names = landNames(REGIONS.filter(({name})=>!hasFort(state.land[name]) && on(state.land[name],'cav')))
      const choices = eventPlaceList(state,input,names,3,{minimum:0,label:'Space'})
      return perform('Choose up to three spaces without Forts and return half their Cavalry to Available.',()=>{
        const picks = choices.check()
        let removed = 0
        for (const name of picks) removed += removeUnit(state,name,'cav',Math.ceil(on(state.land[name],'cav')/2))
        return `${removed} Cavalry made Available.`
      },choices.fields)
    }
    case 18:
      return perform('Start patrolling Oceanus Hibernicus.',()=>{
        state.seas.hib = true
        return 'Oceanus Hibernicus is Patrolled.'
      })
    case 21:
    case 28:
      if (!unshaded && state.markers?.[21]?.side === 'unshaded') {
        return perform('Camelot keeps Hillfort garrisons intact.',()=> 'Camelot blocks this change to garrisons.')
      }
      return perform(unshaded ? 'Release three Comitates and activate the Hillfort Capability.' : 'Hillfort garrisons are removed unless Camelot applies.',()=>{
        const released = unshaded ? releaseComitates(state,3) : 0
        eventMarker(state,id,side,'capability')
        return `${released ? released+' Comitates released. ' : ''}Capability #${id} in effect.`
      })
    case 22: {
      if (!unshaded) return null
      const possible = landNames(REGIONS.filter(({name})=>friendlyControl(state,name,'c')))
      const quota = Math.min(2, Math.min(4,state.pools.notYet)+availability(state).com)
      const fields = []
      if (!isFragmentation(state)) fields.push(selectField('dominance','Dominance',listed(['m','c'],id=>id === 'm' ? 'Military' : 'Civilian'),state.imperium[1]))
      if (possible.length && quota) {
        fields.push(landField('space','Place Comitates in',possible,true),amountField('comitates','Comitates to place',0,quota))
      }
      return perform('Release four Comitates, choose Dominance, and optionally place Comitates in a Briton-controlled space.',()=>{
        const selected = input.space || ''
        const count = validInputNumber(input,'comitates',0,quota)
        ensure(!count || possible.includes(selected),'Choose a Briton-controlled space for placement.')
        if (!isFragmentation(state)) {
          const requested = input.dominance ?? state.imperium[1]
          ensure(['m','c'].includes(requested),'Choose Military or Civilian Dominance.')
          dominance(state,requested)
        }
        const released = releaseComitates(state,4)
        if (count) state.land[selected].units.com[0] += count
        return `${released} Comitates released${count ? ' and '+count+' placed in '+selected : ''}.`
      },fields)
    }
    case 23:
      if (unshaded) return null
      return perform('Civitates pays ten Resources, drawing on Wealth if necessary.',()=>{
        const cost = Math.min(10,state.tracks.blue+state.tracks.wealth)
        spendCivitates(state,cost)
        return `Civitates spends ${cost}.`
      })
    case 24: return populationEvents(state,id,side,input)
    case 25: {
      const buyers = ['c','d','x','s']
      const reward = {c:['wealth',10,'Wealth'],d:['prestige',3,'Prestige'],x:['x',5,'Saxon Renown'],s:['s',5,'Scotti Renown']}
      return perform('Choose one recipient and its track gain.',()=>{
        const target = defaultChoice(input,'target',listed(buyers))
        return trackEvent(state,...reward[target]).run()
      },[selectField('target','Recipient',listed(buyers,id=>`${NAMES[id]} · +${reward[id][1]} ${reward[id][2]}`),faction)])
    }
    case 27:
      return unshaded ? lasting(state,id,side,'capability','Block shaded Tribal War Events while Civitates pays ten Resources at Upkeep.') :
        trackEvent(state,'blue',-20,'Briton Resources')
    case 29: {
      if (!unshaded) return null
      const names = availability(state).town > 0 ? landNames(REGIONS.filter(({name}) => {
        const pieces = piecesByOwner(state.land[name])
        return pieces.d + pieces.c && allEligibleSites(state,name,'town').length
      })) : []
      const choices = [option('','Skip placement'),...listed(names)]
      const name = input.space
      return perform('Civitates may place a Town in a space with any Briton piece.',()=>{
        const name = defaultChoice(input,'space',choices)
        if (!name) return 'Civitates adds no Town.'
        placeEventHold(state,name,'town',input,'site')
        return 'Civitates places a Town at '+name+'.'
      },names.length ? [selectField('space','Space',choices),...names.includes(name) ? holdField(state,name,'site','town') : []] : [])
    }
    case 30: {
      if (!unshaded) return perform('Under Roman Rule, shift to Autonomy and keep current Dominance.',()=>{
        if (isRoman(state)) setImperium(state,'a'+state.imperium[1])
        return 'Imperium is '+state.imperium+'.'
      })
      const names = ['Atrebates','Regni','Cantiaci']
      const quota = Math.min(10,availability(state).cav+state.pools.casualties+state.pools.out)
      const originFields = quota ? Object.entries({available:availability(state).cav,casualties:state.pools.casualties,out:state.pools.out}).map(([key,n]) =>
        amountField('from-'+key,'From '+({available:'Available',casualties:'Casualties',out:'Out of Play'}[key]),0,Math.min(quota,n))) : []
      const fields = [...originFields,...(quota ? names.map(name=>amountField('cav-'+name,'Place in '+name,0,quota)) : [])]
      return perform('Restore Roman Rule with Civilian Dominance and deploy off-map Cavalry.',()=>{
        const weights = names.map(name=>[name,validInputNumber(input,'cav-'+name,0,quota)])
        const availableCount = validInputNumber(input,'from-available',0,availability(state).cav)
        const casualties = validInputNumber(input,'from-casualties',0,state.pools.casualties)
        const out = validInputNumber(input,'from-out',0,state.pools.out)
        ensure(sum(weights.map(([,n])=>n)) === quota && availableCount+casualties+out === quota,`Assign sources and destinations for ${quota} Cavalry.`)
        state.pools.casualties -= casualties
        state.pools.out -= out
        for(const [name,n] of weights) state.land[name].units.cav[0] += n
        setImperium(state,'rc')
        return `${quota} Cavalry deploy. Roman Rule with Civilian Dominance.`
      },fields)
    }
    case 31: {
      if (unshaded) {
        const choices = listed(['x','s'],id=>NAMES[id])
        return perform('Reduce a Barbarian faction’s Renown, stopping at five.',()=>{
          const target = defaultChoice(input,'target',choices)
          if (state.tracks[target] <= 5) return NAMES[target]+' has no Renown to lose.'
          return trackEvent(state,target,-10,NAMES[target]+' Renown',5).run()
        },[selectField('target','Barbarian faction',choices,choices[0].value)])
      }
      const names = landNames(REGIONS.filter(({name})=>on(state.land[name],'xw') && hasTown(state.land[name])))
      const name = input.space ?? names[0]
      const choices = state.land[name]?.sites.flatMap((site,index)=>site?.piece === 'town' ? [option(String(index),BY_NAME[name].sites[index].name)] : []) ?? []
      const removal = mandatorySpace(state,input,names,'Remove a Town where Saxon Warbands are present and add one Refugee.',name=>{
        state.land[name].sites[Number(defaultChoice(input,'site',choices))] = null
        state.tracks.refugees = Math.min(4,state.tracks.refugees+1)
        return 'A Town is removed in '+name+'.'
      })
      if (choices.length) removal.fields.push(selectField('site','Town',choices,choices[0].value))
      return removal
    }
    case 32: {
      const names = eligibleRegions(state,(_,name) => BY_NAME[name].terrain === 'Hills' && BY_NAME[name].seas.includes('hib'))
      const name = input.space ?? names[0]
      const piece = unshaded ? 'hill' : 'ss'
      const groups = unshaded ? [['mil',2],['com',2]] : [['sw',3]]
      const units = names.includes(name) ? groups.map(([key,count]) => eventUnitPlacement(state,faction,name,key,count,input)) : []
      const placement = mandatorySpace(state,input,names,'Select a Hills Region on the Hibernicus coast for the new forces.',name => {
        const donors = units.map(placement => placement.check())
        const hold = placeEventHold(state,name,piece,input,'site')
        return [eventHoldResult(hold,piece,name),...units.map((placement,index) => placement.place(donors[index]))].join(' ')
      })
      if (names.includes(name)) placement.fields.push(...holdField(state,name,'site',piece),...units.flatMap(placement => placement.fields))
      return placement
    }
    case 35: return populationEvents(state,id,side,input)
    case 37:
      if (!unshaded) return null
      return perform('Start patrolling Oceanus Septentrionalis.',()=>{
        state.seas.sept = true
        return 'Oceanus Septentrionalis is Patrolled.'
      })
    case 39: return eventHengest(state,input,side)
    case 43:
      return perform('Hold Omens for a future eligible order change, Field Battle, or Assault.',()=>{
        state.omens = {holder:faction,head:null}
        return `${NAMES[faction]} holds Omens.`
      })
    case 45: {
      const names = ['xw','sw','dxw','cxw','dsw','csw']
      const space = state.land.Cantiaci
      const required = Math.ceil(sum(names.map(key=>on(space,key)))/2)
      const fields = names.filter(key=>on(space,key)).map(key=>amountField(key,groupLabel(key),0,Math.min(on(space,key),required)))
      return perform('Remove half of the Warbands in Cantiaci, rounded up.',()=>{
        const counts = names.map(key=>[key,validInputNumber(input,key,0,on(space,key))])
        ensure(sum(counts.map(([,n])=>n)) === required,`Choose ${required} Warband removals.`)
        for(const [key,n] of counts) removeUnit(state,'Cantiaci',key,n)
        return `${required} Warbands removed from Cantiaci.`
      },fields)
    }
    case 47:
    case 65: return eventAcculturation(state,input,side)
    case 49: return eventVortigern(state,input)
    case 50:
    case 72: {
      if (unshaded) return eventProsperity(state,input,side,2,2,{needsTown:true})
      if (id === 72) return null
      const names = eligibleRegions(state,space=>totalProsperity(space) === 0 && hasTown(space))
      const name = input.space ?? names[0]
      const choices = state.land[name]?.sites.flatMap((site,index)=>site?.piece === 'town' ? [option(String(index),BY_NAME[name].sites[index].name)] : []) ?? []
      const removal = mandatorySpace(state,input,names,'Remove one Town from a Region that has no Prosperity.',name=>{
        state.land[name].sites[Number(defaultChoice(input,'site',choices))] = null
        return 'A Town is removed in '+name+'.'
      })
      if (choices.length) removal.fields.push(selectField('site','Town',choices,choices[0].value))
      return removal
    }
    case 51:
      return perform('Transfer up to five Cavalry from Casualties.',()=>{
        const count = Math.min(5,state.pools.casualties)
        state.pools.casualties -= count
        if (!unshaded) state.pools.out += count
        return `${count} Cavalry moved from Casualties to ${unshaded ? 'Available' : 'Out of Play'}.`
      })
    case 53: return populationEvents(state,id,side,input)
    case 54:
      return perform('Run the Imperium checks with penalties to Briton Control and Prosperity plus Prestige.',()=>{
        resolveImperium(state,0,{control:-5,prosperity:-15})
        return `Imperium after the reduced thresholds: ${state.imperium}.`
      })
    case 59:
      return perform('Move an Available Scotti Settlement onto the Dal Riada card.',()=>{
        if (!availability(state).ss) return 'No Available Scotti Settlement.'
        state.tracks.dalRiada++
        eventMarker(state,id,side,'capability')
        return 'A Scotti Settlement now counts for victory from Dal Riada.'
      })
    case 61:
      return unshaded ? trackEvent(state,'wealth',10,'Civitates Wealth') : populationEvents(state,id,side,input)
    case 62: return eventDyfed(state,faction,input,side)
    case 63: return eventEvangelization(state,input)
    case 66: {
      if (!unshaded) return eventRivalCaesars(state,input)
      const names = eligibleRegions(state,(space,name)=>{
        const faction = control(state,name)
        return ['s','x'].includes(faction) && on(space,faction+'w') >= 2
      })
      return mandatorySpace(state,input,names,'Remove half the unmarked Warbands, rounded down, from a Region their faction controls.',name=>{
        const group = control(state,name)+'w'
        const removed = removeUnit(state,name,group,Math.floor(on(state.land[name],group)/2))
        return `${removed} Warbands removed in ${name}.`
      })
    }
    case 67: return seaFlips(state,input)
    case 70: {
      const names = eligibleRegions(state,(space,name)=>space.pop && friendlyControl(state,name,'c') && allEligibleSites(state,name,'town',true).length)
      const count = Math.min(availability(state).town,names.length)
      const selection = eventPlaceList(state,input,names,count,{minimum:0})
      const fields = [...selection.fields]
      for (const name of selection.selected) if (names.includes(name)) fields.push(...holdField(state,name,'site-'+name,'town',true))
      return perform('Civitates may trade one local Population for one Town in each selected Region.',()=>{
        const picks = selection.check()
        for (const name of picks) {
          placeEventHold(state,name,'town',input,'site-'+name,{onlyVacant:true})
          reducePopulation(state,name)
        }
        return `${picks.length} Towns established through resettlement.`
      },fields)
    }
    case 71: {
      if (unshaded) {
        const names = eligibleRegions(state,(space,name)=>control(state,name) === 'x' &&
          (on(space,'xw') || space.sites.some(site=>site?.piece === 'xs' && !site.employer)))
        const name = input.space ?? names[0]
        const choices = state.land[name]?.sites.flatMap((site,index) => site?.piece === 'xs' && !site.employer ?
          [option(String(index),BY_NAME[name].sites[index].name)] : []) ?? []
        const removing = mandatorySpace(state,input,names,'Remove up to five Saxon Warbands and Settlements, Warbands first.',name=>{
          const space = state.land[name]
          let count = removeUnit(state,name,'xw',5)
          const ownSites = [...choices]
          while (count < 5 && ownSites.length) {
            const slot = Number(defaultChoice(count === 4 ? input : {},'site',ownSites))
            space.sites[slot] = null
            ownSites.splice(ownSites.findIndex(site=>Number(site.value) === slot),1)
            count++
          }
          return `${count} Saxon pieces removed from ${name}.`
        })
        if (choices.length > 1 && on(state.land[name],'xw') === 4) removing.fields.push(selectField('site','Settlement',choices,choices[0].value))
        return removing
      }
      const candidates = (name) => allEligibleSites(state,name,'ss',true).filter(({site})=>site.type === 'H')
      const names = eligibleRegions(state,(_,name)=> BY_NAME[name].seas.some(sea=>['hib','sept'].includes(sea)) && candidates(name).length)
      const name = input.space ?? names[0]
      const choices = (names.includes(name) ? candidates(name) : []).map(({site,index})=>option(String(index),site.name))
      const units = choices.length ? eventUnitPlacement(state,faction,name,'sw',2,input) : null
      const procedure = mandatorySpace(state,input,names,'Place a Scotti Settlement and two Warbands at a vacant coastal Hillfort Site.',name=>{
        const index = Number(defaultChoice(input,'site',choices))
        const donors = units.check()
        const placed = availability(state).ss > 0
        if (placed) state.land[name].sites[index] = {piece:'ss',employer:null}
        return eventHoldResult(placed,'ss',name)+' '+units.place(donors)
      })
      if (choices.length) procedure.fields.push(selectField('site','Vacant Site',choices,choices[0].value),...units.fields)
      return procedure
    }
    case 74: return revoltAdventus(state,input)
    case 75:
      return perform('Fragment the Imperium, add ten Dux Resources, and move excess Out of Play Cavalry.',()=>{
        if (!isFragmentation(state)) {
          state.tracks.prestige = Math.ceil(state.tracks.prestige/4)
          setImperium(state,'f')
        }
        const gains = changeEventTrack(state,'red',10)
        const moving = Math.max(0,state.pools.out-5)
        state.pools.out -= moving
        state.pools.casualties += moving
        return `Fragmentation. +${gains} Dux Resources, ${moving} Cavalry move to Casualties.`
      })
    case 76: return pivotCymbrogi(state,input)
    default: return null
  }
}

export const eventSides = id => SINGLE.has(Number(id)) ? ['single'] : ['unshaded','shaded']
function compiledEvent(state,id,faction,side,input) {
  id = Number(id)
  if (!['d','c','x','s'].includes(faction) || !Number.isInteger(id) || id < 1 || id > 76) return null
  const face = SINGLE.has(id) ? 'unshaded' : side
  if (!['unshaded','shaded'].includes(face)) return null
  return resolveBaseEvent(state,id,faction,face,input)
}
export function eventChoices(state,id,faction,side,input={}) {
  const descriptor = compiledEvent(state,id,faction,side,input)
  if (!descriptor) return null
  const {help,fields,annona,requests,summary} = descriptor
  return {help,fields,needsBattle:Boolean(requests?.length),...(annona ? {annona} : {}),...(summary ? {summary} : {})}
}
export const canCalculateEvent = (state,id,faction,side) => Boolean(compiledEvent(state,id,faction,side,{}))
export function runEvent(state,id,faction,side,input={},roll) {
  const descriptor = compiledEvent(state,id,faction,side,input)
  ensure(descriptor,'This Event face uses the printed tabletop procedure.')
  return descriptor.run(roll)
}

export function eventBattleRequests(state,id,faction,side,input={}) {
  return compiledEvent(state,id,faction,side,input)?.requests || []
}

function unitAllocation(state,name,keys,input,prefix,count) {
  let remaining = count
  const items = keys.filter(key=>on(state.land[name],key)).map(key=>{
    const max = Math.min(count,on(state.land[name],key))
    const initial = Math.min(max,remaining)
    remaining -= initial
    return {key,max,initial,name:prefix+key}
  })
  const chosen = items.map(item=>[item.key,Number(input[item.name] ?? item.initial)])
  const valid = chosen.every(([,n],index)=>Number.isInteger(n) && n >= 0 && n <= items[index].max) &&
    sum(chosen.map(([,n])=>n)) === count
  return {
    fields:count ? items.map(item=>amountField(item.name,groupLabel(item.key),0,item.max,item.initial)) : [],
    check:()=>{
      ensure(valid,`Choose exactly ${count} Troops.`)
      return chosen
    },
    preview:valid ? chosen : items.map(item=>[item.key,item.initial]),
  }
}

const britonTroops = GROUPS.filter(([key,owner])=>!isRaider(key) && ['d','c'].includes(owner)).map(([key])=>key)
const civitatesTroops = GROUPS.filter(([key,owner])=>!isRaider(key) && owner==='c').map(([key])=>key)

function eventStilicho(state,faction,input) {
  if (isFragmentation(state)) return perform('Stilicho requires Roman Rule or Autonomy.',()=> 'Fragmentation prevents Stilicho from taking effect.')
  const deploy = ['Atrebates','Regni','Cantiaci']
  const onMap = REGIONS.map(({name})=>({location:name,count:on(state.land[name],'cav'),cargo:loaded(state.land[name],'cav')}))
  const offMap = [
    {location:'available',label:'Available',count:availability(state).cav,cargo:0},
    {location:'casualties',label:'Casualties',count:state.pools.casualties,cargo:0},
    {location:'out',label:'Out of Play',count:state.pools.out,cargo:0},
  ]
  const total = 10
  let sourceBalance = total
  const sources = [...offMap,...onMap].filter(item=>item.count).map(item=>{
    const key = 'from-'+item.location
    const max = Math.min(total,item.count)
    const initial = Math.min(sourceBalance,max)
    sourceBalance -= initial
    const selected = Number(input[key] ?? initial)
    const valid = Number.isInteger(selected) && selected >= 0 && selected <= max
    const minCargo = Math.max(0,selected-(item.count-item.cargo))
    const maxCargo = Math.min(selected,item.cargo)
    const cargoKey = 'carry-'+item.location
    return {...item,key,max,initial,selected,valid,minCargo,maxCargo,cargoKey,moved:valid ? Number(input[cargoKey] ?? minCargo) : 0}
  })
  let cargoBalance = sum(sources.filter(item=>item.valid).map(item=>Math.min(item.maxCargo,Math.max(item.minCargo,item.moved || 0))))
  const destinations = deploy.map((name,index)=>{
    const key = 'cav-'+name
    const initial = index === 0 ? total : 0
    const selected = Number(input[key] ?? initial)
    const valid = Number.isInteger(selected) && selected >= 0 && selected <= total
    const defaultCargo = valid ? Math.min(selected,cargoBalance) : 0
    cargoBalance -= defaultCargo
    const cargoKey = 'loaded-'+name
    return {name,key,initial,selected,valid,defaultCargo,cargoKey,moved:Number(input[cargoKey] ?? defaultCargo)}
  })
  const fields = sources.flatMap(item=>[
    {...amountField(item.key,'Cavalry from '+(item.label ?? item.location),0,item.max,item.initial),refresh:Boolean(item.cargo)},
    ...(item.valid && item.maxCargo > item.minCargo ? [{...amountField(item.cargoKey,'Carrying Plunder from '+item.location,item.minCargo,item.maxCargo,item.minCargo),refresh:true}] : []),
  ])
  for (const item of destinations) {
    fields.push({...amountField(item.key,'Place Cavalry in '+item.name,0,total,item.initial),refresh:sources.some(source=>source.cargo)})
    if(item.valid && item.selected > 0 && sources.some(source=>source.moved > 0)) {
      fields.push(amountField(item.cargoKey,'Arrive with Plunder in '+item.name,0,item.selected,item.defaultCargo))
    }
  }
  const approvedStock = availability(state)
  const newSites = REGIONS.flatMap(({name,sites})=>sites.flatMap((site,index)=>site.type === 'T' && !state.land[name].sites[index]
    ? ['fort','town'].filter(piece=>approvedStock[piece] > 0).map(piece=>option([name,index,piece].join('/'),site.name+' · '+holdNames[piece])) : []))
  const placementCount = Math.min(5,new Set(newSites.map(item=>item.value.split('/').slice(0,2).join('/'))).size,approvedStock.fort+approvedStock.town)
  const siteOptions = [option('','Leave vacant'),...newSites]
  const placements = Array.from({length:placementCount},(_,index)=>'hold'+(index+1))
  placements.forEach((key,index)=>fields.push(selectField(key,'Optional vacant Town site '+(index+1),siteOptions)))
  return perform('Assign ten Cavalry to the southern muster. Select up to five vacant Town sites for new Forts or Towns.',()=>{
    ensure(sources.every(item=>item.valid && Number.isInteger(item.moved) && item.minCargo <= item.moved && item.moved <= item.maxCargo) &&
      sum(sources.map(item=>item.selected)) === total, 'Choose legal sources for all ten Cavalry.')
    ensure(destinations.every(item=>item.valid && Number.isInteger(item.moved) && item.moved >= 0 && item.moved <= item.selected) &&
      sum(destinations.map(item=>item.selected)) === total && sum(destinations.map(item=>item.moved)) === sum(sources.map(item=>item.moved)),
    'Assign all ten Cavalry and any carried Plunder to the allowed Regions.')
    const sites = placements.map(key=>defaultChoice(input,key,siteOptions)).filter(Boolean).map(value=>value.split('/'))
    ensure(new Set(sites.map(([name,index])=>name+'/'+index)).size === sites.length &&
      ['fort','town'].every(piece=>sites.filter(site=>site[2]===piece).length <= approvedStock[piece]),
    'Choose distinct vacant sites and stay within the Available Fort and Town supply.')
    setImperium(state,'rm')
    let recoveryCavalry = 0
    for (const item of sources) {
      if (state.land[item.location]) {
        state.land[item.location].units.cav[0] -= item.selected
        state.land[item.location].units.cav[1] -= item.moved
      } else {
        if (item.location !== 'available') state.pools[item.location] -= item.selected
        recoveryCavalry += item.selected
      }
    }
    for (const item of destinations) {
      state.land[item.name].units.cav[0] += item.selected
      state.land[item.name].units.cav[1] += item.moved
    }
    for (const [name,index,piece] of sites) state.land[name].sites[Number(index)] = {piece,employer:null}
    eventMarker(state,4,'unshaded','momentum',{recoveryCavalry,faction})
    return `Ten Cavalry deploy and ${sites.length} Strongholds are placed. Return ${recoveryCavalry} Cavalry to Available during Recovery.`
  },fields)
}

function stilichoRecoveryPlan(state) {
  const marker = state.markers?.[4]
  if (!marker?.recoveryCavalry) return null
  const onMap = REGIONS.filter(({name})=>on(state.land[name],'cav'))
  const count = Math.min(marker.recoveryCavalry,sum(onMap.map(({name})=>on(state.land[name],'cav'))))
  const faction = marker.faction || 'd'
  const names = [...onMap].sort((a,b)=>Number(friendlyControl(state,a.name,'d'))-Number(friendlyControl(state,b.name,'d')))
  let remaining = count
  const amounts = names.map(({name})=>{
    const max = Math.min(on(state.land[name],'cav'),count)
    const initial = Math.min(remaining,max)
    remaining -= initial
    return {name,max,initial,key:'stilicho-'+name}
  })
  return {faction,count,amounts,fields:count ? amounts.map(item=>amountField(item.key,item.name,0,item.max,item.initial)) : []}
}
export function stilichoRecoveryChoices(state) {
  const plan = stilichoRecoveryPlan(state)
  return plan ? {faction:plan.faction,count:plan.count,fields:plan.fields} : null
}
export function applyStilichoRecovery(state,input={}) {
  const plan = stilichoRecoveryPlan(state)
  if (!plan) return ''
  const selected = plan.amounts.map(item=>[item.name,validInputNumber(input,item.key,0,item.max,item.initial)])
  ensure(sum(selected.map(([,amount])=>amount)) === plan.count,`Choose ${plan.count} Stilicho Cavalry to return to Available.`)
  for (const [name,amount] of selected) removeUnit(state,name,'cav',amount)
  delete state.markers[4].recoveryCavalry
  return `${plan.count} Stilicho Cavalry returned to Available.`
}

function eventCunedda(state,input) {
  const from = 'Votadini'
  const to = 'Ordovices'
  const oldFort = state.land[from].sites.flatMap((site,index)=>site?.piece === 'hill' ? [option(String(index),BY_NAME[from].sites[index].name)] : [])
  const remove = unitAllocation(state,from,civitatesTroops,input,'remove-',Math.min(2,sum(civitatesTroops.map(key=>on(state.land[from],key)))))
  const draft = clone(state)
  for (const [key,amount] of remove.preview) removeUnit(draft,from,key,amount)
  const fields = [
    ...(oldFort.length > 1 ? [selectField('hill','Votadini Hillfort to remove',oldFort,oldFort[0].value)] : []),
    ...remove.fields.map(field=>({...field,refresh:true})),
    ...holdField(state,to,'site','hill'),
    ...comitatesChoice(draft,4),
  ]
  return perform('Remove one Hillfort and two Civitates Troops where possible in Votadini. Place a Hillfort and up to four Available Troops in Ordovices.',()=>{
    const troops = remove.check()
    const selected = oldFort.length ? Number(defaultChoice(input,'hill',oldFort)) : null
    if (selected !== null) state.land[from].sites[selected] = null
    for (const [key,amount] of troops) removeUnit(state,from,key,amount)
    const hill = placeEventHold(state,to,'hill',input,'site')
    const placed = replaceWithCivitatesUnits(state,to,4,input)
    return `${placed} Civitates Troops${hill ? ' and a Hillfort' : ''} placed in Ordovices after losses in Votadini.`
  },fields)
}

function eventVortigern(state,input) {
  const name = 'Cantiaci'
  const space = state.land[name]
  const saved = unitAllocation(state,name,britonTroops,input,'keep-',Math.min(2,sum(britonTroops.map(key=>on(space,key)))))
  return perform('Choose the Briton Troops that survive in Cantiaci. Place native Saxon forces at Rutupiae.',()=>{
    const retained = Object.fromEntries(saved.check())
    const removed = sum(britonTroops.map(key=>removeUnit(state,name,key,on(space,key)-(retained[key] ?? 0),key==='cav' ? 'casualties' : null)))
    const index = BY_NAME[name].sites.findIndex(site=>site.name==='Rutupiae')
    const placed = availability(state).xs > 0
    if (placed) space.sites[index] = {piece:'xs',employer:null}
    const bands = Math.min(6,availability(state).xw)
    space.units.xw[0] += bands
    return `${removed} Briton Troops removed. ${bands} Saxon Warbands${placed ? ' and a Settlement' : ''} at Rutupiae.`
  },saved.fields)
}

function eventEvangelization(state,input) {
  const names = eligibleRegions(state,(space,name)=>BY_NAME[name].seas.includes('hib') &&
    (space.sites.some(site=>site?.piece === 'hill') || civitatesTroops.some(key=>on(space,key))))
  const chosen = names.includes(input.space) ? input.space : names[0]
  if (!chosen) return perform('Choose a Hibernicus Region where Scotti converts are possible.',()=> 'No eligible coastal Region.')
  const space = state.land[chosen]
  const sites = space.sites.flatMap((site,index)=>site?.piece==='hill' ? [option(String(index),BY_NAME[chosen].sites[index].name)] : [])
  const troops = unitAllocation(state,chosen,civitatesTroops,input,'remove-',Math.ceil(sum(civitatesTroops.map(key=>on(space,key)))/2))
  const fields = [
    selectField('space','Hibernicus coastal Region',listed(names),chosen),
    ...(sites.length > 1 ? [selectField('site','Hillfort to replace',sites,sites[0].value)] : []),
    ...troops.fields,
  ]
  return perform('Convert one Hillfort where present and half the local Civitates Troops, rounded up.',()=>{
    ensure(!input.space || chosen===input.space,'Choose an eligible Hibernicus Region.')
    const losses = troops.check()
    const index = sites.length ? Number(defaultChoice(input,'site',sites)) : null
    const settlement = index!==null && replaceAtSite(state,chosen,index,'ss')
    const count = sum(losses.map(([key,amount])=>removeUnit(state,chosen,key,amount)))
    const placed = Math.min(count,availability(state).sw)
    space.units.sw[0] += placed
    return `${chosen} loses ${count} Civitates Troops${index!==null ? ' and one Hillfort' : ''} and gains ${placed} Scotti Warbands${settlement ? ' and one Settlement' : ''}.`
  },fields)
}

function tribalWarCandidates(state,names) {
  return names.flatMap(name => {
    const space = state.land[name]
    const units = piecesByOwner(space,{strongholds:false})
    const troops = GROUPS.filter(([key]) => key !== 'cav' && on(space,key)).map(([key])=>[
      `${name}/${key}`,`${name} · ${groupLabel(key)} (${on(space,key)} available to remove)`,
    ])
    const holds = space.sites.flatMap((site,index) => site && site.piece !== 'fort' && !units[toOwner(site.piece,site.employer)] ?
      [[`${name}/site${index}`,`${name} · ${BY_NAME[name].sites[index].name} ${holdNames[site.piece]}`]] : [])
    return [...troops,...holds]
  })
}
export const tribalWarOptions = (state,id) => tribalWarCandidates(state,TRIBAL_REGIONS[id]).map(([value]) => value)
export function takeTribalPiece(state,selection) {
  const [name,key] = selection.split('/')
  if(key.startsWith('site')) state.land[name].sites[Number(key.slice(4))] = null
  else removeUnit(state,name,key,1)
}
function tribalWar(state,id,input) {
  const names = TRIBAL_REGIONS[id]
  const preview = clone(state)
  const selections = []
  const fields = []
  for (let i=1;i<=5;i++) {
    const key = 'remove'+i
    const choices = tribalWarCandidates(preview,names)
    if (!choices.length) break
    fields.push(selectField(key,'Remove piece '+i,[noSelection,...choices.map(([value,label])=>option(value,label))],input[key] || ''))
    if (!choices.some(([value])=>value === input[key])) break
    selections.push(input[key])
    takeTribalPiece(preview,input[key])
  }
  return perform('Remove up to two Prosperity in each named Region. Select five legal piece removals in order where possible.',()=>{
    ensure(selections.length === 5 || !tribalWarCandidates(preview,names).length,'Choose all required Tribal War removals.')
    for (const name of names) removeProsperity(state.land[name],2)
    for (const selected of selections) takeTribalPiece(state,selected)
    return `Tribal War at ${names.join(' and ')} removes ${selections.length} pieces and up to four Prosperity.`
  },fields)
}

function eventRandomPick(equal,roll,label) {
  if(equal.length === 1) return equal[0]
  if(typeof roll !== 'function') return equal[0]
  if(equal.length > 6) {
    const column = roll(4,label+' · column') - 1
    const row = roll(6,label+' · row') - 1
    const names = new Set(equal)
    const flattened = RANDOM_SPACES.flat()
    for(let offset = 0;offset < flattened.length;offset++) {
      const name = flattened[(column*6+row+offset)%flattened.length]
      if(names.has(name)) return name
    }
    return equal[0]
  }
  let value
  const sides = equal.length <= 4 ? 4 : 6
  do value = roll(sides,label)
  while(value > equal.length)
  return equal[value-1]
}
function rankEventSpaces(names,rank,limit,roll,label) {
  const selected = []
  let candidates = names.map(name=>({name,rank:rank(name)}))
  while (selected.length < limit && candidates.length) {
    candidates.sort((a,b)=>b.rank-a.rank)
    const equal = candidates.filter(entry=>entry.rank===candidates[0].rank).map(entry=>entry.name)
    const name = eventRandomPick(equal,roll,label)
    candidates = candidates.filter(entry=>entry.name !== name)
    selected.push(name)
  }
  return Object.fromEntries(selected.map((name,index)=>['space'+(index+1),name]))
}
function allowedBotSpecial(state,id,faction,side) {
  const humans = state.humans || [state.human]
  if(id === 5 && (faction === 'x' || faction === 's')) return false
  if(id === 10 && side === 'shaded') return undefined
  if(id === 14) {
    if(faction === 's') return state.eventIndex <= 2 && sum(Object.values(state.land).map(space=>on(space,'sw'))) >= 6
    if(faction === 'd') return state.eventIndex <= 4
    return false
  }
  if(id === 16 && (faction === 's' || faction === 'x')) return !isFragmentation(state) && state.eventIndex <= 4
  if(id === 21 && faction === 'd') return !humans.includes('c') && isRoman(state)
  if(id === 21 && ['s','x'].includes(faction)) return undefined
  if(id === 22 && faction === 'd') return state.imperium[1] === 'c'
  if(id === 28 && faction === 'd') return !humans.includes('c') && isRoman(state)
  if(id === 28 && ['x','s'].includes(faction)) return undefined
  if(id === 35 && faction === 'd') return !isFragmentation(state) && (state.imperium[1] === 'c' || boardTotals(state).pop.x >= 3)
  if(id === 36 && ['d','c'].includes(faction)) return humans.includes('s') ? undefined : false
  if(id === 37 && faction === 'c') return !state.markers?.[73]
  if(id === 50 && faction === 'd') return !isFragmentation(state)
  if(id === 51 && faction === 'c') return !humans.includes('d') && !isFragmentation(state)
  if(id === 54) {
    if (isFragmentation(state)) return false
    const draft = clone(state)
    resolveImperium(draft,0,{control:-5,prosperity:-15})
    if (['x','s'].includes(faction)) return isFragmentation(draft)
    if (isFragmentation(draft)) return undefined
    if (draft.imperium[1] !== state.imperium[1]) return draft.imperium[1] === (faction === 'd' ? 'm' : 'c')
    return scores(draft)[faction].margin > scores(state)[faction].margin
  }
  if(id === 55 && ['d','c'].includes(faction)) return state.eventIndex <= 4
  if(id === 59 && faction === 'd') return humans.includes('s')
  if(id === 64 && ['d','c'].includes(faction)) return state.eventIndex <= 4
  if(id === 70 && ['s','x'].includes(faction)) return state.eventIndex <= 4
  return true
}
function noBotEventChange(before,after) {
  const compare = state=>JSON.stringify([state.land,state.pools,state.tracks,state.seas,state.imperium,state.markers,state.omens])
  return compare(before) === compare(after)
}
function nativeAmount(state,name,faction) {
  return piecesByOwner(state.land[name])[faction]
}

// Only return automatic inputs when both the physical effect and the applicable bot choice are resolved.
export function botEventInput(state,id,faction,side,roll) {
  id = Number(id)
  const requestedSide = side
  if(id === 5 && faction === 'c' || id === 1 && faction === 'c' || id === 35 && faction === 'd') side = 'shaded'
  if(id === 68 && faction === 'x') side = (state.humans || [state.human]).includes('s') ? 'unshaded' : 'shaded'
  const allowed = allowedBotSpecial(state,id,faction,side)
  if (allowed !== true) return allowed === false ? null : undefined
  const info = eventChoices(state,id,faction,side)
  if (!info) return undefined
  if (info.needsBattle) return undefined
  const draft = clone(state)
  let input
  if(id === 25) input = {target:faction}
  else if(id === 31 && side === 'unshaded' && ['d','c'].includes(faction)) {
    const max = Math.max(state.tracks.x,state.tracks.s)
    input = {target:eventRandomPick(['x','s'].filter(key=>state.tracks[key]===max),roll,'Waelcyrge')}
  }
  else if(id === 55 && side === 'unshaded' && ['d','c'].includes(faction)) {
    const ordered = Object.keys(SEAS).map(sea=>[sea,sum(regions.filter(region=>region.seas.includes(sea) &&
      friendlyControl(state,region.name,faction)).map(region=>totalProsperity(state.land[region.name])))])
    const maximum = Math.max(...ordered.map(([,n])=>n))
    input = {sea:eventRandomPick(ordered.filter(([,n])=>n===maximum).map(([sea])=>sea),roll,'Niall’s Raid')}
  }
  else if(id === 76 && faction === 'c') {
    const canBuild = eligibleRegions(state,(space,name)=>BY_NAME[name].terrain === 'Hills' && friendlyControl(state,name,'c') && space.sites.some(site=>!site))
    if(!canBuild.length || !availability(state).hill) return null
    const quota = Math.min(5,canBuild.length,availability(state).hill)
    input = rankEventSpaces(canBuild,()=>0,quota,roll,'Cymbrogi')
    const placements = Object.values(input)
    const extraTroops = Math.min(5-quota,Math.max(0,availability(state).com + Math.min(9,state.pools.notYet) - quota))
    const extras = eligibleRegions(state,(_,name)=>BY_NAME[name].terrain === 'Hills' && friendlyControl(state,name,'c') && !placements.includes(name))
    for (const [key,name] of Object.entries(rankEventSpaces(extras,()=>0,extraTroops,roll,'Cymbrogi · Comitates'))) {
      input['space'+(quota+Number(key.slice(5)))] = name
    }
    for (const name of Object.values(input)) {
      const site = allEligibleSites(state,name,'hill',true).find(({site})=>site.type==='H') ??
        allEligibleSites(state,name,'hill',true)[0]
      if(site) input['site-'+name] = site.index
    }
  }
  else if(id === 15 || [50,72].includes(id) && side === 'unshaded') {
    const add = side === 'unshaded'
    if(id === 15 && faction === 'd' && isFragmentation(state)) return null
    if(id === 15 && ['x','s'].includes(faction)) {
      const {total} = boardTotals(state)
      const threshold = isRoman(state) ? 75 : 60
      if(isFragmentation(state) || total+state.tracks.prestige <= threshold) return null
    }
    if(id === 15 && faction === 'c') return undefined
    if(id === 50 && faction === 'c') return undefined
    if(id === 72 && faction === 'c') return undefined
    if(id === 72 && faction === 'd' && isFragmentation(state)) return undefined
    const names = eligibleRegions(state,(space,name) => add
      ? space.pros.some(n=>n<space.pop) && (id===15 || hasTown(space))
      : Boolean(control(state,name) && control(state,name) !== faction && totalProsperity(space)))
    const limit = Math.min(id === 15 ? add ? 6 : 4 : 2,add ? goldAvailable(state) : 90)
    const rank = id === 15 && faction === 'd' ? name=>nativeAmount(state,name,'d')
      : id !== 15 ? name=>Math.min(2,sum(state.land[name].pros.map(n=>Math.max(0,state.land[name].pop-n)))) : ()=>0
    input = rankEventSpaces(names,rank,limit,roll,'Event #'+id)
    if(id===15 && !add && Object.keys(input).length !== Math.min(4,eligibleRegions(state,space=>totalProsperity(space)).length)) return undefined
  }
  else if (!info.fields.length) input = {}
  else return undefined
  try {
    runEvent(draft,id,faction,side,input,roll)
  } catch {
    return undefined
  }
  return noBotEventChange(state,draft) ? null : { ...input, ...(side === requestedSide ? {} : { _side:side }) }
}

function matchingFoederati(space,nation,employer) {
  return on(space,employer+nation+'w') + space.sites.filter(site=>site?.employer===employer && site.piece===nation+'s').length
}
function foederatiSelections(state,predicate) {
  return regions.flatMap(({name}) => {
    const space = state.land[name]
    return ['d','c'].flatMap(employer => ['x','s'].filter(nation=>matchingFoederati(space,nation,employer) && predicate(space,name,nation,employer))
      .map(nation=>option(name+'/'+employer+nation,`${name} · ${NAMES[employer]} ${NAMES[nation]} Foederati`)))
  })
}
function releaseFoederati(space,nation,employer) {
  const key = employer+nation+'w'
  convertGroup(space,key,nation+'w')
  for(const site of space.sites) if(site?.piece===nation+'s' && site.employer===employer) site.employer = null
}
function removeFoederati(state,name,nation,employer) {
  const space = state.land[name]
  const unit = employer+nation+'w'
  removeUnit(state,name,unit,on(space,unit))
  space.sites = space.sites.map(site=>site?.employer===employer && site.piece===nation+'s' ? null : site)
}
function replaceWithCivitatesUnits(state,name,amount,input,key='comitates') {
  const stock = availability(state)
  const minimum = Math.max(0,Math.min(amount,stock.mil+stock.com)-stock.mil)
  const com = validInputNumber(input,key,minimum,Math.min(stock.com,amount),minimum)
  const mil = Math.min(stock.mil,amount-com)
  state.land[name].units.com[0] += com
  state.land[name].units.mil[0] += mil
  return com+mil
}
function comitatesChoice(state,amount,key='comitates') {
  const stock = availability(state)
  const cap = Math.min(amount,stock.com)
  const minimum = Math.max(0,Math.min(amount,stock.mil+stock.com)-stock.mil)
  return cap ? [amountField(key,'Use Available Comitates',minimum,cap,minimum)] : []
}
function replaceAtSite(state,name,index,piece,employer=null) {
  const available = availability(state)[piece] > 0
  state.land[name].sites[index] = available ? {piece,employer} : null
  return available
}

function eventUther(state,input,side) {
  if(side==='unshaded') {
    const names = eligibleRegions(state,space=>on(space,'cav') && space.sites.some(site=>site?.piece==='hill'))
    const choices = eventPlaceList(state,input,names,3,{minimum:0})
    const fields = [...choices.fields]
    for(const name of choices.selected) if(names.includes(name)) {
      const slots = state.land[name].sites.flatMap((site,index)=>site?.piece==='hill' ? [option(String(index),BY_NAME[name].sites[index].name)]:[])
      fields.push(selectField('hill-'+name,'Hillfort in '+name,slots,slots[0].value),
        selectField('payer-'+name,'Take from '+name,[option('blue','Briton Resources'),option('wealth','Wealth')]))
    }
    return perform('Shift to Military Dominance. Choose up to three eligible Regions to lose a Hillfort and Prosperity and pay Dux.',()=>{
      const picks = choices.check()
      const allocations = picks.map(name=>{
        const slot = Number(defaultChoice(input,'hill-'+name,state.land[name].sites.flatMap((site,index)=>site?.piece==='hill' ? [option(String(index),'Hillfort')]:[])))
        const pool = defaultChoice(input,'payer-'+name,[option('blue','Briton Resources'),option('wealth','Wealth')])
        return {name,slot,pool}
      })
      dominance(state,'m')
      for(const {name,slot,pool} of allocations) {
        state.land[name].sites[slot] = null
        removeProsperity(state.land[name],1)
        const paid = Math.min(state.tracks[pool],5)
        changeEventTrack(state,pool,-paid)
        changeEventTrack(state,'red',paid)
      }
      return 'Uther asserts Military Dominance'+(picks.length ? ' in '+picks.join(', ') : '')+'.'
    },fields)
  }
  const names = eligibleRegions(state,space=>piecesByOwner(space).d > 0)
  const name = input.space ?? names[0]
  const space = state.land[name]
  const fields = []
  if(names.includes(name)) {
    fields.push(...comitatesChoice(state,on(space,'cav')))
    for(const [index,site] of space.sites.entries()) {
      if(site?.piece==='fort' && BY_NAME[name].sites[index].type==='T') {
        fields.push(selectField('replace'+index,'Replace '+BY_NAME[name].sites[index].name,
          [option('hill','Hillfort'),option('town','Town')],'hill'))
      }
    }
  }
  const result = mandatorySpace(state,input,names,'Shift to Civilian Dominance and convert Dux positions to Civitates in one Region.',name=>{
    const number = on(space,'cav')
    const units = replaceWithCivitatesUnits(state,name,number,input)
    removeUnit(state,name,'cav',number,'casualties')
    for(const [index,site] of space.sites.entries()) {
      if(site?.piece==='fort') {
        const choices = [option('hill','Hillfort')]
        if(BY_NAME[name].sites[index].type==='T') choices.push(option('town','Town'))
        replaceAtSite(state,name,index,defaultChoice(input,'replace'+index,choices))
      } else if(site?.employer==='d') site.employer='c'
    }
    for(const nation of ['x','s']) convertGroup(space,'d'+nation+'w','c'+nation+'w')
    return `In ${name}, ${number} Cavalry go to Casualties and ${units} Civitates troops replace them where possible.`
  })
  return {...result,fields:[...result.fields,...fields],run:()=>{
    if(names.length) ensure(names.includes(name),'Choose an eligible Uther Region.')
    dominance(state,'c')
    changeEventTrack(state,'prestige',-5)
    return result.run()
  }}
}
function eventHengest(state,input,side) {
  if(side==='unshaded') {
    const regions = foederatiSelections(state,(_,name)=>friendlyControl(state,name,'c'))
    return perform('Remove one nationality and employer group of Foederati in a Briton-controlled Region.',()=>{
      if(!regions.length) return 'No eligible Foederati.'
      const [name,pair] = defaultChoice(input,'group',regions).split('/')
      removeFoederati(state,name,pair[1],pair[0])
      return `Remove ${NAMES[pair[0]]} ${NAMES[pair[1]]} Foederati in ${name}.`
    },regions.length?[selectField('group','Foederati group',regions,regions[0].value)]:[])
  }
  const candidates = regions.flatMap(({name})=>{
    const space = state.land[name]
    if (!piecesByOwner(space).c) return []
    return ['d','c'].filter(emp=>['x','s'].some(nation=>matchingFoederati(space,nation,emp)))
      .map(emp=>option(name+'/'+emp,`${name} · release ${NAMES[emp]} Foederati`))
  })
  return perform('Choose one employer’s Foederati. Remove local Militia and release the selected groups.',()=>{
    if(!candidates.length) return 'No eligible Region and employer.'
    const [name,emp] = defaultChoice(input,'group',candidates).split('/')
    const space = state.land[name]
    removeUnit(state,name,'mil',on(space,'mil'))
    for (const nation of ['x','s']) releaseFoederati(space,nation,emp)
    return `${NAMES[emp]} Foederati are released and Militia removed in ${name}.`
  },candidates.length?[selectField('group','Region and employer',candidates,candidates[0].value)]:[])
}
function eventDyfed(state,faction,input,side) {
  const name = 'Demetae'
  const space = state.land[name]
  if(side==='shaded') {
    const units = eventUnitPlacement(state,faction,name,'sw',4,input)
    return perform('Place Scotti forces in Demetae.',()=>{
      const donors = units.check()
      const placed = placeEventHold(state,name,'ss',input,'site')
      return eventHoldResult(placed,'ss',name)+' '+units.place(donors)
    },[...holdField(state,name,'site','ss'),...units.fields])
  }
  const settlements = space.sites.flatMap((site,index)=>site?.piece==='ss' && !site.employer ? [option(String(index),BY_NAME[name].sites[index].name)]:[])
  const amount = on(space,'sw')
  const fields = [...comitatesChoice(state,amount)]
  if(settlements.length>1) fields.push(selectField('site','Settlement to replace',settlements,settlements[0].value))
  return perform('Exchange native Scotti pieces in Demetae for Civitates pieces.',()=>{
    const troops = replaceWithCivitatesUnits(state,name,amount,input)
    removeUnit(state,name,'sw',amount)
    if(settlements.length) replaceAtSite(state,name,Number(defaultChoice(input,'site',settlements)),'hill')
    return `${amount} Scotti Warbands removed, ${troops} Civitates troops placed.`
  },fields)
}
function eventAcculturation(state,input,side) {
  if(side==='unshaded') {
    const choices = foederatiSelections(state,(_,name)=>friendlyControl(state,name,'c'))
    const selection = choices.find(item=>item.value===input.group)?.value ?? choices[0]?.value
    const [name,pair] = selection?.split('/') || []
    const number = pair && state.land[name] ? on(state.land[name],pair[0]+pair[1]+'w') : 0
    return perform('Replace a single nationality and employer group with Civitates pieces.',()=>{
      if(!choices.length) return 'No eligible Foederati.'
      defaultChoice(input,'group',choices)
      const space = state.land[name]
      const [employer,nation] = pair
      const replacements = replaceWithCivitatesUnits(state,name,number,input)
      removeUnit(state,name,employer+nation+'w',number)
      for(const [index,site] of space.sites.entries()) {
        if(site?.employer===employer && site.piece===nation+'s') replaceAtSite(state,name,index,'hill')
      }
      return `Replace ${NAMES[employer]} ${NAMES[nation]} Foederati with Civitates pieces in ${name}, including ${replacements} Troops.`
    },choices.length ? [selectField('group','Foederati group',choices,choices[0].value),...comitatesChoice(state,number)] : [])
  }
  const choices = regions.flatMap(({name})=>{
    const space = state.land[name]
    if(!space.sites.some(site=>['town','hill'].includes(site?.piece))) return []
    return ['x','s'].filter(nation=>space.sites.some(site=>site?.piece===nation+'s' && site.employer))
      .map(nation=>option(name+'/'+nation,`${name} · ${NAMES[nation]}`))
  })
  return perform('Choose a nationality with a Foederati Settlement and release its markers. Replace local native Civitates holdings.',()=>{
    if(!choices.length) return 'No eligible Region.'
    const [name,nation] = defaultChoice(input,'group',choices).split('/')
    const space = state.land[name]
    for(const employer of ['d','c']) releaseFoederati(space,nation,employer)
    for(const [index,site] of space.sites.entries()) {
      if(['town','hill'].includes(site?.piece)) replaceAtSite(state,name,index,nation+'s')
    }
    const removed = removeUnit(state,name,'mil',on(space,'mil')) + removeUnit(state,name,'com',on(space,'com'))
    const placed = Math.min(availability(state)[nation+'w'],removed)
    space.units[nation+'w'][0] += placed
    return `${NAMES[nation]} revolt in ${name}. ${removed} Civitates Troops give way to ${placed} Warbands.`
  },choices.length ? [selectField('group','Region and nationality',choices,choices[0].value)] : [])
}

function eventAnnona(state,input) {
  return {
    ...annonaChoices(state,input,'x'),
    run(roll) {
      const plan = planAnnona(state,input,roll,'x')
      return resolveAnnona(state,plan.paid,plan)
    },
  }
}
function eventRomanitas(state,input,side) {
  if (side === 'unshaded') {
    const groups = foederatiSelections(state,(_,name,nation,employer)=>employer === 'd')
    const selected = groups.find(item=>item.value===input.group)?.value ?? groups[0]?.value
    const [name,pair] = selected?.split('/') || []
    const amount = pair && state.land[name] ? on(state.land[name],pair+'w') : 0
    const take = Math.min(amount,availability(state).cav+state.pools.casualties+state.pools.out)
    const fields = groups.length ? [selectField('group','Dux Foederati to replace',groups,groups[0].value)] : []
    if(take) {
      const maxOut = Math.min(take,state.pools.out)
      const maxCas = Math.min(take-maxOut,state.pools.casualties)
      fields.push(amountField('from-out','Cavalry from Out of Play',0,Math.min(take,state.pools.out),maxOut),
        amountField('from-casualties','Cavalry from Casualties',0,Math.min(take,state.pools.casualties),maxCas))
    }
    return perform('Replace one nationality’s red Foederati with off-map Cavalry and Available Forts.',()=>{
      if(!groups.length) return 'No eligible Dux Foederati.'
      defaultChoice(input,'group',groups)
      const out = validInputNumber(input,'from-out',0,Math.min(take,state.pools.out),Math.min(take,state.pools.out))
      const casual = validInputNumber(input,'from-casualties',0,Math.min(take,state.pools.casualties),Math.min(take-out,state.pools.casualties))
      ensure(out+casual<=take && take-out-casual<=availability(state).cav,'Allocate all available replacements from legal off-map pools.')
      const space = state.land[name]
      state.pools.out -= out
      state.pools.casualties -= casual
      removeUnit(state,name,pair+'w',amount)
      space.units.cav[0] += take
      for(const [index,site] of space.sites.entries()) {
        if(site?.employer==='d' && site.piece===pair[1]+'s') replaceAtSite(state,name,index,'fort')
      }
      return `${take} Cavalry replace red Foederati in ${name}.`
    },fields)
  }
  const names = eligibleRegions(state,space=>on(space,'cav') || hasFort(space))
  const name = input.space ?? names[0]
  const space = state.land[name]
  const fields = []
  if(names.includes(name)) {
    const available = availability(state)
    const number = on(space,'cav')
    if(number && available.xw) fields.push(amountField('saxon','Replace Cavalry with Saxon Warbands',0,Math.min(available.xw,number),Math.min(available.xw,number)))
    for(const [index,site] of space.sites.entries()) {
      if(site?.piece==='fort') fields.push(selectField('fort'+index,'Settlement at '+BY_NAME[name].sites[index].name,
        [option('xs','Saxon Settlement'),option('ss','Scotti Settlement')],available.xs ? 'xs' : 'ss'))
    }
  }
  const removal = mandatorySpace(state,input,names,'Replace all Cavalry and Forts in one Region with native Barbarian forces.',name=>{
    const available = availability(state)
    const number = on(space,'cav')
    const saxon = validInputNumber(input,'saxon',0,Math.min(available.xw,number),Math.min(available.xw,number))
    const scotti = Math.min(available.sw,number-saxon)
    ensure(saxon+scotti===Math.min(available.xw+available.sw,number),'Use Available Warbands where possible.')
    removeUnit(state,name,'cav',number,'casualties')
    space.units.xw[0] += saxon
    space.units.sw[0] += scotti
    for(const [index,site] of space.sites.entries()) {
      if(site?.piece==='fort') {
        const choices = [
          ...(availability(state).xs ? [option('xs','Saxons')] : []),
          ...(availability(state).ss ? [option('ss','Scotti')] : []),
        ]
        if(choices.length) replaceAtSite(state,name,index,defaultChoice(input,'fort'+index,choices))
        else space.sites[index] = null
      }
    }
    return `In ${name}, Cavalry go to Casualties and ${saxon+scotti} Barbarian Warbands replace them.`
  })
  removal.fields.push(...fields)
  return removal
}
export const rivalCaesarsLosses = pieces => Math.ceil(pieces/2)

function eventRivalCaesars(state,input) {
  const eligible = eligibleRegions(state,space=>piecesByOwner(space).d)
  const pairKeys = eligible.flatMap((a,i)=>eligible.slice(i+1).filter(b=>BY_NAME[a].adj.includes(b)).map(b=>a+'/'+b))
  const pairs = listed(pairKeys,key=>key.replace('/',' and '))
  const selected = input.pair ?? pairs[0]?.value
  const picks = pairKeys.includes(selected) ? selected.split('/') : []
  const fields = pairs.length ? [selectField('pair','Adjacent Regions',pairs,pairs[0].value)] : []
  const breakdown = picks.map(name => {
    const pieces = piecesByOwner(state.land[name]).d
    return {name,pieces,count:rivalCaesarsLosses(pieces)}
  })
  const calculation = breakdown.map(({name,pieces,count}) =>
    `${name} · ${pieces} Dux ${pieces === 1 ? 'piece' : 'pieces'} → ${count} ${count === 1 ? 'loss' : 'losses'}.`).join(' ')
  function removalMenu(board,name) {
    const space = board.land[name]
    return [
      ...['cav','dxw','dsw'].filter(key=>on(space,key)).map(key=>option(key,groupLabel(key))),
      ...space.sites.flatMap((site,index)=>site?.employer === 'd' ? [option('site'+index,BY_NAME[name].sites[index].name)] : []),
    ].concat(piecesByOwner(space).d === space.sites.filter(site=>site?.piece==='fort').length ?
      space.sites.flatMap((site,index)=>site?.piece==='fort' ? [option('site'+index,BY_NAME[name].sites[index].name+' Fort')] : []) : [])
  }
  const draft = clone(state)
  const removals = []
  const apply = (board,name,key) => {
    if(key.startsWith('site')) board.land[name].sites[Number(key.slice(4))] = null
    else removeUnit(board,name,key,1,key==='cav'?'casualties':null)
  }
  const required = sum(breakdown.map(({count}) => count))
  for(const {name,count} of breakdown) {
    for(let i=1;i<=count;i++) {
      const key = 'loss-'+name+'-'+i
      const menu = removalMenu(draft,name)
      fields.push(selectField(key,`Loss ${i} in ${name}`,[noSelection,...menu], input[key] || ''))
      if(!menu.some(item=>item.value===input[key])) break
      removals.push([name,input[key]])
      apply(draft,name,input[key])
    }
  }
  const help = 'Remove half the Dux pieces in each selected Region, rounded up. Forts are last.'
  const event = perform(help,()=>{
    if(!pairs.length) return 'No adjacent Dux Regions.'
    defaultChoice(input,'pair',pairs)
    ensure(removals.length===required,'Choose each required Dux loss in order.')
    for(const [name,key] of removals) apply(state,name,key)
    return `${required} Dux pieces lost. ${calculation}`
  },fields)
  return {...event,summary:calculation}
}

import { BY_NAME, GROUP, GROUPS, REGIONS } from './data.mjs'
import { card } from './cards.mjs'
import { battleForecast, strongholdStats } from './battle.mjs'
import { eventBattleRequests, eventChoices, runEvent, tribalWarOptions, takeTribalPiece } from './events.mjs'
import { availability, boardTotals, clone, control, friendlyControl, goldAvailable, isFragmentation, isHumanFaction, isRoman, on, piecesByOwner, scores, sum, toOwner, totalProsperity, validatePosition } from './position.mjs'
import { resolveImperium } from './sequence.mjs'
import { scenarioInfo } from './scenarios.mjs'

const briton = faction => faction === 'c' || faction === 'd'
const ownPieces = (state,name,faction) => piecesByOwner(state.land[name])[faction]
const dominates = (state,faction) => state.imperium[1] === (faction === 'c' ? 'c' : 'm')
const epochRemaining = state => scenarioInfo(state).epochs-state.epoch
const thresholds = state => {
  const current = scores(state)
  return {
    c:current.c.score-(isFragmentation(state) ? 16 : isRoman(state) ? 36 : 27),
    d:current.d.score-(isFragmentation(state) ? 17 : isRoman(state) ? 75 : 60),
  }
}
const foederati = (state,name,employer,nation) => on(state.land[name],employer+nation+'w') +
  state.land[name].sites.filter(site => site?.piece === nation+'s' && site.employer === employer).length
const stockedCavalry = state => availability(state).cav+state.pools.casualties+state.pools.out
const compact = state => JSON.stringify([state.land,state.pools,state.tracks,state.seas,state.imperium,state.roads,state.markers,state.omens])
const tribalCards = new Set([19,20,26,34,40,42,44,48])
const numberedInputs = (items,prefix='space') => Object.fromEntries(items.map((name,index) => [prefix+(index+1),name]))
const candidacy = (name,input,rank = []) => ({name, input, rank})
const ownTown = space => space.sites.some(site => site?.piece === 'town')

export function eventFieldOptions(state,id,faction,side,key,input = {}) {
  return eventChoices(state,id,faction,side,input)?.fields.find(field => field.name === key)?.options?.map(item => item.value).filter(Boolean) ?? []
}
function eventFields(state,id,faction,side,input = {}) {
  return eventChoices(state,id,faction,side,input)?.fields ?? []
}
function placeList(state,id,faction,side,pick,rank,filter = () => true) {
  const fields = eventFields(state,id,faction,side).filter(f => /^space\d+$/.test(f.name))
  const names = [...(fields[0]?.options ?? [])].map(o => o.value).filter(Boolean)
  const candidates = names.filter(filter).map(name => ({name,rank:rank(name)}))
  const selected = []
  while (candidates.length && selected.length < fields.length) {
    const chosen = pick(candidates,card(id).title)
    selected.push(chosen.name)
    candidates.splice(candidates.indexOf(chosen),1)
  }
  return numberedInputs(selected)
}
function controlGain(before,after,faction) {
  const key = faction === 'd' && !isFragmentation(after) ? 'c' : faction
  return boardTotals(after).pop[key]-boardTotals(before).pop[key]
}
function changeRank(before,after,faction) {
  const stock = {gainHolds:0,lostHolds:0,foesHolds:0,gainUnits:0,lostUnits:0,foesUnits:0}
  for (const {name} of REGIONS) {
    const a = before.land[name], b = after.land[name]
    const owns = site => site && (toOwner(site.piece,site.employer) === faction)
    for (let n=0;n<a.sites.length;n++) {
      const old = a.sites[n], next = b.sites[n]
      if (JSON.stringify(old) === JSON.stringify(next)) continue
      if (owns(next)) stock.gainHolds++
      if (owns(old)) stock.lostHolds++
      if (old && !owns(old)) stock.foesHolds++
    }
    for (const [key,owner] of GROUPS) {
      const diff = on(b,key)-on(a,key)
      if (owner === faction && diff > 0) stock.gainUnits += diff
      if (owner === faction && diff < 0) stock.lostUnits -= diff
      if (owner !== faction && diff < 0) stock.foesUnits -= diff
    }
  }
  return [stock.gainHolds-stock.lostHolds,stock.foesHolds,stock.gainUnits-stock.lostUnits,stock.foesUnits,
    controlGain(before,after,faction),scores(after)[faction].margin-scores(before)[faction].margin]
}
function evaluate(state,id,faction,side,input) {
  const draft = clone(state)
  runEvent(draft,id,faction,side,input,() => 3)
  validatePosition(draft)
  return draft
}
function pickEffect(state,id,faction,side,options,pick,{accept = () => true,priority = () => []} = {}) {
  const choices = []
  const previous = compact(state)
  for (const entry of options) {
    const after = evaluate(state,id,faction,side,entry.input)
    if (compact(after) === previous || !accept(after,entry)) continue
    choices.push({...entry,rank:[...priority(after),...entry.rank,...changeRank(state,after,faction)]})
  }
  return pick(choices,card(id).title)?.input ?? null
}
function numberedAmounts(items,total) {
  const input = {}
  let remaining = total
  for (const [key,max] of items) {
    const n = Math.min(remaining,max)
    input[key] = n
    remaining -= n
  }
  return input
}
function allyRemoval(state,name,faction) {
  const order = faction === 'c' ? ['cav','dxw','dsw','mil','com','cxw','csw'] : ['com','mil','cxw','csw','dsw','dxw','cav']
  const stock = sum(order.map(key => on(state.land[name],key)))
  return numberedAmounts([...order].reverse().map(key => ['keep-'+key,on(state.land[name],key)]),Math.min(stock,2))
}

function hiredCandidates(state,id,faction,pick) {
  const side = 'unshaded'
  const valid = eventFieldOptions(state,id,faction,side,'space')
  const names = valid.length ? valid : [{34:'Atrebates',40:'Catuvellauni',44:'Corieltauvi',49:'Cantiaci'}[id]]
  const stock = availability(state)
  if (briton(faction) && id !== 49 && (stock.xw < 3 || !stock.xs)) return null
  const choices = []
  for (const name of names.filter(Boolean)) {
    const land = state.land[name]
    if (briton(faction) && id !== 49 && (friendlyControl(state,name,faction) || land.sites.some(site => site?.piece === 'xs' && site.employer))) continue
    const employers = briton(faction) ? [faction] : ['c','d']
    for (const employer of employers) {
      const base = {space:name,employer}
      const sites = eventFieldOptions(state,id,faction,side,'site',base)
      for (const val of sites.length ? sites : [null]) {
        const index = val === null ? -1 : Number(val)
        const site = land.sites[index]
        const removesFort = index >= 0 && site?.piece === 'fort'
        const replaces = index >= 0 && site && toOwner(site.piece,site.employer) !== faction
        const prefersHill = index >= 0 && BY_NAME[name].sites[index].type === 'H'
        const input = val === null ? base : {...base,site:val}
        if (!briton(faction) && (!removesFort || !stock.xs)) continue
        choices.push(candidacy(name,input,[+Boolean(replaces),Number(prefersHill),Number(employer === 'c')]))
      }
    }
  }
  return pickEffect(state,id,faction,side,choices,pick)
}

function tribeChoice(state,id,faction,side,pick) {
  const preferFort = faction === 'x' && [19,20,26,34,42,44,48].includes(id) || faction === 's' && id === 26
  if (briton(faction) || preferFort) {
    const hired = hiredCandidates(state,id,faction,pick)
    if (hired || briton(faction)) return hired ? {...hired,_side:'unshaded'} : null
  }
  if (state.markers[27]?.side === 'unshaded') return null
  const board = clone(state)
  const result = []
  const focusBritons = faction === 's' && id !== 26 || id === 40
  for (let i=0;i<5;i++) {
    const choices = tribalWarOptions(board,id).map(value => {
      const [name,key] = value.split('/')
      const space = board.land[name]
      const site = key.startsWith('site') ? space.sites[Number(key.slice(4))] : null
      const owner = site ? toOwner(site.piece,site.employer) : GROUP[key].owner
      const strength = site ? {town:5,hill:4,xs:3,ss:3}[site.piece] ?? 0 : {com:4,xw:3,sw:3,mil:2,xr:1,sr:1}[GROUP[key].piece] ?? 0
      const count = piecesByOwner(space,{strongholds:false})[owner]
      const opensHold = space.sites.some(site => site && site.piece !== 'fort' && toOwner(site.piece,site.employer) === owner) && count <= 4-i
      return {name,value,owner,rank:[focusBritons ? Number(briton(owner)) : Number(owner !== faction),Number(owner !== faction),Number(Boolean(site)),Number(opensHold),strength]}
    })
    const choice = pick(choices,card(id).title+' · losses')
    if (!choice) break
    takeTribalPiece(board,choice.value)
    result.push(choice)
  }
  const enemy = result.filter(loss => focusBritons ? briton(loss.owner) : loss.owner !== faction).length
  if (enemy <= result.length-enemy) return null
  return {...numberedInputs(result.map(loss => loss.value),'remove'),_side:'shaded'}
}

function decideImperium(state) {
  const preview = clone(state)
  resolveImperium(preview,0)
  return preview.imperium
}
function restoreTownProsperity(state,id,faction,pick) {
  if (faction === 'c' && (isFragmentation(state) || decideImperium(state) !== 'f')) return null
  if (faction === 'd' && id === 50 && isFragmentation(state)) return null
  if (faction === 'd' && id === 72 && isFragmentation(state) && epochRemaining(state) <= 1) return null
  const capacity = name => Math.min(2,sum(state.land[name].pros.map(n=>Math.max(0,state.land[name].pop-n))))
  const constrained = faction === 'd' && id === 72 && isFragmentation(state)
  const input = placeList(state,id,faction,'unshaded',pick,name => [
    ...(faction === 'c' ? [Number(friendlyControl(state,name,'c'))] : []),capacity(name),
  ],name => !constrained || control(state,name) === 'd' && capacity(name) >= 2)
  if (constrained && (Object.keys(input).length !== 2 || goldAvailable(state) < 4)) return null
  return Object.keys(input).length ? input : null
}
function eventBattle(state,id,faction,pick) {
  const side = 'shaded'
  const options = eventFieldOptions(state,id,faction,side,'target').flatMap(value => {
    const [request] = eventBattleRequests(state,id,faction,side,{target:value})
    if (!request) return []
    const {name,defender} = request
    const report = battleForecast(state,request)
    const space = state.land[name]
    const sideOwners = !isFragmentation(state) && briton(defender) && !briton(faction) ? ['d','c'] : [defender]
    const capacity = sum(space.sites.filter(site => site && sideOwners.includes(toOwner(site.piece,site.employer)))
      .map(site => strongholdStats(state,name,site.piece).capacity))
    const troops = sum(sideOwners.map(owner => piecesByOwner(space,{raiders:false,strongholds:false})[owner]))
    const standing = Math.max(0,troops-capacity)
    if (id === 22 && standing === 0 && report.defenderLosses === 0) return []
    if (id !== 22 && !(report.cavalryLosses || report.defenderLosses > report.attackerLosses || report.destroyed.length)) return []
    return [{name,input:{target:value},rank:id === 22 ? [standing,report.defenderLosses-report.attackerLosses] : [
      report.destroyed.length,report.cavalryLosses,report.defenderLosses-report.attackerLosses,
    ]}]
  })
  return pick(options,card(id).title+' · Battle')?.input ?? null
}

function ownerGroupRank(state,name,pair) {
  const [employer,nation] = pair
  const space = state.land[name]
  return [space.sites.filter(site => site?.piece === nation+'s' && site.employer === employer).length,on(space,pair+'w')]
}

export function selectBotEventInput(state,id,faction,side,pick) {
  const light = side !== 'shaded'
  const stock = availability(state)
  const candidates = key => eventFieldOptions(state,id,faction,side,key)
  const controlRank = name => Number(friendlyControl(state,name,faction))
  const choose = (key,rank,filter = () => true) => pick(candidates(key).filter(filter).map(value => ({name:value,input:{[key]:value},rank:rank(value)})),card(id).title)?.input ?? null

  if (tribalCards.has(id)) return tribeChoice(state,id,faction,side,pick)
  if (!light && [22,29,72].includes(id)) return eventBattle(state,id,faction,pick)
  if (light && [50,72].includes(id)) return restoreTownProsperity(state,id,faction,pick)
  switch(id) {
    case 1:
      if (faction === 'c') {
        return {...(pick(eventFieldOptions(state,id,faction,'shaded','space').map(name => ({name,input:{space:name},rank:[-on(state.land[name],'com'),isFragmentation(state) ? on(state.land[name],'cav') : -on(state.land[name],'cav')]})),card(id).title)?.input ?? {}),_side:'shaded'}
      }
      if (!light) return choose('space',name => [on(state.land[name],'cav')+on(state.land[name],'com')])
      break
    case 2:
      if (!light || faction === 'c') {
        if (faction === 'c' && (!isFragmentation(state) || !isHumanFaction(state,'d'))) return null
        const names = REGIONS.filter(({name}) => on(state.land[name],'cav')).map(r=>r.name)
        const choices = []
        while (names.length && sum(choices.map(([,n])=>n)) < 5) {
          const found = pick(names.map(name => ({name,rank:[Number(friendlyControl(state,name,'d')),Math.min(5,on(state.land[name],'cav'))]})),card(id).title)
          choices.push(['cav-'+found.name,on(state.land[found.name],'cav')])
          names.splice(names.indexOf(found.name),1)
        }
        return choices.length ? {...numberedAmounts(choices,5),_side:'shaded'} : null
      }
      break
    case 3:
      if (light && faction === 'c' && (isFragmentation(state) || decideImperium(state) !== 'f')) return null
      if (light && faction === 'd' && isFragmentation(state)) return null
      return placeList(state,id,faction,side,pick,name => light ? [
        Math.min(state.land[name].pop,sum(state.land[name].pros.map(n=>Math.max(0,state.land[name].pop-n)))),controlRank(name),
      ] : [
        state.land[name].sites.filter(site => ['town','hill'].includes(site?.piece)).length,on(state.land[name],'mil')+on(state.land[name],'com'),
      ])
    case 4: {
      if (isFragmentation(state) || state.eventIndex > 4 || stockedCavalry(state) < 5 || faction === 'c' && isHumanFaction(state,'d')) return null
      const choices = eventFieldOptions(state,id,faction,side,'hold1').map(key => {
        const [name,index,piece] = key.split('/')
        return {name,key,piece,rank:[Number(piece==='fort'),state.land[name].pop,Number(friendlyControl(state,name,'d'))]}
      })
      const off = [['from-out',state.pools.out],['from-casualties',state.pools.casualties],['from-available',stock.cav]]
      const names = REGIONS.filter(({name})=>on(state.land[name],'cav')).sort((a,b)=>on(state.land[b.name],'cav')-on(state.land[a.name],'cav'))
      const sources = numberedAmounts([...off,...names.map(({name})=>['from-'+name,on(state.land[name],'cav')])],10)
      const input = {...sources,'cav-Atrebates':0,'cav-Regni':0,'cav-Cantiaci':0}
      const dest = pick(['Atrebates','Regni','Cantiaci'].map(name => ({name,rank:[ownPieces(state,name,'x'),Number(!friendlyControl(state,name,'d'))]})),card(id).title+' · Cavalry')
      input['cav-'+dest.name] = 10
      const used = new Set()
      for (let i=1;i<=5;i++) {
        const possible = choices.filter(c=>!used.has(c.key.split('/').slice(0,2).join('/')) && stock[c.piece]>0)
        const which = pick(possible,card(id).title+' · Stronghold')
        if (!which) break
        input['hold'+i] = which.key
        stock[which.piece]--
        used.add(which.key.split('/').slice(0,2).join('/'))
      }
      return input
    }
    case 10:
      if (!light) return {}
      return sum(REGIONS.flatMap(({name}) => ['dxw','dsw','cxw','csw'].map(key=>on(state.land[name],key)))) >= (faction === 'd' ? 4 : 2) ? {} : null
    case 13:
      if (faction === 'd') {
        if (friendlyControl(state,'Ordovices','d')) return null
        const fields = eventFieldOptions(state,id,faction,'shaded','site',{employer:'d'})
        const best = fields.find(index => BY_NAME.Ordovices.sites[Number(index)].type === 'H') ?? fields[0]
        return {employer:'d',...(best == null ? {} : {site:best}),_side:'shaded'}
      }
      return light && faction === 'c' && controlGain(state,evaluate(state,id,faction,side,{}),'c') < 0 ? null : {}
    case 17:
      if (!light) return placeList(state,id,faction,side,pick,name => [on(state.land[name],'cav')])
      {
        const before = boardTotals(state).pop.c
        const shadow = clone(state)
        const input = {}
        const candidates = eventFields(state,id,faction,side)
        let remaining = Math.min(4,stock.cav)
        while (remaining && candidates.length) {
          const choice = pick(candidates.map(field => {
            const name = field.name.slice(4)
            const space = shadow.land[name]
            const n = Math.min(field.max,remaining)
            space.units.cav[0] += n
            const gain = Number(friendlyControl(shadow,name,'c') && !friendlyControl(state,name,'c'))*space.pop
            space.units.cav[0] -= n
            return {name,field,n,rank:[gain,n]}
          }),card(id).title)
          input[choice.field.name] = choice.n
          shadow.land[choice.name].units.cav[0] += choice.n
          remaining -= choice.n
          candidates.splice(candidates.indexOf(choice.field),1)
        }
        return faction === 'c' && boardTotals(shadow).pop.c <= before ? null : input
      }
    case 21:
    case 28:
      if (faction === 'd' && (!isRoman(state) || isHumanFaction(state,'c'))) return null
      if (!light && (epochRemaining(state) <= 1 || id === 28 && state.next === 21)) return null
      return {}
    case 22: {
      if (faction === 'd' && !dominates(state,'c')) return null
      const quota = eventFields(state,id,faction,side).find(f => f.name === 'comitates')?.max ?? 0
      const where = choose('space',name => [ownPieces(state,name,'s')+ownPieces(state,name,'x'),state.land[name].pop])
      return {dominance:faction === 'd' ? 'm':'c',...(where && quota ? {...where,comitates:quota} : {})}
    }
    case 24:
      if (!light) return choose('space',name => [Number(ownTown(state.land[name])),totalProsperity(state.land[name])])
      return {...choose('origin',name=>[+(control(state,name) === 'x'),Number(control(state,name) === 's')]),...choose('target',name=>[controlRank(name),totalProsperity(state.land[name])])}
    case 29: {
      const placements = candidates('space').flatMap(name => eventFieldOptions(state,id,faction,side,'site',{space:name})
        .map(site => candidacy(name,{space:name,site},[state.land[name].pop,Number(state.land[name].sites[Number(site)] === null)])))
      const priority = faction === 'c' ? after => [controlGain(state,after,'c')] : undefined
      return pickEffect(state,id,faction,side,placements,pick,{priority})
    }
    case 30: {
      if (!light) return {}
      const number = Math.min(10,stockedCavalry(state))
      if (faction === 'd' && (number < 3 || thresholds(state).d > 0)) return null
      if (!number) return {}
      const choices = ['Atrebates','Regni','Cantiaci'].map(name => ({name,rank:[ownPieces(state,name,'x')+ownPieces(state,name,'s'),Number(!friendlyControl(state,name,'d'))]}))
      const choice = pick(choices,card(id).title)
      return {...numberedAmounts([['from-out',state.pools.out],['from-casualties',state.pools.casualties],['from-available',stock.cav]],number),['cav-'+choice.name]:number}
    }
    case 31:
      if (!briton(faction)) {
        const other = faction === 's' ? 'x' : 's'
        return isHumanFaction(state,other) && state.tracks[other] > (other === 'x' ? 20 : 30) ? {target:other,_side:'unshaded'} : null
      }
      break
    case 32: {
      const placements = candidates('space').flatMap(name => eventFieldOptions(state,id,faction,side,'site',{space:name}).map(site => candidacy(name,{space:name,site})))
      return pickEffect(state,id,faction,side,placements.length ? placements : candidates('space').map(name => candidacy(name,{space:name})),pick)
    }
    case 35: {
      const effectiveSide = faction === 'd' ? 'shaded' : side
      if (faction === 'd' && !dominates(state,'c') && boardTotals(state).pop.x < 3) return null
      if (faction === 's' && (!isHumanFaction(state,'x') || boardTotals(state).pop.x <= 5)) return null
      return {...placeList(state,id,faction,effectiveSide,pick,name => [Number(control(state,name) === 'x'),ownPieces(state,name,'x')+ownPieces(state,name,'s')]),_side:effectiveSide}
    }
    case 36: {
      if (!briton(faction)) return {}
      if (!isHumanFaction(state,'s') || epochRemaining(state) <= 1) return null
      return {_side:'unshaded'}
    }
    case 39: {
      const restricted = (faction === 'c' ? 'd' : 'c')
      if (faction === 'c' && !isHumanFaction(state,'d') && !isFragmentation(state)) return null
      if (faction === 'd' && !isFragmentation(state) &&
        (!isHumanFaction(state,'c') || thresholds(state).c <= 0 && state.tracks.wealth <= state.tracks.prestige)) return null
      const options = candidates('group').flatMap(group => {
        const [name,pair] = group.split('/')
        if (light && pair[0] !== restricted) return []
        const beneficial = light ? ownerGroupRank(state,name,pair) : [0,on(state.land[name],'mil')+foederati(state,name,pair,'x')+foederati(state,name,pair,'s')]
        return [candidacy(name,{group},beneficial)]
      })
      return pickEffect(state,id,faction,side,options,pick)
    }
    case 45:
      if (light) {
        const keys = ['cxw','csw','dxw','dsw','sw','xw'].sort((a,b)=>Number(GROUP[a].owner === faction)-Number(GROUP[b].owner === faction))
        const required = Math.ceil(sum(keys.map(key=>on(state.land.Cantiaci,key)))/2)
        return required ? numberedAmounts(keys.map(key=>[key,on(state.land.Cantiaci,key)]),required) : null
      }
      break
    case 49:
      if (light) {
        const slot = BY_NAME.Cantiaci.sites.findIndex(site=>site.name==='Rutupiae')
        if (faction === 'd' && state.land.Cantiaci.sites[slot]?.piece === 'fort') return null
        const input = {space:'Cantiaci',employer:faction}
        return pickEffect(state,id,faction,side,[candidacy('Cantiaci',input)],pick,{accept:after=>faction !== 'c' || controlGain(state,after,'c')>0})
      }
      if (faction === 's' && isHumanFaction(state,'x')) return null
      return allyRemoval(state,'Cantiaci',faction)
    case 50:
      return choose('space',name=>[Number(friendlyControl(state,name,'c')),state.land[name].pop]) ?? {}
    case 53: {
      const wanted = faction === 'd' ? 'x' : null
      if (wanted && (!isHumanFaction(state,wanted) || !candidates('space1').some(name=>control(state,name) === wanted))) return null
      if (faction === 's' && !candidates('space1').some(name => ['Atrebates','Regni','Cantiaci'].includes(name) && humanControls(state,name))) return null
      const input = placeList(state,id,faction,side,pick,name => [
        Number(wanted && control(state,name) === wanted || faction === 's' && ['Atrebates','Regni','Cantiaci'].includes(name) && humanControls(state,name)),
        Number(!friendlyControl(state,name,faction)), Number(friendlyControl(state,name,'c')), state.land[name].pop,
      ])
      return Object.keys(input).length ? input : null
    }
    case 54: {
      if (isFragmentation(state)) return null
      const after = evaluate(state,id,faction,side,{})
      if (!briton(faction)) return isFragmentation(after) ? {} : null
      return scores(after)[faction].margin > scores(state)[faction].margin ||
        !dominates(state,faction) && dominates(after,faction) ? {} : null
    }
    case 61:
      if (!light) {
        const britonControl = name => friendlyControl(state,name,'c') || friendlyControl(state,name,'d')
        if (!candidates('space1').some(britonControl)) return null
        return placeList(state,id,faction,side,pick,name=>[Number(britonControl(name)),ownPieces(state,name,'c')+ownPieces(state,name,'d')])
      }
      break
    case 62:
      if (faction === 'd' && (isHumanFaction(state,'c') || !isHumanFaction(state,'s')) || faction === 'x' && isHumanFaction(state,'s')) return null
      return pickEffect(state,id,faction,side,[candidacy('Demetae',{})],pick)
    case 66:
      if (light) {
        return choose('space',name=>[Math.floor(on(state.land[name],control(state,name)+'w')/2)])
      }
      break
    case 70:
      if (light) {
        if (state.tracks.refugees >= 4) return null
        const input = placeList(state,id,faction,side,pick,name=>[Number(!friendlyControl(state,name,faction)),totalProsperity(state.land[name])])
        return Object.keys(input).length ? input : null
      }
      break
  }
  return undefined
}

function humanControls(state,name) {
  const owner = control(state,name)
  return owner === 'b' ? isHumanFaction(state,'d') || isHumanFaction(state,'c') : isHumanFaction(state,owner)
}

export function hasEventEffect(state,id,faction,side,input) {
  return eventBattleRequests(state,id,faction,side,input).length > 0 || compact(state) !== compact(evaluate(state,id,faction,side,input))
}

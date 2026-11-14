import { BY_NAME, NAMES, REGIONS, ROADS, SEAS } from './data.mjs'
import { availability, changeTrack, clone, control, ensure, friendlyControl, goldAvailable, groupLabel, hasStronghold, humanFactions, inRange, isFragmentation, loaded, moveUnits, on, plunderTo, preemption, toOwner, totalProsperity } from './position.mjs'
import { battleEnemies, battleTargets, raidReactionSafe } from './battle.mjs'
import { commandEconomy, commandFeatFields, duxPaymentFields, runCommandFeat } from './commands.mjs'

const operationTroops = { d:['cav','dxw','dsw'], c:['mil','com','cxw','csw'], x:['xw'], s:['sw'] }
const pick = (key,label,options,required = true) => ({key,label,type:'select',options:[['','Choose…'],...options],required})
const check = (key,label) => ({key,label,type:'check',default:false})
const countField = (key,label,defaultValue = '0') => ({key,label,type:'number',min:0,max:30,default:defaultValue})
const spaceOption = names => names.map(name => [name,name])
const selected = value => value === true || ['yes','on','1','true'].includes(value)
const humanHas = (state,faction) => humanFactions(state).includes(faction)
const hasSide = (state,id,side) => state.markers[id]?.side === side
const niallBox = 'niall-box'
const fortCount = (state,names) => names.reduce((sum,name) => sum+state.land[name].sites.filter(site => site?.piece === 'fort').length,0)
function knownSeaRoute(state,faction,name) {
  const base = REGIONS.filter(region => on(state.land[region.name],faction+'w') && hasStronghold(state.land[region.name],[faction]))
  const target = BY_NAME[name]
  const coasts = faction === 's' ? ['hib',...(state.markers[73] ? [] : ['sept']),...(hasSide(state,55,'shaded') ? ['brit'] : [])]
    : ['brit','germ',...(hasSide(state,37,'shaded') ? ['sept'] : [])]
  return target.seas.filter(sea => coasts.includes(sea) || base.some(site => site.seas.includes(sea)))
}
function raidModifier(state,faction,name,sea,landBased) {
  const offset = (id,value) => hasSide(state,id,'unshaded') ? value : hasSide(state,id,'shaded') ? -value : 0
  let minus = faction === 's' ? offset(58,2) : offset(38,2)
  if (sea === 'brit' && hasSide(state,8,'unshaded')) minus += 4
  if (sea === 'hib' && faction === 's' && hasSide(state,18,'shaded')) minus--
  if (sea && hasSide(state,55,'unshaded') && state.markers[55].sea === sea) minus += 3
  if (landBased && hasSide(state,69,'unshaded')) minus += 2
  if (faction === 's' && hasSide(state,68,'unshaded')) minus++
  if (faction === 's' && hasSide(state,59,'unshaded') && ['Novantae','Votadini','Carvetii'].includes(name)) minus += 3
  return minus
}
function coastalPaths(state,faction,name) {
  if (!BY_NAME[name] || friendlyControl(state,name,faction)) return []
  const options = knownSeaRoute(state,faction,name).map(sea => {
    const waters = faction === 'x' && sea === 'sept' && hasSide(state,37,'shaded') ? ['sept','germ'] : [sea]
    const patrolled = waters.filter(sea => state.seas[sea])
    const coast = REGIONS.filter(region => region.seas.some(sea => patrolled.includes(sea))).map(region => region.name)
    const count = state.markers[67] ? coast.reduce((n,name) => n+state.land[name].sites.filter(site => site?.employer).length,0) : fortCount(state,coast)
    return {key:sea,label:SEAS[sea],minus:count+raidModifier(state,faction,name,sea,false)}
  })
  if (faction === 's' && ['Novantae','Votadini'].includes(name)) {
    const wall = hasSide(state,69,'shaded') ? 0 : fortCount(state,['Carvetii','Textoverdi'])
    options.push({key:'wall',label:'Caledonia',minus:wall+raidModifier(state,faction,name,null,true)})
  }
  const local = [name,...BY_NAME[name].adj].some(key => on(state.land[key],faction+'w') && hasStronghold(state.land[key],[faction]))
  if (local) options.push({key:'land',label:'Local Settlement',minus:raidModifier(state,faction,name,null,true)})
  return options
}
export function raidPaths(state,faction,name,feat) {
  if (faction === 's' && name === niallBox && hasSide(state,68,'shaded')) return [{key:'box',label:'Niall’s box',minus:raidModifier(state,faction,name,null,false)}]
  const paths = coastalPaths(state,faction,name)
  if (feat === 'Surprise' && BY_NAME[name] && !friendlyControl(state,name,faction)) {
    for (const via of BY_NAME[name].adj) {
      for (const route of coastalPaths(state,faction,via)) paths.push({
        ...route,key:route.key+'@'+via,label:route.label+' via '+via,deep:true,
      })
    }
  }
  return paths.sort((a,b) => a.minus-b.minus)
}
function raidPrice(state,faction,dice,options) {
  if (options.free) return 0
  let price = faction === 'x' ? (dice === 3 ? 2 : 1) : (dice === 2 ? 1 : 0)
  if (faction === 's' && state.markers[63]?.side === 'unshaded') price++
  return price
}
function progressDecision(reply,stage,title,options,defaultValue) {
  if (!reply || options.length < 2) return defaultValue
  return reply({stage,title,options,defaultValue,progress:[]})
}
function ransomTrack(state,owner) {
  if (owner === 'c') return state.tracks.blue ? 'blue' : state.tracks.wealth ? 'wealth' : null
  if (owner === 'd') return state.tracks.red ? 'red' : preemption(state) && state.tracks.blue ? 'blue' : null
  return state.tracks[owner] ? owner : null
}
function applyRansom(state,name,roll,reply) {
  if (BY_NAME[name].terrain === 'City') return ''
  const targets = [...new Set(state.land[name].sites.filter(Boolean).map(site => toOwner(site.piece,site.employer)))]
    .filter(owner => owner !== 's' && ransomTrack(state,owner))
  if (!targets.length) return ''
  const owner = progressDecision(humanHas(state,'s') ? reply : null,'Ransom','Choose a Stronghold owner in '+name,
    targets.map(owner => ({value:owner,label:NAMES[owner]})),targets[0])
  const threshold = hasSide(state,36,'unshaded') ? 5 : hasSide(state,36,'shaded') ? 3 : 4
  if (roll(6,'Ransom · '+name) < threshold) return ' Ransom fails.'
  const track = ransomTrack(state,owner)
  changeTrack(state,track,-1)
  changeTrack(state,'s',1)
  return ` Ransom gains one Renown from ${NAMES[owner]}.`
}
function raidTroopSides(state,name,faction) {
  return battleEnemies(state,name,faction,'Raid')
}
export function raidResponders(state,name,raider,deep) {
  const land = state.land[name]
  const order = deep ? ['d','c',raider === 'x' ? 's' : 'x'] : ['d','c','s']
  return order.filter(owner => {
    const troops = operationTroops[owner].some(key => on(land,key)) || (['x','s'].includes(owner) && on(land,owner+'r'))
    if (!deep) return troops
    if (!friendlyControl(state,name,owner) && (owner !== 'd' || !humanHas(state,owner))) return false
    return troops || (humanHas(state,owner) && hasStronghold(land,[owner]))
  })
}
export function botForcesRaidBattle(state,config,owner) {
  if (owner === 'd' || owner === 'c') return raidReactionSafe(state,config,owner)
  const raider = config.source === 'Deep Raid' ? config.attacker : config.defender
  return humanHas(state,raider)
}
export function militaryFields(state,faction,command,feat,options,input = {}) {
  if (!operationTroops[faction] || feat && (options.free || options.limited) && !options.allowFeat) return null
  const cap = options.limited ? 1 : options.spaceLimit ?? REGIONS.length
  if (command === 'Battle') {
    const enemies = options.enemies ?? ['d','c','x','s'].filter(key => key !== faction)
    const names = (options.reinforceBonus ? REGIONS.filter(({name}) => battleEnemies(state,name,faction).some(owner => enemies.includes(owner))).map(r => r.name) : battleTargets(state,faction))
      .filter(name => (!options.regionsOnly || BY_NAME[name].terrain !== 'City') && battleEnemies(state,name,faction).some(owner => enemies.includes(owner)))
    const base = [pick('space','Battle space',spaceOption(names)),pick('enemy','Defender',enemies.map(key => [key,NAMES[key]]),false),
      ...(['Retaliate','Surprise','Ravage','Ransom'].includes(feat) ? [check('tactic','Use '+feat+' here')] : [])]
    const controls = feat === 'Reinforce' && !isFragmentation(state) ? [check('alliedConsent','Dux agrees to Reinforce')] : []
    if (feat === 'Requisition') {
      const targets = Math.max(1,Math.min(cap,Number(input.rows) || 1))
      const between = Array.from({length:targets-1},(_,i) => [String(i+1),'After Battle '+(i+1)])
      controls.push({
        key:'featTiming',label:'When to Requisition',type:'select',
        options:[['before','Before the first Battle'],...between,['after','After the last Battle']],
        default:selected(input.featBefore) ? 'before' : 'after',
      })
    }
    return {
      minRows:1,maxRows:cap,rows:base,controls,
      featFields: commandFeatFields(state,faction,command,feat,options),
      help:'Select the Battle spaces. The app steps through tactics, losses, Strongholds, Plunder, and Siege.',
    }
  }
  if (command === 'Intercept' && faction === 'd') {
    const targetNames = REGIONS.filter(region => friendlyControl(state,region.name,'d') && (on(state.land[region.name],'xr') || on(state.land[region.name],'sr'))).map(region => region.name)
    const originNames = REGIONS.filter(region => friendlyControl(state,region.name,'d') && operationTroops.d.some(key => on(state.land[region.name],key))).map(region => region.name)
    return { minRows:1,maxRows:REGIONS.length, controls:duxPaymentFields(state,options),
      rows:[pick('space','Intercept target',spaceOption(targetNames)),pick('origin','Move from · optional',spaceOption(originNames),false),
        ...(hasSide(state,60,'unshaded') ? [check('sea','Move by sea')] : []),
        ...(feat === 'Retaliate' ? [check('tactic','Use Retaliate here')] : []),
        ...operationTroops.d.flatMap(key => [countField(key,groupLabel(key)),countField(key+'p','Plunder on '+groupLabel(key),'')]),
        pick('enemy','Raiders to fight',[['x','Saxons'],['s','Scotti']],false)],
      featFields:commandFeatFields(state,faction,command,feat,options),
      help:'Select one or more target spaces. Leave origin blank to fight with local troops only. To use multiple origins, add rows for the same target.',
    }
  }
  if (command === 'Raid' && ['x','s'].includes(faction)) {
    const names = REGIONS.filter(region => (!options.regionsOnly || region.terrain !== 'City') && raidPaths(state,faction,region.name,feat).length).map(region => region.name)
    const useNiall = faction === 's' && hasSide(state,68,'shaded')
    const routes = Object.entries(SEAS).concat([['land','Local Settlement'],['wall','Caledonia']])
    const fee = faction === 's' && hasSide(state,63,'unshaded') ? 1 : 0
    const rows = [
      pick('space','Raid target',spaceOption(names).concat(useNiall && !options.regionsOnly ? [[niallBox,'Niall’s box']] : [])),pick('route','Route (blank uses least subtraction)',routes,false),
      ...(feat === 'Surprise' ? [pick('via','Deep Raid via · optional',spaceOption(REGIONS.map(region => region.name)),false),check('tactic','Use Surprise here')] : []),
      ...(feat === 'Ravage' || feat === 'Ransom' ? [check('tactic','Use '+feat+' here')] : []),
      ...(options.free ? [] : [{key:'dice',label:'Raid dice',type:'select',options:[['full',faction === 'x' ? '3D4 · 2 Renown' : `2D4 · ${1+fee} Renown`],['one',faction === 'x' ? '1D4 · 1 Renown' : `1D4 · ${fee ? '1 Renown' : 'free'}`]],default:'full'}]),
      ...(useNiall ? [countField('niall','Raiders from Niall’s box')] : []),
      check('battle','Attempt Battle if Raiders land'),
      pick('enemy','Battle target (if more than one)',Object.entries(NAMES).filter(([key]) => ['d','c','x','s'].includes(key) && key !== faction),false),
    ]
    return {minRows:1,maxRows:options.limited ? 1 : options.spaceLimit ?? (faction === 'x' ? 3 : 4),rows,controls:[],help:`Choose the targets in resolution order. ${options.diceOverride ? `Each target rolls ${options.diceOverride}D4. ` : ''}The app rolls landings and applies all Raid modifiers.`}
  }
  return null
}

function correctEnemy(value,legal) {
  const normalized = value === 'c' && !legal.includes('c') && legal.includes('d') ? 'd' : value
  const choice = normalized || (legal.length === 1 ? legal[0] : '')
  ensure(legal.includes(choice),'Choose a defender that is present.')
  return choice
}
function reachIntercept(state,from,to) {
  if (BY_NAME[from].adj.includes(to)) return true
  if (!state.roads) return false
  const seen = new Set([from])
  const queue = [from]
  while (queue.length) {
    const current = queue.shift()
    for (const pair of ROADS.filter(road => road.includes(current))) {
      const next = pair.find(name => name !== current)
      if (seen.has(next) || !friendlyControl(state,next,'d')) continue
      if (next === to) return true
      seen.add(next)
      queue.push(next)
    }
  }
  return false
}
export function runMilitary(state,spec,roll,fight,reply) {
  const { faction,command,feat,rows,featRows = [],options = {},input = {} } = spec
  const rule = militaryFields(state,faction,command,feat,options,input)
  ensure(rule && rows.length >= rule.minRows && rows.length <= rule.maxRows,'Choose a legal number of operation rows.')
  ensure(rows.every(row => Object.hasOwn(BY_NAME,row.space) || command === 'Raid' && row.space === niallBox && !options.regionsOnly), 'Select a valid space in every row.')
  const names = [...new Set(rows.map(row => row.space))]
  if (options.regionsOnly) ensure(names.every(name => BY_NAME[name].terrain !== 'City'),'This Event grants the Command in Regions only.')
  if (options.limited || options.spaceLimit) ensure(names.length <= (options.limited ? 1 : options.spaceLimit),'This Command exceeds its target limit.')
  if (command !== 'Intercept') ensure(names.length === rows.length,'Select each space only once.')
  const notes = []
  const support = (featInput=input,timing='') => {
    const note = runCommandFeat(state,{faction,command,feat,options,rows:featRows,input:featInput,battleSpaces:names},roll)
    if (note) notes.push(timing ? `Requisition ${timing}. ${note}.` : note)
  }
  if (command === 'Battle' || command === 'Intercept') {
    if (['Surprise','Retaliate'].includes(feat)) ensure(new Set(rows.filter(row => selected(row.tactic)).map(row => row.space)).size <= 1,feat+' applies in a single space.')
    if (['Pillage','Reinforce','Entreat'].includes(feat) && (!options.reinforceBonus || featRows.length)) support()
    if (command === 'Intercept') {
      const origins = [...new Set(rows.map(row => row.origin).filter(Boolean))]
      const payment = commandEconomy(state,faction,options,input)
      payment.spend(origins.length*2)
      if (feat === 'Invite') support({...input,blueSpend:payment.remainingBlue})
      const initial = clone(state)
      const moved = new Map()
      ensure(rows.filter(row => selected(row.sea)).length <= 1,'Only one Intercept group may move by sea.')
      for (const row of rows) {
        ensure(friendlyControl(initial,row.space,'d'),'Intercept requires Friendly Control at each target.')
        if (!row.origin) continue
        const bySea = selected(row.sea) && hasSide(state,60,'unshaded') && BY_NAME[row.origin]?.seas.length && BY_NAME[row.space].seas.length
        ensure(Object.hasOwn(BY_NAME,row.origin) && row.origin !== row.space && friendlyControl(initial,row.origin,'d') && (bySea || !selected(row.sea) && reachIntercept(initial,row.origin,row.space)),'The origin must reach the target via a friendly adjacent space, maintained Roads, or an eligible sea crossing.')
        let movedHere = 0
        for (const key of operationTroops.d) {
          const n = Number(row[key] || 0)
          const id = row.origin+'/'+key
          const used = moved.get(id) ?? [0,0]
          const loadAvailable = loaded(initial.land[row.origin],key)-used[1]
          const emptyAvailable = on(initial.land[row.origin],key)-used[0]-loadAvailable
          const load = row[key+'p'] === '' || row[key+'p'] == null ? Math.max(0,n-emptyAvailable) : Number(row[key+'p'])
          ensure(inRange(n,0,loadAvailable+emptyAvailable) && inRange(load,0,Math.min(n,loadAvailable)) && n-load <= emptyAvailable,'A Troop may only move once during Intercept.')
          if (n) {
            moveUnits(state,row.origin,row.space,key,n,load)
            moved.set(id,[used[0]+n,used[1]+load])
            movedHere += n
          }
        }
        ensure(movedHere,'Enter at least one moving Troop or leave origin blank.')
        notes.push(`${movedHere} Troops move from ${row.origin} to ${row.space}.`)
      }
    }
    const tacticalSpace = rows.find(row => selected(row.tactic))?.space ?? names[0]
    let requisitionAt = null
    if (feat === 'Requisition') {
      const timing = input.featTiming || (selected(input.featBefore) ? 'before' : 'after')
      requisitionAt = timing === 'before' ? 0 : timing === 'after' ? names.length : Number(timing)
      ensure(inRange(requisitionAt,0,names.length),'Choose when to Requisition during the selected Battles.')
      if (requisitionAt === 0) support(input,'before the first Battle')
    }
    for (const [index,name] of names.entries()) {
      const row = rows.find(item => item.space === name)
      const enemies = battleEnemies(state,name,faction,command).filter(owner => !options.enemies || options.enemies.includes(owner))
      const enemy = correctEnemy(row.enemy,enemies)
      ensure(operationTroops[faction].some(key => on(state.land[name],key)), 'A participating Troop of the acting faction is required.')
      const retaliate = feat === 'Retaliate' && tacticalSpace === name
      ensure(!retaliate || (enemy !== 'c' || isFragmentation(state)) && hasStronghold(state.land[name],[enemy]), 'Retaliate needs an eligible enemy Stronghold at its target.')
      fight({name,attacker:faction,defender:enemy,source:command,surprise:feat === 'Surprise' && tacticalSpace === name,
        shieldWall:feat === 'Shield Wall',retaliate,
        ravage:feat === 'Ravage' && selected(row.tactic),
        afterPlunder:feat === 'Ransom' && selected(row.tactic) ? () => { const note = applyRansom(state,name,roll,reply); if (note) notes.push(note.trim()) } : undefined})
      if (requisitionAt === index+1) support(input,index+1 === names.length ? 'after the last Battle' : 'after the Battle in '+name)
    }
    return notes.join(' ')
  }
  const targets = rows.map(row => {
    const optionsHere = raidPaths(state,faction,row.space,feat)
    const key = row.route && row.via ? row.route+'@'+row.via : row.route
    const routes = optionsHere.filter(route => row.via ? route.deep && route.key.endsWith('@'+row.via) : !route.deep)
    const route = key ? routes.find(route => route.key === key) : routes[0]
    ensure(route,'Choose a legal Raid route to '+row.space+'.')
    const dice = options.diceOverride ?? (!options.free && row.dice === 'one' ? 1 : faction === 's' ? 2 : 3)
    return {...row,route,dice,cost:raidPrice(state,faction,dice,options)}
  })
  ensure(feat !== 'Surprise' || targets.filter(row => row.route.deep || selected(row.tactic)).length <= 1,'Surprise applies to one space.')
  const cost = targets.reduce((n,row) => n+row.cost,0)
  ensure(cost <= state.tracks[faction],'The faction cannot afford the selected Raider dice.')
  changeTrack(state,faction,-cost)
  if (cost) notes.push('Paid '+cost+' Renown.')
  for (const row of targets) {
    const name = row.space
    const kind = faction+'r'
    const values = Array.from({length:row.dice},() => roll(4,'Raid · '+(name === niallBox ? 'Niall’s box' : name)))
    const normal = Math.min(availability(state)[kind],Math.max(0,values.reduce((n,value) => n+value,0)-row.route.minus))
    if (name === niallBox) {
      ensure(!Number(row.niall || 0),'Raiders cannot return to Niall’s box as reinforcements.')
      changeTrack(state,'niall',normal)
      notes.push(`${normal} Raiders enter Niall’s box.`)
      continue
    }
    const extra = Number(row.niall || 0)
    ensure(inRange(extra,0,faction === 's' && hasSide(state,68,'shaded') ? state.tracks.niall : 0),'The requested Raiders are unavailable in Niall’s box.')
    changeTrack(state,'niall',-extra)
    const arrive = normal+extra
    const land = state.land[name]
    const oldControl = control(state,name)
    const enemy = faction === 'x' ? 's' : 'x'
    const levyForSettlements = report => (report?.destroyedPieces ?? []).filter(site => site.piece === enemy+'s' && !site.employer).reduce((total,site) => total+site.plunder,0)
    if (!arrive) { notes.push(name+': no Raiders land.'); continue }
    land.units[kind][0] += arrive
    const ravage = feat === 'Ravage' && selected(row.tactic)
    const surprise = (feat === 'Surprise' && (selected(row.tactic) || row.route.deep))
    const potential = !BY_NAME[name] || BY_NAME[name].terrain === 'City' ? 0 : Math.min(arrive,ravage ? arrive : land.pop,totalProsperity(land))
    let taken = 0
    let forced = false
    let lastOutcome = null
    if (row.route.deep) {
      const legal = raidTroopSides(state,name,faction)
      for (const owner of raidResponders(state,name,faction,true)) {
        const defender = correctEnemy(owner,legal)
        const config = {name,attacker:faction,defender,source:'Deep Raid',attackers:{[kind]:[arrive,0]},surprise,reactionFaction:owner}
        const human = humanHas(state,owner)
        const automatic = !human && botForcesRaidBattle(state,config,owner)
        const decision = progressDecision(human ? reply : null,'Deep Raid',
          NAMES[owner]+' may force Battle before Plunder in '+name,[
            {value:'battle',label:'Force Battle'},{value:'allow',label:'Allow the Raid'},
          ],automatic ? 'battle' : 'allow')
        if (decision !== 'battle') continue
        forced = true
        lastOutcome = fight(config)
        break
      }
    }
    const surviving = lastOutcome ? lastOutcome.attackingRaiderSurvivors : arrive
    if (!lastOutcome?.attackerEvaded) {
      taken = plunderTo(land,kind,Math.min(potential,surviving-(lastOutcome?.attackerPlunder ?? 0)))
    }
    const ruin = state.markers[70]
    let bonus = 0
    if (oldControl === 'b' && ruin?.side === 'shaded' && ruin.faction === faction) {
      if (!lastOutcome?.attackerEvaded && taken+(lastOutcome?.attackerPlunder ?? 0) < surviving && goldAvailable(state)) {
        land.units[kind][1]++
        bonus++
      }
      changeTrack(state,'wealth',-1)
    }
    changeTrack(state,enemy,-(oldControl === enemy ? taken+bonus : 0)-levyForSettlements(lastOutcome))
    if (ravage && roll(6,'Ravage · '+name) >= 4 && land.pop) {
      land.pop--
      state.tracks.refugees = Math.min(4,state.tracks.refugees+1)
    }
    const ransom = feat === 'Ransom' && selected(row.tactic) ? applyRansom(state,name,roll,reply) : ''
    notes.push(`${name}: ${arrive} land via ${row.route.label}; ${taken} Plunder.${ransom}`)
    const enemies = raidTroopSides(state,name,faction)
    if (!forced && selected(row.battle) && enemies.length) {
      const defender = correctEnemy(row.enemy,enemies)
      const outcome = fight({name,attacker:faction,defender,source:'Raid',attackers:{[kind]:[arrive,taken+bonus]},surprise,ravage,
        ...(options.raidTrap ? {trap:[kind],trapSide:'attacker'} : {})})
      changeTrack(state,enemy,-levyForSettlements(outcome))
    } else if (ravage && !forced) {
      let raiders = arrive
      let cargo = taken+bonus
      let britonsFought = false
      for (const owner of raidResponders(state,name,faction,false)) {
        const briton = owner === 'd' || owner === 'c'
        if (briton && britonsFought) continue
        const config = {name,attacker:owner,defender:'x',source:'Ravage',defenders:{[kind]:[raiders,cargo]},ravage:true,noAssault:true,noSiege:true,reactionFaction:owner}
        const human = humanHas(state,owner)
        const attack = !human && botForcesRaidBattle(state,config,owner)
        const counter = progressDecision(human ? reply : null,'Ravage',NAMES[owner]+' may counterattack in '+name,[
          {value:'attack',label:'Counterattack'},{value:'skip',label:'Decline'},
        ],attack ? 'attack' : 'skip')
        if (counter === 'attack') {
          const before = on(land,kind)
          const beforeCargo = loaded(land,kind)
          fight(config)
          raiders -= before-on(land,kind)
          cargo -= beforeCargo-loaded(land,kind)
          if (!raiders) break
          if (briton && !isFragmentation(state)) britonsFought = true
        }
      }
    }
  }
  return notes.join(' ')
}

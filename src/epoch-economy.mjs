import { BY_NAME, NAMES, RANDOM_SPACES, REGIONS } from './data.mjs'
import { availability, boardTotals, changeTrack, clone, control, ensure, goldAvailable, groupLabel, inRange, isFragmentation, isHumanFaction, isRoman, loaded, moveUnits, on, preemption, scores, setImperium, spendCivitates, spendDux, sum } from './position.mjs'
import { TEARS_REGIONS } from './scenarios.mjs'

const epochEconomy = (() => {
  const names = REGIONS.map(region => region.name)
  const phaseFaction = { 'Dux Upkeep':'d', 'Civitates Upkeep':'c', 'Saxon Upkeep':'x', 'Scotti Upkeep':'s' }
  const earlyEvents = {
    77: { title:'Magnus Maximus', min:3, max:5, reward:20 },
    78: { title:'Constantine III', min:2, max:4, reward:15 },
  }
  const redFoederati = ['dxw','dsw']
  const blueFoederati = ['cxw','csw']
  const human = isHumanFaction
  const marker = (state,id,side) => state.markers?.[id]?.side === side
  const troopsOnMap = (state,key) => sum(names.map(name => on(state.land[name],key)))
  const boxesWith = (state,keys) => names.filter(name => keys.some(key => on(state.land[name],key)))
  const siteList = (state,piece,employer = null) => REGIONS.flatMap(({name,sites}) =>
    state.land[name].sites.flatMap((site,index) => site?.piece === piece && site.employer === employer
      ? [{name,index,id:`${name}-${index}`,label:sites[index].name}] : []))
  const siteNames = sites => [...new Set(sites.map(({name}) => name))]
  const isMarked = (value,fallback = false) => value === undefined || value === null ? fallback
    : value === true || value === 1 || value === '1' || value === 'yes' || value === 'on'
  const hasInput = (input,key) => input[key] !== undefined && input[key] !== null && input[key] !== ''
  const getNumber = (input,key,min,max,fallback = min) => {
    const value = hasInput(input,key) ? Number(input[key]) : fallback
    ensure(inRange(value,min,max),`Enter a whole number from ${min} to ${max} for ${key.replaceAll('-',' ')}.`)
    return value
  }
  const selector = (name,label,options,defaultValue = options[0]?.value,advanced = false) =>
    ({name,label,type:'select',options,defaultValue,advanced})
  const amount = (name,label,min,max,defaultValue,advanced = false) =>
    ({name,label,type:'number',min,max,defaultValue,advanced})
  const check = (name,label,defaultValue = false,advanced = false) =>
    ({name,label,type:'checkbox',defaultValue,advanced})
  const pair = (value,label = value) => ({value,label})
  const optionsFor = names => names.map(name => pair(name))
  const autoplace = pair('', 'Use app allocation')

  function randomIndex(length,roll,label) {
    if (length === 1) return 0
    if (length > 6) {
      let range = 6
      while (range < length) range *= 6
      let index
      do {
        index = 0
        for (let places = range; places > 1; places /= 6) index = index*6 + roll(6,label)-1
      } while (index >= length)
      return index
    }
    const sides = length > 4 ? 6 : 4
    let value
    do { value = roll(sides,label) } while (value > length)
    return value - 1
  }
  function randomSpace(choices,roll,label) {
    ensure(choices.length > 0,'No valid allocation remains.')
    if (choices.length <= 6) return choices[randomIndex(choices.length,roll,label)]
    const col = roll(4,label+' · column') - 1
    const row = roll(6,label+' · row') - 1
    const table = RANDOM_SPACES.flat()
    const start = col * 6 + row
    for (let i = 0; i < table.length; i++) {
      const name = table[(start + i) % table.length]
      if (choices.includes(name)) return name
    }
    throw new Error('The random-space result cannot be resolved.')
  }
  function orderedSites(sites,count,roll,label) {
    const remaining = [...sites]
    const chosen = []
    while (chosen.length < count) {
      const region = randomSpace(siteNames(remaining),roll,label)
      const indexes = remaining.map((site,i) => site.name === region ? i : -1).filter(i => i >= 0)
      chosen.push(remaining.splice(indexes[randomIndex(indexes.length,roll,label)],1)[0])
    }
    return chosen
  }
  function duxPermission(state,input) {
    if (preemption(state)) return true
    if (state.imperium !== 'ac') return false
    if (human(state,'c')) return isMarked(input['allow-blue'])
    const marks = scores(state)
    return marks.d.margin < marks.c.margin
  }
  const showPermission = state => state.imperium === 'ac' && state.tracks.blue && human(state,'c')
  const permissionField = () => ({...check('allow-blue','Allow Dux to spend Briton Resources'),refresh:true})
  const duxBudget = (state,input,blueOnly = false) =>
    (duxPermission(state,input) ? state.tracks.blue : 0) + (blueOnly ? 0 : state.tracks.red)
  const civBudget = state => state.tracks.blue + state.tracks.wealth

  function payDux(state,number,input,blueOnly = false) {
    const access = duxPermission(state,input)
    ensure(number <= duxBudget(state,input,blueOnly),'Dux does not have permission or Resources for this payment.')
    if (!human(state,'d') || !isMarked(input['red-first']) || blueOnly) {
      spendDux(state,number,access)
    } else {
      const red = Math.min(number,state.tracks.red)
      state.tracks.red -= red
      state.tracks.blue -= number-red
    }
  }
  const donorFields = (state,permissionPossible = showPermission(state)) => [
    ...(permissionPossible ? [permissionField()] : []),
    ...(human(state,'d') && state.tracks.red ? [check('red-first','Spend Dux Resources before Briton Resources',false,true)] : []),
  ]

  function clearPlunder(state,keys,track) {
    let gold = 0
    for (const name of names) {
      for (const key of keys) {
        gold += loaded(state.land[name],key)
        state.land[name].units[key][1] = 0
      }
    }
    changeTrack(state,track,gold)
    return gold
  }
  function removeUnit(space,key,takesPlunder) {
    ensure(on(space,key) > 0,'No such unit remains on the map.')
    const hadPlunder = takesPlunder ?? (loaded(space,key) === on(space,key))
    space.units[key][0]--
    if (hadPlunder) space.units[key][1]--
  }
  function relocateUnits(state,from,to,key,count,report) {
    if (!count || from===to) return
    const space = state.land[from]
    const carry = Math.max(0,count - (on(space,key) - loaded(space,key)))
    moveUnits(state,from,to,key,count,carry)
    report?.moves.push({from,to,key,count})
  }
  function selectRoster(state,keys,count,roll,label,priority = keys,exact = {}) {
    const eligible = names.flatMap(name => keys.flatMap(key => {
      const total = on(state.land[name],key)
      return total ? [{name,key,total,unloaded:total-loaded(state.land[name],key)}] : []
    }))
    const chosen = []
    const explicit = eligible.some(group => hasInput(exact,group.name+'-'+group.key))
    if (explicit) {
      for (const group of eligible) {
        const n = getNumber(exact,group.name+'-'+group.key,0,group.total)
        for (let i = 0; i < n; i++) chosen.push({name:group.name,key:group.key,loot:i >= group.unloaded})
      }
      ensure(chosen.length === count,`Select exactly ${count} pieces for ${label}.`)
      return chosen
    }
    const priorityNames = priority.map(value=>[value].flat())
    for (let i = 0; i < count; i++) {
      const priorityGroup = priorityNames.find(values=>eligible.some(group=>values.includes(group.key) && group.total))
      ensure(priorityGroup,'The chosen force exceeds the available pieces.')
      let groups = eligible.filter(group => priorityGroup.includes(group.key) && group.total)
      const unloaded = groups.filter(group => group.unloaded)
      if (unloaded.length) groups = unloaded
      const region = randomSpace([...new Set(groups.map(group=>group.name))],roll,label)
      const atRegion = groups.filter(group=>group.name===region)
      const group = atRegion[randomIndex(atRegion.length,roll,label)]
      chosen.push({name:group.name,key:group.key,loot:group.unloaded === 0})
      group.total--
      if (group.unloaded) group.unloaded--
    }
    return chosen
  }
  function rosterFields(state,keys,prefix,label) {
    return boxesWith(state,keys).flatMap(name =>
      keys.filter(key => on(state.land[name],key)).map(key =>
        amount(prefix+name+'-'+key,`${label} · ${name}, ${groupLabel(key)}`,0,on(state.land[name],key),'',true)))
  }
  function takeLosses(state,roster,count,roll,label,exact = {}) {
    if (!count) return
    const eligible = [...roster].sort((a,b) => (a.key === 'cav' ? 2 : a.key === 'com' ? 1 : 0) -
      (b.key === 'cav' ? 2 : b.key === 'com' ? 1 : 0) || a.loot - b.loot)
    const losses = []
    const hasExact = eligible.some(unit => hasInput(exact,unit.name+'-'+unit.key))
    if (hasExact) {
      const groups = [...new Set(eligible.map(unit => unit.name+'-'+unit.key))]
      for (const group of groups) {
        const pieces = eligible.filter(unit => unit.name+'-'+unit.key === group)
        losses.push(...pieces.slice(0,getNumber(exact,group,0,pieces.length)))
      }
      ensure(losses.length === count,`Choose exactly ${count} participating pieces to lose.`)
    } else {
      while (losses.length < count) {
        const {key,loot} = eligible[0]
        const pieceType = unitKey => ['cav','com'].includes(unitKey) ? unitKey : 'foederati'
        const matches = eligible.filter(unit => pieceType(unit.key) === pieceType(key) && unit.loot === loot)
        const region = randomSpace([...new Set(matches.map(unit => unit.name))],roll,label)
        const keysInRegion = [...new Set(matches.filter(unit=>unit.name===region).map(unit=>unit.key))]
        const selectedKey = keysInRegion[randomIndex(keysInRegion.length,roll,label)]
        losses.push(eligible.splice(eligible.findIndex(unit => unit.key === selectedKey && unit.loot === loot && unit.name === region),1)[0])
      }
    }
    for (const unit of losses) {
      removeUnit(state.land[unit.name],unit.key,unit.loot)
      if (unit.key === 'cav') state.pools.casualties++
    }
  }
  function allocation(input,prefix) {
    return Object.fromEntries(Object.entries(input).filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key.slice(prefix.length),value]))
  }
  function houseAssign(state,key,destinations,faction,input,roll,desc,report) {
    if (!destinations.length) return
    const total = troopsOnMap(state,key)
    if (!total) return
    let counts
    const fieldName = name => `quarters-${key}-${name}`
    if (human(state,faction) && destinations.some(name => hasInput(input,fieldName(name)))) {
      counts = Object.fromEntries(destinations.map(name => [name,getNumber(input,fieldName(name),0,total)]))
      ensure(sum(Object.values(counts)) === total,`Assign all ${total} ${groupLabel(key)} in Upkeep.`)
    } else {
      const each = Math.floor(total / destinations.length)
      let extras = total % destinations.length
      counts = Object.fromEntries(destinations.map(name => [name,each]))
      while (extras--) {
        const options = destinations.filter(name => counts[name] === each)
        const staying = options.filter(name => on(state.land[name],key) > each)
        const choice = randomSpace(staying.length ? staying : options,roll,desc)
        counts[choice]++
      }
    }
    applyQuarters(state,key,counts,report)
  }
  function applyQuarters(state,key,counts,report) {
    const destinations = Object.entries(counts)
    for (const from of names) {
      const source = state.land[from]
      let excess = on(source,key) - (counts[from] ?? 0)
      if (excess < 1) continue
      for (const [to,count] of destinations) {
        const target = state.land[to]
        const moving = Math.min(excess,count-on(target,key))
        if (moving < 1) continue
        relocateUnits(state,from,to,key,moving,report)
        excess -= moving
      }
    }
  }
  function civFoederatiQuarters(state,settlements,roll,report) {
    const keys = ['cxw','csw']
    const [saxons,scotti] = keys.map(key => settlements[key].length ? troopsOnMap(state,key) : 0)
    if (!saxons && !scotti) return

    const spaces = names.filter(name => (saxons && settlements.cxw.includes(name)) || (scotti && settlements.csw.includes(name)))
    const draft = {...state,land:Object.fromEntries(spaces.map(name => [name,clone(state.land[name])]))}
    const allocations = spaces.map(name => {
      const maxSaxons = settlements.cxw.includes(name) ? saxons : 0
      const maxScotti = settlements.csw.includes(name) ? scotti : 0
      const options = []
      for (let x = 0; x <= maxSaxons; x++) {
        draft.land[name].units.cxw[0] = x
        for (let s = 0; s <= maxScotti; s++) {
          draft.land[name].units.csw[0] = s
          const owner = control(draft,name)
          options.push({x,s,pop:owner === 'b' || owner === 'c' ? draft.land[name].pop : 0})
        }
      }
      return options
    })
    // The nationalities can share a Settlement Region's Control. Score the remaining
    // Regions jointly so neither nationality overfills a Region the other could hold.
    const memo = spaces.map(() => new Map())
    function bestPopulation(index,x,s) {
      if (index === spaces.length) return x || s ? -Infinity : 0
      const key = x*(scotti+1)+s
      const cache = memo[index]
      if (cache.has(key)) return cache.get(key)
      let best = -Infinity
      for (const option of allocations[index]) {
        if (option.x <= x && option.s <= s) {
          best = Math.max(best,option.pop+bestPopulation(index+1,x-option.x,s-option.s))
        }
      }
      cache.set(key,best)
      return best
    }
    const counts = {cxw:{},csw:{}}
    let x = saxons
    let s = scotti
    for (const [index,name] of spaces.entries()) {
      const best = bestPopulation(index,x,s)
      const tied = allocations[index].filter(option => option.x <= x && option.s <= s &&
        option.pop+bestPopulation(index+1,x-option.x,s-option.s) === best)
      const selected = tied[randomIndex(tied.length,roll,'Civitates Foederati quarters · '+name)]
      if (saxons && settlements.cxw.includes(name)) counts.cxw[name] = selected.x
      if (scotti && settlements.csw.includes(name)) counts.csw[name] = selected.s
      x -= selected.x
      s -= selected.s
    }

    const before = report && boardTotals(state).pop.c
    const moveCount = report?.moves.length
    for (const key of keys) applyQuarters(state,key,counts[key],report)
    if (report) {
      const after = boardTotals(state).pop.c
      report.notes.push(`Best legal Foederati quarters: Briton-controlled Population ${before} → ${after}.`)
      if (report.moves.length === moveCount) report.notes.push('The current Foederati quarters already attain that maximum.')
    }
  }
  function nearest(origin,destinations) {
    if (!destinations.length) return []
    const visited = new Set([origin])
    let layer = [origin]
    while (layer.length) {
      const result = layer.filter(name => destinations.includes(name))
      if (result.length) return result
      layer = layer.flatMap(name => BY_NAME[name].adj).filter(name => {
        if (visited.has(name)) return false
        visited.add(name)
        return true
      })
    }
    return []
  }
  function chooseQuarters(state,from,key,destinations,faction,input,roll,nearestOnly = true) {
    const possible = nearestOnly ? nearest(from,destinations) : destinations
    if (possible.length === 1) return possible[0]
    const keyName = `nearest-${key}-${from}`
    if (human(state,faction) && hasInput(input,keyName)) {
      ensure(possible.includes(input[keyName]),'Choose a qualifying Stronghold for redeployment.')
      return input[keyName]
    }
    if (faction === 'c' && !human(state,'c')) {
      const candidates = possible.map(name => {
        const draft = clone(state)
        relocateUnits(draft,from,name,key,on(draft.land[from],key))
        return {name,pop:boardTotals(draft).pop.c}
      })
      const best = Math.max(...candidates.map(({pop})=>pop))
      return randomSpace(candidates.filter(({pop})=>pop===best).map(({name})=>name),roll,'Civitates redeployment')
    }
    return randomSpace(possible,roll,NAMES[faction]+' redeployment')
  }
  function combineOrDisband(state,key,from,destinations,faction,input,roll,disband,report) {
    const space = state.land[from]
    if (!on(space,key) || destinations.includes(from)) return
    if (!destinations.length) {
      if (disband) {
        report?.moves.push({from,to:'Available',key,count:on(space,key)})
        space.units[key] = [0,0]
      }
      return
    }
    const where = chooseQuarters(state,from,key,destinations,faction,input,roll)
    relocateUnits(state,from,where,key,on(space,key),report)
  }
  function releaseFoederati(state,employer,nation,report) {
    const key = employer+nation+'w'
    for (const name of names) {
      const space = state.land[name]
      const count = on(space,key)
      if (count) report?.notes.push(`${name} · ${count} ${groupLabel(key)} become independent because their matching Settlements are gone.`)
      space.units[nation+'w'][0] += count
      space.units[nation+'w'][1] += loaded(space,key)
      space.units[key] = [0,0]
    }
  }
  function nearestFields(state,keys,destinations) {
    if (!destinations.length) return []
    return keys.flatMap(key => boxesWith(state,[key]).filter(name=>!destinations.includes(name)).flatMap(from => {
      const candidates = nearest(from,destinations)
      return candidates.length > 1 ? [selector(`nearest-${key}-${from}`,`Move ${groupLabel(key)} from ${from}`,[autoplace,...optionsFor(candidates)],'',true)] : []
    }))
  }
  function houseFields(state,key,destinations) {
    const total = troopsOnMap(state,key)
    return total > 0 && destinations.length > 1 ? destinations.map(name =>
      amount(`quarters-${key}-${name}`,`Keep ${groupLabel(key)} in ${name}`,0,total,'',true)) : []
  }
  const civSites = state => siteNames([...siteList(state,'town'),...siteList(state,'hill')])
  function fortChoices(state,input) {
    const forts = siteList(state,'fort')
    if (!human(state,'d')) return []
    const stowed = sum(names.map(name => ['cav',...redFoederati].reduce((n,key)=>n+loaded(state.land[name],key),0)))
    const discount = marker(state,67,'shaded') ? 2 : 1
    const usablePlunder = Math.min(stowed,80-state.tracks.red)
    const canKeep = Math.min(forts.length,(duxBudget(state,input)+usablePlunder)*discount)
    return forts.map((site,i) => ({...check('fort-'+site.id,'Maintain '+site.label,i<canKeep,true),refresh:true}))
  }
  function duxUpkeepChoices(state,input) {
    const forts = fortChoices(state,input)
    const remaining = siteNames(siteList(state,'fort').filter(site=> {
      if (!human(state,'d')) return true
      const choice = forts.find(field=>field.name==='fort-'+site.id)
      return isMarked(input[choice.name],choice.defaultValue)
    }))
    const roads = human(state,'d') && state.imperium[0] === 'a' && state.roads
      ? [check('maintain-roads','Maintain Roads for 10 Resources')] : []
    return {
      help:'Stow Dux Plunder, maintain Forts and Roads, redeploy troops, and settle the Cavalry Casualties box.',
      fields:[...donorFields(state),...roads,...forts,
        ...(human(state,'d') ? [...houseFields(state,'cav',remaining),
          ...['x','s'].flatMap(nation=>houseFields(state,'d'+nation+'w',siteNames(siteList(state,nation+'s','d'))))] : [])],
    }
  }
  function duxUpkeep(state,input,roll,report) {
    const gold = clearPlunder(state,['cav',...redFoederati],'red')
    const forts = siteList(state,'fort')
    const discount = marker(state,67,'shaded') ? 2 : 1
    const funds = duxBudget(state,input)
    const canKeep = Math.min(forts.length,funds*discount)
    const kept = human(state,'d') ? forts.filter((site,i) => isMarked(input['fort-'+site.id],i<canKeep))
      : canKeep === forts.length ? forts : orderedSites(forts,canKeep,roll,'Fort Upkeep')
    const cost = Math.ceil(kept.length/discount)
    payDux(state,cost,input)
    for (const site of forts) {
      if (!kept.includes(site)) state.land[site.name].sites[site.index] = null
    }
    let roadLine = ''
    if (state.imperium[0] === 'a' && state.roads) {
      const maintain = human(state,'d') ? isMarked(input['maintain-roads']) : duxBudget(state,input) >= 10
      if (maintain) payDux(state,10,input)
      else state.roads = false
      roadLine = maintain ? ' Roads maintained for 10.' : ' Roads were abandoned.'
    }
    if (!kept.length && troopsOnMap(state,'cav')) report?.notes.push('Cavalry stay in place because no maintained Fort remains.')
    houseAssign(state,'cav',siteNames(kept),'d',input,roll,'Cavalry quarters',report)
    for (const nation of ['x','s']) {
      const towns = siteNames(siteList(state,nation+'s','d'))
      if (towns.length) houseAssign(state,'d'+nation+'w',towns,'d',input,roll,'Dux Foederati quarters',report)
      else releaseFoederati(state,'d',nation,report)
    }
    const fractions = {rm:[1,1],rc:[2,3],am:[1,2],ac:[1,2],f:[1,1]}
    const [numerator,denominator] = fractions[state.imperium]
    const recovered = Math.floor(state.pools.casualties*numerator/denominator)
    const out = state.pools.casualties-recovered
    state.pools.out += out
    state.pools.casualties = 0
    return `Stowed ${gold} Plunder. Maintained ${kept.length} of ${forts.length} Forts for ${cost} Resources.${roadLine} Cavalry Casualties: ${recovered} Available, ${out} Out of Play.`
  }
  function civUpkeepChoices(state,input) {
    const fields = []
    if (human(state,'c')) {
      const stowed = sum(names.map(name=>['mil','com',...blueFoederati].reduce((n,key)=>n+loaded(state.land[name],key),0)))
      const availableWealth = Math.min(80,state.tracks.wealth + stowed)
      const com = troopsOnMap(state,'com')
      const hasGratia = marker(state,27,'unshaded')
      const budget = state.tracks.blue+availableWealth
      const keepGratia = hasGratia && isMarked(input['maintain-gratia'],budget>=10)
      const afterGratia = budget-(keepGratia?10:0)
      if (hasGratia) fields.push({...check('maintain-gratia','Maintain Gratia for 10 Resources',budget>=10),refresh:true})
      const hills = marker(state,21,'shaded') ? siteList(state,'hill') : []
      const keptHills = hills.filter((site,i)=>isMarked(input['hill-'+site.id],i<afterGratia))
      for (const [i,site] of hills.entries()) fields.push({...check('hill-'+site.id,'Maintain '+site.label,i<afterGratia,true),refresh:true})
      const wealthLeft = Math.max(0,availableWealth-Math.max(0,budget-afterGratia+keptHills.length-state.tracks.blue))
      const maxPayment = Math.min(wealthLeft,Math.ceil(com/3))
      if (com) fields.push(amount('comitates-wealth','Wealth to retain Comitates',0,maxPayment,maxPayment), ...rosterFields(state,['com'],'com-remove-','Remove unpaid Comitates'))
      const maintained = siteNames(keptHills)
      const destinations = hills.length ? [...new Set([...siteNames(siteList(state,'town')),...maintained])] : civSites(state)
      fields.push(...nearestFields(state,['mil','com'],destinations))
      for (const nation of ['x','s']) {
        const options = siteNames(siteList(state,nation+'s','c'))
        const key = 'c'+nation+'w'
        if (options.length > 1) fields.push(...houseFields(state,key,options))
      }
    }
    return {help:'Stow Civitates Plunder, thin Militia, pay Comitates, discard Refugees, and redeploy. Active Upkeep capabilities are included.',fields}
  }
  function civUpkeep(state,input,roll,report) {
    const gold = clearPlunder(state,['mil','com',...blueFoederati],'wealth')
    let lines = ''
    if (marker(state,27,'unshaded')) {
      const keep = human(state,'c') ? isMarked(input['maintain-gratia'],civBudget(state)>=10) : state.tracks.blue>25
      if (keep) spendCivitates(state,10)
      else delete state.markers[27]
      lines += keep ? ' Gratia maintained.' : ' Gratia discarded.'
    }
    if (marker(state,21,'shaded')) {
      const hills = siteList(state,'hill')
      const payable = Math.min(hills.length,civBudget(state))
      const kept = human(state,'c') ? hills.filter((site,i) => isMarked(input['hill-'+site.id],i<payable))
        : payable === hills.length ? hills : orderedSites(hills,payable,roll,'Camelot Hillfort Upkeep')
      spendCivitates(state,kept.length)
      for (const site of hills) {
        if (!kept.includes(site)) state.land[site.name].sites[site.index] = null
      }
      lines += ` Maintained ${kept.length} of ${hills.length} Hillforts.`
    }
    let released = 0
    for (const name of names) {
      const space = state.land[name]
      const n = Math.floor(on(space,'mil')/3)
      released += n
      space.units.mil[0] -= n
    }
    const total = troopsOnMap(state,'com')
    const maximum = Math.min(Math.ceil(total/3),state.tracks.wealth)
    const pay = human(state,'c') ? getNumber(input,'comitates-wealth',0,maximum,maximum) : maximum
    state.tracks.wealth -= pay
    const demob = Math.max(0,total-pay*3)
    if (demob) {
      const exact = human(state,'c') ? allocation(input,'com-remove-') : {}
      const unpaid = selectRoster(state,['com'],demob,roll,'Comitates Upkeep',['com'],exact)
      for (const {name,key,loot} of unpaid) removeUnit(state.land[name],key,loot)
    }
    state.tracks.refugees = Math.floor(state.tracks.refugees/2)
    const strongholds = civSites(state)
    for (const key of ['mil','com']) {
      for (const from of names) combineOrDisband(state,key,from,strongholds,'c',input,roll,false,report)
    }
    if (!strongholds.length && (troopsOnMap(state,'mil') || troopsOnMap(state,'com'))) {
      report?.notes.push('Militia and Comitates stay in place because no Town or Hillfort remains.')
    }
    const settlements = {}
    for (const nation of ['x','s']) {
      const key = 'c'+nation+'w'
      settlements[key] = siteNames(siteList(state,nation+'s','c'))
      if (!settlements[key].length) releaseFoederati(state,'c',nation,report)
    }
    if (!human(state,'c')) {
      civFoederatiQuarters(state,settlements,roll,report)
    } else {
      for (const key of blueFoederati) {
        const destinations = settlements[key]
        if (!destinations.length) continue
        if (destinations.some(name=>hasInput(input,`quarters-${key}-${name}`))) {
          houseAssign(state,key,destinations,'c',input,roll,'Civitates Foederati quarters',report)
          continue
        }
        for (const from of boxesWith(state,[key])) {
          if (destinations.includes(from)) continue
          const where = chooseQuarters(state,from,key,destinations,'c',input,roll,false)
          relocateUnits(state,from,where,key,on(state.land[from],key),report)
        }
      }
    }
    return `Stowed ${gold} Plunder, released ${released} Militia and ${demob} unpaid Comitates, and kept ${state.tracks.refugees} Refugees.${lines}`
  }
  function barbarianUpkeepChoices(state,faction) {
    const strongholds = siteNames(siteList(state,faction+'s'))
    return {
      help:`Return loaded ${NAMES[faction]} forces, then redeploy Warbands to their nearest Settlement or remove them if none remains.`,
      fields:human(state,faction) ? nearestFields(state,[faction+'w'],strongholds) : [],
    }
  }
  function barbarianUpkeep(state,faction,input,roll,report) {
    const r = faction+'r'
    const w = faction+'w'
    let raiders = 0
    let loot = 0
    for (const space of Object.values(state.land)) {
      const returning = loaded(space,r) + loaded(space,w)
      if (!returning) continue
      loot += returning
      raiders += on(space,r)
      space.units[r] = [0,0]
      space.units[w][1] = 0
    }
    changeTrack(state,faction,loot)
    const settlements = siteNames(siteList(state,faction+'s'))
    const disbanded = settlements.length ? 0 : troopsOnMap(state,w)
    for (const name of names) combineOrDisband(state,w,name,settlements,faction,input,roll,true,report)
    state.tracks[faction] = Math.max(faction==='x' ? 10 : 6,state.tracks[faction])
    return `${NAMES[faction]} returned ${raiders} Raiders and ${loot} Plunder. ${disbanded ? `${disbanded} Warbands disbanded.` : 'Warband redeployment complete.'} Renown ${state.tracks[faction]}.`
  }

  function bidChoices(state,card,input) {
    const cardInfo = earlyEvents[card]
    const count = troopsOnMap(state,'cav')
    const max = Math.min(cardInfo.max,Math.floor(duxBudget(state,input)/3),count)
    const bids = [pair('0','Decline the bid'),...Array.from({length:Math.max(0,max-cardInfo.min+1)},(_,i) => {
      const value = cardInfo.min+i
      return pair(String(value),`Send ${value} Cavalry for ${3*value} Resources`)
    })]
    return {
      help:state.imperium[1] === 'm'
        ? 'Commit Cavalry before rolling. Declining costs 8 Prestige under Military Dominance.'
        : 'Commit Cavalry before rolling. You may decline the bid without losing Prestige.',
      fields:[...donorFields(state),...(human(state,'d') && max>=cardInfo.min ? [
        selector('bid-cavalry','Dux bid',bids,'0'),
        ...rosterFields(state,['cav'],'bid-','Send'),
      ] : [])],
    }
  }
  function bidForEmpire(state,card,input,roll) {
    const cardInfo = earlyEvents[card]
    const bot = !human(state,'d')
    const max = Math.min(cardInfo.max,Math.floor(duxBudget(state,input,bot)/3),troopsOnMap(state,'cav'))
    const bid = bot ? max>=cardInfo.min ? max : 0 : getNumber(input,'bid-cavalry',0,max)
    ensure(bid===0 || bid>=cardInfo.min,`This bid requires at least ${cardInfo.min} Cavalry.`)
    if (!bid) {
      if (state.imperium[1] === 'm') {
        changeTrack(state,'prestige',-8)
        return `${cardInfo.title}: no bid. Dux loses 8 Prestige under Military Dominance.`
      }
      return `${cardInfo.title}: Dux declined the bid.`
    }
    payDux(state,bid*3,input,bot)
    const choice = selectRoster(state,['cav'],bid,roll,'Cavalry for '+cardInfo.title,['cav'],bot ? {} : allocation(input,'bid-'))
    for (const {name,key,loot} of choice) removeUnit(state.land[name],key,loot)
    state.pools.casualties++
    state.pools.out += bid-1
    const die = roll(6,cardInfo.title+' bid')
    if (die > bid) {
      changeTrack(state,'prestige',-8)
      return `${cardInfo.title}: ${bid} Cavalry departed. Roll ${die} failed; Dux loses 8 Prestige.`
    }
    changeTrack(state,'blue',cardInfo.reward)
    if (state.imperium === 'rm') changeTrack(state,'prestige',5)
    else setImperium(state,'rm')
    return `${cardInfo.title}: ${bid} Cavalry departed. Roll ${die} succeeds; gain ${cardInfo.reward} Briton Resources and resolve the Roman Rule benefit.`
  }
  function tiesDestinations(state) {
    return REGIONS.filter(({name,terrain}) => terrain !== 'City' && ['b','c'].includes(control(state,name))).map(({name})=>name)
  }
  function tiesCanShift(state) {
    return ['rm','rc','am'].includes(state.imperium)
  }
  function tiesShift(state) {
    if (state.imperium === 'rm') setImperium(state,'rc')
    else if (['rc','am'].includes(state.imperium)) setImperium(state,'ac')
  }
  function donatioStatus(state,card,input) {
    const draft = { ...state }
    if (card===79 && isRoman(draft)) setImperium(draft,draft.imperium === 'rm' ? 'rc' : 'am')
    if (card===80 && (human(state,'c') ? isMarked(input['cut-ties']) : tiesCanShift(state))) tiesShift(draft)
    return draft
  }
  function donatioChoices(state,card,input) {
    const fields = []
    const prospective = donatioStatus(state,card,input)
    const dice = Math.ceil(troopsOnMap(state,'cav')/7)
    if (card===80 && human(state,'c')) {
      fields.push({...check('cut-ties','Choose the Civitates political option and place Militia'),refresh:true})
      const limit = Math.min(10,availability(state).mil)
      if (limit) fields.push(...tiesDestinations(state).map(name=>amount('ties-militia-'+name,'Place Militia in '+name,0,limit,'',true)))
    }
    const optionalAutonomy = card===80 && ['rc','am'].includes(state.imperium) && human(state,'c')
    if (dice && (showPermission(prospective) || (optionalAutonomy && state.tracks.blue))) fields.push(permissionField())
    if (human(state,'d')) {
      if (state.tracks.red) fields.push(check('red-first','Spend Dux Resources before Briton Resources',false,true))
      fields.push(amount('donatio-resources','Dux Resources pledged before rolling',0,duxBudget(prospective,input),0))
      if (dice) fields.push(...rosterFields(state,['cav'],'donatio-remove-','Return Cavalry to Available'))
    }
    if (human(state,'c') && state.tracks.wealth) fields.push(amount('donatio-wealth','Civitates Wealth pledged before rolling',0,state.tracks.wealth,0))
    return {
      help: card===79
        ? 'Apply the Imperial shift, commit any payments, then roll one die per seven Cavalry (rounded up). Each unpaid point returns one Cavalry to Available.'
        : 'Civitates may take the political option and place up to ten Available Militia. Then commit payments and roll for Cavalry departures.',
      fields,
    }
  }
  function placeTiesMilitia(state,input,roll) {
    const candidates = tiesDestinations(state)
    const count = Math.min(availability(state).mil,10)
    if (!candidates.length || !count) return 0
    if (human(state,'c') && candidates.some(name=>hasInput(input,'ties-militia-'+name))) {
      const placed = candidates.map(name=>getNumber(input,'ties-militia-'+name,0,count))
      ensure(sum(placed)===count,`Place exactly ${count} Militia among Briton-Controlled Regions.`)
      for (const [i,name] of candidates.entries()) state.land[name].units.mil[0] += placed[i]
      return count
    }
    const chosen = []
    const pool = [...candidates]
    while (pool.length && chosen.length<3 && chosen.length<count) {
      const lowest = Math.min(...pool.map(name=>on(state.land[name],'mil')))
      const name = randomSpace(pool.filter(name=>on(state.land[name],'mil')===lowest),roll,'Cutting the Ties Militia')
      chosen.push(name)
      pool.splice(pool.indexOf(name),1)
    }
    const base = Math.floor(count/chosen.length)
    const extras = count%chosen.length
    for (const [i,name] of chosen.entries()) state.land[name].units.mil[0] += base+(i<extras?1:0)
    return count
  }
  function respondToRescript(state,card,input,roll) {
    const prospective = donatioStatus(state,card,input)
    const before = state.imperium
    setImperium(state,prospective.imperium)
    let militia = 0
    const takeMilitia = card===80 && (human(state,'c') ? isMarked(input['cut-ties']) : tiesCanShift({imperium:before}))
    if (takeMilitia) militia = placeTiesMilitia(state,input,roll)
    const cav = troopsOnMap(state,'cav')
    const dice = Math.ceil(cav/7)
    const resources = human(state,'d') ? getNumber(input,'donatio-resources',0,duxBudget(state,input)) : Math.min(duxBudget(state,input),3*dice)
    const wealth = human(state,'c') ? getNumber(input,'donatio-wealth',0,state.tracks.wealth) :
      card===79 && isRoman(state) && !human(state,'d') ? Math.min(state.tracks.wealth,dice) : 0
    payDux(state,resources,input)
    state.tracks.wealth -= wealth
    const discontent = sum(Array.from({length:dice},()=>roll(6,'Cavalry donatio')))
    const losses = Math.min(cav,Math.max(0,discontent-resources-wealth))
    if (losses) {
      const gone = selectRoster(state,['cav'],losses,roll,'Cavalry returned to Available',['cav'],
        human(state,'d') ? allocation(input,'donatio-remove-') : {})
      for (const {name,key,loot} of gone) removeUnit(state.land[name],key,loot)
    }
    const text = card===79 ? 'Rescript of Honorius' : 'Cutting the Ties'
    return `${text}.${militia ? ` Placed ${militia} Militia.`:''} Paid ${resources} Resources and ${wealth} Wealth before the roll. Returned ${losses} Cavalry to Available.`
  }
  function tearsOfEpona(state) {
    if (marker(state,81,'unshaded')) return 'Tears of Epona is already active.'
    for (const name of TEARS_REGIONS) state.land[name].pop = Math.max(0,state.land[name].pop-1)
    state.markers[81] = {type:'capability',side:'unshaded'}
    return 'Tears of Epona reduced Population in Textoverdi, Deceangli, Iceni, and Durotriges. These Regions now use printed Population 1.'
  }
  function rhiotamusChoices(state) {
    const max = Math.min(4,troopsOnMap(state,'cav'))
    const maxFoederati = Math.min(max,sum(redFoederati.map(key=>troopsOnMap(state,key))))
    return {
      help:'Dux can send up to four Cavalry plus no more red Foederati than Cavalry. Double a D6. Failure costs Prestige and half the expedition force (rounded up).',
      fields:human(state,'d') && max ? [
        {...amount('rhiotamus-cavalry','Cavalry to send',0,max,0),refresh:true},
        amount('rhiotamus-foederati','Red Foederati to send',0,maxFoederati,0),
        ...rosterFields(state,['cav',...redFoederati],'rhiotamus-send-','Send'),
        ...rosterFields(state,['cav',...redFoederati],'rhiotamus-remove-','If the expedition fails, remove'),
      ] : [],
    }
  }
  function rhiotamus(state,input,roll) {
    const bot = !human(state,'d')
    const cavalryOnMap = troopsOnMap(state,'cav')
    const foederatiOnMap = sum(redFoederati.map(key=>troopsOnMap(state,key)))
    const cavalry = bot ? cavalryOnMap>=4 && foederatiOnMap>=4 ? 4 : 0 : getNumber(input,'rhiotamus-cavalry',0,Math.min(4,cavalryOnMap))
    const foederati = bot ? cavalry : getNumber(input,'rhiotamus-foederati',0,Math.min(cavalry,foederatiOnMap))
    if (!cavalry) return 'Rhiotamus: Dux declined the expedition.'
    const exact = bot ? {} : allocation(input,'rhiotamus-send-')
    const participants = [...selectRoster(state,['cav'],cavalry,roll,'Rhiotamus Cavalry',['cav'],exact),
      ...selectRoster(state,redFoederati,foederati,roll,'Rhiotamus Foederati',[redFoederati],exact)]
    const result = roll(6,'Rhiotamus expedition')*2
    if (result <= participants.length) {
      changeTrack(state,'prestige',5)
      return `Rhiotamus: sent ${participants.length} troops. Result ${result}, expedition succeeds; Dux gains 5 Prestige.`
    }
    const numberLost = Math.ceil(participants.length/2)
    takeLosses(state,participants,numberLost,roll,'Rhiotamus losses',bot ? {} : allocation(input,'rhiotamus-remove-'))
    changeTrack(state,'prestige',-5)
    if (state.imperium[1]==='m') setImperium(state,state.imperium[0]+'c')
    return `Rhiotamus: sent ${participants.length} troops. Result ${result}, expedition fails; remove ${numberLost} troops and lose 5 Prestige.`
  }
  const pendragonKeys = {d:['cav',...redFoederati], c:['com',...blueFoederati]}
  function expeditionMax(state,faction,input,ownOnly = false) {
    const partner = faction === 'd' ? 'c' : 'd'
    const help = !ownOnly && human(state,partner) && isMarked(input['lend-'+partner])
    const keys = help ? [...pendragonKeys[faction],...pendragonKeys[partner]] : pendragonKeys[faction]
    const funds = faction === 'd' ? duxBudget(state,input) : human(state,'c') ? civBudget(state) : state.tracks.blue
    return {
      keys,
      own:Math.min(10,Math.floor(funds/2),sum(pendragonKeys[faction].map(key=>troopsOnMap(state,key)))),
      all:Math.min(10,Math.floor(funds/2),sum(keys.map(key=>troopsOnMap(state,key)))),
    }
  }
  function pendragonChoices(state,input) {
    const maxBidD = expeditionMax(state,'d',input,true).own
    const maxBidC = expeditionMax(state,'c',input,true).own
    const fields = donorFields(state)
    for (const [id,max] of [['d',maxBidD],['c',maxBidC]]) {
      if (!human(state,id)) continue
      fields.push({...check('lend-'+id,'Offer eligible '+NAMES[id]+' troops if the other Briton faction wins',false,true),refresh:true})
      const { keys,all } = expeditionMax(state,id,input)
      if (max) fields.push(amount('pendragon-bid-'+id,NAMES[id]+' units pledged in the bid',0,max,0))
      if (!all) continue
      fields.push(amount('pendragon-send-'+id,NAMES[id]+' total expedition units (including any consented allies)',0,all,'',true))
      fields.push(selector('pendragon-target-'+id,NAMES[id]+' expedition target',optionsFor(['x','s']).map(option=>({...option,label:NAMES[option.value]})),state.tracks.x>=state.tracks.s?'x':'s'))
      if (!isFragmentation(state)) fields.push(selector('pendragon-dominance-'+id,'Dominance after success',[pair('','Keep current'),pair('m','Military'),pair('c','Civilian')],'',true))
      fields.push(...rosterFields(state,keys,'pendragon-roster-'+id+'-','Send'),...rosterFields(state,keys,'pendragon-remove-'+id+'-','If the expedition fails, remove'))
    }
    return {help:'Bid with a faction’s own units. Dux wins ties. The winner pays 2 Resources per participating unit. Either Briton faction may decline to lend its troops.',fields}
  }
  function pendragonExpedition(state,input,roll) {
    const bids = Object.fromEntries(['d','c'].map(id => {
      const { own } = expeditionMax(state,id,input,true)
      return [id,human(state,id) ? getNumber(input,'pendragon-bid-'+id,0,own) : own >= (id==='d'?8:6) ? own : 0]
    }))
    const winner = bids.d>=bids.c?'d':'c'
    if (bids[winner]===0) return 'Pendragon: both Briton factions declined the expedition.'
    const bot = !human(state,winner)
    const {keys,all} = expeditionMax(state,winner,input)
    const count = bot ? all : getNumber(input,'pendragon-send-'+winner,bids[winner],all,bids[winner])
    const exact = bot ? {} : allocation(input,'pendragon-roster-'+winner+'-')
    const priority = [keys.filter(key=>!['com','cav'].includes(key)),'cav','com']
    let roster
    if (Object.values(exact).some(value=>value !== '')) {
      roster = selectRoster(state,keys,count,roll,'Pendragon expedition troops',priority,exact)
      ensure(roster.filter(unit=>pendragonKeys[winner].includes(unit.key)).length>=bids[winner],
        'Send at least the number of own units pledged in your bid.')
    } else {
      const partnerKeys = keys.filter(key=>!pendragonKeys[winner].includes(key))
      const allyCount = Math.min(sum(partnerKeys.map(key=>troopsOnMap(state,key))),count-bids[winner])
      roster = selectRoster(state,pendragonKeys[winner],count-allyCount,roll,'Pendragon expedition troops',priority)
      if (allyCount) roster.push(...selectRoster(state,partnerKeys,allyCount,roll,'Pendragon allied troops',priority))
    }
    if (winner==='d') payDux(state,2*count,input)
    else spendCivitates(state,2*count)
    const doubled = roll(6,'Pendragon expedition')*2
    if (doubled > count) {
      const losses = Math.ceil(count/2)
      takeLosses(state,roster,losses,roll,'Pendragon losses',bot ? {} : allocation(input,'pendragon-remove-'+winner+'-'))
      return `Pendragon: ${NAMES[winner]} paid for ${count} troops. Result ${doubled}, expedition fails; remove ${losses} troops.`
    }
    const rollTarget = () => state.tracks.x===state.tracks.s ? (roll(6,'Pendragon target')<=3?'x':'s') : state.tracks.x>state.tracks.s?'x':'s'
    const target = bot || !hasInput(input,'pendragon-target-'+winner) ? rollTarget() : input['pendragon-target-'+winner]
    ensure(['x','s'].includes(target),'Choose Saxons or Scotti as the expedition target.')
    changeTrack(state,target,-10)
    let gold = goldAvailable(state)
    let loadedCount = 0
    for (const unit of roster) {
      if (unit.loot || gold<1) continue
      state.land[unit.name].units[unit.key][1]++
      gold--
      loadedCount++
    }
    const shift = input['pendragon-dominance-'+winner]
    if (!isFragmentation(state) && (bot || shift)) {
      ensure(bot || ['m','c'].includes(shift),'Choose a valid Dominance.')
      setImperium(state,state.imperium[0]+(bot?(winner==='d'?'m':'c'):shift))
    }
    return `Pendragon: ${NAMES[winner]} paid for ${count} troops. Result ${doubled}, expedition succeeds. ${NAMES[target]} lose 10 Renown and ${loadedCount} troops gained Plunder.`
  }

  function eventChoices(state,input) {
    const id = state.current
    if (!inRange(id,77,83)) return null
    if (id<=80 && isFragmentation(state)) return {help:'This Early Epoch Event has no effect during Fragmentation.',fields:[]}
    if (earlyEvents[id]) return bidChoices(state,id,input)
    if (id===79 || id===80) return donatioChoices(state,id,input)
    if (id===81) return {help:'Lower Population in the four affected Regions and apply the permanent printed Population change.',fields:[]}
    if (id===82) return rhiotamusChoices(state)
    if (id===83) return pendragonChoices(state,input)
    return null
  }
  function runEvent(state,input,roll) {
    const id = state.current
    if (id<=80 && isFragmentation(state)) return 'The Early Epoch Event was inactive under Fragmentation.'
    if (earlyEvents[id]) return bidForEmpire(state,id,input,roll)
    if (id===79 || id===80) return respondToRescript(state,id,input,roll)
    if (id===81) return tearsOfEpona(state)
    if (id===82) return rhiotamus(state,input,roll)
    if (id===83) return pendragonExpedition(state,input,roll)
    throw new Error('Unknown Epoch Event.')
  }
  function choices(state,phase,input) {
    if (phase==='Epoch Event') return eventChoices(state,input)
    const faction = phaseFaction[phase]
    if (faction==='d') return duxUpkeepChoices(state,input)
    if (faction==='c') return civUpkeepChoices(state,input)
    return faction ? barbarianUpkeepChoices(state,faction) : null
  }
  function run(state,phase,input,roll,report) {
    if (phase==='Epoch Event') return runEvent(state,input,roll)
    const faction = phaseFaction[phase]
    if (report && faction) {
      const humanChoice = human(state,faction)
      report.priority = {
        d:humanChoice ? '§6.6.1. Cavalry use maintained Forts and red Foederati use matching Settlements.' :
          '§8.8.7. The Non-player Dux spreads Cavalry evenly among maintained Forts and red Foederati evenly among matching Settlements.',
        c:humanChoice ? '§6.6.2. Militia and Comitates use the nearest Town or Hillfort. Foederati use blue Settlements of their own Nation.' :
          '§§6.6.2 and 8.7.7. Militia and Comitates use the nearest Town or Hillfort, choosing by Control when equidistant. Blue Foederati use matching Settlements to maximize Briton-controlled Population, with random ties.',
        x:'§6.6.3. Saxon Warbands go to the nearest independent Saxon Stronghold or become Available if none remains.',
        s:'§6.6.3. Scotti Warbands go to the nearest independent Scotti Stronghold or become Available if none remains.',
      }[faction]
    }
    if (faction==='d') return duxUpkeep(state,input,roll,report)
    if (faction==='c') return civUpkeep(state,input,roll,report)
    if (faction) return barbarianUpkeep(state,faction,input,roll,report)
    throw new Error('Unknown Epoch economy phase.')
  }
  return { choices, run }
})()

export const epochChoices = (state,phase,input = {}) => epochEconomy.choices(state,phase,input)
export const runEpochEconomy = (state,phase,input = {},roll,report) => epochEconomy.run(state,phase,input,roll,report)

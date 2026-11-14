import { BY_NAME, COMMANDS, FEATS, GROUP, NAMES, PIECES, REGIONS, ROADS } from './data.mjs'
import { addProsperity, availability, changeTrack, clone, ensure, friendlyControl, groupLabel, hasStronghold, inRange, isFragmentation, isHumanFaction, loaded, on, piecesByOwner, plunderTo, preemption, scores, sum } from './position.mjs'
import { printedPopulation } from './scenarios.mjs'

const CALCULATED_COMMANDS = ['Train','Muster','Trade','March','Return']
const featOwners = { Build:['d'], Invite:['c','d'], Pillage:['c'], Reinforce:['c'], Requisition:['d'], Rule:['c'], Settle:['x','s'], Entreat:['s'] }
const briton = faction => faction === 'c' || faction === 'd'
const ownerTroops = {
  d:['cav','dxw','dsw'], c:['mil','com','cxw','csw'],
  x:['xw'], s:['sw'],
}
const otherBriton = faction => faction === 'd' ? 'c' : 'd'
const groupForces = (space,faction) => piecesByOwner(space)[faction]
const nativeSettlement = (space,faction) => space.sites.filter(site => site?.piece === faction+'s' && !site.employer).length
const found = key => Object.hasOwn(BY_NAME,key)
const isCity = name => BY_NAME[name].terrain === 'City'
const siteCount = (space,piece) => space.sites.filter(site => site?.piece === piece).length
const hasDuxForts = space => siteCount(space,'fort') > 0
const styleMarker = (state,id,side) => state.markers[id]?.side === side
const settleTwice = (state,faction) => styleMarker(state,45,'shaded') && (state.markers[45].faction ?? 'x') === faction
const militiaMultiplier = state => state.markers[4] ? 2 : 1

function canShareBlue(state) {
  return state.imperium === 'ac' && !isHumanFaction(state,'c') && scores(state).d.margin < scores(state).c.margin
}

function flag(value) {
  return value === true || value === '1' || value === 'on' || value === 'yes'
}

function int(value,label,max=80) {
  const n = value === '' || value == null ? 0 : typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  ensure(inRange(n,0,max), `${label} must be a whole number between 0 and ${max}.`)
  return n
}

function countRemoval(space,group,count,wanted) {
  ensure(count <= on(space,group), `There are not enough ${groupLabel(group)}.`)
  const carried = loaded(space,group)
  const plunder = wanted == null || wanted === '' ? Math.max(0,count-(on(space,group)-carried)) : int(wanted,'Plunder',count)
  ensure(plunder <= carried && count-plunder <= on(space,group)-carried, `Choose a legal Plunder count for ${groupLabel(group)}.`)
  space.units[group][0] -= count
  space.units[group][1] -= plunder
  return plunder
}

const troopAlias = { cavalry:'cav', militia:'mil', comitates:'com', saxons:'xw', scotti:'sw' }
function knownTroop(value) {
  const name = value.toLowerCase()
  const key = troopAlias[name] || name
  ensure(Object.hasOwn(GROUP,key),'Use a unit name or a valid troop group code.')
  return key
}

function recycleEntries(value,faction,command,feat) {
  if (!value) return []
  const permitted = new Set([
    ...(command === 'Train' ? ['cav'] : command === 'Muster' ? ['mil','com'] : feat === 'Reinforce' ? ['mil'] : []),
    ...(feat === 'Invite' ? [faction+'xw',faction+'sw'] : []),
    ...(feat === 'Settle' ? [faction+'w'] : feat === 'Entreat' ? ['sw'] : []),
  ])
  return value.split(/[,;]+/).map(entry => {
    const match = entry.trim().match(/^([a-z]+)@([^=]+)=(\d+)$/i)
    ensure(match,'Enter recycling in the form cavalry@Carvetii=2.')
    const group = knownTroop(match[1])
    const name = match[2].trim()
    const rest = int(match[3],'Units to recycle',30)
    ensure(found(name) && rest && permitted.has(group),'Choose an existing space and a unit type this action may place.')
    return {group,name,rest}
  })
}

function placeFromStock(state,name,key,count,recycle,journal) {
  if (!count) return
  const physical = GROUP[key].piece
  let remaining = count
  const fromStock = Math.min(count,availability(state)[physical])
  state.land[name].units[key][0] += fromStock
  remaining -= fromStock
  for (const entry of recycle) {
    if (!remaining || entry.group !== key || !entry.rest) continue
    ensure(entry.name !== name,'Recycle units from a space other than their destination.')
    const take = Math.min(entry.rest,remaining)
    countRemoval(state.land[entry.name],key,take)
    state.land[name].units[key][0] += take
    entry.rest -= take
    remaining -= take
    journal.push(`Recycled ${take} ${groupLabel(key)} from ${entry.name}`)
  }
  ensure(!remaining,`There are not enough Available ${groupLabel(key)} for ${name}. You may specify same-type units to recycle.`)
}

function setPieceAt(state,name,index,piece,employer=null) {
  const site = BY_NAME[name].sites[index]
  ensure(site && (piece !== 'town' || site.type === 'T') && (piece !== 'hill' || !isCity(name)), `That Stronghold cannot occupy the selected site in ${name}.`)
  ensure(availability(state)[piece] > 0, `There is no Available ${PIECES[piece]}.`)
  state.land[name].sites[index] = {piece,employer}
}

function findSite(name,space,value,predicate,label) {
  const sites = BY_NAME[name].sites
  const vacant = sites.findIndex((site,i) => !space.sites[i] && predicate(site,null))
  const chosen = value === '' || value == null ? (vacant >= 0 ? vacant : sites.findIndex((site,i) => predicate(site,space.sites[i]))) : int(value,label,sites.length-1)
  ensure(chosen >= 0 && predicate(sites[chosen],space.sites[chosen]), `${name} needs ${label}.`)
  return chosen
}

function checkCommandContext(state,faction,command,feat,options) {
  ensure(COMMANDS[faction]?.includes(command), `${NAMES[faction] || 'That faction'} cannot execute ${command}.`)
  ensure(!feat || FEATS[faction]?.[command]?.includes(feat) && featOwners[feat]?.includes(faction), `${feat || 'The Feat'} does not accompany ${command} for this faction.`)
  ensure(!feat || !options.limited || options.allowFeat === true, 'A Limited Command does not include a Feat.')
  ensure(!feat || !options.free || options.allowFeat === true, 'A Free Command needs an explicit grant to include a Feat.')
  if (feat === 'Invite') ensure(!isFragmentation(state),'Invite is unavailable at Fragmentation.')
}

function hasMajority(state,space,faction,cooperate=true) {
  const counts = piecesByOwner(space)
  const own = counts[faction]
  const ally = cooperate && briton(faction) && !isFragmentation(state) ? counts[otherBriton(faction)] : 0
  return (own+ally)*2 > sum(Object.values(counts))
}

export function commandEconomy(state,faction,options,input) {
  let blue = faction === 'd' && input.blueSpend !== '' && input.blueSpend != null ? int(input.blueSpend,'Dux blue Resources') : null
  let wealth = faction === 'c' && input.wealthSpend !== '' && input.wealthSpend != null ? int(input.wealthSpend,'Wealth as Resources') : null
  const permittedBlue = preemption(state) || state.imperium === 'ac' &&
    (isHumanFaction(state,'c') ? flag(input.blueConsent) || options.blueConsent === true : canShareBlue(state))
  ensure(blue === null || blue === 0 || permittedBlue, 'Dux needs Civitates consent to spend blue Resources here.')
  return {
    get remainingBlue() { return blue },
    spend(cost,preserveWealth=0) {
      if (options.free) return
      if (faction === 'd') {
        const bluePay = permittedBlue ? Math.min(cost,state.tracks.blue,blue ?? cost) : 0
        ensure(state.tracks.red >= cost-bluePay, 'Dux cannot afford the selected costs with the permitted Resources.')
        state.tracks.red -= cost-bluePay
        state.tracks.blue -= bluePay
        if (blue !== null) blue -= bluePay
      } else if (faction === 'c') {
        const availableWealth = Math.max(0,state.tracks.wealth-preserveWealth)
        const wealthPay = wealth === null ? Math.max(0,cost-state.tracks.blue) : Math.min(cost,wealth,availableWealth)
        ensure(wealthPay <= availableWealth && cost-wealthPay <= state.tracks.blue, 'Civitates cannot afford the selected Resources and Wealth.')
        state.tracks.wealth -= wealthPay
        state.tracks.blue -= cost-wealthPay
        if (wealth !== null) wealth -= wealthPay
      } else {
        ensure(state.tracks[faction] >= cost, `${NAMES[faction]} cannot afford the selected Renown costs.`)
        state.tracks[faction] -= cost
      }
    }
  }
}

const choose = (key,label,options,def='',required=false) => ({key,label,type:'select',options,default:def,required})
const qty = (key,label,max=30,min=0,def='0') => ({key,label,type:'number',min,max,default:def,required:false})
const box = (key,label) => ({key,label,type:'check',default:false})
const line = (key,label,placeholder='') => ({key,label,type:'text',default:'',placeholder})
const spaces = (allow=() => true) => REGIONS.filter(r => allow(r.name)).map(({name}) => [name,name])
const selectList = entries => [['','Choose…'],...entries]
const spaceField = (label='Space',list=spaces()) => choose('space',label,selectList(list),'',true)
const siteField = (key,label) => choose(key,label,[['','First legal site'],['0','First printed site'],['1','Second printed site']])
const canUseAllies = (state,faction) => briton(faction) && !isFragmentation(state) &&
  (!isHumanFaction(state,faction) || isHumanFaction(state,otherBriton(faction)))

export function duxPaymentFields(state,options) {
  if (options.free || isFragmentation(state)) return []
  const fields = [qty('blueSpend','Maximum blue Resources (blank = use blue first)',80,0,'')]
  if (state.imperium === 'ac' && isHumanFaction(state,'c')) fields.push(box('blueConsent','Civitates agrees to blue Resources'))
  return fields
}

function rowSet(rows,minRows,maxRows,help) {
  return { rows,minRows,maxRows,help }
}

export function commandFeatFields(state,faction,command,feat,options={}) {
  if (!feat || !featOwners[feat]?.includes(faction) || !FEATS[faction]?.[command]?.includes(feat)) return null
  if ((options.limited || options.free) && options.allowFeat !== true) return null
  switch (feat) {
    case 'Build':
      return rowSet([spaceField(),choose('mode','Build',[['fort','Fort'],['town','Town from two Militia'],['replace','Town from a Hillfort and Militia']],'fort',true),siteField('site','Stronghold site'),siteField('hillSite','Hillfort site if replacing')],1,REGIONS.length,'Each site requires Cavalry and a friendly majority. Build costs 3 Resources per space.')
    case 'Invite':
      if (isFragmentation(state)) return null
      return rowSet([spaceField(),choose('nation','Nationality',[['x','Saxons'],['s','Scotti']],'x',true),choose('mode','Invite',[['new','Place a new Foederati Settlement'],['convert','Convert the other Briton’s Foederati']],'new',true),siteField('site','Settlement site'),qty('bands','New Warbands',3)],1,1,'Invite in a space with your piece and Briton Control. Converting changes every matching Foederati Warband and Settlement in that space.')
    case 'Pillage':
      return rowSet([spaceField('Region',spaces(name => !isCity(name))),choose('enemy','Stronghold owner to penalize',[['','Automatic if one enemy'],['d','Dux'],['x','Saxons'],['s','Scotti']]),...ownerTroops.c.map(key => qty('loot-'+key,`Plunder on ${groupLabel(key)}`,30,0,''))],1,REGIONS.length,'Pillage in Regions without Briton Control. Leave all Plunder fields blank to fill available carrying capacity in unit order.')
    case 'Reinforce': {
      const groups = [...ownerTroops.c,...(canUseAllies(state,faction) ? ownerTroops.d : [])]
      return rowSet([
        spaceField('Reinforce space'),choose('mode','Reinforce',[['muster','Muster Militia here'],['move','Move troops to adjacent Battles']],'muster',true),
        choose('destination','Battle destination for moving troops',selectList(spaces())),
        line('formation','Optional movement split','e.g. Dobunni mil=2 com=1:1; Silures cxw=1'),
        ...groups.flatMap(group => [qty(group,groupLabel(group),30,0,''),qty(group+'p',`Plunder on ${groupLabel(group)} (optional)`,30,0,'')]),
      ],1,REGIONS.length,'Each Reinforce space costs 2 Resources. Muster in a Battle space or roll D6−2 to send troops to adjacent Battle spaces. Counts indicate preference and are capped by the roll.')
    }
    case 'Requisition':
      return rowSet([spaceField()],0,6,'Select up to six spaces with a Dux piece and a Civitates Stronghold. Dux Plunder anywhere converts to Dux Resources even with zero selected spaces.')
    case 'Rule':
      return rowSet([spaceField(),choose('mode','Rule',[['wealth','Convert Resources to Wealth'],['prestige','Reduce Dux Prestige'],['population','Settle a Refugee']],'wealth',true)],1,3,'Choose a mode in each of up to three spaces with Briton Control. Civitates Plunder there is converted to Wealth first.')
    case 'Settle':
      return rowSet([spaceField(),choose('mode','After any Raider rolls',[['none','Raider rolls only'],['recruit','Pay 3 Renown to recruit'],['settlement','Found a Settlement'],...(faction === 'x' ? [['population','Add Population'],['both','Found a Settlement and add Population']] : [])],'none',true),siteField('site','Settlement site'),qty('bands','Warbands to recruit (blank = maximum)',25,0,''),line('raiders','Returning Raiders for this space','Blank = automatic; e.g. Dobunni=2, Parisi')],1,settleTwice(state,faction) ? 2 : 1,'Settle where your pieces outnumber everyone else. For Thanet, count each Raider once. Use comma-separated origins, optionally with =count when splitting an origin.')
    case 'Entreat':
      return rowSet([spaceField('Hills Region',spaces(name => BY_NAME[name].terrain === 'Hills')),box('settlement','Replace a Hillfort with a Settlement'),siteField('site','Hillfort site'),qty('bands','Militia to replace',2)],1,1,'Pay 4 Renown to replace pieces in a Hills Region with a Scotti Warband. Pieces without an available replacement stay in place.')
    default:
      return null
  }
}

export function commandFields(state,faction,command,feat,options={}) {
  if (!CALCULATED_COMMANDS.includes(command) || !COMMANDS[faction]?.includes(command)) return null
  const featFields = commandFeatFields(state,faction,command,feat,options)
  if (feat && !featFields) return null
  const cap = options.limited ? 1 : Math.min(options.spaceLimit ?? REGIONS.length,REGIONS.length)
  const fields = faction === 'd' ? duxPaymentFields(state,options) : []
  if (faction === 'c' && !options.free) fields.push(qty('wealthSpend','Wealth to use as Resources (blank = blue first)',80,0,''))
  if (feat && command !== 'Return') fields.push(box('featBefore',`Resolve ${feat} before the Command`))
  if (command === 'Train' || command === 'Muster' || feat === 'Invite' || feat === 'Settle' || feat === 'Entreat') {
    const example = command === 'Train' ? 'cavalry@Carvetii=2' : command === 'Muster' ? 'militia@Dobunni=1' :
      feat === 'Invite' ? (faction === 'd' ? 'dxw' : 'cxw')+'@Dobunni=1' : faction+'w@Dumnonii=1'
    fields.push(line('recycle','Recycle units when supply is exhausted','Optional: '+example))
  }
  let spec
  switch (command) {
    case 'Train':
      spec = rowSet([spaceField(),qty('cavalry','Cavalry',4),qty('militia','Militia',4),box('restore','Restore Prosperity')],1,cap,'Train where a Fort or friendly Control is present. Placing troops costs 3 Resources and restoring Prosperity costs 2 more in up to two spaces.')
      break
    case 'Muster':
      spec = rowSet([spaceField(),choose('mode','Muster',[['troops','Place Troops'],['hill','Build a Hillfort'],['town','Replace two Militia with a Town'],['replace','Replace Militia and Hillfort with a Town'],['both','Build a Hillfort and Town'],['bothReplace','Build a Hillfort, then replace a Hillfort for a Town']],'troops',true),qty('militia','Militia',12),qty('comitates','Comitates',6),siteField('site','New Stronghold site'),siteField('newHillSite','New Hillfort site when placing both'),siteField('hillSite','Existing Hillfort site if replacing')],1,cap,'Each Muster space needs a Civitates piece. One row can place Troops or build Strongholds.')
      break
    case 'Trade':
      if (!options.limited && !options.free && options.spaceLimit == null) fields.push(box('tradeAll','Trade in every Town space'))
      spec = rowSet([spaceField('Town space',spaces(name => siteCount(state.land[name],'town') > 0)),box('restore','Restore Prosperity')],!options.limited && options.spaceLimit == null ? 0 : 1,cap,'Town spaces earn 1 Briton Resource per Town. Optional restoration costs 1 Resource in up to two selected spaces with Briton Control.')
      break
    case 'March': {
      const groups = [...ownerTroops[faction],...(canUseAllies(state,faction) ? ownerTroops[otherBriton(faction)] : [])]
      if (canUseAllies(state,faction)) fields.push(box('alliedConsent','Other Briton faction agrees to this march'))
      spec = rowSet([
        choose('origin','Origin',selectList(spaces()),'',true),
        choose('destination','Destination (blank = no movement)',selectList(spaces())),
        ...(briton(faction) ? [line('via','Road waypoints','Optional comma-separated space names')] : []),
        ...(!briton(faction) || faction === 'd' && styleMarker(state,60,'unshaded') ? [box('sea','Move by sea')] : []),
        ...(briton(faction) ? [line('logistics','Road pickup / drop-off','Optional: Dobunni +com=1 -mil=2')] : []),
        ...groups.flatMap(key => [qty(key,groupLabel(key)),qty(key+'p',`Plunder with ${groupLabel(key)} (optional)`,30,0,'')]),
      ],1,Math.max(cap,Math.min(60,sum(Object.values(state.land).flatMap(space => groups.map(group => on(space,group)))))),
      briton(faction) ? 'Pay per origin or pickup. The route stops on leaving a maintained Road or entering an uncontrolled space. Split groups into rows for each route. Waypoint logistics use Dobunni +com=1 -mil=2. Separate spaces with a semicolon. Add :1 after a count to include one loaded unit.' :
        'Pay per destination, including arrivals from multiple origins. Once per March, one group may cross a shared sea to a coastal Region with no Dux Fort.')
      break
    }
    case 'Return':
      spec = rowSet([spaceField('Return space',spaces(name => on(state.land[name],faction+'r') + on(state.land[name],faction+'w') > 0))],1,cap,'Convert all Plunder carried by your Raiders and Warbands in each selected space to Renown. Remove the Raiders.')
      break
  }
  return { ...spec,controls:fields,featFields }
}

function uniqueSpaces(rows,label='Space') {
  ensure(rows.every(row => row && found(row.space)),`Select a valid ${label.toLowerCase()} in each row.`)
  const names = rows.map(row => row.space)
  ensure(new Set(names).size === names.length,`Select each ${label.toLowerCase()} only once.`)
  return names
}

function trainCommand(state,rows,{spend,options,recycle},journal) {
  const placements = rows.map(row => {
    const {space:name} = row
    const space = state.land[name]
    const cavalry = int(row.cavalry,'Cavalry',4)
    const militia = int(row.militia,'Militia',4)
    const restore = flag(row.restore)
    ensure(hasDuxForts(space) || friendlyControl(state,name,'d'), `Dux can Train in ${name} only with a Fort or friendly Control.`)
    ensure(cavalry <= siteCount(space,'fort')*(styleMarker(state,2,'unshaded') ? 2 : 1), `Check the Cavalry limit per Fort in ${name}.`)
    ensure(!militia || militia <= 2*militiaMultiplier(state) && siteCount(space,'town') + siteCount(space,'hill') > 0,`Check the Militia limit and the Town or Hillfort in ${name}.`)
    ensure(!options.troopsOnly || !restore,'The Event grants Train for Troops only.')
    return {name,cavalry,militia,restore}
  })
  ensure(placements.filter(row => row.restore).length <= 2,'Train restores Prosperity in at most two spaces.')
  spend(sum(placements.map(row => (row.cavalry || row.militia ? 3 : 0) + (row.restore ? 2 : 0))))
  for (const {name,cavalry,militia} of placements) {
    placeFromStock(state,name,'cav',cavalry,recycle,journal)
    placeFromStock(state,name,'mil',militia,recycle,journal)
    if (cavalry || militia) journal.push(`${name} +${cavalry} Cavalry, +${militia} Militia`)
  }
  for (const {name,restore} of placements) {
    if (!restore) continue
    const space = state.land[name]
    ensure(friendlyControl(state,name,'d') && (hasDuxForts(space) || on(space,'cav')), `Restoring ${name} requires friendly Control and a Fort or Cavalry.`)
    journal.push(`${name} +${addProsperity(state,name,space.pop)} Prosperity`)
  }
  if (!journal.length) journal.push('Train selected without adding Troops or Prosperity')
}

function townReplacement(state,name,row,replaceHill) {
  const space = state.land[name]
  const removeMilitia = replaceHill ? 1 : 2
  ensure(on(space,'mil') >= removeMilitia,`Replacing pieces with a Town in ${name} needs ${removeMilitia} Militia.`)
  const hillIndex = replaceHill ? findSite(name,space,row.hillSite,(site,occupant) => occupant?.piece === 'hill','a Hillfort to replace') : -1
  const hillAtTownSite = hillIndex !== -1 && BY_NAME[name].sites[hillIndex].type === 'T'
  const townIndex = findSite(name,space,row.site,(site,occupant) => site.type === 'T' && (!occupant || hillAtTownSite && occupant === space.sites[hillIndex]),'a vacant Town Site')
  countRemoval(space,'mil',removeMilitia)
  if (hillIndex !== -1) space.sites[hillIndex] = null
  setPieceAt(state,name,townIndex,'town')
}

function musterCommand(state,rows,{spend,options,recycle},journal) {
  const modes = new Set(['troops','hill','town','replace','both','bothReplace'])
  const initialControl = new Map(rows.map(({space}) => [space,friendlyControl(state,space,'c')]))
  const placements = rows.map(row => {
    const name = row.space
    const space = state.land[name]
    ensure(groupForces(space,'c') > 0,`Muster in ${name} requires a Civitates piece.`)
    const mode = row.mode || 'troops'
    ensure(modes.has(mode), 'Choose a valid Muster operation.')
    ensure(!options.troopsOnly || mode === 'troops','The Event grants Muster for Troops only.')
    const militia = int(row.militia,'Militia',12)
    const comitates = int(row.comitates,'Comitates',6)
    const capacity = siteCount(space,'town') + siteCount(space,'hill') + (initialControl.get(name) ? space.pop : 0)
    if (mode === 'troops') ensure(militia + comitates > 0 && Math.ceil(militia/militiaMultiplier(state)) + comitates <= capacity,`Check the Muster capacity of ${capacity} in ${name}.`)
    else ensure(hasMajority(state,space,'c'),`A friendly majority including Raiders is required to build in ${name}.`)
    return {row,mode,militia,comitates,wealth:mode === 'troops' ? comitates : mode === 'hill' ? 0 : 2}
  })
  const wealth = sum(placements.map(p => p.wealth))
  ensure(state.tracks.wealth >= wealth,'Civitates does not have the additional Wealth that Muster requires.')
  spend(2*rows.length,wealth)
  for (const {row,mode,militia,comitates,wealth} of placements) {
    const name = row.space
    const space = state.land[name]
    state.tracks.wealth -= wealth
    if (mode === 'troops') {
      placeFromStock(state,name,'mil',militia,recycle,journal)
      placeFromStock(state,name,'com',comitates,recycle,journal)
      journal.push(`${name} +${militia} Militia, +${comitates} Comitates`)
      continue
    }
    if (['hill','both','bothReplace'].includes(mode)) {
      ensure(!isCity(name) && on(space,'mil') > 0,`A Hillfort in ${name} requires a Region and Militia.`)
      const index = findSite(name,space,mode === 'hill' ? row.site : row.newHillSite,(site,occupant) => !occupant,'a vacant Hillfort or Town Site')
      setPieceAt(state,name,index,'hill')
      countRemoval(space,'mil',1)
      journal.push(`${name} +1 Hillfort`)
    }
    if (mode !== 'hill') {
      townReplacement(state,name,row,mode === 'replace' || mode === 'bothReplace')
      journal.push(`${name} +1 Town`)
    }
  }
}

function tradeCommand(state,rows,{spend,input,options},journal) {
  ensure(!flag(input.tradeAll) || (!options.limited && options.spaceLimit == null) || options.tradeAll === true,'This Command cannot Trade in all Town spaces.')
  const selected = (flag(input.tradeAll) || options.tradeAll || !rows.length) ? REGIONS.filter(({name}) => siteCount(state.land[name],'town') > 0).map(({name}) => name) : rows.map(row => row.space)
  ensure(selected.length && selected.every(name => siteCount(state.land[name],'town')), 'Each Trade space needs a Town.')
  const restorable = rows.filter(row => flag(row.restore)).map(row => row.space)
  ensure(restorable.length <= 2 && restorable.every(name => selected.includes(name) && friendlyControl(state,name,'c')), 'Restore in up to two selected Trade spaces with Briton Control.')
  const resources = state.tracks.blue
  changeTrack(state,'blue',sum(selected.map(name => siteCount(state.land[name],'town'))))
  journal.push(`+${state.tracks.blue-resources} Briton Resources from ${selected.length} Town spaces`)
  spend(restorable.length)
  for (const name of restorable) journal.push(`${name} +${addProsperity(state,name,state.land[name].pop)} Prosperity`)
}

function roadAdjacent(a,b) {
  return ROADS.some(([from,to]) => from === a && to === b || from === b && to === a)
}

function roadWaypoints(value) {
  return Array.isArray(value) ? value : (value || '').split(/[,>]+/).map(name => name.trim()).filter(Boolean)
}

function validateMarchRoute(state,route,faction,sea,initialControl) {
  ensure(route.every(found) && new Set(route).size === route.length,'Check the March route for unknown, repeated, or identical spaces.')
  const [origin,destination] = [route[0],route.at(-1)]
  if (sea && briton(faction)) {
    ensure(faction === 'd' && styleMarker(state,60,'unshaded') && route.length === 2 && BY_NAME[origin].seas.length && BY_NAME[destination].seas.length, 'Only Dux with Mariners by Sea can move directly between two coastal spaces in this way.')
  } else if (sea) {
    ensure(!isCity(origin) && !isCity(destination) && route.length === 2 && BY_NAME[origin].seas.some(sea => BY_NAME[destination].seas.includes(sea)) && !hasDuxForts(state.land[destination]), 'Sea March requires two Regions on the same sea and no Dux Fort at the destination.')
  } else {
    ensure(briton(faction) || route.length === 2, 'Barbarian Warbands move once to an adjacent destination.')
    for (let index=1;index<route.length;index++) {
      const from = route[index-1]
      const to = route[index]
      ensure(BY_NAME[from].adj.includes(to),`${from} and ${to} are not adjacent.`)
      if (index<route.length-1) ensure(state.roads && roadAdjacent(from,to) && initialControl.has(to),`A March Route must stop when it leaves a maintained Road or enters a space without Control at the outset (${to}).`)
      if (index>1) ensure(!isCity(to),`After the first move the group must continue into a Region, so it cannot enter ${to} via that route.`)
    }
  }
}

function marchLogistics(value,route,groups) {
  const edits = new Map()
  if (!value) return edits
  for (const entry of value.split(';').map(line => line.trim()).filter(Boolean)) {
    const match = entry.match(/^([a-z]+)\s+(.*)$/i)
    ensure(match && route.slice(1,-1).includes(match[1]),'Pickup and drop-off entries must name a Road waypoint.')
    const [,name,spec] = match
    ensure(!edits.has(name),'Enter each logistics waypoint at most once per row.')
    const parsed = spec.trim().split(/\s+/).map(token => {
      const op = token.match(/^([+-])([a-z]+)=(\d+)(?::(\d+))?$/i)
      ensure(op,'Use e.g. Dobunni +com=1 -mil=2:1 for advanced March logistics.')
      const [,sign,id,amount,plunder] = op
      const group = knownTroop(id)
      ensure(groups.includes(group),'The selected Troop group cannot take part in this March.')
      const count = int(amount,'March Troops',30)
      ensure(count > 0 && (plunder == null || int(plunder,'March Plunder',count) <= count),'Choose a positive legal troop count.')
      return {pickup:sign === '+',group,count,plunder}
    })
    edits.set(name,parsed)
  }
  return edits
}

function movingMarchForces(state,leg,arrivals,owner) {
  const {origin,destination,counts,route,logistics,row} = leg
  const moving = Object.fromEntries(Object.keys(counts).map(key => [key,[0,0]]))
  const force = {units:moving}
  for (const group of Object.keys(counts)) {
    const count = counts[group]
    if (count) moving[group] = [count,countRemoval(state.land[origin],group,count,row[group+'p'])]
  }
  const hasOwnTroop = () => ownerTroops[owner].some(group => on(force,group)>0)
  const addArrivals = name => {
    for (const [group,[count,plunder]] of Object.entries(moving)) {
      if (count) arrivals.push({destination:name,group,count,plunder})
    }
  }
  for (const name of route.slice(1,-1)) {
    const edits = logistics.get(name) || []
    for (const {group,count,plunder} of edits.filter(entry => !entry.pickup)) {
      arrivals.push({destination:name,group,count,plunder:countRemoval(force,group,count,plunder)})
    }
    ensure(!moving.mil?.[0],'Militia cannot march more than one space. Drop them off at the first waypoint.')
    for (const {group,count,plunder} of edits.filter(entry => entry.pickup)) {
      const cargo = countRemoval(state.land[name],group,count,plunder)
      moving[group][0] += count
      moving[group][1] += cargo
    }
    ensure(hasOwnTroop(),'A group continuing from a waypoint must retain at least one Troop of the executing faction.')
  }
  addArrivals(destination)
}

function marchCommand(state,rows,{faction,spend,options,input},journal) {
  const isBriton = briton(faction)
  const ally = isBriton ? otherBriton(faction) : null
  const allowAllies = ally && canUseAllies(state,faction) && (flag(input.alliedConsent) || options.alliedConsent === true)
  const groups = [...ownerTroops[faction],...(allowAllies ? ownerTroops[ally] : [])]
  const initialControl = new Set(REGIONS.filter(({name}) => friendlyControl(state,name,faction)).map(r => r.name))
  const legs = rows.map(row => {
    const origin = row.origin
    const destination = row.destination || null
    const sea = flag(row.sea)
    ensure(found(origin) && (!destination || found(destination)),'Select a valid March origin and destination.')
    if (options.regionsOnly) ensure(!destination || !isCity(destination),'This Event grants March into Regions only.')
    const space = state.land[origin]
    const counts = Object.fromEntries(groups.map(group => [group,int(row[group],groupLabel(group),30)]))
    const ownTroops = sum(ownerTroops[faction].map(group => counts[group]))
    const route = destination ? [origin,...roadWaypoints(row.via),destination] : [origin]
    if (ally && !allowAllies) ensure(ownerTroops[ally].every(group => !int(row[group],groupLabel(group),30)), 'Moving the other Briton’s Troops requires their agreement.')
    ensure(ownerTroops[faction].some(group => on(space,group)),`A ${NAMES[faction]} Troop is required in ${origin}.`)
    const logistics = marchLogistics(row.logistics,route,groups)
    if (destination) {
      ensure(ownTroops > 0,`The group from ${origin} needs at least one ${NAMES[faction]} Troop.`)
      validateMarchRoute(state,route,faction,sea,initialControl)
    } else {
      ensure(isBriton && !sea && !row.via && ownTroops === 0 && !sum(Object.values(counts)),'An empty March may select only a Briton origin. Remove any route or Troop entries from that row.')
    }
    return {origin,destination,sea,counts,row,route,logistics}
  })
  ensure(legs.filter(leg => leg.sea).length <= 1,'A March may include no more than one sea movement.')
  const targetNames = new Set(legs.flatMap(leg => isBriton ? [leg.origin,...[...leg.logistics].filter(([,edits]) => edits.some(entry => entry.pickup)).map(([name]) => name)] : [leg.destination]))
  const limit = options.limited ? 1 : options.spaceLimit ?? REGIONS.length
  const countedNames = options.limitDestinations ? new Set(legs.map(leg => leg.destination).filter(Boolean)) : targetNames
  ensure(countedNames.size <= limit,`This March may select up to ${limit} ${isBriton && !options.limitDestinations ? 'origin' : 'destination'} space(s).`)
  const costs = isBriton ? targetNames.size*2 : sum([...targetNames].map(name => legs.some(leg => leg.destination === name && leg.sea) ? 2 : 1))
  spend(costs*(options.costMultiplier ?? 1))

  // Arrivals cannot be drawn into another March group. All withdrawals come from the starting position.
  const arrivals = []
  for (const leg of legs) {
    if (!leg.destination) {
      journal.push(`Selected ${leg.origin} without movement`)
      continue
    }
    movingMarchForces(state,leg,arrivals,faction)
    const unitText = Object.entries(leg.counts).filter(([,count]) => count).map(([group,count]) => `${count} ${groupLabel(group)}`)
    journal.push(`${leg.route.join(' → ')} (${unitText.join(', ')}${leg.logistics.size ? ', plus waypoint logistics' : ''})`)
  }
  for (const {destination,group,count,plunder} of arrivals) {
    state.land[destination].units[group][0] += count
    state.land[destination].units[group][1] += plunder
  }
  if (options.limitDestinations) {
    const arrived = new Set(arrivals.map(unit => unit.destination))
    ensure(arrived.size <= limit && (!options.regionsOnly || [...arrived].every(name => !isCity(name))), 'End March movement in the granted Regions only.')
  }
  options.onArrival?.(arrivals.map(({destination}) => destination))
}

function returnCommand(state,rows,faction,journal,part='all') {
  const groups = [faction+'r',faction+'w']
  for (const {space:name} of rows) {
    const space = state.land[name]
    if (part !== 'remove') {
      ensure(groups.some(group => on(space,group)),`There are no ${NAMES[faction]} Raiders or Warbands to Return from ${name}.`)
      const renown = sum(groups.map(group => loaded(space,group)))
      for (const group of groups) space.units[group][1] = 0
      changeTrack(state,faction,renown)
      journal.push(`${name}: ${on(space,groups[0])} Raiders return, +${renown} Renown`)
    }
    if (part !== 'stow') space.units[groups[0]][0] = 0
  }
}

function buildFeat(state,rows,{spend},journal) {
  spend(3*rows.length)
  for (const row of rows) {
    const name = row.space
    const space = state.land[name]
    ensure(on(space,'cav') > 0 && hasMajority(state,space,'d'), `Build in ${name} requires Cavalry and a friendly majority including Raiders.`)
    const mode = row.mode || 'fort'
    if (mode === 'fort') {
      const index = findSite(name,space,row.site,(site,occupant) => !occupant,'a vacant Stronghold Site')
      setPieceAt(state,name,index,'fort')
      if (styleMarker(state,7,'shaded')) countRemoval(space,'cav',1)
      journal.push(`${name} +1 Fort`)
    } else {
      ensure(mode === 'town' || mode === 'replace','Choose a valid Build operation.')
      townReplacement(state,name,row,mode === 'replace')
      changeTrack(state,'prestige',2)
      journal.push(`${name} +1 Town, +2 Prestige`)
    }
  }
}
function inviteFeat(state,[row],{faction,spend,recycle},journal) {
  const name = row.space
  const space = state.land[name]
  ensure(!isFragmentation(state) && friendlyControl(state,name,faction) && groupForces(space,faction),`Invite at ${name} needs your piece and Briton Control before Fragmentation.`)
  const nation = row.nation
  ensure(nation === 'x' || nation === 's','Choose the nationality of the Foederati.')
  const piece = nation+'s'
  const group = faction+nation+'w'
  if (row.mode === 'convert') {
    const ally = otherBriton(faction)
    const from = ally+nation+'w'
    const bands = on(space,from)
    const settlements = space.sites.filter(site => site?.piece === piece && site.employer === ally)
    const total = bands+settlements.length
    ensure(total > 0,`There are no ${NAMES[nation]} Foederati of the other Briton to convert at ${name}.`)
    spend(total)
    space.units[group][0] += bands
    space.units[group][1] += loaded(space,from)
    space.units[from] = [0,0]
    for (const site of settlements) site.employer = faction
    journal.push(`${name}: converted ${total} ${NAMES[nation]} Foederati`)
    return
  }
  ensure(!row.mode || row.mode === 'new','Choose a valid Invite operation.')
  ensure(!isCity(name),'A new Foederati Settlement from Invite requires a Region.')
  const replacement = faction === 'd' ? 'fort' : 'hill'
  const index = findSite(name,space,row.site,(site,occupant) => !occupant || occupant.piece === replacement,`a vacant site or existing ${PIECES[replacement]}`)
  const number = int(row.bands,'New Warbands',nation === 'x' ? 3 : 2)
  setPieceAt(state,name,index,piece,faction)
  placeFromStock(state,name,group,number,recycle,journal)
  journal.push(`${name}: invited 1 Settlement and ${number} Warbands as ${NAMES[nation]} Foederati`)
}
function reinforceColumns(state,rows,context) {
  const {faction,input,options,battleSpaces} = context
  ensure(Array.isArray(battleSpaces) && battleSpaces.length > 0 && battleSpaces.every(found), 'Reinforce needs preselected Battle spaces.')
  const allies = canUseAllies(state,faction) && (flag(input.alliedConsent) || options.alliedConsent === true)
  const allowedGroups = [...ownerTroops.c,...(allies ? ownerTroops.d : [])]
  return rows.map(row => {
    const name = row.space
    const space = state.land[name]
    const battlesHereOrNearby = battleSpaces.filter(target => target === name || BY_NAME[name].adj.includes(target))
    ensure(battleSpaces.includes(name) || battlesHereOrNearby.length && friendlyControl(state,name,'c'),`Reinforce requires a Battle space or adjacent Briton Control in ${name}.`)
    if (!row.mode || row.mode === 'muster') {
      ensure(battleSpaces.includes(name),'Reinforce can Muster Militia only in a Battle space.')
      const base = siteCount(space,'town') + siteCount(space,'hill') + (friendlyControl(state,name,'c') ? space.pop : 0)
      const capacity = base*militiaMultiplier(state)
      const explicit = row.mil !== '' && row.mil != null
      const count = explicit ? int(row.mil,'Militia',12) : null
      ensure(count == null || count > 0 && count <= capacity,`Check the Reinforce Muster limit of ${capacity} Militia in ${name}.`)
      return {name,capacity,muster:count}
    }
    ensure(row.mode === 'move','Choose a valid Reinforce operation.')
    if (!allies) ensure(ownerTroops.d.every(group => !int(row[group],groupLabel(group),30)),'The Dux must agree before red troops Reinforce.')
    const requested = row.formation ? row.formation.split(';').flatMap(line => {
      const parts = line.trim().split(/\s+/)
      const destination = parts.shift()
      ensure(parts.length > 0,'Reinforce formation entries need at least one Troop count.')
      return parts.map(part => {
        const match = part.match(/^([a-z]+)=(\d+)(?::(\d+))?$/i)
        ensure(match,'Use destination followed by troop=count, optionally troop=count:loaded.')
        return {destination,group:knownTroop(match[1]),count:int(match[2],'Reinforce Troops',30),plunder:match[3]}
      })
    }) : allowedGroups.map(group => ({
      destination:row.destination,group,count:row[group] === '' || row[group] == null
        ? on(space,group) : int(row[group],groupLabel(group),30),plunder:row[group+'p'],
    })).filter(entry => entry.count)
    ensure(requested.length > 0,'Choose at least one Troop to attempt Reinforce.')
    const source = clone(space)
    for (const entry of requested) {
      const {destination,group,count,plunder} = entry
      ensure(battleSpaces.includes(destination) && BY_NAME[name].adj.includes(destination),'Reinforce movement goes to an adjacent Battle space.')
      ensure(allowedGroups.includes(group) && count > 0,'Choose allowed Reinforce Troops and a positive count.')
      entry.carries = countRemoval(source,group,count,plunder)
    }
    return {name,requested}
  })
}

function reinforceFeat(state,rows,context,roll,journal) {
  const {spend,recycle,options} = context
  const choices = reinforceColumns(state,rows,context)
  spend(2*choices.length)
  const arrivals = []
  for (const {name,requested} of choices) {
    if (!requested) continue
    ensure(typeof roll === 'function','Reinforce movement requires a six-sided die roller.')
    const result = roll(6,`Reinforce · ${name}`)
    let left = Math.max(0,result-2+(options.reinforceBonus ?? 0))
    let moved = 0
    for (const {destination,group,count,carries} of requested) {
      const take = Math.min(count,left)
      if (!take) break
      const plunder = Math.min(carries,take)
      countRemoval(state.land[name],group,take,plunder)
      arrivals.push({destination,group,count:take,plunder})
      moved += take
      left -= take
    }
    journal.push(`${name}: rolled ${result}, reinforced with ${moved} Troops`)
  }
  // These troops never enter the Available box, even during a local Muster.
  for (const {destination,group,count,plunder} of arrivals) {
    state.land[destination].units[group][0] += count
    state.land[destination].units[group][1] += plunder
  }
  for (const {name,capacity,muster} of choices) {
    if (capacity == null) continue
    const count = muster ?? Math.min(capacity,availability(state).mil)
    ensure(count > 0,`There is no Militia Muster available in ${name}.`)
    placeFromStock(state,name,'mil',count,recycle,journal)
    journal.push(`${name} +${count} Reinforcement Militia`)
  }
}

function requisitionFeat(state,rows,context,journal) {
  let converted = 0
  for (const {space:name} of rows) {
    const space = state.land[name]
    ensure(groupForces(space,'d') && hasStronghold(space,['c']),`Requisition at ${name} requires a Dux piece and Civitates Stronghold.`)
    const from = state.tracks.blue > 0 ? 'blue' : 'wealth'
    const amount = state.tracks[from] > 0 ? 1 : 0
    state.tracks[from] -= amount
    converted += amount
  }
  for (const space of Object.values(state.land)) {
    for (const group of ownerTroops.d) {
      converted += loaded(space,group)
      space.units[group][1] = 0
    }
  }
  ensure(converted > 0,'Requisition needs Resources, Wealth, or loaded Dux units to transfer.')
  changeTrack(state,'red',converted)
  journal.push(`Converted ${converted} to Dux Resources`)
}
function ruleFeat(state,rows,{spend},journal) {
  for (const row of rows) {
    const name = row.space
    const space = state.land[name]
    ensure(friendlyControl(state,name,'c'),`Rule in ${name} needs Briton Control.`)
    const stashed = sum(ownerTroops.c.map(group => loaded(space,group)))
    for (const group of ownerTroops.c) space.units[group][1] = 0
    changeTrack(state,'wealth',stashed)
    if (stashed) journal.push(`${name}: stashed ${stashed} Plunder as Wealth`)
    switch (row.mode || 'wealth') {
      case 'wealth':
        ensure(state.tracks.blue >= 2,'Converting Resources to Wealth needs 2 blue Resources.')
        state.tracks.blue -= 2
        changeTrack(state,'wealth',1)
        journal.push(`${name} +1 Wealth`)
        break
      case 'prestige':
        ensure(!groupForces(space,'d') && state.tracks.wealth >= 1,`Reducing Prestige in ${name} requires Wealth and no Dux piece.`)
        state.tracks.wealth--
        changeTrack(state,'prestige',-1)
        journal.push(`${name} −1 Prestige`)
        break
      case 'population':
        ensure(!isCity(name) && hasStronghold(space,['c']) && state.tracks.refugees > 0 && space.pop < printedPopulation(state,name)+1,
          `Adding Population in ${name} needs a Civitates Stronghold, an available Refugee, and space below the Population limit.`)
        spend(5)
        state.tracks.refugees--
        space.pop++
        journal.push(`${name} +1 Population`)
        break
      default:
        throw new Error('Choose a valid Rule operation.')
    }
  }
}
function pillageFeat(state,rows,{faction},journal) {
  for (const row of rows) {
    const name = row.space
    const space = state.land[name]
    ensure(!isCity(name) && !friendlyControl(state,name,'c'),`Pillage in ${name} needs a Region without Briton Control.`)
    const groups = ownerTroops[faction]
    const wanted = groups.some(key => row['loot-'+key] !== '' && row['loot-'+key] != null)
    const room = Math.min(space.pop,space.pros[0]+space.pros[1])
    const portions = new Map()
    let remaining = room
    for (const group of groups) {
      const carry = on(space,group)-loaded(space,group)
      const gain = wanted ? int(row['loot-'+group],'Plunder',30) : Math.min(carry,remaining)
      ensure(gain <= carry && gain <= remaining,`There is not enough Plunder capacity or Prosperity in ${name}.`)
      remaining -= gain
      portions.set(group,gain)
    }
    const gain = room-remaining
    ensure(gain > 0,`${name} has no Pillage result to record.`)
    for (const [group,amount] of portions) plunderTo(space,group,amount)
    const foes = (isFragmentation(state) ? ['d','x','s'] : ['x','s']).filter(key => hasStronghold(space,[key]))
    if (foes.length) {
      const enemy = row.enemy || (foes.length === 1 ? foes[0] : null)
      ensure(foes.includes(enemy),`Choose which enemy Stronghold to target in ${name}.`)
      changeTrack(state,enemy === 'd' ? 'prestige' : enemy,-gain)
    }
    journal.push(`${name}: gained ${gain} Plunder`)
  }
}

function returningConnections(state,rows,faction) {
  return new Map(rows.map(({space}) => [space,on(state.land[space],faction+'r')]).filter(([,count]) => count > 0))
}

function settleFeat(state,rows,{faction,spend,returning,recycle},roll,journal) {
  const nationBand = faction+'w'
  const nationSite = faction+'s'
  const contexts = rows.map(row => {
    const space = state.land[row.space]
    ensure(hasMajority(state,space,faction,false),`Settle at ${row.space} requires your pieces to outnumber all others, including Raiders.`)
    return {row,wasControlled:friendlyControl(state,row.space,faction)}
  })
  const reservations = new Map()
  const allocated = new Map()
  const defaultClaims = []
  for (const {row} of contexts) {
    if (!row.raiders) {
      defaultClaims.push(row.space)
      continue
    }
    const origins = new Map()
    for (const value of roadWaypoints(row.raiders)) {
      const [rawName,rawCount] = value.split('=')
      const origin = rawName.trim()
      ensure(!origins.has(origin),'Enter each returning Raider origin only once per Settle space.')
      ensure(returning.has(origin) && (row.space === origin || BY_NAME[row.space].adj.includes(origin)),`${origin} is not a selected Return space in or adjacent to ${row.space}.`)
      const count = rawCount == null ? returning.get(origin) : int(rawCount,'Returning Raiders',30)
      const used = allocated.get(origin) || 0
      ensure(count && count+used <= returning.get(origin),'Returning Raiders may only be reserved once. Divide the origin count across the Settle spaces.')
      origins.set(origin,count)
      allocated.set(origin,count+used)
    }
    reservations.set(row.space,origins)
  }
  for (const name of defaultClaims) {
    const origins = new Map()
    for (const [origin,total] of returning) {
      const remaining = total-(allocated.get(origin) || 0)
      if (remaining && (origin === name || BY_NAME[name].adj.includes(origin))) {
        origins.set(origin,remaining)
        allocated.set(origin,total)
      }
    }
    reservations.set(name,origins)
  }
  for (const {row,wasControlled} of contexts) {
    const name = row.space
    const space = state.land[name]
    const claims = reservations.get(name)
    let matches = 0
    for (const [origin,count] of claims) {
      ensure(typeof roll === 'function','Settle requires a six-sided die roller.')
      for (let n=0;n<count;n++) if (roll(6,`Settle ${name} from ${origin}`) >= (faction === 'x' ? 4 : 5)) matches++
    }
    const supply = availability(state)[nationBand]+sum(recycle.filter(entry => entry.group === nationBand).map(entry => entry.rest))
    const rolled = Math.min(supply,matches)
    placeFromStock(state,name,nationBand,rolled,recycle,journal)
    const mode = row.mode || 'none'
    ensure(['none','recruit','settlement','population','both'].includes(mode) && (faction === 'x' || !['population','both'].includes(mode)),'Choose a valid Settle operation.')
    ensure(mode !== 'none' || claims.size > 0,`Raider rolls for ${name} require Returning Raiders there or adjacent.`)
    if (claims.size) journal.push(`${name} +${rolled} Warbands from Raider rolls`)
    if (mode === 'recruit') {
      const settlements = nativeSettlement(space,faction)
      const legalMax = settlements+(wasControlled ? space.pop : 0)
      const max = Math.min(legalMax,availability(state)[nationBand]+sum(recycle.filter(entry => entry.group === nationBand).map(entry => entry.rest)))
      const requested = row.bands === '' || row.bands == null ? max : int(row.bands,'Warbands',25)
      ensure(settlements && requested > 0 && requested <= max,`Check the native Settlements, starting Control and Available Warbands at ${name}.`)
      spend(3)
      placeFromStock(state,name,nationBand,requested,recycle,journal)
      journal.push(`${name} +${requested} recruited Warbands`)
    }
    if (mode === 'settlement' || mode === 'both') {
      ensure(on(space,nationBand) >= 2 && availability(state)[nationSite] > 0,`Settling ${name} requires two Warbands and an Available Settlement.`)
      const index = findSite(name,space,row.site,(site,occupant) => !occupant,'a vacant Stronghold Site')
      setPieceAt(state,name,index,nationSite)
      countRemoval(space,nationBand,2)
      journal.push(`${name} +1 Settlement`)
    }
    if (mode === 'population' || mode === 'both') {
      ensure(!isCity(name) && on(space,nationBand) >= 3 && space.pop < printedPopulation(state,name)+1,`Adding Population in ${name} requires a Region below its Population limit and three Warbands.`)
      countRemoval(space,nationBand,3)
      space.pop++
      journal.push(`${name} +1 Population`)
    }
  }
}
function entreatFeat(state,[row],{spend,recycle},journal) {
  const name = row.space
  const space = state.land[name]
  ensure(BY_NAME[name].terrain === 'Hills' && on(space,'sw') > 0,`Entreat requires a Hills Region with a Scotti Warband.`)
  const settlement = flag(row.settlement)
  const bands = int(row.bands,'Militia to replace',2)
  ensure(settlement || bands,'Choose at least one piece to Entreat.')
  ensure(on(space,'mil') >= bands,`There are not enough Militia at ${name}.`)
  const stock = availability(state)
  const hill = settlement ? findSite(name,space,row.site,(site,occupant) => occupant?.piece === 'hill','a Hillfort to replace') : -1
  const replaceHill = hill >= 0 && stock.ss > 0
  const converted = Math.min(bands,stock.sw+sum(recycle.filter(line => line.group === 'sw').map(line => line.rest)))
  ensure(replaceHill || converted,'Entreat needs an available replacement for at least one selected piece.')
  spend(4)
  if (replaceHill) setPieceAt(state,name,hill,'ss')
  countRemoval(space,'mil',converted)
  placeFromStock(state,name,'sw',converted,recycle,journal)
  journal.push(`${name}: entreated ${converted} Militia${replaceHill ? ' and one Hillfort' : ''}`)
}

const featHandlers = {
  Build:buildFeat,
  Invite:inviteFeat,
  Requisition:requisitionFeat,
  Reinforce:reinforceFeat,
  Rule:ruleFeat,
  Pillage:pillageFeat,
  Settle:settleFeat,
  Entreat:entreatFeat,
}
function executeFeat(state,feat,rows,context,roll,journal) {
  const action = featHandlers[feat]
  if (feat === 'Settle' || feat === 'Reinforce') action(state,rows,context,roll,journal)
  else action(state,rows,context,journal)
}

function validateFeatRows(state,faction,command,feat,options,rows) {
  if (!feat) {
    ensure(rows.length === 0, 'Choose a Feat before adding its targets.')
    return
  }
  const fields = commandFeatFields(state,faction,command,feat,options)
  ensure(fields && rows.length >= fields.minRows && rows.length <= fields.maxRows,`Select ${fields?.minRows ?? 1}–${fields?.maxRows ?? 1} ${feat} spaces.`)
  uniqueSpaces(rows,feat+' space')
}
function updateCommandState(original,draft) {
  original.land = draft.land
  original.tracks = draft.tracks
  original.pools = draft.pools
}

export function runCommandFeat(state,{faction,command,feat,options={},rows=[],input={},battleSpaces=[]},roll) {
  checkCommandContext(state,faction,command,feat,options)
  validateFeatRows(state,faction,command,feat,options,rows)
  ensure(feat,'Choose a Feat.')
  const draft = clone(state)
  const journal = []
  const {spend} = commandEconomy(draft,faction,options,input)
  const recycle = recycleEntries(input.recycle,faction,command,feat)
  executeFeat(draft,feat,rows,{faction,spend,options,input,battleSpaces,returning:new Map(),recycle},roll,journal)
  updateCommandState(state,draft)
  return journal.join('. ')
}

export function runCommand(state,{faction,command,feat,options={},rows=[],featRows=[],input={}},roll) {
  checkCommandContext(state,faction,command,feat,options)
  const fields = commandFields(state,faction,command,feat,options)
  ensure(fields,'This action requires the tabletop procedure or Battle resolver.')
  const tradeAll = command === 'Trade' && (flag(input.tradeAll) || options.tradeAll)
  const minRows = tradeAll ? 0 : fields.minRows
  ensure(Array.isArray(rows) && rows.length >= minRows && rows.length <= fields.maxRows,`Select ${minRows}–${fields.maxRows} command rows.`)
  if (command !== 'March') {
    const selected = uniqueSpaces(rows,command+' space')
    if (options.regionsOnly) ensure(selected.every(name => !isCity(name)),'This Event grants the Command in a Region only.')
  }
  validateFeatRows(state,faction,command,feat,options,featRows)
  const draft = clone(state)
  const {spend} = commandEconomy(draft,faction,options,input)
  const journal = []
  const returning = command === 'Return' ? returningConnections(draft,rows,faction) : new Map()
  const context = {faction,spend,input,options,returning,recycle:recycleEntries(input.recycle,faction,command,feat)}
  const applyFeat = () => {
    if (feat) executeFeat(draft,feat,featRows,context,roll,journal)
  }
  if (command !== 'Return' && flag(input.featBefore)) applyFeat()
  switch (command) {
    case 'Train': trainCommand(draft,rows,context,journal); break
    case 'Muster': musterCommand(draft,rows,context,journal); break
    case 'Trade': tradeCommand(draft,rows,context,journal); break
    case 'March': marchCommand(draft,rows,context,journal); break
    case 'Return':
      if (feat === 'Settle') {
        returnCommand(draft,rows,faction,journal,'stow')
        applyFeat()
        returnCommand(draft,rows,faction,journal,'remove')
      } else {
        returnCommand(draft,rows,faction,journal)
        applyFeat()
      }
      break
  }
  if (command !== 'Return' && !flag(input.featBefore)) applyFeat()
  updateCommandState(state,draft)
  return journal.join('. ')
}

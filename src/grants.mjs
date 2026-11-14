import { BY_NAME, COMMANDS, FEATS, NAMES, SEAS } from './data.mjs'
import { battleEnemies } from './battle.mjs'
import { commandFields, runCommand } from './commands.mjs'
import { militaryFields, raidPaths, runMilitary } from './operations.mjs'
import { clone, ensure, on } from './position.mjs'

const britons = ['d','c']
const barbarians = ['x','s']
const picked = value => value === true || value === 'yes'
const all = factions => factions.flatMap(faction => COMMANDS[faction].map(command => [faction,command]))
const march = (faction,count,costMultiplier=1) => ({
  choices:[[faction,'March']], options:{spaceLimit:count,limitDestinations:true,regionsOnly:true,costMultiplier},
})
const defence = (allowMarch=false) => [
  ['d','Battle'],['c','Battle'],['d','Intercept'],...(allowMarch ? [['d','March'],['c','March']] : []),
]
const raid = (faction,options={}) => ({ choices:[[faction,'Raid']],options:{free:true,...options} })
const battle = (faction,options={}) => ({ choices:[[faction,'Battle']],options:{free:true,...options} })
const momentum = (side,extra={}) => ({type:'momentum',side,...extra})
const capability = side => ({type:'capability',side})

export function grantRule(state,id,faction,side) {
  const light = side !== 'shaded'
  let rule
  switch (id) {
    case 9:
      rule = light ? {...march(faction,2),follow:'swift',help:'Pay to March into up to two Regions, then Battle in any of the Regions where Marchers arrive. Enemy Evasion and Ambush rolls are reduced by one.'} :
        {...raid(faction,{spaceLimit:1,regionsOnly:true}),follow:'return',help:'Raid one Region for free, then Return from it.'}
      break
    case 16:
      if (light) rule = {choices:defence(true),options:{free:true},marker:momentum(side),help:'Choose a Briton faction and its free Command. The Militia modifier takes effect immediately.'}
      break
    case 23:
      if (light) rule = {...battle('c',{spaceLimit:1,allowFeat:true,enemies:barbarians,reinforceBonus:4}),fixedFeat:'Reinforce',
        help:'Civitates may Battle one Barbarian faction in a single space. Reinforce is free and its movement rolls gain four.'}
      break
    case 33:
      if (light) rule = {choices:[[faction,'March'],[faction,'Battle']],options:{free:true},marker:momentum(side),help:'The executing faction may March or Battle for free. The cooperative Briton strike bonus takes effect immediately.'}
      break
    case 37:
      if (!light) rule = {...raid('x'),marker:capability(side),help:'Saxons may immediately Raid for free. Oceanus Septentrionalis is now a possible route.'}
      break
    case 38:
    case 58: {
      const barbarian = id === 38 ? 'x' : 's'
      rule = light ? {choices:defence(),options:{free:true},marker:momentum(side),help:'Choose a Briton faction to Battle or choose Dux to Intercept. The Raid reduction takes effect immediately.'}
        : {...raid(barbarian),marker:momentum(side),help:NAMES[barbarian]+' may Raid for free with two extra Raiders per target before reductions.'}
      break
    }
    case 41:
      rule = light ? {...march(faction,1,2),follow:'winter',help:'Pay double to March to a single Region and Battle there when Troops arrive. Enemy troops cannot Evade. Attackers strike at Trap.'}
        : {...battle(faction),marker:momentum(side,{faction}),help:'Battle for free. Your attacking Troops absorb two losses each when Assaulting until the Epoch.'}
      break
    case 52:
      rule = light ? {choices:[['d','Train'],['c','Muster']],options:{free:true,troopsOnly:true,regionsOnly:true,spaceLimit:1},follow:'mist-battle',
        help:'One Briton faction may Train or Muster Troops in one Region for free, then Battle there.'}
        : {choices:barbarians.map(faction => [faction,'Raid']),options:{regionsOnly:true,spaceLimit:1,raidTrap:true},
          help:'One Barbarian faction may pay to Raid one Region. Any Raiders that land can strike at Trap in the accompanying Battle.'}
      break
    case 57:
      rule = {choices:all([faction]),options:{allowFeat:true},featChoice:true,help:'Execute a paid Command plus Feat. This counts as the Event and you remain eligible next card.'}
      break
    case 60:
      if (!light) {
        const from = Object.keys(SEAS).filter(sea => state.seas[sea])
        const to = Object.keys(SEAS).filter(sea => !state.seas[sea])
        rule = {choices:from.length && to.length ? barbarians.map(faction => [faction,'Raid']) : [],options:{free:true},patrol:{from,to},
          help:'Transfer a patrol to a different, unpatrolled Sea. Then one Barbarian faction may Raid for free.'}
      }
      break
    case 73:
      rule = {...raid('s',{spaceLimit:5,diceOverride:3,allowFeat:true}),featChoice:true,optionalFeat:true,follow:'saxon-raid',
        help:'Scotti may Raid up to five targets with 3D4 each and a Feat. Saxons then have the option to Raid up to four targets.'}
      break
  }
  if (!rule) return null
  rule.choices = rule.choices.filter(([owner,command]) => COMMANDS[owner]?.includes(command))
  return rule
}

export function setGrantMarkers(state,id,rule,input) {
  if (rule.marker) state.markers[id] = clone(rule.marker)
  if (!rule.patrol?.from.length || !rule.patrol?.to.length) return ''
  const from = input.fromSea || rule.patrol.from[0]
  const to = input.toSea || rule.patrol.to[0]
  ensure(rule.patrol.from.includes(from) && rule.patrol.to.includes(to),'Move a patrol from a Patrolled Sea to one without a patrol.')
  state.seas[from] = false
  state.seas[to] = true
  return 'Move the patrol from '+SEAS[from]+' to '+SEAS[to]+'.'
}

export function grantOperation(state,id,faction,side,input,restriction = {}) {
  const rule = grantRule(state,id,faction,side)
  if (!rule) return null
  const choices = rule.choices.filter(([owner,command]) => (!restriction.recipient || owner === restriction.recipient) &&
    (!restriction.command || command === restriction.command)).map(([owner,command]) => [owner+'/'+command,NAMES[owner]+' · '+command])
  const defaultChoice = id === 57 ? choices[0]?.[0] : id === 73 ? choices[0][0] : ''
  const value = input.grant ?? defaultChoice
  const [owner,command] = (choices.some(choice => choice[0] === value) ? value : defaultChoice || '').split('/')
  const staged = clone(state)
  setGrantMarkers(staged,id,rule,input)
  const allowed = (FEATS[owner]?.[command] || []).filter(feat => feat !== 'Invite' || staged.imperium !== 'f')
  const feats = rule.featChoice ? allowed : []
  const feat = rule.fixedFeat || (feats.includes(input.grantFeat) ? input.grantFeat : '')
  const options = {...rule.options,tradeAll:picked(input.tradeAll)}
  let spec = command && (!rule.featChoice || rule.optionalFeat || feat) ?
    commandFields(staged,owner,command,feat,options) ?? militaryFields(staged,owner,command,feat,options,input) : null
  if (spec && id === 23) spec = {...spec,featFields:{...spec.featFields,minRows:0}}
  if (spec && rule.options.troopsOnly) {
    const ignored = owner === 'd' ? ['restore'] : ['mode','site','newHillSite','hillSite']
    spec = {...spec,rows:spec.rows.filter(field => !ignored.includes(field.key))}
  }
  const mandatory = id === 57 || id === 73
  const noTargets = id === 73 && !spec?.rows[0]?.options?.some(([key]) => key)
  if (noTargets) return {rule,choices:[],selection:'',feats:[],feat:'',options,spec:null,maySkip:true}
  const maySkip = !mandatory || !choices.length
  return {rule,choices,selection:command ? owner+'/'+command : '',feats,feat,options,spec,owner,command,maySkip}
}

const troops = { d:['cav','dxw','dsw'], c:['mil','com','cxw','csw'], x:['xw'], s:['sw'] }
const battleParticipants = Object.values(troops).flat().concat(['xr','sr'])
function chooseAfterArrival(state,faction,name,kind,reply,fight) {
  if (!troops[faction].some(key => on(state.land[name],key))) return
  const enemies = battleEnemies(state,name,faction,'Battle')
  if (!enemies.length) return
  const choices = enemies.map(enemy => ({value:enemy,label:'Battle '+NAMES[enemy]}))
  if (kind !== 'winter') choices.unshift({value:'skip',label:'Skip Battle'})
  const enemy = choices.length === 1 ? choices[0].value : reply({
    stage:'Event Battle',title:'Choose whether to Battle in '+name,options:choices,defaultValue:choices[0].value,progress:[],
  })
  if (enemy === 'skip') return
  fight({name,attacker:faction,defender:enemy,source:'Battle',
    ...(kind === 'swift' ? {defenderTacticsModifier:-1} : {}),
    ...(kind === 'winter' ? {trap:battleParticipants,trapSide:'attacker',noDefenderEvade:true} : {}),
  })
}

export function runGrantedEvent(state,id,faction,side,operation,roll,fight,reply) {
  const { input,rows,featRows } = operation
  const grant = grantOperation(state,id,faction,side,input,operation.restriction)
  ensure(grant,'The card does not grant this action.')
  const notes = [setGrantMarkers(state,id,grant.rule,input)].filter(Boolean)
  if (!grant.command || !rows.length && grant.maySkip && grant.spec?.minRows !== 0) {
    ensure(grant.maySkip,'Choose the granted Command and its targets.')
    if (grant.rule.marker) notes.push('Set the '+grant.rule.marker.type+' marker.')
    return notes.join(' ')
  }
  ensure(grant.spec,'Choose a legal Command and Feat.')
  if (grant.rule.marker) notes.push('Set the '+grant.rule.marker.type+' marker.')
  const arrivals = []
  const {owner,command,feat,options} = grant
  const args = {faction:owner,command,feat,options:{...options,onArrival:names => arrivals.push(...names)},input,rows,featRows}
  const result = ['Battle','Intercept','Raid'].includes(command) ? runMilitary(state,args,roll,fight,reply) : runCommand(state,args,roll)
  if (result) notes.push(result)
  if (grant.rule.follow === 'return') {
    const name = rows[0].space
    if (on(state.land[name],owner+'w')+on(state.land[name],owner+'r')) {
      notes.push(runCommand(state,{faction:owner,command:'Return',feat:'',options:{free:true,spaceLimit:1},rows:[{space:name}]},roll))
    }
  }
  if (grant.rule.follow === 'mist-battle') chooseAfterArrival(state,owner,rows[0].space,'mist-battle',reply,fight)
  if (['swift','winter'].includes(grant.rule.follow)) {
    for (const name of [...new Set(arrivals)]) chooseAfterArrival(state,owner,name,grant.rule.follow,reply,fight)
  }
  return notes.join(' ')
}

export function humanSaxonResponse(state,roll,fight,reply) {
  const base = {faction:'x',command:'Raid',options:{free:true,spaceLimit:4,diceOverride:3,allowFeat:true},rows:[],input:{}}
  const direct = militaryFields(state,'x','Raid','',base.options).rows[0].options.slice(1)
  if (!direct.length) return {accepted:false,note:''}
  const feat = reply({stage:'Conspiratio Barbarica',title:'Will Saxons take their free Raid?',defaultValue:'decline',progress:[],
    options:[{value:'decline',label:'Decline the Raid'},{value:'Surprise',label:'Raid with Surprise'},{value:'Ravage',label:'Raid with Ravage'},{value:'',label:'Raid without a Feat'}]})
  if (feat === 'decline') return {accepted:false,note:''}
  const choices = militaryFields(state,'x','Raid',feat,base.options).rows[0].options.slice(1)
  let surpriseUsed = false
  while (base.rows.length < 4) {
    const used = new Set(base.rows.map(row => row.space))
    const regions = choices.filter(([name]) => !used.has(name) && (!surpriseUsed || raidPaths(state,'x',name,'').length))
    if (!regions.length) break
    const options = regions.map(([value,label]) => ({value,label}))
    if (base.rows.length) options.unshift({value:'',label:'Done selecting targets'})
    const name = reply({stage:'Saxon free Raid',title:'Choose target '+(base.rows.length+1),options,defaultValue:options[0].value,progress:[]})
    if (!name) break
    const paths = raidPaths(state,'x',name,surpriseUsed ? '' : feat)
    const path = paths.length === 1 ? paths[0].key : reply({
      stage:'Saxon free Raid',title:'Choose a route to '+name,options:paths.map(path => ({value:path.key,label:path.label})),defaultValue:paths[0].key,progress:[],
    })
    const [route,via] = path.split('@')
    const row = {space:name,route,via}
    if (feat === 'Ravage' || feat === 'Surprise' && !surpriseUsed && !via) {
      row.tactic = reply({stage:'Saxon free Raid',title:'Use '+feat+' in '+name+'?',defaultValue:'no',progress:[],
        options:[{value:'yes',label:'Yes'},{value:'no',label:'No'}]})
    }
    surpriseUsed ||= feat === 'Surprise' && Boolean(via || row.tactic === 'yes')
    const enemies = battleEnemies(state,name,'x','Raid')
    if (enemies.length) {
      const attack = reply({stage:'Saxon free Raid',title:'Battle if Raiders land in '+name+'?',defaultValue:'',progress:[],
        options:[{value:'',label:'Skip Battle'},...enemies.map(value => ({value,label:'Battle '+NAMES[value]}))]})
      if (attack) Object.assign(row,{battle:'yes',enemy:attack})
    }
    base.rows.push(row)
  }
  return {accepted:Boolean(base.rows.length),note:runMilitary(state,{...base,feat},roll,fight,reply)}
}

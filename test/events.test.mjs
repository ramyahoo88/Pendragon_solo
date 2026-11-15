import test from 'node:test'
import assert from 'node:assert/strict'
import { opening, availability, boardTotals, clone, totalProsperity, validatePosition } from '../src/position.mjs'
import { applyStilichoRecovery, botEventInput, eventBattleRequests, eventChoices, eventSides, runEvent, stilichoRecoveryChoices } from '../src/events.mjs'
import { runBattle } from '../src/battle.mjs'

test('Imperial Subsidies fills the correct pools and Civitates uses shaded (§8.2.1)', () => {
  const game = opening(1)
  const chosen = botEventInput(game,5,'c','unshaded')
  assert.deepEqual(chosen,{_side:'shaded'})
  runEvent(game,5,'c',chosen._side,chosen)
  assert.equal(game.tracks.red,0)
  assert.equal(game.tracks.blue,45)
  assert.equal(game.tracks.wealth,5)
  runEvent(game,5,'d','unshaded')
  assert.equal(game.tracks.red,20)
})

test('Stilicho deploys ten Cavalry with cargo and records only off-map units for Recovery', () => {
  const game = opening(1,{seat:'d'})
  game.imperium = 'ac'
  game.roads = false
  game.land.Carvetii.units.cav[1] = 1
  game.land.Eboracum.units.cav[0] -= 3
  game.pools.out = 2
  game.pools.casualties = 1
  const prior = Object.fromEntries(Object.entries(game.land).map(([name,space])=>[name,space.units.cav[0]]))
  const input = Object.fromEntries(eventChoices(game,4,'d','single').fields.filter(field=>field.name.startsWith('from-')).map(field=>[field.name,0]))
  Object.assign(input,{'from-out':2,'from-casualties':1,'from-Carvetii':3,'from-Eboracum':2,'from-Atrebates':1,'from-Cantiaci':1,'from-Regni':0,'from-Textoverdi':0,'from-Deceangli':0,
    'cav-Atrebates':4,'cav-Regni':2,'cav-Cantiaci':4,'loaded-Regni':1,'loaded-Atrebates':0,hold1:'Carvetii/1/town'})
  const old = JSON.stringify(game)
  assert.throws(() => runEvent(game,4,'d','single',{...input,'loaded-Regni':0}),/carried Plunder/)
  assert.equal(JSON.stringify(game),old)
  runEvent(game,4,'d','single',input)
  assert.equal(game.imperium,'rm')
  assert.equal(game.roads,true)
  assert.equal(game.land.Carvetii.units.cav[0],0)
  assert.equal(game.land.Regni.units.cav[1],1)
  assert.equal(game.land.Atrebates.units.cav[0],prior.Atrebates + 3)
  assert.equal(game.land.Carvetii.sites[1].piece,'town')
  assert.deepEqual(game.markers[4],{type:'momentum',side:'unshaded',recoveryCavalry:3,faction:'d'})
  validatePosition(game)
  const recovery = stilichoRecoveryChoices(game)
  assert.equal(recovery.count,3)
  assert.equal(recovery.faction,'d')
  const choices = Object.fromEntries(recovery.fields.map(field=>[field.name,0]))
  assert.throws(() => applyStilichoRecovery(game,choices),/Choose 3/)
  choices['stilicho-Cantiaci']=3
  assert.equal(applyStilichoRecovery(game,choices),'3 Stilicho Cavalry returned to Available.')
  assert.equal(availability(game).cav,3)
  assert.equal(stilichoRecoveryChoices(game),null)
  validatePosition(game)
})

test('Saxon Annona charges the selected Saxon group and leaves Scotti groups alone', () => {
  const game = opening(1)
  game.land.Cantiaci.units.cxw = [1,0]
  game.land.Carvetii.units.dsw = [2,1]
  const tracks = {...game.tracks}
  runEvent(game,10,'x','shaded',{'annona-Cantiaci/cxw':true})
  assert.deepEqual(game.land.Cantiaci.units.cxw,[1,0])
  assert.deepEqual(game.land.Carvetii.units.dsw,[2,1])
  assert.equal(game.tracks.blue,tracks.blue-1)
  assert.equal(game.tracks.x,tracks.x+1)
  assert.equal(game.tracks.s,tracks.s)
  validatePosition(game)
})

test('Romanitas converts only one red nationality and may deploy from Out of Play', () => {
  const game = opening(1)
  game.land.Eboracum.units.cav[0] -= 2
  game.pools.out = 2
  const land = game.land.Regni
  land.units.dxw = [2,1]
  land.units.dsw = [1,0]
  land.sites[0] = {piece:'xs',employer:'d'}
  const cavalry = land.units.cav[0]
  runEvent(game,12,'d','unshaded',{group:'Regni/dx','from-out':2})
  assert.equal(land.units.cav[0],cavalry+2)
  assert.deepEqual(land.units.dxw,[0,0])
  assert.deepEqual(land.units.dsw,[1,0])
  assert.deepEqual(land.sites[0],{piece:'fort',employer:null})
  assert.equal(game.pools.out,0)
  validatePosition(game)
})

test('Cunedda fills available destinations despite Votadini having nothing to remove', () => {
  const game = opening(1)
  game.land.Votadini.units.mil[0] = 0
  game.land.Votadini.sites.fill(null)
  game.pools.notYet = 14
  const prior = game.land.Ordovices.units.mil[0]
  runEvent(game,13,'c','unshaded',{comitates:1})
  assert.equal(game.land.Ordovices.units.mil[0],prior+3)
  assert.equal(game.land.Ordovices.units.com[0],1)
  assert.equal(game.land.Ordovices.sites[1].piece,'hill')
  validatePosition(game)
})

test('Fickle Weather requires distinct Regions, limits both rows, and uses the supply', () => {
  const game = opening(1)
  game.land.Dumnonii.pros[1] = 0
  game.land.Parisi.pros[1] = 1
  const before = boardTotals(game).total
  assert.throws(() => runEvent(game,15,'d','unshaded',{space1:'Dumnonii',space2:'Dumnonii'}),/distinct/)
  assert.equal(boardTotals(game).total,before)
  runEvent(game,15,'d','unshaded',{space1:'Dumnonii',space2:'Parisi'})
  assert.equal(boardTotals(game).total,before+2)
  assert.deepEqual(game.land.Dumnonii.pros,[1,1])
  assert.equal(botEventInput(game,15,'d','unshaded'),null)
})

test('Sea Trade has one recipient, respects the cap, and does not affect other tracks', () => {
  const game = opening(1)
  game.tracks.x = 77
  assert.deepEqual(eventSides(25),['single'])
  assert.deepEqual(botEventInput(game,25,'x','shaded'),{target:'x'})
  runEvent(game,25,'x','single',{target:'x'})
  assert.equal(game.tracks.x,80)
  assert.equal(game.tracks.wealth,0)
  assert.equal(game.tracks.prestige,0)
  assert.equal(game.tracks.s,6)
  assert.equal(botEventInput(game,25,'x','shaded'),null)
})

test('Gratia blocks shaded Tribal War but allows unshaded Barbarians', () => {
  const game = opening(1)
  runEvent(game,27,'c','unshaded')
  const before = JSON.stringify(game.land)
  runEvent(game,19,'s','shaded')
  assert.equal(JSON.stringify(game.land),before)
  game.land.Regni.units.xw[0] = 5
  game.land.Regni.sites[1] = {piece:'xs',employer:null}
  runEvent(game,71,'s','unshaded',{space:'Regni'})
  assert.equal(game.land.Regni.units.xw[0],0)
})

test('Tribal War selects units before a faction’s Stronghold and protects Forts and Cavalry', () => {
  const game = opening(1)
  const bad = {remove1:'Cantiaci/site1'}
  assert.throws(() => runEvent(game,19,'s','shaded',bad),/required/)
  const picks = ['Cantiaci/mil','Cantiaci/site1','Catuvellauni/mil','Catuvellauni/mil','Catuvellauni/site0']
  const selected = Object.fromEntries(picks.map((pick,i)=>['remove'+(i+1),pick]))
  runEvent(game,19,'s','shaded',selected)
  assert.equal(game.land.Cantiaci.units.cav[0],1)
  assert.equal(game.land.Cantiaci.sites[0].piece,'fort')
  assert.equal(game.land.Cantiaci.sites[1],null)
  assert.equal(game.land.Catuvellauni.sites[0],null)
  assert.equal(totalProsperity(game.land.Cantiaci),2)
  assert.equal(totalProsperity(game.land.Catuvellauni),4)
})

test('Brittany’s shaded side changes Population but adds no Refugees or immediate Prosperity edit', () => {
  const game = opening(1)
  runEvent(game,53,'s','shaded',{space1:'Atrebates'})
  assert.equal(game.land.Atrebates.pop,2)
  assert.equal(totalProsperity(game.land.Atrebates),6)
  assert.equal(game.tracks.refugees,0)
  validatePosition(game)
})

test('Single Event Omens stores a holder and prints no ongoing Capability', () => {
  const game = opening(1)
  runEvent(game,43,'x','single')
  assert.deepEqual(game.omens,{holder:'x',head:null})
  assert.equal(game.markers[43],undefined)
})

test('Vortigern leaves two Troops of one or both employers and targets Rutupiae only', () => {
  const game = opening(1)
  const target = game.land.Cantiaci
  target.units.cxw = [2,1]
  runEvent(game,49,'x','shaded',{'keep-cav':0,'keep-mil':0,'keep-cxw':2})
  assert.equal(target.units.cav[0],0)
  assert.equal(game.pools.casualties,1)
  assert.equal(target.units.mil[0],0)
  assert.deepEqual(target.units.cxw,[2,1])
  assert.equal(target.units.xw[0],6)
  assert.deepEqual(target.sites,[{piece:'xs',employer:null},{piece:'town',employer:null}])
  validatePosition(game)
})

test('End of the World checks penalized totals but preserves actual Prosperity', () => {
  const game = opening(1)
  game.tracks.prestige = 3
  game.tracks.wealth = 5
  for (const name of ['Atrebates','Catuvellauni','Iceni','Dobunni']) game.land[name].sites.fill(null)
  assert.equal(boardTotals(game).pop.c,30)
  runEvent(game,54,'s','single')
  assert.equal(game.imperium,'am')
  assert.equal(game.tracks.prestige,2)
  assert.equal(game.tracks.wealth,3)
  assert.equal(boardTotals(game).total,80)
})

test('Dogs and Wolves flips distinct seas and records a single persistent marker', () => {
  const game = opening(1)
  assert.throws(() => runEvent(game,67,'c','single',{sea1:'hib',sea2:'hib'}),/different/)
  runEvent(game,67,'c','single',{sea1:'hib',sea2:'germ'})
  assert.equal(game.seas.hib,true)
  assert.equal(game.seas.germ,false)
  assert.equal(game.markers[67].type,'capability')
})

test('Evangelization rounds up losses and places no Settlement without a Hillfort', () => {
  const game = opening(1)
  const target = game.land.Demetae
  target.sites[0] = null
  target.units.mil[0] = 3
  runEvent(game,63,'s','shaded',{space:'Demetae'})
  assert.equal(target.units.mil[0],1)
  assert.equal(target.units.sw[0],2)
  assert.deepEqual(target.sites,[null,null])
  validatePosition(game)
})

test('Rival Caesars requires both adjacent half-losses and keeps Forts behind Troops', () => {
  const game = opening(1)
  assert.throws(() => runEvent(game,66,'x','shaded',{pair:'Atrebates/Regni','loss-Atrebates-1':'site0'}),/each required/)
  runEvent(game,66,'x','shaded',{pair:'Atrebates/Regni','loss-Atrebates-1':'cav','loss-Regni-1':'cav'})
  assert.equal(game.land.Atrebates.sites[0].piece,'fort')
  assert.equal(game.land.Regni.sites[0].piece,'fort')
  assert.equal(game.pools.casualties,2)
  validatePosition(game)
})

test('Shaded Rival Caesars rounds each odd Region up and explains the loss calculation', () => {
  const game = opening(995066,{seat:'s'})
  game.land.Carvetii.units.cav[0] -= 2
  for (const name of ['Atrebates','Regni']) game.land[name].units.cav = [2,0]
  const input = {pair:'Atrebates/Regni','loss-Atrebates-1':'cav','loss-Regni-1':'cav'}
  const {summary} = eventChoices(game,66,'s','shaded',input)
  assert.match(summary,/Atrebates · 3 Dux pieces → 2 losses/)
  assert.match(summary,/Regni · 3 Dux pieces → 2 losses/)
  assert.throws(()=>runEvent(game,66,'s','shaded',input),/each required/)
  const detail = runEvent(game,66,'s','shaded',{...input,'loss-Atrebates-2':'cav','loss-Regni-2':'cav'})
  assert.match(detail,/4 Dux pieces lost/)
  assert.equal(game.pools.casualties,4)
  for (const name of ['Atrebates','Regni']) assert.equal(game.land[name].sites[0].piece,'fort')
  validatePosition(game)
})

function tintagelPosition(seat = 'c') {
  const game = opening(995032,{seat})
  game.land.Dobunni.units.mil[0] += availability(game).mil
  return game
}
const tintagelInput = {space:'Dumnonii',site:'1'}
const tintagelDonor = slot => 'event-recycle-Dumnonii-mil-'+slot

test('Tintagel can reuse two Militia from one space without releasing boxed Comitates', () => {
  const game = tintagelPosition()
  const {fields} = eventChoices(game,32,'c','unshaded',tintagelInput)
  assert.equal(fields.filter(field=>field.name.startsWith('event-recycle-')).length,2)
  assert.ok(fields.find(field=>field.name===tintagelDonor(1)).options.some(option=>option.value==='Dobunni'))
  const detail = runEvent(game,32,'c','unshaded',{...tintagelInput,[tintagelDonor(1)]:'Dobunni',[tintagelDonor(2)]:'Dobunni'})
  assert.equal(game.land.Dumnonii.sites[1].piece,'hill')
  assert.equal(game.land.Dumnonii.units.mil[0],3)
  assert.equal(game.land.Dobunni.units.mil[0],6)
  assert.equal(game.pools.notYet,15)
  assert.equal(game.land.Dumnonii.units.com[0],0)
  assert.match(detail,/2 of 2 Militia placed/)
  assert.match(detail,/0 of 2 Comitates placed.*15 Comitates remain Not Yet in Play/)
  validatePosition(game)
})

test('Tintagel uses Available Militia before asking for one optional donor', () => {
  const game = tintagelPosition()
  game.land.Dobunni.units.mil[0]--
  const reused = clone(game)
  assert.equal(eventChoices(game,32,'c','unshaded',tintagelInput).fields.filter(field=>field.name.startsWith('event-recycle-')).length,1)
  const detail = runEvent(game,32,'c','unshaded',tintagelInput)
  assert.equal(game.land.Dumnonii.units.mil[0],2)
  assert.equal(game.land.Dobunni.units.mil[0],7)
  assert.match(detail,/1 of 2 Militia placed.*Available Militia supply exhausted/)
  runEvent(reused,32,'c','unshaded',{...tintagelInput,[tintagelDonor(1)]:'Dobunni'})
  assert.equal(reused.land.Dumnonii.units.mil[0],3)
  assert.equal(reused.land.Dobunni.units.mil[0],6)
  validatePosition(game)
  validatePosition(reused)
})

test('Tintagel rejects overdrawn donors atomically and keeps bot and cross-faction placement stock-only', () => {
  const game = tintagelPosition()
  const before = clone(game)
  assert.throws(()=>runEvent(game,32,'c','unshaded',{
    ...tintagelInput,[tintagelDonor(1)]:'Regni',[tintagelDonor(2)]:'Regni',
  }),/Choose no more Militia than Regni has/)
  assert.deepEqual(game,before)
  for (const [seat,faction] of [['d','c'],['d','d']]) {
    const game = tintagelPosition(seat)
    const input = {...tintagelInput,[tintagelDonor(1)]:'Dobunni'}
    assert.ok(eventChoices(game,32,faction,'unshaded',input).fields.every(field=>!field.name.startsWith('event-recycle-')))
    runEvent(game,32,faction,'unshaded',input)
    assert.equal(game.land.Dumnonii.units.mil[0],1)
    assert.equal(game.land.Dobunni.units.mil[0],8)
    validatePosition(game)
  }
})

test('Scotti Event placements allow native donors and exclude Scotti Foederati', () => {
  for (const [id,name] of [[32,'Dumnonii'],[62,'Demetae'],[71,'Dumnonii']]) {
    const game = opening(995062,{seat:'s'})
    game.land.Dobunni.units.sw = [11,0]
    game.land.Carvetii.units.dsw = [1,0]
    const key = `event-recycle-${name}-sw-1`
    const input = {space:name,site:'1',[key]:'Dobunni'}
    const {fields} = eventChoices(game,id,'s','shaded',input)
    assert.deepEqual(fields.find(field=>field.name===key).options.map(option=>option.value),['','Dobunni'])
    runEvent(game,id,'s','shaded',input)
    assert.equal(game.land[name].units.sw[0],1)
    assert.equal(game.land.Dobunni.units.sw[0],10)
    assert.equal(game.land.Carvetii.units.dsw[0],1)
    validatePosition(game)
  }
})

test('Adventus Saxonum releases both colors of Saxon Foederati and preserves assigned Plunder', () => {
  const game = opening(1,{scenario:'De Excidio Britanniae'})
  const area = game.land.Iceni
  area.units.dxw = [2,1]
  area.units.cxw = [1,0]
  area.units.csw = [1,0]
  area.sites[1] = {piece:'xs',employer:'d'}
  const input = {space1:'Iceni'}
  assert.equal(eventChoices(game,74,'x','single',input).needsBattle,true)
  const [battle] = eventBattleRequests(game,74,'x','single',input)
  assert.deepEqual(battle,{name:'Iceni',attacker:'x',defender:'d',source:'Event Battle',shieldWall:true})
  runEvent(game,74,'x','single',input)
  assert.deepEqual(area.units.xw,[3,1])
  assert.deepEqual(area.units.dxw,[0,0])
  assert.deepEqual(area.units.cxw,[0,0])
  assert.equal(area.units.csw[0],1)
  assert.deepEqual(area.sites[1],{piece:'xs',employer:null})
  assert.equal(totalProsperity(area),3)
  validatePosition(game)
  assert.doesNotThrow(() => runBattle(game,battle,()=>6))
})

test('Cymbrogi releases reserves, checks Hillfort sites, and shifts Dominance without changing Imperium level', () => {
  const game = opening(1,{scenario:'De Excidio Britanniae'})
  game.imperium = 'am'
  assert.throws(() => runEvent(game,76,'c','single',{space1:'Cantiaci'}),/eligible/)
  const prior = availability(game).hill
  runEvent(game,76,'c','single',{space1:'Demetae'})
  assert.equal(game.pools.notYet,6)
  assert.equal(game.land.Demetae.units.com[0],1)
  assert.equal(availability(game).hill,prior-1)
  assert.equal(game.imperium,'ac')
  assert.equal(game.markers[76].type,'capability')
  validatePosition(game)
})

test('Coel Hen moves excess Out of Play and divides Prestige only on entry to Fragmentation', () => {
  const game = opening(1,{scenario:'The Harder They Fall'})
  game.imperium = 'am'
  game.tracks.prestige = 13
  game.land.Londinium.units.cav = [0,0]
  game.pools.out = 8
  runEvent(game,75,'d','single')
  assert.equal(game.tracks.prestige,4)
  assert.equal(game.tracks.red,10)
  assert.equal(game.pools.out,5)
  assert.equal(game.pools.casualties,3)
  assert.equal(game.imperium,'f')
  runEvent(game,75,'d','single')
  assert.equal(game.tracks.prestige,4)
  validatePosition(game)
})

test('Battle-only Events queue Trap on attackers or Coup de Main at one selected site', () => {
  const game = opening(1)
  game.land.Cantiaci.units.xw = [3,0]
  const trap = eventBattleRequests(game,22,'x','shaded',{target:'Cantiaci/d'})[0]
  assert.ok(trap.trap.includes('xw'))
  assert.equal(trap.trapSide,'attacker')
  const coup = eventBattleRequests(game,29,'x','shaded',{target:'Cantiaci/d/1'})[0]
  assert.equal(coup.onlySite,1)
  assert.equal(coup.surprise,true)
  assert.equal(coup.assumeCoup,true)
  assert.equal(coup.source,'Event Battle')
  game.land.Londinium.units.xr[0] = 1
  assert.ok(!eventChoices(game,29,'x','shaded').fields[0].options.some(choice=>choice.value.startsWith('Londinium/')))
  game.land.Londinium.units.xw[0] = 1
  assert.equal(eventBattleRequests(game,29,'x','shaded',{target:'Londinium/d/0'})[0].name,'Londinium')
  assert.equal(eventBattleRequests(game,22,'x','shaded',{target:'Londinium/d'}).length,0)
})

test('Unsupported Event faces stay guided and cannot silently mark a partial result', () => {
  const game = opening(1)
  assert.equal(eventChoices(game,9,'c','unshaded'),null)
  assert.equal(eventChoices(game,73,'s','single'),null)
  assert.throws(() => runEvent(game,73,'s','single'),/printed tabletop/)
  assert.equal(game.markers[73],undefined)
})

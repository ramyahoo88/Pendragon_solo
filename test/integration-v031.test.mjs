import assert from 'node:assert/strict'
import { test } from 'node:test'
import { battleForecast, runBattle } from '../src/battle.mjs'
import { barbarianReturn, eventPlan } from '../src/bots.mjs'
import { runCommand, runCommandFeat } from '../src/commands.mjs'
import { GROUPS } from '../src/data.mjs'
import { runEvent } from '../src/events.mjs'
import { runMilitary } from '../src/operations.mjs'
import { availability, boardTotals, clone, opening, validatePosition } from '../src/position.mjs'
import { advanceCard, advanceEpoch, activeFaction, finishAction, planAnnona, startCards, validateSave } from '../src/sequence.mjs'
import { fresh, parseSave, push, rewind, serialize } from '../src/session.mjs'

const one = () => 1
const six = () => 6
const defaultChoice = choice => choice.defaultValue
function clearBoard(seat = 'x') {
  const game = opening(16001,{seat})
  for (const space of Object.values(game.land)) {
    space.units = Object.fromEntries(GROUPS.map(([key]) => [key,[0,0]]))
    space.sites = space.sites.map(() => null)
    space.pros = [0,0]
  }
  return game
}
function putHold(game,name,index,piece) {
  game.land[name].sites[index] = {piece,employer:null}
}
function resolveMilitary(game,operation,roll=one,combatRoll=roll,choice=defaultChoice) {
  const requests = []
  runMilitary(game,operation,roll,config => {
    requests.push(config)
    return runBattle(game,config,combatRoll,choice)
  },choice)
  validatePosition(game)
  return requests
}

test('Dux Bellorum sets Militia absorption for the whole simultaneous Battle step',() => {
  for (const [active,cavalry,expectedMilitia] of [[true,1,1],[false,1,0],[true,2,1]]) {
    const game = clearBoard()
    const name = 'Corieltauvi'
    Object.assign(game.land[name].units,{cav:[cavalry,0],mil:[2,0],xw:[2,0]})
    if (active) game.markers[16] = {type:'momentum',side:'unshaded'}
    validatePosition(game)
    const report = runBattle(game,{name,attacker:'x',defender:'d',source:'Battle'},()=>3,
      choice => choice.stage === 'Pre-Battle' ? 'ambush' : choice.defaultValue)
    assert.equal(report.defenderLosses,3-expectedMilitia)
    assert.equal(game.land[name].units.mil[0],expectedMilitia)
    validatePosition(game)
  }
})

function deepRaid(game,name,intensity) {
  const via = name === 'Corieltauvi' ? 'Parisi' : 'Iceni'
  game.seas.germ = false
  return resolveMilitary(game,{faction:'x',command:'Raid',feat:'Surprise',rows:[
    {space:name,route:'germ',via,dice:intensity,tactic:true,battle:false},
  ]},one,six)
}
test('Civitates refuses a Deep Raid Battle that could lose its last Troop',() => {
  for (const [name,expected] of [['Corieltauvi',[]],['Catuvellauni',['c']]]) {
    const game = clearBoard()
    putHold(game,name,name === 'Corieltauvi' ? 1 : 0,'town')
    game.land[name].units.mil = [1,0]
    const requests = deepRaid(game,name,'one')
    assert.deepEqual(requests.map(request => request.reactionFaction),expected)
    assert.equal(game.land[name].units.mil[0],1)
  }
})
test('Dux considers a successful Raid Ambush before Cair Legion withdrawal',() => {
  for (const [intensity,expected] of [['full',[]],['one',['d']]]) {
    const game = clearBoard()
    const name = 'Corieltauvi'
    putHold(game,name,0,'fort')
    game.land[name].units.cav = [1,0]
    game.markers[7] = {type:'capability',side:'unshaded'}
    assert.deepEqual(deepRaid(game,name,intensity).map(request => request.reactionFaction),expected)
    assert.equal(game.land[name].units.cav[0],1)
  }
  const game = clearBoard()
  putHold(game,'Corieltauvi',1,'town')
  Object.assign(game.land.Corieltauvi.units,{cav:[1,0],mil:[2,0]})
  game.markers[7] = {type:'capability',side:'unshaded'}
  // Dux declines. Civitates may still force the Battle because a friendly Troop survives.
  assert.deepEqual(deepRaid(game,'Corieltauvi','full').map(request => request.reactionFaction),['c'])
  assert.equal(game.land.Corieltauvi.units.mil[0],1)
})
test('Ravage reaction checks Ambush using only Raiders from this Raid',() => {
  for (const [intensity,expected] of [['full',[]],['one',['d']]]) {
    const game = clearBoard()
    const name = 'Trinovantes'
    putHold(game,name,0,'fort')
    Object.assign(game.land[name].units,{cav:[1,0],xr:[4,1]})
    game.seas.germ = false
    const requests = resolveMilitary(game,{faction:'x',command:'Raid',feat:'Ravage',rows:[
      {space:name,route:'germ',dice:intensity,tactic:true,battle:false},
    ]},one,six)
    assert.deepEqual(requests.map(request => request.reactionFaction),expected)
    assert.equal(game.land[name].units.cav[0],1)
    if (intensity === 'one') assert.deepEqual(game.land[name].units.xr,[4,1])
  }
})
test('Cair Legion forecast retains automatic withdrawal after Charge',() => {
  const game = clearBoard()
  const name = 'Corieltauvi'
  putHold(game,name,0,'fort')
  Object.assign(game.land[name].units,{cav:[1,0],sr:[4,0]})
  game.markers[7] = {type:'capability',side:'unshaded'}
  const config = {name,attacker:'s',defender:'d',source:'Raid'}
  assert.equal(battleForecast(game,config).cavalryLosses,0)
  assert.equal(runBattle(game,config,one).cavalryLosses,0)
})

function entreatPosition(available,seat='s') {
  const game = opening(144,{seat})
  game.land.Demetae.units.sw = [1,0]
  game.land.Dumnonii.units.sw = [11-available,0]
  game.land.Dumnonii.units.sr = [1,1]
  for (const name of ['Dumnonii','Durotriges','Iceni','Cornovii','Ordovices','Parisi']) putHold(game,name,1,'ss')
  validatePosition(game)
  return game
}
const entreat = (game,bands,settlement) => runCommand(game,{
  faction:'s',command:'Return',feat:'Entreat',rows:[{space:'Dumnonii'}],featRows:[{space:'Demetae',settlement,bands}],
})
test('human Entreat rejects an empty exchange without spending Renown or removing pieces',() => {
  const game = entreatPosition(0)
  const before = clone(game)
  for (const [bands,hill] of [[1,false],[0,true]]) {
    assert.throws(()=>entreat(game,bands,hill),/available replacement/)
    assert.deepEqual(game,before)
  }
})
test('human Entreat leaves unreplaced Hillfort and Militia with partial supply',() => {
  const game = entreatPosition(1)
  game.land.Dobunni.units.mil[0]--
  game.land.Demetae.units.mil[0]++
  entreat(game,2,true)
  assert.equal(game.land.Demetae.units.mil[0],1)
  assert.equal(game.land.Demetae.units.sw[0],2)
  assert.equal(game.land.Demetae.sites[0].piece,'hill')
  validatePosition(game)
})
test('Non-player Scotti can remove an unreplaced Hillfort under 8.5.1',() => {
  const game = entreatPosition(0,'d')
  assert.equal(barbarianReturn(game,'s',one).feat,'Entreat')
  assert.equal(game.land.Demetae.sites[0],null)
  assert.equal(availability(game).ss,0)
  validatePosition(game)
})

function epochStart(seat) {
  const game = opening(6101,{seat})
  startCards(game,1,2)
  for (const id of [3,4,5,6,7,8,77]) {
    while (activeFaction(game)) finishAction(game,'pass','Pass')
    advanceCard(game,id)
  }
  assert.equal(game.epochPhase,'Annona')
  return game
}
test('Dux can pay blue Foederati in Annona, and undo restores the payment and board',() => {
  const game = epochStart('d')
  game.land.Cantiaci.units.cxw = [1,0]
  game.tracks.red = 1
  game.tracks.blue = 0
  const after = clone(game)
  const input = {'annona-payer-Cantiaci/cxw':'d'}
  advanceEpoch(after,planAnnona(after,input,one))
  assert.equal(after.tracks.red,0)
  assert.equal(after.land.Cantiaci.units.cxw[0],1)
  assert.match(after.log.at(-1).detail,/Dux pays 1/)
  const session = fresh(game)
  push(session,'Annona',after)
  const reloaded = parseSave(serialize(session))
  assert.ok(rewind(reloaded,'undo'))
  assert.deepEqual(reloaded.game,game)
  assert.ok(rewind(reloaded,'redo'))
  assert.deepEqual(reloaded.game,after)
})
test('Annona lets two human Britons split a group, spending Dux Resources first',() => {
  const game = epochStart('britons')
  game.land.Cantiaci.units.cxw = [2,0]
  game.tracks.red = 1
  game.tracks.blue = 1
  const input = {'annona-payer-Cantiaci/cxw':'split-1','annona-blue-spend':'0'}
  advanceEpoch(game,planAnnona(game,input,one))
  assert.equal(game.tracks.red,0)
  assert.equal(game.tracks.blue,0)
  assert.equal(game.land.Cantiaci.units.cxw[0],2)
  assert.match(game.log.at(-1).detail,/Dux pays 1.*Civitates pays 1/)
  validateSave(game)
})
test('shaded Annona lets Civitates pay red Saxons and leaves Scotti groups alone',() => {
  const game = opening(6101,{seat:'c'})
  game.land.Cantiaci.units.dxw = [1,0]
  game.land.Regni.units.dsw = [1,0]
  game.tracks.blue = 0
  game.tracks.wealth = 1
  runEvent(game,10,'x','shaded',{'annona-payer-Cantiaci/dxw':'c'},one)
  assert.equal(game.tracks.wealth,0)
  assert.equal(game.land.Cantiaci.units.dxw[0],1)
  assert.deepEqual(game.land.Regni.units.dsw,[1,0])
  validatePosition(game)
})

test('Intercept can use only red Resources, and a blue cap also covers an Invite Feat',() => {
  for (const withInvite of [false,true]) {
    const game = opening(6103,{seat:'d'})
    game.tracks.red = 2
    game.tracks.blue = 2
    game.land.Cantiaci.units.xr = [1,0]
    if (withInvite) game.land.Atrebates.units.cxw = [1,0]
    resolveMilitary(game,{faction:'d',command:'Intercept',feat:withInvite ? 'Invite' : '',
      rows:[{space:'Cantiaci',origin:'Regni',cav:1,enemy:'x'}],
      featRows:withInvite ? [{space:'Atrebates',mode:'convert',nation:'x'}] : [],
      input:{blueSpend:withInvite ? 1 : 0},
    })
    assert.equal(game.tracks.red,0)
    assert.equal(game.tracks.blue,withInvite ? 1 : 2)
    assert.equal(game.land.Cantiaci.units.xr[0],0)
  }
})
test('a Dux player can Requisition before or between Battles with the same cargo at risk',() => {
  for (const timing of ['before','1']) {
    const game = opening(6104,{seat:'d'})
    game.land.Regni.units.cav[0]--
    game.land.Demetae.units.cav = [1,1]
    game.land.Demetae.units.mil = [0,0]
    game.land.Demetae.units.sw = [2,0]
    game.land.Cantiaci.units.xr = [1,0]
    const risky = {space:'Demetae',enemy:'s'}
    const rows = timing === 'before' ? [risky] : [{space:'Cantiaci',enemy:'x'},risky]
    resolveMilitary(game,{faction:'d',command:'Battle',feat:'Requisition',rows,input:{featTiming:timing}},six)
    assert.equal(game.tracks.red,1)
    assert.equal(game.land.Demetae.units.cav[0],0)
  }
})

test('Dux Camelot and Mons Badonicus require Roman Rule and Non-player Civitates',() => {
  for (const id of [21,28]) {
    for (const [imperium,seat,allowed] of [['rm','s',true],['am','s',false],['f','s',false],['rm','c',false]]) {
      const game = opening(41000+id,{seat})
      startCards(game,id,15)
      game.imperium = imperium
      if (imperium === 'f') game.roads = false
      assert.equal(Boolean(eventPlan(game,'d',one)),allowed)
      assert.equal(game.pools.notYet,allowed ? 12 : 15)
    }
  }
})
test('Civitates Vortigern requires a Control gain even when Saxons are human',() => {
  const game = opening(41049,{seat:'x'})
  startCards(game,49,15)
  assert.equal(eventPlan(clone(game),'c',one),null)
  game.land.Cantiaci.units.xw = [6,0]
  assert.equal(boardTotals(game).pop.c,38)
  assert.ok(eventPlan(game,'c',one))
  assert.equal(boardTotals(game).pop.c,40)
  validateSave(game)
})
test('Corinium accepts a zero-gain Town and ranks actual Control gain first for Civitates',() => {
  const game = opening(41029,{seat:'s'})
  startCards(game,29,15)
  for (const faction of ['d','c']) {
    const before = clone(game)
    assert.ok(eventPlan(before,faction,one))
    assert.equal(boardTotals(before).pop.c,40)
    assert.equal(availability(before).town,1)
  }
  game.land.Carvetii.sites[0] = null
  assert.equal(boardTotals(game).pop.c,39)
  assert.ok(eventPlan(game,'c',one))
  assert.equal(game.land.Carvetii.sites[1]?.piece,'town')
  assert.equal(boardTotals(game).pop.c,40)
  validateSave(game)
})

test('moving Reinforcement Militia never count as available to Muster in the same Feat',() => {
  const game = clearBoard('c')
  game.land.Dobunni.units.mil = [28,0]
  game.land.Novantae.units.mil = [1,0]
  game.land.Votadini.units.sr = [1,0]
  putHold(game,'Novantae',0,'hill')
  putHold(game,'Votadini',0,'hill')
  runCommandFeat(game,{faction:'c',command:'Battle',feat:'Reinforce',options:{free:true,allowFeat:true,reinforceBonus:4},
    battleSpaces:['Votadini'],rows:[{space:'Novantae',mode:'move',destination:'Votadini',mil:1},{space:'Votadini',mode:'muster'}],
  },one)
  assert.equal(game.land.Votadini.units.mil[0],2)
  assert.equal(availability(game).mil,0)
  validatePosition(game)
})

test('upgrading a saved Battle keeps the board and command and revisits tactical choices',() => {
  const game = opening(6104,{seat:'d'})
  startCards(game,5,22)
  const session = fresh(game)
  const operation = {faction:'d',command:'Intercept',rows:[{space:'Cantiaci',enemy:'x'}]}
  session.work = {kind:'action',draft:null,input:{command:'Intercept',battle:{
    job:{kind:'action',option:'command',label:'Dux · Intercept',operation},answers:['ambush'],
  }}}
  const old = JSON.parse(serialize(session))
  old.version = '0.3.0'
  const restored = parseSave(JSON.stringify(old))
  assert.deepEqual(restored.game,game)
  assert.deepEqual(restored.work.input.battle.job.operation,operation)
  assert.deepEqual(restored.work.input.battle.answers,[])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GROUPS } from '../src/data.mjs'
import { runBattle, strongholdStats } from '../src/battle.mjs'
import { replayAction } from '../src/action-resolution.mjs'
import { canCalculateEvent, eventSides } from '../src/events.mjs'
import { grantOperation, grantRule, runGrantedEvent } from '../src/grants.mjs'
import { raidPaths, runMilitary } from '../src/operations.mjs'
import { clone, opening, validatePosition } from '../src/position.mjs'
import { activeFaction, advanceCard, declarePivotal, finishAction, resolveVictory, startCards, validateSave } from '../src/sequence.mjs'
import { fresh, parseSave, serialize } from '../src/session.mjs'

const d6 = () => 6
const noBattle = () => assert.fail('A Battle was not expected')
const useDefault = choice => choice.defaultValue
function region(state,name,forces,sites=[]) {
  const land = state.land[name]
  land.units = Object.fromEntries(GROUPS.map(([key]) => [key,forces[key] ?? [0,0]]))
  land.sites = land.sites.map((_,index) => sites[index] ? {piece:sites[index],employer:null} : null)
  land.pros = [0,0]
  return land
}

test('Living Rules Battle example removes Cavalry simultaneously with an Ambushing Warband',() => {
  const state = opening(1826,{seat:'x'})
  state.land.Carvetii.units.cav[0] -= 2
  state.pools.notYet--
  const land = region(state,'Corieltauvi',{cav:[3,0],com:[1,0],xw:[1,0],xr:[9,2]},['hill','town'])
  state.humans = ['x','d','c']
  const rolls = [3,3,6]
  const outcome = runBattle(state,{name:'Corieltauvi',attacker:'x',defender:'d',source:'Battle',surprise:true},
    () => rolls.shift(),choice => {
      if (choice.stage === 'Pre-Battle') return 'ambush'
      if (choice.stage === 'Withdrawal') return choice.title.includes('Comitates') ? '1' : 'field'
      if (choice.stage === 'Charge / Ambush') return choice.options.find(option => option.label === 'Saxon Warbands')?.value ?? choice.defaultValue
      if (choice.stage === 'Assault') return 'none'
      return choice.defaultValue
    })
  assert.deepEqual(land.units.cav,[0,0])
  assert.deepEqual(land.units.com,[1,0])
  assert.deepEqual(land.units.xw,[0,0])
  assert.deepEqual(land.units.xr,[5,2])
  assert.equal(outcome.cavalryLosses,3)
  assert.ok(outcome.details.some(line => line.includes('Charge / Ambush: attackers take 3, defenders take 1.')))
})

test('seven raiding Scotti against a garrison and two withdrawn Militia leave one loaded Raider',() => {
  const state = opening(5,{seat:'c'})
  const land = region(state,'Votadini',{mil:[2,0],sr:[7,2]},['hill'])
  const report = runBattle(state,{name:'Votadini',attacker:'s',defender:'d',source:'Raid',attackers:{sr:[7,2]}},
    () => 1,choice => choice.stage === 'Withdrawal' ? '0' : choice.defaultValue)
  assert.deepEqual(report.destroyed,[0])
  assert.deepEqual(land.units.sr,[1,1])
  assert.deepEqual(land.units.mil,[0,0])
  assert.equal(report.attackerLosses,6)
  validatePosition(state)
})

test('Siege cannot commit the same two Troops to two Strongholds',() => {
  const state = opening(6,{seat:'x'})
  const land = region(state,'Corieltauvi',{mil:[2,0],xw:[2,0]},['fort','hill'])
  const report = runBattle(state,{name:'Corieltauvi',attacker:'x',defender:'d',source:'Battle',siegeOnly:true},
    () => 1,choice => choice.defaultValue)
  assert.equal(report.details.filter(line => line.includes('Siege removes')).length,1)
  assert.deepEqual(report.destroyed,[])
  assert.deepEqual(land.units.mil,[1,0])
  assert.equal(report.prestigeChange,0)
  assert.equal(strongholdStats(state,'Londinium','town').capacity,8)
  assert.equal(strongholdStats(state,'Londinium','town').coupCapacity,4)
})

test('Feeding the Ravens doubles Troop absorption at the Storm step',() => {
  const game = opening(11,{seat:'x'})
  game.tracks.prestige = 5
  region(game,'Corieltauvi',{xw:[3,0]},[null,'town'])
  const regular = clone(game)
  const config = {name:'Corieltauvi',attacker:'x',defender:'d',source:'Battle',surprise:true,assumeCoup:true}
  const attack = choice => choice.stage === 'Assault' ? '1' : choice.defaultValue
  const standard = runBattle(regular,config,() => 2,attack)
  game.markers[41] = {type:'momentum',side:'shaded',faction:'x'}
  const brave = runBattle(game,config,() => 2,attack)
  assert.equal(standard.attackerLosses,2)
  assert.equal(brave.attackerLosses,1)
  assert.equal(brave.prestigeChange,-2)
  assert.deepEqual(brave.destroyed,[1])
})

test('a pending Battle replays from the original board and seed after a save and reload',() => {
  const game = opening(9,{seat:'c'})
  game.pools.notYet--
  region(game,'Corieltauvi',{com:[1,0],xw:[1,0],xr:[6,2]},[null,'town'])
  const session = fresh(game)
  const job = {kind:'sample',label:'Sample',origin:clone(game),requests:[
    {name:'Corieltauvi',attacker:'x',defender:'d',source:'Battle',surprise:true},
  ]}
  const first = replayAction(game,job)
  assert.equal(first.prompt.stage,'Withdrawal')
  session.work = {kind:'edit',draft:null,input:{battle:{job,answers:['1']}}}
  const saved = parseSave(serialize(session))
  assert.deepEqual(replayAction(saved.game,saved.work.input.battle.job,saved.work.input.battle.answers),replayAction(game,job,['1']))
  assert.equal(game.land.Corieltauvi.units.com[0],1)
})

test('each ordinary Event face and each Pivotal has an in-app route',() => {
  const state = opening(1)
  const missing = []
  for (const faction of ['d','c','x','s']) {
    for (let id=1; id<=76; id++) {
      for (const side of eventSides(id)) {
        if (!canCalculateEvent(state,id,faction,side) && !grantRule(state,id,faction,side)) missing.push([faction,id,side])
      }
    }
  }
  assert.deepEqual(missing,[])
})

test('Swift Chargers grants a free Raid and Returns its Plunder immediately',() => {
  const game = opening(1,{seat:'x'})
  game.seas.brit = false
  const oldRenown = game.tracks.x
  const site = game.land.Durotriges
  runGrantedEvent(game,9,'x','shaded',{input:{grant:'x/Raid'},rows:[{space:'Durotriges',route:'brit'}],featRows:[]},
    () => 1,noBattle,useDefault)
  assert.deepEqual(game.land.Durotriges.units.xr,[0,0])
  assert.equal(game.tracks.x,oldRenown+site.pop)
  validatePosition(game)
})

test('Winter campaign doubles costs and immediately grants Trap where actual March units arrive',() => {
  const game = opening(5,{seat:'x'})
  region(game,'Novantae',{xw:[3,0]},[])
  region(game,'Votadini',{sw:[1,0]},['ss'])
  const fought = []
  const prior = game.tracks.x
  runGrantedEvent(game,41,'x','unshaded',{input:{grant:'x/March'},rows:[{origin:'Novantae',destination:'Votadini',xw:2}],featRows:[]},
    () => 1,config => fought.push(config),useDefault)
  assert.equal(game.tracks.x,prior-2)
  assert.equal(game.land.Votadini.units.xw[0],2)
  assert.equal(fought[0].name,'Votadini')
  assert.equal(fought[0].noDefenderEvade,true)
  assert.equal(fought[0].trapSide,'attacker')
})

test('free Battle with Reinforce in St Germanus increases the roll by four',() => {
  const game = opening(5)
  region(game,'Novantae',{sw:[1,0]},['ss'])
  region(game,'Carvetii',{mil:[3,0]},[null,'hill'])
  const oldBlue = game.tracks.blue
  const reports = []
  const note = runGrantedEvent(game,23,'d','unshaded',{input:{grant:'c/Battle'},rows:[{space:'Novantae',enemy:'s'}],
    featRows:[{space:'Carvetii',mode:'move',destination:'Novantae',mil:3}]},() => 1,report => reports.push(report),useDefault)
  assert.equal(game.land.Novantae.units.mil[0],3)
  assert.equal(game.tracks.blue,oldBlue)
  assert.equal(reports.length,1)
  assert.match(note,/reinforced with 3/)
})

test('Myrddin counts a Command plus its Feat as an Event while keeping its faction eligible',() => {
  const game = opening(2)
  const orderCard = 57
  startCards(game,orderCard,22)
  while (activeFaction(game) !== 'c') finishAction(game,'pass','Pass')
  const input = {grant:'c/Trade',grantFeat:'Rule',tradeAll:'yes'}
  assert.equal(grantOperation(game,57,'c','single',input).feat,'Rule')
  const job = {kind:'action',option:'event',id:57,faction:'c',side:'single',description:'Myrddin',
    overrides:{c:true},operation:{grant:true,input,rows:[],featRows:[{space:'Atrebates',mode:'wealth'}]}}
  const {after} = replayAction(game,job)
  assert.equal(after.acts.at(-1).option,'event')
  assert.equal(after.tracks.wealth,game.tracks.wealth+1)
  assert.equal(after.overrides.c,true)
  validateSave(after)
})

test('declaring Saxons ineligible on #73 lasts through the postponed Event',() => {
  const state = opening(41,{seat:'x',scenario:'De Excidio Britanniae'})
  startCards(state,22,5)
  declarePivotal(state,'s')
  const job = {kind:'action',option:'event',description:'Conspiratio Barbarica',requests:[],afterRaid:{type:'conspiratio-barbarica'}}
  const answers = ['','Durotriges']
  for (let i=0;i<25;i++) {
    const result = replayAction(state,job,answers)
    if (result.prompt) { answers.push(result.prompt.defaultValue); continue }
    const {after} = result
    assert.ok(after.markers[73])
    assert.ok(!after.eligibility.includes('x'))
    assert.equal(after.overrides.x,false)
    while (activeFaction(after)) finishAction(after,'pass','Pass')
    advanceCard(after,null)
    assert.equal(after.current,22)
    assert.ok(!after.eligibility.includes('x'))
    validateSave(after)
    return
  }
  assert.fail('Saxon reply did not finish')
})

test('Scotti can redeploy Niall Raiders after making a Raid roll',() => {
  const game = opening(1,{seat:'s'})
  game.markers[68] = {type:'capability',side:'shaded'}
  game.tracks.niall = 3
  const route = raidPaths(game,'s','Dumnonii','').find(route => route.key === 'hib')
  assert.ok(route)
  runMilitary(game,{faction:'s',command:'Raid',feat:'',options:{free:true},rows:[{space:'Dumnonii',route:'hib',niall:2}]},
    () => 1,noBattle,useDefault)
  assert.equal(game.tracks.niall,1)
  assert.deepEqual(game.land.Dumnonii.units.sr,[4,1])
  validatePosition(game)
})

test('Difficult mode compares final margins after performing the applicable Recovery',() => {
  const game = opening(1,{scenario:'De Excidio Britanniae',seat:'d',difficulty:'Difficult'})
  game.epoch = 6
  game.land.Silures.pros = [0,0]
  let recovered = false
  resolveVictory(game,() => { recovered = true })
  assert.equal(recovered,true)
  assert.equal(game.result.reason,'final')
  assert.ok(game.land.Silures.pros[0])
})

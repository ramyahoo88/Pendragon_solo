import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GROUPS } from '../src/data.mjs'
import { replayAction } from '../src/action-resolution.mjs'
import { planBotGrant } from '../src/bots.mjs'
import { eventChoices, runEvent } from '../src/events.mjs'
import { runMilitary } from '../src/operations.mjs'
import { availability, clone, opening, validatePosition } from '../src/position.mjs'
import { activeFaction, finishAction, startCards } from '../src/sequence.mjs'
import { fresh, parseSave, push, rewind, serialize } from '../src/session.mjs'

const donor = (destination,group,slot) => `event-recycle-${destination}-${group}-${slot}`
const noBattle = () => assert.fail('Unexpected Battle')

test('Dyfed lets human Civitates fill a shortage with Militia while keeping Comitates boxed', () => {
  const game = opening(1016002,{seat:'c'})
  game.land.Dobunni.units.mil[0] += availability(game).mil
  game.land.Demetae.units.sw = [3,0]
  const noDonors = clone(game)
  runEvent(noDonors,62,'c','unshaded')
  assert.equal(noDonors.land.Demetae.units.mil[0],1)
  assert.equal(noDonors.land.Demetae.units.sw[0],0)
  const input = Object.fromEntries([1,2,3].map(slot => [donor('Demetae','mil',slot),'Dobunni']))
  const preview = eventChoices(game,62,'c','unshaded',input)
  assert.match(preview.summary,/3 requested · 0 from Available · 3 from donors/)
  const note = runEvent(game,62,'c','unshaded',input)
  assert.match(note,/3 Civitates troops placed/)
  assert.equal(game.land.Demetae.units.mil[0],4)
  assert.equal(game.land.Dobunni.units.mil[0],5)
  assert.equal(game.pools.notYet,15)
  validatePosition(game)
})

test('Dyfed supports each in-play Civitates troop type and falls back to available replacements', () => {
  const game = opening(1016002,{seat:'c'})
  game.land.Dobunni.units.mil[0] += availability(game).mil-1
  game.pools.notYet = 14
  game.land.Dobunni.units.com = [1,1]
  game.land.Demetae.units.sw = [3,0]
  const input = {comitates:1,[donor('Demetae','com',1)]:'Dobunni',[donor('Demetae','mil',1)]:'Dobunni'}
  runEvent(game,62,'c','unshaded',input)
  assert.deepEqual(game.land.Demetae.units.com,[1,0])
  assert.deepEqual(game.land.Dobunni.units.com,[0,0])
  assert.equal(game.land.Demetae.units.mil[0],3)
  assert.equal(game.pools.notYet,14)
  validatePosition(game)

  const spare = opening(1016002,{seat:'c'})
  spare.pools.notYet = 14
  spare.land.Dobunni.units.com = [1,0]
  spare.land.Demetae.units.sw = [3,0]
  runEvent(spare,62,'c','unshaded',{comitates:1})
  assert.deepEqual(spare.land.Dobunni.units.com,[1,0])
  assert.deepEqual(spare.land.Demetae.units.com,[0,0])
  assert.equal(spare.land.Demetae.units.mil[0],4)
  validatePosition(spare)
})

test('Cunedda uses Votadini losses before requesting supplementary donors', () => {
  const game = opening(1016001,{seat:'c'})
  game.land.Dobunni.units.mil[0] += availability(game).mil
  const input = {[donor('Ordovices','mil',1)]:'Dobunni',[donor('Ordovices','mil',2)]:'Dobunni'}
  const preview = eventChoices(game,13,'c','unshaded',input)
  assert.match(preview.summary,/4 requested · 2 from Available · 2 from donors/)
  assert.equal(preview.fields.filter(field => field.name.startsWith('event-recycle-')).length,2)
  runEvent(game,13,'c','unshaded',input)
  assert.equal(game.land.Votadini.units.mil[0],2)
  assert.equal(game.land.Ordovices.units.mil[0],5)
  assert.equal(game.land.Dobunni.units.mil[0],6)
  validatePosition(game)
})

test('Vortigern uses newly Available Saxon Warbands and permits only native donors', () => {
  const game = opening(1016003,{seat:'x'})
  game.land.Cantiaci.units.cxw = [2,0]
  game.land.Regni.units.dxw = [1,0]
  game.land.Iceni.units.xw[0] += availability(game).xw
  const input = {'keep-cav':1,'keep-mil':1,'keep-cxw':0}
  const key = donor('Cantiaci','xw',1)
  assert.deepEqual(eventChoices(game,49,'x','shaded',input).fields.find(field => field.name === key)
    .options.map(item => item.value),['','Iceni'])
  const before = clone(game)
  assert.throws(() => runEvent(game,49,'x','shaded',{...input,[key]:'Regni'}),/Choose a valid/)
  assert.deepEqual(game,before)
  for (let slot=1;slot<=4;slot++) input[donor('Cantiaci','xw',slot)] = 'Iceni'
  runEvent(game,49,'x','shaded',input)
  assert.deepEqual(game.land.Cantiaci.units.xw,[6,0])
  assert.deepEqual(game.land.Cantiaci.units.cxw,[0,0])
  assert.deepEqual(game.land.Regni.units.dxw,[1,0])
  assert.deepEqual(game.land.Iceni.units.xw,[18,0])
  validatePosition(game)
})

test('Event donor inputs cannot recycle on a bot or another faction’s behalf', () => {
  for (const [seat,faction] of [['d','c'],['britons','d']]) {
    const game = opening(1016002,{seat})
    game.land.Dobunni.units.mil[0] += availability(game).mil
    game.land.Demetae.units.sw = [3,0]
    const input = {[donor('Demetae','mil',1)]:'Dobunni'}
    assert.equal(eventChoices(game,62,faction,'unshaded',input).fields.length,0)
    runEvent(game,62,faction,'unshaded',input)
    assert.equal(game.land.Demetae.units.mil[0],1)
    assert.equal(game.land.Dobunni.units.mil[0],8)
    validatePosition(game)
  }
})

function raidPosition(faction,seed=1020000) {
  const game = opening(seed,{seat:faction})
  game.land.Iceni.units[faction+'r'][0] = availability(game)[faction+'r']
  game.seas.brit = game.seas.hib = false
  startCards(game,25,22)
  while (activeFaction(game) !== faction) finishAction(game,'pass','Pass')
  return game
}

function raidJob(faction,spaces=['Durotriges']) {
  return {kind:'action',label:'Raid',option:'command',description:'Raid',faction,
    operation:{faction,command:'Raid',rows:spaces.map(space => ({
      space,route:faction === 'x' ? 'brit' : 'hib',dice:'one',
    }))}}
}

test('Saxon and Scotti Raids offer reuse only after the landing roll', () => {
  for (const faction of ['x','s']) {
    const game = raidPosition(faction)
    const original = clone(game)
    const job = raidJob(faction)
    const {prompt,dice} = replayAction(game,job)
    assert.equal(prompt.stage,'Raid supply')
    assert.deepEqual(prompt.supply,{requested:3,available:0,shortfall:3})
    assert.equal(prompt.counts[0].max,3)
    assert.deepEqual(dice.map(die => die.value),[3])
    const declined = replayAction(game,job,[prompt.defaultValue])
    assert.equal(declined.after.land.Durotriges.units[faction+'r'][0],0)
    const accepted = replayAction(game,job,['3'])
    assert.deepEqual(accepted.dice,dice)
    assert.deepEqual(accepted.after.land.Durotriges.units[faction+'r'],[3,2])
    assert.equal(accepted.after.land.Iceni.units[faction+'r'][0],(faction === 'x' ? 25 : 30)-3)
    assert.equal(accepted.after.tracks[faction],game.tracks[faction]-(faction === 'x' ? 1 : 0))
    assert.deepEqual(game,original)
    validatePosition(accepted.after)
  }
})

test('Raid supply uses stock first, preserves saved donor counts and consumes only chosen units', () => {
  const game = raidPosition('x')
  game.land.Iceni.units.xr = [22,0]
  game.land.Regni.units.xr = [2,2]
  const job = raidJob('x')
  const {prompt,dice} = replayAction(game,job)
  assert.deepEqual(prompt.supply,{requested:3,available:1,shortfall:2})
  assert.throws(() => replayAction(game,job,['2,2']),/Reuse at most 2/)
  const session = fresh(game)
  session.work = {kind:'action',input:{battle:{job,answers:[],countDraft:{index:0,values:[2,0]}}},draft:null}
  const restored = parseSave(serialize(session))
  const pending = restored.work.input.battle
  assert.deepEqual(replayAction(restored.game,pending.job),{prompt,dice})
  const result = replayAction(restored.game,pending.job,[pending.countDraft.values.join(',')])
  assert.deepEqual(result.dice,dice)
  assert.deepEqual(result.after.land.Durotriges.units.xr,[3,2])
  assert.deepEqual(result.after.land.Regni.units.xr,[0,0])
  assert.deepEqual(result.after.land.Iceni.units.xr,[22,0])
  assert.match(result.detail,/2 Plunder there went off board/)
  push(restored,'Raid',result.after)
  assert.ok(rewind(restored,'undo'))
  assert.deepEqual(restored.game,game)
  assert.ok(rewind(restored,'redo'))
  assert.deepEqual(restored.game,result.after)
})

test('Each Raid target uses the supply remaining after earlier landings', () => {
  const game = raidPosition('x',1021000)
  game.land.Iceni.units.xr[0] -= 3
  const job = raidJob('x',['Durotriges','Dumnonii'])
  const result = replayAction(game,job)
  assert.equal(result.prompt.name,'Dumnonii')
  assert.deepEqual(result.dice.map(die => die.value),[3,3])
  const resolved = replayAction(game,job,['0,3'])
  assert.deepEqual(resolved.after.land.Durotriges.units.xr,[3,2])
  assert.deepEqual(resolved.after.land.Dumnonii.units.xr,[3,1])
  assert.deepEqual(resolved.after.land.Iceni.units.xr,[19,0])
  validatePosition(resolved.after)
})

test('A Raid with too few legal donors can land partially and a bot uses stock only', () => {
  const game = raidPosition('s')
  game.land.Iceni.units.sr = [1,0]
  game.land.Durotriges.units.sr = [29,0]
  const job = raidJob('s')
  const {prompt} = replayAction(game,job)
  assert.deepEqual(prompt.counts.map(item => item.max),[1])
  const result = replayAction(game,job,['1'])
  assert.equal(result.after.land.Durotriges.units.sr[0],30)
  assert.match(result.detail,/2 of 3 rolled Raiders left unplaced/)
  const bot = clone(game)
  bot.human = 'd'
  bot.humans = ['d']
  runMilitary(bot,job.operation,() => 3,noBattle,() => assert.fail('A bot was offered donors'))
  assert.deepEqual(bot.land.Iceni.units.sr,[1,0])
  assert.deepEqual(bot.land.Durotriges.units.sr,[29,0])
  validatePosition(result.after)
})

function germanusPosition(loaded=false) {
  const game = opening(1016023,{seat:'d'})
  for (const space of Object.values(game.land)) {
    space.units = Object.fromEntries(GROUPS.map(([key]) => [key,[0,0]]))
    space.sites.fill(null)
    space.pros = [0,0]
  }
  game.pools.notYet = loaded ? 11 : 9
  game.land.Dumnonii.units.mil = [29,0]
  game.land.Atrebates.units.mil = [1,0]
  game.land.Atrebates.units.xw = [4,4]
  game.land.Atrebates.sites[1] = {piece:'town',employer:null}
  game.land.Catuvellauni.units.com = loaded ? [4,2] : [3,0]
  game.land.Catuvellauni.sites[0] = {piece:'town',employer:null}
  if (!loaded) {
    game.land.Durotriges.units.com = [3,0]
    game.land.Durotriges.sites[0] = {piece:'town',employer:null}
  }
  return game
}

test('St Germanus rolls for one origin and preserves the free Event cost', () => {
  const game = germanusPosition()
  const dice = []
  const plan = planBotGrant(game,23,'d','unshaded',(sides,label) => {
    dice.push({sides,label})
    return 1
  })
  assert.equal(dice.filter(die => die.label.startsWith('Reinforce ·')).length,1)
  assert.equal(plan.requests[0].name,'Atrebates')
  assert.deepEqual(plan.base.land.Atrebates.units.com,[3,0])
  const origins = ['Durotriges','Catuvellauni'].map(name => plan.base.land[name].units.com[0])
  assert.deepEqual(origins.sort(),[0,3])
  assert.deepEqual(plan.base.tracks,game.tracks)
  validatePosition(plan.base)
})

test('St Germanus uses its movement bonus and takes unloaded Comitates before loaded ones', () => {
  const game = germanusPosition(true)
  const plan = planBotGrant(game,23,'d','unshaded',() => 1)
  assert.deepEqual(plan.base.land.Atrebates.units.com,[3,1])
  assert.deepEqual(plan.base.land.Catuvellauni.units.com,[1,1])
  assert.deepEqual(plan.base.tracks,game.tracks)
  validatePosition(plan.base)
})

test('St Germanus Reinforce moves Dux Troops with human consent and can use the full bonus', () => {
  const game = germanusPosition(true)
  game.land.Catuvellauni.units.cav = [5,0]
  const declined = planBotGrant(game,23,'d','unshaded',() => 6)
  assert.deepEqual(declined.base.land.Catuvellauni.units.cav,[5,0])
  const allowed = planBotGrant(game,23,'d','unshaded',() => 6,{input:{alliedConsent:'yes'}})
  assert.deepEqual(allowed.base.land.Atrebates.units.cav,[5,0])
  assert.deepEqual(allowed.base.land.Atrebates.units.com,[3,1])
  assert.deepEqual(allowed.base.land.Catuvellauni.units.com,[1,1])
  validatePosition(allowed.base)
})

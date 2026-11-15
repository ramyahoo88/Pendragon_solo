import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { replayAction } from '../src/action-resolution.mjs'
import { runBattle } from '../src/battle.mjs'
import { GROUPS } from '../src/data.mjs'
import { epochChoices, runEpochEconomy } from '../src/epoch-economy.mjs'
import { militaryFields, runMilitary } from '../src/operations.mjs'
import { availability, boardTotals, makeRoller, opening, setImperium } from '../src/position.mjs'
import { advanceEpoch, startCards, validateSave } from '../src/sequence.mjs'
import { fresh, parseSave, push, rewind, serialize } from '../src/session.mjs'

const one = () => 1
const defaultChoice = prompt => prompt.defaultValue
const hill = {piece:'hill',employer:null}

function emptyBoard(seed,seat) {
  const game = opening(seed,{seat})
  for (const space of Object.values(game.land)) {
    space.units = Object.fromEntries(GROUPS.map(([key]) => [key,[0,0]]))
    space.sites.fill(null)
    space.pros = [0,0]
  }
  game.markers = {}
  game.pools.notYet = 0
  return game
}

function cubePosition(key = 'com', seat = 'x') {
  const game = emptyBoard(935001,seat)
  setImperium(game,'f')
  game.land.Atrebates.units[key] = [key === 'mil' ? 6 : 4,0]
  for (const name of ['Regni','Cantiaci']) {
    game.land[name].sites[0] = hill
    game.land[name].units.xw = [2,0]
  }
  game.tracks.wealth = 2
  return game
}

test('Civitates Upkeep splits either cube type to control both nearest Hillforts', () => {
  for (const key of ['com','mil']) {
    const game = cubePosition(key)
    runEpochEconomy(game,'Civitates Upkeep',{},one)
    assert.deepEqual(game.land.Regni.units[key],[2,0])
    assert.deepEqual(game.land.Cantiaci.units[key],[2,0])
    assert.equal(boardTotals(game).pop.c,4)
    assert.deepEqual(game.land.Atrebates.units[key],[0,0])
    validateSave(game)
  }
})

test('Cube quarters reserve restricted sources while reaching the joint Control maximum', () => {
  const game = emptyBoard(935011,'x')
  setImperium(game,'f')
  game.land.Atrebates.units.mil = [2,0]
  game.land.Londinium.units.com = [4,0]
  game.tracks.wealth = 2
  // Atrebates can reach Dobunni or Cantiaci, Londinium can reach Cantiaci or Trinovantes.
  for (const [name,enemies] of [['Dobunni',2],['Cantiaci',1],['Trinovantes',3]]) {
    game.land[name].sites[0] = hill
    game.land[name].units.xw = [enemies,0]
  }
  game.land.Cantiaci.pop = 3
  // A more distant eligible Stronghold cannot receive any of these cubes.
  game.land.Dumnonii.sites[0] = hill
  runEpochEconomy(game,'Civitates Upkeep',{},one)
  assert.equal(boardTotals(game).pop.c,8)
  assert.deepEqual(game.land.Dobunni.units.mil,[2,0])
  assert.deepEqual(game.land.Cantiaci.units.com,[1,0])
  assert.deepEqual(game.land.Trinovantes.units.com,[3,0])
  assert.deepEqual(game.land.Dumnonii.units.com,[0,0])
  validateSave(game)
})

test('Tied cube Control choices use recorded dice and keep all four cubes', () => {
  const positions = [1,2].map(die => {
    const game = cubePosition()
    game.land.Regni.units.xw = [4,0]
    game.land.Cantiaci.units.xw = [4,0]
    const dice = []
    runEpochEconomy(game,'Civitates Upkeep',{},makeRoller(game,dice,[die]))
    assert.equal(boardTotals(game).pop.c,2)
    assert.equal(dice.length,1)
    assert.match(dice[0].label,/cube quarters.*tie/)
    return game.land.Regni.units.com[0]
  })
  assert.deepEqual(new Set(positions),new Set([0,4]))
})

test('Human cube quarters validate all surviving pieces and retain the old destination field', () => {
  const good = {'cube-quarters-mil-Atrebates-Regni':2,'cube-quarters-mil-Atrebates-Cantiaci':2}
  const game = cubePosition('mil','c')
  const controls = epochChoices(game,'Civitates Upkeep').fields.filter(field => field.name.startsWith('cube-quarters-'))
  assert.deepEqual(Object.fromEntries(controls.map(({name,max}) => [name,max])),Object.fromEntries(Object.keys(good).map(name => [name,4])))
  runEpochEconomy(game,'Civitates Upkeep',good,one)
  assert.equal(boardTotals(game).pop.c,4)
  assert.throws(() => runEpochEconomy(cubePosition('mil','c'),'Civitates Upkeep',{
    'cube-quarters-mil-Atrebates-Regni':3,
  },one),/Assign all 4 surviving Militia/)
  assert.throws(() => runEpochEconomy(cubePosition('mil','c'),'Civitates Upkeep',{
    'cube-quarters-mil-Atrebates-Dumnonii':4,
  },one),/nearest Towns or Hillforts/)
  const legacy = cubePosition('com','c')
  runEpochEconomy(legacy,'Civitates Upkeep',{'nearest-com-Atrebates':'Regni'},one)
  assert.deepEqual(legacy.land.Regni.units.com,[4,0])
})

test('Upkeep moves and Control changes survive Apply, save and Undo/Redo', () => {
  const game = cubePosition()
  startCards(game,22,5)
  game.revealed.push(1,2,3,4,6,7,77)
  game.current = 77
  game.next = 7
  game.epoch = 1
  game.eventIndex = 7
  game.epochPhase = 'Civitates Upkeep'
  const after = structuredClone(game)
  const upkeep = {moves:[],notes:[]}
  const note = runEpochEconomy(after,after.epochPhase,{},one,upkeep)
  advanceEpoch(after,{note,upkeep})
  const session = fresh(game)
  push(session,'Civitates Upkeep',after)
  assert.equal(session.game.log.at(-1).upkeep.moves.length,2)
  assert.ok(rewind(session,'undo'))
  const reloaded = parseSave(serialize(session))
  assert.ok(rewind(reloaded,'redo'))
  const report = reloaded.game.log.at(-1).upkeep
  assert.deepEqual(report,upkeep)
  assert.equal(report.control.find(change => change.name === 'Regni').after,'c')
})

function reinforcePosition() {
  const game = emptyBoard(935002,'c')
  startCards(game,22,5)
  game.land.Regni.sites[0] = hill
  game.land.Regni.units.mil = [1,0]
  game.land.Regni.units.xw = [2,0]
  game.land.Dumnonii.units.mil = [29,0]
  return game
}

const reinforceSpec = (input = {}) => ({
  faction:'c',command:'Battle',feat:'Reinforce',input,
  rows:[{space:'Regni',enemy:'x'}],featRows:[{space:'Regni',mode:'muster',mil:1}],
})

test('A casualty can return the Militia used by an after-Battle Muster', () => {
  const game = reinforcePosition()
  const funds = game.tracks.blue
  assert.equal(availability(game).mil,0)
  assert.throws(() => runMilitary(game,reinforceSpec(),one,config => runBattle(game,config,one)),/not enough Available Militia/)
  runMilitary(game,reinforceSpec({featTiming:'after'}),one,config => runBattle(game,config,one))
  assert.deepEqual(game.land.Regni.units.mil,[1,0])
  assert.deepEqual(game.land.Regni.units.xw,[2,0])
  assert.equal(game.tracks.blue,funds-2)
  validateSave(game)
})

test('Between Battles, Reinforce can use the freed Militia to start the second Battle', () => {
  const game = reinforcePosition()
  game.land.Cantiaci.sites[0] = hill
  game.land.Cantiaci.units.xr = [1,0]
  const spec = reinforceSpec({featTiming:'1'})
  spec.rows.push({space:'Cantiaci',enemy:'x'})
  spec.featRows[0].space = 'Cantiaci'
  const funds = game.tracks.blue
  runMilitary(game,spec,one,config => runBattle(game,config,one))
  assert.deepEqual(game.land.Regni.units.mil,[0,0])
  assert.deepEqual(game.land.Cantiaci.units.xr,[0,0])
  assert.equal(game.tracks.blue,funds-2)
  validateSave(game)
})

test('Pillage after combat uses only the surviving carrying capacity', () => {
  for (const [timing,prosperity] of [['before',[2,0]],['after',[2,1]]]) {
    const game = emptyBoard(935003,'c')
    const land = game.land.Regni
    land.units.com = [3,0]
    land.units.xw = [2,0]
    land.units.sw = [2,0]
    land.pros = [2,2]
    const spec = {...reinforceSpec({featTiming:timing}),feat:'Pillage',featRows:[{space:'Regni'}]}
    runMilitary(game,spec,one,config => runBattle(game,config,one))
    assert.deepEqual(game.land.Regni.pros,prosperity)
    assert.deepEqual(game.land.Regni.units.com,[1,1])
  }
})

test('Reinforce exposes recycling for Muster and enforces the source and unit limits', () => {
  const game = reinforcePosition()
  for (const feat of ['Reinforce','Pillage']) {
    const spec = militaryFields(game,'c','Battle',feat,{},{rows:2})
    assert.deepEqual(spec.controls.find(field => field.key === 'featTiming').options.map(([value]) => value),['before','1','after'])
    assert.equal(spec.controls.some(field => field.key === 'recycle'),feat === 'Reinforce')
  }
  const move = militaryFields(game,'c','Battle','Reinforce',{},{'feats0-mode':'move'})
  assert.ok(!move.controls.some(field => field.key === 'recycle'))
  assert.ok(move.featFields.rows.some(field => field.key === 'destination' && field.mode === 'move'))
  for (const [recycle,error] of [['comitates@Dumnonii=1',/unit type/],['militia@Regni=1',/other than their destination/],
    ['militia@Dumnonii=31',/between 0 and 30/],['militia@Cantiaci=1',/not enough Militia/]]) {
    assert.throws(() => runMilitary(game,reinforceSpec({recycle}),one,config => runBattle(game,config,one)),error)
  }
  runMilitary(game,reinforceSpec({recycle:'militia@Dumnonii=1'}),one,config => runBattle(game,config,one))
  assert.deepEqual(game.land.Dumnonii.units.mil,[28,0])
  assert.deepEqual(game.land.Regni.units.xw,[1,0])
  assert.deepEqual(game.land.Regni.units.mil,[0,0])
  validateSave(game)
})

test('Lone Home Raiders Evade on 4 and the reason survives save and reload without a Field Battle', () => {
  const game = emptyBoard(937984,'c')
  game.land.Silures.units.com = [2,0]
  game.land.Silures.units.sr = [4,0]
  startCards(game,22,5)
  const result = replayAction(game,{kind:'action',option:'command',description:'Battle',operation:{
    faction:'c',command:'Battle',rows:[{space:'Silures',enemy:'s'}],
  }})
  assert.equal(result.dice[0].value,4)
  assert.match(result.detail,/Scotti Evasion succeeds/)
  assert.deepEqual(result.after.land.Silures.units.sr,[4,0])
  const reloaded = parseSave(serialize(fresh(result.after)))
  const [battle] = reloaded.game.log.at(-1).battles
  assert.deepEqual(battle.field,[])
  assert.ok(battle.tactics.some(line => line.includes('Evade on 4–6') && line.includes('alone in Home terrain')))
})

test('Clear-terrain Raiders stay with effective Warbands and Evade when none can strike back', () => {
  for (const warbands of [1,2]) {
    const game = emptyBoard(936006,'d')
    const land = game.land.Regni
    land.units.cav = [1,0]
    land.units.sr = [1,0]
    land.units.sw = [warbands,0]
    const report = runBattle(game,{name:'Regni',attacker:'d',defender:'s',source:'Battle'},()=>6,defaultChoice)
    if (warbands === 2) {
      assert.doesNotMatch(report.details.join(' '),/Evasion/)
      assert.deepEqual(land.units.cav,[0,0])
    } else {
      assert.match(report.details.join(' '),/Evasion succeeds/)
      assert.deepEqual(land.units.cav,[1,0])
    }
  }
})

test('Captured Stronghold Plunder fills the bot faction’s carriers before allies', () => {
  for (const loaded of [0,2]) {
    const game = emptyBoard(936003,'s')
    const land = game.land.Regni
    land.sites[0] = {piece:'ss',employer:null}
    land.units.com = [2,0]
    land.units.dxw = [2,loaded]
    runBattle(game,{name:'Regni',attacker:'d',defender:'s',source:'Battle'},one,defaultChoice)
    assert.equal(land.sites[0],null)
    assert.deepEqual(land.units.dxw,[2,2])
    assert.deepEqual(land.units.com,[2,loaded])
  }
})

test('Dux restores Prosperity before Fragmentation if possible, including with empty carriers', () => {
  for (const [imperium,prosperity,expected,cargo] of [['rm',[0,0],[1,0],0],['f',[0,0],[0,0],1],['rm',[2,2],[2,2],1]]) {
    const game = emptyBoard(936004,'x')
    setImperium(game,imperium)
    const land = game.land.Regni
    land.units.cav = [2,0]
    land.units.dxw = [1,0]
    land.units.xr = [2,2]
    land.pros = prosperity
    runBattle(game,{name:'Regni',attacker:'d',defender:'x',source:'Battle'},one,defaultChoice)
    assert.deepEqual(land.pros,expected)
    assert.deepEqual(land.units.dxw,[1,cargo])
  }
})

test('Barbarian bot takes recovered Plunder even with the option to convert it to Renown', () => {
  const game = emptyBoard(936007,'d')
  const land = game.land.Regni
  land.units.xw = [4,0]
  land.units.dsw = [2,2]
  land.sites[0] = {piece:'xs',employer:null}
  const renown = game.tracks.x
  runBattle(game,{name:'Regni',attacker:'x',defender:'d',source:'Battle'},one,defaultChoice)
  assert.deepEqual(land.units.xw,[2,1])
  assert.equal(game.tracks.x,renown)
})

test('One bot Siege forces the highest-priority minimum loss', () => {
  const game = emptyBoard(936005,'c')
  const land = game.land.Corieltauvi
  land.sites = [hill,hill]
  land.units.xw = [2,0]
  land.units.mil = [1,0]
  land.units.com = [1,0]
  const report = runBattle(game,{name:'Corieltauvi',attacker:'x',defender:'d',source:'Battle'},one,prompt =>
    prompt.stage === 'Withdrawal' ? (prompt.title.includes('Comitates') ? '1' : '0') : prompt.defaultValue)
  assert.match(report.details.join(' '),/Siege removes Comitates at Ratae/)
  assert.deepEqual(land.units.mil,[1,0])
  assert.deepEqual(land.units.com,[0,0])
})

test('Unconfirmed Omens counts are separate from committed choices in a saved prompt', () => {
  const old = JSON.parse(readFileSync(new URL('./fixtures/audit-v035/F3-omens-assault.json',import.meta.url),'utf8'))
  const session = old.session
  const record = session.work.input.battle
  const first = replayAction(session.game,record.job,[])
  assert.match(first.prompt.title,/Lindum/)
  record.answers = ['skip','play']
  const {prompt} = replayAction(session.game,record.job,record.answers)
  assert.match(prompt.title,/Ratae/)
  record.countDraft = {index:prompt.index,values:[2,6]}
  const reloaded = parseSave(serialize(session)).work.input.battle
  assert.deepEqual(reloaded.answers,['skip','play'])
  assert.deepEqual(reloaded.countDraft,record.countDraft)
  const result = replayAction(session.game,record.job,[...reloaded.answers,reloaded.countDraft.values.join(',')])
  assert.match(result.detail,/Omens halves 8 Units/)
  record.countDraft.index++
  assert.throws(() => parseSave(serialize(session)),/Invalid unconfirmed Omens counts/)
})

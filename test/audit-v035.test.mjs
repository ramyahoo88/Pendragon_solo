import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { replayAction } from '../src/action-resolution.mjs'
import { runBattle } from '../src/battle.mjs'
import { runCommandFeat } from '../src/commands.mjs'
import { runEpochEconomy } from '../src/epoch-economy.mjs'
import { militaryFields, runMilitary } from '../src/operations.mjs'
import { availability, boardTotals, makeRoller } from '../src/position.mjs'
import { validateSave } from '../src/sequence.mjs'
import { fresh, parseSave, push, rewind, serialize } from '../src/session.mjs'

const one = () => 1
function fixture(name) {
  return readFileSync(new URL(`./fixtures/audit-v035/${name}.json`,import.meta.url),'utf8')
}
const quarters = () => parseSave(fixture('F1-bot-quarters')).game
const entreat = () => parseSave(fixture('F2-battle-entreat')).game
const omens = () => parseSave(fixture('F3-omens-assault'))

test('§§6.6.2 and 8.7.7: bot Foederati maximize controlled Population across matching Settlements', () => {
  const game = quarters()
  const report = {moves:[],notes:[]}
  runEpochEconomy(game,'Civitates Upkeep',{},one,report)
  assert.equal(boardTotals(game).pop.c,4)
  assert.ok(report.moves.some(move => move.from === 'Regni' && move.to === 'Cantiaci' && move.key === 'cxw'))
  validateSave(game)
})

test('Foederati split a stack when both Regions require troops, and explain when quarters are already optimal', () => {
  const game = quarters()
  game.land.Regni.units.xw = [2,0]
  game.land.Cantiaci.units.xw = [2,0]
  const report = {moves:[],notes:[]}
  runEpochEconomy(game,'Civitates Upkeep',{},one,report)
  assert.deepEqual(report.moves,[{from:'Regni',to:'Cantiaci',key:'cxw',count:2}])
  assert.equal(boardTotals(game).pop.c,4)
  const unchanged = {moves:[],notes:[]}
  runEpochEconomy(game,'Civitates Upkeep',{},one,unchanged)
  assert.deepEqual(unchanged.moves,[])
  assert.ok(unchanged.notes.some(line => line.includes('already attain that maximum')))
})

test('Foederati of both Nations can share Control while each uses only its own Settlement', () => {
  const game = quarters()
  game.land.Regni.sites[1] = {piece:'ss',employer:'c'}
  game.land.Regni.units.cxw = [2,0]
  game.land.Regni.units.xw = [3,0]
  game.land.Cantiaci.units.csw = [2,0]
  game.land.Cantiaci.units.xw = [2,0]
  runEpochEconomy(game,'Civitates Upkeep',{},one)
  assert.equal(boardTotals(game).pop.c,4)
  assert.deepEqual(game.land.Regni.units.csw,[2,0])
  assert.deepEqual(game.land.Cantiaci.units.cxw,[2,0])
  validateSave(game)
})

test('Tied legal Foederati quarters are resolved by recorded dice', () => {
  const layouts = [1,2,3,4].map(result => {
    const game = quarters()
    const dice = []
    runEpochEconomy(game,'Civitates Upkeep',{},makeRoller(game,dice,[result]))
    assert.equal(boardTotals(game).pop.c,4)
    assert.ok(dice.some(die => die.label.includes('Foederati quarters')))
    return game.land.Regni.units.cxw[0]
  })
  assert.equal(new Set(layouts).size,4)
})

test('Human Civitates can still allocate their own Foederati', () => {
  const game = quarters()
  game.human = 'c'
  game.humans = ['c']
  runEpochEconomy(game,'Civitates Upkeep',{'quarters-cxw-Regni':'1','quarters-cxw-Cantiaci':'3'},one)
  assert.equal(boardTotals(game).pop.c,4)
  assert.deepEqual(game.land.Regni.units.cxw,[1,0])
  validateSave(game)
})

test('Foederati become independent when their Nation has no matching Settlement', () => {
  const game = quarters()
  game.land.Regni.sites[0] = null
  game.land.Cantiaci.sites[0] = null
  runEpochEconomy(game,'Civitates Upkeep',{},one)
  assert.deepEqual(game.land.Regni.units.cxw,[0,0])
  assert.deepEqual(game.land.Regni.units.xw,[4,0])
})

const entreatSpec = (featTiming,rows = [{space:'Regni',enemy:'d'}]) => ({
  faction:'s',command:'Battle',feat:'Entreat',rows,featRows:[{space:'Silures',bands:1}],input:{featTiming},
})

test('§4.1: Battle can free the Warband that Entreat needs after combat', () => {
  const game = entreat()
  const spec = entreatSpec('after')
  assert.equal(availability(game).sw,0)
  runMilitary(game,spec,one,config => runBattle(game,config,one))
  assert.deepEqual(game.land.Regni.units.sw,[10,0])
  assert.deepEqual(game.land.Silures.units.sw,[2,0])
  assert.deepEqual(game.land.Silures.units.mil,[0,0])
  assert.equal(game.tracks.s,2)
  validateSave(game)
})

test('Between Battles, an Entreat replacement participates in the next Battle', () => {
  const game = entreat()
  game.land.Silures.units.mil = [2,0]
  const spec = entreatSpec('1',[{space:'Regni',enemy:'d'},{space:'Silures',enemy:'d'}])
  const descriptor = militaryFields(game,'s','Battle','Entreat',{},{rows:2})
  assert.deepEqual(descriptor.controls.find(field => field.key === 'featTiming').options.map(([value]) => value),['before','1','after'])
  runMilitary(game,spec,one,config => {
    if (config.name === 'Silures') {
      assert.deepEqual(game.land.Silures.units.sw,[2,0])
      assert.deepEqual(game.land.Silures.units.mil,[1,0])
    }
    return runBattle(game,config,one)
  })
  assert.deepEqual(game.land.Silures.units.sw,[2,0])
  assert.deepEqual(game.land.Silures.units.mil,[0,0])
  validateSave(game)
})

test('Entreat before this Battle still needs an Available replacement', () => {
  const game = entreat()
  assert.throws(() => runMilitary(game,entreatSpec('before'),one,config => runBattle(game,config,one)),/available replacement/)
})

test('Independent Battle then Entreat gives the same placement and cost', () => {
  const game = entreat()
  runBattle(game,{name:'Regni',attacker:'s',defender:'d',source:'Battle'},one)
  assert.equal(availability(game).sw,1)
  runCommandFeat(game,{...entreatSpec('after'),rows:entreatSpec('after').featRows},one)
  assert.deepEqual(game.land.Silures.units.sw,[2,0])
  assert.equal(game.tracks.s,2)
})

const omensReply = (play,seen = []) => prompt => {
  if (prompt.title.startsWith('Discard Omens')) {
    seen.push(prompt.title)
    return play ? 'play' : 'skip'
  }
  return prompt.counts ? prompt.options.at(-1).value : prompt.defaultValue
}

test('#43: Omens can be kept at Lindum and offered again at Ratae', () => {
  const {game,work} = omens()
  const seen = []
  runBattle(game,work.input.battle.job.requests[0],one,omensReply(false,seen))
  assert.deepEqual(seen.map(title => title.split(' at ').at(-1)),['Lindum?','Ratae?'])
  assert.equal(game.omens.holder,'d')
})

test('#43: the second Assault uses full-strength troops after halving in the first', () => {
  const {game,work} = omens()
  const battle = runBattle(game,work.input.battle.job.requests[0],one,omensReply(true))
  assert.deepEqual(battle.destroyed,[0,1])
  assert.deepEqual(game.land.Corieltauvi.units.xw,[4,4])
  assert.ok(battle.assaults[1].defenders.units.every(unit => unit.modifiers.includes('#43 Omens')))
  assert.ok(battle.assaults[3].defenders.units.every(unit => !unit.modifiers.includes('#43 Omens')))
})

test('Assault projections also drop Omens before picking a second target', () => {
  const {game,work} = omens()
  game.land.Corieltauvi.units.xw = [7,0]
  const battle = runBattle(game,work.input.battle.job.requests[0],one,omensReply(true))
  assert.deepEqual(battle.destroyed,[0,1])
  assert.deepEqual(game.land.Corieltauvi.units.xw,[1,1])
})

test('Two unmodified Assaults and a single modified Assault preserve their prior losses', () => {
  const a = omens()
  a.game.omens = null
  runBattle(a.game,a.work.input.battle.job.requests[0],one,omensReply(true))
  assert.deepEqual(a.game.land.Corieltauvi.units.xw,[6,4])
  const b = omens()
  b.game.land.Corieltauvi.sites[1] = null
  runBattle(b.game,b.work.input.battle.job.requests[0],one,omensReply(true))
  assert.deepEqual(b.game.land.Corieltauvi.units.xw,[6,2])
})

test('One confirmed Omens choice can select different counts for units with and without Plunder', () => {
  const session = omens()
  const {job,answers} = session.work.input.battle
  session.game.land.Corieltauvi.units.xw = [10,2]
  const first = replayAction(session.game,job,answers)
  assert.match(first.prompt.title,/Lindum/)
  answers.push('play')
  const bulk = replayAction(session.game,job,answers)
  assert.deepEqual(bulk.prompt.counts.map(group => group.max),[2,8])
  assert.match(bulk.prompt.counts[0].label,/carrying Plunder/)
  assert.throws(() => replayAction(session.game,job,['play','3,0']),/available count/)
  answers.push('1,3')
  const reloaded = parseSave(serialize(session))
  const result = replayAction(reloaded.game,job,reloaded.work.input.battle.answers)
  assert.match(result.detail,/Omens halves 4 Units/)
  assert.deepEqual(result.battles,result.after.log.find(entry => entry.battles).battles)
  reloaded.work.input.battle.answers.pop()
  assert.deepEqual(replayAction(reloaded.game,job,reloaded.work.input.battle.answers).prompt.counts,bulk.prompt.counts)
})

test('Field Battle calculations survive Apply, Undo, Redo and JSON reload', () => {
  const session = fresh(entreat())
  const result = replayAction(session.game,{kind:'action',option:'feat',description:'Battle + Entreat',operation:entreatSpec('after')})
  const [charge,melee] = result.battles[0].field
  assert.deepEqual([charge.phase,charge.attackers.hits,charge.attackers.removed],['Charge / Ambush',1,['Scotti Warbands']])
  assert.deepEqual([melee.phase,melee.defenders.hits,melee.defenders.removed],['Melee',10,['Cavalry']])
  push(session,'Battle + Entreat',result.after)
  assert.ok(rewind(session,'undo'))
  assert.ok(rewind(session,'redo'))
  const reloaded = parseSave(serialize(session))
  assert.deepEqual(reloaded.game.log.find(entry => entry.battles).battles,result.battles)
})

test('v0.3.4 saves retain their board and history, and replan a pending bot Battle', () => {
  const save = JSON.parse(fixture('F3-omens-assault'))
  save.version = '0.3.4'
  const migrated = parseSave(JSON.stringify(save))
  assert.deepEqual(migrated.game,save.session.game)
  assert.equal(migrated.work.input.battle,undefined)
  for (const game of [quarters(),entreat(),migrated.game]) {
    assert.deepEqual(parseSave(serialize(fresh(game))).game,game)
  }
})

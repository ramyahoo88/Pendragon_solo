import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BY_NAME, REGIONS, RANDOM_SPACES, ROADS } from '../src/data.mjs'
import { CARDS, card } from '../src/cards.mjs'
import { addProsperity, availability, boardDiff, boardTotals, clone, control, opening, scores, setImperium, validatePosition } from '../src/position.mjs'
import { activeFaction, actionOptions, advanceCard, advanceEpoch, annonaGroups, finishAction, resolveAnnona, resolveImperium, resolveRecovery, resolveRevenue, resolveVictory, startCards, validateSave } from '../src/sequence.mjs'
import { chooseSpace, duxTrain, eventPlan, makeRoller, proposeBot } from '../src/bots.mjs'
import { fresh, parseSave, push, rewind, serialize } from '../src/session.mjs'

test('Rulebook pp. 37–38 opening totals, selected sites, seas and supplies',() => {
  const state = validateSave(opening(144))
  assert.deepEqual(availability(state),{cav:0,mil:6,com:0,xw:25,sw:12,xr:25,sr:30,fort:0,town:2,hill:7,xs:12,ss:6})
  assert.deepEqual(boardTotals(state).pop,{d:0,c:40,x:0,s:0})
  assert.equal(boardTotals(state).total,80)
  assert.deepEqual(state.land.Atrebates.sites,[{piece:'fort',employer:null},{piece:'town',employer:null}])
  assert.equal(state.land.Eboracum.units.cav[0],5)
  assert.equal(state.land.Votadini.units.mil[0],4)
  assert.deepEqual(state.seas,{brit:true,germ:true,hib:false,sept:false})
  assert.equal(state.imperium,'rm')
})

test('Gazetteer relationships and all 72 ordinary card orders are well formed',() => {
  assert.equal(Object.keys(CARDS).filter(id => Number(id) <= 72).length,72)
  for (let id = 1; id <= 72; id++) assert.equal([...card(id).order].sort().join(''),'cdsx')
  assert.deepEqual(card(15).order,['d','s','c','x'])
  assert.deepEqual(card(50).order,['x','s','d','c'])
  assert.equal(card(22).symbols.d,'b')
  assert.equal(card(58).symbols.x,'r')
  assert.equal(card(5).symbols.d,'h')
  for (const {name,adj} of REGIONS) for (const neighbor of adj) assert.ok(BY_NAME[neighbor].adj.includes(name), name+' / '+neighbor)
  for (const [a,b] of ROADS) assert.ok(BY_NAME[a].adj.includes(b))
  assert.equal(new Set(RANDOM_SPACES.flat().filter(Boolean)).size,23)
})

test('§1.6 Region majority and Stronghold, Raider exclusion, and City exception',() => {
  const state = opening(144)
  state.land.Dumnonii.units.xr = [8,0]
  assert.equal(control(state,'Dumnonii'),'b')
  state.land.Dumnonii.units.xw = [2,0]
  assert.equal(control(state,'Dumnonii'),null)
  state.land.Dumnonii.sites[0] = null
  assert.equal(control(state,'Dumnonii'),null)
  state.land.Londinium.units.xw = [6,0]
  assert.equal(control(state,'Londinium'),'b')
  setImperium(state,'f')
  assert.equal(control(state,'Londinium'),'c')
})

test('A board preview shows loss of Control when the last Stronghold is removed',() => {
  const state = opening(144)
  const after = clone(state)
  after.land.Dobunni.sites[0] = null
  const records = boardDiff(state,after).changes.find(x => x.name === 'Dobunni').rows
  assert.deepEqual(records,[['Corinium','Town','Vacant'],['Control','Briton','Uncontrolled']])
})

test('§2.3 Pass shifts the slot; Standard bot receives full Command after human Command',() => {
  const state = opening(144)
  startCards(state,22,5)
  assert.equal(activeFaction(state),'c')
  finishAction(state,'command','Trade')
  assert.equal(activeFaction(state),'d')
  assert.deepEqual(actionOptions(state),['command','feat','pass'])
  finishAction(state,'pass','Pass')
  assert.equal(state.tracks.blue,28)
  assert.equal(activeFaction(state),'s')
  finishAction(state,'command','Raid')
  assert.equal(state.complete,true)
  assert.deepEqual(state.eligibility,['d','x'])
  assert.throws(() => finishAction(state,'pass','Pass'),/unavailable/)
})

test('Human second slot follows Command, Command + Feat, and Event separately',() => {
  for (const [action,choices] of [['command',['limited','pass']],['feat',['limited','event','pass']],['event',['command','feat','pass']]]) {
    const state = opening(144)
    startCards(state,1,5)
    assert.equal(activeFaction(state),'d')
    finishAction(state,action,action)
    assert.equal(activeFaction(state),'c')
    assert.deepEqual(actionOptions(state),choices)
  }
})

test('A card with only one eligible executor does not offer a second action after reset',() => {
  const state = opening(144)
  startCards(state,1,2)
  state.eligibility = ['d']
  finishAction(state,'command','Train')
  assert.equal(state.complete,true)
  assert.equal(activeFaction(state),null)
  assert.deepEqual(state.eligibility,['c','x','s'])
})

test('Duplicate, Pivotal and premature Epoch cards are rejected',() => {
  for (const id of [1,73,77,83]) assert.throws(() => startCards(opening(144),1,id))
  const game = opening(144)
  startCards(game,1,2)
  for (const faction of card(1).order) finishAction(game,'pass','Pass')
  assert.throws(() => advanceCard(game,77),/last four Event cards/)
  assert.deepEqual(game.revealed,[1,2])
})

test('§2.3.7 Epoch postpones and resumes its preceding Event exactly once',() => {
  const game = opening(144)
  startCards(game,1,2)
  for (const id of [3,4,5,6,7,8,77]) {
    while (activeFaction(game)) finishAction(game,'pass','Pass')
    advanceCard(game,id)
  }
  assert.equal(game.current,77)
  assert.equal(game.next,8)
  assert.equal(game.epochPhase,'Annona')
  assert.equal(activeFaction(game),null)
  game.land.Atrebates.pros = [1,0]
  game.land.Catuvellauni.pros = [1,0]
  for (const phase of ['Annona','Imperium','Victory','Epoch Event','Revenue','Dux Upkeep','Civitates Upkeep','Saxon Upkeep','Scotti Upkeep','Recovery & Reset']) {
    assert.equal(game.epochPhase,phase)
    advanceEpoch(game,{hoard:0},9)
  }
  assert.equal(game.current,8)
  assert.equal(game.next,9)
  assert.equal(game.eventIndex,1)
  assert.equal(game.epoch,1)
  assert.equal(game.log.filter(line => line.title === 'Resumed #8').length,1)
  assert.equal(game.revealed.filter(id => id === 8).length,1)
  assert.deepEqual(game.eligibility,['d','c','x','s'])
})

test('§6.1 Annona pays and releases whole nationality/employer groups',() => {
  const game = opening(144)
  const space = game.land.Iceni
  space.units.cxw = [2,1]
  space.units.dsw = [1,0]
  space.sites[0] = {piece:'xs',employer:'c'}
  space.sites[1] = {piece:'ss',employer:'d'}
  game.land.Parisi.sites[1] = {piece:'xs',employer:'d'}
  assert.deepEqual(annonaGroups(game).map(g => g.id),['Iceni/dsw','Iceni/cxw'])
  resolveAnnona(game,['Iceni/dsw'])
  assert.deepEqual(space.units.cxw,[0,0])
  assert.deepEqual(space.units.xw,[2,2])
  assert.deepEqual(space.units.dsw,[1,0])
  assert.deepEqual(space.sites,[{piece:'xs',employer:null},{piece:'ss',employer:'d'}])
  assert.equal(game.land.Parisi.sites[1].employer,'d')
  assert.equal(game.tracks.s,7)
  assert.equal(game.tracks.x,10)
  assert.equal(game.tracks.blue,24)
})

test('§6.2 transition boundary at 31 versus 30 Briton Control and prestige rounding',() => {
  const game = opening(144)
  for (const name of ['Atrebates','Catuvellauni','Iceni','Dumnonii']) game.land[name].sites.fill(null)
  game.tracks.prestige = 3
  assert.equal(boardTotals(game).pop.c,31)
  resolveImperium(game,0)
  assert.equal(game.imperium,'rm')
  game.land.Demetae.sites.fill(null)
  assert.equal(boardTotals(game).pop.c,30)
  resolveImperium(game,0)
  assert.equal(game.imperium,'am')
  assert.equal(game.tracks.prestige,2)
})

test('Saxon scenario threshold at 3 versus 4 and final Epoch skips Recovery',() => {
  const game = opening(144)
  for (const name of ['Atrebates']) {
    const space = game.land[name]
    space.sites = [{piece:'xs',employer:null},null]
    space.units.xw = [4,0]
  }
  assert.equal(scores(game).x.score,3)
  assert.equal(scores(game).x.eligible,false)
  game.land.Dumnonii.sites = [{piece:'xs',employer:null},null]
  game.land.Dumnonii.units.xw = [2,0]
  assert.equal(scores(game).x.score,4)
  assert.equal(scores(game).x.eligible,true)
  game.land.Parisi.pros = [0,0]
  game.land.Iceni.pros = [0,0]
  resolveVictory(game)
  assert.equal(game.result.winner,'x')
  const final = opening(144)
  final.epoch = 2
  final.epochPhase = 'Victory'
  final.land.Atrebates.pros = [1,0]
  final.land.Catuvellauni.pros = [1,0]
  advanceEpoch(final)
  assert.equal(final.result.reason,'final')
  assert.deepEqual(final.land.Atrebates.pros,[1,0])
  assert.equal(final.epochPhase,null)
})

test('§7.1 a qualifying bot wins over a qualifying human at an early checkpoint',() => {
  const game = opening(144)
  setImperium(game,'f')
  game.tracks.prestige = 40
  resolveVictory(game)
  assert.equal(scores(game).c.eligible,true)
  assert.equal(scores(game).d.eligible,true)
  assert.equal(game.result.won,false)
})

test('§6.5 Revenue caps before taxation and §6.7 restores only the lower row at Autonomy',() => {
  const game = opening(144)
  resolveRevenue(game)
  assert.equal(game.tracks.blue,50)
  assert.equal(game.tracks.prestige,5)
  setImperium(game,'am')
  game.land.Atrebates.pros = [1,0]
  resolveRecovery(game)
  assert.deepEqual(game.land.Atrebates.pros,[3,0])
  assert.equal(addProsperity(game,'Atrebates',1),1)
  assert.deepEqual(game.land.Atrebates.pros,[3,1])
})

test('§8.3.3 ties use the printed table starting in Dobunni',() => {
  const state = opening(144)
  const dice = []
  const roll = makeRoller(state,dice,[4,3])
  assert.equal(chooseSpace(['Dumnonii','Votadini','Londinium','Atrebates','Textoverdi','Carvetii','Silures'],roll,'test'),'Silures')
  assert.equal(dice.length,2)
})

test('§8.8.4 Dux trains two Available Cavalry and uses Requisition on a stocked board',() => {
  const game = opening(144)
  game.land.Carvetii.units.cav[0] -= 2
  game.land.Carvetii.sites[1] = {piece:'xs',employer:'d'}
  game.land.Carvetii.units.dxw = [1,0]
  const dice = []
  const result = duxTrain(game,makeRoller(game,dice,[4,1,1,1,2]))
  assert.equal(result.feat,'Requisition')
  assert.equal(result.placements.length,2)
  assert.equal(availability(game).cav,0)
  assert.equal(game.tracks.blue,13)
  assert.equal(game.tracks.red,6)
  validatePosition(game)
})

test('#15 is ineffective on a full board for Dux, then adds one cube where there is room',() => {
  const game = opening(144)
  startCards(game,15,22)
  const dice = []
  const roll = makeRoller(game,dice)
  assert.equal(eventPlan(game,'d',roll),null)
  game.land.Atrebates.pros[1]--
  const result = eventPlan(game,'d',roll)
  assert.equal(result.option,'event')
  assert.equal(boardTotals(game).total,80)
})

test('Sample opening executes Trade, Dux Pass, and deterministic Scotti Raid through save and undo',() => {
  const before = opening(144)
  startCards(before,22,5)
  before.tracks.blue = 38
  finishAction(before,'command','Trade')
  const dux = proposeBot(before)
  assert.equal(dux.title,'Pass')
  assert.equal(dux.after.tracks.blue,41)
  const first = proposeBot(dux.after)
  assert.deepEqual(first,proposeBot(dux.after))
  assert.equal(first.title,'Raid + Ransom')
  assert.equal(boardTotals(dux.after).total,80)
  assert.equal(boardTotals(first.after).total,73)
  assert.equal(boardTotals(first.after).plunder,7)
  assert.equal(first.after.tracks.s,8)
  const session = fresh(dux.after)
  push(session,first.title,first.after)
  const reopened = parseSave(serialize(session))
  assert.equal(reopened.game.complete,true)
  assert.equal(rewind(reopened,'undo'),true)
  assert.equal(boardTotals(reopened.game).total,80)
  assert.equal(rewind(reopened,'redo'),true)
  assert.equal(boardTotals(reopened.game).total,73)
})

test('Pending edits survive JSON round-trip and invalid live stocks cannot commit',() => {
  const session = fresh(opening(144))
  const draft = clone(session.game)
  draft.land.Votadini.units.cav = [2,0]
  session.work = {kind:'edit',input:{editor:'Votadini'},draft}
  const reopened = parseSave(serialize(session))
  assert.deepEqual(reopened.work.draft.land.Votadini.units.cav,[2,0])
  assert.throws(() => push(reopened,'Correction',reopened.work.draft),/piece supply/)
  assert.throws(() => parseSave('{}'),/companion JSON/)
})

test('A guided two-Epoch campaign reaches valid final scoring through the normal sequence',() => {
  const game = opening(144)
  startCards(game,1,2)
  const remaining = [3,4,5,6,7,8,9,10,77,11,12,13,14,15,16,17,18,19,20,21,22,78]
  for (const id of remaining) {
    while (activeFaction(game)) finishAction(game,'pass','Pass')
    if (id === 11) {
      game.land.Atrebates.pros = [0,0]
      game.land.Dobunni.pros = [0,0]
      for (const phase of ['Annona','Imperium','Victory','Epoch Event','Revenue','Dux Upkeep','Civitates Upkeep','Saxon Upkeep','Scotti Upkeep','Recovery & Reset']) {
        assert.equal(game.epochPhase,phase)
        advanceEpoch(game,{hoard:0},id)
        validateSave(game)
      }
    } else {
      advanceCard(game,id)
    }
    validateSave(game)
  }
  assert.equal(game.epoch,2)
  game.land.Atrebates.pros = [0,0]
  game.land.Dobunni.pros = [0,0]
  advanceEpoch(game)
  advanceEpoch(game,{hoard:0})
  advanceEpoch(game)
  assert.equal(game.result.reason,'final')
  assert.deepEqual(game.land.Atrebates.pros,[0,0])
  validateSave(game)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { SCENARIO } from '../src/data.mjs'
import { availability, boardTotals, control, opening } from '../src/position.mjs'
import { SCENARIOS, TEARS_REGIONS, allowedEpochs, configureScenario, makeScenarioDeck, printedPopulation, removedScenarioEvents, scenarioBarbarianScores, scenarioDeckSize, validateRevealedDeck } from '../src/scenarios.mjs'

const scenario = (name,variant) => configureScenario(opening(144),name,variant)
const events = (start,count) => Array.from({length:count},(_,i) => start + i)

test('Barbarian Conspiracy and De Excidio Britanniae use the same opening position but different decks and Pivotals',() => {
  const barbarian = scenario(SCENARIO)
  const excidio = scenario('De Excidio Britanniae')
  assert.deepEqual(barbarian.land,excidio.land)
  assert.deepEqual(barbarian.tracks,excidio.tracks)
  assert.equal(boardTotals(barbarian).pop.c,40)
  assert.equal(boardTotals(barbarian).total,80)
  assert.equal(scenarioDeckSize(barbarian),26)
  assert.equal(scenarioDeckSize(excidio),78)
  assert.deepEqual(barbarian.pivotal,{ d:'absent', c:'absent', x:'absent', s:'absent' })
  assert.deepEqual(excidio.pivotal,{ d:'ready', c:'ready', x:'ready', s:'ready' })
  assert.equal(SCENARIOS[SCENARIO].finalRecovery,false)
  assert.equal(SCENARIOS[excidio.scenario].finalRecovery,true)
})

test('Petty Tyrants starts Fragmented with correct allegiance, pools, and Tears of Epona (§2.1, pp. 39–40, errata)',() => {
  const game = scenario('Petty Tyrants')
  assert.equal(game.imperium,'f')
  assert.equal(game.roads,false)
  assert.deepEqual(boardTotals(game).pop,{d:6,c:18,x:6,s:2})
  assert.deepEqual(availability(game),{cav:5,mil:4,com:2,xw:4,sw:5,xr:25,sr:30,fort:4,town:5,hill:6,xs:5,ss:3})
  assert.deepEqual(game.pools,{casualties:0,out:5,notYet:0})
  assert.deepEqual(game.land.Trinovantes.sites,[{piece:'xs',employer:'c'},{piece:'town',employer:null}])
  assert.deepEqual(game.land.Silures.units.dsw,[2,0])
  assert.equal(control(game,'Silures'),null)
  assert.equal(control(game,'Parisi'),'d')
  assert.deepEqual(game.land.Iceni.pros,[1,0])
  assert.deepEqual(Object.keys(game.markers),['73','76','81'])
  assert.equal(game.markers[81].type,'capability')
  assert.deepEqual(game.pivotal,{d:'absent',c:'used',x:'absent',s:'used'})
  for (const name of TEARS_REGIONS) assert.equal(printedPopulation(game,name),1)
  assert.equal(printedPopulation(game,'Atrebates'),3)
})

test('The Harder They Fall starts amid Civilian Dominance and has one Early then three Late Epoch cards',() => {
  const game = scenario('The Harder They Fall')
  assert.equal(game.imperium,'rc')
  assert.equal(game.roads,true)
  assert.equal(boardTotals(game).pop.c,36)
  assert.equal(boardTotals(game).total,57)
  assert.deepEqual(availability(game),{cav:8,mil:4,com:0,xw:17,sw:11,xr:25,sr:30,fort:2,town:4,hill:10,xs:10,ss:5})
  assert.equal(control(game,'Iceni'),null)
  assert.equal(control(game,'Novantae'),null)
  assert.equal(control(game,'Demetae'),'s')
  assert.deepEqual(game.pivotal,{d:'ready',c:'ready',x:'ready',s:'used'})
  assert.deepEqual(allowedEpochs(game,0),[79,80])
  assert.deepEqual(allowedEpochs(game,1),[81,82,83])
})

test('Optional removals and preplayed Capabilities are excluded from the corresponding deck',() => {
  const petty = scenario('Petty Tyrants',true)
  const harder = scenario('The Harder They Fall',true)
  assert.deepEqual(removedScenarioEvents(petty),[4,5,13,20,22,30,35,49,54,7,21,56,68])
  assert.deepEqual(petty.markers[56],{type:'capability',side:'shaded'})
  assert.deepEqual(removedScenarioEvents(harder),[4,13,20])
  assert.throws(() => validateRevealedDeck(petty,[7]),/set aside/)
  assert.throws(() => validateRevealedDeck(harder,[13]),/set aside/)
  assert.doesNotThrow(() => validateRevealedDeck(scenario('Petty Tyrants'),[7,13]))
})

test('Physical deck validation allows the first and last insertion slots and rejects invalid order',() => {
  const game = scenario(SCENARIO)
  assert.doesNotThrow(() => validateRevealedDeck(game,[...events(1,8),77,...events(9,4)]))
  assert.doesNotThrow(() => validateRevealedDeck(game,[...events(1,12),77]))
  assert.throws(() => validateRevealedDeck(game,[...events(1,7),77]),/last four/)
  assert.throws(() => validateRevealedDeck(game,events(1,13)),/must be an Epoch/)
  assert.throws(() => validateRevealedDeck(game,[...events(1,8),77,78]),/one Epoch/)
  assert.throws(() => validateRevealedDeck(game,[...events(1,8),81]),/unavailable/)
  assert.throws(() => validateRevealedDeck(game,[1,1]),/already/)
  assert.throws(() => validateRevealedDeck(game,[73]),/ordinary Event/)
  assert.throws(() => validateRevealedDeck(scenario('Petty Tyrants'),[...events(1,8),81]),/unavailable/)
  assert.throws(() => validateRevealedDeck(scenario('The Harder They Fall'),[...events(1,8),77]),/unavailable/)
})

test('Generated decks obey each scenario, all possible package ends, and the variant exclusions',() => {
  for (const name of Object.keys(SCENARIOS)) for (const alternate of [false,true]) {
    const game = scenario(name,alternate)
    for (const pick of [() => 0,size => size - 1]) {
      const deck = makeScenarioDeck(game,pick)
      assert.equal(deck.length,scenarioDeckSize(game))
      assert.equal(new Set(deck).size,deck.length)
      assert.doesNotThrow(() => validateRevealedDeck(game,deck))
      assert.ok(removedScenarioEvents(game).every(id => !deck.includes(id)))
      for (let pile = 0; pile < SCENARIOS[name].epochs; pile++) {
        assert.equal(deck.slice(pile*13,pile*13+13).filter(id => id >= 77).length,1)
      }
    }
  }
})

test('Barbarian Conspiracy thresholds differ from standard and Dal Riada counts towards Scotti victory',() => {
  const game = scenario(SCENARIO)
  Object.assign(game.tracks,{x:25,s:25,dalRiada:1})
  assert.equal(scenarioBarbarianScores(game,{x:3},2,1).x.eligible,false)
  const short = scenarioBarbarianScores(game,{x:4},3,1)
  assert.equal(short.x.eligible,true)
  assert.equal(short.x.margin,1)
  assert.equal(short.s.eligible,true)
  assert.equal(short.s.margin,1)
  game.scenario = 'De Excidio Britanniae'
  const long = scenarioBarbarianScores(game,{x:4},3,1)
  assert.equal(long.x.eligible,false)
  assert.equal(long.x.margin,-6)
  assert.equal(long.s.eligible,false)
  assert.equal(long.s.margin,-30)
  Object.assign(game.tracks,{x:35,s:46})
  assert.equal(scenarioBarbarianScores(game,{x:10},4,3).x.eligible,true)
  assert.equal(scenarioBarbarianScores(game,{x:10},4,3).s.eligible,true)
  game.imperium = 'f'
  assert.equal(scenarioBarbarianScores(game,{x:10},4,3).x.eligible,false)
  assert.equal(scenarioBarbarianScores(game,{x:11},0,3).x.eligible,true)
})

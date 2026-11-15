import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planBotGrant } from '../src/bots.mjs'
import { runMilitary } from '../src/operations.mjs'
import { clone, opening, scores, setImperium, validatePosition } from '../src/position.mjs'
import { startCards } from '../src/sequence.mjs'

function reinforcePosition(seat = 'c') {
  const game = opening(144,{seat})
  for (const space of Object.values(game.land)) {
    for (const group of Object.keys(space.units)) space.units[group] = [0,0]
    space.sites.fill(null)
    space.pros = [0,0]
  }
  game.pools.notYet = game.pools.out = game.pools.casualties = 0
  game.tracks.blue = 10
  game.land.Atrebates.sites[0] = {piece:'fort',employer:null}
  game.land.Atrebates.units.cav = [3,0]
  game.land.Atrebates.units.xw = [1,0]
  startCards(game,19,40)
  validatePosition(game)
  return game
}

const reinforceBattle = support => ({
  faction:'c',command:'Battle',feat:'Reinforce',
  rows:[{space:'Atrebates',enemy:'x'}],featRows:[support],
})

test('Reinforce cannot Muster in a Battle space containing only Dux and enemy pieces', () => {
  const game = reinforcePosition()
  const before = clone(game)
  const spec = reinforceBattle({space:'Atrebates',mode:'muster'})
  assert.throws(() => runMilitary(game,spec,() => 1,() => assert.fail('Battle started')),
    /Muster in Atrebates requires a Civitates piece/)
  assert.deepEqual(game,before)
})

test('A blue Foederati Settlement qualifies for Reinforce Muster with no Civitates Troops present', () => {
  const game = reinforcePosition()
  game.land.Atrebates.sites[1] = {piece:'ss',employer:'c'}
  const requests = []
  runMilitary(game,reinforceBattle({space:'Atrebates',mode:'muster'}),() => 1,
    request => requests.push(request))
  assert.deepEqual(game.land.Atrebates.units.mil,[3,0])
  assert.equal(game.tracks.blue,8)
  assert.equal(requests.length,1)
  validatePosition(game)
})

test('St Germanus skips illegal local Muster and can still move in the first Civitates Troop', () => {
  const game = reinforcePosition('d')
  const before = clone(game)
  assert.equal(planBotGrant(game,23,'d','unshaded',() => 1),null)
  assert.deepEqual(game,before)

  game.land.Dobunni.sites[0] = {piece:'town',employer:null}
  game.land.Dobunni.units.mil = [2,0]
  const plan = planBotGrant(game,23,'d','unshaded',() => 1)
  assert.deepEqual(plan.requests,[{name:'Atrebates',attacker:'c',defender:'x',source:'Battle'}])
  assert.deepEqual(plan.base.land.Atrebates.units.mil,[2,0])
  assert.deepEqual(plan.base.land.Dobunni.units.mil,[0,0])
  assert.equal(plan.base.tracks.blue,10)
  validatePosition(plan.base)
})

test('Dux and Civitates use victory thresholds for qualification and separate final margin offsets', () => {
  const cases = [
    // Imperium, Dux victory and margin thresholds, Civitates thresholds.
    ['rm',75,75,36,38],
    ['rc',75,85,36,36],
    ['am',60,60,27,31],
    ['ac',60,70,27,27],
    ['f',17,17,16,16],
  ]
  for (const [imperium,duxVictory,duxMargin,civitatesVictory,civitatesMargin] of cases) {
    const game = opening(144)
    setImperium(game,imperium)
    const {d,c} = scores(game)
    assert.equal(d.victoryTarget,duxVictory,imperium)
    assert.equal(d.margin,d.score-duxMargin,imperium)
    assert.equal(c.victoryTarget,civitatesVictory,imperium)
    assert.equal(c.margin,c.score-civitatesMargin,imperium)
    assert.equal(d.eligible,(imperium === 'f' || imperium.endsWith('m')) && d.score > duxVictory,imperium)
    assert.equal(c.eligible,(imperium === 'f' || imperium.endsWith('c')) && c.score > civitatesVictory,imperium)
  }
})

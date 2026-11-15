import assert from 'node:assert/strict'
import { test } from 'node:test'
import { replayAction } from '../src/action-resolution.mjs'
import { battleForecast } from '../src/battle.mjs'
import { proposeBot } from '../src/bots.mjs'
import { opening, setImperium, validatePosition } from '../src/position.mjs'
import { actionOptions, startCards } from '../src/sequence.mjs'

const ones = Array(80).fill(1)

const shieldPairs = [
  {faction:'Dux',seat:'c',current:6,next:1,rule:'§8.8.2'},
  {faction:'Civitates',seat:'d',current:24,next:1,rule:'§8.7.2'},
  {faction:'Saxons',seat:'c',current:39,next:8,rule:'§8.6.2'},
  {faction:'Scotti',seat:'c',current:65,next:17,rule:'§8.5.2'},
]

for (const {faction,seat,current,next,rule} of shieldPairs) {
  test(`${faction} Pass for the upcoming Shield Event after declining an ineffective Shield Event`, () => {
    const game = opening(144,{seat})
    startCards(game,current,next)
    const proposal = proposeBot(game,ones)
    assert.equal(proposal.option,'pass')
    assert.equal(proposal.decision.rule,rule)
    assert.match(proposal.description,new RegExp(`Priority Event #${next}\\b`))
    validatePosition(proposal.after)
  })
}

test('Dux take an effective current Shield Event before checking the next card', () => {
  const game = opening(144)
  startCards(game,5,1)
  const proposal = proposeBot(game,ones)
  assert.equal(proposal.option,'event')
  assert.equal(proposal.title,'Imperial Subsidies · unshaded')
})

function interceptPosition(current,next) {
  const game = opening(144)
  startCards(game,current,next)
  setImperium(game,'f')
  game.tracks.red = 0
  game.tracks.blue = 0
  game.land.Eboracum.units.xr = [3,0]
  return game
}

test('Dux Battle before checking either Shield Event when Intercept would add no move or Feat', () => {
  for (const [current,next] of [[4,1],[5,3]]) {
    const game = interceptPosition(current,next)
    const proposal = proposeBot(game,ones)
    assert.equal(proposal.mode,'battle')
    assert.equal(proposal.decision.rule,'§8.8.1')
    assert.ok(proposal.requests.some(request => request.name === 'Eboracum' &&
      request.defender === 'x' && request.source === 'Battle'))
    assert.deepEqual(proposal.base.land.Eboracum.units,game.land.Eboracum.units)
    validatePosition(proposal.base)
  }
  const game = interceptPosition(4,1)
  const proposal = proposeBot(game,[2,1,...ones])
  assert.equal(proposal.option,'pass')
  assert.equal(proposal.decision.rule,'§8.8.2')
})

test('Dux Battle co-located Raiders after qualifying for Intercept even without a Prestige gain', () => {
  const game = interceptPosition(4,1)
  for (const space of Object.values(game.land)) {
    for (const unit of ['cav','dxw','dsw']) space.units[unit] = [0,0]
  }
  game.land.Eboracum.units.dxw = [1,0]
  game.land.Eboracum.units.xr = [12,0]
  validatePosition(game)
  const request = {name:'Eboracum',attacker:'d',defender:'x',source:'Battle'}
  assert.equal(battleForecast(game,request).prestigeChange,0)
  const proposal = proposeBot(game,ones)
  assert.equal(proposal.mode,'battle')
  assert.equal(proposal.decision.rule,'§8.8.1')
  assert.deepEqual(proposal.requests,[request])
  const {after,battles} = replayAction(game,{
    kind:'action',origin:proposal.base,option:proposal.option,description:proposal.title,
    requests:proposal.requests,dice:proposal.dice,
  })
  assert.equal(battles[0].name,'Eboracum')
  assert.equal(after.acts[0].option,'command')
  validatePosition(after)
})

test('Saxon Return with no successful Settle additions counts as Command only', () => {
  const game = opening(144)
  startCards(game,40,42)
  game.land.Iceni.units.xr = [4,4]
  game.land.Iceni.units.xw = [1,0]
  const proposal = proposeBot(game,ones)
  assert.equal(proposal.option,'command')
  assert.equal(proposal.title,'Return')
  assert.equal(proposal.after.tracks.x,game.tracks.x+4)
  assert.deepEqual(proposal.after.land.Iceni.units.xr,[0,0])
  assert.deepEqual(proposal.after.land.Iceni.units.xw,[1,0])
  assert.equal(proposal.dice.filter(die => die.label.startsWith('Settle')).length,4)
  assert.ok(!actionOptions(proposal.after).includes('event'))
  validatePosition(proposal.after)
})

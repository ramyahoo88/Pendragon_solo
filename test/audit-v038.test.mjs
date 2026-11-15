import assert from 'node:assert/strict'
import { test } from 'node:test'
import { replayAction } from '../src/action-resolution.mjs'
import { proposeBot } from '../src/bots.mjs'
import { STOCK } from '../src/data.mjs'
import { availability, clone, control, opening, validatePosition } from '../src/position.mjs'
import { actionOptions, startCards } from '../src/sequence.mjs'

const ones = Array(40).fill(1)

function emptyPosition(seat,current,next) {
  const game = opening(144,{seat})
  for (const space of Object.values(game.land)) {
    for (const group of Object.keys(space.units)) space.units[group] = [0,0]
    space.sites.fill(null)
    space.pros = [0,0]
  }
  game.markers = {}
  game.pools.notYet = game.pools.out = game.pools.casualties = 0
  startCards(game,current,next)
  return game
}

function reinforcePosition(seat = 'd') {
  const game = emptyPosition(seat,19,40)
  game.tracks.blue = 20
  game.land.Atrebates.sites[0] = {piece:'town',employer:null}
  game.land.Atrebates.units.com = [1,0]
  game.land.Catuvellauni.units.com = [4,0]
  game.land.Catuvellauni.units.xr = [10,10]
  return game
}

const reinforceRolls = proposal => proposal.dice.filter(die => die.label.startsWith('Reinforce · '))

test('Civitates Reinforce from a non-Battle space, then resolve the Battle as Command + Feat', () => {
  const game = reinforcePosition()
  const before = clone(game)
  // A second eligible origin must be left out even with ample Resources.
  game.land.Dobunni.sites[0] = {piece:'hill',employer:null}
  game.land.Dobunni.units.com = [1,0]
  validatePosition(game)
  const plan = proposeBot(game,[1,1,3,...ones])
  assert.equal(plan.title,'Battle + Reinforce')
  assert.equal(plan.base.tracks.blue,18)
  assert.deepEqual(plan.base.land.Atrebates.units.com,[0,0])
  assert.deepEqual(plan.base.land.Dobunni.units.com,[1,0])
  assert.deepEqual(plan.base.land.Catuvellauni.units.com,[5,0])
  assert.deepEqual(reinforceRolls(plan),[{sides:6,value:3,label:'Reinforce · Atrebates'}])
  assert.deepEqual(game.land.Catuvellauni,before.land.Catuvellauni)
  const {after} = replayAction(game,{
    kind:'action',description:plan.title,option:plan.option,origin:plan.base,
    requests:plan.requests,dice:plan.dice,
  })
  assert.equal(after.acts[0].option,'feat')
  assert.ok(actionOptions(after).includes('event'))
  validatePosition(after)
})

test('a failed Reinforce movement roll spends Resources and still counts as a Feat', () => {
  const game = reinforcePosition()
  const plan = proposeBot(game,[1,2,...ones])
  assert.equal(plan.option,'feat')
  assert.deepEqual(plan.base.land,game.land)
  assert.equal(plan.base.tracks.blue,18)
  assert.equal(reinforceRolls(plan)[0].value,2)
})

test('Civitates Reinforce never spends Wealth and checks movement after Muster', () => {
  const game = reinforcePosition()
  game.land.Catuvellauni.sites[0] = {piece:'town',employer:null}
  game.land.Catuvellauni.units.com = [6,0]
  game.land.Catuvellauni.units.xr = [18,18]
  game.tracks.wealth = 10
  game.tracks.blue = 3
  const musterOnly = proposeBot(game,[1,3,...ones])
  assert.equal(musterOnly.title,'Battle + Reinforce')
  assert.deepEqual(musterOnly.base.land.Catuvellauni.units.mil,[4,0])
  assert.deepEqual(musterOnly.base.land.Catuvellauni.units.com,[6,0])
  assert.equal(musterOnly.base.tracks.blue,1)
  assert.equal(musterOnly.base.tracks.wealth,10)
  assert.equal(reinforceRolls(musterOnly).length,0)

  game.tracks.blue = 4
  const both = proposeBot(game,[1,3,...ones])
  assert.deepEqual(both.base.land.Catuvellauni.units.mil,[4,0])
  assert.deepEqual(both.base.land.Catuvellauni.units.com,[7,0])
  assert.equal(both.base.tracks.blue,0)
  assert.equal(both.base.tracks.wealth,10)
  validatePosition(both.base)
})

test('Reinforce honors a human Dux choice and moves unloaded Troops first within a type', () => {
  const game = reinforcePosition()
  game.land.Atrebates.units.cav = [1,0]
  game.land.Atrebates.units.com = [2,1]
  const pending = proposeBot(game,[1,3,...ones])
  assert.equal(pending.mode,'consent')
  assert.equal(pending.key,'reinforceConsent')

  const allowed = proposeBot(game,[1,3,...ones],{reinforceConsent:true})
  assert.deepEqual(allowed.base.land.Catuvellauni.units.cav,[1,0])
  assert.deepEqual(allowed.base.land.Atrebates.units.com,[2,1])

  const declined = proposeBot(game,[1,3,...ones],{reinforceConsent:false})
  assert.deepEqual(declined.base.land.Catuvellauni.units.cav,[0,0])
  assert.deepEqual(declined.base.land.Catuvellauni.units.com,[5,0])
  assert.deepEqual(declined.base.land.Atrebates.units.com,[1,1])
  validatePosition(allowed.base)
  validatePosition(declined.base)
})

function thanetPosition() {
  const game = emptyPosition('c',40,42)
  game.tracks.x = 20
  game.land.Atrebates.units.xw = [12,0]
  game.land.Novantae.units.xw = [4,0]
  game.land.Regni.units.mil = [1,0]
  game.land.Regni.sites[0] = {piece:'hill',employer:null}
  game.markers[45] = {type:'capability',side:'shaded',faction:'x'}
  return game
}

test('Saxon March uses two Thanet Settle spaces before movement, when both qualify', () => {
  const game = thanetPosition()
  const plan = proposeBot(game,ones)
  assert.equal(plan.title,'March + Settle')
  assert.equal(plan.after.land.Atrebates.pop,game.land.Atrebates.pop+1)
  assert.equal(control(plan.after,'Novantae'),'x')
  assert.deepEqual(plan.after.land.Novantae.units.xw,[2,0])
  assert.deepEqual(plan.after.land.Regni.units.xw,[5,0])
  assert.ok(plan.description.indexOf('Novantae ·') < plan.description.indexOf('→ Regni'))
  validatePosition(plan.after)

  delete game.markers[45]
  const withoutThanet = proposeBot(game,ones)
  assert.equal(withoutThanet.title,'March + Settle')
  assert.deepEqual(withoutThanet.after.land.Novantae,game.land.Novantae)
})

test('Thanet recalculates available Settlements for the second space', () => {
  const game = thanetPosition()
  game.tracks.x = 1
  const others = Object.keys(game.land).filter(name => !['Atrebates','Novantae','Regni'].includes(name))
  for (const name of others.slice(0,STOCK.xs-1)) {
    game.land[name].sites[0] = {piece:'xs',employer:null}
  }
  assert.equal(availability(game).xs,1)
  const plan = proposeBot(game,ones)
  assert.equal(plan.title,'March + Settle')
  assert.equal(control(plan.after,'Atrebates'),'x')
  assert.equal(availability(plan.after).xs,0)
  assert.deepEqual(plan.after.land.Novantae,game.land.Novantae)
  validatePosition(plan.after)
})

test('Saxon March can use both Thanet Settle spaces after movement', () => {
  const game = emptyPosition('c',40,42)
  game.tracks.x = 2
  game.land.Dobunni.pop = 3
  game.land.Dobunni.units.xw = [10,0]
  game.land.Dobunni.sites = Array.from({length:2},() => ({piece:'hill',employer:null}))
  game.markers[45] = {type:'capability',side:'shaded',faction:'x'}
  const plan = proposeBot(game,ones)
  assert.equal(plan.title,'March + Settle')
  assert.equal(control(plan.after,'Corieltauvi'),'x')
  assert.equal(control(plan.after,'Durotriges'),'x')
  assert.deepEqual(plan.after.land.Dobunni.units.xw,[2,0])
  assert.equal(plan.after.tracks.x,0)
  validatePosition(plan.after)
})

function secondSettlementPosition() {
  const game = emptyPosition('c',40,42)
  game.tracks.x = 1
  game.land.Atrebates.pop = 4
  game.land.Atrebates.units.xw = [5,0]
  game.land.Atrebates.sites[0] = {piece:'xs',employer:null}
  game.land.Regni.units.xw = [3,0]
  game.land.Regni.units.mil = [2,0]
  game.land.Regni.sites[0] = {piece:'xs',employer:null}
  game.land.Cantiaci.units.mil = [1,0]
  return game
}

test('Saxons March to enable a Settlement with existing Control, retaining both garrisons', () => {
  const game = secondSettlementPosition()
  const plan = proposeBot(game,ones)
  assert.equal(plan.title,'March + Settle')
  assert.equal(control(plan.after,'Regni'),'x')
  assert.equal(control(plan.after,'Atrebates'),'x')
  assert.deepEqual(plan.after.land.Atrebates.units.xw,[2,0])
  assert.deepEqual(plan.after.land.Regni.units.xw,[4,0])
  assert.deepEqual(plan.after.land.Regni.sites.map(site => site?.piece),['xs','xs'])
  assert.equal(plan.after.tracks.x,0)
  validatePosition(plan.after)
})

test('a March that would leave too small a garrison does not qualify to enable Settle', () => {
  const game = secondSettlementPosition()
  game.land.Regni.units.mil = [1,0]
  // Two arrivals would reach the March target of five Warbands but a second
  // Settlement would leave three Warbands where four are required.
  const plan = proposeBot(game,ones)
  assert.notEqual(plan.title,'March + Settle')
  assert.deepEqual((plan.base ?? plan.after).land.Regni.sites,game.land.Regni.sites)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { availability, clone, control, opening, setImperium, validatePosition } from '../src/position.mjs'
import { declarePivotal, finishAction, startCards } from '../src/sequence.mjs'
import { botPivotalChoice, planRaid, proposeBot } from '../src/bots.mjs'

const ones = Array(32).fill(1)

test('Saxons bank Plunder, draw returning Raiders from adjacent spaces, and Settle', () => {
  const game = opening(144)
  startCards(game,40,42)
  game.land.Iceni.units.xr = [6,2]
  game.land.Iceni.units.xw = [2,0]
  game.land.Trinovantes.units.xr = [4,2]
  game.land.Regni.units.xr = [5,1]
  const before = clone(game)
  const proposal = proposeBot(game,Array(10).fill(6))
  assert.equal(proposal.title,'Return + Settle')
  assert.equal(proposal.after.tracks.x,game.tracks.x+5)
  assert.equal(proposal.after.land.Iceni.units.xw[0],7)
  assert.equal(proposal.after.land.Iceni.pop,game.land.Iceni.pop+1)
  assert.equal(proposal.dice.filter(die => die.label.startsWith('Settle')).length,10)
  assert.ok(proposal.after.land.Iceni.sites.some(site => site?.piece === 'xs'))
  assert.equal(control(proposal.after,'Iceni'),'x')
  for (const name of ['Iceni','Trinovantes','Regni']) assert.deepEqual(proposal.after.land[name].units.xr,[0,0])
  assert.deepEqual(game,before)
  validatePosition(proposal.after)
})

test('Scotti retain a local Warband and establish a Settlement even when conversion rolls fail', () => {
  const game = opening(144)
  startCards(game,55,72)
  game.land.Novantae.units.sr = [10,3]
  game.land.Novantae.units.sw = [5,0]
  game.land.Votadini.units.sr = [5,4]
  const proposal = proposeBot(game,ones)
  assert.equal(proposal.title,'Return + Settle')
  assert.equal(proposal.after.tracks.s,game.tracks.s+7)
  assert.equal(proposal.after.land.Novantae.units.sw[0],3)
  assert.ok(proposal.after.land.Novantae.sites.some(site => site?.piece === 'ss'))
  assert.equal(proposal.dice.filter(die => die.label.startsWith('Settle')).length,15)
  validatePosition(proposal.after)
})

test('Civitates Muster available Militia and Trade for Resources when mustering cannot improve their position', () => {
  const muster = opening(144,{seat:'d'})
  startCards(muster,19,42)
  const recruits = proposeBot(muster,[6,...ones])
  assert.equal(recruits.title,'Muster + Rule')
  assert.equal(availability(recruits.after).mil,0)
  assert.equal(recruits.after.tracks.wealth,3)
  validatePosition(recruits.after)

  const trade = opening(144,{seat:'d'})
  startCards(trade,1,42)
  trade.land.Catuvellauni.units.mil[0] += 6
  finishAction(trade,'command','Train')
  const commerce = proposeBot(trade,[6,6,6,...ones])
  assert.equal(commerce.title,'Trade + Rule')
  assert.equal(commerce.after.tracks.blue,32)
  assert.equal(commerce.after.tracks.wealth,3)
  validatePosition(commerce.after)
})

test('Dux Intercept moves a force to friendly controlled territory and stages Battle', () => {
  const game = opening(144)
  startCards(game,1,6)
  game.land.Dobunni.units.xr = [4,0]
  const proposal = proposeBot(game,ones)
  assert.equal(proposal.mode,'battle')
  assert.match(proposal.title,/^Intercept/)
  assert.deepEqual(proposal.requests,[{name:'Dobunni',attacker:'d',defender:'x',source:'Intercept'}])
  assert.equal(proposal.base.land.Dobunni.units.cav[0],2)
  assert.equal(game.land.Dobunni.units.cav[0],0)
  validatePosition(proposal.base)
})

test('Dux asks a human Civitates to authorize the shared economy under Civilian Dominance', () => {
  const game = opening(144)
  startCards(game,1,6)
  setImperium(game,'ac')
  assert.equal(proposeBot(game,ones).key,'blueConsent')
  assert.ok(['auto','battle','guide'].includes(proposeBot(game,ones,{blueConsent:false}).mode))
})

test('Saxon Pivotal takes priority when enough Foederati can revolt and sets up Shield Wall Battle', () => {
  const game = opening(144,{scenario:'De Excidio Britanniae'})
  startCards(game,19,20)
  game.tracks.x = 15
  game.land.Iceni.units.dxw = [6,0]
  assert.equal(botPivotalChoice(game),null)
  game.land.Iceni.units.dxw[0] += 2
  assert.equal(botPivotalChoice(game),'x')
  game.next = 46
  assert.equal(botPivotalChoice(game),null)
  game.next = 20
  declarePivotal(game,'x')
  const proposal = proposeBot(game,ones)
  assert.equal(proposal.mode,'battle')
  assert.equal(proposal.option,'event')
  assert.equal(proposal.requests[0].shieldWall,true)
  assert.deepEqual(proposal.base.land.Iceni.units.dxw,[0,0])
  assert.deepEqual(proposal.base.land.Iceni.units.xw,[8,0])
  validatePosition(proposal.base)
})

test('Raid modifiers and Event exceptions are reflected in the rolled arrivals', () => {
  const game = opening(144)
  const ordinary = planRaid(game,'x',() => 1)
  game.markers[38] = {type:'capability',side:'shaded'}
  const rising = planRaid(game,'x',() => 1)
  assert.equal(rising.targets[0].potential,ordinary.targets[0].potential+2)
  const pivotal = planRaid(game,'s',() => 1,{free:true,capOverride:5,diceOverride:3})
  assert.equal(pivotal.targets.length,5)
  assert.ok(pivotal.targets.every(target => target.dice === 3 && target.cost === 0))
  validatePosition(rising.state)
  validatePosition(pivotal.state)
})

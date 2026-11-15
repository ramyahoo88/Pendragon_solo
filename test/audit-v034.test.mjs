import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { GROUPS } from '../src/data.mjs'
import { clone, makeRoller, opening, setImperium } from '../src/position.mjs'
import { runBattle } from '../src/battle.mjs'
import { proposeBot } from '../src/bots.mjs'
import { eventChoices, runEvent } from '../src/events.mjs'
import { annonaChoices, planAnnona, resolveAnnona, validateSave } from '../src/sequence.mjs'
import { parseSave } from '../src/session.mjs'

const one = () => 1
const load = name => parseSave(readFileSync(new URL('fixtures/audit-v034/'+name+'.json',import.meta.url),'utf8')).game

for (const militia of [0,1]) {
  test(`Dux March ranks the post-Invite board with ${militia} remaining Civitates Militia`,() => {
    const game = load('736202')
    game.land.Regni.units.mil[0] += militia
    const before = clone(game)
    const proposal = proposeBot(game,[],{blueConsent:false})
    assert.equal(proposal.mode,'auto')
    assert.equal(proposal.title,'March + Invite')
    assert.match(proposal.description,/Regni · convert 4 Saxons Foederati for 4 Resources/)
    assert.match(proposal.description,/→ Votadini/)
    assert.deepEqual(proposal.after.land.Regni.units.cxw,[0,0])
    assert.deepEqual(proposal.after.land.Regni.units.dxw,[3,1])
    assert.deepEqual(proposal.after.land.Regni.units.mil,[militia,0])
    assert.equal(proposal.after.land.Regni.sites[0].employer,'d')
    assert.deepEqual(game,before)
    validateSave(proposal.after)
  })
}

function crossPosition(piece = 'town',cross = true,warbands = 9) {
  const game = opening(334033,{seat:'britons'})
  for (const land of Object.values(game.land)) {
    land.units = Object.fromEntries(GROUPS.map(([key]) => [key,[0,0]]))
    land.sites.fill(null)
    land.pros = [0,0]
  }
  const land = game.land.Corieltauvi
  Object.assign(land.units,{cav:[1,0],mil:[1,0],xw:[warbands,0]})
  land.sites[1] = {piece,employer:null}
  if (cross) game.markers[33] = {type:'momentum',side:'unshaded'}
  return validateSave(game)
}
const attack = {name:'Corieltauvi',attacker:'x',defender:'d',source:'Battle'}
const withdraw = prompt => prompt.stage === 'Withdrawal' ? '1' : prompt.defaultValue

test('#33 adds a full half loss to each allied defender after the Town Escalade base',() => {
  const game = crossPosition()
  const report = runBattle(game,attack,one,withdraw)
  assert.match(report.details.join('\n'),/Escalade at Ratae: attackers take 3\./)
  assert.equal(report.attackerLosses,8)
  assert.deepEqual(game.land.Corieltauvi.units.xw,[1,1])
  const [escalade,storm] = report.assaults
  assert.equal(escalade.attackers.hits,3)
  assert.equal(escalade.attackers.removed.length,3)
  assert.equal(storm.attackers.hits,5)
  assert.equal(storm.attackers.removed.length,5)
  assert.equal(storm.defenders.garrisonLost,2)
})

test('#33 preserves full Fort strength and the unmodified Town calculation',() => {
  const fort = runBattle(crossPosition('fort'),attack,one,withdraw)
  assert.equal(fort.assaults[0].attackers.hits,4)
  assert.equal(fort.attackerLosses,8)
  const unmodified = runBattle(crossPosition('town',false),attack,one,withdraw)
  assert.equal(unmodified.assaults[0].attackers.hits,2)
  assert.equal(unmodified.attackerLosses,6)
})

test('the Saxon assault projection uses the same corrected Escalade losses as resolution',() => {
  const game = crossPosition('town',true,8)
  const report = runBattle(game,attack,one,withdraw)
  assert.deepEqual(report.assaults,[])
  assert.deepEqual(report.destroyed,[])
  assert.deepEqual(game.land.Corieltauvi.units.xw,[8,0])
})

const payer = 'annona-payer-Cantiaci/dxw'
const wealth = 'annona-wealth-spend'
const crossPay = {[payer]:'c',[wealth]:'1'}

test('Annona lists the preceding bot payment and drops a stale duplicate Wealth selection',() => {
  const game = load('annona-cross-pay')
  const before = clone(game)
  const quote = annonaChoices(game,crossPay)
  assert.equal(quote.fields.some(field => field.name === payer),false)
  assert.deepEqual(quote.annona.adjustments,{[payer]:'',[wealth]:''})
  assert.equal(quote.annona.paidByDux[0].id,'Cantiaci/dxw')
  assert.deepEqual(quote.annona.civitates,{blue:0,wealth:0})
  const plan = planAnnona(game,crossPay,one)
  assert.deepEqual(plan.paid,[{id:'Cantiaci/dxw',payer:'d',amount:1}])
  assert.deepEqual(game,before)
  resolveAnnona(game,plan.paid,plan)
  assert.deepEqual([game.tracks.blue,game.tracks.wealth,game.tracks.x],[3,2,18])
})

test('Civitates can still use exact Wealth to pay a red group when Dux cannot pay',() => {
  const game = load('annona-cross-pay')
  game.tracks.blue = 0
  const quote = annonaChoices(game,crossPay)
  assert.ok(quote.fields.find(field => field.name === payer).options.some(([value]) => value === 'c'))
  assert.deepEqual(quote.annona.civitates,{blue:0,wealth:1})
  const plan = planAnnona(game,crossPay,one)
  assert.deepEqual(plan.paid,[{id:'Cantiaci/dxw',payer:'c',amount:1}])
  resolveAnnona(game,plan.paid,plan)
  assert.deepEqual([game.tracks.wealth,game.tracks.x],[1,18])
})

test('Annona consent changes the payable groups with the same tie-break as resolution',() => {
  const game = load('annona-cross-pay')
  setImperium(game,'ac')
  game.tracks.blue = 1
  game.land.Regni.units.dxw = [1,0]
  const regni = 'annona-payer-Regni/dxw'
  const input = {...crossPay,[regni]:'c',[wealth]:'2'}
  const before = clone(game)
  const noConsent = annonaChoices(game,input)
  assert.deepEqual(noConsent.annona.paidByDux,[])
  assert.deepEqual(noConsent.annona.civitates,{blue:0,wealth:2})
  const consent = {...input,blueConsent:'yes'}
  const quote = annonaChoices(game,consent)
  assert.equal(quote.annona.paidByDux.length,1)
  assert.equal(quote.annona.adjustments[wealth],'1')
  assert.deepEqual(quote.annona.civitates,{blue:0,wealth:1})
  assert.deepEqual(game,before)
  const dice = []
  const plan = planAnnona(game,consent,makeRoller(game,dice))
  assert.equal(plan.paid[0].id,quote.annona.paidByDux[0].id)
  assert.equal(plan.paid[1].payer,'c')
  assert.notEqual(plan.paid[0].id,plan.paid[1].id)
  assert.deepEqual(dice.map(die => die.label),['Annona · Regni','Annona · Cantiaci'])
  resolveAnnona(game,plan.paid,plan)
  assert.deepEqual([game.tracks.blue,game.tracks.wealth,game.tracks.x],[0,1,19])
})

test('shaded #10 uses the same Dux-first form and leaves Scotti Foederati alone',() => {
  const game = load('annona-cross-pay')
  game.land.Regni.units.dsw = [1,0]
  const quote = eventChoices(game,10,'x','shaded',crossPay)
  assert.deepEqual(quote.annona.paidByDux.map(payment => payment.id),['Cantiaci/dxw'])
  assert.equal(quote.fields.some(field => field.name === payer),false)
  assert.match(runEvent(game,10,'x','shaded',crossPay,one),/^Dux pays 1/)
  assert.deepEqual(game.land.Regni.units.dsw,[1,0])
  assert.deepEqual([game.tracks.blue,game.tracks.wealth],[3,2])
})

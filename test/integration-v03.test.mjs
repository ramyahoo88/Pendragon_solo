import assert from 'node:assert/strict'
import { test } from 'node:test'
import { replayAction } from '../src/action-resolution.mjs'
import { battleForecast, runBattle } from '../src/battle.mjs'
import { eventPlan, proposeBot } from '../src/bots.mjs'
import { GROUPS, REGIONS } from '../src/data.mjs'
import { applyStilichoRecovery } from '../src/events.mjs'
import { availability, clone, on, opening, sum } from '../src/position.mjs'
import { activeFaction, finishAction, startCards, validateSave } from '../src/sequence.mjs'
import { fresh, parseSave, serialize } from '../src/session.mjs'

const one = () => 1
const ones = Array(40).fill(1)

function beforeCard(id,seat='c') {
  const game = opening(144,{seat})
  startCards(game,id,22)
  return game
}
function moveToFaction(game,faction) {
  while (activeFaction(game) && activeFaction(game) !== faction) finishAction(game,'pass','Pass')
  assert.equal(activeFaction(game),faction)
}
function prepareBattle(game,name,forces,setup) {
  game.land[name].units = Object.fromEntries(GROUPS.map(([key]) => [key,forces[key] ?? [0,0]]))
  game.land[name].sites = game.land[name].sites.map((_,i) => setup[i] ? {piece:setup[i],employer:null} : null)
  game.land[name].pros = [0,0]
}

test('Saxon Lindsey choice replaces the Fort and offers the Foederati to the right employer',() => {
  const game = beforeCard(44)
  const plan = eventPlan(game,'x',one)
  assert.equal(plan.label,'Lindsey · unshaded')
  assert.deepEqual(game.land.Corieltauvi.sites,[
    {piece:'xs',employer:'c'},{piece:'town',employer:null},
  ])
  assert.equal(game.land.Corieltauvi.units.cxw[0],3)
  validateSave(game)
})

test('Scotti Myrddin takes the ordinary Command and Feat and keeps eligibility',() => {
  const game = beforeCard(57)
  const original = clone(game)
  const proposal = proposeBot(game,ones,{blueConsent:false})
  assert.equal(proposal.mode,'auto')
  assert.equal(proposal.option,'event')
  assert.match(proposal.description,/Raid \+ Ransom/)
  assert.deepEqual(proposal.after.acts,[{faction:'s',option:'event',description:'Myrddin'}])
  assert.equal(proposal.after.overrides.s,true)
  assert.deepEqual(game,original)
  validateSave(proposal.after)
})

test('Annona played by Saxons saves and replays the Civitates payment decision',() => {
  const game = beforeCard(10)
  moveToFaction(game,'x')
  game.land.Cantiaci.units.cxw = [1,0]
  const proposal = proposeBot(game,ones,{blueConsent:false})
  assert.equal(proposal.mode,'player-event')
  assert.equal(proposal.player.side,'shaded')
  const session = fresh(game)
  session.work = {kind:'action',draft:null,input:{guide:proposal}}
  const reopened = parseSave(serialize(session))
  const answer = pay => replayAction(reopened.game,{kind:'action',option:'event',id:10,faction:'x',
    side:proposal.player.side,description:'Annona',label:'Annona',dice:proposal.dice,
    origin:{...game,rng:proposal.rng},operation:{input:{'annona-Cantiaci/cxw':pay}}}).after
  const paid = answer(true)
  const revolted = answer(false)
  assert.equal(paid.land.Cantiaci.units.cxw[0],1)
  assert.equal(paid.tracks.blue,game.tracks.blue-1)
  assert.equal(revolted.land.Cantiaci.units.cxw[0],0)
  assert.equal(revolted.land.Cantiaci.units.xw[0],1)
  assert.equal(revolted.tracks.blue,game.tracks.blue)
  validateSave(paid)
  validateSave(revolted)
})

test('Civitates plays Bryneich and the Saxon bot performs the free Raid with no human target input',() => {
  const game = beforeCard(37)
  moveToFaction(game,'c')
  const {after,detail} = replayAction(game,{kind:'action',option:'event',id:37,faction:'c',side:'shaded',
    description:'Bryneich',operation:{grant:true,input:{grant:'x/Raid'},rows:[],featRows:[]}})
  assert.deepEqual(after.markers[37],{type:'capability',side:'shaded'})
  assert.equal(after.tracks.x,game.tracks.x)
  assert.match(detail,/Raiders.*land and take/)
  assert.equal(after.acts.at(-1).faction,'c')
  validateSave(after)
})

test('Ard Ri queues the Dux Intercept against five Raiders without spending Resources',() => {
  const game = beforeCard(58)
  moveToFaction(game,'d')
  game.land.Corieltauvi.units.xr = [5,0]
  const plan = eventPlan(game,'d',one)
  assert.equal(plan.label,'Ard Ri · unshaded')
  assert.deepEqual(plan.requests,[{name:'Corieltauvi',attacker:'d',defender:'x',source:'Intercept'}])
  assert.equal(plan.base.tracks.blue,game.tracks.blue)
  assert.equal(plan.base.tracks.red,game.tracks.red)
  assert.ok(plan.base.land.Corieltauvi.units.cav[0] > game.land.Corieltauvi.units.cav[0])
  validateSave(plan.base)
})

test('Stilicho requires five off-map Cavalry and records its temporary deployment for Recovery',() => {
  const game = beforeCard(4)
  assert.equal(eventPlan(clone(game),'d',one),null)
  for (const {name} of REGIONS) {
    const space = game.land[name]
    const removals = Math.min(on(space,'cav'),5-game.pools.casualties)
    space.units.cav[0] -= removals
    game.pools.casualties += removals
  }
  const plan = eventPlan(game,'d',one)
  assert.equal(plan.label,'Stilicho')
  assert.equal(game.markers[4].recoveryCavalry,5)
  assert.ok(sum(['Atrebates','Regni','Cantiaci'].map(name=>on(game.land[name],'cav'))) >= 10)
  assert.match(applyStilichoRecovery(game),/5 Stilicho Cavalry/)
  assert.equal(availability(game).cav,5)
  validateSave(game)
})

test('Scotti Aneirin checks both the Warband threshold and the early-Epoch window',() => {
  const game = beforeCard(14)
  game.land.Dumnonii.units.sw = [5,0]
  assert.equal(eventPlan(clone(game),'s',one),null)
  game.land.Dumnonii.units.sw[0]++
  const late = {...clone(game),eventIndex:3}
  assert.equal(eventPlan(late,'s',one),null)
  assert.equal(eventPlan(game,'s',one).label,'Aneirin · shaded')
  assert.deepEqual(game.markers[14],{type:'momentum',side:'shaded'})
  validateSave(game)
})

test('the Raid forecast includes a successful defender Ambush in Hills',() => {
  const game = opening(16001)
  prepareBattle(game,'Dumnonii',{xr:[8,0],sr:[5,0]},['ss'])
  const config = {name:'Dumnonii',attacker:'x',defender:'s',source:'Raid',attackers:{xr:[8,0]},noWithdraw:true}
  assert.deepEqual(battleForecast(game,config).destroyed,[0])
  const ambush = battleForecast(game,{...config,defenderAmbush:true})
  assert.deepEqual(ambush.destroyed,[])
  assert.equal(ambush.defenderField,2)
  assert.equal(game.land.Dumnonii.units.xr[0],8)
})

test('Cair Legion defends by Charging before the Cavalry withdraws',() => {
  const game = opening(16001)
  prepareBattle(game,'Corieltauvi',{cav:[1,0],sr:[4,0]},['fort'])
  game.markers[7] = {type:'capability',side:'unshaded'}
  const report = runBattle(game,{name:'Corieltauvi',attacker:'s',defender:'d',source:'Raid'},one)
  assert.equal(report.attackerLosses,2)
  assert.equal(report.details.findIndex(line => line.startsWith('Charge / Ambush')),0)
  assert.match(report.details[1],/^Cavalry withdraws after its Charge/)
})

test('the Saxon bot starts a viable Fort Assault with Bravery',() => {
  const game = opening(16001)
  prepareBattle(game,'Atrebates',{xw:[2,0]},['fort'])
  game.markers[41] = {type:'momentum',side:'shaded',faction:'x'}
  const report = runBattle(game,{name:'Atrebates',attacker:'x',defender:'d',source:'Battle'},one)
  assert.deepEqual(report.destroyed,[0])
  assert.equal(report.attackerLosses,0)
})

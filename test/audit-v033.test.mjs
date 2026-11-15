import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { REGIONS, GROUPS } from '../src/data.mjs'
import { annonaChoices, planAnnona, resolveAnnona, startCards, validateSave } from '../src/sequence.mjs'
import { control, clone, opening, setImperium } from '../src/position.mjs'
import { battleForecast, runBattle } from '../src/battle.mjs'
import { planBotGrant, proposeBot } from '../src/bots.mjs'
import { runEvent } from '../src/events.mjs'
import { replayAction } from '../src/action-resolution.mjs'
import { fresh, parseSave, serialize } from '../src/session.mjs'

const one = () => 1
const six = () => 6
const choice = prompt => prompt.defaultValue

for (const seed of [601029,601202,601304]) {
  test(`Mistborn resolves a legal proposal from the v0.3.2 campaign save at seed ${seed}`, () => {
    const save = readFileSync(new URL(`./fixtures/mistborn/${seed}.json`,import.meta.url),'utf8')
    const { game } = parseSave(save)
    const original = clone(game)
    const plan = proposeBot(game,[],{blueConsent:false})
    assert.match(plan.title,/^Mistborn/)
    assert.ok(['battle','player-event'].includes(plan.mode))
    if (plan.mode === 'battle') {
      assert.equal(plan.option,'event')
      for (const request of plan.requests) assert.doesNotThrow(() => battleForecast(plan.base,request))
    } else {
      assert.equal(plan.player.recipient,'c')
    }
    assert.deepEqual(game,original)
  })
}

test('Mistborn can still forecast a Dux Battle with local Cavalry', () => {
  const game = opening(601029,{seat:'x'})
  game.land.Parisi.units.sr = [3,2]
  game.land.Parisi.units.cav = [1,0]
  game.land.Carvetii.units.cav[0]--
  const plan = planBotGrant(game,52,'d','unshaded',one,{recipient:'d'})
  assert.ok(plan.requests.some(request => request.name === 'Parisi' && request.attacker === 'd'))
})

function battlePosition(seat,name,units,site = null) {
  const game = opening(16001,{seat})
  for (const land of Object.values(game.land)) {
    land.units = Object.fromEntries(GROUPS.map(([key]) => [key,[0,0]]))
    land.sites.fill(null)
    land.pros = [0,0]
  }
  Object.assign(game.land[name].units,units)
  if (site) game.land[name].sites[site.index] = {piece:site.piece,employer:null}
  return game
}
const battle = (name,attacker,defender) => ({name,attacker,defender,source:'Battle'})

test('a Scotti defender withdraws if Charge would prevent its only Field Strike', () => {
  const name = 'Corieltauvi'
  const settlement = {index:0,piece:'ss'}
  const game = battlePosition('d',name,{cav:[2,0],sw:[1,0]},settlement)
  const report = runBattle(game,battle(name,'d','s'),one,choice)
  assert.equal(report.cavalryLosses,1)
  assert.deepEqual(report.destroyed,[0])
  assert.match(report.details.join(' '),/1 defending Unit withdraws/)

  const simultaneous = battlePosition('x',name,{xw:[2,0],sw:[1,0]},settlement)
  const control = runBattle(simultaneous,battle(name,'x','s'),one,choice)
  assert.equal(control.attackerLosses,1)
  assert.doesNotMatch(control.details.join(' '),/withdraws/)
})

test('Cair Legion requests the allied Town owner’s permission after Charge and honors either answer', () => {
  const name = 'Corieltauvi'
  const original = battlePosition('c',name,{cav:[1,0],xw:[4,0]},{index:1,piece:'town'})
  original.markers[7] = {type:'capability',side:'unshaded'}
  for (const answer of ['no','yes']) {
    const game = clone(original)
    const admission = []
    const result = runBattle(game,battle(name,'x','d'),one,prompt => {
      if (!prompt.title.startsWith('Admit allied')) return prompt.defaultValue
      admission.push(prompt)
      return answer
    })
    assert.equal(admission.length,1)
    assert.equal(admission[0].stage,'Charge / Ambush')
    assert.equal(admission[0].context.holdings[0].capacity,4)
    assert.equal(admission[0].context.attackers[0].count,3)
    assert.equal(result.cavalryLosses,answer === 'no' ? 1 : 0)
  }
})

test('Non-player Escalade removes empty Cavalry first and preserves the same casualty total', () => {
  const name = 'Eboracum'
  for (const [loaded,expected] of [[1,1],[0,0],[6,1]]) {
    const game = battlePosition('c',name,{cav:[6,loaded],sw:[1,0]},{index:0,piece:'ss'})
    const result = runBattle(game,battle(name,'d','s'),one)
    assert.equal(result.cavalryLosses,5)
    assert.deepEqual(game.land[name].units.cav,[1,expected])
  }
})

test('Both Britons can agree to lose two Militia instead of Cavalry and resume the same choice after reload', () => {
  const name = 'Corieltauvi'
  const game = battlePosition('britons',name,{cav:[1,0],mil:[2,0],xw:[1,0]})
  const origin = clone(game)
  const request = battle(name,'x','d')
  let agreed
  runBattle(game,request,six,prompt => {
    if (prompt.title !== 'Agree how to share Briton losses') return prompt.defaultValue
    agreed = prompt.options.find(option => option.label === 'Dux 0 · Civitates 1')?.value
    return agreed
  })
  assert.ok(agreed)
  assert.deepEqual(game.land[name].units.cav,[1,0])
  assert.deepEqual(game.land[name].units.mil,[0,0])
  assert.deepEqual(game.land[name].units.xw,[0,0])

  const fallback = clone(origin)
  runBattle(fallback,request,six,choice)
  assert.deepEqual(fallback.land[name].units.cav,[0,0])
  assert.deepEqual(fallback.land[name].units.mil,[2,0])

  // Seed 16001 rolls a 6 for the Saxon Ambush on replay.
  const job = {kind:'sample',label:'Briton losses',origin,requests:[request]}
  const first = replayAction(origin,job)
  assert.equal(first.prompt.title,'Agree how to share Briton losses')
  const saved = fresh(origin)
  saved.work = {kind:'action',draft:null,input:{battle:{job,answers:[]}}}
  const reloaded = parseSave(serialize(saved))
  assert.deepEqual(replayAction(reloaded.game,reloaded.work.input.battle.job),first)
  assert.deepEqual(replayAction(reloaded.game,reloaded.work.input.battle.job,[agreed]).after.land[name].units.mil,[0,0])
  const oldSave = JSON.parse(serialize(saved))
  oldSave.version = '0.3.2'
  oldSave.session.work.input.battle.answers = ['obsolete']
  assert.deepEqual(parseSave(JSON.stringify(oldSave)).work.input.battle.answers,[])
})

function ravagePosition() {
  const game = opening(8128,{seat:'c'})
  startCards(game,40,42)
  game.land.Parisi.units.xw = [8,0]
  game.land.Parisi.sites.fill(null)
  return game
}

test('Saxon Battle adds Ravage for extra Plunder and uses the normal Ravage die', () => {
  const game = ravagePosition()
  const plan = proposeBot(game)
  assert.equal(plan.title,'Battle + Ravage')
  assert.equal(plan.decision.rule,'§8.6.4')
  const request = plan.requests[0]
  assert.equal(request.ravage,true)
  runBattle(plan.base,request,six)
  assert.deepEqual([plan.base.land.Parisi.units.xw[1],plan.base.land.Parisi.pop,plan.base.tracks.refugees],[4,1,1])
})

test('Saxon Battle prefers Shield Wall when it saves a Warband and skips Ravage without extra cargo room', () => {
  const shield = ravagePosition()
  shield.land.Carvetii.units.cav[0]--
  shield.land.Parisi.units.cav = [1,0]
  assert.equal(proposeBot(shield).title,'Battle + Shield Wall')
  const noCargo = ravagePosition()
  noCargo.land.Parisi.units.xw = [2,0]
  assert.equal(proposeBot(noCargo).title,'Battle')
})

test('Saxon Ravage leaves out a separate target that needs a Surprise Assault', () => {
  const game = ravagePosition()
  const site = game.land.Carvetii
  site.units.xw = [2,0]
  site.units.cav = [0,0]
  site.units.mil = [0,0]
  site.sites[1] = null
  const plan = proposeBot(game)
  assert.equal(plan.title,'Battle + Ravage')
  assert.deepEqual(plan.requests.map(request => request.name),['Parisi'])
  assert.doesNotMatch(plan.description,/Carvetii/)
})

test('shaded Celyddon Coed opens the Scotti Battle branch only in Hills', () => {
  const openingWithWarband = name => {
    const game = opening(16384,{seat:'c'})
    startCards(game,55,72)
    game.markers[56] = {side:'shaded',type:'capability'}
    game.land[name].units.sw = [1,0]
    return game
  }
  assert.match(proposeBot(openingWithWarband('Atrebates')).title,/^Raid/)
  const hills = proposeBot(openingWithWarband('Silures'))
  assert.match(hills.title,/^Battle/)
  assert.match(battleForecast(hills.base,hills.requests[0]).details.join(' '),/Trap:/)
})

test('Dux March fills the same destination until its Battle objective or payment limit is met', () => {
  const position = (defenders,resources) => {
    const game = opening(13365,{seat:'s'})
    startCards(game,3,9)
    setImperium(game,'f')
    game.tracks.red = resources
    game.tracks.blue = 0
    for (const {name} of REGIONS) {
      const space = game.land[name]
      space.units.cav = [0,0]
      space.units.mil = [0,0]
      space.sites = space.sites.map(site => site?.piece === 'fort' ? site : null)
    }
    game.land.Brigantes.units.cav = [3,0]
    game.land.Corieltauvi.units.cav = [4,0]
    game.pools.out = 13
    game.land.Parisi.sites[1] = {piece:'xs',employer:null}
    game.land.Parisi.units.xw = [defenders,0]
    return validateSave(game)
  }
  for (const [defenders,resources,moved,remaining] of [[6,4,6,0],[2,4,3,2],[6,2,3,0]]) {
    const plan = proposeBot(position(defenders,resources))
    assert.equal(plan.title,'March')
    assert.deepEqual([plan.after.land.Parisi.units.cav[0],plan.after.land.Corieltauvi.units.cav[0],plan.after.tracks.red],[moved,1,remaining])
  }
})

test('a legal Town that adds Control opens Non-player Civitates Muster', () => {
  const game = opening(13393,{seat:'d'})
  startCards(game,19,42)
  const towns = new Set(['Londinium','Atrebates','Cantiaci','Regni','Trinovantes'])
  for (const {name} of REGIONS) {
    const space = game.land[name]
    space.units.mil = [0,0]
    space.units.cav = [0,0]
    space.sites = space.sites.map(site => site?.piece === 'town' && !towns.has(name) ? null : site)
  }
  game.land.Eboracum.units.mil = [2,0]
  game.land.Eboracum.sites.fill(null)
  game.land.Londinium.units.mil = [28,0]
  game.pools.out = 20
  game.tracks.wealth = 2
  const plan = proposeBot(validateSave(game))
  assert.match(plan.title,/^Muster/)
  assert.equal(control(plan.after,'Eboracum'),'b')
  game.tracks.wealth = 1
  assert.match(proposeBot(game).title,/^Surrey/)
})

function annonaPosition(seat = 'c') {
  const game = opening(320144,{seat})
  game.tracks.blue = 2
  game.tracks.wealth = 2
  game.land.Cantiaci.units.cxw = [1,0]
  return game
}
const civitatesPays = {'annona-payer-Cantiaci/cxw':'c','annona-wealth-spend':'1'}

test('human Civitates can choose an exact Wealth payment at Annona and shaded Event #10', () => {
  const game = annonaPosition()
  assert.ok(annonaChoices(game).fields.some(field => field.name === 'annona-wealth-spend'))
  const plan = planAnnona(game,civitatesPays,one)
  resolveAnnona(game,plan.paid,plan)
  assert.deepEqual([game.tracks.blue,game.tracks.wealth,game.land.Cantiaci.units.cxw[0]],[2,1,1])

  const event = annonaPosition()
  event.land.Cantiaci.units.csw = [1,0]
  runEvent(event,10,'c','shaded',civitatesPays,one)
  assert.deepEqual([event.tracks.blue,event.tracks.wealth,event.land.Cantiaci.units.cxw[0]],[2,1,1])
  assert.deepEqual(event.land.Cantiaci.units.csw,[1,0])
})

test('Annona validates the chosen mix after Dux pays and defaults to Wealth if blue is exhausted', () => {
  const game = annonaPosition('britons')
  game.tracks.blue = 1
  game.land.Cantiaci.units.dxw = [1,0]
  const input = {...civitatesPays,'annona-payer-Cantiaci/dxw':'d'}
  const original = clone(game)
  assert.throws(() => planAnnona(game,{...input,'annona-wealth-spend':'0'},one),/after Dux pays/)
  assert.throws(() => planAnnona(game,{...input,'annona-wealth-spend':'2'},one),/cannot exceed/)
  assert.deepEqual(game,original)
  for (const amount of ['1','']) {
    const after = clone(game)
    const plan = planAnnona(after,{...input,'annona-wealth-spend':amount},one)
    resolveAnnona(after,plan.paid,plan)
    assert.deepEqual([after.tracks.blue,after.tracks.wealth],[0,1])
  }
})

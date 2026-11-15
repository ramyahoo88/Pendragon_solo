import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { replayAction } from '../src/action-resolution.mjs'
import { battleEnemies } from '../src/battle.mjs'
import { botPivotalChoice, makeRoller, proposeBot } from '../src/bots.mjs'
import { DIFFICULTIES, REGIONS, SOLO_SEATS } from '../src/data.mjs'
import { epochChoices, runEpochEconomy } from '../src/epoch-economy.mjs'
import { applyStilichoRecovery } from '../src/events.mjs'
import { raidPaths } from '../src/operations.mjs'
import { availability, friendlyControl, isHumanFaction, loaded, on, opening, scores } from '../src/position.mjs'
import { SCENARIOS } from '../src/scenarios.mjs'
import { fresh, serialize } from '../src/session.mjs'
import {
  actionOptions, activeFaction, advanceCard, advanceEpoch, annonaPolicy, canUseOmens, declarePivotal,
  finishAction, inCardOrder, maxHoard, resolveOmens, settleEntropy, startDigitalDeck, upcomingDigitalCard, validateSave,
} from '../src/sequence.mjs'

const regions = REGIONS.map(({name}) => name)
const add = (object,key) => { object[key] = (object[key] ?? 0)+1 }
let failureDirectory

function failureSave(game,seed) {
  failureDirectory ??= mkdtempSync(join(tmpdir(),'pendragon-sweep-'))
  const path = join(failureDirectory,`${seed}-${game.scenario.replaceAll(' ','_')}-${game.humans.join('')}-${game.difficulty}.json`)
  writeFileSync(path,serialize(fresh(game)))
  return path
}

function replay(game,job,counts) {
  const answers = []
  for (let step=0;step<500;step++) {
    const result = replayAction(game,job,answers)
    if (!result.prompt) return result.after
    const {prompt} = result
    const answer = tactics === 'first' ? prompt.options[0].value :
      tactics === 'last' ? prompt.options.at(-1).value : prompt.defaultValue
    answers.push(answer)
    counts.tacticalChoices++
  }
  throw new Error('Tactical prompt limit reached.')
}

function landing(game,faction,names,free=false) {
  if (!availability(game)[faction+'r']) return null
  const surcharge = faction === 's' && game.markers[63]?.side === 'unshaded' ? 1 : 0
  const funds = game.tracks[faction]
  const small = !free && funds < (faction === 's' ? 1+surcharge : 2)
  if (!free && funds < (faction === 's' ? surcharge : 1)) return null
  const targets = names.map(name => ({name,path:raidPaths(game,faction,name)[0]}))
    .filter(({path})=>path).sort((a,b)=>a.path.minus-b.path.minus)
  const target = targets[0]
  return target ? {space:target.name,route:target.path.key,dice:small ? 'one' : ''} : null
}

function humanOperation(game,faction,limited) {
  const single = (command,row) => ({command,rows:[row]})
  if (faction === 'd') {
    const target = regions.find(name => ['cav','dxw','dsw'].some(key=>on(game.land[name],key)) &&
      friendlyControl(game,name,faction) && battleEnemies(game,name,faction,'Intercept').length)
    if (target) return single('Intercept',{space:target,enemy:battleEnemies(game,target,faction,'Intercept')[0]})
    const place = regions.find(name => game.land[name].sites.some(site=>site?.piece === 'fort'))
    const funds = game.tracks.red + (game.imperium === 'rm' || game.imperium === 'am' ? game.tracks.blue : 0)
    if (place && funds >= 3 && availability(game).cav) return single('Train',{space:place,cavalry:1})
    return null
  }
  if (faction === 'c') {
    const town = regions.find(name => game.land[name].sites.some(site=>site?.piece === 'town'))
    if (town && game.tracks.blue < 55) return {command:'Trade',rows:limited ? [{space:town}] : []}
    return null
  }
  const returns = regions.filter(name => loaded(game.land[name],faction+'r') || loaded(game.land[name],faction+'w'))
  if (returns.length && (limited || game.eventIndex%2 === 0)) return {command:'Return',rows:returns.slice(0,limited ? 1 : returns.length).map(space=>({space}))}
  const target = landing(game,faction,regions)
  return target ? single('Raid',target) : null
}

function recipientAction(game,proposal,counts,active) {
  const player = proposal.player
  const {recipient,command} = player
  const input = {...player.input}
  const rows = []
  if (active && recipient) {
    const names = regions.filter(name=>REGIONS.find(region=>region.name===name).terrain !== 'City')
    const route = ['x','s'].includes(recipient) && (!command || command === 'Raid')
      ? landing(game,recipient,names,game.current !== 52) : null
    if (route) {
      input.grant = recipient+'/Raid'
      rows.push(route)
    }
  }
  if (active && game.current === 10) {
    const own = game.humans.includes('c') ? 'cxw' : 'dxw'
    const track = own === 'cxw' || game.imperium === 'rm' ? 'blue' : 'red'
    const name = regions.find(name => on(game.land[name],own) > loaded(game.land[name],own) &&
      on(game.land[name],own) <= game.tracks[track])
    if (name) input['annona-'+name+'/'+own] = true
  }
  return replay(game,{kind:'action',option:'event',id:game.current,faction:proposal.faction,
    side:player.side,label:proposal.title,description:proposal.title,origin:{...game,rng:proposal.rng},dice:proposal.dice,
    operation:{grant:game.current !== 10,restriction:player,input,rows,featRows:[]}},counts)
}

function run(settings,seed,active,counts) {
  let game = opening(seed,{...settings,deckMode:'digital'})
  startDigitalDeck(game)
  for (let step=0;step<450 && !game.result;step++) {
    const before = game
    try {
      const phase = game.epochPhase
      if (game.entropy) settleEntropy(game,game.entropy[0])
      else if (phase) {
        const dice = []
        const roll = makeRoller(game,dice)
        const blueConsent = !isHumanFaction(game,'c') && scores(game).d.margin < scores(game).c.margin
        const paid = phase === 'Annona' && game.markers[10]?.side !== 'unshaded' ? annonaPolicy(game,[],{blueConsent},roll) : []
        const note = epochChoices(game,phase,{blueConsent}) ? runEpochEconomy(game,phase,{blueConsent},roll) : ''
        const hoard = isHumanFaction(game,'c') ? 0 : maxHoard(game)
        advanceEpoch(game,{paid,note,hoard,blueConsent,dice,beforeRecovery:()=>applyStilichoRecovery(game)},upcomingDigitalCard(game))
      } else if (game.complete) advanceCard(game,upcomingDigitalCard(game))
      else {
        const pivotal = botPivotalChoice(game)
        const faction = activeFaction(game)
        if (pivotal) {
          declarePivotal(game,pivotal)
          counts.pivotals++
        } else if (canUseOmens(game) && !isHumanFaction(game,game.omens.holder) &&
            inCardOrder(game).filter(owner=>game.eligibility.includes(owner)).indexOf(game.omens.holder) >= 2) {
          resolveOmens(game,true)
        } else if (isHumanFaction(game,faction)) {
          const option = actionOptions(game).find(key => key === 'command' || key === 'limited')
          const options = {limited:option==='limited'}
          const operation = active && option ? humanOperation(game,faction,options.limited) : null
          if (operation) {
            const {command,rows} = operation
            game = replay(game,{kind:'action',option,description:command,operation:{faction,command,rows,options,input:{},featRows:[]}},counts)
            add(counts.playerCommands,command)
          } else finishAction(game,'pass','Pass')
        } else {
          const proposal = proposeBot(game,[],{blueConsent:false,reinforceConsent:active})
          add(counts.botModes,proposal.mode)
          if (proposal.option === 'event' || proposal.mode === 'player-event') add(counts.botEvents,game.current)
          if (proposal.mode === 'auto') game = proposal.after
          else if (proposal.mode === 'battle') {
            game = replay(game,{kind:'action',option:proposal.option,description:proposal.title,origin:proposal.base,
              dice:proposal.dice,requests:proposal.requests,afterRaid:proposal.afterRaid,overrides:proposal.overrides,
              descriptionText:proposal.description},counts)
          } else if (proposal.mode === 'player-event') game = recipientAction(game,proposal,counts,active)
          else throw new Error('Unexpected bot mode: '+proposal.mode+' · '+proposal.title)
        }
      }
    } catch (error) {
      // Planner and tactical replays work on copies. A failed proposal leaves this position intact.
      const failure = new Error('Card '+before.current+', Epoch '+before.epoch+', phase '+before.epochPhase+
        ', acting faction '+activeFaction(before),{cause:error})
      failure.save = failureSave(before,seed)
      throw failure
    }
    validateSave(game)
  }
  if (!game.result) throw new Error('Campaign did not reach scoring.')
}

function sweep(active) {
  const counts = {completed:0,botModes:{},botEvents:{},playerCommands:{},pivotals:0,tacticalChoices:0,failures:[]}
  for (const [scenarioIndex,scenario] of Object.keys(SCENARIOS).entries()) for (const [seatIndex,seat] of Object.keys(SOLO_SEATS).entries()) {
    for (const [i,difficulty] of DIFFICULTIES.entries()) {
      const variant = i%2 === 1
      const seed = seedBlock ? seedBlock+(active ? 1000 : 0)+scenarioIndex*100+seatIndex*10+i :
        freshSeeds ? (active ? 602000 : 601000)+scenarioIndex*101+seatIndex*13+i :
        active ? 37171+i*89 : 97+i*17
      try {
        run({scenario,seat,difficulty,variant},seed,active,counts)
        counts.completed++
      } catch (error) {
        counts.failures.push({scenario,seat,difficulty,variant,seed,position:error.message,cause:error.cause?.message,save:error.save})
      }
    }
  }
  console.log(JSON.stringify({policy:active ? 'active' : 'pass',seeds:seedBlock || (freshSeeds ? 'fresh' : 'baseline'),tactics,...counts}))
  if (counts.failures.length) process.exitCode = 1
}

const args = process.argv.slice(2)
const freshSeeds = args.includes('--fresh')
const seedArg = args.find(arg => arg.startsWith('--seed-block='))
const seedBlock = seedArg ? Number(seedArg.split('=')[1]) : null
const tacticsArg = args.find(arg => arg.startsWith('--tactics='))
const tactics = tacticsArg ? tacticsArg.split('=')[1] : 'default'
const selection = args.filter(arg => !['--fresh',seedArg,tacticsArg].includes(arg))
if (selection.some(value => !['active','pass'].includes(value)) || !['default','first','last'].includes(tactics) ||
    seedArg && (freshSeeds || !Number.isInteger(seedBlock) || seedBlock < 1 || seedBlock > 0xffffffff-2000)) {
  throw new Error('Use active, pass, or omit the policy to run both. Choose --fresh or --seed-block=N, and optionally --tactics=first or --tactics=last.')
}
if (!selection.length || selection.includes('pass')) sweep(false)
if (!selection.length || selection.includes('active')) sweep(true)

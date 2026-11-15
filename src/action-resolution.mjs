import { BY_NAME, NAMES } from './data.mjs'
import { BattleChoice, runBattle } from './battle.mjs'
import { runCommand } from './commands.mjs'
import { eventBattleRequests, runEvent } from './events.mjs'
import { grantOperation, humanSaxonResponse, runGrantedEvent } from './grants.mjs'
import { raidBonusPlunder, runMilitary } from './operations.mjs'
import { availability, changeTrack, clone, ensure, isHumanFaction, loaded, on, plunderTo } from './position.mjs'
import { finishAction, log } from './sequence.mjs'
import { makeRoller, planBotGrant, planRaid } from './bots.mjs'

export function replayAction(state,job,answers=[]) {
  const after = clone(job.origin ?? state)
  const data = job.descriptionText ? [job.descriptionText] : []
  const battles = []
  const dice = [...(job.dice || [])]
  const roll = makeRoller(after,dice)
  const overrides = {...job.overrides}
  let index = 0
  let lastSpace = ''
  let afterRaid = job.afterRaid
  const reply = question => {
    if (index === answers.length) throw new BattleChoice({
      ...question,index,name:question.name ?? lastSpace,progress:[...data,...(question.progress || [])],
    })
    const answer = answers[index++]
    ensure(question.options.some(option => option.value === answer),'A saved tactical choice is unavailable.')
    return answer
  }
  function finishDeepRaid(config,survivors,evaded) {
    const {name,attacker,raidController,raidOpponent} = config
    const land = after.land[name]
    const emptyRaiders = evaded || BY_NAME[name].terrain === 'City' ? 0 : survivors
    const basePlunder = plunderTo(land,attacker+'r',Math.min(land.pop,emptyRaiders))
    const taken = basePlunder+raidBonusPlunder(after,name,attacker,raidController,emptyRaiders-basePlunder)
    if (raidOpponent) changeTrack(after,raidOpponent,-taken)
    if (taken) data.push('Surviving Deep Raiders take '+taken+' Plunder.')
    return taken
  }
  function fight(config) {
    lastSpace = config.name
    if (config.choice) {
      const response = reply({
        stage:config.choice === 'deep-reaction' ? 'Deep Raid' : 'Ravage',
        title:'Does '+(NAMES[config.reactionFaction] || 'the defender')+' force a Battle?',
        options:[{value:'yes',label:'Fight'},{value:'no',label:'Decline'}],defaultValue:'no',
      })
      if (response === 'no') {
        if (config.ifDeclined?.afterDeepRaid) return fight(config.ifDeclined)
        const take = config.afterDeepRaid ? finishDeepRaid(config,config.landed,false) : 0
        if (!config.ifDeclined) return null
        const fallback = config.ifDeclined
        const piece = config.attacker+'r'
        const units = fallback.attackers?.[piece]
        return fight(take && units ? {...fallback,attackers:{...fallback.attackers,[piece]:[units[0],units[1]+take]}} : fallback)
      }
    }
    if (config.source === 'Ravage') {
      for (const [key,[count,plunder]] of Object.entries(config.defenders ?? {})) {
        const land = after.land[config.name]
        const carried = Math.min(plunder,loaded(land,key))
        const empty = Math.min(count-plunder,on(land,key)-loaded(land,key))
        config = {...config,defenders:{...config.defenders,[key]:[carried+empty,carried]}}
      }
    }
    if (config.reactionFaction) data.push(NAMES[config.reactionFaction]+' forces Battle in '+config.name+'.')
    const report = runBattle(after,config,roll,reply)
    if (report.details.length) data.push(report.name+' · '+report.details.join(' '))
    if (report.assaults.length) battles.push({name:report.name,assaults:report.assaults})
    if (config.afterDeepRaid) finishDeepRaid(config,Math.max(0,report.attackingRaiderSurvivors-report.attackerPlunder),report.attackerEvaded)
    return report
  }
  function saxonFollowUp() {
    lastSpace = ''
    let accepted = false
    if (isHumanFaction(after,'x')) {
      const result = humanSaxonResponse(after,roll,fight,reply)
      accepted = result.accepted
      if (result.note) data.push(result.note)
    } else if (availability(after).xr >= 10) {
      const raid = planRaid(after,'x',roll,{free:true,capOverride:4,diceOverride:3,allowedFeat:true})
      if (raid.targets?.length) {
        accepted = true
        raid.state.rng = after.rng
        Object.assign(after,raid.state)
        data.push(raid.description,...raid.notes)
        for (const config of raid.requests) fight(config)
      }
    }
    if (accepted) {
      after.eligibility = after.eligibility.filter(faction => faction !== 'x')
      overrides.x = false
    }
    after.markers[73] = {type:'capability',side:'unshaded'}
    data.push('Scotti lose their homeland access to Oceanus Septentrionalis.')
  }
  try {
    if (job.requests) {
      for (const config of job.requests) fight(config)
    } else if (job.option === 'event' && job.operation.grant) {
      const grant = grantOperation(after,job.id,job.faction,job.side,job.operation.input,job.operation.restriction)
      if (grant?.owner && !isHumanFaction(after,grant.owner)) {
        const plan = planBotGrant(after,job.id,job.faction,job.side,roll,{
          recipient:grant.owner,command:grant.command,input:job.operation.input,
          blueConsent:job.operation.input.blueConsent === 'yes',
        })
        if (plan?.base) {
          const rng = after.rng
          Object.assign(after,plan.base,{rng})
          if (plan.description) data.push(plan.description)
          for (const config of plan.requests) fight(config)
          afterRaid = plan.afterRaid ?? afterRaid
        } else {
          const note = runGrantedEvent(after,job.id,job.faction,job.side,{...job.operation,rows:[],featRows:[]},roll,fight,reply)
          data.push(note,NAMES[grant.owner]+' has no qualifying granted action.')
        }
      } else {
        const note = runGrantedEvent(after,job.id,job.faction,job.side,job.operation,roll,fight,reply)
        if (note) data.push(note)
      }
    } else if (job.option === 'event') {
      const requests = eventBattleRequests(after,job.id,job.faction,job.side,job.operation.input)
      const note = runEvent(after,job.id,job.faction,job.side,job.operation.input,roll)
      if (note) data.push(note)
      for (const config of requests) fight(config)
    } else if (['Battle','Intercept','Raid'].includes(job.operation.command)) {
      const note = runMilitary(after,job.operation,roll,fight,reply)
      if (note) data.push(note)
    } else {
      data.push(runCommand(after,job.operation,roll))
    }
    if (afterRaid?.type === 'swift-return') {
      const {faction,name} = afterRaid
      if (on(after.land[name],faction+'r')+on(after.land[name],faction+'w')) {
        data.push(runCommand(after,{faction,command:'Return',feat:'',options:{free:true,spaceLimit:1},rows:[{space:name}]},roll))
      }
    }
    if (afterRaid?.type === 'conspiratio-barbarica' || job.id === 73 && job.operation?.grant) saxonFollowUp()
    ensure(index === answers.length,'Tactical choices no longer match the saved campaign.')
    const detail = data.filter(Boolean).join(' ')
    if (job.kind === 'action') finishAction(after,job.option,job.description,detail.slice(0,2940),dice,overrides)
    if (job.kind === 'sample') log(after,'Sample Battle',detail.slice(0,2940),dice)
    return {after,dice,detail,battles}
  } catch (error) {
    if (error instanceof BattleChoice) return {prompt:error.prompt,dice}
    throw error
  }
}

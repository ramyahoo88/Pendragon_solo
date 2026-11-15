import { BY_NAME, FACTIONS, SCHEMA, VERSION } from './data.mjs'
import { ensure, inRange, opening } from './position.mjs'
import { validateSave } from './sequence.mjs'

export const STORAGE_KEY = 'pendragon-solo.barbarian-conspiracy'
export const HISTORY_LIMIT = 10

export const fresh = (game = opening()) => ({ game, undo: [], redo: [], work: null })
export function push(session, label, after) {
  validateSave(after)
  session.undo = [...session.undo, { label, game: session.game }].slice(-HISTORY_LIMIT)
  session.game = after
  session.redo = []
  session.work = null
}
export function rewind(session, direction) {
  const stack = direction === 'undo' ? session.undo : session.redo
  const destination = direction === 'undo' ? session.redo : session.undo
  const record = stack.pop()
  if (!record) return false
  destination.push({ label:record.label, game:session.game })
  session.game = record.game
  session.work = null
  return true
}
export const serialize = session => JSON.stringify({ app:'pendragon-solo', schema:SCHEMA, version:VERSION, session })
export function parseSave(text) {
  const data = JSON.parse(text)
  ensure(data?.app === 'pendragon-solo' && data.schema === SCHEMA, 'Choose a Pendragon companion JSON save from this version.')
  const candidate = data.session
  validateSave(candidate?.game)
  for (const direction of ['undo','redo']) {
    ensure(Array.isArray(candidate[direction]) && candidate[direction].length <= HISTORY_LIMIT, 'Invalid action history.')
    for (const record of candidate[direction]) {
      ensure(typeof record.label === 'string' && record.label.length <= 250, 'Invalid action history label.')
      validateSave(record.game)
    }
  }
  if (candidate.work !== null) {
    const work = candidate.work
    ensure(work && ['cards','action','epoch','edit'].includes(work.kind), 'Invalid pending operation.')
    ensure(work.input && typeof work.input === 'object' && JSON.stringify(work.input).length < 700000, 'Invalid pending inputs.')
    if (work.draft !== null) validateSave(work.draft,{ draft:true })
    const { editor, guide, battle } = work.input
    if (battle !== undefined) {
      const { job, answers } = battle
      ensure(job && ['action','sample','staged'].includes(job.kind) && typeof job.label === 'string' &&
        Array.isArray(answers) && answers.length <= 2500 && answers.every(answer => typeof answer === 'string' && answer.length < 80),
      'Invalid pending tactical choices.')
      if (job.origin) validateSave(job.origin,{draft:job.kind === 'staged'})
      if (job.requests) ensure(Array.isArray(job.requests) && job.requests.length < 70 && job.requests.every(request =>
        Object.hasOwn(BY_NAME,request.name) && FACTIONS.includes(request.attacker) && FACTIONS.includes(request.defender)),
      'Invalid pending Battle spaces.')

      if (data.version !== VERSION) {
        // The updated rules can change the sequence of tactical choices.
        // Replan prepared bot actions and retain human command inputs.
        if (job.kind === 'action' && job.requests) delete work.input.battle
        else battle.answers = []
      }
    }
    if (editor !== undefined) ensure(work.draft && (editor === 'tracks' || Object.hasOwn(BY_NAME,editor)), 'Invalid pending board editor.')
    if (guide !== undefined) {
      const instructions = guide?.mode === 'player-event' ? guide.player?.instructions : guide?.instructions
      ensure(work.kind === 'action' && ['guide','player-event'].includes(guide?.mode) && FACTIONS.includes(guide.faction) && typeof guide.title === 'string' &&
        Array.isArray(instructions) && instructions.every(line => typeof line === 'string') &&
        inRange(guide.rng,1,0xffffffff) && Array.isArray(guide.dice) && guide.dice.every(die => typeof die?.label === 'string' &&
          [4,6].includes(die.sides) && inRange(die.value,1,die.sides)), 'Invalid pending bot decision.')
      if (guide.mode === 'player-event') ensure(['shaded','unshaded','single'].includes(guide.player?.side) &&
        (!guide.player.recipient || FACTIONS.includes(guide.player.recipient)), 'Invalid faction receiving an Event action.')
    }
  }
  return candidate
}

import { BY_NAME, COMMANDS, DIFFICULTIES, EDITION, EPOCHS, EPOCH_PHASES, FACTIONS, FEATS, GROUPS, NAMES, PIECES, PIVOTAL, POOLS, REGIONS, ROADS, SCENARIO, SEAS, SOLO_SEATS, STATUS, TRACKS, VERSION } from './data.mjs'
import { card } from './cards.mjs'
import { SCENARIOS, allowedEpochs, printedPopulation, scenarioDeckSize, scenarioInfo } from './scenarios.mjs'
import { battleEnemies } from './battle.mjs'
import { replayAction } from './action-resolution.mjs'
import { commandFields } from './commands.mjs'
import { militaryFields } from './operations.mjs'
import { grantOperation, grantRule } from './grants.mjs'
import { epochChoices, runEpochEconomy } from './epoch-economy.mjs'
import { applyStilichoRecovery, eventChoices, eventSides, stilichoRecoveryChoices } from './events.mjs'
import { addProsperity, availability, boardDiff, boardTotals, changeTrack, clone, control, controlName, ensure, friendlyControl, goldAvailable, groupLabel, humanFactions, inRange, isHumanFaction, loaded, on, opening, plunderTo, scores, setImperium, spendCivitates, toOwner, totalProsperity } from './position.mjs'
import { ACTIONS, actionOptions, activeFaction, advanceCard, advanceEpoch, annonaChoices, canUseOmens, declarePivotal, finishAction, inCardOrder, isPivotalCard, log, maxHoard, pivotalOptions, planAnnona, preview, resolveOmens, settleEntropy, startCards, startDigitalDeck, upcomingDigitalCard } from './sequence.mjs'
import { botPivotalChoice, makeRoller, proposeBot } from './bots.mjs'
import { HISTORY_LIMIT, STORAGE_KEY, fresh, parseSave, push, rewind, serialize } from './session.mjs'

const app = document.querySelector('#app')
const dialog = document.querySelector('#dialog')
const notice = document.querySelector('#notice')
const rulesUrl = 'https://gmtwebsiteassets.s3.us-west-2.amazonaws.com/pendragon/PDGLivingRules.pdf'
const playbookUrl = 'https://s3-us-west-2.amazonaws.com/gmtwebsiteassets/pendragon/PDG_Playbook_FINAL.pdf'
const aidsUrl = 'https://tesera.ru/images/items/1379121/Searchable_Pendragon_NP_Event_Instructions.pdf'
const errataUrl = 'https://s3-us-west-2.amazonaws.com/gmtwebsiteassets/pendragon/Pendragon_Errata%26Clarifications_2019-02-03.pdf'
const clean = value => String(value ?? '').replace(/[&<>"']/g,m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))
const pretty = n => n > 0 ? '+'+n : String(n).replace('-','−')
const state = () => session.game

let session
let saved
let storageProblem = ''
let storageLocked = false
let tab = 'play'
let mapMode = 'map'
let pending = null
let proposal = null
let editorReturn = null
let toastTimer
let dialogView = null
let dialogData = null
try {
  saved = localStorage.getItem(STORAGE_KEY)
  session = saved ? parseSave(saved) : fresh()
} catch {
  session = fresh()
  storageLocked = Boolean(saved)
  storageProblem = saved ? 'The existing save could not be read. It is still available as a raw backup.' : 'Autosave is unavailable. Export a JSON save to keep your progress.'
}

function message(text) {
  notice.textContent = text
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { notice.textContent = '' }, 4200)
}
function save() {
  if (storageLocked) return
  try {
    if (localStorage.getItem(STORAGE_KEY) !== (saved ?? null)) {
      storageLocked = true
      storageProblem = 'Another tab changed the save. Export this tab’s progress or reload the newer save.'
      showStorageProblem()
      return
    }
    const json = serialize(session)
    localStorage.setItem(STORAGE_KEY,json)
    saved = json
    storageProblem = ''
  } catch {
    storageProblem = 'Autosave is unavailable. Export a JSON save to keep your progress.'
  }
  showStorageProblem()
}
function showStorageProblem() {
  const node = document.querySelector('#storage-banner')
  if (node) node.innerHTML = storageProblem ? `<div class="callout warm row"><span>${clean(storageProblem)}</span>${button('Save options','files','compact')}</div>` : ''
}
const icons = {
  brand:'<path d="M3 9h18M5 9V5h3v3h2V4h4v4h2V5h3v4M5 9v11h14V9M10 20v-5a2 2 0 1 1 4 0v5"/>',
  play:'<path d="M6 4l14 8-14 8z"/>',
  map:'<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15"/>',
  journal:'<path d="M6 4h13v16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2m-2 13a2 2 0 0 1 2-2h13M8 8h7m-7 3h5"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  save:'<path d="M4 4h13l3 3v13H4zM8 4v6h8V4m-8 16v-6h8v6"/>',
  undo:'<path d="M8 6l-5 5 5 5M3 11h12a5 5 0 0 1 5 5v2"/>',
  redo:'<path d="M16 6l5 5-5 5m5-5H9a5 5 0 0 0-5 5v2"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  arrow:'<path d="M4 12h15m-5-5 5 5-5 5"/>',
  list:'<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
}
const icon = key => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[key] || ''}</svg>`
const button = (label,action,style = '',data = '',extra = '') => `<button class="btn ${style}" type="button" data-act="${action}"${data ? ` data-value="${clean(data)}"` : ''} ${extra}>${label}</button>`
const badge = (label,kind = '') => `<span class="badge ${kind}">${clean(label)}</span>`
const dot = id => `<i class="dot ${id}" aria-hidden="true"></i>`
const topLabel = (title,b = '') => `<div class="section-top"><h2>${title}</h2>${b}</div>`
const panel = (title,body,right = '') => `<section class="panel"><header class="panel-head"><h2>${title}</h2>${right}</header><div class="panel-body stack">${body}</div></section>`
const selectOptions = (values,selected) => values.map(([value,label]) => `<option value="${clean(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${clean(label)}</option>`).join('')
const field = (label,html) => `<label class="field">${label}${html}</label>`
const number = (label,key,value,min,max,extra = '') => field(label,`<input type="number" inputmode="numeric" name="${key}" value="${clean(value)}" min="${min}" max="${max}" step="1" ${extra}>`)
const numOrNull = value => value === undefined || value === '' ? null : Number(value)

function header() {
  return `<header class="top"><div class="shell">
    <button class="brand" type="button" data-act="tab" data-value="play"><span class="brand-mark">${icon('brand')}</span><span><strong>Pendragon</strong><small>Solo Companion</small></span></button>
    <div class="toolbar">
      ${button(icon('undo'),'history','square ghost','undo',`aria-label="Undo${session.undo.length ? ' '+clean(session.undo.at(-1).label) : ''}" title="Undo${session.undo.length ? ' '+clean(session.undo.at(-1).label) : ''}" ${session.undo.length ? '' : 'disabled'}`)}
      ${button(icon('redo'),'history','square ghost','redo',`aria-label="Redo${session.redo.length ? ' '+clean(session.redo.at(-1).label) : ''}" title="Redo${session.redo.length ? ' '+clean(session.redo.at(-1).label) : ''}" ${session.redo.length ? '' : 'disabled'}`)}
      ${button(icon('save')+' Saves','files','compact')} 
    </div>
  </div></header>`
}
function trackCards(game) {
  const values = scores(game)
  const totals = boardTotals(game)
  const rows = [
    ['c',game.tracks.blue,'Briton Resources',`Wealth ${game.tracks.wealth} · Control ${totals.pop.c}`],
    ['d',game.tracks.red,'Dux Resources',`Prestige ${game.tracks.prestige} · ${game.imperium === 'f' ? 'Control '+totals.pop.d : 'Prosperity '+totals.total}`],
    ['x',game.tracks.x,'Renown',`Control ${totals.pop.x} · Settlements ${values.x.settlements}`],
    ['s',game.tracks.s,'Renown',`Control ${totals.pop.s} · Settlements ${values.s.settlements}`],
  ]
  return `<section class="tracks" aria-label="Faction tracks">${rows.map(([id,value,label,meta]) => `<div class="track">
    <div class="track-label">${dot(id)}${NAMES[id]}${isHumanFaction(game,id) ? ' <small class="muted">· You</small>' : ''}</div>
    <div class="track-line"><strong>${value}</strong>${label}</div><div class="track-meta">${meta}</div>
  </div>`).join('')}</section>`
}
const factionAbbr = {d:'D',c:'C',x:'Sa',s:'Sc'}
function spaceForces(space) {
  const forces = Object.fromEntries(FACTIONS.map(id => [id,{troops:0,raiders:0,plunder:0}]))
  for (const [key,id] of GROUPS) {
    forces[id][key === 'xr' || key === 'sr' ? 'raiders' : 'troops'] += on(space,key)
    forces[id].plunder += loaded(space,key)
  }
  return FACTIONS.flatMap(id => {
    const {troops,raiders,plunder} = forces[id]
    return troops || raiders ? [{id,troops,raiders,plunder}] : []
  })
}
function forceLabel({id,troops,raiders,plunder}) {
  const pieces = [troops && `${troops} ${troops === 1 ? 'Troop' : 'Troops'}`,raiders && `${raiders} ${raiders === 1 ? 'Raider' : 'Raiders'}`].filter(Boolean)
  return `${NAMES[id]} ${pieces.join(', ')}${plunder ? ` · ${plunder} Plunder` : ''}`
}
function board(game, extended = false) {
  const style = mapMode === 'map' ? icon('list')+' List' : icon('map')+' Map'
  const tools = `<div class="board-tools">${button(style,'mapmode','compact ghost')}${extended ? button('Edit tracks','edit-tracks','compact') : ''}</div>`
  return `<section class="panel board-panel">
    <header class="panel-head"><h2>Britannia</h2>${tools}</header>
    ${mapMode === 'map' ? renderMap(game) : regionTable(game)}
    <div class="map-key"><span>${dot('b')} Briton Control · Select a space to inspect it</span>${mapMode === 'map' ? '<span>D Dux · C Civitates · Sa Saxons · Sc Scotti · H Strongholds</span>' : ''}</div>
  </section>`
}
function renderMap(game,targets = null) {
  const mapId = targets ? 'target-map' : 'board-map'
  const land = 'M99 660 118 642 122 626 128 622 118 610 136 599 144 580 151 561 177 561 192 550 193 529 174 523 165 511 148 516 140 506 124 513 109 501 120 490 105 485 123 471 120 455 149 446 157 430 151 415 161 400 141 391 154 378 147 361 158 348 174 349 180 367 192 363 185 342 199 327 211 303 222 286 225 268 235 258 214 249 206 262 190 255 175 235 154 234 145 218 142 200 155 193 157 175 170 173 163 152 153 141 160 124 155 104 141 99 150 85 143 74 155 62 167 66 173 80 192 77 202 61 219 58 228 76 252 63 266 55 284 45 305 43 315 53 310 68 322 74 340 72 369 78 385 88 384 106 392 122 376 138 382 154 408 161 421 178 436 182 443 198 461 205 465 223 482 235 470 243 500 245 509 264 495 279 517 294 523 314 513 331 529 349 542 340 565 349 582 360 594 380 591 401 601 417 587 437 592 453 577 472 586 492 572 510 584 532 579 550 559 568 537 572 527 586 507 583 496 595 477 590 460 605 434 599 421 607 404 599 393 607 373 597 344 611 324 606 307 610 283 604 260 617 249 610 238 626 221 627 204 635 193 627 174 643 145 638 122 656Z'
  const roadLines = ROADS.map(([a,b]) => `<line class="road" x1="${BY_NAME[a].x}" y1="${BY_NAME[a].y}" x2="${BY_NAME[b].x}" y2="${BY_NAME[b].y}"/>`).join('')
  const locations = REGIONS.map(({name,x,y,terrain}) => {
    const id = control(game,name) || 'none'
    const space = game.land[name]
    const forces = spaceForces(space)
    const holdings = space.sites.filter(Boolean).length
    const title = [name,terrain,controlName(control(game,name)),...forces.map(forceLabel),holdings ? `${holdings} ${holdings === 1 ? 'Stronghold' : 'Strongholds'}` : 'No Strongholds'].join(', ')
    const counts = [...forces.map(({id,troops,raiders}) => factionAbbr[id]+(troops+raiders)),...(holdings ? ['H'+holdings] : [])]
    const selectable = !targets || targets.has(name)
    const action = targets ? 'target-pick' : 'region'
    return `<g class="region-node ${id}${selectable ? '' : ' unavailable'}" ${selectable ? `role="button" tabindex="0" aria-label="${clean(title)}" data-act="${action}" data-value="${name}"` : ''} transform="translate(${x},${y})">
      <title>${clean(title)}</title><rect x="-27" y="-22" width="54" height="41" fill="transparent"/>
      ${terrain === 'City' ? '<rect class="location" x="-5.5" y="-5.5" width="11" height="11" rx="2"/>' : '<circle class="location" r="5.25"/>'}
      <circle r="1.9" class="loc-center"/><text y="-10" text-anchor="middle">${name}</text>
      ${counts.length ? `<text y="16" class="map-count" text-anchor="middle">${counts.join(' ')}</text>` : ''}
    </g>`
  }).join('')
  return `<div class="map"><svg viewBox="0 0 690 700" aria-label="Schematic map of Britannia">
    <defs><pattern id="${mapId}-grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#9daab5" stroke-opacity=".075"/></pattern><pattern id="${mapId}-landwash" width="38" height="31" patternUnits="userSpaceOnUse"><path d="M1 12l7-4 9 8 10-4 8 6M2 25l9-3 10 4" fill="none" stroke="#d0cc9b" stroke-opacity=".34"/></pattern></defs>
    <rect width="690" height="700" fill="url(#${mapId}-grid)"/><path class="coastline" d="${land}"/><path d="${land}" fill="url(#${mapId}-landwash)"/>
    <path class="coastline" d="M138 296l15-20 22 4-7 16-21 13zM487 617l14-8 15 4-11 8zM159 353l9-5 10 8-6 5z"/>
    <text x="62" y="281" class="map-seas">HIBERNICUS</text><text x="463" y="120" class="map-seas">SEPTENTRIONALIS</text>
    <text x="626" y="300" class="map-seas" transform="rotate(90 626 300)">GERMANICUS</text><text x="447" y="655" class="map-seas">BRITANNICUS</text>
    <path d="M56 88v44m-22-22h44m-22-22-5 16 5-4 5 4z" fill="#dab78a" stroke="#dab78a" stroke-opacity=".85"/><text x="53" y="81" class="map-note">N</text>
    ${roadLines}${locations}
  </svg></div>`
}
function regionTable(game) {
  return `<div class="table-wrap"><table><thead><tr><th>Space</th><th>Terrain</th><th>Control</th><th>Pop.</th><th>Pros.</th><th>Forces and Strongholds</th></tr></thead><tbody>${
    [...REGIONS].sort((a,b) => a.name.localeCompare(b.name)).map(({name,terrain}) => {
      const id = control(game,name)
      const space = game.land[name]
      const forces = spaceForces(space).map(force => `<span>${dot(force.id)} ${clean(forceLabel(force))}</span>`)
      const sites = space.sites.filter(Boolean).map(site => `<span>${dot(toOwner(site.piece,site.employer))} ${PIECES[site.piece]}${site.employer ? ` · ${NAMES[site.employer]} Foederati` : ''}</span>`)
      return `<tr><td>${button(name,'region','link',name)}</td><td>${terrain}</td><td>${dot(id)} ${controlName(id)}</td><td>${space.pop}</td><td>${totalProsperity(space)}</td><td class="space-forces">${[...forces,...sites].join('') || '—'}</td></tr>`
    }).join('')
  }</tbody></table></div>`
}
function setup(game) {
  const advancing = Boolean(game.current)
  const input = session.work?.kind === 'cards' ? session.work.input : {}
  const automatic = game.deckMode === 'digital' || Boolean(game.postponed)
  const fields = advancing
    ? automatic ? '' : number('Newly revealed card','next',input.next,1,83,game.revealed.length < scenarioDeckSize(game) ? 'required' : '')
    : automatic ? '' : `<div class="fields">${number('Current card','current',input.current,1,72,'placeholder="e.g. 50" required')}${number('Revealed next card','next',input.next,1,72,'placeholder="e.g. 58" required')}</div>`
  const nextText = game.postponed ? `Resume postponed Event #${game.next}. The revealed next card is preserved.` :
    automatic ? 'The app will advance the deck and reveal the next card.' : `Move #${game.next} to the played pile, then enter the new card showing on the deck.`
  const instructions = scenarioInfo(game).epochPiles.map((_,index) => allowedEpochs(game,index).join(', ')).join(' / ')
  const removed = game.variant ? [...scenarioInfo(game).optional.removed,...Object.keys(scenarioInfo(game).optional.active)] : []
  const pivot = FACTIONS.filter(faction => game.pivotal?.[faction] === 'ready').map(faction => '#'+PIVOTAL[faction])
  return `<section class="panel"><div class="panel-body stack">
    ${topLabel(advancing ? 'Advance the deck' : automatic ? 'Start the campaign' : 'Enter the opening cards')}
    <p class="muted">${advancing ? nextText : automatic ? 'The app shuffles the scenario deck and reveals the first two Events.' : 'Set up the physical board, then enter the two face-up card numbers from your deck.'}</p>
    <form id="cards-form" class="stack">${fields}
      <button type="submit" class="btn primary">${advancing ? 'Advance card' : 'Start game'} ${icon('arrow')}</button>
    </form>
    ${!advancing ? `<details class="details"><summary>Scenario setup</summary>
      <p class="info">Deal ${scenarioInfo(game).epochs} piles of 12 Events. Insert one permitted Epoch in the final four Events of each pile. Eligible Epoch numbers by pile are ${instructions}.</p>
      ${removed.length ? '<p class="info">Set aside ordinary Events '+removed.map(id => '#'+id).join(', ')+'.</p>' : ''}
      ${pivot.length ? '<p class="info">Give each available Pivotal Event to its faction ('+pivot.join(', ')+').</p>' : ''}
      </details><div class="row">${button('Choose scenario or faction','reset','compact ghost')}${button('Try a sample opening','demo','compact ghost')}${button('Try a sample Battle','battle-demo','compact ghost')}</div>` : ''}
  </div></section>`
}
const eventTitle = id => id ? (card(id)?.title ?? EPOCHS[id] ?? '') : '—'
function cardTile(game,id,label,order) {
  if (!id) return `<div class="card-slot"><small>${label}</small><strong>Deck exhausted</strong></div>`
  const item = card(id)
  const shortName = { d:'D', c:'C', x:'Sa', s:'Sc' }
  const symbols = { h:' · Shield', b:' · Shield and Sword', s:' · Sword', r:' · Raven', '-':'' }
  return `<div class="card-slot"><small>${label} · #${id}</small><button type="button" class="card-title" data-act="card-detail" data-value="${id}" aria-label="Inspect ${clean(eventTitle(id))}">${clean(eventTitle(id))}</button><div class="order">${(order ?? item?.order ?? []).map(f => {
    const used = label === 'Current' && (game.acts.some(a => a.faction === f) || (!game.eligibility.includes(f) && !game.complete))
    return `<span class="${f} ${used ? 'used' : ''}" title="${NAMES[f]+` ${symbols[item.symbols[f]]}`}">${shortName[f]}${['h','b'].includes(item.symbols[f]) ? '•' : ''}</span>`
  }).join('')}</div></div>`
}
function cardDetails(id) {
  const game = state()
  ensure([game.current,game.next].includes(id),'This card is hidden.')
  const faction = card(id)?.order[0] ?? game.human
  const heading = '#'+id+' · '+eventTitle(id)
  if (EPOCHS[id]) {
    const effect = epochChoices({...game,current:id},'Epoch Event')
    modal(clean(heading),`<p>${clean(effect?.help ?? 'Resolve this Event during the Epoch Round.')}</p>`,button('Close','close','ghost'),'card-details')
    return
  }
  const sides = eventSides(id)
  const effects = sides.map(side => {
    const info = grantRule(game,id,faction,side) ?? eventChoices(game,id,faction,side)
    const name = side === 'single' ? 'Effect' : side === 'shaded' ? 'Shaded' : 'Unshaded'
    return `<section class="callout${side === 'shaded' ? ' warm' : ''}"><h3>${name}</h3><p>${clean(info?.help || 'The Event dialog shows the available choices for the executing faction.')}</p></section>`
  }).join('')
  modal(clean(heading),effects,button('Close','close','ghost'),'card-details')
}
function turns(game) {
  if (session.work?.input.battle) {
    const job = session.work.input.battle.job
    return panel('Action in progress',`<p class="muted">${clean(job.label)}</p><div class="row">${button('Resume action','resume-battle','primary')}${button('Discard draft','discard','ghost')}</div>`)
  }
  if (game.result) return finishPanel(game)
  if (game.entropy) return panel('Entropy',`<p class="muted">Both factions are tied. Choose which faction you continue to play.</p><div class="row">${game.entropy.map(faction => button('Keep '+NAMES[faction],'entropy','primary',faction)).join('')}</div>`)
  if (!game.current) return setup(game)
  if (game.epochPhase) return epochPanel(game)
  if (game.complete) return `<div class="stack">${deckPanel(game)}${setup(game)}</div>`
  const faction = activeFaction(game)
  const options = actionOptions(game)
  const one = game.acts.some(a => a.option !== 'pass') ? '2nd eligible' : '1st eligible'
  const human = isHumanFaction(game,faction)
  const description = human ? 'Choose your action, then review and apply the result.' :
    'The app selects and resolves this faction’s action. You’ll make any choices for your own faction.'
  const past = game.acts.length ? `<ul class="turn-log">${game.acts.map(a => `<li><span>${dot(a.faction)} ${NAMES[a.faction]}</span><span>${clean(a.description)}</span></li>`).join('')}</ul>` : ''
  const omens = canUseOmens(game) && isHumanFaction(game,game.omens.holder)
  return `<div class="stack">${deckPanel(game)}
    <section class="panel"><div class="panel-body stack">
      ${topLabel(human ? (humanFactions(game).length > 1 ? 'Your '+NAMES[faction]+' turn' : 'Your turn') : NAMES[faction]+' turn',badge(one,human?'cool':''))}
      <p class="muted">${description}</p>
      ${omens ? `<div class="callout warm row"><span>Omens is available to ${NAMES[game.omens.holder]}.</span>${button('Resolve Omens','omens','compact')}</div>` : ''}
      ${pivotalControls(game)}
      ${human ? `<div class="action-grid">${options.map(option => button(ACTIONS[option],'choose',option === 'pass' ? 'ghost' : '',option)).join('')}</div>`
        : button('Preview '+NAMES[faction]+' action '+icon('arrow'),'bot','primary')}
      ${past}
    </div></section>
  </div>`
}
function pivotalControls(game) {
  const eligible = pivotalOptions(game)
  const player = eligible.filter(faction => isHumanFaction(game,faction))
  const bot = eligible.filter(faction => !isHumanFaction(game,faction))
  const declaration = botPivotalChoice(game,bot)
  if (!eligible.length) return ''
  const alert = declaration ? `<div class="callout warm row"><span>${NAMES[declaration]} wants to play ${clean(eventTitle(PIVOTAL[declaration]))}.</span>${button('Declare Pivotal','pivotal','compact',declaration)}</div>` : ''
  return alert+(player.length ? `<details ${isPivotalCard(game.current) ? 'open' : ''}><summary>Pivotal Events</summary><div class="row">
    ${player.map(faction => button(clean(eventTitle(PIVOTAL[faction])),'pivotal','compact',faction)).join('')}
  </div></details>` : '')
}
function deckPanel(game) {
  return `<section class="panel"><div class="panel-body stack">
    <div class="section-top"><h3>Revealed cards</h3><small class="muted">Epoch ${Math.min(scenarioInfo(game).epochs,game.epoch+1)} · Event ${game.eventIndex}</small></div>
    <div class="deck">${cardTile(game,game.current,'Current',inCardOrder(game))}${cardTile(game,game.next,'Next')}</div>
  </div></section>`
}
function epochPanel(game) {
  return `<section class="panel"><div class="panel-body stack">
    ${topLabel('Epoch '+game.epoch,badge('#'+game.current))}
    <p>${clean(eventTitle(game.current))}</p>
    <p class="muted">Event #${game.next} waits until after the Epoch if play continues.</p>
    <ul class="phase-list">${EPOCH_PHASES.map(phase => `<li ${phase === game.epochPhase ? 'aria-current="step"' : ''}>${phase}</li>`).join('')}</ul>
    <div class="row">${button('Resolve '+game.epochPhase+' '+icon('arrow'),'epoch','primary')}
    ${['Annona','Victory'].includes(game.epochPhase) ? button('Save Epoch checkpoint','checkpoint','compact ghost') : ''}</div>
  </div></section>`
}
function victoryTable(game) {
  const values = scores(game)
  const {x,s,c,d} = values
  const fragmented = game.imperium === 'f'
  const goals = {
    d:`${fragmented ? 'Control' : 'Prosperity'} + Prestige ${d.score} / ${d.target+1}${!fragmented && game.imperium[1] !== 'm' ? ' · Military Dominance' : ''}`,
    c:`Controlled Population ${c.score} / ${c.target+1}${!fragmented && game.imperium[1] !== 'c' ? ' · Civilian Dominance' : ''}`,
    x:`Control ${x.score} / ${x.target+1}${fragmented ? '' : `<br>or Renown ${game.tracks.x} / ${x.renownTarget+1} and Settlements ${x.settlements} / ${x.settlementTarget}`}`,
    s:`Renown ${s.score} / ${s.target+1} and Settlements ${s.victorySettlements} / ${s.settlementTarget}${game.tracks.dalRiada ? ' · includes Dal Riada' : ''}`,
  }
  const rank = game.result ? [...game.result.rank,...FACTIONS.filter(id => !game.result.rank.includes(id))] : FACTIONS
  return `<div class="table-wrap"><table><thead><tr><th>Faction</th><th>Current / needed</th><th>Margin</th><th>Threshold met</th></tr></thead><tbody>${
    rank.map(id => `<tr><td>${dot(id)} ${NAMES[id]}</td><td>${goals[id]}</td><td>${pretty(values[id].margin)}</td><td>${values[id].eligible ? 'Yes' : '—'}</td></tr>`).join('')
  }</tbody></table></div>`
}
function victoryTitle(game) {
  return game.result.won ? humanFactions(game).map(faction => NAMES[faction]).join(' and ')+' victory' : NAMES[game.result.winner]+' wins'
}
function victoryDetails(game) {
  const humans = humanFactions(game)
  const result = game.result
  let reason = result.reason === 'threshold' ? 'The Epoch victory check ends the campaign.' : 'The last Epoch is scored by victory margin.'
  if (result.reason === 'threshold' && !result.won) reason += ' A qualifying Non-player takes priority over the solo seat.'
  if (result.reason === 'final') {
    if (humans.length > 1) reason += ` The solo seat uses its lower margin (${pretty(Math.min(...humans.map(id => scores(game)[id].margin)))}).`
    reason += ' Ties favor Non-players, then Civitates, Dux, Saxons and Scotti.'
  }
  return `<p class="muted">${reason}</p>${victoryTable(game)}`
}
function finishPanel(game) {
  return panel(victoryTitle(game),victoryDetails(game)+button('New game','reset','ghost'))
}
function victoryProgress(game) {
  if (game.result) return ''
  const humans = humanFactions(game)
  const seat = humans.length > 1 ? ' Both factions must qualify for an early win. Before Fragmentation, Both Britons use their adjusted margins. The lower of the two margins counts at final scoring.' : ''
  const difficult = game.difficulty === 'Difficult' ? ' On Difficult, the solo seat can win at final scoring.' : ''
  return `<details class="callout victory-progress"><summary>Victory outlook</summary><p class="small muted">Current position. Annona and Imperium resolve before Victory.${seat}${difficult}</p>${victoryTable(game)}</details>`
}
function imperiumPanel(game) {
  const totals = boardTotals(game)
  return `<section class="panel"><div class="panel-body stack">
    <div><h3>Imperium</h3><p class="muted small">${STATUS[game.imperium]}</p></div>
    <div class="turn-log"><div class="small muted">${game.roads ? 'Roads maintained' : 'Roads not maintained'} · ${totals.total} Prosperity · ${totals.plunder} Plunder</div>
      <div class="small muted">${Object.entries(game.seas).filter(([,v]) => v).map(([key]) => SEAS[key].replace('Oceanus ','')).join(', ') || 'No seas'} patrolled</div></div>
    ${activeRuleNotes(game)}
  </div></section>`
}
function poolPanel(game) {
  const free = availability(game)
  return panel('Available forces',`<div class="table-wrap"><table><tbody>${Object.entries(free).map(([key,value]) => `<tr><td>${PIECES[key]}</td><td>${value}</td></tr>`).join('')}
  ${Object.entries(POOLS).map(([key,label]) => `<tr><td>${label}</td><td>${game.pools[key]}</td></tr>`).join('')}
  <tr><td>Off-board gold</td><td>${goldAvailable(game)}</td></tr></tbody></table></div>${button('Correct tabletop state','edit-tracks','ghost')}`)
}
function journal(game) {
  return panel('Campaign journal',game.log.length
    ? `<ul class="journal">${[...game.log].reverse().map(e => `<li><header><strong>${clean(e.title)}</strong><small class="muted">${e.card ? '#'+e.card : ''}</small></header>
        ${e.detail ? `<p class="small">${clean(e.detail)}</p>` : ''}${e.dice.length ? diceList(e.dice,true) : ''}</li>`).join('')}</ul>`
    : '<p class="muted">Card reveals, actions and Epoch results will appear here.</p>')
}
const commandNotes = {
  Train:'§3.2.1 and errata p.1. Training Troops costs 3 Resources per space. Restoration is separate. An empty Train can accompany a legal Feat.',
  March:'§§3.2.2, 3.3.2, 3.4.3 and 3.5.3. A unit moves only once per March, even when the route uses Roads or a Sea. Britons pay by origin, Barbarians by destination.',
  Intercept:'§3.2.3. Dux can move into Friendly Control to fight Raiders. A Troop can move only once in the Command. Fighting in place needs no move payment.',
  Muster:'§3.3.1. Use Control at the start of the Command to determine recruitment. Count Raiders when checking whether you outnumber enemies for a Stronghold.',
  Trade:'§3.3.3. Count a Briton Resource per Town in the selected spaces. Restoration has a separate cost and requires Briton Control.',
  Battle:'§3.6. A Battle Command needs a Troop of the acting faction. Strikes in the same step are simultaneous. Units lost in an earlier step cannot Strike later.',
  Raid:'§§3.4.1 and 3.5.1. Only newly landed Raiders participate in the Raid Battle. A coastal crossing based on a Settlement needs its matching Warband.',
  Return:'§§3.4.2 and 3.5.2. Convert the selected faction’s carried Plunder to Renown, then return its Raiders to Available.',
}
const epochNotes = {
  Annona:'§§1.8.4 and 6.1. Dux pays first. Enter the total Wealth to use for the selected Civitates payments or leave it blank to use blue first. Each group of the same color and nationality in a space must be covered in full.',
  Imperium:'§6.2. Hoarding precedes the Imperium and Dominance checks. Fragmentation can trigger Entropy for Both Britons.',
  Victory:'§§6.3 and 7.0. Check victory after Annona and Imperium. A qualifying Non-player ends the campaign. If no one wins at the last Epoch, apply any scenario final Recovery before comparing margins.',
  Revenue:'§6.5. Collect Prestige, Resources and Renown for the position after the Epoch Event. Roman taxation only draws from blue Resources.',
  'Recovery & Reset':'§6.7. Trim excess Prosperity before restoring it. Clear Momentum and reset Eligibility before returning to the postponed Event.',
}
const eventNotes = {
  '7/unshaded':'Playbook p.43. Cavalry can withdraw after Charge into a Fort or Town. An allied owner still decides admission.',
  '10/unshaded':'§6.1. Skip this Annona phase while its Momentum is active.',
  '16/shaded':'Playbook p.45. Militia cannot cooperate with Dux pieces. When both are present, the lead faction or a defending Dux Fort determines who sits out.',
  '33/shaded':'Playbook p.48. Civitates and Scotti cannot target each other with Battle Commands. Scotti Raid Battles remain legal. The app applies ordinary Briton cooperation if Dux is the target.',
  '46/shaded':'Playbook p.52. Cavalry inflict and absorb half losses in Fens Field Battles.',
  '52/unshaded':'Playbook p.53. The free Train or Muster places Troops in one Region. Battle there is optional and requires an eligible Troop of its executing faction.',
  '56/shaded':'Playbook p.54. Native Scotti Warbands can Strike at Trap in Hills during a Scotti Battle Command.',
  '64/unshaded':'Playbook p.56. Devastation halves native Warbands away from their own Settlement. Foederati are exempt.',
  '70/shaded':'Playbook p.58 and errata. Take the extra Plunder from off-board stock and apply Wealth loss on landing, including against Civitates Control at Fragmentation.',
  '73/unshaded':'Playbook p.59. The Scotti lose homeland access to Oceanus Septentrionalis. A coastal Settlement and Warband can still enable a crossing.',
}
function ruleNotes(lines,summary = 'Rule notes') {
  return lines.length ? `<details class="details small"><summary>${clean(summary)}</summary><ul class="guide-list">${lines.map(line => `<li>${clean(line)}</li>`).join('')}</ul></details>` : ''
}
function activeRuleNotes(game) {
  const lines = Object.entries(game.markers).map(([id,marker]) => {
    const note = eventNotes[id+'/'+marker.side]
    return `#${id} ${eventTitle(Number(id))} · ${marker.side} ${marker.type}${note ? ' · '+note : ''}`
  })
  return ruleNotes(lines,'Active effects')
}
function guideTab(game) {
  return panel('Using the companion',`
    <p>Choose a scenario and solo faction. Enter revealed physical cards or let the digital deck reveal them as you play.</p>
    <ol class="guide-list"><li>Choose the Command or Event and enter its targets. The preview shows changed spaces, dice, and tracks before Apply.</li><li>During Battles, choose tactics and casualties as prompted. Matching units can Withdraw together. You can close or reload an unfinished action and resume it from Play.</li><li>Non-players select their own Events and handle any Commands the Events grant them. When an Event grants your faction a choice, the app opens the relevant controls.</li></ol>
    <h3>Coverage in this build</h3>
    <div class="table-wrap"><table><tbody>
      <tr><td>Campaign</td><td>Four scenarios, six solo seats, four difficulties, physical or digital deck, Pivotal interruptions, Epochs and scoring.</td></tr>
      <tr><td>Operations</td><td>Command and Feat calculators, guided tactical choices, deterministic dice and per-space previews.</td></tr>
      <tr><td>Events and Non-players</td><td>All 72 Events and four Pivotals have calculators. The app handles bot Event conditions and explains its choices in the preview and journal.</td></tr>
      <tr><td>Epoch</td><td>Payment choices, Event and Upkeep calculators, and automatic Control and victory arithmetic.</td></tr>
    </tbody></table></div>
    ${ruleNotes(Object.values(commandNotes),'Commands')}
    ${ruleNotes(Object.values(epochNotes),'Epoch phases')}
    ${ruleNotes([
      '§§2.3.3 and 2.3.8. The app closes the Pivotal window at the first action, including Pass. The wording leaves the Pass case open.',
      '§§3.6.5 and 4.2.4. The app adds Retaliate’s 3 Prestige to the ordinary gains.',
      eventNotes['33/shaded'],
      '§8.8.9. Non-player Dux needs Friendly Control to force a Battle against a Surprise Deep Raid. A human Dux follows §4.4.2 or §4.5.2.',
      'Errata p.2. Saxons cannot Evade in a Ravage Battle. A captured City loses all its Prosperity, even when the attackers cannot carry it all.',
    ],'Errata and rulings used by the app')}
    ${activeRuleNotes(game)}
    <div class="row"><a class="btn compact" href="${rulesUrl}" target="_blank" rel="noopener">Living Rules</a><a class="btn compact" href="${playbookUrl}" target="_blank" rel="noopener">Final Playbook</a><a class="btn compact" href="${errataUrl}" target="_blank" rel="noopener">GMT Errata</a><a class="btn compact" href="${aidsUrl}" target="_blank" rel="noopener">Non-player Event Instructions</a></div>`)
}
function render() {
  const game = state()
  const views = [['play','Play','play'],['board','Board','map'],['journal','Journal','journal'],['guide','Guide','info']]
  const content = tab === 'play' ? `<div class="work-grid"><div class="stack">${turns(game)}${victoryProgress(game)}${imperiumPanel(game)}</div>${board(game)}</div>`
    : tab === 'board' ? `<div class="work-grid">${poolPanel(game)}${board(game,true)}</div>`
    : tab === 'journal' ? journal(game) : guideTab(game)
  app.innerHTML = `${header()}<main class="shell"><section class="hero"><div class="hero-content"><div><h1>Pendragon</h1><p class="subtitle">The Fall of Roman Britain</p></div>
  <div class="hero-context">${clean(game.scenario)}<small>${humanFactions(game).map(faction => NAMES[faction]).join(' + ')} · ${clean(game.difficulty)}</small></div></div></section>
  <nav class="nav" aria-label="Companion views">${views.map(([key,label,i]) => `<button type="button" data-act="tab" data-value="${key}" ${key === tab ? 'aria-current="page"' : ''}>${icon(i)}${label}</button>`).join('')}</nav>
  <div id="storage-banner"></div>${trackCards(game)}${content}
  <footer class="footer"><span>Unofficial tabletop companion · v${VERSION}</span><span>${EDITION}</span></footer></main>`
  showStorageProblem()
}

function modal(title,body,footer = '',view = null,data = null) {
  dialogView = view
  dialogData = data
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${title}</h2>${button(icon('close'),'close','square ghost','', 'aria-label="Close"')}</div>
  <div class="dialog-content" id="dialog-content">${body}<p class="error small" id="dialog-error" role="alert" hidden></p></div>${footer ? `<div class="dialog-foot">${footer}</div>` : ''}`
  if (!dialog.open) dialog.showModal()
  else dialog.querySelector('.dialog-head button')?.focus({preventScroll:true})
}
function dismiss() {
  if (dialog.open) dialog.close()
  dialogView = null
  dialogData = null
  pending = null
  if (session.work?.input.battle) render()
}
function refreshWork(kind,defaults = {}) {
  if (session.work?.kind !== kind) session.work = { kind, input:{...defaults}, draft:null }
  return session.work
}
function changeWork(kind,value,data) {
  const work = refreshWork(kind)
  work.input[value] = data
  save()
}
function draftFor(kind,defaults = {}) {
  const work = refreshWork(kind,defaults)
  if (!work.draft) work.draft = clone(state())
  return work.draft
}
const workBoard = () => session.work?.draft || state()

function diceList(dice,fold = false) {
  if (!dice.length) return ''
  const list = `<ul class="guide-list small">${dice.map(d => `<li>${clean(d.label)} · D${d.sides} = ${d.value}</li>`).join('')}</ul>`
  return fold ? `<details><summary>${dice.length} recorded die ${dice.length === 1 ? 'roll' : 'rolls'}</summary>${list}</details>` : list
}
function diffList(before,after,sequenceExplained = false) {
  const {changes,tracks} = boardDiff(before,after)
  const markerText = marker => marker ? `${marker.side === 'shaded' ? 'Shaded' : 'Unshaded'} ${marker.type}${marker.faction ? ' · '+NAMES[marker.faction] : ''}` : 'Off board'
  for (const id of new Set([...Object.keys(before.markers),...Object.keys(after.markers)])) {
    const old = before.markers[id]
    const marker = after.markers[id]
    if (JSON.stringify(old) !== JSON.stringify(marker)) tracks.push([eventTitle(Number(id)),markerText(old),markerText(marker)])
  }
  if ((before.omens?.holder ?? null) !== (after.omens?.holder ?? null)) tracks.push(['Omens',NAMES[before.omens?.holder] ?? 'Off board',NAMES[after.omens?.holder] ?? 'Off board'])
  const group = (label,rows) => `<div><strong>${clean(label)}</strong><ul>${rows.map(([key,a,b]) => `<li>${clean(key)} · ${clean(a)} → ${clean(b)}</li>`).join('')}</ul></div>`
  return changes.length || tracks.length
    ? `<div class="diff">${changes.map(({name,rows}) => group(name,rows)).join('')}${tracks.length ? group('Tracks',tracks) : ''}</div>`
    : sequenceExplained ? '' : '<p class="muted">This step changes the sequence only.</p>'
}
function botDecisionMarkup(decision,dice = []) {
  if (!decision?.rule || !decision?.detail) return ''
  const rolled = dice.length ? ' The recorded rolls below include any random ties.' : ''
  return `<div class="callout small"><strong>Why this action</strong><p>${clean(decision.rule)} · ${clean(decision.detail)}${rolled}</p></div>`
}
function showPreview(plan,back) {
  const endsGame = plan.after.result && !state().result
  const victory = endsGame ? `<section class="callout warm"><h3>${clean(victoryTitle(plan.after))}</h3>${victoryDetails(plan.after)}</section>`
    : plan.label === 'Victory' ? `<p class="muted">The campaign continues to ${clean(plan.after.epochPhase)}.</p>${victoryTable(plan.after)}` : ''
  modal(clean(plan.label),`${victory || `<p class="muted">${clean(plan.description)}</p>`}${botDecisionMarkup(plan.decision,plan.dice)}${diffList(state(),plan.after,Boolean(victory))}${diceList(plan.dice || [],true)}`,
    button('Back','preview-back','ghost',back)+button('Apply result','commit','primary'),'preview')
  pending = { base:state(), after:plan.after, label:plan.label }
}
function commit(after,label) {
  push(session,label,after)
  proposal = null
  editorReturn = null
  dismiss()
  save()
  render()
  message(label+' recorded.')
}
function showRegion(name) {
  const region = BY_NAME[name]
  const data = state().land[name]
  const owner = control(state(),name)
  const sites = region.sites.map((site,i) => {
    const piece = data.sites[i]
    return `<tr><td>${site.name}</td><td>${piece ? PIECES[piece.piece] + (piece.employer ? ' · '+NAMES[piece.employer]+' Foederati' : '') : 'Vacant'}</td></tr>`
  }).join('')
  const pieces = GROUPS.filter(([key]) => on(data,key)).map(([key]) => `${on(data,key)} ${groupLabel(key)}${loaded(data,key) ? ' ('+loaded(data,key)+' with Plunder)' : ''}`)
  modal(name,`<p>${region.terrain} · ${dot(owner)} ${controlName(owner)} ${owner ? 'Control' : ''}</p>
    <p class="muted">Population ${data.pop} · Prosperity ${totalProsperity(data)}${region.terrain === 'City' ? '' : ' ('+data.pros[0]+' bottom, '+data.pros[1]+' top)'}</p>
    <div class="table-wrap"><table><tbody>${sites}</tbody></table></div>
    <p><strong>Units</strong> · ${clean(pieces.join(', ') || 'None')}</p>
    <p class="muted small">Adjacent · ${region.adj.join(', ')}${region.seas.length ? '<br>Coastal · '+region.seas.map(key => SEAS[key]).join(', ') : ''}</p>`,
    button('Correct space','edit-region','',name),'region',name)
}
function draftControls(draft,currentState) {
  const changes = boardDiff(currentState,draft)
  return `<div class="row">
    <label class="field" style="flex:1;min-width:140px">Edit a space<select id="select-space" aria-label="Space to edit">${selectOptions([['','Choose space'],...[...REGIONS].sort((a,b) => a.name.localeCompare(b.name)).map(r => [r.name,r.name])],'')}</select></label>
    ${button('Edit tracks and markers','draft-tracks','compact ghost')}
    </div>${changes.changes.length || changes.tracks.length ? `<details><summary>Pending board changes</summary>${diffList(currentState,draft)}</details>` : ''}`
}
function openEditor(which,name = '',returnTo = dialogView) {
  const known = ['action','epoch','correction'].includes(returnTo) ? returnTo : 'correction'
  editorReturn = known
  const kind = known === 'correction' ? 'edit' : known
  const board = draftFor(kind, { name })
  const work = session.work
  work.input.editor = which === 'tracks' ? 'tracks' : name
  if (which === 'tracks') {
    const form = `<form id="edit-tracks-form" class="stack">
    <fieldset><legend>Economy and markers</legend><div class="fields">
    ${Object.entries(TRACKS).map(([key,label]) => number(label,key,board.tracks[key],0,({ refugees:4,dalRiada:6,niall:30 })[key] ?? 80,'required')).join('')}
    </div></fieldset><fieldset><legend>Pools</legend><div class="fields">
    ${Object.entries(POOLS).map(([key,label]) => number(label,key,board.pools[key],0,key === 'notYet' ? 15 : 20,'required')).join('')}
    </div></fieldset><fieldset><legend>Imperium, Roads and seas</legend><div class="fields">
    ${field('Imperium',`<select name="imperium">${selectOptions(Object.entries(STATUS),board.imperium)}</select>`)}
    ${field('Roads',`<select name="roads">${selectOptions([['1','Maintained'],['0','Not maintained']],board.roads ? '1':'0')}</select>`)}
    ${Object.entries(SEAS).map(([key,label]) => field(label,`<select name="${key}">${selectOptions([['1','Patrolled'],['0','No patrol']],board.seas[key] ? '1':'0')}</select>`)).join('')}
    </div></fieldset>
    <fieldset><legend>Active Event markers</legend>
    ${Object.entries(board.markers).map(([id,marker]) => `<div class="row"><span>#${id} ${clean(eventTitle(Number(id)))} · ${marker.type} · ${marker.side}</span>${button('Remove','remove-marker','compact ghost',id)}</div>`).join('')}
    <div class="fields">${number('Event #','markerCard',work.input.markerCard || '',1,83)}
    ${field('Marker',`<select name="markerType">${selectOptions([['capability','Capability'],['momentum','Momentum']],work.input.markerType)}</select>`)}
    ${field('Side',`<select name="markerSide">${selectOptions([['unshaded','Unshaded'],['shaded','Shaded']],work.input.markerSide)}</select>`)}
    ${field('Omens holder',`<select name="omens">${selectOptions([['','None'],...FACTIONS.map(f => [f,NAMES[f]])],board.omens?.holder || '')}</select>`)}
    </div></fieldset><button class="btn primary" type="submit">Keep changes</button></form>`
    modal('Edit tracks and markers',form,button('Back','editor-back','ghost'),'editor','tracks')
  } else {
    ensure(BY_NAME[name], 'Choose a land space.')
    work.input.name = name
    const region = BY_NAME[name]
    const space = board.land[name]
    const form = `<form id="edit-region-form" class="stack" data-region="${name}">
      <div class="fields">${number('Population','pop',space.pop,0,printedPopulation(board,name) + (region.terrain === 'City' ? 0 : 1),'required')}
      ${number(region.terrain === 'City' ? 'Prosperity' : 'Prosperity · bottom','lower',space.pros[0],0,region.terrain === 'City' ? region.printed*2 : region.printed+1,'required')}
      ${region.terrain === 'City' ? '' : number('Prosperity · top','upper',space.pros[1],0,region.printed+1,'required')}</div>
      <fieldset><legend>Stronghold sites</legend><div class="fields">${region.sites.map((site,i) => {
        const piece = space.sites[i]
        const options = [['','Vacant'],['fort','Fort'],['xs','Saxon Settlement'],['ss','Scotti Settlement'],
          ['xs:d','Saxon Settlement · Dux'],['xs:c','Saxon Settlement · Civitates'],
          ['ss:d','Scotti Settlement · Dux'],['ss:c','Scotti Settlement · Civitates']]
        if (site.type === 'T') options.push(['town','Town'])
        if (region.terrain !== 'City') options.push(['hill','Hillfort'])
        return field(site.name,`<select name="site${i}">${selectOptions(options,piece ? piece.piece+(piece.employer ? ':'+piece.employer : '') : '')}</select>`)
      }).join('')}</div></fieldset>
      <fieldset><legend>Units and Plunder</legend><div class="UnitRow UnitHead"><span>Unit</span><span>Count</span><span>Loaded</span></div>
      ${GROUPS.map(([key]) => `<div class="UnitRow"><span class="small">${groupLabel(key)}</span>
        <input type="number" aria-label="${groupLabel(key)} count" inputmode="numeric" name="${key}" min="0" max="30" required value="${on(space,key)}">
        <input type="number" aria-label="${groupLabel(key)} loaded" inputmode="numeric" name="${key}p" min="0" max="30" required value="${loaded(space,key)}"></div>`).join('')}
      </fieldset><button class="btn primary" type="submit">Keep changes</button>
    </form>`
    modal('Edit '+name,form,button('Back','editor-back','ghost'),'editor',name)
  }
  save()
}
function bindEditorDraft(form,strict) {
  const draft = session.work.draft
  const values = new FormData(form)
  const read = key => values.get(key) === '' || values.get(key) === null ? null : Number(values.get(key))
  const valid = (key,min,max) => inRange(read(key),min,max)
  if (form.id === 'edit-region-form') {
    const name = form.dataset.region
    const target = draft.land[name]
    const region = BY_NAME[name]
    const city = region.terrain === 'City'
    for (const [name,min,max] of [['pop',0,printedPopulation(draft,name)+(city ? 0 : 1)],['lower',0,city ? region.printed*2 : region.printed+1],...(!city ? [['upper',0,region.printed+1]] : [])]) {
      if (strict) ensure(valid(name,min,max),'Check the Population and Prosperity fields.')
    }
    if (valid('pop',0,printedPopulation(draft,name)+(city ? 0 : 1))) target.pop = read('pop')
    if (valid('lower',0,city ? region.printed*2 : region.printed+1)) target.pros[0] = read('lower')
    if (!city && valid('upper',0,region.printed+1)) target.pros[1] = read('upper')
    target.sites = region.sites.map((site,i) => {
      const [piece,employer] = values.get('site'+i).split(':')
      return piece ? {piece,employer:employer || null} : null
    })
    for (const [key] of GROUPS) {
      if (strict) ensure(valid(key,0,30) && valid(key+'p',0,read(key)), `Check ${groupLabel(key)}. Loaded pieces cannot exceed the unit count.`)
      if (valid(key,0,30)) target.units[key][0] = read(key)
      if (valid(key+'p',0,30)) target.units[key][1] = read(key+'p')
    }
  } else {
    session.work.input.markerCard = values.get('markerCard')
    session.work.input.markerType = values.get('markerType')
    session.work.input.markerSide = values.get('markerSide')
    const maxima = { refugees:4, dalRiada:6, niall:30, casualties:20, out:20, notYet:15 }
    for (const [collection,keys] of [['tracks',Object.keys(TRACKS)],['pools',Object.keys(POOLS)]]) {
      for (const key of keys) {
        const max = maxima[key] ?? 80
        if (strict) ensure(valid(key,0,max),'Check the track and pool values.')
        if (valid(key,0,max)) draft[collection][key] = read(key)
      }
    }
    draft.roads = values.get('roads') === '1'
    setImperium(draft,values.get('imperium'))
    for (const key of Object.keys(SEAS)) draft.seas[key] = values.get(key) === '1'
    const holder = values.get('omens')
    if (holder) draft.omens = {holder,head:null}
    else if (draft.omens?.holder) draft.omens = null
    const marker = read('markerCard')
    if (strict && marker !== null) {
      ensure(card(marker) || EPOCHS[marker],'Enter an Event or Epoch card number.')
      draft.markers[marker] = { type:values.get('markerType'),side:values.get('markerSide') }
      session.work.input.markerCard = ''
    }
  }
  save()
}
function correction() {
  const draft = draftFor('edit')
  modal('Correct tabletop state',`<p class="muted">Record piece and track corrections together. This leaves the current sequence slot in place.</p>${draftControls(draft,state())}`,
    button('Discard draft','discard','ghost')+button('Preview corrections','correction-preview','primary'),'correction')
}

const commandOptions = (option,feat) => ({limited:option === 'limited' || option === 'limitedFeat',allowFeat:Boolean(feat)})
const featOption = option => option === 'feat' || option === 'limitedFeat'
const defaultFlag = value => value === true || ['on','yes','1','true','auto'].includes(value)
function descriptorField(spec,input,prefix = '') {
  const name = prefix+(spec.name ?? spec.key)
  const value = input[name] ?? spec.defaultValue ?? spec.default
  const required = spec.required ? 'required' : ''
  const label = clean(spec.label)
  if (spec.type === 'number') return number(label,clean(name),value,spec.min ?? 0,spec.max ?? 80,[required,spec.refresh ? 'data-refresh="yes"' : ''].join(' '))
  if (['check','checkbox'].includes(spec.type)) return `<label class="check"><input type="checkbox" name="${clean(name)}" value="yes" ${defaultFlag(value) ? 'checked' : ''}${spec.refresh ? ' data-refresh="yes"' : ''}> ${label}</label>`
  if (spec.type === 'text') return field(label,`<input type="text" name="${clean(name)}" value="${clean(value)}" placeholder="${clean(spec.placeholder)}" ${required}>`)
  const choices = spec.options.map(option => Array.isArray(option) ? option : [option.value,option.label])
  const select = field(label,`<select name="${clean(name)}" ${required}${spec.refresh ? ' data-refresh="yes"' : ''}>${selectOptions(choices,value)}</select>`)
  const fromMap = prefix && ['space','origin','destination'].includes(spec.key) && choices.some(([key]) => Object.hasOwn(BY_NAME,key))
  return fromMap ? `<div class="field">${select}${button('Choose on map','target-map','compact ghost',name,`aria-label="Choose ${label.toLowerCase()} on map"`)}</div>` : select
}
function dynamicFields(descriptor,input) {
  if (!descriptor) return ''
  const fields = descriptor.fields ?? []
  const ordinary = fields.filter(field => !field.advanced)
  const advanced = fields.filter(field => field.advanced)
  return `<p class="muted">${clean(descriptor.help)}</p>
    ${ordinary.length ? '<div class="fields">'+ordinary.map(spec => descriptorField(spec,input)).join('')+'</div>' : ''}
    ${advanced.length ? '<details><summary>Choose spaces and pieces</summary><div class="fields">'+advanced.map(spec => descriptorField(spec,input)).join('')+'</div></details>' : ''}`
}
function commandSpec(game,faction,command,feat,option,input) {
  const options = { ...commandOptions(option,feat), tradeAll:defaultFlag(input.tradeAll) }
  return commandFields(game,faction,command,feat,options) ?? militaryFields(game,faction,command,feat,options,input)
}
function repeatCount(spec,key,input) {
  if (!spec) return 0
  const n = Number(input[key] ?? spec.minRows)
  return Math.max(spec.minRows,Math.min(spec.maxRows,n))
}
function repeatedFields(spec,key,input,title) {
  if (!spec) return ''
  const count = repeatCount(spec,key,input)
  const rows = Array.from({length:count},(_,index) => `<fieldset class="operation-row">
    <legend>${title} ${index+1}</legend><div class="fields">
    ${spec.rows.map(item => descriptorField(item,input,key+index+'-')).join('')}
    </div></fieldset>`).join('')
  return `<div class="stack"><p class="muted">${clean(spec.help)}</p>${rows}<div class="row">
    ${count < spec.maxRows ? button('Add '+title.toLowerCase(),'row-add','compact ghost',key) : ''}
    ${count > spec.minRows ? button('Remove last','row-remove','compact ghost',key) : ''}
    </div></div>`
}
function operationMarkup(spec,input,command,feat) {
  if (!spec) return ''
  return `${spec.controls?.length ? '<div class="fields">'+spec.controls.map(item => descriptorField(item,input)).join('')+'</div>' : ''}
    ${repeatedFields(spec,'rows',input,command === 'March' ? 'Group' : 'Target')}
    ${repeatedFields(spec.featFields,'feats',input,feat || 'Feat')}`
}
function grantMarkup(grant,input,game) {
  const {rule,selection,choices,feats,feat,spec,command,maySkip} = grant
  const commandChoices = maySkip ? [['','Skip the granted action'],...choices] : choices
  const fieldSelect = (label,key,options,current) => descriptorField({key,label,options,type:'select'}, { [key]:current })
  const patrol = rule.patrol?.from.length && rule.patrol?.to.length ? `<div class="fields">
    ${fieldSelect('Move this patrol','fromSea',rule.patrol.from.map(sea => [sea,SEAS[sea]]),input.fromSea || rule.patrol.from[0])}
    ${fieldSelect('Patrol this sea','toSea',rule.patrol.to.map(sea => [sea,SEAS[sea]]),input.toSea || rule.patrol.to[0])}
    </div>` : ''
  return `<p class="muted">${clean(rule.help)}</p>${patrol}<div class="fields">
    ${choices.length ? fieldSelect('Granted action','grant',commandChoices,selection) : ''}
    ${feats.length ? fieldSelect('Feat','grantFeat',[['',rule.optionalFeat ? 'No Feat' : 'Choose Feat'],...feats.map(name => [name,name])],feat) : ''}
    </div>${grant.owner && !isHumanFaction(game,grant.owner)
    ? '<p class="muted">'+clean(NAMES[grant.owner])+' will choose and resolve its '+clean(command)+'.</p>'
    : operationMarkup(spec,input,command,feat)}`
}
function actionSelections(game,faction,input) {
  const options = actionOptions(game)
  const playerEvent = input.guide?.mode === 'player-event' ? input.guide.player : null
  const option = playerEvent ? 'event' : options.includes(input.option) ? input.option : options[0]
  const command = COMMANDS[faction].includes(input.command) ? input.command : COMMANDS[faction][0]
  const feats = FEATS[faction][command] || []
  const feat = featOption(option) && feats.includes(input.feat) ? input.feat : ''
  const sides = eventSides(game.current)
  const side = playerEvent?.side ?? (sides.includes(input.side) ? input.side : (faction === 'x' || faction === 's') && sides.includes('shaded') ? 'shaded' : sides[0])
  const event = option === 'event' ? eventChoices(game,game.current,faction,side,input) : null
  const grant = option === 'event' ? grantOperation(game,game.current,faction,side,input,playerEvent ?? {}) : null
  const spec = option !== 'event' && option !== 'pass' && (!featOption(option) || feat) ? commandSpec(game,faction,command,feat,option,input) : null
  return { option,command,feat,feats,side,sides,event,grant,spec }
}
function targetMap(name) {
  const input = session.work?.input
  const match = /^(rows|feats)\d+-(space|origin|destination)$/.exec(name)
  ensure(input && match,'This map target is no longer available.')
  const game = state()
  const choice = actionSelections(game,activeFaction(game),input)
  const operation = choice.grant?.spec ?? choice.spec
  const rows = match[1] === 'rows' ? operation : operation?.featFields
  const spec = rows?.rows.find(field => field.key === match[2])
  const targets = new Set(spec?.options.map(([key]) => key).filter(key => Object.hasOwn(BY_NAME,key)))
  ensure(targets.size,'No spaces are available for this target.')
  modal(clean(spec.label),renderMap(workBoard(),targets),button('Back to action','action-back','ghost'),'target-map',{name,targets})
}
function actionDialog(choice = null, guidance = null) {
  const game = state()
  const faction = activeFaction(game)
  const options = actionOptions(game)
  ensure(faction && options.length,'No faction can act in this sequence slot.')
  const work = refreshWork('action',{
    option:choice || guidance?.suggested || options[0], command:guidance?.command || (faction === 's' || faction === 'x' ? 'Raid' : faction === 'c' ? 'Trade' : 'Train'),
    feat:'', side:faction === 's' || faction === 'x' ? 'shaded' : 'unshaded',
  })
  if (choice && work.input.option !== choice) {
    const kept = work.input.guide
    work.input = { option:choice,command:work.input.command,feat:work.input.feat, ...(kept ? {guide:kept} : {}) }
    work.draft = null
  }
  if (guidance) {
    work.input.guide = guidance
    if (guidance.mode === 'player-event') Object.assign(work.input,guidance.player.input,{method:'app',side:guidance.player.side})
  }
  if (guidance?.command) work.input.command = guidance.command
  const input = work.input
  const guide = input.guide
  const playerEvent = guide?.mode === 'player-event'
  const {option,command,feat,feats,side,sides,event,grant,spec} = actionSelections(game,faction,input)
  Object.assign(input,{option,command,feat,side})
  const canCalculate = Boolean(event || grant || spec)
  const editing = option !== 'pass' && (!canCalculate || input.method === 'table')
  const optionMarkup = isHumanFaction(game,faction) || playerEvent ? '' : field('Sequence choice',`<select name="option">${selectOptions(options.map(key => [key,ACTIONS[key]]),option)}</select>`)
  let resolution = ''
  if (option === 'event') {
    resolution = `<h3>#${game.current} · ${clean(eventTitle(game.current))}</h3>
      ${sides.length > 1 && !playerEvent ? field('Card side',`<select name="side">${selectOptions(sides.map(side => [side,side === 'unshaded' ? 'Unshaded' : 'Shaded']),input.side)}</select>`) : ''}
      ${playerEvent ? '' : '<details><summary>Event eligibility overrides</summary><div class="fields">'+FACTIONS.map(key => field(NAMES[key],`<select name="eligible${key}">${selectOptions([['','Normal'],['yes','Eligible next'],['no','Ineligible next']],input['eligible'+key])}</select>`)).join('')+'</div></details>'}`
  } else if (option !== 'pass') {
    resolution = `<div class="fields">
      ${field('Command',`<select name="command">${selectOptions(COMMANDS[faction].map(key => [key,key]),command)}</select>`)}
      ${featOption(option) ? field('Feat',`<select name="feat" required>${selectOptions([['','Choose Feat'],...feats.map(key => [key,key])],input.feat)}</select>`) : ''}</div>`
  }
  const help = guide ? `<div class="callout warm"><h3>${clean(guide.title)}</h3><ul class="guide-list">${(guide.instructions ?? guide.player?.instructions ?? []).map(t => `<li>${clean(t)}</li>`).join('')}</ul></div>${botDecisionMarkup(guide.decision,guide.dice)}${diceList(guide.dice || [],true)}` : ''
  const method = canCalculate && !playerEvent ? field('Resolve with',`<select name="method">${selectOptions([['app','App calculator'],['table','Record tabletop outcome']],input.method || 'app')}</select>`) : ''
  const applied = editing ? `<p>${option === 'event' ? 'Resolve the revealed physical Event, then record its changes. Any granted command still follows the printed restrictions.' : 'Use the printed action procedure and stage the resulting changes.'}</p>
    ${option === 'event' ? button('Calculate a granted Battle','event-battle','compact ghost') : ''}
    ${draftControls(workBoard(),game)}
    ${field('Journal note · optional',`<textarea name="note" maxlength="500" placeholder="Command, targets or printed ruling">${clean(input.note)}</textarea>`)}
    <label class="check"><input type="checkbox" name="confirmed" value="yes" ${input.confirmed === 'yes' ? 'checked' : ''} required> I resolved the tabletop changes.</label>`
    : grant ? grantMarkup(grant,input,game)
    : event ? dynamicFields(event,input)
    : spec ? operationMarkup(spec,input,command,feat)
    : option === 'pass' ? '<p>Record the Pass, adjust income, and move to the next eligible faction.</p>' : ''
  const note = option === 'event' ? eventNotes[game.current+'/'+side] : commandNotes[command]
  modal(NAMES[faction]+' · '+ACTIONS[option],`${help}<form id="action-form" class="stack">
    ${optionMarkup}${resolution}${method}${applied}${note ? ruleNotes([note]) : ''}<button type="submit" class="btn primary">Preview result ${icon('arrow')}</button></form>`,
    button('Discard draft','discard','ghost'),'action')
  save()
}
function collectRows(spec,key,input) {
  if (!spec) return []
  const rows = Array.from({length:repeatCount(spec,key,input)},(_,index) => Object.fromEntries(spec.rows.map(item => {
    return [item.key,input[key+index+'-'+item.key] ?? item.default ?? '']
  })))
  return spec.minRows === 0 ? rows.filter(row => row.space || row.origin) : rows
}
function actionPreview() {
  const game = state()
  const faction = activeFaction(game)
  const input = session.work.input
  const {option,command,feat,side,spec,event,grant} = actionSelections(game,faction,input)
  ensure(actionOptions(game).includes(option),'This choice is no longer available.')
  ensure(!featOption(option) || feat,'Select a Feat that the Command can use.')
  const description = option === 'pass' ? 'Pass' : option === 'event' ? eventTitle(game.current)+(side === 'single' ? '' : ' · '+side) :
    command+(feat ? ' + '+feat : '')+(commandOptions(option,feat).limited ? ' (limited)' : '')
  const label = NAMES[faction]+' · '+description
  const calculated = option !== 'pass' && input.method !== 'table' && Boolean(spec || event || grant)
  if (calculated) {
    const selectedSpec = grant?.spec ?? spec
    const entries = {...input}
    delete entries.battle
    const operation = { faction,command,feat,options:commandOptions(option,feat),grant:Boolean(grant),input:clone(entries),
      restriction:input.guide?.player,rows:collectRows(selectedSpec,'rows',input),featRows:collectRows(selectedSpec?.featFields,'feats',input) }
    const overrides = option === 'event' ? eventOverrides(input,faction,game.current) : {}
    const job = {
      kind:'action', label, option, description, side, operation, overrides, id:game.current, faction,
      origin:input.guide?.rng ? {...clone(game),rng:input.guide.rng} : null, dice:input.guide?.dice || [],decision:input.guide?.decision,
    }
    startBattleJob(job)
    return
  }
  ensure(option === 'pass' || input.confirmed === 'yes','Confirm the tabletop outcome before recording.')
  const dice = [...(input.recordedDice || input.guide?.dice || [])]
  const plan = preview(option === 'pass' ? game : workBoard(),label,description,after => {
    const overrides = option === 'event' ? eventOverrides(input,faction,game.current) : {}
    if (option === 'event' && game.current === 43 && !after.omens) after.omens = {holder:faction,head:null}
    if (option === 'event' && [73,76].includes(game.current)) after.markers[game.current] = {type:'capability',side:'unshaded'}
    if (input.guide?.rng && !input.recordedDice) after.rng = input.guide.rng
    const detail = input.note?.trim() || (option === 'pass' ? '' : 'Tabletop result recorded.')
    finishAction(after,option,description,detail,dice,overrides)
  },dice)
  showPreview(plan,'action')
}
function eventOverrides(input,faction,id) {
  const overrides = Object.fromEntries(FACTIONS.filter(key => ['yes','no'].includes(input['eligible'+key])).map(key => [key,input['eligible'+key] === 'yes']))
  if (id === 57 && overrides[faction] === undefined) overrides[faction] = true
  return overrides
}
function startBattleJob(job) {
  const previous = session.work
  const work = previous ?? refreshWork('action')
  const priorJob = work.input.battle
  work.input.battle = { job,answers:[] }
  try {
    resumeBattle()
    save()
  } catch (error) {
    if (priorJob) work.input.battle = priorJob
    else delete work.input.battle
    session.work = previous
    throw error
  }
}
function battlePosition(context) {
  if (!context) return ''
  const groups = units => units.map(({key,count,plunder,withdrawn,strike,absorbs}) => {
    const cargo = plunder ? ` · ${plunder} Plunder` : ''
    const shelter = withdrawn ? ` · ${withdrawn} sheltered` : ''
    return `<li>${clean(groupLabel(key))} ×${count}${cargo}${shelter}<small>Field Strike ${strike} · absorbs ${absorbs} per unit</small></li>`
  }).join('') || '<li>None</li>'
  const sites = context.holdings.map(site => `<li>${clean(site.name)} · ${PIECES[site.piece]}<small>${NAMES[site.owner]} · ${site.inside}/${site.capacity} sheltered · Garrison ${site.garrison}</small></li>`).join('')
  return `<details open class="callout battle-position"><summary>${clean(context.terrain)} · Forces and Strongholds</summary>
    <div class="battle-forces"><div><strong>Attacking · ${context.attacking.map(id => NAMES[id]).join(' and ')}</strong><ul>${groups(context.attackers)}</ul></div>
    <div><strong>Defending · ${context.defending.map(id => NAMES[id]).join(' and ')}</strong><ul>${groups(context.defenders)}</ul></div></div>
    ${sites ? `<strong>Defending Strongholds</strong><ul class="battle-sites">${sites}</ul>` : ''}
    ${context.modifiers.length ? `<p class="small muted">${context.modifiers.map(clean).join(' · ')}</p>` : ''}
    </details>`
}
function resumeBattle() {
  const record = session.work?.input.battle
  ensure(record,'Start a Battle to make tactical choices.')
  const {job,answers} = record
  const result = replayAction(state(),job,answers)
  if (!result.prompt) {
    if (job.kind === 'staged') {
      session.work.draft = result.after
      session.work.input.note = [session.work.input.note,result.detail].filter(Boolean).join(' ').slice(0,500)
      session.work.input.recordedDice = result.dice
      delete session.work.input.battle
      save()
      actionDialog()
      return
    }
    if (job.kind === 'sample') {
      modal(job.label,`<p class="muted">${clean(result.detail)}</p>${diffList(job.origin,result.after)}${diceList(result.dice,true)}`,
        button('Close sample','discard','primary'),'sample-result')
    } else {
      showPreview({label:job.label,description:result.detail || job.description,after:result.after,dice:result.dice,decision:job.decision},'battle')
    }
    return
  }
  const {prompt} = result
  modal(clean(prompt.stage),`<p class="muted">${clean(prompt.name)}</p><h3>${clean(prompt.title)}</h3>
    ${battlePosition(prompt.context)}
    <form id="battle-form" class="stack">
      ${field('Tactical choice',`<select name="answer">${selectOptions(prompt.options.map(option => [option.value,option.label]),prompt.defaultValue)}</select>`)}
      <button class="btn primary" type="submit">${prompt.stage.includes('Raid') || prompt.stage === 'Conspiratio Barbarica' ? 'Continue action' : 'Continue Battle'} ${icon('arrow')}</button>
    </form>
    ${prompt.progress.length ? ruleNotes(prompt.progress,'Battle so far') : ''}
    ${prompt.context ? ruleNotes([commandNotes.Battle]) : ''}
    ${diceList(result.dice,true)}`,
    (answers.length ? button('Previous choice','battle-back','ghost') : '')+button('Close Battle','close','ghost'),
    'battle')
}
function eventBattleDialog() {
  const game = state()
  const input = session.work.input
  const attacker = FACTIONS.includes(input.battleAttacker) ? input.battleAttacker : activeFaction(game)
  const rules = workBoard()
  const names = REGIONS.filter(({name}) => GROUPS.some(([key,owner]) => owner === attacker && on(rules.land[name],key)) && battleEnemies(rules,name,attacker,'Event').length).map(r => r.name)
  const name = names.includes(input.battleSpace) ? input.battleSpace : names[0]
  const enemies = name ? battleEnemies(rules,name,attacker,'Event') : []
  modal('Event Battle',`<p class="muted">Use the physical card to choose the factions and restrictions. Stage any pieces placed before the Battle first.</p>
    <form id="event-battle-form" class="stack"><div class="fields">
    ${field('Attacker',`<select name="battleAttacker">${selectOptions(FACTIONS.map(faction => [faction,NAMES[faction]]),attacker)}</select>`)}
    ${field('Space',`<select name="battleSpace">${selectOptions(names.map(name => [name,name]),name)}</select>`)}
    ${field('Defender',`<select name="battleDefender">${selectOptions(enemies.map(faction => [faction,NAMES[faction]]),input.battleDefender)}</select>`)}
    </div>
    ${descriptorField({key:'eventSurprise',label:'This Event enables Coup de Main',type:'check'},input)}
    ${descriptorField({key:'eventShield',label:'This Event grants Shield Wall',type:'check'},input)}
    <button class="btn primary" type="submit" ${enemies.length ? '' : 'disabled'}>Resolve Battle</button></form>`,button('Back','action-back','ghost'),'event-battle')
}
function bot(choices = {}) {
  const faction = activeFaction(state())
  if (session.work?.input.battle) { resumeBattle(); return }
  if (session.work?.kind === 'action' && session.work.input.guide?.faction === faction) {
    actionDialog()
    return
  }
  proposal = proposeBot(state(),[],choices)
  if (proposal.mode === 'consent') {
    modal(clean(proposal.title),`<h3>${clean(proposal.question)}</h3><p class="muted">${clean(proposal.description)}</p>`,
      button('Decline','bot-consent','ghost','no')+button('Allow','bot-consent','primary','yes'),'consent')
  } else if (proposal.mode === 'auto') {
    showPreview({ ...proposal,label:NAMES[faction]+' · '+proposal.title },'bot')
  } else if (proposal.mode === 'battle') {
    startBattleJob({kind:'action',label:NAMES[faction]+' · '+proposal.title,description:proposal.title,
      option:proposal.option,faction,dice:proposal.dice,origin:proposal.base,requests:proposal.requests,afterRaid:proposal.afterRaid,
      overrides:proposal.overrides,descriptionText:proposal.description,decision:proposal.decision})
  } else if (proposal.mode === 'player-event') {
    actionDialog('event',proposal)
  } else {
    actionDialog(null,{ ...proposal, dice:proposal.dice, faction })
  }
}
function clickTurn(action,value) {
  const game = state()
  if (game.markers[55]?.side === 'unshaded' && !SEAS[game.markers[55].sea]) {
    modal('Niall’s Raid',`<p>Choose the Sea affected by the active marker in this saved position.</p><div class="row">
      ${Object.entries(SEAS).map(([id,name])=>button(name,'repair-raid-sea','compact',id)).join('')}</div>`,button('Close','close','ghost'),'card-details')
    return
  }
  const declaration = botPivotalChoice(game)
  if (declaration) {
    handleAction('pivotal',declaration)
    return
  }
  if (canUseOmens(game) && !isHumanFaction(game,game.omens.holder) &&
      inCardOrder(game).filter(owner=>game.eligibility.includes(owner)).indexOf(game.omens.holder) >= 2) {
    handleAction('omens-commit')
    return
  }
  if (action === 'bot') { bot(); return }
  if (value !== 'pass') { actionDialog(value); return }
  const faction = activeFaction(state())
  const plan = preview(state(),NAMES[faction]+' · Pass','Record the pass and receive the faction’s Resources.',after => finishAction(after,'pass','Pass'))
  showPreview(plan,'close')
}
function stilichoFields(game,input) {
  const plan = stilichoRecoveryChoices(game)
  if (!plan?.count || !isHumanFaction(game,plan.faction)) return ''
  return `<details open><summary>Stilicho · return ${plan.count} Cavalry during Recovery</summary>${dynamicFields({fields:plan.fields},input)}</details>`
}
function epochDialog() {
  const game = state()
  const phase = game.epochPhase
  const work = refreshWork('epoch',{hoard:'0'})
  const input = work.input
  const descriptor = epochChoices(game,phase,input)
  let form = ''
  if (phase === 'Annona') {
    form = game.markers[10]?.side === 'unshaded' ? '<p>The active Annona Event skips this phase.</p>' :
      dynamicFields(annonaChoices(game,input),input)
  } else if (phase === 'Imperium') {
    form = isHumanFaction(game,'c')
      ? `<p>Move up to ${maxHoard(game)} Briton Resources to Wealth. The app checks Imperium and Dominance in rule order.</p>${number('Resources to hoard','hoard',input.hoard ?? 0,0,maxHoard(game),'required')}`
      : `<p>The Non-player Civitates hoards ${maxHoard(game)} Resources. The app then checks Imperium and Dominance.</p>`
  } else if (phase === 'Victory') {
    const final = game.epoch === scenarioInfo(game).epochs
    form = `<p>Check all four factions’ qualifying thresholds.${final ? ' Resolve final scoring if the campaign reaches its last Epoch.' : ''}</p>`+
      (final && scenarioInfo(game).finalRecovery && game.imperium !== 'f' ? stilichoFields(game,input) : '')
  } else if (phase === 'Revenue') {
    form = '<p>Calculate Prestige, Resources, taxation, and Renown from the board and Imperium status.</p>'
  } else if (phase === 'Recovery & Reset') {
    form = `<p>Recover Prosperity, clear Momentum and reset Eligibility. Event #${game.next} returns to play.</p>${game.deckMode === 'digital' ? '' : number('Newly revealed card','next',input.next,1,83,'required')}`+stilichoFields(game,input)
  } else {
    const choice = field('Resolve with',`<select name="method">${selectOptions([['app','App calculator'],['table','Record tabletop outcome']],input.method || 'app')}</select>`)
    form = descriptor && input.method !== 'table' ? choice+dynamicFields(descriptor,input) : choice+`
      <p>Follow the physical Epoch card or Upkeep aid for this phase and enter the results.</p>
      ${draftControls(workBoard(),game)}${field('Journal note · optional',`<textarea name="note" maxlength="500">${clean(input.note)}</textarea>`)}
      <label class="check"><input type="checkbox" name="confirmed" value="yes" ${input.confirmed === 'yes' ? 'checked' : ''} required> I resolved the tabletop changes.</label>`
  }
  const notes = epochNotes[phase] ? ruleNotes([epochNotes[phase]]) : ''
  modal(phase,`<form class="stack" id="epoch-form">${form}${notes}<button class="btn primary" type="submit">Preview phase ${icon('arrow')}</button></form>`,button('Discard draft','discard','ghost'),'epoch')
  save()
}
function epochPreview() {
  const game = state()
  const input = session.work.input
  const phase = game.epochPhase
  const guided = input.method === 'table'
  ensure(!guided || input.confirmed === 'yes','Confirm the tabletop phase before applying.')
  const dice = []
  const plan = preview(guided ? workBoard() : game,phase,guided ? 'Record the tabletop outcome.' : 'Apply the phase and move to the next step.',after => {
    const roll = makeRoller(after,dice)
    const annona = phase === 'Annona' && after.markers[10]?.side !== 'unshaded' ? planAnnona(after,input,roll) : {}
    const hoard = isHumanFaction(after,'c') ? Number(input.hoard || 0) : maxHoard(after)
    const note = guided ? input.note?.trim() : epochChoices(after,phase,input) ? runEpochEconomy(after,phase,input,roll) : ''
    const replacement = after.deckMode === 'digital' ? upcomingDigitalCard(after) : numOrNull(input.next)
    const info = {...annona,hoard,note,dice}
    info.beforeRecovery = () => {
      const stilicho = stilichoRecoveryChoices(after)
      if (stilicho) info.recoveryNote = applyStilichoRecovery(after,isHumanFaction(after,stilicho.faction) ? input : {})
    }
    advanceEpoch(after,info,replacement)
  },dice)
  showPreview(plan,'epoch')
}
function editorBack() {
  delete session.work.input.editor
  save()
  if (editorReturn === 'action') actionDialog()
  else if (editorReturn === 'epoch') epochDialog()
  else correction()
}
function previewBack(which) {
  pending = null
  if (which === 'action') actionDialog()
  else if (which === 'epoch') epochDialog()
  else if (which === 'edit') correction()
  else if (which === 'battle') {
    const work = session.work
    const job = work?.input.battle?.job
    if (work?.input.battle?.answers.length) {
      work.input.battle.answers.pop()
      save()
      resumeBattle()
    } else if (job?.kind === 'sample') {
      session.work = null
      save()
      dismiss()
    } else if (work?.input.battle) {
      delete work.input.battle
      save()
      if (job.option && !job.operation) dismiss()
      else actionDialog()
    }
  } else dismiss()
}
function download(name,content,type) {
  const link = document.createElement('a')
  const url = URL.createObjectURL(new Blob([content],{type}))
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url),1500)
}
function exportCampaign(checkpoint = false) {
  const game = state()
  const scenario = game.scenario.replace(/[^a-z0-9]+/gi,'_')
  const seat = humanFactions(game).map(id => NAMES[id]).join('_')
  const epoch = game.epochPhase ? game.epoch : Math.min(game.epoch+1,scenarioInfo(game).epochs)
  const phase = checkpoint ? `_Before-${game.epochPhase.replace(/[^a-z0-9]+/gi,'-')}` : ''
  const time = new Date().toISOString().slice(0,19).replaceAll(':','-')+'Z'
  download(`Pendragon_${scenario}_${seat}_Epoch-${epoch}${phase}_${time}.json`,serialize(session),'application/json')
  message(checkpoint ? 'Exported Epoch checkpoint.' : 'Exported campaign.')
}
function files() {
  modal('Saves',`<p class="muted">Export a JSON backup to continue on another device or browser. A backup includes your pending tabletop edits.</p>
    ${storageProblem ? `<p class="error">${clean(storageProblem)}</p>` : '<p class="small">Changes save automatically in this browser.</p>'}
    <p class="small muted">Undo retains up to ${HISTORY_LIMIT} applied steps. Export an Epoch checkpoint to keep a position longer.</p>
    <div class="row">${button('Export JSON','export','primary')}${button('Import JSON','import','')}${button('Download offline app','offline','ghost')}</div>
    ${storageLocked && saved ? button('Export original backup','export-raw','ghost') : ''}
    <input type="file" id="import-file" accept="application/json,.json" hidden>
    <div class="details">${button('New game','reset','danger ghost')}</div>`,'','files')
}
function openNew() {
  const game = state()
  const seat = Object.keys(SOLO_SEATS).find(key => SOLO_SEATS[key].join() === humanFactions(game).join()) || 'c'
  const choices = Object.keys(SOLO_SEATS).map(key => [key,({ britons:'Both Britons',barbarians:'Both Barbarians' }[key] || NAMES[key])])
  modal('New campaign',`<p class="muted">Choose your scenario, faction and deck. Starting a campaign replaces the current browser save.</p>
    <form id="new-form" class="stack"><div class="fields">
      ${field('Scenario',`<select name="scenario">${selectOptions(Object.keys(SCENARIOS).map(title => [title,title]),game.scenario)}</select>`)}
      ${field('You play',`<select name="seat">${selectOptions(choices,seat)}</select>`)}
      ${field('Difficulty',`<select name="difficulty">${selectOptions(DIFFICULTIES.map(label => [label,label]),game.difficulty)}</select>`)}
      ${field('Deck',`<select name="deckMode">${selectOptions([['physical','Physical deck · enter revealed card numbers'],['digital','Digital deck · reveal in app']],game.deckMode || 'physical')}</select>`)}
    </div>
    <p class="small muted" data-setup-entropy${game.scenario === 'Petty Tyrants' && seat === 'britons' ? '' : ' hidden'}>Petty Tyrants starts at Fragmentation. Entropy applies immediately, so you start with the Briton faction farther from victory. On a tie, you choose.</p>
    ${descriptorField({key:'variant',label:'Use the optional setup changes (Petty Tyrants and The Harder They Fall)',type:'check'},{variant:game.variant})}
    <p class="small muted">${EDITION}</p><button type="submit" class="btn primary">Start new game</button></form>`,button('Cancel','close','ghost'),'reset')
}
function openBattleDemo() {
  ensure(!state().current,'Start the Battle example before opening a campaign.')
  const work = refreshWork('edit')
  work.draft = null
  const sample = opening(1826)
  const space = sample.land.Corieltauvi
  sample.land.Carvetii.units.cav[0] -= 2
  space.units.cav = [3,0]
  space.units.mil = [0,0]
  space.units.com = [1,0]
  sample.pools.notYet--
  space.units.xr = [9,2]
  space.units.xw = [1,0]
  space.pros[1] = 0
  startBattleJob({kind:'sample',label:'Sample Battle · Corieltauvi',origin:sample,requests:[{name:'Corieltauvi',attacker:'x',defender:'d',source:'Battle',surprise:true}],dice:[]})
}
async function completeImport(file) {
  if (!file) return
  ensure(file.size < 5_000_000,'Choose a save under 5 MB.')
  const loaded = parseSave(await file.text())
  modal('Import campaign',`<p>Load the ${clean(loaded.game.scenario)} save with ${loaded.game.revealed.length} revealed cards?</p><p class="muted">This replaces the current campaign in this browser.</p>`,button('Cancel','files','ghost')+button('Load campaign','import-confirm','primary'),'import',loaded)
}
function resumeEditor() {
  const work = session.work
  if (work?.input.battle) {
    try { resumeBattle() }
    catch (error) { message('This draft needs to be discarded. '+error.message) }
  } else if (work?.input.editor && work.draft) {
    const editor = work.input.editor
    openEditor(editor === 'tracks' ? 'tracks' : 'region',editor,work.kind)
  } else if (work?.kind === 'action' && activeFaction(state())) {
    if (work.input.guide?.mode === 'guide' && !work.draft) {
      session.work = null
      save()
    } else actionDialog()
  } else if (work?.kind === 'epoch' && state().epochPhase) {
    epochDialog()
  } else if (work?.kind === 'edit') {
    correction()
  }
}
function reloadStorage(nextSession) {
  try {
    saved = localStorage.getItem(STORAGE_KEY)
    storageLocked = false
  } catch {
    storageProblem = 'Autosave is unavailable. Export a JSON save to keep your progress.'
  }
  session = nextSession
  proposal = null
  editorReturn = null
  dismiss()
  tab = 'play'
  save()
  render()
  resumeEditor()
}
function showError(error) {
  const node = dialog.querySelector('#dialog-error')
  if (dialog.open && node) {
    node.hidden = false
    node.textContent = error.message
    node.scrollIntoView({block:'nearest'})
  } else message(error.message)
}
function handleAction(action,value) {
  switch (action) {
    case 'tab': tab = value; render(); return
    case 'row-add':
    case 'row-remove': {
      const input = session.work.input
      const choice = actionSelections(state(),activeFaction(state()),input)
      const operation = choice.grant?.spec ?? choice.spec
      const spec = value === 'rows' ? operation : operation?.featFields
      input[value] = repeatCount(spec,value,input)+(action === 'row-add' ? 1 : -1)
      if (value === 'rows' && Number(input.featTiming) >= input.rows) input.featTiming = 'after'
      actionDialog()
      return
    }
    case 'action-back': actionDialog(); return
    case 'target-map': targetMap(value); return
    case 'target-pick': {
      ensure(dialogView === 'target-map' && dialogData.targets.has(value),'Choose an available space.')
      const {name} = dialogData
      changeWork('action',name,value)
      actionDialog()
      dialog.querySelector(`[name="${CSS.escape(name)}"]`)?.focus({preventScroll:true})
      return
    }
    case 'event-battle': eventBattleDialog(); return
    case 'battle-back': session.work.input.battle.answers.pop(); save(); resumeBattle(); return
    case 'battle-demo': openBattleDemo(); return
    case 'resume-battle': resumeBattle(); return
    case 'card-detail': cardDetails(Number(value)); return
    case 'repair-raid-sea': {
      const plan = preview(state(),'Niall’s Raid · '+SEAS[value],'Record the Sea already chosen for the active Event.',after => {
        ensure(SEAS[value] && after.markers[55]?.side === 'unshaded','The affected Sea cannot be changed here.')
        after.markers[55].sea = value
        log(after,'Niall’s Raid',SEAS[value]+' is affected until the Epoch.')
      })
      commit(plan.after,plan.label)
      return
    }
    case 'pivotal': {
      const plan = preview(state(),eventTitle(PIVOTAL[value]),'Interrupt the current card.',after => declarePivotal(after,value))
      commit(plan.after,plan.label)
      return
    }
    case 'entropy': {
      const plan = preview(state(),'Entropy · '+NAMES[value],'Continue the game as the chosen faction.',after => settleEntropy(after,value))
      commit(plan.after,plan.label)
      return
    }
    case 'mapmode': mapMode = mapMode === 'map' ? 'list' : 'map'; render(); return
    case 'files': files(); return
    case 'close': dismiss(); return
    case 'region': showRegion(value); return
    case 'edit-region': if (session.work?.kind === 'action' || session.work?.kind === 'epoch') { message('Finish or discard the current tabletop draft first.'); return } openEditor('region',value,'correction'); return
    case 'edit-tracks': if (session.work?.kind === 'action' || session.work?.kind === 'epoch') { message('Finish or discard the current tabletop draft first.'); return } openEditor('tracks','','correction'); return
    case 'draft-tracks': openEditor('tracks'); return
    case 'editor-back': editorBack(); return
    case 'correction-preview': {
      const plan = preview(workBoard(),'Tabletop corrections','Review the edited spaces and tracks.',after => log(after,'Tabletop corrections'))
      showPreview(plan,'edit')
      return
    }
    case 'remove-marker': delete session.work.draft.markers[value]; openEditor('tracks','',editorReturn); return
    case 'history': {
      const record = session[value].at(-1)
      if (!record || !rewind(session,value)) return
      proposal = null
      dismiss()
      save()
      render()
      message((value === 'undo' ? 'Undid ' : 'Redid ')+record.label+'. Check the physical board.')
      return
    }
    case 'demo': {
      const shown = preview(state(),'Sample opening','Use this position to try the turn workflow.',after => { Object.assign(after,opening(144)); startCards(after,22,5) })
      commit(shown.after,shown.label)
      return
    }
    case 'choose':
    case 'bot': clickTurn(action,value); return
    case 'bot-consent': bot({blueConsent:value === 'yes'}); return
    case 'epoch': epochDialog(); return
    case 'preview-back': previewBack(value); return
    case 'discard': session.work = null; pending = null; proposal = null; save(); dismiss(); render(); message('Draft discarded.'); return
    case 'commit':
      ensure(pending?.base === state(),'The board changed since this preview. Open a new preview.')
      ensure(session.work?.input.battle?.job.kind !== 'sample' || !state().current,'A sample cannot replace an active campaign.')
      commit(pending.after,pending.label)
      return
    case 'omens': {
      const holder = state().omens.holder
      const buttons = isHumanFaction(state(),holder) ? button('Keep Omens','close','ghost') : ''
      modal('Omens',`<p>Discard the Omens marker to move ${NAMES[holder]} to first eligible before the card begins (§5.3, #43).</p>`,buttons+button('Use Omens','omens-commit','primary'),'omens')
      return
    }
    case 'omens-commit': {
      const plan = preview(state(),'Omens','Discard Omens and move its holder to the front.',next => {
        const name = NAMES[next.omens.holder]
        resolveOmens(next,true)
        log(next,'Omens',name+' moves to the front.')
      })
      commit(plan.after,plan.label)
      return
    }
    case 'export': exportCampaign(); return
    case 'checkpoint': exportCampaign(true); return
    case 'export-raw': download('Pendragon_Original_Backup.json',saved,'application/json'); return
    case 'import': dialog.querySelector('#import-file').click(); return
    case 'import-confirm': reloadStorage(dialogData); message('Campaign loaded.'); return
    case 'offline': {
      const html = document.documentElement.cloneNode(true)
      const head = html.querySelector('head')
      const body = html.querySelector('body')
      head.replaceChildren(...head.querySelectorAll('meta[charset],meta[name="viewport"],meta[name="theme-color"],meta[name="description"],title,#pendragon-styles'))
      body.replaceChildren(...body.querySelectorAll('#app,#dialog,#notice,#pendragon-noscript,#pendragon-bundle'))
      html.querySelectorAll('#app,#dialog,#notice').forEach(node => node.replaceChildren())
      html.querySelector('#dialog').removeAttribute('open')
      download('Pendragon_Solo.html','<!doctype html>\n'+html.outerHTML,'text/html')
      return
    }
    case 'reset': openNew(); return
  }
}

document.addEventListener('click',event => {
  const target = event.target.closest('[data-act]')
  if (!target || target.disabled) return
  try { handleAction(target.dataset.act,target.dataset.value) } catch (error) { showError(error) }
})
document.addEventListener('keydown',event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.region-node')) {
    event.preventDefault()
    event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}))
  }
})
document.addEventListener('change',async event => {
  const target = event.target
  try {
    if (target.id === 'import-file') await completeImport(target.files[0])
    if (target.id === 'select-space' && target.value) openEditor('region',target.value)
    if (target.form?.id === 'new-form' && ['scenario','seat'].includes(target.name)) {
      const {scenario,seat} = target.form.elements
      target.form.querySelector('[data-setup-entropy]').hidden = scenario.value !== 'Petty Tyrants' || seat.value !== 'britons'
    }
    if (target.form?.id === 'event-battle-form' && ['battleAttacker','battleSpace'].includes(target.name)) eventBattleDialog()
    if (target.form?.id === 'epoch-form' && (target.dataset.refresh || target.name === 'method')) {
      const advanced = target.closest('details')?.open
      const key = target.name
      epochDialog()
      if (advanced) {
        const refocused = dialog.querySelector('[name="'+CSS.escape(key)+'"]')
        if (refocused?.closest('details')) refocused.closest('details').open = true
        refocused?.focus({preventScroll:true})
      }
    }
    if (target.form?.id === 'action-form' && (target.dataset.refresh || ['option','command','feat','side','grant','grantFeat','method','tradeAll'].includes(target.name) || (session.work.input.option === 'event' && target.tagName === 'SELECT' && !target.name.startsWith('eligible') && !/^(rows|feats)\d+-/.test(target.name)))) {
      if (['option','command','feat','side','grant','grantFeat'].includes(target.name)) {
        for (const key of Object.keys(session.work.input)) if (key.startsWith('rows') || key.startsWith('feats')) delete session.work.input[key]
        if (target.name === 'side') {
          delete session.work.input.grant
          delete session.work.input.grantFeat
        }
      }
      const advanced = target.closest('details')?.open
      actionDialog()
      if (target.dataset.refresh || advanced) {
        const refocused = dialog.querySelector('[name="'+CSS.escape(target.name)+'"]')
        if (advanced && refocused?.closest('details')) refocused.closest('details').open = true
        refocused?.focus({preventScroll:true})
      }
    }
  } catch (error) { showError(error) }
})
document.addEventListener('input',event => {
  const target = event.target
  const form = target.form
  if (!form || !target.name) return
  try {
    const descriptor = { 'cards-form':'cards', 'action-form':'action', 'epoch-form':'epoch', 'event-battle-form':'action' }[form.id]
    if (descriptor) changeWork(descriptor,target.name,target.type === 'checkbox' && !target.checked ? '' : target.value)
    if (['edit-region-form','edit-tracks-form'].includes(form.id)) bindEditorDraft(form,false)
  } catch (error) { showError(error) }
})
document.addEventListener('submit',event => {
  const form = event.target
  event.preventDefault()
  try {
    if (form.id === 'cards-form') {
      const inputs = new FormData(form)
      const current = numOrNull(inputs.get('current'))
      const next = numOrNull(inputs.get('next'))
      const game = state()
      const plan = preview(game,game.current ? 'Advance card' : 'Start game','',after => {
        if (game.current) advanceCard(after,after.deckMode === 'digital' ? upcomingDigitalCard(after) : next)
        else if (after.deckMode === 'digital') startDigitalDeck(after)
        else startCards(after,current,next)
      })
      commit(plan.after,plan.label)
    }
    if (form.id === 'new-form') {
      const {scenario,seat,difficulty,deckMode,variant} = Object.fromEntries(new FormData(form))
      const game = opening(undefined,{scenario,seat,difficulty,deckMode,variant:Boolean(variant)})
      settleEntropy(game)
      reloadStorage(fresh(game))
      message('New campaign ready.')
    }
    if (form.id === 'battle-form') {
      const answers = session.work.input.battle.answers
      answers.push(new FormData(form).get('answer'))
      try { resumeBattle(); save() }
      catch (error) { answers.pop(); throw error }
    }
    if (form.id === 'event-battle-form') {
      const input = Object.fromEntries(new FormData(form))
      const origin = clone(workBoard())
      const dice = session.work.input.recordedDice || session.work.input.guide?.dice || []
      if (!session.work.input.recordedDice && session.work.input.guide?.rng) origin.rng = session.work.input.guide.rng
      startBattleJob({kind:'staged',label:'Event Battle',origin,dice,requests:[{
        name:input.battleSpace,attacker:input.battleAttacker,defender:input.battleDefender,source:'Event',
        surprise:Boolean(input.eventSurprise),shieldWall:Boolean(input.eventShield),
      }]})
    }
    if (form.id === 'action-form') {
      Object.assign(session.work.input,Object.fromEntries(new FormData(form).entries()))
      actionPreview()
    }
    if (form.id === 'epoch-form') {
      Object.assign(session.work.input,Object.fromEntries(new FormData(form).entries()))
      epochPreview()
    }
    if (['edit-region-form','edit-tracks-form'].includes(form.id)) {
      bindEditorDraft(form,true)
      editorBack()
    }
  } catch (error) { showError(error) }
})
dialog.addEventListener('cancel',event => {
  event.preventDefault()
  dismiss()
})
window.addEventListener('storage',event => {
  if (event.key === STORAGE_KEY && event.newValue !== saved) {
    storageLocked = true
    storageProblem = 'Another tab changed the save. Export this tab’s progress or reload the newer save.'
    showStorageProblem()
  }
})
render()
resumeEditor()

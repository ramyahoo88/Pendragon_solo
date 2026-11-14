import assert from 'node:assert/strict'
import test from 'node:test'
import { REGIONS } from '../src/data.mjs'
import { availability, opening, setImperium, validatePosition } from '../src/position.mjs'
import { epochChoices, runEpochEconomy } from '../src/epoch-economy.mjs'

function dice(named = {}) {
  let sample = 0
  return (sides,label) => named[label] ?? (++sample% sides)+1
}
const runEvent = (position,id,input = {},roll = dice()) => {
  position.current = id
  return runEpochEconomy(position,'Epoch Event',input,roll)
}
const count = (state,key) => Object.values(state.land).reduce((n,space)=>n+space.units[key][0],0)

test('§6.6.1 Dux stows Plunder before paying discount Fort and Road Upkeep', () => {
  const state = opening(144)
  setImperium(state,'am')
  state.markers[67] = {type:'capability',side:'shaded'}
  state.tracks.blue = 13
  state.land.Atrebates.units.cav[1] = 1
  state.land.Regni.units.cav[1] = 1
  state.land.Carvetii.units.dsw = [2,1]
  state.land.Brigantes.units.cav = [3,0]
  state.land.Eboracum.units.cav = [0,0]
  state.pools.casualties = 2
  state.land.Silures.sites[0] = {piece:'ss',employer:'d'}
  const result = runEpochEconomy(state,'Dux Upkeep',{},dice())
  assert.match(result,/Maintained 9 of 9 Forts for 5 Resources/)
  assert.equal(state.tracks.blue,0)
  assert.equal(state.tracks.red,1)
  assert.equal(state.roads,true)
  assert.deepEqual(state.land.Carvetii.units.dsw,[0,0])
  assert.deepEqual(state.land.Silures.units.dsw,[2,0])
  assert.equal(state.land.Brigantes.units.cav[0],0)
  assert.equal(state.pools.casualties,0)
  assert.equal(state.pools.out,1)
  validatePosition(state)
})
test('§6.6.1 Civilian Autonomy requires Civitates permission before blue Fort payments', () => {
  const state = opening(144)
  setImperium(state,'ac')
  state.tracks.red = 5
  const allowed = structuredClone(state)
  assert.equal(epochChoices(state,'Dux Upkeep').fields[0].name,'allow-blue')
  runEpochEconomy(state,'Dux Upkeep',{},dice())
  assert.equal(state.tracks.blue,25)
  assert.equal(state.tracks.red,0)
  assert.equal(state.roads,false)
  runEpochEconomy(allowed,'Dux Upkeep',{'allow-blue':'yes'},dice())
  assert.equal(allowed.tracks.blue,5)
  assert.equal(allowed.tracks.red,5)
  assert.equal(allowed.roads,true)
})
test('§6.6.2 Civitates can pay with newly stowed Plunder and cannot keep unpaid Comitates', () => {
  const state = opening(144)
  state.land.Cornovii.units.com = [2,1]
  state.land.Durotriges.units.com = [2,0]
  state.pools.notYet = 11
  state.tracks.refugees = 3
  state.land.Brigantes.units.mil = [5,0]
  state.land.Parisi.units.cxw = [3,1]
  const note = runEpochEconomy(state,'Civitates Upkeep',{'comitates-wealth':'1','com-remove-Cornovii-com':'1'},dice())
  assert.match(note,/1 unpaid Comitates/)
  assert.equal(state.tracks.wealth,1)
  assert.equal(state.tracks.refugees,1)
  assert.equal(state.land.Brigantes.units.mil[0],4)
  assert.equal(count(state,'com'),3)
  assert.deepEqual(state.land.Parisi.units.xw,[3,0])
  assert.deepEqual(state.land.Parisi.units.cxw,[0,0])
  validatePosition(state)
})
test('Camelot upkeep removes unpaid Hillfort and Gratia may expire before recovery', () => {
  const state = opening(144)
  state.markers[21] = {type:'capability',side:'shaded'}
  state.markers[27] = {type:'capability',side:'unshaded'}
  state.tracks.blue = 0
  state.tracks.wealth = 1
  const hills = REGIONS.flatMap(({name})=>state.land[name].sites.flatMap((site,index)=>site?.piece==='hill'?[`hill-${name}-${index}`]:[]))
  const payment = Object.fromEntries(hills.map((key,i)=>[key,i===0]))
  runEpochEconomy(state,'Civitates Upkeep',payment,dice())
  assert.equal(state.markers[27],undefined)
  assert.equal(state.tracks.wealth,0)
  assert.equal(REGIONS.flatMap(({name})=>state.land[name].sites).filter(site=>site?.piece==='hill').length,1)
  validatePosition(state)
})
test('§6.6.3 Return is restricted to spaces containing Saxon Plunder, then Warbands use nearest native Settlement', () => {
  const state = opening(144)
  state.tracks.x = 1
  state.land.Dumnonii.units.xr = [3,1]
  state.land.Dumnonii.units.xw = [1,0]
  state.land.Durotriges.units.xr = [2,0]
  state.land.Cornovii.sites[1] = {piece:'xs',employer:null}
  state.land.Durotriges.sites[1] = {piece:'xs',employer:'d'}
  runEpochEconomy(state,'Saxon Upkeep',{},dice())
  assert.deepEqual(state.land.Dumnonii.units.xr,[0,0])
  assert.deepEqual(state.land.Durotriges.units.xr,[2,0])
  assert.deepEqual(state.land.Cornovii.units.xw,[1,0])
  assert.equal(state.tracks.x,10)
  validatePosition(state)
})
test('§6.6.3 Scotti Warbands without any native Settlement are removed', () => {
  const state = opening(144)
  state.tracks.s = 1
  state.land.Dumnonii.units.sw = [2,1]
  state.land.Dumnonii.units.sr = [2,0]
  runEpochEconomy(state,'Scotti Upkeep',{},dice())
  assert.deepEqual(state.land.Dumnonii.units.sw,[0,0])
  assert.deepEqual(state.land.Dumnonii.units.sr,[0,0])
  assert.equal(state.tracks.s,6)
  validatePosition(state)
})
test('Card 77 bot bids maximum only with blue Resources and receives the successful reward', () => {
  const state = opening(144)
  state.tracks.blue = 12
  state.tracks.red = 80
  state.tracks.prestige = 1
  setImperium(state,'am')
  runEvent(state,77,{},dice({'Magnus Maximus bid':4}))
  assert.equal(count(state,'cav'),16)
  assert.equal(state.pools.casualties,1)
  assert.equal(state.pools.out,3)
  assert.equal(state.tracks.blue,20)
  assert.equal(state.tracks.red,80)
  assert.equal(state.tracks.prestige,1)
  assert.equal(state.imperium,'rm')
  validatePosition(state)
})
test('Card 78 Military refusal loses Prestige but Fragmentation bypasses the Event', () => {
  const state = opening(144,{seat:'d'})
  state.tracks.prestige = 10
  runEvent(state,78,{'bid-cavalry':'0'},dice())
  assert.equal(state.tracks.prestige,2)
  setImperium(state,'f')
  runEvent(state,78,{'bid-cavalry':'4'},dice())
  assert.equal(count(state,'cav'),20)
})
test('Card 79 shifts Rome before preemption and returns unpaid Cavalry to Available', () => {
  const state = opening(144)
  state.tracks.blue = 15
  state.tracks.red = 3
  state.tracks.wealth = 2
  runEvent(state,79,{'donatio-wealth':'2'},dice({'Cavalry donatio':5}))
  assert.equal(state.imperium,'rc')
  assert.equal(count(state,'cav'),16)
  assert.equal(state.tracks.blue,6)
  assert.equal(state.tracks.red,3)
  assert.equal(state.tracks.wealth,0)
  assert.equal(state.pools.casualties,0)
  assert.equal(availability(state).cav,4)
  validatePosition(state)
})
test('Card 80 Civitates selects a legal Militia placement and funds maintenance after political shift', () => {
  const state = opening(144)
  setImperium(state,'rc')
  state.tracks.blue = 20
  state.tracks.red = 0
  state.tracks.wealth = 0
  state.current = 80
  const input = {'cut-ties':'yes','allow-blue':'yes','ties-militia-Dobunni':'6'}
  assert.ok(epochChoices(state,'Epoch Event',input).fields.some(field=>field.name==='allow-blue'))
  runEvent(state,80,input,dice({'Cavalry donatio':2}))
  assert.equal(state.land.Dobunni.units.mil[0],8)
  assert.equal(state.imperium,'ac')
  assert.equal(count(state,'cav'),20)
  assert.equal(state.tracks.blue,11)
  validatePosition(state)
})
test('Card 81 permanently adjusts the four Regions without producing Refugees or immediately removing cubes', () => {
  const state = opening(144)
  state.land.Iceni.pop = 0
  runEvent(state,81)
  for (const name of ['Textoverdi','Deceangli','Durotriges']) {
    assert.equal(state.land[name].pop,1)
    assert.deepEqual(state.land[name].pros,[2,2])
  }
  assert.equal(state.land.Iceni.pop,0)
  assert.equal(state.tracks.refugees,0)
  assert.deepEqual(state.markers[81],{type:'capability',side:'unshaded'})
  runEvent(state,81)
  assert.equal(state.land.Textoverdi.pop,1)
})
test('Card 82 bot requires the full expedition force and failed expedition removes half and changes Dominance', () => {
  const state = opening(144)
  state.tracks.prestige = 11
  state.land.Atrebates.units.dxw = [3,0]
  runEvent(state,82,{},dice({'Rhiotamus expedition':5}))
  assert.equal(state.tracks.prestige,11)
  state.land.Regni.units.dsw = [1,0]
  runEvent(state,82,{},dice({'Rhiotamus expedition':5}))
  assert.equal(count(state,'dxw')+count(state,'dsw'),0)
  assert.equal(count(state,'cav'),20)
  assert.equal(state.pools.casualties,0)
  assert.equal(state.imperium,'rc')
  assert.equal(state.tracks.prestige,6)
  validatePosition(state)
})
test('Card 83 Dux wins a tied bid, pays 2 per unit and leaves successful troops carrying Plunder', () => {
  const state = opening(144)
  state.tracks.blue = 16
  state.land.Dumnonii.units.com = [8,0]
  state.pools.notYet = 7
  const input = {'pendragon-bid-c':'8','pendragon-target-c':'x'}
  runEvent(state,83,input,dice({'Pendragon expedition':4}))
  assert.equal(state.tracks.blue,0)
  assert.equal(state.tracks.x,0)
  assert.equal(count(state,'cav'),20)
  assert.equal(Object.values(state.land).reduce((n,space)=>n+space.units.cav[1],0),8)
  assert.equal(state.land.Dumnonii.units.com[1],0)
  validatePosition(state)
})

test('Bot Civitates Upkeep preserves Briton Population when two towns are equidistant', () => {
  const state = opening(144,{seat:'d'})
  for (const land of Object.values(state.land)) land.sites = land.sites.map(site=>['town','hill'].includes(site?.piece)?null:site)
  state.land.Dobunni.sites[0] = {piece:'town',employer:null}
  state.land.Durotriges.sites[0] = {piece:'town',employer:null}
  state.land.Atrebates.units.mil = [2,0]
  state.land.Dobunni.units.xw = [3,0]
  state.land.Durotriges.units.mil = [0,0]
  state.land.Dobunni.units.mil = [2,0]
  runEpochEconomy(state,'Civitates Upkeep',{},dice())
  assert.equal(state.land.Atrebates.units.mil[0],0)
  assert.ok(state.land.Dobunni.units.mil[0]>=4)
})

test('Dux Upkeep selects legal human Cavalry quarters while retaining chosen Forts', () => {
  const state = opening(144,{seat:'d'})
  const forts = REGIONS.flatMap(({name})=>state.land[name].sites.flatMap((site,index)=>site?.piece==='fort'?[{name,index}]:[]))
  const choices = Object.fromEntries(forts.map(({name,index})=>[`fort-${name}-${index}`,['Atrebates','Regni'].includes(name)]))
  const quarters = {...choices,'quarters-cav-Atrebates':'7','quarters-cav-Regni':'13'}
  runEpochEconomy(state,'Dux Upkeep',quarters,dice())
  assert.deepEqual(state.land.Atrebates.units.cav,[7,0])
  assert.deepEqual(state.land.Regni.units.cav,[13,0])
  assert.equal(state.tracks.blue,23)
  validatePosition(state)
})

test('Rhiotamus validates the participating force and lets the Dux select its exact losses', () => {
  const state = opening(144,{seat:'d'})
  state.land.Regni.units.dxw = [2,0]
  state.tracks.prestige = 10
  const input = {
    'rhiotamus-cavalry':'2','rhiotamus-foederati':'1',
    'rhiotamus-send-Carvetii-cav':'2','rhiotamus-send-Regni-dxw':'1',
    'rhiotamus-remove-Carvetii-cav':'1','rhiotamus-remove-Regni-dxw':'1',
  }
  runEvent(state,82,input,dice({'Rhiotamus expedition':2}))
  assert.equal(state.land.Carvetii.units.cav[0],2)
  assert.equal(state.land.Regni.units.dxw[0],1)
  assert.equal(state.pools.casualties,1)
  assert.equal(state.tracks.prestige,5)
  validatePosition(state)
})

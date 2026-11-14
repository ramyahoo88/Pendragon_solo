import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandFields, runCommand, runCommandFeat } from '../src/commands.mjs'
import { makeRoller } from '../src/bots.mjs'
import { opening, setImperium, validatePosition } from '../src/position.mjs'

test('Muster reserves explicit Wealth before the base levy and rejects unavailable units atomically', () => {
  const state = opening(1)
  state.pools.notYet = 13
  state.tracks.blue = 1
  state.tracks.wealth = 3
  const action = { faction:'c', command:'Muster', rows:[{space:'Dobunni', militia:1, comitates:2}] }
  runCommand(state,action)
  assert.deepEqual(state.land.Dobunni.units.mil,[3,0])
  assert.deepEqual(state.land.Dobunni.units.com,[2,0])
  assert.equal(state.tracks.blue,0)
  assert.equal(state.tracks.wealth,0)
  const before = JSON.stringify(state)
  assert.throws(() => runCommand(state,action))
  assert.equal(JSON.stringify(state),before)
  validatePosition(state)
})

test('Rule converts loaded Civitates pieces to Wealth and enforces Tears of Epona ceiling', () => {
  const state = opening(7)
  state.markers[81] = {type:'capability',side:'unshaded'}
  state.land.Iceni.units.mil = [1,1]
  state.tracks.refugees = 1
  assert.throws(() => runCommand(state,{faction:'c',command:'Trade',feat:'Rule',rows:[],featRows:[{space:'Iceni',mode:'population'}]}), /Population limit/)
  runCommand(state,{faction:'c',command:'Trade',feat:'Rule',rows:[],featRows:[{space:'Iceni',mode:'wealth'}]})
  assert.deepEqual(state.land.Iceni.units.mil,[1,0])
  assert.equal(state.tracks.blue,36)
  assert.equal(state.tracks.wealth,2)
  validatePosition(state)
})

test('Dux Train pays once in a mixed space and Alans permits two Cavalry per Fort', () => {
  const state = opening(7)
  state.land.Carvetii.units.cav[0] -= 2
  state.land.Atrebates.pros = [3,0]
  state.markers[2] = {type:'capability',side:'unshaded'}
  runCommand(state,{faction:'d',command:'Train',rows:[{space:'Atrebates',cavalry:2,militia:2,restore:true}]})
  assert.deepEqual(state.land.Atrebates.units.cav,[3,0])
  assert.deepEqual(state.land.Atrebates.units.mil,[3,0])
  assert.deepEqual(state.land.Atrebates.pros,[3,3])
  assert.equal(state.tracks.blue,20)
  validatePosition(state)
})

test('Stilicho doubles the Militia version of Train and troop space available in Muster', () => {
  const state = opening(7)
  state.markers[4] = {type:'momentum',side:'unshaded'}
  runCommand(state,{faction:'d',command:'Train',rows:[{space:'Atrebates',militia:4}]})
  assert.deepEqual(state.land.Atrebates.units.mil,[5,0])
  state.land.Carvetii.units.mil = [2,0]
  state.land.Atrebates.units.mil[0] -= 4
  runCommand(state,{faction:'c',command:'Muster',rows:[{space:'Carvetii',militia:2}]})
  assert.deepEqual(state.land.Carvetii.units.mil,[4,0])
  validatePosition(state)
})

test('Limited and free Command limits do not grant a Feat unless explicitly authorized', () => {
  const state = opening(7)
  assert.equal(commandFields(state,'c','Trade','Rule',{free:true}),null)
  assert.throws(() => runCommand(state,{faction:'c',command:'Trade',feat:'Rule',options:{limited:true}}),/Limited Command/)
  assert.throws(() => runCommand(state,{faction:'c',command:'Trade',feat:'Rule',options:{free:true}}),/Free Command/)
  assert.throws(() => runCommand(state,{faction:'c',command:'Trade',options:{limited:true},rows:[{space:'Atrebates'},{space:'Dobunni'}]}),/command rows/)
  const value = state.tracks.blue
  runCommand(state,{faction:'c',command:'Trade',feat:'Rule',options:{free:true,allowFeat:true},rows:[{space:'Atrebates'}],featRows:[{space:'Atrebates',mode:'wealth'}]})
  assert.equal(state.tracks.blue,value-1)
  assert.equal(state.tracks.wealth,1)
})

test('Free Muster waives regular cost while retaining the extra Wealth for Comitates', () => {
  const state = opening(7)
  state.pools.notYet = 14
  state.tracks.wealth = 1
  runCommand(state,{faction:'c',command:'Muster',options:{free:true,spaceLimit:1,regionsOnly:true,troopsOnly:true},rows:[{space:'Dobunni',militia:1,comitates:1}]})
  assert.equal(state.tracks.blue,25)
  assert.equal(state.tracks.wealth,0)
  assert.deepEqual(state.land.Dobunni.units.com,[1,0])
})

test('March splits at one origin and moves laden pieces without reusing arrivals', () => {
  const state = opening(7)
  state.land.Textoverdi.units.cav[1] = 1
  runCommand(state,{faction:'d',command:'March',options:{limited:true},rows:[
    {origin:'Textoverdi',destination:'Carvetii',cav:1,cavp:1},
    {origin:'Textoverdi',destination:'Votadini',cav:1},
  ]})
  assert.deepEqual(state.land.Textoverdi.units.cav,[1,0])
  assert.deepEqual(state.land.Carvetii.units.cav,[4,1])
  assert.deepEqual(state.land.Votadini.units.cav,[1,0])
  assert.equal(state.tracks.blue,23)
  const before = JSON.stringify(state)
  assert.throws(() => runCommand(state,{faction:'d',command:'March',rows:[
    {origin:'Textoverdi',destination:'Votadini',cav:1},
    {origin:'Votadini',destination:'Textoverdi',cav:2},
  ]}),/not enough Cavalry/)
  assert.equal(JSON.stringify(state),before)
})

test('Multi-step Dux March requires maintained road until the last leg and upfront friendly Control', () => {
  const state = opening(7)
  runCommand(state,{faction:'d',command:'March',rows:[{origin:'Corieltauvi',via:'Dobunni',destination:'Silures',cav:1}]})
  assert.deepEqual(state.land.Silures.units.cav,[3,0])
  assert.throws(() => runCommand(state,{faction:'d',command:'March',rows:[{origin:'Silures',via:'Cornovii',destination:'Deceangli',cav:1}]}),/maintained Road/)
  assert.throws(() => runCommand(state,{faction:'c',command:'March',rows:[{origin:'Dobunni',via:'Corieltauvi',destination:'Iceni',mil:1}]}),/Militia cannot/)
  validatePosition(state)
})

test('Barbarian Sea March pays per destination and no Fort may be at landing', () => {
  const state = opening(7)
  state.land.Dumnonii.units.sw = [2,1]
  state.land.Ordovices.units.sw = [2,0]
  runCommand(state,{faction:'s',command:'March',rows:[
    {origin:'Dumnonii',destination:'Demetae',sea:true,sw:1,swp:1},
    {origin:'Ordovices',destination:'Demetae',sw:1},
  ]})
  assert.deepEqual(state.land.Demetae.units.sw,[2,1])
  assert.equal(state.tracks.s,4)
  assert.throws(() => runCommand(state,{faction:'s',command:'March',rows:[{origin:'Dumnonii',destination:'Carvetii',sea:true,sw:1}]}),/no Dux Fort/)
})

test('Invite conversion keeps the pieces, nationality and Plunder, and charges per piece', () => {
  const state = opening(7)
  state.land.Textoverdi.sites[1] = {piece:'xs',employer:'c'}
  state.land.Textoverdi.units.cxw = [2,1]
  runCommand(state,{faction:'d',command:'Train',feat:'Invite',rows:[{space:'Carvetii'}],featRows:[{space:'Textoverdi',nation:'x',mode:'convert'}],input:{featBefore:true}})
  assert.deepEqual(state.land.Textoverdi.units.cxw,[0,0])
  assert.deepEqual(state.land.Textoverdi.units.dxw,[2,1])
  assert.equal(state.land.Textoverdi.sites[1].employer,'d')
  assert.equal(state.tracks.blue,22)
  validatePosition(state)
})

test('Cair Legion makes each new Fort consume one Cavalry in its own space', () => {
  const state = opening(7)
  state.markers[7] = {type:'capability',side:'shaded'}
  state.land.Carvetii.sites[0] = null
  runCommand(state,{faction:'d',command:'Train',feat:'Build',rows:[{space:'Dumnonii'}],featRows:[{space:'Carvetii',mode:'fort'}]})
  assert.equal(state.land.Carvetii.sites[0].piece,'fort')
  assert.deepEqual(state.land.Carvetii.units.cav,[2,0])
  assert.equal(state.tracks.blue,22)
  validatePosition(state)
})

test('Pillage fills capacity, targets one enemy Stronghold, and records Plunder on units', () => {
  const state = opening(7)
  setImperium(state,'f')
  const region = state.land.Dumnonii
  region.sites[0] = {piece:'ss',employer:null}
  region.units.sw = [2,0]
  const result = runCommandFeat(state,{faction:'c',command:'Battle',feat:'Pillage',rows:[{space:'Dumnonii'}]})
  assert.match(result,/gained 1 Plunder/)
  assert.deepEqual(state.land.Dumnonii.units.mil,[1,1])
  assert.deepEqual(state.land.Dumnonii.pros,[1,0])
  assert.equal(state.tracks.s,5)
  validatePosition(state)
})

test('Requisition draws from Resources then Wealth and transfers all Dux Plunder', () => {
  const state = opening(7)
  state.tracks.blue = 1
  state.tracks.wealth = 4
  state.land.Atrebates.units.cav = [1,1]
  runCommandFeat(state,{faction:'d',command:'Battle',feat:'Requisition',rows:[{space:'Atrebates'},{space:'Regni'}]})
  assert.equal(state.tracks.blue,0)
  assert.equal(state.tracks.wealth,3)
  assert.equal(state.tracks.red,3)
  assert.deepEqual(state.land.Atrebates.units.cav,[1,0])
})

test('Saxon Return and Settle returns Plunder before recruiting and preserves roller updates', () => {
  const state = opening(7)
  const region = state.land.Dumnonii
  region.sites[1] = {piece:'xs',employer:null}
  region.units.xw = [2,0]
  region.units.xr = [3,3]
  state.tracks.x = 0
  const dice = []
  const roll = makeRoller(state,dice,[3,4,5])
  runCommand(state,{faction:'x',command:'Return',feat:'Settle',rows:[{space:'Dumnonii'}],featRows:[{space:'Dumnonii',mode:'recruit',bands:2}]},roll)
  assert.equal(state.tracks.x,0)
  assert.deepEqual(state.land.Dumnonii.units.xw,[6,0])
  assert.deepEqual(state.land.Dumnonii.units.xr,[0,0])
  assert.deepEqual(dice.map(x => x.value),[3,4,5])
  assert.notEqual(state.rng,7)
  validatePosition(state)
})

test('Thanet two spaces never count the same Raiders twice', () => {
  const state = opening(7)
  state.markers[45] = {type:'capability',side:'shaded',faction:'x'}
  state.land.Dumnonii.units.xr = [3,0]
  state.land.Durotriges.units.xw = [4,0]
  const dice = []
  const roll = makeRoller(state,dice,[4,4,4])
  assert.throws(() => runCommand(state,{faction:'x',command:'Return',feat:'Settle',rows:[{space:'Dumnonii'}],featRows:[
    {space:'Dumnonii',raiders:'Dumnonii'},
    {space:'Durotriges',raiders:'Dumnonii'},
  ]},roll),/only be reserved once/)
  assert.equal(dice.length,0)
  assert.equal(state.rng,7)
})

test('Entreat can execute after Return using just-earned Renown', () => {
  const state = opening(7)
  state.tracks.s = 1
  state.land.Dumnonii.units.sr = [3,3]
  state.land.Demetae.units.sw = [1,0]
  runCommand(state,{faction:'s',command:'Return',feat:'Entreat',rows:[{space:'Dumnonii'}],featRows:[{space:'Demetae',settlement:true,bands:1}]})
  assert.equal(state.tracks.s,0)
  assert.equal(state.land.Demetae.sites[0].piece,'ss')
  assert.deepEqual(state.land.Demetae.units.sw,[2,0])
  assert.deepEqual(state.land.Demetae.units.mil,[0,0])
  validatePosition(state)
})

test('March permits a turn-by-turn Road pickup and Militia drop-off, paying each origin once',() => {
  const state = opening(7)
  state.pools.notYet = 13
  state.land.Cornovii.units.com = [1,0]
  state.land.Dobunni.units.com = [1,1]
  runCommand(state,{faction:'c',command:'March',rows:[{
    origin:'Cornovii',via:'Dobunni',destination:'Catuvellauni',mil:1,com:1,logistics:'Dobunni -mil=1 +com=1:1',
  }]})
  assert.deepEqual(state.land.Cornovii.units.mil,[0,0])
  assert.deepEqual(state.land.Dobunni.units.mil,[3,0])
  assert.deepEqual(state.land.Dobunni.units.com,[0,0])
  assert.deepEqual(state.land.Catuvellauni.units.com,[2,1])
  assert.equal(state.tracks.blue,21)
  validatePosition(state)
})

test('Train can recycle a placed Cavalry only after the off-board supply is exhausted',() => {
  const state = opening(7)
  state.land.Carvetii.units.cav[0]--
  runCommand(state,{faction:'d',command:'Train',rows:[{space:'Atrebates',cavalry:1},{space:'Regni',cavalry:1}],input:{recycle:'cavalry@Carvetii=1'}})
  assert.deepEqual(state.land.Atrebates.units.cav,[2,0])
  assert.deepEqual(state.land.Regni.units.cav,[2,0])
  assert.deepEqual(state.land.Carvetii.units.cav,[1,0])
  validatePosition(state)
})

test('Thanet can explicitly split one origin of Returning Raiders across its two Settle spaces',() => {
  const state = opening(7)
  state.markers[45] = {type:'capability',side:'shaded',faction:'x'}
  state.land.Dumnonii.units.xr = [3,0]
  state.land.Durotriges.units.xw = [4,0]
  const dice = []
  const roll = makeRoller(state,dice,[4,4,4])
  runCommand(state,{faction:'x',command:'Return',feat:'Settle',rows:[{space:'Dumnonii'}],featRows:[
    {space:'Dumnonii',raiders:'Dumnonii=2'},
    {space:'Durotriges',raiders:'Dumnonii=1'},
  ]},roll)
  assert.deepEqual(state.land.Dumnonii.units.xw,[2,0])
  assert.deepEqual(state.land.Durotriges.units.xw,[5,0])
  assert.equal(dice.length,3)
  validatePosition(state)
})

test('Reinforce computes one roll per origin, stops at D6 minus two, and keeps loaded pieces',() => {
  const state = opening(7)
  state.pools.notYet = 14
  state.land.Dobunni.units.com = [1,1]
  const dice = []
  const roll = makeRoller(state,dice,[4])
  runCommandFeat(state,{faction:'c',command:'Battle',feat:'Reinforce',battleSpaces:['Atrebates'],rows:[
    {space:'Dobunni',mode:'move',destination:'Atrebates',mil:2,com:1,formation:'Atrebates com=1:1 mil=2'},
    {space:'Atrebates',mode:'muster',mil:2},
  ]},roll)
  assert.deepEqual(state.land.Dobunni.units.mil,[1,0])
  assert.deepEqual(state.land.Atrebates.units.mil,[4,0])
  assert.deepEqual(state.land.Atrebates.units.com,[1,1])
  assert.equal(state.tracks.blue,21)
  assert.deepEqual(dice.map(row => row.value),[4])
  validatePosition(state)
})

test('Reinforce prevents chaining freshly arriving groups and honors St Germanus bonus',() => {
  const state = opening(7)
  const out = runCommandFeat(state,{faction:'c',command:'Battle',feat:'Reinforce',
    options:{free:true,allowFeat:true,reinforceBonus:4},battleSpaces:['Atrebates','Durotriges'],rows:[
      {space:'Dobunni',mode:'move',destination:'Atrebates',mil:2},
      {space:'Atrebates',mode:'move',destination:'Durotriges',mil:1},
    ],
  },() => 1)
  assert.match(out,/reinforced with 2/)
  assert.deepEqual(state.land.Dobunni.units.mil,[0,0])
  assert.deepEqual(state.land.Atrebates.units.mil,[2,0])
  assert.deepEqual(state.land.Durotriges.units.mil,[2,0])
  assert.equal(state.tracks.blue,25)
  validatePosition(state)
})

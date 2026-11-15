export const VERSION = '0.3.3'
export const SCHEMA = 1
export const EDITION = 'GMT Living Rules · November 2023'
export const SCENARIO = 'Barbarian Conspiracy'
export const DIFFICULTIES = ['Introductory','Easy','Standard','Difficult']
export const SOLO_SEATS = { c:['c'], d:['d'], x:['x'], s:['s'], britons:['d','c'], barbarians:['x','s'] }
export const PIVOTAL = { d:75, c:76, x:74, s:73 }
export const FACTIONS = ['d', 'c', 'x', 's']
export const NAMES = { d: 'Dux', c: 'Civitates', x: 'Saxons', s: 'Scotti', b: 'Britons' }
export const TRACKS = { blue: 'Briton Resources', red: 'Dux Resources', x: 'Saxon Renown', s: 'Scotti Renown', prestige: 'Prestige', wealth: 'Wealth', refugees: 'Refugees', dalRiada: 'Scotti Settlements on Dal Riada', niall: 'Raiders in Niall’s box' }
export const STATUS = {
  rm: 'Roman Rule · Military Dominance', rc: 'Roman Rule · Civilian Dominance',
  am: 'Autonomy · Military Dominance', ac: 'Autonomy · Civilian Dominance', f: 'Fragmentation',
}
export const SEAS = {
  brit: 'Oceanus Britannicus', germ: 'Oceanus Germanicus',
  hib: 'Oceanus Hibernicus', sept: 'Oceanus Septentrionalis',
}
export const PIECES = {
  cav: 'Cavalry', mil: 'Militia', com: 'Comitates', xw: 'Saxon Warbands', sw: 'Scotti Warbands',
  xr: 'Saxon Raiders', sr: 'Scotti Raiders', fort: 'Fort', town: 'Town', hill: 'Hillfort',
  xs: 'Saxon Settlement', ss: 'Scotti Settlement',
}
export const STOCK = { cav: 20, mil: 30, com: 15, xw: 25, sw: 12, xr: 25, sr: 30, fort: 10, town: 15, hill: 15, xs: 12, ss: 6 }
export const GROUPS = [
  ['cav', 'd', 'cav'], ['mil', 'c', 'mil'], ['com', 'c', 'com'],
  ['xw', 'x', 'xw'], ['sw', 's', 'sw'], ['xr', 'x', 'xr'], ['sr', 's', 'sr'],
  ['dxw', 'd', 'xw'], ['dsw', 'd', 'sw'], ['cxw', 'c', 'xw'], ['csw', 'c', 'sw'],
]
export const GROUP = Object.fromEntries(GROUPS.map(([key, owner, piece]) => [key, { owner, piece }]))
export const POOLS = { casualties: 'Cavalry Casualties', out: 'Cavalry Out of Play', notYet: 'Comitates Not Yet in Play' }

// Board sites and links use the final board and Playbook gazetteer, pp. 68–69.
const regionRows = [
  ['Dumnonii','Hills',1,2,1,0,'Isca Dumnoniorum:T:town|Tintagel:H','Durotriges','hib brit',182,620],
  ['Durotriges','Clear',2,4,1,0,'Aquae Sulis:T:town|South Cadbury:H','Dumnonii Dobunni Atrebates','hib brit',271,564],
  ['Atrebates','Clear',3,6,1,1,'Venta Belgarum:T:fort|Calleva Atrebatum:T:town','Dobunni Catuvellauni Londinium Cantiaci Regni Durotriges','brit',366,565],
  ['Regni','Clear',2,4,1,1,'Anderida:H:fort|Noviomagus:T:town','Atrebates Cantiaci','brit',450,579],
  ['Cantiaci','Fens',2,4,1,1,'Rutupiae:H:fort|Durovernum:T:town','Londinium Regni Atrebates','brit germ',526,548],
  ['Londinium','City',2,4,1,0,'Londinium:T:town','Catuvellauni Trinovantes Cantiaci Atrebates','germ',472,500],
  ['Trinovantes','Fens',2,4,1,1,'Walton Castle:H:fort|Camulodunum:T:town','Iceni Londinium Catuvellauni','germ',541,450],
  ['Iceni','Fens',2,4,1,0,'Venta Icenorum:H:hill|Branodunum:H','Corieltauvi Trinovantes Catuvellauni','germ',549,381],
  ['Catuvellauni','Clear',3,6,2,0,'Verulamium:T:town|Durocobrivis:T','Corieltauvi Iceni Trinovantes Londinium Atrebates Dobunni','',433,442],
  ['Dobunni','Clear',2,4,2,0,'Corinium:T:town|Glevum:T','Silures Cornovii Corieltauvi Catuvellauni Atrebates Durotriges','',337,458],
  ['Cornovii','Clear',2,4,1,0,'Viroconium:T:town|Old Oswestry:H','Deceangli Brigantes Corieltauvi Dobunni Silures Demetae Ordovices','',279,396],
  ['Corieltauvi','Fens',2,4,1,1,'Lindum:T:fort|Ratae:T:town','Parisi Iceni Catuvellauni Dobunni Cornovii Brigantes','germ',471,338],
  ['Silures','Hills',1,2,0,2,'Dinas Powys:H:fort|Isca Silurum:T:town','Demetae Cornovii Dobunni','hib',240,486],
  ['Demetae','Hills',1,2,1,0,'Moridunum:H:hill|Gateholm:H','Ordovices Cornovii Silures','hib',148,465],
  ['Ordovices','Hills',1,2,1,0,'Segontium:H:hill|Dinas Emrys:H','Deceangli Cornovii Demetae','hib',169,374],
  ['Deceangli','Clear',2,4,0,2,'Deva:T:fort|Dinorben:H','Carvetii Brigantes Cornovii Ordovices','hib',264,329],
  ['Brigantes','Hills',1,2,2,0,'Barwick:H:hill|Mam Tor:H','Carvetii Textoverdi Eboracum Parisi Corieltauvi Cornovii Deceangli','',363,321],
  ['Parisi','Clear',2,4,1,0,'Petuaria:H:hill|Derventio:H','Textoverdi Eboracum Corieltauvi Brigantes','sept germ',477,268],
  ['Eboracum','City',1,2,0,5,'Eboracum:T:fort','Textoverdi Parisi Brigantes','',396,239],
  ['Textoverdi','Hills',2,4,0,3,'Pons Aelius:H:fort|Cataractonium:T:town','Carvetii Votadini Parisi Eboracum Brigantes','sept',353,184],
  ['Carvetii','Hills',1,2,0,3,'Uxellodunum:H:fort|Luguvalium:T','Novantae Votadini Textoverdi Brigantes Deceangli','hib',251,206],
  ['Votadini','Hills',2,4,4,0,'Yeavering:H:hill|Traprain Law:H:hill','Novantae Carvetii Textoverdi','sept',340,104],
  ['Novantae','Hills',1,2,1,0,'Mote of Mark:H:hill|Alclud:H','Votadini Carvetii','hib',214,120],
]
export const REGIONS = regionRows.map(([name, terrain, printed, prosperity, militia, cavalry, siteList, adj, seas, x, y]) => ({
  name, terrain, printed, prosperity, militia, cavalry, x, y, adj: adj.split(' '), seas: seas ? seas.split(' ') : [],
  sites: siteList.split('|').map(site => {
    const [name, type, initial = null] = site.split(':')
    return { name, type, initial }
  }),
}))
export const BY_NAME = Object.fromEntries(REGIONS.map(region => [region.name, region]))
export const ROADS = [
  ['Carvetii','Textoverdi'], ['Textoverdi','Eboracum'], ['Eboracum','Parisi'], ['Parisi','Corieltauvi'],
  ['Corieltauvi','Catuvellauni'], ['Corieltauvi','Dobunni'], ['Deceangli','Cornovii'], ['Cornovii','Dobunni'],
  ['Silures','Dobunni'], ['Catuvellauni','Dobunni'], ['Dobunni','Durotriges'], ['Durotriges','Atrebates'],
  ['Atrebates','Londinium'], ['Catuvellauni','Londinium'], ['Trinovantes','Londinium'], ['Londinium','Cantiaci'],
]
export const RANDOM_SPACES = [
  ['Votadini','Textoverdi','Eboracum','Carvetii','Novantae',null],
  ['Cantiaci','Londinium','Atrebates','Regni','Durotriges','Dumnonii'],
  ['Catuvellauni','Trinovantes','Iceni','Corieltauvi','Parisi','Brigantes'],
  ['Deceangli','Cornovii','Dobunni','Ordovices','Demetae','Silures'],
]
export const EPOCHS = {
  77: 'Magnus Maximus', 78: 'Constantine III', 79: 'Rescript of Honorius', 80: 'Cutting the Ties',
  81: 'Tears of Epona', 82: 'Rhiotamus', 83: 'Pendragon',
}
export const COMMANDS = {
  c: ['Muster','March','Trade','Battle'], d: ['Train','March','Intercept','Battle'],
  x: ['Raid','Return','March','Battle'], s: ['Raid','Return','March','Battle'],
}
export const FEATS = {
  c: { Muster: ['Rule','Invite'], March: ['Rule','Invite','Pillage'], Trade: ['Rule','Invite'], Battle: ['Reinforce','Pillage'] },
  d: { Train: ['Build','Invite','Requisition'], March: ['Build','Invite','Requisition'], Intercept: ['Invite','Retaliate'], Battle: ['Retaliate','Requisition'] },
  x: { Raid: ['Surprise','Ravage'], Return: ['Settle'], March: ['Settle'], Battle: ['Surprise','Ravage','Shield Wall'] },
  s: { Raid: ['Surprise','Ransom'], Return: ['Settle','Entreat'], March: ['Settle'], Battle: ['Entreat','Surprise','Ransom'] },
}
export const EPOCH_PHASES = ['Annona','Imperium','Victory','Epoch Event','Revenue','Dux Upkeep','Civitates Upkeep','Saxon Upkeep','Scotti Upkeep','Recovery & Reset']

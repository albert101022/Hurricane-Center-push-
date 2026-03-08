const express = require(‘express’);
const webpush = require(‘web-push’);
const cron    = require(‘node-cron’);
const cors    = require(‘cors’);
const fs      = require(‘fs’);
const https   = require(‘https’);

const app  = express();
const PORT = process.env.PORT || 3000;

webpush.setVapidDetails(
‘mailto:albertvega49@gmail.com’,
‘BM6zOcQ7LF-RooKIJZEzMpfWYeR8x-bm2ABB9RkwhaEnAyf3sWgeZt46kbaGDLqq84DfuV_p-fNbnxVBzdZ8VT8’,
‘hx2G70GVMm5dUJQhiIp7AEg8O09ZFPjbJH1sydCvLK0’
);
console.log(‘✅ VAPID OK’);

// ── SUBSCRIPCIONES ────────────────────────────────────────────────────────────
const DB = ‘./subscriptions.json’;
let subs = [];
function loadSubs(){
try { if(fs.existsSync(DB)) subs = JSON.parse(fs.readFileSync(DB,‘utf8’)); } catch(e){ subs=[]; }
console.log(‘📋 ‘+subs.length+’ subscripciones’);
}
function saveSubs(){
try { fs.writeFileSync(DB, JSON.stringify(subs)); } catch(e){}
}
loadSubs();

app.use(cors({ origin:’*’ }));
app.use(express.json());

// ── PUSH ──────────────────────────────────────────────────────────────────────
async function sendPushToAll({ title, body, score, level, tag, url }){
if(subs.length===0) return 0;
const payload = JSON.stringify({
title, body, score, level, tag,
url: url || ‘/?page=home’
});
let sent = 0;
const toRemove = [];
await Promise.all(subs.map(async sub => {
try { await webpush.sendNotification(sub, payload); sent++; }
catch(e){ if(e.statusCode===410||e.statusCode===404) toRemove.push(sub.endpoint); }
}));
if(toRemove.length){ subs=subs.filter(s=>!toRemove.includes(s.endpoint)); saveSubs(); }
console.log(‘📤 ‘+sent+’/’+subs.length+’ enviados — ’+tag);
return sent;
}

// ── HTTP HELPER ───────────────────────────────────────────────────────────────
function fetchURL(url){
return new Promise((resolve,reject) => {
https.get(url,{ headers:{‘User-Agent’:‘HurricanePR/1.0’} }, res => {
let data=’’;
res.on(‘data’,chunk=>data+=chunk);
res.on(‘end’,()=>{ try{ resolve(JSON.parse(data)); }catch(e){ resolve(null); } });
}).on(‘error’,reject);
});
}

// ── HELPERS SÍSMICOS ──────────────────────────────────────────────────────────
function magLabel(mag){
if(mag>=7.0) return ‘GRAN TERREMOTO’;
if(mag>=6.0) return ‘FUERTE’;
if(mag>=5.0) return ‘MODERADO-FUERTE’;
if(mag>=4.0) return ‘MODERADO’;
if(mag>=3.0) return ‘LEVE’;
return ‘MICRO’;
}

function magEmoji(mag){
if(mag>=6.0) return ‘🚨’;
if(mag>=5.0) return ‘⚠️’;
if(mag>=4.0) return ‘🔶’;
return ‘🟡’;
}

// Traducir nombres de lugares comunes en PR
function translatePlace(place){
if(!place) return ‘Puerto Rico’;
return place
.replace(‘Puerto Rico region’,‘Región de Puerto Rico’)
.replace(‘Puerto Rico’,‘Puerto Rico’)
.replace(‘north of’,‘al norte de’)
.replace(‘south of’,‘al sur de’)
.replace(‘east of’,‘al este de’)
.replace(‘west of’,‘al oeste de’)
.replace(‘northwest of’,‘al noroeste de’)
.replace(‘northeast of’,‘al noreste de’)
.replace(‘southwest of’,‘al suroeste de’)
.replace(‘southeast of’,‘al sureste de’)
.replace(‘Virgin Islands region’,‘Región de Islas Vírgenes’)
.replace(‘Mona Passage’,‘Pasaje de la Mona’)
.replace(‘Dominican Republic’,‘República Dominicana’);
}

// ── ESTADO SÍSMICO ────────────────────────────────────────────────────────────
const SISMO_DB = ‘./sismo-state.json’;
let sismoState = {
lastNotifiedIds: [],   // IDs de sismos ya notificados (evita duplicados)
lastCheckTime:   null
};
function loadSismoState(){
try{ if(fs.existsSync(SISMO_DB)) sismoState=JSON.parse(fs.readFileSync(SISMO_DB,‘utf8’)); }catch(e){}
console.log(’🔵 Sismos conocidos: ’+( sismoState.lastNotifiedIds||[]).length);
}
function saveSismoState(){
try{ fs.writeFileSync(SISMO_DB,JSON.stringify(sismoState)); }catch(e){}
}
loadSismoState();

// ── CHECK SISMOS ──────────────────────────────────────────────────────────────
async function checkSismos(){
global.lastSismoCheck = new Date().toISOString();
console.log(’\n🌍 Sismo check ’+global.lastSismoCheck);
try{
// USGS — sismos M2.5+ en Puerto Rico, últimas 2 horas
const url = ‘https://earthquake.usgs.gov/fdsnws/event/1.1/query’
+ ‘?format=geojson’
+ ‘&minmagnitude=2.5’
+ ‘&latitude=18.2&longitude=-66.5&maxradiuskm=300’
+ ‘&orderby=time’
+ ‘&limit=20’
+ ‘&starttime=’ + new Date(Date.now() - 2*3600*1000).toISOString();

```
const data = await fetchURL(url);
if(!data || !data.features){ console.log('⚠️ Sin respuesta USGS'); return; }

const quakes = data.features;
console.log('📍 '+quakes.length+' sismos recientes encontrados');

if(!sismoState.lastNotifiedIds) sismoState.lastNotifiedIds = [];

let newCount = 0;
for(const q of quakes){
  const id  = q.id;
  const p   = q.properties;
  const mag = p.mag || 0;

  // Solo notificar M3.5+
  if(mag < 3.5) continue;

  // Ya notificado antes
  if(sismoState.lastNotifiedIds.includes(id)) continue;

  // Notificar
  const place    = translatePlace(p.place || 'Puerto Rico');
  const depth    = q.geometry && q.geometry.coordinates ? Math.round(q.geometry.coordinates[2]) : '?';
  const emoji    = magEmoji(mag);
  const label    = magLabel(mag);
  const timeAgo  = Math.round((Date.now() - p.time) / 60000);
  const agoStr   = timeAgo < 60 ? 'hace '+timeAgo+' min' : 'hace '+Math.floor(timeAgo/60)+'h '+( timeAgo%60)+'m';
  const tsunami  = p.tsunami === 1 ? ' · ⚠️ Evalúa tsunami' : '';

  await sendPushToAll({
    title: emoji+' Sismo M'+mag.toFixed(1)+' — '+label,
    body:  place+' · '+agoStr+' · Prof. '+depth+' km'+tsunami,
    level: label,
    tag:   'sismo-'+id,
    url:   '/?page=sismos'
  });

  sismoState.lastNotifiedIds.push(id);
  newCount++;

  // Si es M5+, segunda notificación más urgente
  if(mag >= 5.0){
    await sendPushToAll({
      title: '🚨 SISMO FUERTE M'+mag.toFixed(1)+' — Puerto Rico',
      body:  'Verifica estructuras. '+place+'. Prof. '+depth+' km.'+tsunami,
      level: 'FUERTE',
      tag:   'sismo-strong-'+id,
      url:   '/?page=sismos'
    });
  }
}

// Limpiar IDs viejos — guardar solo los últimos 200
if(sismoState.lastNotifiedIds.length > 200){
  sismoState.lastNotifiedIds = sismoState.lastNotifiedIds.slice(-200);
}

global.lastSismoCount = quakes.length;
global.lastSismoNew   = newCount;
sismoState.lastCheckTime = global.lastSismoCheck;
saveSismoState();
console.log('✅ Sismos OK — '+newCount+' nuevas notificaciones enviadas');
```

}catch(e){ console.error(‘❌ checkSismos:’,e.message); }
}

// ── ESTADO NHC ────────────────────────────────────────────────────────────────
const NHC_DB = ‘./nhc-state.json’;
let nhcKnown = { stormIds:[], stormData:{}, nwsAlertKeys:[] };
function loadNHCState(){
try{ if(fs.existsSync(NHC_DB)) nhcKnown=JSON.parse(fs.readFileSync(NHC_DB,‘utf8’)); }catch(e){}
}
function saveNHCState(){
try{ fs.writeFileSync(NHC_DB,JSON.stringify(nhcKnown)); }catch(e){}
}
loadNHCState();

function windToCategory(kt){
const mph=Math.round(kt*1.15078);
if(mph>=157)return 5; if(mph>=130)return 4; if(mph>=111)return 3;
if(mph>=96)return 2;  if(mph>=74)return 1;  return 0;
}
function catLabel(cat){ return cat>=1?’Categoria ’+cat:‘Tormenta Tropical’; }

const TROPICAL_EVENTS=[
‘Hurricane Warning’,‘Hurricane Watch’,‘Tropical Storm Warning’,‘Tropical Storm Watch’,
‘Storm Surge Warning’,‘Storm Surge Watch’,‘Extreme Wind Warning’,‘Hurricane Local Statement’
];

// ── CHECK NHC ─────────────────────────────────────────────────────────────────
async function checkNHC(){
global.lastNHCCheck=new Date().toISOString();
console.log(’\n🌀 NHC check ’+global.lastNHCCheck);
try{
const nhcData=await fetchURL(‘https://www.nhc.noaa.gov/CurrentStorms.json’);
if(!nhcData) throw new Error(‘NHC no respondio’);
const storms=nhcData.activeStorms||[];
const stormIds=storms.map(s=>s.id);

```
for(const storm of storms){
  if(!nhcKnown.stormIds.includes(storm.id)){
    const cat=windToCategory(storm.intensity||0);
    const mph=Math.round((storm.intensity||0)*1.15078);
    const name=(storm.name||storm.id||'SISTEMA').toUpperCase();
    if(parseFloat(storm.centerLocLongitude||0)<-110) continue;
    await sendPushToAll({
      title:(cat>=1?'🌀':'🌧️')+' '+catLabel(cat)+' '+name+' — Nuevo sistema',
      body:'Vientos de '+mph+' mph. Monitorea la trayectoria.',
      level:catLabel(cat), tag:'storm-new-'+storm.id,
      url:'/?page=huracan'
    });
  }
}

for(const storm of storms){
  const prev=nhcKnown.stormData[storm.id];
  const cat=windToCategory(storm.intensity||0);
  const mph=Math.round((storm.intensity||0)*1.15078);
  const name=(storm.name||storm.id).toUpperCase();
  if(prev&&cat>prev.cat&&cat>=1){
    await sendPushToAll({
      title:'⚠️ '+name+' intensifica a '+catLabel(cat),
      body:'Vientos ahora '+mph+' mph. Subio de '+catLabel(prev.cat)+'.',
      level:catLabel(cat), tag:'storm-intensity-'+storm.id+'-'+cat,
      url:'/?page=huracan'
    });
  }
  nhcKnown.stormData[storm.id]={ cat, wind:mph, name };
}

for(const oldId of nhcKnown.stormIds){
  if(!stormIds.includes(oldId)){
    const prev=nhcKnown.stormData[oldId]||{};
    await sendPushToAll({
      title:'✅ '+(prev.name||'Sistema')+' se ha disipado',
      body:'Puerto Rico fuera de peligro inmediato.',
      level:'INFO', tag:'storm-dissipated-'+oldId,
      url:'/?page=huracan'
    });
  }
}

nhcKnown.stormIds=stormIds;
global.activeStorms=stormIds.length;

const nwsData=await fetchURL('https://api.weather.gov/alerts/active?area=PR&status=actual');
if(nwsData&&nwsData.features){
  for(const f of nwsData.features){
    const p=f.properties||{};
    const event=p.event||'';
    if(!TROPICAL_EVENTS.some(te=>event.toLowerCase().includes(te.toLowerCase()))) continue;
    const alertKey=event+'|'+(p.sent||'').slice(0,16);
    if(!nhcKnown.nwsAlertKeys.includes(alertKey)){
      nhcKnown.nwsAlertKeys.push(alertKey);
      if(nhcKnown.nwsAlertKeys.length>50) nhcKnown.nwsAlertKeys.shift();
      await sendPushToAll({
        title:'🚨 '+event+' — Puerto Rico',
        body:p.headline?p.headline.slice(0,120):'Nueva alerta NWS San Juan.',
        level:'ALERTA', tag:'nws-'+alertKey.replace(/[|: ]/g,'-'),
        url:'/?page=alertas'
      });
    }
  }
}
saveNHCState();
console.log('✅ NHC OK — '+stormIds.length+' sistemas');
```

}catch(e){ console.error(‘❌ checkNHC:’,e.message); }
}

// ── CHECK IRM ─────────────────────────────────────────────────────────────────
let lastNotifiedScore=0;
async function runCheck(){
global.lastCheck=new Date().toISOString();
console.log(’\n🔍 IRM check ‘+global.lastCheck);
try{
const alerts=await fetchURL(‘https://api.weather.gov/alerts/active?area=PR’);
const activeAlerts=alerts&&alerts.features?alerts.features.length:0;
const wx=await fetchURL(
‘https://api.open-meteo.com/v1/forecast?latitude=18.466&longitude=-66.106’+
‘&daily=precipitation_probability_max,windspeed_10m_max,precipitation_sum,weathercode’+
‘&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=America%2FPuerto_Rico&forecast_days=1’
);
if(!wx||!wx.daily){ console.log(‘⚠️ Sin datos Open-Meteo’); return; }
const d=wx.daily;
const precip=d.precipitation_probability_max?d.precipitation_probability_max[0]:0;
const wind=d.windspeed_10m_max?d.windspeed_10m_max[0]:0;
const precIn=d.precipitation_sum?d.precipitation_sum[0]/25.4:0;
const wcode=d.weathercode?d.weathercode[0]:0;
let score=0;
score+=Math.min(30,precip*0.30);
score+=Math.min(25,wind>25?(wind-25)*1.5:0);
score+=precIn>1?20:precIn>0.5?12:precIn>0.25?6:0;
score+=wcode>=95?15:wcode>=80?10:wcode>=61?6:0;
score+=activeAlerts*8;
score=Math.min(100,Math.round(score));
global.lastScore=score;
console.log(‘📊 Score:’+score+’ Viento:’+wind+‘mph Alertas:’+activeAlerts);
if(score>=70&&lastNotifiedScore<70){
const level=score>=85?‘EXTREMO’:‘CRITICO’;
await sendPushToAll({
title:‘🚨 Hurricane Center PR — ‘+level,
body:‘Indice IRM: ‘+score+’/100.’,
score, level, tag:‘irm-’+level,
url:’/?page=home’
});
lastNotifiedScore=score;
} else if(score<50&&lastNotifiedScore>=70){ lastNotifiedScore=0; }
if(activeAlerts>0&&activeAlerts>(global.lastAlerts||0)){
await sendPushToAll({
title:‘⚠️ Alerta NWS — Puerto Rico’,
body:activeAlerts+’ alerta(s) activa(s).’,
score, level:‘ALERTA’, tag:‘nws-irm’,
url:’/?page=alertas’
});
}
global.lastAlerts=activeAlerts;
}catch(e){ console.error(‘❌ runCheck:’,e.message); }
}

// ── CRONS ─────────────────────────────────────────────────────────────────────
cron.schedule(’*/15 * * * *’, runCheck);          // IRM  — cada 15 min
cron.schedule(’*/5  * * * *’, checkNHC);          // NHC  — cada 5 min
cron.schedule(’*/5  * * * *’, checkSismos);       // Sismos — cada 5 min

// ── RUTAS ─────────────────────────────────────────────────────────────────────
app.get(’/’, (req,res) => res.json({
status:‘ok’,
subs:subs.length,
vapidPublic:‘BM6zOcQ7LF-RooKIJZEzMpfWYeR8x-bm2ABB9RkwhaEnAyf3sWgeZt46kbaGDLqq84DfuV_p-fNbnxVBzdZ8VT8’,
lastCheck:       global.lastCheck      || ‘nunca’,
lastNHCCheck:    global.lastNHCCheck   || ‘nunca’,
lastSismoCheck:  global.lastSismoCheck || ‘nunca’,
lastScore:       global.lastScore      || 0,
activeStorms:    global.activeStorms   || 0,
lastSismoCount:  global.lastSismoCount || 0,
lastSismoNew:    global.lastSismoNew   || 0
}));

app.get(’/vapid-public-key’, (req,res) => res.json({
key:‘BM6zOcQ7LF-RooKIJZEzMpfWYeR8x-bm2ABB9RkwhaEnAyf3sWgeZt46kbaGDLqq84DfuV_p-fNbnxVBzdZ8VT8’
}));

app.post(’/subscribe’, (req,res) => {
const sub=req.body;
if(!sub||!sub.endpoint) return res.status(400).json({ error:‘Invalido’ });
if(!subs.find(s=>s.endpoint===sub.endpoint)){ subs.push(sub); saveSubs(); }
console.log(‘✅ Sub total:’+subs.length);
res.json({ ok:true, total:subs.length });
});

app.post(’/unsubscribe’, (req,res) => {
subs=subs.filter(s=>s.endpoint!==req.body.endpoint);
saveSubs();
res.json({ ok:true });
});

app.post(’/test-push’, async (req,res) => {
if(req.body.secret!==‘Dinoalbert-1022’) return res.status(401).json({ error:‘No autorizado’ });
const sent=await sendPushToAll({
title:‘🔔 Hurricane Center PR — PRUEBA’,
body:‘Notificaciones funcionando correctamente.’,
score:0, level:‘PRUEBA’, tag:‘test’,
url:’/?page=home’
});
res.json({ ok:true, sent });
});

app.post(’/test-sismo’, async (req,res) => {
if(req.body.secret!==‘Dinoalbert-1022’) return res.status(401).json({ error:‘No autorizado’ });
const mag = req.body.mag || 4.2;
const sent=await sendPushToAll({
title: magEmoji(mag)+’ Sismo M’+mag.toFixed(1)+’ — ’+magLabel(mag),
body:  ‘Sur de Puerto Rico · hace 2 min · Prof. 10 km’,
level: magLabel(mag), tag:‘test-sismo’,
url:   ‘/?page=sismos’
});
res.json({ ok:true, sent });
});

app.post(’/check-nhc’, async (req,res) => {
if(req.body.secret!==‘Dinoalbert-1022’) return res.status(401).json({ error:‘No autorizado’ });
await checkNHC();
res.json({ ok:true, checked:global.lastNHCCheck, activeStorms:global.activeStorms||0 });
});

app.post(’/check-sismos’, async (req,res) => {
if(req.body.secret!==‘Dinoalbert-1022’) return res.status(401).json({ error:‘No autorizado’ });
await checkSismos();
res.json({ ok:true, checked:global.lastSismoCheck, new:global.lastSismoNew||0 });
});

app.get(’/status’, (req,res) => {
if(req.query.secret!==‘Dinoalbert-1022’) return res.status(403).json({ error:‘No autorizado’ });
res.json({
subs:            subs.length,
lastCheck:       global.lastCheck,
lastNHCCheck:    global.lastNHCCheck,
lastSismoCheck:  global.lastSismoCheck,
lastScore:       global.lastScore,
activeStorms:    global.activeStorms   || 0,
lastSismoCount:  global.lastSismoCount || 0,
lastSismoNew:    global.lastSismoNew   || 0,
knownStorms:     nhcKnown.stormIds,
nwsAlertsSeen:   nhcKnown.nwsAlertKeys.length,
sismosSeen:      (sismoState.lastNotifiedIds||[]).length
});
});

// ── INICIO ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
console.log(’\n🌀 Hurricane Center PR — Push Server’);
console.log(’🚀 Puerto: ’+PORT);
console.log(’📋 Subs: ’+subs.length);
console.log(‘⏰ IRM:15min NHC:5min Sismos:5min\n’);
setTimeout(runCheck,   3000);
setTimeout(checkNHC,   6000);
setTimeout(checkSismos,9000);
});

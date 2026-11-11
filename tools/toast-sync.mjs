// Pulls Bugsy's live menu prices + sold-out items from Toast and writes toast-menu.json.
// Needs repo secrets: TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, TOAST_RESTAURANT_GUID (from Toast Standard API Access).
import fs from 'node:fs';
const {TOAST_CLIENT_ID:id,TOAST_CLIENT_SECRET:secret,TOAST_RESTAURANT_GUID:guid}=process.env;
const API=process.env.TOAST_API_HOST||'https://ws-api.toasttab.com';
if(!id||!secret||!guid){console.log('Toast keys not set yet — skipping.');process.exit(0)}
const auth=await (await fetch(API+'/authentication/v1/authentication/login',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({clientId:id,clientSecret:secret,userAccessType:'TOAST_MACHINE_CLIENT'})})).json();
const token=auth?.token?.accessToken;if(!token)throw new Error('Toast login failed: '+JSON.stringify(auth));
const H={Authorization:'Bearer '+token,'Toast-Restaurant-External-ID':guid};
const menus=await (await fetch(API+'/menus/v2/menus',{headers:H})).json();
const prices={};
const walk=g=>{(g.menuItems||[]).forEach(i=>{if(i.name&&i.price!=null)prices[i.name.trim().toLowerCase()]=i.price});(g.menuGroups||[]).forEach(walk)};
(menus.menus||[]).forEach(m=>(m.menuGroups||[]).forEach(walk));
let outOfStock=[];
try{const st=await (await fetch(API+'/stock/v1/inventory',{headers:H})).json();
 const byGuid={};const w2=g=>{(g.menuItems||[]).forEach(i=>byGuid[i.guid]=i.name);(g.menuGroups||[]).forEach(w2)};(menus.menus||[]).forEach(m=>(m.menuGroups||[]).forEach(w2));
 outOfStock=(Array.isArray(st)?st:[]).filter(s=>s.status==='OUT_OF_STOCK'&&byGuid[s.guid]).map(s=>byGuid[s.guid].trim().toLowerCase())}catch(e){}
fs.writeFileSync('toast-menu.json',JSON.stringify({updated:new Date().toISOString(),prices,outOfStock},null,1));
console.log('Synced',Object.keys(prices).length,'items,',outOfStock.length,'sold out');

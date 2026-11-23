import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Users/andre/AppData/Local/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--ignore-gpu-blocklist'] });
for (const [w,h] of [[800,600],[1280,720],[1920,1080]]) {
  const page = await browser.newPage(); await page.setViewport({width:w,height:h});
  const logs=[]; page.on('console',m=>{ if(m.type()==='error'||m.type()==='warning') logs.push(m.text()); }); page.on('pageerror',e=>logs.push('ERR '+e.message));
  await page.goto('http://localhost:8777/index.html',{waitUntil:'load'}); await page.waitForFunction('window.__ready===true',{timeout:60000}); await new Promise(r=>setTimeout(r,2500));
  const res = await page.evaluate(() => {
    const ids = ['objectives','flight','navwrap','sas','throttle','actions','vehicle','statusbar'];
    const R = ids.map(i => [i, document.getElementById(i).getBoundingClientRect()]);
    const btns = [...document.querySelectorAll('#sas button')].map(b=>['sas:'+b.dataset.sas,b.getBoundingClientRect()]).concat([...document.querySelectorAll('#actbtns button')].map(b=>['act:'+b.dataset.act,b.getBoundingClientRect()]));
    const warp=['warpbox',document.getElementById('warpbox').getBoundingClientRect()];
    const items=[...btns,warp, ['objectives',R[0][1]],['flight',R[1][1]],['vehicle',R[6][1]],['navball',document.getElementById('navball').getBoundingClientRect()],['maneuver',document.getElementById('maneuver').getBoundingClientRect()]];
    const out=[]; const ov=(a,b)=>a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1;
    for (let i=0;i<items.length;i++) for (let j=i+1;j<items.length;j++) { if (items[i][0].split(':')[0]===items[j][0].split(':')[0] && items[i][0].includes(':')) continue; if (ov(items[i][1],items[j][1])) out.push(items[i][0]+' x '+items[j][0]); }
    const off = items.filter(([n,r])=>r.right>innerWidth||r.bottom>innerHeight||r.left<0||r.top<0).map(x=>x[0]);
    return {overlaps:out, offscreen:off};
  });
  console.log(w+'x'+h, JSON.stringify(res), 'errors:', logs.filter(l=>!l.includes('Failed to load')).length);
  await page.screenshot({path:`./hud_${w}x${h}.png`}); await page.close();
}
await browser.close();

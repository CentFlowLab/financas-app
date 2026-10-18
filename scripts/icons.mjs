import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const b = await chromium.launch(); const pg = await b.newPage();
for (const [svg, size, out] of [['icon.svg',192,'icon-192.png'],['icon.svg',512,'icon-512.png'],['icon-maskable.svg',512,'icon-maskable-512.png']]) {
  await pg.setViewportSize({width:size,height:size});
  await pg.setContent(`<body style="margin:0">${readFileSync('public/icons/'+svg,'utf8').replace('<svg ',`<svg width="${size}" height="${size}" `)}</body>`);
  await pg.screenshot({path:'public/icons/'+out, omitBackground:true});
}
await b.close();

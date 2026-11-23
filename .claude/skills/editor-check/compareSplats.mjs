// The splats and the model from the same places, needing viewer.js's window.__splatmeCamera hook; each view's
// difference and how much of it shows through the model. Score the images again with scoreCompare.mjs.
import fs from 'fs';
import path from 'path';
export default async ({page, waitIdle}) => {
    const OUT = process.env.CMP_OUT;
    const canvas = page.locator('canvas').first();
    // The same places on both tabs: round the house (CMP_TARGET, x,y,z in the model's frame), CMP_DIST metres off
    if (!OUT || !process.env.CMP_TARGET) throw new Error('CMP_OUT (a folder) and CMP_TARGET (x,y,z) are needed');
    const [cx, cy, cz] = process.env.CMP_TARGET.split(',').map(Number), span = +process.env.CMP_DIST || 16;
    const views = [];
    for (let k = 0; k < 8; k++){
        const a = k * Math.PI / 4;
        views.push({position: [cx + span * Math.sin(a) * 0.7, cy - span * Math.cos(a) * 0.7, cz + span * 0.7], target: [cx, cy, cz]});
    }
    views.push({position: [cx, cy - 0.001, cz + span * 1.3], target: [cx, cy, cz]});
    const shots = async kind => {
        for (let i = 0; i < views.length; i++){
            await page.evaluate(v => window.__splatmeCamera.goTo(v), views[i]);
            await page.waitForTimeout(kind === 'splats' ? 1200 : 400);
            await page.screenshot({path: path.join(OUT, `${kind}-${i}.png`), clip: await canvas.boundingBox(), timeout: 120000});
        }
        return views.length;
    };
    await waitIdle('the edits shown', Date.now());
    await page.evaluate(() => { window.__splatmeCamera = {}; });
    // The model's tab again (its viewer made anew, with the hook), then the splats'
    await page.getByRole('button', {name: 'Splats'}).click();
    await page.waitForFunction(() => window.__splatmeCamera.frame && window.__splatmeCamera.frame(), null, {timeout: 180000, polling: 200});
    await page.waitForTimeout(4000);
    const n = await shots('splats');
    await page.evaluate(() => { window.__splatmeCamera = {}; });
    await page.getByRole('button', {name: '3D Model'}).click();
    await page.waitForFunction(() => window.__splatmeCamera.frame && window.__splatmeCamera.frame(), null, {timeout: 180000, polling: 200});
    await page.locator('.splatme-editor-repairs button').first().waitFor();
    await page.waitForFunction(() => !document.querySelector('.splatme-editor-repairs button').disabled, null, {timeout: 180000, polling: 50});
    await waitIdle('model shown', Date.now());
    await shots('model');
    // The scores, worked out in the page from the two images of each view
    const read = f => 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, f)).toString('base64');
    const pairs = [];
    for (let i = 0; i < n; i++) pairs.push([read(`splats-${i}.png`), read(`model-${i}.png`)]);
    const scores = await page.evaluate(async pairs => {
        const load = src => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = src; });
        const out = [];
        for (const [a, b] of pairs){
            const [ia, ib] = [await load(a), await load(b)];
            const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
            const g = c.getContext('2d', {willReadFrequently: true});
            g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data;
            g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data;
            let seen = 0, diff = 0, through = 0;
            for (let p = 0; p < da.length; p += 4){
                const ka = da[p] + da[p + 1] + da[p + 2], kb = db[p] + db[p + 1] + db[p + 2];
                if (ka < 30) continue;  // the splats show nothing here (the background)
                seen++;
                diff += (Math.abs(da[p] - db[p]) + Math.abs(da[p + 1] - db[p + 1]) + Math.abs(da[p + 2] - db[p + 2])) / 3;
                if (kb < 15) through++;  // the model shows the background where the splats show something
            }
            out.push({diff: +(diff / seen).toFixed(1), through: +(100 * through / seen).toFixed(2)});
        }
        return out;
    }, pairs);
    scores.forEach((s, i) => console.log('view', i, 'difference', s.diff, 'see-through %', s.through));
    const mean = k => (scores.reduce((t, s) => t + s[k], 0) / scores.length).toFixed(2);
    console.log('MEAN difference', mean('diff'), 'see-through %', mean('through'));
};

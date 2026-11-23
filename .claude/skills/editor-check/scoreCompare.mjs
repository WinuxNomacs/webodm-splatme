// Scores of the splats' and the model's images of each view (from compareSplats.mjs), from the repo root:
// node .claude/skills/editor-check/scoreCompare.mjs <dir> [<dir> ...]
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
const REPO = process.cwd();
const { chromium } = await import(pathToFileURL(path.join(REPO, 'node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch();
const page = await browser.newPage();
for (const dir of process.argv.slice(2)){
    const views = fs.readdirSync(dir).filter(f => /^model-\d+\.png$/.test(f)).map(f => +f.match(/\d+/)[0]).sort((a, b) => a - b);
    const rows = [];
    for (const i of views){
        const read = f => 'data:image/png;base64,' + fs.readFileSync(path.join(dir, f)).toString('base64');
        rows.push(await page.evaluate(async ([a, b]) => {
            const load = src => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = src; });
            const [ia, ib] = [await load(a), await load(b)];
            const w = ia.width, h = ia.height, c = document.createElement('canvas'); c.width = w; c.height = h;
            const g = c.getContext('2d', {willReadFrequently: true});
            g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, w, h).data;
            g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, w, h).data;
            const model = new Uint8Array(w * h), splat = new Uint8Array(w * h);
            for (let p = 0; p < w * h; p++){
                model[p] = db[4 * p] + db[4 * p + 1] + db[4 * p + 2] >= 15 ? 1 : 0;
                splat[p] = da[4 * p] + da[4 * p + 1] + da[4 * p + 2] >= 30 ? 1 : 0;
            }
            // A hole: a pixel the model leaves empty with the model's surface within R pixels on all four sides
            const R = 40, enclosed = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => {
                for (let k = 1; k <= R; k++){ const X = x + dx * k, Y = y + dy * k; if (X < 0 || Y < 0 || X >= w || Y >= h) return false; if (model[Y * w + X]) return true; }
                return false;
            });
            let both = 0, diff = 0, holes = 0, area = 0;
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
                const p = y * w + x;
                if (model[p]) area++;
                if (model[p] && splat[p]){ both++; diff += (Math.abs(da[4 * p] - db[4 * p]) + Math.abs(da[4 * p + 1] - db[4 * p + 1]) + Math.abs(da[4 * p + 2] - db[4 * p + 2])) / 3; }
                else if (!model[p] && splat[p] && enclosed(x, y)){ holes++; area++; }
            }
            return {diff: +(diff / both).toFixed(1), holes: +(100 * holes / area).toFixed(2)};
        }, [read(`splats-${i}.png`), read(`model-${i}.png`)]));
    }
    const mean = k => (rows.reduce((t, r) => t + r[k], 0) / rows.length).toFixed(2);
    console.log(path.basename(dir).padEnd(10), 'difference', rows.map(r => r.diff).join(' '), '| mean', mean('diff'), '|| holes %', rows.map(r => r.holes).join(' '), '| mean', mean('holes'));
}
await browser.close();

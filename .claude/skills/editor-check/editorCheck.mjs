// The editor-check skill's runner: node editorCheck.mjs <scenario.mjs> <out dir> [task id] [model edits JSON]
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const { chromium } = await import(pathToFileURL(path.join(REPO, 'node_modules/playwright/index.mjs')).href);
const [scenarioPath, OUT, TASK = 'b3a01458-ca71-4988-841f-83d0a22814e7', EDITS] = process.argv.slice(2);
const BASE = 'http://localhost:8008';
const memory = path.join(process.env.HOME, '.claude/projects/-home-winux-gitrepos-web-webodm-splatme/memory/dev-stack-logins.md');
const found = fs.readFileSync(memory, 'utf8').match(/Superuser: `([^`]+)` \/ `([^`]+)`/);
if (!found) throw new Error('No dev login in memory: ask the user for one.');
const [, user, pass] = found;
const scenario = (await import(pathToFileURL(path.resolve(scenarioPath)).href)).default;

const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist']});
const [WIDTH, HEIGHT] = (process.env.VIEWPORT || '1500x900').split('x').map(Number);  // 1280x800 for the docs' screenshots
const page = await (await browser.newContext({viewport: {width: WIDTH, height: HEIGHT}})).newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('console', m => { if (m.type() === 'error' && !/livereload|35729|ERR_CONNECTION_REFUSED/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
// A request to the API as the page makes it (with the session's CSRF token)
const api = (method, url, body) => page.evaluate(async ([method, url, body]) => {
    const csrf = document.cookie.match(/csrftoken=([^;]+)/)[1];
    const r = await fetch(url, {method, headers: {'X-CSRFToken': csrf, 'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
    return {status: r.status, json: await r.json().catch(() => null)};
}, [method, url, body]);
// The line under the view; waiting until it no longer says the edits are being worked out
const footer = () => page.locator('p:has-text("triangles")').first().innerText().catch(() => '');
const waitIdle = async (label, t0) => {
    await page.waitForTimeout(50);
    await page.waitForFunction(() => { const p = [...document.querySelectorAll('p')].find(e => e.textContent.includes('triangles')); return p && !p.textContent.includes('Showing the edits'); }, null, {timeout: 180000, polling: 50});
    const clock = (await page.evaluate(() => performance.now() / 1000)).toFixed(1);
    console.log(label.padEnd(36), Date.now() - t0, 'ms |', (await footer()).slice(0, 100), '| done at', clock + 's');
};
const shot = name => page.screenshot({path: path.join(OUT, name + '.png')});
let copy = null;
try {
    await page.goto(BASE + '/login/');
    await page.fill('input[name=username]', user);
    await page.fill('input[name=password]', pass);
    await Promise.all([page.waitForNavigation(), page.click('button[type=submit], input[type=submit]')]);
    const project = (await api('GET', `/api/projects/?page_size=1000`)).json.find(p => p.tasks.includes(TASK)).id;
    copy = (await api('POST', `/api/projects/${project}/tasks/${TASK}/duplicate/`)).json.task.id;
    for (let i = 0; i < 90; i++){
        if ((await api('GET', `/api/projects/${project}/tasks/${copy}/`)).json.status === 40) break;
        await page.waitForTimeout(2000);
    }
    if (EDITS) console.log('model edits saved:', (await api('PUT', `/api/plugins/splatme/task/${copy}/model-edits`, {edits: JSON.parse(EDITS)})).status);
    await page.addInitScript(() => {
        window.__long = [];
        window.__splatmeTiming = [];
        new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration) + '@' + (e.startTime / 1000).toFixed(1) + 's'); }).observe({type: 'longtask', buffered: true});
    });
    await page.goto(`${BASE}/plugins/splatme/edit/${copy}/`);
    await page.waitForTimeout(2500);
    const model = page.getByRole('button', {name: '3D Model'});
    if (await model.count()) await model.click();
    const t0 = Date.now();
    await page.locator('.splatme-editor-repairs').waitFor({timeout: 120000});
    await page.waitForFunction(() => !document.querySelector('.splatme-editor-repairs button').disabled, null, {timeout: 180000, polling: 50});
    await waitIdle('model shown, first preview', t0);
    const box = await page.locator('canvas').first().boundingBox();
    const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
    await scenario({page, api, copy, at, footer, waitIdle, shot});
    for (const t of await page.evaluate(() => window.__splatmeTiming)) console.log('  timing', JSON.stringify(t));
    console.log('long tasks (ms@page clock):', JSON.stringify(await page.evaluate(() => window.__long)));
} catch (err){
    console.log('ERR', err.message.split('\n')[0]);
    await shot('error').catch(() => null);
} finally {
    if (copy){
        const project = (await api('GET', `/api/projects/?page_size=1000`)).json.find(p => p.tasks.includes(copy));
        if (project) console.log('copy removed:', (await api('POST', `/api/projects/${project.id}/tasks/${copy}/remove/`)).status);
    }
    await browser.close();
}

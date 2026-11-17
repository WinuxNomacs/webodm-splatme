// SplatMe's pages, reading only (GET and HEAD, and the login): node pages.js <folder for screenshots>
const { chromium } = require("playwright");
const { BASE, login } = require("./login");
const [OUT] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.route("**/*", r => ["GET", "HEAD"].includes(r.request().method()) || r.request().url().endsWith("/login/") ? r.continue() : r.abort());
  await login(page);
  for (const [name, url, sel] of [["tasks", "/plugins/splatme/", "text=View in 3D"], ["admin", "/plugins/splatme/admin/", "text=The splat node is ready."]]) {
    await page.goto(BASE + url);
    const ok = await page.locator(sel).first().waitFor({timeout: 20000}).then(() => true, () => false);
    await page.screenshot({path: `${OUT}/${name}.png`});
    console.log(name, sel, ok);
  }
  console.log("errors:", errors);
  await browser.close();
})();

// A browser that comes back after an upgrade: node cache.js <profile folder>. Opens the Dashboard and SplatMe → Tasks
// in a persistent profile (reading only) and prints each SplatMe bundle it loads, from the network or the disk cache.
// Run before the upgrade to fill the cache, then after: a bundle from the cache with the old Last-Modified is stale.
const { chromium } = require("playwright");
const { BASE, login } = require("./login");
const [PROFILE] = process.argv.slice(2);
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE);
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.route("**/*", r => ["GET", "HEAD"].includes(r.request().method()) || r.request().url().endsWith("/login/") ? r.continue() : r.abort());
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  const asked = {};
  cdp.on("Network.requestWillBeSent", e => { if (/\/plugins\/splatme\/(build\/|bundles|main\.js)/.test(e.request.url)) asked[e.requestId] = e.request.url.replace(BASE, ""); });
  cdp.on("Network.responseReceived", e => {
    if (!asked[e.requestId]) return;
    const h = e.response.headers, modified = h["Last-Modified"] || h["last-modified"] || "";
    console.log(" ", e.response.fromDiskCache ? "cache  " : "network", asked[e.requestId], modified);
  });
  if (!(await ctx.cookies()).some(c => c.name === "sessionid")) await login(page);
  for (const url of ["/dashboard/", "/plugins/splatme/"]) {
    console.log(url);
    await page.goto(BASE + url);
    await page.waitForTimeout(4000);
  }
  await ctx.close();
})();

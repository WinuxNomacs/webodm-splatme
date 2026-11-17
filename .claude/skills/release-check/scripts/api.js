// SplatMe's API on the throwaway: node api.js <method> <path> [json], e.g. node api.js POST task/<id>/train '{"steps":3000}'
const { chromium } = require("playwright");
const { BASE, login } = require("./login");
const [method, path, body] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await login(page);
  const csrf = (await page.context().cookies()).find(c => c.name === "csrftoken").value;
  const r = await page.request.fetch(BASE + "/api/plugins/splatme/" + path, {
    method, headers: {"X-CSRFToken": csrf, "Content-Type": "application/json", Referer: BASE + "/"},
    data: body || undefined,
  });
  console.log(r.status(), (await r.text()).slice(0, 1500));
  await browser.close();
})();

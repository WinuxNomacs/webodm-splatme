// Installs a plugin zip with Load Plugin (.zip): node install.js <zip>
const { chromium } = require("playwright");
const { BASE, login } = require("./login");
const [ZIP] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror " + e.message));
  await login(page);
  await page.goto(BASE + "/admin/app/plugin/");
  await Promise.all([page.waitForNavigation({timeout: 600000}), page.setInputFiles("#plugin-upload-file", ZIP)]);
  console.log("messages:", (await page.locator(".messagelist li").allTextContents()).map(s => s.trim()));
  console.log("row:", (await page.locator("tr").filter({hasText: "Trains a task"}).innerText().catch(() => "none")).replace(/\s+/g, " "));
  console.log("errors:", errors);
  await browser.close();
})();

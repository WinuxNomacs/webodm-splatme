// Upgrades SplatMe as Getting Started says: the upload over it (refused), Delete, the upload again: node upgrade.js <zip>
const { chromium } = require("playwright");
const { BASE, login } = require("./login");
const [ZIP] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("dialog", d => d.accept());
  await login(page);
  await page.goto(BASE + "/admin/app/plugin/");
  const messages = async () => (await page.locator(".messagelist li").allTextContents()).map(s => s.trim());
  await Promise.all([page.waitForNavigation(), page.setInputFiles("#plugin-upload-file", ZIP)]);
  console.log("upload over it:", await messages());
  const row = () => page.locator("tr").filter({hasText: "Trains a task"});
  await Promise.all([page.waitForNavigation(), row().locator("a.button:has(i.fa-trash)").click()]);
  console.log("delete:", await messages(), "| row left:", await row().count());
  await Promise.all([page.waitForNavigation(), page.setInputFiles("#plugin-upload-file", ZIP)]);
  console.log("upload again:", await messages());
  console.log("row:", (await row().innerText()).replace(/\s+/g, " "));
  await browser.close();
})();

// Logs a headless page into the throwaway WebODM (port 8018) as its own administrator
const BASE = "http://localhost:8018";
async function login(page){
  await page.goto(BASE + "/login/");
  await page.fill("#id_username", "scratchadmin"); await page.fill("#id_password", "scratch-admin");
  await Promise.all([page.waitForNavigation(), page.click("button[type=submit], input[type=submit]")]);
}
module.exports = { BASE, login };

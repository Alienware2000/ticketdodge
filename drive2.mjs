import { chromium } from "playwright-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = "C:\\Users\\Julia\\AppData\\Local\\Temp\\claude\\c--Users-Julia-ticketdodge\\735bc8d7-e8d1-490b-b3d1-2430b1c97b20\\scratchpad";
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  geolocation: { latitude: 40.7405, longitude: -73.9903, accuracy: 65 },
  permissions: ["geolocation"],
});
const page = await context.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto("http://localhost:3111/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

// STEP 1: missing-key fallback card shown instead of gray box.
const fallback = await page.getByText("Add your Google Maps API key").count();
const verdict = (await page.locator("aside h1").first().textContent())?.trim();
console.log("STEP1 missing-key card:", fallback, "| verdict:", verdict);
await page.screenshot({ path: `${OUT}/g-1-fallback.png` });

// STEP 2: panel flows work without the map — wrong-side switch.
const label1 = (await page.locator("aside").getByText(/between .* — .* side/).first().textContent())?.trim();
await page.getByRole("button", { name: /Wrong side\? Switch/ }).click();
await page.waitForTimeout(400);
const label2 = (await page.locator("aside").getByText(/between .* — .* side/).first().textContent())?.trim();
console.log("STEP2 switch:", label1, "->", label2);

// STEP 3: time scrubber still recomputes.
const v1 = (await page.locator("aside h1").first().textContent())?.trim();
await page.getByRole("button", { name: "+2h", exact: true }).click();
await page.waitForTimeout(400);
const v2 = (await page.locator("aside h1").first().textContent())?.trim();
console.log("STEP3 scrub: before:", v1, "| after:", v2);

// STEP 4: fuzzy locate — candidate list works without map.
await page.getByRole("button", { name: /Locate me/ }).click();
await page.waitForTimeout(1500);
const confirm = await page.getByText("Confirm your block").count();
console.log("STEP4 fuzzy candidates shown:", confirm);
await page.screenshot({ path: `${OUT}/g-2-panel.png` });

// STEP 5: nearby curb click.
const nearbyBtn = page.locator("section", { hasText: "Nearby curbs" }).getByRole("button").first();
const nearbyLabel = (await nearbyBtn.textContent())?.trim();
await nearbyBtn.click();
await page.waitForTimeout(400);
const label3 = (await page.locator("aside").getByText(/between .* — .* side/).first().textContent())?.trim();
console.log("STEP5 nearby pick:", nearbyLabel?.slice(0, 60), "-> selected:", label3);

// Filter out the expected Google Maps script-load failure (no key in sandbox).
const unexpected = errors.filter((e) => !/maps\.googleapis|googleapis\.com|ERR_/.test(e));
console.log("ERRORS (unexpected):", unexpected.length ? unexpected : "none");
console.log("ERRORS (all):", errors.length);
await browser.close();

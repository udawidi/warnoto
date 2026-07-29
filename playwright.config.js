const { defineConfig } = require("@playwright/test");

const phoneProjects = [
  ["phone-360", 360, 800],
  ["phone-390", 390, 844],
  ["phone-412", 412, 915],
  ["tablet-768", 768, 1024],
];

module.exports = defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://localhost:4173",
    browserName: "chromium",
    colorScheme: "light",
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  expect: { timeout: 8_000 },
  webServer: {
    command: "npm run dev:e2e",
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_E2E: "true",
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_PUBLISHABLE_KEY: "",
      BROWSER: "none",
    },
  },
  projects: [
    ...phoneProjects.map(([name, width, height]) => ({
    name,
    testMatch: "responsive.spec.js",
    use: {
      viewport: { width, height },
      screen: { width, height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    },
    })),
    {
      name: "desktop-smoke",
      testMatch: ["desktop.spec.js", "heavy-equipment.spec.js", "tug15-legacy.spec.js"],
      use: { viewport:{ width:1366, height:768 }, screen:{ width:1366, height:768 } },
    },
    {
      name: "tug15-mobile",
      testMatch: "tug15-legacy.spec.js",
      use: {
        viewport:{ width:390, height:844 },
        screen:{ width:390, height:844 },
        isMobile:true,
        hasTouch:true,
        deviceScaleFactor:1,
      },
    },
  ],
});

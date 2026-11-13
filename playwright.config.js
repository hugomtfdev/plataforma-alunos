const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  workers: 1,
  use: {
    channel: 'chrome',
    screenshot: 'only-on-failure'
  }
});

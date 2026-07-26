import { createLovableConfig } from "lovable-agent-playwright-config/config";
import { devices } from "@playwright/test";

export default createLovableConfig({
  // Cross-browser matrix. CI selects one project per job via --project=<name>.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});

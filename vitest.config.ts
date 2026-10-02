import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{packages,services,tools,apps}/**/test/**/*.test.ts'],
  },
});

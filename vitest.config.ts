import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'packages/*/test/*.spec.ts',
            'packages/*/test/unit/**/*.spec.ts',
            'packages/*/test/architecture/**/*.spec.ts',
            'packages/*/test/documentation/**/*.spec.ts',
            'apps/*/test/unit/**/*.spec.ts',
            'apps/*/test/http/**/*.spec.ts',
            'apps/*/test/security/**/*.spec.ts'
          ]
        }
      },
      {
        test: {
          name: 'database',
          include: [
            'packages/*/test/database/**/*.spec.ts',
            'apps/*/test/database/**/*.spec.ts'
          ]
        }
      },
      {
        test: {
          name: 'integration',
          include: [
            'packages/*/test/integration/**/*.spec.ts',
            'apps/*/test/integration/**/*.spec.ts'
          ]
        }
      }
    ]
  }
});

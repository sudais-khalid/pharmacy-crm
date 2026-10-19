/**
 * Module boundary rules (docs/plan/02-architecture.md, section 3.2).
 *
 *   app, components -> modules (index.ts only) -> lib
 *
 * Run with `npm run lint:deps`. CI fails on any violation.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular imports make module boundaries meaningless and break tree shaking.",
      from: {},
      to: { circular: true },
    },
    {
      name: "module-internals-from-outside",
      severity: "error",
      comment: "Code outside a module may only import that module's index.ts.",
      from: { path: "^(src/(app|components|lib|middleware\\.ts|worker\\.ts)|tests|prisma|desktop|scripts)" },
      to: { path: "^src/modules/[^/]+/", pathNot: "^src/modules/[^/]+/index\\.ts$" },
    },
    {
      name: "module-internals-from-other-module",
      severity: "error",
      comment: "A module may only import another module's index.ts.",
      from: { path: "^src/modules/([^/]+)/" },
      to: { path: "^src/modules/[^/]+/", pathNot: ["^src/modules/$1/", "^src/modules/[^/]+/index\\.ts$"] },
    },
    {
      name: "modules-not-to-ui",
      severity: "error",
      comment: "Business modules must not depend on pages, routes or UI components.",
      from: { path: "^src/modules/" },
      to: { path: "^src/(app|components)/" },
    },
    {
      name: "lib-not-to-modules",
      severity: "error",
      comment: "lib/ is shared infrastructure. Only the HTTP route wrapper may use identity (for the session).",
      from: { path: "^src/lib/", pathNot: "^src/lib/api\\.ts$" },
      to: { path: "^src/modules/" },
    },
    {
      name: "route-wrapper-only-identity",
      severity: "error",
      from: { path: "^src/lib/api\\.ts$" },
      to: { path: "^src/modules/", pathNot: "^src/modules/identity/index\\.ts$" },
    },
    {
      name: "platform-db-allowlist",
      severity: "error",
      comment:
        "platformDb bypasses tenant isolation. Only cross-pharmacy code may use it: the platform module and console, " +
        "login and session lookups, maintenance helpers, the worker, the ops command, seed, scripts and tests.",
      from: {
        pathNot: [
          "^src/modules/platform/",
          "^src/modules/tenancy/",
          "^src/modules/identity/(session|platform-auth|tokens|support|staff-mfa)\\.ts$",
          "^src/instrumentation\\.ts$",
          "^src/lib/(rate-limit|idempotency|platform-db)\\.ts$",
          "^src/worker\\.ts$",
          "^src/modules/stockentry/(upload|ocr/process)\\.ts$",
          "^src/ops-cli\\.ts$",
          "^src/app/api/(auth|platform)/",
          "^src/app/\\(platform\\)/",
          "^(tests|prisma|scripts)/",
        ],
      },
      to: { path: "^src/lib/platform-db\\.ts$" },
    },
    {
      name: "no-server-code-in-components",
      severity: "error",
      comment: "UI components run in the browser; they must not import the database or business modules.",
      from: { path: "^src/components/" },
      to: { path: "^src/(modules/|lib/(prisma|platform-db|db|api|money)\\.ts$)" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(node_modules|\\.next)/" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default"] },
  },
};

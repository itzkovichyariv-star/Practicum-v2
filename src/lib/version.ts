// Auto-managed by scripts/bump-version.mjs — do not edit the version string by hand.
//
// Scheme: SemVer + monotonic build counter + git SHA  →  v<major>.<minor>.<patch>+build.<n>.<sha>
//   • major  — breaking change (schema migration, removed flow, full redesign)
//   • minor  — new user-facing capability (new section, field, screen, flow)
//   • patch  — fix / copy tweak / refactor, no new capability
//   • build  — deploy counter, auto-increments on every deploy, never resets
//   • sha    — short git commit the deploy was built from (stamped on deploy)
//
// Bump semver:  npm run bump:patch | bump:minor | bump:major  (these drop the SHA)
// Build counter + SHA are stamped automatically via the `predeploy` hook in package.json.
export const APP_VERSION = 'v1.4.2+build.9.8571332f';

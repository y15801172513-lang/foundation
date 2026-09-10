# Third-party notices

AI Product Foundation Kit depends on third-party packages recorded in `package-lock.json` and `examples/foundation-events/package-lock.json`. Those packages retain their own licenses; a future project license does not replace them.

Source exports intentionally omit generated `dist/` assets. A local production build embeds Geist Variable font files supplied by `@fontsource-variable/geist@5.3.0`. Geist is distributed under the SIL Open Font License 1.1 (OFL-1.1). Anyone distributing generated assets must preserve the applicable copyright and OFL notice; the dependency package exposes its full license as `@fontsource-variable/geist/LICENSE`.

The management-center build now emits `dist/THIRD_PARTY_NOTICES.txt` from bundled module inputs plus the explicitly embedded Geist font package. The candidate builder combines these notices with its server/CLI bundle dependencies in `app/THIRD_PARTY_NOTICES.txt`; the official Node runtime carries its own `runtime/LICENSE`. Missing license text stops the new build. Rebuild and review the actual final files before any public Release; this does not retroactively change old immutable assets.

These notices do not replace the project-level `LICENSE`, which remains undecided. Publication must also check the selected Foundation license and any required third-party NOTICE/attribution obligations; generating files alone is not a public-release approval.

declare const __CHANNEL__: string

/** '' for production; the branch name (e.g. 'nightly') on test deploys. Set at build time. */
export const CHANNEL: string = typeof __CHANNEL__ === 'string' ? __CHANNEL__ : ''

declare const __VERSION__: string
/** The build: short commit and build date, e.g. "d94dbf2 (2026-10-29)". */
export const VERSION: string = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev'

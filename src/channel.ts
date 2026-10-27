declare const __CHANNEL__: string

/** '' for production; the branch name (e.g. 'nightly') on test deploys. Set at build time. */
export const CHANNEL: string = typeof __CHANNEL__ === 'string' ? __CHANNEL__ : ''

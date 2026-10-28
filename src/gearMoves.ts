// Moving run items in Destiny 2 from the app: only from the player's own signed-in device.

import { bungieConfigured, isSignedIn, moveItems, type MoveOp, type MoveResult } from './bungie'
import type { Player } from './model'

/** True when this device can move this Guardian's items in game. */
export const canMoveInGame = (p: Player, me: string) => bungieConfigured && isSignedIn() && !!p.bungie && p.clientId === me

/** Runs the moves and reports them in a toast; null if Bungie refused outright (nothing moved). */
export async function moveInGame(p: Player, ops: MoveOp[], toast: (m: string) => void): Promise<MoveResult | null> {
  try {
    const r = await moveItems(p, ops)
    toast([r.moved.length ? `Moved in Destiny 2: ${r.moved.join(', ')}.` : '', r.problems.length ? `Couldn't move: ${r.problems.join('; ')}.` : ''].filter(Boolean).join(' '))
    return r
  } catch (e) {
    toast(`Couldn't move items in Destiny 2: ${(e as Error).message}`)
    return null
  }
}

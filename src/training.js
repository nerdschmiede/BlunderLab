// src/training.js
// Training-mode controller (pure-ish): no DOM, only uses callbacks provided by caller.
// Implements the exact logic used in the tests/harness: only allow the expected move
// from the mainline, reject unexpected moves (no mutation), and auto-play the
// opponent's expected move (from the mainline) after a correct user move.

import { isUsersTurn, sameMove, expectedMove } from "./core.js";

/**
 * handleTrainingMove
 * - args: object with current mainline snapshot and callbacks
 *   { fullLine, viewPly, studyColor, makeMove, setGameToPly }
 * - moveObj: { from, to, promotion? }
 *
 * Returns the result of makeMove (truthy) for the user's move on success,
 * or null on rejection/failure. It may call makeMove twice (user + auto-opponent).
 *
 * Important: this function does not itself mutate any external state except via
 * the provided callbacks (makeMove, setGameToPly). It uses only the provided
 * fullLine/viewPly snapshot to decide expected moves (training uses the masterline
 * only, so that is sufficient).
 */
export function handleTrainingMove({ fullLine, viewPly, studyColor, makeMove, setGameToPly }, moveObj) {
    const userTurn = isUsersTurn(studyColor, viewPly);
    const expected = expectedMove(fullLine, viewPly);

    if (!userTurn) {
        try { setGameToPly(viewPly); } catch (e) {}
        return null;
    }

    // If the expected move exists in the mainline and matches the player's move,
    // DO NOT call makeMove() — advance the view along the existing line only.
    if (expected && sameMove(expected, moveObj)) {
        // Check whether the opponent also has an expected move in the mainline
        const oppExpected = expectedMove(fullLine, viewPly + 1);

        try {
            if (oppExpected) {
                // Opponent's move is part of existing mainline: advance two plies in one call
                setGameToPly(viewPly + 2);
            } else {
                // Only the user's expected move applies
                setGameToPly(viewPly + 1);
            }
        } catch (e) {
            try { setGameToPly(viewPly); } catch (e) {}
            return null;
        }

        // If opponent's expected move exists but was not part of the mainline (shouldn't happen), ignore.
        return true;
    }

    // Otherwise, expected was missing or didn't match: only allow makeMove if we're at the end of the mainline
    if (viewPly === fullLine.length) {
        // Attempt to apply move (this will append to masterline)
        const mv = makeMove(moveObj);
        if (!mv) {
            try { setGameToPly(viewPly); } catch (e) {}
            return null;
        }

        // After successful append, try auto-playing opponent's expected move from the snapshot
        const oppExpected = expectedMove(fullLine, viewPly + 1);
        if (oppExpected) {
            try { makeMove({ from: oppExpected.from, to: oppExpected.to, promotion: oppExpected.promotion }); } catch (e) {}
        }

        return mv;
    }

    // Not user's turn / unexpected move in the middle of the mainline
    try { setGameToPly(viewPly); } catch (e) {}
    return null;
}

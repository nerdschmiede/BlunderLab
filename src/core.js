// src/core.js
// Pure-ish core helpers for BlunderLab (no DOM, no Chessground)

export const PROMO_PIECES = /** @type {const} */ (["q", "n", "r", "b"]);

/**
 * Build a lichess analysis URL from a FEN.
 * Lichess accepts: board_turn_castling_ep_halfmove_fullmove
 *
 * @param {string} fen
 * @param {"white"|"black"} orientation
 */
export function lichessAnalysisUrlFromFen(fen, orientation = "white") {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) return "https://lichess.org/analysis";

    const board = parts[0];      // with /
    const turn = parts[1];       // w|b
    const castling = parts[2];   // KQkq|-
    const ep = parts[3];         // -|e3
    const halfmove = parts[4] ?? "0";
    const fullmove = parts[5] ?? "1";

    const fenPath = `${board}_${turn}_${castling}_${ep}_${halfmove}_${fullmove}`;
    return `https://lichess.org/analysis/standard/${fenPath}?color=${orientation}`;
}

/**
 * @param {string} toSquare like "e8"
 * @param {"w"|"b"} chessColor
 * @returns {[string,string,string,string]}
 */
export function promoSquares(toSquare, chessColor) {
    const file = toSquare[0];
    return chessColor === "w"
        ? /** @type {[string,string,string,string]} */ ([file + "8", file + "7", file + "6", file + "5"])
        : /** @type {[string,string,string,string]} */ ([file + "1", file + "2", file + "3", file + "4"]);
}

/**
 * Build HTML for clickable PGN line.
 * - fullLine: verbose moves containing { san }
 * - viewPly: 0..fullLine.length (cursor)
 *
 * @param {{san:string}[]} fullLine
 * @param {number} viewPly
 * @returns {string}
 */
export function buildPgnHtml(fullLine, viewPly) {
    const ply = clamp(viewPly, 0, fullLine.length);

    let html = "";
    for (let i = 0; i < fullLine.length; i++) {
        const mv = fullLine[i];

        if (i % 2 === 0) {
            const moveNo = Math.floor(i / 2) + 1;
            html += `<span class="num">${moveNo}.</span>`;
        }

        const active = (i + 1) === ply ? "active" : "";
        html += `<span class="mv ${active}" data-ply="${i + 1}">${escapeHtml(mv.san)}</span>`;
    }

    return html || `<span class="num">—</span>`;
}

/**
 * Cursor navigation only: never delete moves.
 * @param {number} viewPly
 * @param {number} delta
 * @param {number} lineLength
 */
export function nextViewPly(viewPly, delta, lineLength) {
    return clamp(viewPly + delta, 0, lineLength);
}

/**
 * If user is "in the past" and makes a new move, we branch:
 * - future is cut
 * - basePly becomes end of truncated line
 *
 * @param {any[]} fullLine
 * @param {number} viewPly
 * @returns {{ newLine:any[], basePly:number, cut:boolean }}
 */
export function branchLineIfNeeded(fullLine, viewPly) {
    const ply = clamp(viewPly, 0, fullLine.length);
    if (ply >= fullLine.length) {
        return { newLine: fullLine, basePly: fullLine.length, cut: false };
    }
    const newLine = fullLine.slice(0, ply);
    return { newLine, basePly: newLine.length, cut: true };
}

/* ----------------- small helpers ----------------- */

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function escapeHtml(s) {
    // protects SAN like "Nf3+" etc (mostly safe), but we escape anyway
    return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

/**
 * Clamp cursor to [0..len]
 * @param {number} viewPly
 * @param {number} len
 */
export function clampPly(viewPly, len) {
    return Math.max(0, Math.min(len, viewPly));
}

/**
 * lastMove from the cursor position:
 * - viewPly=0 -> null
 * - viewPly=k -> move at index k-1 (from/to)
 *
 * @param {{from:string,to:string}[]} fullLine
 * @param {number} viewPly
 * @returns {[string,string] | null}
 */
export function computeLastMove(fullLine, viewPly) {
    const ply = clampPly(viewPly, fullLine.length);
    if (ply <= 0) return null;
    const m = fullLine[ply - 1];
    return [m.from, m.to];
}

/**
 * Jump to ply (e.g. click in PGN). Keeps master line unchanged.
 * @param {number} viewPly
 * @param {number} targetPly
 * @param {number} len
 */
export function applyJump(viewPly, targetPly, len) {
    return clampPly(targetPly, len);
}

/**
 * After a new move is made (on current game), we always "commit":
 * - cursor goes to end
 * - lastMove becomes the last move (if any)
 *
 * @param {{from:string,to:string}[]} newFullLine
 * @returns {{viewPly:number, lastMove:[string,string]|null}}
 */
export function applyCommit(newFullLine) {
    const viewPly = newFullLine.length;
    return { viewPly, lastMove: computeLastMove(newFullLine, viewPly) };
}

/**
 * When user is browsing the past and wants to edit:
 * cut future and return the truncated line + new cursor.
 *
 * @param {{from:string,to:string}[]} fullLine
 * @param {number} viewPly
 * @returns {{line:{from:string,to:string}[], viewPly:number}}
 */
export function applyEditInPast(fullLine, viewPly) {
    const r = branchLineIfNeeded(fullLine, viewPly);
    return { line: r.newLine, viewPly: r.basePly };
}

export function pgnHasFenHeader(pgnText) {
    return /\[FEN\s+"/i.test(String(pgnText ?? ""));
}

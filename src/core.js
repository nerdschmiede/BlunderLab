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

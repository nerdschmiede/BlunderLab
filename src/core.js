// src/core.js
// Pure-ish core helpers for BlunderLab (no DOM, no Chessground)
//
// This file contains pure logic functions (timeline operations, PGN/FEN helpers,
// study CRUD and URL builders). It is intentionally DOM-free and suitable for
// unit testing.


/**
 * Build a lichess analysis URL from a FEN.
 * Lichess accepts: board_turn_castling_ep_halfmove_fullmove
 *
 * Input:
 * - fen: full FEN string (e.g. "rnbqkbnr/... w KQkq - 0 1")
 * - orientation: "white"|"black" (view color on Lichess)
 *
 * Output: URL string. Returns a generic analysis URL on invalid input.
 */
export function lichessAnalysisUrlFromFen(fen, orientation = "white") {
    if (!fen || typeof fen !== "string") return "https://lichess.org/analysis";

    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) return "https://lichess.org/analysis";

    const board = parts[0];                 // keep "/" characters
    const turn = parts[1];
    const castling = parts[2];
    const ep = parts[3];
    const halfmove = parts[4] ?? "0";
    const fullmove = parts[5] ?? "1";
    const rest = `${turn} ${castling} ${ep} ${halfmove} ${fullmove}`;


    // Lichess expects: /analysis/<board>%20<rest>
    // Do not encode board slashes.
    const restEnc = encodeURIComponent(rest);
    const color = orientation === "black" ? "black" : "white";

    return `https://lichess.org/analysis/${board}%20${restEnc}?color=${color}&engine=1`;
}

/**
 * Build a lichess analysis URL from PGN movetext.
 * - Strips headers, comments and variations (naively) and creates a
 *   Lichess-compatible PGN move string.
 *
 * Notes: Very complex or non-standard PGNs might be handled imprecisely,
 * but this is sufficient for most cases.
 */
export function lichessAnalysisUrlFromPgn(pgn) {
    if (!pgn || typeof pgn !== "string") return "https://lichess.org/analysis";

    const text = pgn.trim();
    if (!text) return "https://lichess.org/analysis";

    // Strip headers: keep only movetext after first blank line
    const chunks = text.split(/\r?\n\r?\n/);
    let movetext = (chunks.length > 1 ? chunks.slice(1).join("\n\n") : text);

    // Remove comments and variations (URL parser is picky)
    movetext = movetext
        .replace(/{[^}]*}/g, " ")     // {...}
        .replace(/;[^\n]*/g, " ")    // ; comment
        .replace(/\([^)]*\)/g, " "); // ( ... ) naive but fine for v1

    // Normalize whitespace/newlines
    movetext = movetext.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();

    // Remove game termination markers if present
    movetext = movetext.replace(/\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/, "").trim();

    if (!movetext) return "https://lichess.org/analysis";

    // Lichess move string: remove space after move number and use '+' as separator
    const moveString = movetext
        .replace(/(\d+)\.\s+/g, "$1.")  // "1. e4" -> "1.e4"
        .replace(/\s+/g, "+");            // spaces -> '+'

    return `https://lichess.org/analysis/pgn/${moveString}`;
}

/**
 * Prefer PGN over FEN. If PGN is present use the PGN-based URL.
 */
export function lichessAnalysisUrl({ pgn, fen, orientation = "white" }) {
    if (pgn && pgn.trim()) {
        return lichessAnalysisUrlFromPgn(pgn);
    }
    return lichessAnalysisUrlFromFen(fen, orientation);
}


/**
 * promoSquares(toSquare, chessColor)
 * - returns four display squares for promotion selection based on
 *   target square (e.g. e8) and pawn color ("w"|"b").
 * - returned array order matches pieces [q, n, r, b].
 */
export function promoSquares(toSquare, chessColor) {
    const file = toSquare[0];
    return chessColor === "w"
        ? /** @type {[string,string,string,string]} */ ([file + "8", file + "7", file + "6", file + "5"])
        : /** @type {[string,string,string,string]} */ ([file + "1", file + "2", file + "3", file + "4"]);
}

/**
 * Build HTML for clickable PGN line.
 * - fullLine: array of verbose moves (each contains e.g. san)
 * - viewPly: cursor (0..fullLine.length)
 *
 * Returns an HTML string (no DOM operations here).
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
 * - simple helper for previous/next navigation.
 */
export function nextViewPly(viewPly, delta, lineLength) {
    return clamp(viewPly + delta, 0, lineLength);
}

/**
 * Branch if user edits while browsing the past.
 * - trims the future and returns the truncated line and basePly.
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
    // escape SAN strings (e.g. "Nf3+") to avoid HTML injection
    return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

/**
 * Clamp cursor to [0..len]
 */
export function clampPly(viewPly, len) {
    return Math.max(0, Math.min(len, viewPly));
}

/**
 * Get last move based on cursor position:
 * - viewPly=0 -> null
 * - viewPly=k -> move at index k-1 (from/to)
 *
 * Returns [from,to] or null
 */
export function computeLastMove(fullLine, viewPly) {
    const ply = clampPly(viewPly, fullLine.length);
    if (ply <= 0) return null;
    const m = fullLine[ply - 1];
    return [m.from, m.to];
}

/**
 * Jump to ply (e.g. click in PGN). This only changes the cursor, not the master line.
 */
export function applyJump(viewPly, targetPly, len) {
    return clampPly(targetPly, len);
}

/**
 * After a new move is made we commit the current line:
 * - cursor goes to the end
 * - lastMove is computed
 */
export function applyCommit(newFullLine) {
    const viewPly = newFullLine.length;
    return { viewPly, lastMove: computeLastMove(newFullLine, viewPly) };
}

/**
 * If editing in the past: cut future and return new line + cursor.
 */
export function applyEditInPast(fullLine, viewPly) {
    const r = branchLineIfNeeded(fullLine, viewPly);
    return { line: r.newLine, viewPly: r.basePly };
}

// PGN helper – checks whether PGN contains a FEN header (e.g. "[FEN \"..\"]").
export function pgnHasFenHeader(pgnText) {
    return /\[FEN\s+"/i.test(String(pgnText ?? ""));
}

/**
 * Study helpers (lightweight CRUD)
 * - createStudy: returns a study object with id, timestamps and defaults
 */
export function createStudy({ name, color }) {
    const now = Date.now();
    const id = `s_${now}_${Math.random().toString(16).slice(2)}`;
    return {
        id,
        name: String(name ?? "").trim() || "New opening",
        color: color === "black" ? "black" : "white",
        pgn: "",
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * Upsert: merge update if study exists, otherwise append.
 * - returns a new studies array (immutable style)
 */
export function upsertStudy(studies, study) {
    const list = Array.isArray(studies) ? studies.slice() : [];
    const idx = list.findIndex(s => s.id === study.id);
    if (idx === -1) return [...list, study];
    list[idx] = { ...list[idx], ...study };
    return list;
}

export function pickStudy(studies, id) {
    return (Array.isArray(studies) ? studies : []).find(s => s.id === id) ?? null;
}

/**
 * One-time migration: if old single-PGN storage exists and no studies,
 * create a default study and mark it active.
 */
export function migrateLegacyPgn({ legacyPgn, existingStudies }) {
    const studies = Array.isArray(existingStudies) ? existingStudies : [];
    if (studies.length > 0) return { studies, activeStudyId: studies[0].id };

    if (!legacyPgn) return { studies: [], activeStudyId: null };

    const s = createStudy({ name: "Migrated opening", color: "white" });
    s.pgn = legacyPgn;
    s.updatedAt = Date.now();
    return { studies: [s], activeStudyId: s.id };
}

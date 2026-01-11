import { Chessground } from "https://esm.sh/chessground@9.2.1";
import { Chess } from "https://esm.sh/chess.js@1.0.0";
import {
    lichessAnalysisUrlFromFen,
    promoSquares,
    buildPgnHtml,
    nextViewPly,
    branchLineIfNeeded
} from "./src/core.js";

/* =========================================================
   BlunderLab – app.js (refactored)
   - Master line: fullLine (verbose moves)
   - Cursor: viewPly (0..fullLine.length) – timeline navigation only
   - Branching: when editing in the past, cut future and continue
   - Promotion: lichess style squares with highlight.custom (square.promo)
   - Auto-save PGN at end of line only
   ========================================================= */

const STORAGE_PGN_KEY = "blunderlab.pgn";
const STORAGE_ORIENTATION_KEY = "blunderlab.orientation";

/* ---------- DOM ---------- */
const boardEl = document.getElementById("board");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const resetBtn = document.getElementById("resetBtn");
const flipBtn = document.getElementById("flipBtn");
const copyPgnBtn = document.getElementById("copyPgnBtn");
const lichessBtn = document.getElementById("lichessBtn");
const fenLine = document.getElementById("fenLine");
const pgnEl = document.getElementById("pgn");

/* ---------- Game state ---------- */
const game = new Chess();
let orientation = localStorage.getItem(STORAGE_ORIENTATION_KEY) || "white";

let fullLine = [];   // verbose moves (master line)
let viewPly = 0;     // cursor in half-moves: 0..fullLine.length
let fullPgn = "";    // pgn of master line
let lastMove = null; // [from,to] or null

/* Promotion state */
let promoPick = null;        // { from, to, squares } | null
let promoCustom = new Map(); // Map<square, "promo">

/* ---------- Helpers ---------- */
function autoSavePgn() {
    try {
        localStorage.setItem(STORAGE_PGN_KEY, fullPgn);
    } catch (e) {
        console.warn("Auto-save PGN failed:", e);
    }
}

function calcDests(chess) {
    const dests = new Map();
    const moves = chess.moves({ verbose: true });
    for (const m of moves) {
        if (!dests.has(m.from)) dests.set(m.from, []);
        dests.get(m.from).push(m.to);
    }
    return dests;
}

function setGameToPly(ply) {
    game.reset();
    for (let i = 0; i < ply; i++) {
        const m = fullLine[i];
        game.move({ from: m.from, to: m.to, promotion: m.promotion });
    }
}

function commitFromGameToMasterLine() {
    fullLine = game.history({ verbose: true });
    fullPgn = game.pgn();
    viewPly = fullLine.length;
}

function updateLastMoveFromView() {
    lastMove = viewPly > 0 ? [fullLine[viewPly - 1].from, fullLine[viewPly - 1].to] : null;
}

function updateButtons() {
    undoBtn.disabled = viewPly <= 0;
    redoBtn.disabled = viewPly >= fullLine.length;
}

function renderPgn() {
    pgnEl.innerHTML = buildPgnHtml(fullLine, viewPly);
}

function isPromotionMove(from, to) {
    const p = game.get(from);
    if (!p || p.type !== "p") return false;
    const rank = to[1];
    return (p.color === "w" && rank === "8") || (p.color === "b" && rank === "1");
}

function cgColor(chessColor) {
    return chessColor === "w" ? "white" : "black";
}

/* ---------- Promotion UI ---------- */
function ensurePromoDimmer() {
    const wrap = boardEl.querySelector(".cg-wrap");
    if (!wrap) return;

    if (!wrap.querySelector(".promo-dimmer")) {
        const dim = document.createElement("div");
        dim.className = "promo-dimmer";
        wrap.appendChild(dim);
    }
}

function enterPromotion(from, to) {
    const chessColor = game.get(from).color; // "w" | "b"
    const squares = promoSquares(to, chessColor);
    promoPick = { from, to, squares };

    const c = cgColor(chessColor);

    // Put 4 choice pieces on board squares
    ground.setPieces(new Map([
        [squares[0], { role: "queen",  color: c }],
        [squares[1], { role: "knight", color: c }],
        [squares[2], { role: "rook",   color: c }],
        [squares[3], { role: "bishop", color: c }],
    ]));

    // Highlight squares via highlight.custom => CSS square.promo
    promoCustom = new Map(squares.map(sq => [sq, "promo"]));

    // Disable normal movement while choosing promotion
    ground.set({
        movable: { free: false, color: undefined, dests: new Map() },
        highlight: { check: true, lastMove: true, custom: promoCustom },
    });

    boardEl.querySelector(".cg-wrap")?.classList.add("promo-active");
}

function exitPromotion() {
    if (!promoPick) return;

    const [a, b, c, d] = promoPick.squares;

    // Remove temp choice pieces
    ground.setPieces(new Map([[a, null], [b, null], [c, null], [d, null]]));

    promoPick = null;
    promoCustom = new Map();

    boardEl.querySelector(".cg-wrap")?.classList.remove("promo-active");
}

/* ---------- Sync UI from state ---------- */
function sync({ save = true } = {}) {
    const turn = game.turn() === "w" ? "white" : "black";
    const inCheck = game.inCheck?.() ?? false;
    const checkColor = inCheck ? turn : false;

    ground.set({
        fen: game.fen(),
        orientation,
        turnColor: turn,
        movable: { free: false, color: turn, dests: calcDests(game) },
        check: checkColor,
        highlight: { check: true, lastMove: true, custom: promoCustom },
        lastMove: lastMove ?? undefined,
    });

    fenLine.value = game.fen();
    fenLine.classList.remove("invalid");

    renderPgn();
    updateButtons();

    // Save only when user is at end-of-line (live position)
    if (save && viewPly === fullLine.length) autoSavePgn();
}

/* ---------- Timeline navigation ---------- */
function goToPly(ply, { save = false } = {}) {
    viewPly = Math.max(0, Math.min(fullLine.length, ply));
    setGameToPly(viewPly);
    updateLastMoveFromView();
    sync({ save });
}

function goPrevPly() {
    goToPly(nextViewPly(viewPly, -1, fullLine.length));
}
function goNextPly() {
    goToPly(nextViewPly(viewPly, +1, fullLine.length));
}

/* ---------- FEN input ---------- */
function applyFenFromInput() {
    exitPromotion();

    const fen = fenLine.value.trim().replace(/\s+/g, " ");
    if (!fen) return;

    let ok = true;
    try {
        const r = game.load(fen);
        if (r === false) ok = false;
    } catch {
        ok = false;
    }

    if (!ok) {
        try {
            const r2 = game.load(fen, { sloppy: true });
            ok = r2 !== false;
        } catch {
            ok = false;
        }
    }

    if (!ok) {
        fenLine.classList.add("invalid");
        console.warn("FEN invalid:", fen);
        return;
    }

    fenLine.classList.remove("invalid");
    lastMove = null;

    // A loaded FEN has no move history => master line becomes empty at this position
    commitFromGameToMasterLine();
    sync({ save: true });
}

/* =========================================================
   Chessground init
   ========================================================= */
const ground = Chessground(boardEl, {
    fen: game.fen(),
    orientation,
    highlight: { check: true, lastMove: true },
    movable: {
        free: false,
        color: game.turn() === "w" ? "white" : "black",
        dests: calcDests(game),
    },
    events: {
        move: (from, to) => {
            if (promoPick) return;

            // If user is in the past: branch (cut future) and replay truncated line into game
            const br = branchLineIfNeeded(fullLine, viewPly);
            if (br.cut) {
                fullLine = br.newLine;
                viewPly = br.basePly;
                setGameToPly(viewPly);
            }

            // Promotion?
            if (isPromotionMove(from, to)) {
                enterPromotion(from, to);
                return;
            }

            const mv = game.move({ from, to });
            if (!mv) { sync({ save: false }); return; }

            lastMove = [mv.from, mv.to];

            commitFromGameToMasterLine();
            sync({ save: true });
        },

        select: (key) => {
            if (!promoPick) return;

            const idx = promoPick.squares.indexOf(key);
            if (idx === -1) return;

            const promoByIdx = ["q", "n", "r", "b"][idx];

            const mv = game.move({
                from: promoPick.from,
                to: promoPick.to,
                promotion: promoByIdx,
            });

            exitPromotion();

            if (!mv) { sync({ save: false }); return; }

            lastMove = [mv.from, mv.to];

            commitFromGameToMasterLine();
            sync({ save: true });
        },
    },
});

requestAnimationFrame(ensurePromoDimmer);

/* =========================================================
   Event listeners
   ========================================================= */

// Timeline buttons
undoBtn.addEventListener("click", goPrevPly);
redoBtn.addEventListener("click", goNextPly);

// Reset (hard reset = clears master line)
resetBtn.addEventListener("click", () => {
    exitPromotion();
    game.reset();
    lastMove = null;
    commitFromGameToMasterLine();
    sync({ save: true });
});

// Flip board
flipBtn.addEventListener("click", () => {
    orientation = orientation === "white" ? "black" : "white";
    localStorage.setItem(STORAGE_ORIENTATION_KEY, orientation);
    sync({ save: false });
});

// Lichess analysis
lichessBtn.addEventListener("click", () => {
    const url = lichessAnalysisUrlFromFen(game.fen(), orientation);
    window.open(url, "_blank", "noopener,noreferrer");
});

// Copy PGN (always master line)
copyPgnBtn.addEventListener("click", async () => {
    const pgn = fullPgn || game.pgn();
    try {
        await navigator.clipboard.writeText(pgn);
        copyPgnBtn.textContent = "✓";
        setTimeout(() => (copyPgnBtn.textContent = "⎘"), 800);
    } catch {
        window.prompt("PGN kopieren (Strg+C):", pgn);
    }
});

// Click in PGN -> jump
pgnEl.addEventListener("click", (e) => {
    const mv = e.target.closest(".mv");
    if (!mv) return;
    const ply = parseInt(mv.dataset.ply, 10);
    goToPly(ply);
});

// Keyboard arrows (skip if typing)
document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.key === "ArrowLeft") { e.preventDefault(); goPrevPly(); }
    if (e.key === "ArrowRight") { e.preventDefault(); goNextPly(); }
});

// FEN listeners
fenLine.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        applyFenFromInput();
        fenLine.blur();
    }
});
fenLine.addEventListener("blur", applyFenFromInput);

/* =========================================================
   Boot: load saved PGN and start at end
   ========================================================= */
(function boot() {
    const savedPgn = localStorage.getItem(STORAGE_PGN_KEY);
    if (savedPgn) {
        try {
            game.loadPgn(savedPgn);
        } catch (e) {
            console.warn("Failed to load saved PGN:", e);
            game.reset();
        }
    }

    commitFromGameToMasterLine();
    updateLastMoveFromView();

    // Always show end of line on load
    goToPly(fullLine.length, { save: false });
})();

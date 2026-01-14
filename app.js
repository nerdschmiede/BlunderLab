import { Chessground } from "chessground";
import { Chess } from "chess.js";

import {
    lichessAnalysisUrlFromFen,
    promoSquares,
    buildPgnHtml,
    nextViewPly,
    // NEW state helpers:
    computeLastMove,
    applyEditInPast,
    applyCommit,
    applyJump,
    clampPly,
    pgnHasFenHeader
} from "./src/core.js";


/* =========================================================
   BlunderLab – app.js (refactored to core state helpers)
   - master line: fullLine (verbose moves)
   - cursor: viewPly (0..fullLine.length)
   - lastMove computed via core (single truth)
   - branching in past via core applyEditInPast()
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
const pgnInput = document.getElementById("pgnInput");
const btnImportPgn = document.getElementById("btnImportPgn");

/* ---------- Game state ---------- */
const game = new Chess();
let orientation = localStorage.getItem(STORAGE_ORIENTATION_KEY) || "white";

let fullLine = [];   // verbose moves (master line)
let viewPly = 0;     // 0..fullLine.length
let fullPgn = "";    // PGN of master line

/* Promotion */
let promoPick = null;        // { from, to, squares } | null
let promoCustom = new Map(); // Map<square, "promo">


/* ---------- Persistence ---------- */
function autoSavePgn() {
    try {
        localStorage.setItem(STORAGE_PGN_KEY, fullPgn);
    } catch (e) {
        console.warn("Auto-save PGN failed:", e);
    }
}

/* ---------- Chessground helpers ---------- */
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
    const p = clampPly(ply, fullLine.length);
    game.reset();

    try {
        for (let i = 0; i < p; i++) {
            const m = fullLine[i];
            game.move({ from: m.from, to: m.to, promotion: m.promotion });
        }
    } catch {
        // Never crash the app on a bad timeline
        game.reset();
    }
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

function applyPgnFromInput(pgnText) {
    const text = (pgnText ?? "").trim();
    if (!text) return false;

    // Reject "From Position" PGNs (contain a FEN header)
    if (pgnHasFenHeader(text)) return false;

    // Snapshot current state so a bad PGN paste can't break anything
    const beforePgn = game.pgn();

    try {
        // Replace state
        game.reset();
        game.loadPgn(text);
    } catch {
        // Restore exactly; keep app state (fullLine/viewPly/fullPgn) unchanged
        game.reset();
        try { game.loadPgn(beforePgn); } catch {}
        setGameToPly(viewPly);
        sync({ save: true });
        return false;
    }

    commitFromGame();
    goToPly(fullLine.length, { save: true });
    return true;
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

    ground.setPieces(new Map([
        [squares[0], { role: "queen",  color: c }],
        [squares[1], { role: "knight", color: c }],
        [squares[2], { role: "rook",   color: c }],
        [squares[3], { role: "bishop", color: c }],
    ]));

    promoCustom = new Map(squares.map(sq => [sq, "promo"]));

    ground.set({
        movable: { free: false, color: undefined, dests: new Map() },
        highlight: { check: true, lastMove: true, custom: promoCustom },
    });

    boardEl.querySelector(".cg-wrap")?.classList.add("promo-active");
}

function exitPromotion() {
    if (!promoPick) return;

    const [a, b, c, d] = promoPick.squares;
    ground.setPieces(new Map([[a, null], [b, null], [c, null], [d, null]]));

    promoPick = null;
    promoCustom = new Map();

    boardEl.querySelector(".cg-wrap")?.classList.remove("promo-active");
}

/* ---------- UI rendering ---------- */
function updateButtons() {
    undoBtn.disabled = viewPly <= 0;
    redoBtn.disabled = viewPly >= fullLine.length;
}

function renderPgn() {
    pgnEl.innerHTML = buildPgnHtml(fullLine, viewPly);
}

/* Single source of truth for lastMove */
function getLastMove() {
    return computeLastMove(fullLine, viewPly);
}

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
        lastMove: getLastMove() ?? undefined,
    });

    fenLine.value = game.fen();
    fenLine.classList.remove("invalid");

    renderPgn();
    updateButtons();

    if (save && viewPly === fullLine.length) autoSavePgn();
}

/* ---------- Timeline navigation ---------- */
function goToPly(ply, { save = false } = {}) {
    viewPly = clampPly(ply, fullLine.length);
    setGameToPly(viewPly);
    sync({ save });
}

function goPrevPly() {
    goToPly(nextViewPly(viewPly, -1, fullLine.length));
}
function goNextPly() {
    goToPly(nextViewPly(viewPly, +1, fullLine.length));
}

/* ---------- Master line commit from game ---------- */
function commitFromGame() {
    fullLine = game.history({ verbose: true });
    fullPgn = game.pgn();
    const committed = applyCommit(fullLine);
    viewPly = committed.viewPly;
}

/* ---------- FEN input ---------- */
function applyFenFromInput() {
    exitPromotion();

    const fen = fenLine.value.trim().replace(/\s+/g, " ");
    if (!fen) return;

    let ok = false;

    try {
        game.load(fen);
        ok = true;
    } catch {}

    if (!ok) {
        try {
            game.load(fen, { sloppy: true });
            ok = true;
        } catch {}
    }

    if (!ok) {
        fenLine.classList.add("invalid");
        console.warn("FEN invalid:", fen);
        return;
    }

    fenLine.classList.remove("invalid");
    commitFromGame();
    goToPly(fullLine.length, { save: true });
}


/* =========================================================
   Chessground init
   ========================================================= */
const ground = Chessground(boardEl, {
    fen: game.fen(),
    orientation,
    highlight: { check: true, lastMove: true },
    movable: { free: false, color: game.turn() === "w" ? "white" : "black", dests: calcDests(game) },
    events: {
        move: (from, to) => {
            if (promoPick) return;

            // If in the past: cut future and replay truncated line before applying new move
            const edited = applyEditInPast(fullLine, viewPly);
            if (edited.line.length !== fullLine.length) {
                fullLine = edited.line;
                viewPly = edited.viewPly;
                setGameToPly(viewPly);
            }

            if (isPromotionMove(from, to)) {
                enterPromotion(from, to);
                return;
            }

            const mv = game.move({ from, to });
            if (!mv) { sync({ save: false }); return; }

            commitFromGame();
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

            commitFromGame();
            sync({ save: true });
        },
    },
});

requestAnimationFrame(ensurePromoDimmer);

/* =========================================================
   Event listeners
   ========================================================= */

// Buttons
undoBtn.addEventListener("click", goPrevPly);
redoBtn.addEventListener("click", goNextPly);

resetBtn.addEventListener("click", () => {
    exitPromotion();
    game.reset();
    commitFromGame();
    sync({ save: true });
});

flipBtn.addEventListener("click", () => {
    orientation = orientation === "white" ? "black" : "white";
    localStorage.setItem(STORAGE_ORIENTATION_KEY, orientation);
    sync({ save: false });
});

lichessBtn.addEventListener("click", () => {
    const url = lichessAnalysisUrlFromFen(game.fen(), orientation);
    window.open(url, "_blank", "noopener,noreferrer");
});

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

// PGN click -> jump
pgnEl.addEventListener("click", (e) => {
    const mv = e.target.closest(".mv");
    if (!mv) return;
    const target = parseInt(mv.dataset.ply, 10);
    const next = applyJump(viewPly, target, fullLine.length);
    goToPly(next, { save: false });
});

// Keyboard arrows
document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.key === "ArrowLeft") { e.preventDefault(); goPrevPly(); }
    if (e.key === "ArrowRight") { e.preventDefault(); goNextPly(); }
});

// FEN
fenLine.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        applyFenFromInput();
        fenLine.blur();
    }
});
fenLine.addEventListener("blur", applyFenFromInput);

btnImportPgn?.addEventListener("click", () => {
    exitPromotion?.(); // falls du exitPromotion hast; sonst weglassen
    const ok = applyPgnFromInput(pgnInput.value);
    pgnInput.classList.toggle("invalid", !ok);
});

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

    commitFromGame();
    goToPly(fullLine.length, { save: false });
})();

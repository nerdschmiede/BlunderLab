import { Chessground } from "chessground";
import { Chess } from "chess.js";

import {
    promoSquares,
    buildPgnHtml,
    nextViewPly,
    computeLastMove,
    applyEditInPast,
    applyCommit,
    applyJump,
    clampPly,
    pgnHasFenHeader,
    createStudy,
    upsertStudy,
    pickStudy,
    migrateLegacyPgn, lichessAnalysisUrl,
} from "./src/core.js";


/* =========================================================
   BlunderLab – app.js (refactored to core state helpers)
   - master line: fullLine (verbose moves)
   - cursor: viewPly (0..fullLine.length)
   - lastMove computed via core (single truth)
   - branching in past via core applyEditInPast()
   ========================================================= */

// -------------------- Storage keys --------------------
// Constants for localStorage keys. Important for migration and persistence.
const STORAGE_PGN_KEY = "blunderlab.pgn";
const STORAGE_ORIENTATION_KEY = "blunderlab.orientation";
const STORAGE_STUDIES_KEY = "blunderlab.studies.v1";
const STORAGE_ACTIVE_STUDY_KEY = "blunderlab.activeStudyId";


/* ---------- DOM ---------- */
// References to DOM elements — optional event listeners will still work if an element is missing.
const boardEl = document.getElementById("board");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const flipBtn = document.getElementById("flipBtn");
const copyPgnBtn = document.getElementById("copyPgnBtn");
const lichessBtn = document.getElementById("lichessBtn");
const fenLine = document.getElementById("fenLine");
const pgnEl = document.getElementById("pgn");
const pgnInput = document.getElementById("pgnInput");
const btnImportPgn = document.getElementById("btnImportPgn");
const studiesBtn = document.getElementById("studiesBtn");
const overlayEl = document.getElementById("overlay");
const closeOverlayBtn = document.getElementById("closeOverlayBtn");
const newStudyBtn = document.getElementById("newStudyBtn");
const studyListEl = document.getElementById("studyList");
const newStudyForm = document.getElementById("newStudyForm");
const newStudyName = document.getElementById("newStudyName");
const pickWhiteBtn = document.getElementById("pickWhite");
const pickBlackBtn = document.getElementById("pickBlack");
const cancelNewStudyBtn = document.getElementById("cancelNewStudy");


/* ---------- Game state ---------- */
// `game` is our chess engine (chess.js). All moves should be validated via this object.
const game = new Chess();
let orientation = localStorage.getItem(STORAGE_ORIENTATION_KEY) || "white";

// Core states: master line (complete move list) and cursor (viewPly)
let fullLine = [];   // verbose moves (master line)
let viewPly = 0;     // 0..fullLine.length
let fullPgn = "";    // PGN of master line

let newStudyColor = "white";

/* Promotion */
// promoPick: when null => no promotion selection active
let promoPick = null;        // { from, to, squares } | null
let promoCustom = new Map(); // Map<square, "promo">

let studies = [];          // Array<Study>
let activeStudyId = null;  // string | null

let renamingStudyId = null;

// ---------------- Persistence helpers ----------------
function loadStudiesFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_STUDIES_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.warn("Failed to parse studies:", e);
        return [];
    }
}

function saveStudiesToStorage() {
    try {
        localStorage.setItem(STORAGE_STUDIES_KEY, JSON.stringify(studies));
        if (activeStudyId) localStorage.setItem(STORAGE_ACTIVE_STUDY_KEY, activeStudyId);
    } catch (e) {
        console.warn("Failed to save studies:", e);
    }
}

function getActiveStudy() {
    return pickStudy(studies, activeStudyId);
}


/* ---------- Persistence: auto-save PGN ---------- */
// Save current `fullPgn` either into active study or as legacy PGN.
function autoSavePgn() {
    const s = getActiveStudy();

    if (!s) {
        // Fallback: keep legacy behavior so app still works without overlay state
        try {
            localStorage.setItem(STORAGE_PGN_KEY, fullPgn);
        } catch (e) {
            console.warn("Auto-save PGN failed:", e);
        }
        return;
    }

    const now = Date.now();
    const updated = { ...s, pgn: fullPgn, updatedAt: now };
    studies = upsertStudy(studies, updated);
    saveStudiesToStorage();
}


/* ---------- Chessground helpers ---------- */
// Calculate chessground destinations mapping source -> [dest,...]
function calcDests(chess) {
    const dests = new Map();
    const moves = chess.moves({ verbose: true });
    for (const m of moves) {
        if (!dests.has(m.from)) dests.set(m.from, []);
        dests.get(m.from).push(m.to);
    }
    return dests;
}

// Set `game` to the position after `ply` half-moves (0 = starting position).
// Uses `fullLine` as the source of truth.
function setGameToPly(ply) {
    const p = clampPly(ply, fullLine.length);
    game.reset();

    try {
        for (let i = 0; i < p; i++) {
            const m = fullLine[i];
            game.move({ from: m.from, to: m.to, promotion: m.promotion });
        }
    } catch {
        // Never let the app crash; restore starting position on error.
        game.reset();
    }
}


// Purely checks from the current position whether a normal move would be a promotion.
function isPromotionMove(from, to) {
    const p = game.get(from);
    if (!p || p.type !== "p") return false;
    const rank = to[1];
    return (p.color === "w" && rank === "8") || (p.color === "b" && rank === "1");
}

function cgColor(chessColor) {
    return chessColor === "w" ? "white" : "black";
}

// ---------------- PGN Import ----------------
// Try to load a PGN from text. On error, restore previous state.
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


// Apply study defaults (e.g. orientation)
function applyStudyDefaults(study) {
    const o = study.color === "black" ? "black" : "white";

    // update the app-level orientation state
    orientation = o;
    try { localStorage.setItem(STORAGE_ORIENTATION_KEY, o); } catch {}

    // trigger a render path without saving
    sync({ save: false });
}




/* ---------- Promotion UI ---------- */
// Ensure a semi-transparent dimmer under promo pieces exists (visual only).
function ensurePromoDimmer() {
    const wrap = boardEl.querySelector(".cg-wrap");
    if (!wrap) return;

    if (!wrap.querySelector(".promo-dimmer")) {
        const dim = document.createElement("div");
        dim.className = "promo-dimmer";
        wrap.appendChild(dim);
    }
}

// Enter promotion selection: draw four pieces and lock normal moves.
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

// Exit promotion mode and clear promo markers.
function exitPromotion() {
    if (!promoPick) return;

    const [a, b, c, d] = promoPick.squares;
    ground.setPieces(new Map([[a, null], [b, null], [c, null], [d, null]]));

    promoPick = null;
    promoCustom = new Map();

    boardEl.querySelector(".cg-wrap")?.classList.remove("promo-active");
}

/* ---------- UI rendering ---------- */
// Enable/disable buttons based on viewPly.
function updateButtons() {
    undoBtn.disabled = viewPly <= 0;
    redoBtn.disabled = viewPly >= fullLine.length;
}

// Render PGN into the UI element (core.buildPgnHtml generates HTML).
function renderPgn() {
    pgnEl.innerHTML = buildPgnHtml(fullLine, viewPly);
}

/* Single source of truth for lastMove */
function getLastMove() {
    return computeLastMove(fullLine, viewPly);
}

// Sync: mirror `game` and app state into Chessground & UI; optional save via autoSavePgn().
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

/* --------------Overlay / Studies ------------------------- */


function renderOverlayList() {
    if (!studyListEl) return;

    // newest first
    const sorted = studies.slice().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

    studyListEl.innerHTML = "";

    for (const s of sorted) {
        const item = document.createElement("div");
        item.className = "study-item";

        const meta = document.createElement("div");
        meta.className = "study-meta";

        if (renamingStudyId === s.id) {
            // --- Rename mode ---
            const input = document.createElement("input");
            input.className = "study-rename input-box";
            input.type = "text";
            input.value = s.name;

            // Focus after render
            setTimeout(() => input.focus(), 0);

            const commit = () => {
                const name = input.value.trim();
                renamingStudyId = null;

                if (!name || name === s.name) {
                    renderOverlayList();
                    return;
                }

                const updated = { ...s, name, updatedAt: Date.now() };
                studies = upsertStudy(studies, updated);
                saveStudiesToStorage();
                renderOverlayList();
            };

            const cancel = () => {
                renamingStudyId = null;
                renderOverlayList();
            };

            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") cancel();
            });

            input.addEventListener("blur", commit);

            meta.appendChild(input);
        } else {
            // --- Normal display mode ---
            const name = document.createElement("div");
            name.className = "study-name";
            name.textContent = s.name;

            const sub = document.createElement("div");
            sub.className = "study-sub";
            // Show study color and active marker in English
            sub.textContent =
                `${s.color === "black" ? "Black" : "White"}${s.id === activeStudyId ? " · active" : ""}`;

            meta.appendChild(name);
            meta.appendChild(sub);
        }


        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "8px";

        const renameBtn = document.createElement("button");
        renameBtn.className = "iconbtn";
        renameBtn.type = "button";
        renameBtn.title = "Rename";
        renameBtn.textContent = "✎";
        renameBtn.addEventListener("click", () => {
            renamingStudyId = s.id;
            renderOverlayList();
            // Focus is set when the input appears (see above)
        });
        actions.appendChild(renameBtn);

        const openBtn = document.createElement("button");
        openBtn.className = "iconbtn";
        openBtn.type = "button";
        openBtn.title = "Open";
        openBtn.textContent = "↩";
        openBtn.addEventListener("click", () => {
            selectStudy(s.id);
            closeOverlay();
        });

        const delBtn = document.createElement("button");
        delBtn.className = "iconbtn";
        delBtn.type = "button";
        delBtn.title = "Delete";
        delBtn.textContent = "🗑";
        delBtn.addEventListener("click", () => {
            const ok = window.confirm(`Delete opening: "${s.name}"?`);
            if (!ok) return;
            deleteStudy(s.id);
            renderOverlayList();
        });

        actions.appendChild(openBtn);
        actions.appendChild(delBtn);

        item.appendChild(meta);
        item.appendChild(actions);
        studyListEl.appendChild(item);
    }
}

function openOverlay() {
    if (!overlayEl) return;
    overlayEl.classList.remove("hidden");
    overlayEl.setAttribute("aria-hidden", "false");
    renderOverlayList();
}

function closeOverlay() {
    if (!overlayEl) return;
    overlayEl.classList.add("hidden");
    overlayEl.setAttribute("aria-hidden", "true");
}

// Switch to the given study; save current study PGN before switching
function selectStudy(id) {
    // Save current study's PGN into its record before switching
    const current = getActiveStudy();
    if (current) {
        studies = upsertStudy(studies, { ...current, pgn: fullPgn, updatedAt: Date.now() });
    }

    activeStudyId = id;
    saveStudiesToStorage();

    const next = getActiveStudy();
    if (!next) return;

    applyStudyDefaults(next);

    // Load the study's PGN into the app state
    game.reset();
    if (next.pgn) {
        try {
            game.loadPgn(next.pgn);
        } catch (e) {
            console.warn("Study PGN invalid, resetting:", e);
            game.reset();
        }
    }

    commitFromGame();
    goToPly(fullLine.length, { save: false });
}

function deleteStudy(id) {
    studies = studies.filter(s => s.id !== id);

    if (activeStudyId === id) {
        activeStudyId = studies[0]?.id ?? null;
        saveStudiesToStorage();

        if (activeStudyId) {
            selectStudy(activeStudyId);
        } else {
            // No studies left: reset board
            game.reset();
            commitFromGame();
            goToPly(0, { save: false });
            openOverlay();
        }
        return;
    }

    saveStudiesToStorage();
}

function openNewStudyForm() {
    newStudyColor = "white";
    pickWhiteBtn?.classList.add("active");
    pickBlackBtn?.classList.remove("active");

    newStudyForm?.classList.remove("hidden");
    newStudyName.value = "";
    newStudyName?.focus();
}

function closeNewStudyForm() {
    newStudyForm?.classList.add("hidden");
}

pickWhiteBtn?.addEventListener("click", () => {
    newStudyColor = "white";
    pickWhiteBtn.classList.add("active");
    pickBlackBtn.classList.remove("active");
});

pickBlackBtn?.addEventListener("click", () => {
    newStudyColor = "black";
    pickBlackBtn.classList.add("active");
    pickWhiteBtn.classList.remove("active");
});

cancelNewStudyBtn?.addEventListener("click", closeNewStudyForm);

newStudyBtn?.addEventListener("click", openNewStudyForm);

newStudyForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = (newStudyName.value || "").trim();
    if (!name) return;

    const s = createStudy({ name, color: newStudyColor });
    studies = upsertStudy(studies, s);
    activeStudyId = s.id;
    saveStudiesToStorage();

    // new study starts empty
    game.reset();
    commitFromGame();
    goToPly(0, { save: false });

    applyStudyDefaults(s);   // <- orientation, see above
    closeNewStudyForm();
    closeOverlay();
});

/* ---------- Timeline navigation ---------- */
// Timeline navigation: set viewPly and re-render the board.
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
// Update fullLine/fullPgn from the `game` object and let core.applyCommit
// compute viewPly/branching details.
function commitFromGame() {
    fullLine = game.history({ verbose: true });
    fullPgn = game.pgn();
    const committed = applyCommit(fullLine);
    viewPly = committed.viewPly;
}

/* ---------- FEN input ---------- */
// Try to load a FEN string; validate and use sloppy fallback if needed.
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

flipBtn.addEventListener("click", () => {
    orientation = orientation === "white" ? "black" : "white";
    localStorage.setItem(STORAGE_ORIENTATION_KEY, orientation);
    sync({ save: false });
});

lichessBtn.addEventListener("click", () => {
    const url = lichessAnalysisUrl({
        pgn: fullPgn,
        fen: game.fen(),
        orientation
    });
    window.open(url, "_blank", "noopener,noreferrer");
});

function stripPgnHeaders(pgn) {
    if (!pgn) return "";
    const parts = pgn.split(/\r?\n\r?\n/);
    return parts.length > 1 ? parts.slice(1).join("\n\n").trim() : pgn.trim();
}

copyPgnBtn.addEventListener("click", async () => {
    const rawPgn = fullPgn || game.pgn();
    const pgn = stripPgnHeaders(rawPgn);

    try {
        await navigator.clipboard.writeText(pgn);
        copyPgnBtn.textContent = "✓";
        setTimeout(() => (copyPgnBtn.textContent = "Export PGN"), 800);
    } catch {
        window.prompt("Copy PGN (Ctrl+C):", pgn);
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

studiesBtn?.addEventListener("click", openOverlay);
closeOverlayBtn?.addEventListener("click", closeOverlay);


// Click on backdrop closes too
overlayEl?.addEventListener("click", (e) => {
    if (e.target === overlayEl) closeOverlay();
});


/* =========================================================
   Boot: load saved PGN and start at end
   ========================================================= */
(function boot() {
    // 1) Load studies + active id
    studies = loadStudiesFromStorage();
    activeStudyId = localStorage.getItem(STORAGE_ACTIVE_STUDY_KEY);

    // 2) Legacy migration (old single-PGN key) if no studies exist
    const legacyPgn = localStorage.getItem(STORAGE_PGN_KEY);
    const migrated = migrateLegacyPgn({ legacyPgn, existingStudies: studies });

    studies = migrated.studies;
    if (!activeStudyId) activeStudyId = migrated.activeStudyId;

    saveStudiesToStorage();

    // 3) If we have a study, load it. Otherwise start empty + open overlay.
    const s = getActiveStudy();
    if (s?.pgn) {
        try {
            game.loadPgn(s.pgn);
        } catch (e) {
            console.warn("Failed to load active study PGN:", e);
            game.reset();
        }
    } else {
        game.reset();
    }

    commitFromGame();
    goToPly(fullLine.length, { save: false });

    if (!getActiveStudy()) openOverlay();
})();

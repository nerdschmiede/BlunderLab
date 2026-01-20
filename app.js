import { Chessground } from "chessground";
import { Chess } from "chess.js";

import {
    lichessAnalysisUrlFromFen,
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

const STORAGE_PGN_KEY = "blunderlab.pgn";
const STORAGE_ORIENTATION_KEY = "blunderlab.orientation";
const STORAGE_STUDIES_KEY = "blunderlab.studies.v1";
const STORAGE_ACTIVE_STUDY_KEY = "blunderlab.activeStudyId";


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
const game = new Chess();
let orientation = localStorage.getItem(STORAGE_ORIENTATION_KEY) || "white";

let fullLine = [];   // verbose moves (master line)
let viewPly = 0;     // 0..fullLine.length
let fullPgn = "";    // PGN of master line

let newStudyColor = "white";

/* Promotion */
let promoPick = null;        // { from, to, squares } | null
let promoCustom = new Map(); // Map<square, "promo">

let studies = [];          // Array<Study>
let activeStudyId = null;  // string | null

let renamingStudyId = null;

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


/* ---------- Persistence ---------- */
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


function applyStudyDefaults(study) {
    const o = study.color === "black" ? "black" : "white";

    // update the app-level orientation state (whatever you use elsewhere)
    orientation = o;
    try { localStorage.setItem(STORAGE_ORIENTATION_KEY, o); } catch {}

    // let your normal render path apply it
    sync({ save: false });
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

/* --------------Overlay------------------------- */


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

            // Fokus nach dem Render
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
            sub.textContent =
                `${s.color === "black" ? "Schwarz" : "Weiß"}${s.id === activeStudyId ? " · aktiv" : ""}`;

            meta.appendChild(name);
            meta.appendChild(sub);
        }


        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "8px";

        const renameBtn = document.createElement("button");
        renameBtn.className = "iconbtn";
        renameBtn.type = "button";
        renameBtn.title = "Umbenennen";
        renameBtn.textContent = "✎";
        renameBtn.addEventListener("click", () => {
            renamingStudyId = s.id;
            renderOverlayList();
            // Fokus setzen passiert gleich beim Input (siehe unten)
        });
        actions.appendChild(renameBtn);

        const openBtn = document.createElement("button");
        openBtn.className = "iconbtn";
        openBtn.type = "button";
        openBtn.title = "Öffnen";
        openBtn.textContent = "↩";
        openBtn.addEventListener("click", () => {
            selectStudy(s.id);
            closeOverlay();
        });

        const delBtn = document.createElement("button");
        delBtn.className = "iconbtn";
        delBtn.type = "button";
        delBtn.title = "Löschen";
        delBtn.textContent = "🗑";
        delBtn.addEventListener("click", () => {
            const ok = window.confirm(`Eröffnung löschen: "${s.name}"?`);
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

    applyStudyDefaults(s);   // <- Orientierung, siehe Punkt 2
    closeNewStudyForm();
    closeOverlay();
});

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

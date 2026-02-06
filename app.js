import {Chess} from "chess.js";
import {Chessground} from "chessground";

import {
    createTreeSession,
    createRoot,
    addVariationAndGo,
    goBack,
    goForwardIfExists,
    currentNode,
    isExpectedMove,
    resetSessionToRoot,
    createOpening,
    loadFromStorage,
    saveToStorage,
    DEFAULT_STORAGE_KEY,
} from "./src/tree.js";

// -------------------- DOM --------------------
const pgnLineEl = document.getElementById("pgn-line");

const boardEl = document.getElementById("board");

const editBtn = document.getElementById("editBtn");
const trainBtn = document.getElementById("trainBtn");

const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const flipBtn = document.getElementById("flipBtn");
const lichessBtn = document.getElementById("lichessBtn");
const menuBtn = document.getElementById("menuBtn");

const backdrop = document.getElementById("overlayBackdrop");
const overlay = document.getElementById("openingsOverlay");
const closeOverlayBtn = document.getElementById("closeOverlayBtn");
const openingsList = document.getElementById("openingsList");

const newOpeningBtn = document.getElementById("newOpeningBtn");

const openingDialog = document.getElementById("openingDialog");
const openingNameInput = document.getElementById("openingNameInput");

const trainAsWhiteBtn = document.getElementById("trainAsWhiteBtn");
const trainAsBlackBtn = document.getElementById("trainAsBlackBtn");

const dialogOkBtn = document.getElementById("dialogOkBtn");
const dialogCancelBtn = document.getElementById("dialogCancelBtn");
const closeDialogBtn = document.getElementById("closeDialogBtn");


// -------------------- App state --------------------
let appState = initAppState(localStorage);

let mode = "edit"; // "edit" | "train" (train is stub for now)
let orientation = "white";

let game = new Chess();
let ground = null;

// Tree session is the truth for the "current line"
let treeSession = createTreeSession(createRoot());

// redo stack stores nodes we popped (navigation only)
let redoStack = [];

// Promotion UI state
let promoPick = null;      // { from, to, squares: [..] }
let promoCustom = new Map();

const boardUserMoveEvents = {after: onUserMove};

let dialogTrainAs = "white";
let dialogMode = "create";   // "create" | "rename"
let dialogTargetId = null;   // opening id


// -------------------- Init --------------------
initGround();
wireUi();

renderModeButtons();

selectOpening(appState.activeOpeningId);

// Appstate laden, ggf. Erststart-Setup durchführen (z.B. Demo-Opening anlegen, active id fixen)
function initAppState(storage) {
    let state = loadFromStorage(storage, DEFAULT_STORAGE_KEY);

    // Erststart: mindestens eine Opening
    if (state.openings.length === 0) {
        state.openings.push(createOpening({name: "Italienisch", trainAs: "white"}));
        state.openings.push(createOpening({name: "Caro-Kann", trainAs: "black"}));
        state.activeOpeningId = state.openings[0].id;
        saveToStorage(state, storage, DEFAULT_STORAGE_KEY);
    }

    // active id reparieren
    const activeIsValid =
        state.activeOpeningId &&
        state.openings.some((o) => o.id === state.activeOpeningId);

    if (!activeIsValid) {
        state.activeOpeningId = state.openings[0]?.id ?? null;
        saveToStorage(state, storage, DEFAULT_STORAGE_KEY);
    }

    return state;
}


// -------------------- Chessground init --------------------
function initGround() {
    ground = Chessground(boardEl, {
        fen: game.fen(),
        orientation,
        coordinates: true,
        highlight: {check: true, lastMove: true},
        movable: {
            free: false,
            color: "white",
            dests: calcDests(game),
            events: boardUserMoveEvents,
        },
        events: {
            select: onBoardSelect,
        },
    });

    // promotion dimmer (optional visual)
    ensurePromoDimmer();
}

// -------------------- Move handling --------------------
function onUserMove(from, to) {
    if (isPromotionOverlayActive()) return;

    if (isPromotionMove(from, to)) {
        startPromotionFlow(from, to);
        return;
    }

    const moveKey = {from, to};

    if (mode === "train") {
        applyTrainingMove(moveKey);
        return;
    }

    applyEditMove(moveKey);
}

/* ---------------- User Move helpers ---------------- */

function isPromotionOverlayActive() {
    return promoPick === true;
}

function applyEditMove(mv) {
    // Zug im Game testen
    const legalMove = tryGameMove(mv);
    if (!legalMove) {
        syncBoardOnly();
        return;
    }

    addMoveToTree(legalMove);
    persistAppState();
    clearRedoHistory();
    syncUi();
}

function addMoveToTree(mv) {
    addVariationAndGo(treeSession, {
        from: mv.from,
        to: mv.to,
        promotion: mv.promotion,
    });
    console.log("children of active root:", appState.openings.find(o => o.id === appState.activeOpeningId).root.children.length);
}

function clearRedoHistory() {
    redoStack = [];
}

function applyTrainingMove(moveKey) {
    const ok = isExpectedMove(treeSession, moveKey);
    if (ok) goForwardIfExists(treeSession, moveKey);
    else flashWrong();

    resetPositionFromSession();
}

/* ---------------- training helpers ---------------- */
function startTraining() {
    resetSessionToRoot(treeSession);
    resetPositionFromSession();
}

function flashWrong() {
    const el = document.getElementById("board");
    if (!el) return;

    el.classList.add("shake");
    setTimeout(() => el.classList.remove("shake"), 300);
}

function resetPositionFromSession() {
    replaySessionToGame();
    syncUi();
}

/* -------------------- Board select handling (for promotion) -------------------- */

function onBoardSelect(key) {
    if (!promoPick) return;

    const idx = promoPick.squares.indexOf(key);
    if (idx === -1) return;

    const promotion = ["q", "n", "r", "b"][idx];

    const mv = tryGameMove({
        from: promoPick.from,
        to: promoPick.to,
        promotion,
    });

    exitPromotion();

    if (!mv) {
        syncBoardOnly();
        return;
    }

    addVariationAndGo(treeSession, {
        from: mv.from,
        to: mv.to,
        promotion: mv.promotion,
    });

    redoStack = [];
    syncUi();
}

function tryGameMove(moveObj) {
    try {
        return game.move(moveObj);
    } catch {
        return null;
    }
}

// -------------------- Navigation: Undo/Redo via Tree path --------------------
function undo() {
    if (promoPick) return;

    const cur = currentNode(treeSession);     // <-- session übergeben
    if (cur === treeSession.root) return;

    const res = goBack(treeSession);
    if (!res.ok) return;

    // erst NACH erfolgreichem goBack fürs redo merken
    if (cur.move) redoStack.push(cur.move);

    replaySessionToGame();
    syncUi();
}


function redo() {
    if (promoPick) return;

    const mv = redoStack.pop();
    if (!mv) return;

    const res = goForwardIfExists(treeSession, mv);
    if (!res.ok) return;

    replaySessionToGame();
    syncUi();
}

// -------------------- Replay (Tree -> Game/UI) --------------------
function replaySessionToGame() {
    game = new Chess();
    for (const mv of getSessionMoves(treeSession)) {
        const ok = game.move(mv);
        if (!ok) {
            console.warn("Illegal move in tree:", mv);
            break;
        }
    }
}

function getSessionMoves(session) {
    // derives current mainline from session.path
    const moves = [];
    for (const node of session.path) {
        if (node.move) moves.push(node.move);
    }
    return moves;
}

// -------------------- Sync UI --------------------
function syncUi() {
    syncBoardOnly();
    syncTextOnly();
    updateUndoRedoState();
    renderModeButtons();
    logTree();
}

function scrollPgnLineToEnd() {
    requestAnimationFrame(() => {
        pgnLineEl.scrollLeft = pgnLineEl.scrollWidth;
    });
}

function syncPgnLine() {
    if (!pgnLineEl) return;

    const moves = game.history(); // SAN
    pgnLineEl.textContent = moves.length
        ? movesToInlineText(moves)
        : "";

    scrollPgnLineToEnd();
}

function movesToInlineText(moves) {
    let out = [];
    for (let i = 0; i < moves.length; i += 2) {
        const no = i / 2 + 1;
        const w = moves[i];
        const b = moves[i + 1];
        out.push(`${no}. ${w}${b ? " " + b : ""}`);
    }
    return out.join(" ");
}


function syncBoardOnly() {
    ground.set({
        fen: game.fen(),
        orientation,
        movable: {
            free: false,
            color: "both",
            dests: calcDests(game),
            events: boardUserMoveEvents,
        },
        highlight: {check: true, lastMove: true, custom: promoCustom},
    });
}

function syncTextOnly() {
    syncPgnLine();
}

function updateUndoRedoState() {
    if (undoBtn) undoBtn.disabled = treeSession.path.length <= 1;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

// -------------------- Mode toggle --------------------
function setMode(nextMode) {
    if (mode === nextMode) return;

    mode = nextMode;

    if (mode === "train") {
        startTraining();
        return;
    }

    // edit mode
    syncUi();
}

function renderModeButtons() {
    if (!editBtn || !trainBtn) return;

    const isTrain = mode === "train";

    editBtn.classList.toggle("active", !isTrain);
    editBtn.setAttribute("aria-pressed", String(!isTrain));

    trainBtn.classList.toggle("active", isTrain);
    trainBtn.setAttribute("aria-pressed", String(isTrain));
}

// -------------------- Flip / Lichess ----------------------------
function flipBoard() {
    orientation = orientation === "white" ? "black" : "white";
    syncBoardOnly();
}

function openLichessAnalysis({myColor = "white"} = {}) {
    // SAN-Liste bis zur aktuellen Position (genau dein "Weg")
    const moves = game.history(); // z.B. ["e4","c5","Nf3",...]
    const ply = moves.length;

    // Lichess erwartet im /analysis/pgn/ Pfad die Moves, getrennt mit '+'
    // Wichtig: jede SAN-Notation einzeln encoden (wegen #, +, etc.)
    const pgnPath = moves.map(encodeURIComponent).join("+");

    const url = `https://lichess.org/analysis/pgn/${pgnPath}?color=${myColor}#${ply}`;
    window.open(url, "_blank", "noopener,noreferrer");
}

// -------------------- Promotion UI (yours, kept minimal) --------------------
function ensurePromoDimmer() {
    const wrap = boardEl.querySelector(".cg-wrap");
    if (!wrap) return;

    if (!wrap.querySelector(".promo-dimmer")) {
        const dim = document.createElement("div");
        dim.className = "promo-dimmer";
        wrap.appendChild(dim);
    }
}

function isPromotionMove(from, to) {
    const piece = game.get(from);
    if (!piece || piece.type !== "p") return false;

    const rank = to[1];
    return (piece.color === "w" && rank === "8") || (piece.color === "b" && rank === "1");
}

function startPromotionFlow(from, to) {
    const chessColor = game.get(from).color; // "w" | "b"
    const squares = promoSquares(to, chessColor);
    promoPick = {from, to, squares};

    const c = chessColor === "w" ? "white" : "black";

    ground.setPieces(new Map([
        [squares[0], {role: "queen", color: c}],
        [squares[1], {role: "knight", color: c}],
        [squares[2], {role: "rook", color: c}],
        [squares[3], {role: "bishop", color: c}],
    ]));

    promoCustom = new Map(squares.map(sq => [sq, "promo"]));

    ground.set({
        movable: {free: false, color: undefined, dests: new Map()},
        highlight: {check: true, lastMove: true, custom: promoCustom},
    });

    const wrap = boardEl.querySelector(".cg-wrap");
    if (wrap) {
        wrap.classList.add("promo-active");
    }
}

function exitPromotion() {
    if (!promoPick) return;

    const [a, b, c, d] = promoPick.squares;
    ground.setPieces(new Map([[a, null], [b, null], [c, null], [d, null]]));

    promoPick = null;
    promoCustom = new Map();

    const wrap = boardEl.querySelector(".cg-wrap");
    if (wrap) {
        wrap.classList.remove("promo-active");
    }
}


// Decide 4 squares used for picking promotion pieces.
// This matches your "overlay pieces on squares" approach.
function promoSquares(to, chessColor) {
    // Place 4 choices on a file, ending at 'to'.
    // For white promotion (to rank 8): show on ranks 8,7,6,5
    // For black promotion (to rank 1): show on ranks 1,2,3,4
    const file = to[0];
    const ranks = chessColor === "w" ? ["8", "7", "6", "5"] : ["1", "2", "3", "4"];
    return ranks.map(r => file + r);
}


// -------------------- Dests helper --------------------
function calcDests(g) {
    const dests = new Map();
    for (const m of g.moves({verbose: true})) {
        if (!dests.has(m.from)) dests.set(m.from, []);
        dests.get(m.from).push(m.to);
    }
    return dests;
}

// -------------------- Overlay Menu --------------------

function openOverlay() {
    backdrop.classList.remove("hidden");
    overlay.classList.remove("hidden");
    backdrop.setAttribute("aria-hidden", "false");

    renderOpenings();
}

function closeOverlay() {
    overlay.classList.add("hidden");
    backdrop.classList.add("hidden");
    backdrop.setAttribute("aria-hidden", "true");
}


function persistAppState() {
    updateLastPathFromSession();
    saveToStorage(appState, localStorage, DEFAULT_STORAGE_KEY);
}

function updateLastPathFromSession() {
    const opening = appState.openings.find((o) => o.id === appState.activeOpeningId) || null;
    if (!opening) return;

    const path = [];
    for (const node of treeSession.path) {
        const m = node?.move;
        if (!m) continue; // root / null moves
        path.push({
            from: m.from,
            to: m.to,
            ...(m.promotion ? { promotion: m.promotion } : {}),
        });
    }

    opening.lastPath = path;
}

function selectOpening(id) {
    const opening = appState.openings.find(x => x.id === id);
    if (!opening) return;

    appState.activeOpeningId = id;

    orientation = orientationForTrainAs(opening.trainAs);
    treeSession = createTreeSession(opening.root);

    restoreLastPathIntoSession(opening, treeSession);
    resetPositionFromSession();

    persistAppState();

    renderOpenings();
}

function restoreLastPathIntoSession(opening, session) {
    const path = Array.isArray(opening.lastPath) ? opening.lastPath : [];
    for (const mv of path) {
        const res = goForwardIfExists(session, mv);
        if (!res.ok) break;
    }
}


function renderOpenings() {
    openingsList.innerHTML = "";

    for (const o of appState.openings) {
        const li = document.createElement("li");
        li.className = "opening-row" + (o.id === appState.activeOpeningId ? " active" : "");

        li.innerHTML = `
  <div class="opening-meta">
    <strong>${o.name}</strong>
    <div class="badge">Train as: ${o.trainAs}</div>
  </div>
  <div class="opening-actions">
    <button class="iconbtn open-btn" type="button" aria-label="Öffnen" title="Öffnen">▶︎</button>
    <button class="iconbtn rename-btn" type="button" aria-label="Umbenennen" title="Umbenennen">✎</button>
    <button class="iconbtn delete-btn" type="button" aria-label="Löschen" title="Löschen">✕</button>
  </div>

`;

        li.querySelector(".open-btn").addEventListener("click", () => {
            selectOpening(o.id);
            closeOverlay();
        });

        li.querySelector(".rename-btn").addEventListener("click", () => {
            openRenameDialog(o.id);
        });

        li.querySelector(".delete-btn").addEventListener("click", () => {
            deleteOpening(o.id);
        });


        openingsList.appendChild(li);
    }
}


function openCreateDialog() {
    dialogMode = "create";
    dialogTargetId = null;

    dialogTrainAs = "white";
    updateTrainAsButtons();

    openingNameInput.value = "";
    openingDialog.classList.remove("hidden");

    // backdrop muss sichtbar sein, falls Dialog auch ohne Overlay geöffnet wird
    backdrop.classList.remove("hidden");
    backdrop.setAttribute("aria-hidden", "false");

    openingNameInput.focus();
}

function closeOpeningDialog() {
    openingDialog.classList.add("hidden");
    dialogMode = "create";
    dialogTargetId = null;
}

function submitOpeningFromDialog() {
    const name = openingNameInput.value.trim();
    if (!name) return {ok: false, reason: "empty-name"};

    if (dialogMode === "create") {
        const o = createOpening({name, trainAs: dialogTrainAs});
        appState.openings.push(o);
        persistAppState();

        selectOpening(o.id);

        closeOpeningDialog();
        closeOverlay();

        return {ok: true, opening: o};
    }

    if (dialogMode === "rename") {
        const o = appState.openings.find(x => x.id === dialogTargetId);
        if (!o) return {ok: false, reason: "missing-opening"};

        o.name = name;
        // trainAs beim Rename NICHT ändern (würde ich fürs MVP weglassen)

        persistAppState();
        renderOpenings();

        closeOpeningDialog();
        // Overlay bleibt offen beim Rename ist meist angenehmer
        return {ok: true, opening: o};
    }

    return {ok: false, reason: "unknown-mode"};
}

function openRenameDialog(openingId) {
    const o = appState.openings.find(x => x.id === openingId);
    if (!o) return;

    dialogMode = "rename";
    dialogTargetId = openingId;

    openingNameInput.value = o.name;
    dialogTrainAs = o.trainAs;     // anzeigen ok
    updateTrainAsButtons();        // du kannst Buttons beim Rename auch disable'n

    openingDialog.classList.remove("hidden");
    backdrop.classList.remove("hidden");
    backdrop.setAttribute("aria-hidden", "false");
    openingNameInput.focus();
}

function deleteOpening(id) {
    const o = appState.openings.find(x => x.id === id);
    if (!o) return;

    const ok = confirm(`Eröffnung "${o.name}" wirklich löschen?`);
    if (!ok) return;

    const idx = appState.openings.findIndex(x => x.id === id);
    appState.openings.splice(idx, 1);

    // aktive Opening reparieren
    if (appState.activeOpeningId === id) {
        appState.activeOpeningId = appState.openings[0]?.id ?? null;

        if (appState.activeOpeningId) {
            const next = appState.openings.find(x => x.id === appState.activeOpeningId);
            treeSession = createTreeSession(next.root);
            resetPositionFromSession();
        }
    }

    persistAppState();
    renderOpenings();

    if (appState.openings.length === 0) {
        const o = createOpening({name: "Meine Eröffnung", trainAs: "white"});
        appState.openings.push(o);
        appState.activeOpeningId = o.id;
    }

}

function updateTrainAsButtons() {
    trainAsWhiteBtn.classList.toggle("active", dialogTrainAs === "white");
    trainAsBlackBtn.classList.toggle("active", dialogTrainAs === "black");
}

function orientationForTrainAs(trainAs) {
    return trainAs === "black" ? "black" : "white";
}



// -------------------- UI wiring --------------------
function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    return (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        el.isContentEditable
    );
}

function onKeyDown(e) {
    // nicht in Formularfeldern o.ä. abfangen
    if (isTypingTarget(e.target)) return;

    // optional: wenn dein Studies-Overlay offen ist, nicht eingreifen
    // if (isStudiesOverlayOpen()) return;

    if (e.key === "ArrowLeft") {
        e.preventDefault();
        undo();
    } else if (e.key === "ArrowRight") {
        e.preventDefault();
        redo();
    }
}

function wireUi() {
    editBtn?.addEventListener("click", () => setMode("edit"));
    trainBtn?.addEventListener("click", () => setMode("train"));

    undoBtn?.addEventListener("click", undo);
    redoBtn?.addEventListener("click", redo);

    flipBtn?.addEventListener("click", flipBoard);
    lichessBtn?.addEventListener("click", openLichessAnalysis);

    menuBtn?.addEventListener("click", () => {
        const isHidden = overlay.classList.contains("hidden");
        if (isHidden) openOverlay();
        else closeOverlay();
    });

    closeOverlayBtn?.addEventListener("click", closeOverlay);
    backdrop?.addEventListener("click", closeOverlay);

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeOverlay();
    });

    newOpeningBtn.addEventListener("click", openCreateDialog);

    trainAsWhiteBtn.addEventListener("click", () => {
        dialogTrainAs = "white";
        updateTrainAsButtons();
    });

    trainAsBlackBtn.addEventListener("click", () => {
        dialogTrainAs = "black";
        updateTrainAsButtons();
    });

    dialogCancelBtn.addEventListener("click", closeOpeningDialog);
    closeDialogBtn.addEventListener("click", closeOpeningDialog);

    dialogOkBtn.addEventListener("click", submitOpeningFromDialog);
    openingNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submitOpeningFromDialog();
    });

    window.addEventListener("keydown", onKeyDown);
}

/* Tree logger (for debugging) --------------------------------------------*/
function moveToUci(m) {
    return `${m.from}${m.to}${m.promotion || ""}`;
}

function lineToText(line) {
    let out = [];
    for (let i = 0; i < line.length; i += 2) {
        const no = i / 2 + 1;
        const w = moveToUci(line[i]);
        const b = line[i + 1] ? moveToUci(line[i + 1]) : null;
        out.push(`${no}. ${w}${b ? " " + b : ""}`);
    }
    return out.join(" ");
}

function getAllLinesFromRoot(root) {
    const lines = [];
    const current = [];

    function dfs(node) {
        if (node.move) current.push(node.move);

        if (!node.children || node.children.length === 0) {
            lines.push(current.slice());
        } else {
            for (const ch of node.children) dfs(ch);
        }

        if (node.move) current.pop();
    }

    dfs(root);
    return lines;
}

function logTree() {
    const lines = getAllLinesFromRoot(treeSession.root);
    console.group(`TREE (${lines.length} line(s))`);
    lines.forEach((line, i) => {
        console.log(`${i + 1}: ${lineToText(line)}`);
    });

    const pathMoves = getSessionMoves(treeSession);
    console.log("PATH:", pathMoves.length ? lineToText(pathMoves) : "(root)");
    console.groupEnd();
}
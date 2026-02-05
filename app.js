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
    resetSessionToRoot
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

// -------------------- App state --------------------
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

const boardUserMoveEvents = { after: onUserMove };

// -------------------- Init --------------------
initGround();
wireUi();

renderModeButtons();

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

    const moveKey = { from, to };

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
    clearRedoHistory();
    syncUi();
}

function addMoveToTree(mv) {
    addVariationAndGo(treeSession, {
        from: mv.from,
        to: mv.to,
        promotion: mv.promotion,
    });
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
    for (const m of g.moves({ verbose: true })) {
        if (!dests.has(m.from)) dests.set(m.from, []);
        dests.get(m.from).push(m.to);
    }
    return dests;
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



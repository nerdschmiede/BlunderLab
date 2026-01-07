import { Chessground } from "https://esm.sh/chessground@9.2.1";
import { Chess } from "https://esm.sh/chess.js@1.0.0";

const boardEl = document.getElementById("board");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const resetBtn = document.getElementById("resetBtn");

const fenLine = document.getElementById("fenLine");


const game = new Chess();
const redoStack = [];          // speichert undone moves für Redo
let lastMove = null;           // [from, to] für Lichess-Highlight

function calcDests(chess) {
    const dests = new Map();
    const moves = chess.moves({ verbose: true });
    for (const m of moves) {
        if (!dests.has(m.from)) dests.set(m.from, []);
        dests.get(m.from).push(m.to);
    }
    return dests;
}

function updateButtons() {
    undoBtn.disabled = game.history().length === 0;
    redoBtn.disabled = redoStack.length === 0;
}
function sync() {
    const inCheck = game.isCheck();
    const checkColor = inCheck ? (game.turn() === "w" ? "white" : "black") : false;

    const arrow = lastMove ? [{ orig: lastMove[0], dest: lastMove[1] }] : [];

    ground.set({
        fen: game.fen(),
        check: checkColor,
        highlight: { check: true, lastMove: true },
        lastMove: lastMove ?? undefined,

        // ✅ Pfeil wie auf Lichess
        drawable: {
            autoShapes: arrow,
        },

        movable: {
            free: false,
            color: game.turn() === "w" ? "white" : "black",
            dests: calcDests(game),
        },

    });

    // FEN-Zeile aktuell halten
    fenLine.value = game.fen();
    fenLine.classList.remove("invalid");

    updateButtons();
}

const ground = Chessground(boardEl, {
    fen: game.fen(),
    orientation: "white",

    highlight: { check: true, lastMove: true },
    movable: {
        free: false,
        color: "white",
        dests: calcDests(game),
    },
    events: {
        move: (from, to) => {
            // neue Eingabe -> redo invalid
            redoStack.length = 0;

            // Promotion erstmal automatisch zur Dame
            const move = game.move({ from, to, promotion: "q" });

            if (!move) {
                // sollte selten sein, da dests legal sind
                sync();
                return;
            }

            lastMove = [from, to];
            sync();
        },
    },
});

// Undo
undoBtn.addEventListener("click", () => {
    const undone = game.undo();
    if (!undone) return;

    // chess.js liefert verbose move zurück -> kann man für redo wiederverwenden
    redoStack.push(undone);

    // lastMove nach Undo: das neue letzte Move in der History anzeigen (oder null)
    const hist = game.history({ verbose: true });
    const prev = hist.length ? hist[hist.length - 1] : null;
    lastMove = prev ? [prev.from, prev.to] : null;

    sync();
});

// Redo
redoBtn.addEventListener("click", () => {
    const m = redoStack.pop();
    if (!m) return;

    // redo via game.move mit from/to (+promotion falls vorhanden)
    const redone = game.move({
        from: m.from,
        to: m.to,
        promotion: m.promotion ?? "q",
    });

    if (!redone) {
        // falls was inkonsistent wurde: redoStack leeren
        redoStack.length = 0;
    } else {
        lastMove = [redone.from, redone.to];
    }

    sync();
});

resetBtn.addEventListener("click", () => {
    game.reset();
    redoStack.length = 0;
    lastMove = null;
    sync();
});

function tryLoadFen(fen) {
    try {
        if (typeof game.load === "function") return game.load(fen);
        if (typeof game.loadFen === "function") return game.loadFen(fen);
        return false;
    } catch {
        return false;
    }
}

function applyFenFromInput() {
    const fen = fenLine.value.trim().replace(/\s+/g, " ");
    if (!fen) return;

    try {
        game.load(fen);   // SUCCESS → kein return-Wert nötig
    } catch {
        fenLine.classList.add("invalid");
        return;
    }

    redoStack.length = 0;
    lastMove = null;
    fenLine.classList.remove("invalid");
    sync();
}



fenLine.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        applyFenFromInput();
        fenLine.blur(); // optional: Handy-Tastatur zu
    }
});

fenLine.addEventListener("blur", () => {
    applyFenFromInput();
});


// Initial
lastMove = null;
sync();

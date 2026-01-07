import { Chessground } from "https://esm.sh/chessground@9.2.1";
import { Chess } from "https://esm.sh/chess.js@1.0.0";

const boardEl = document.getElementById("board");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");

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

// Initial
lastMove = null;
sync();

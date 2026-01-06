import { Chessground } from "https://esm.sh/chessground@9.2.1";
import { Chess } from "https://esm.sh/chess.js@1.0.0";

const boardEl = document.getElementById("board");
const game = new Chess();

function calcDests(chess) {
    const dests = new Map();
    const moves = chess.moves({ verbose: true });
    for (const m of moves) {
        if (!dests.has(m.from)) dests.set(m.from, []);
        dests.get(m.from).push(m.to);
    }
    return dests;
}

// finde Königsfeld der Seite, die gerade im Schach steht
function kingSquare(chess) {
    const board = chess.board(); // 8x8, 0 = rank 8
    const target = chess.turn() === "w" ? "wK" : "bK"; // wenn isCheck() true, ist "turn()" die Seite im Schach
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const p = board[r][f];
            if (!p) continue;
            const code = (p.color === "w" ? "w" : "b") + p.type.toUpperCase();
            if (code === target) {
                const file = "abcdefgh"[f];
                const rank = 8 - r;
                return `${file}${rank}`;
            }
        }
    }
    return undefined;
}

function sync() {
    const inCheck = game.isCheck();
    const checkColor = inCheck ? (game.turn() === "w" ? "white" : "black") : false;

    ground.set({
        fen: game.fen(),
        check: checkColor,
        movable: {
            free: false,
            color: game.turn() === "w" ? "white" : "black",
            dests: calcDests(game),
        },
    });
}

const ground = Chessground(boardEl, {
    fen: game.fen(),
    orientation: "white",
    highlight: { check: true },   // ✅ wichtig
    movable: {
        free: false,
        color: game.turn() === "w" ? "white" : "black",
        dests: calcDests(game),
    },
    events: {
        move: (from, to) => {
            const move = game.move({ from, to, promotion: "q" });
            if (!move) {
                ground.set({ fen: game.fen() });
                return;
            }
            sync();
        },
    },
});

sync();

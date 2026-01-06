import { Chessground } from "https://esm.sh/chessground@9.2.1";
import { Chess } from "https://esm.sh/chess.js@1.0.0";

const boardEl = document.getElementById("board");
const game = new Chess(); // Startstellung

function calcDests(chess) {
    const dests = new Map();
    const moves = chess.moves({ verbose: true });

    for (const m of moves) {
        if (!dests.has(m.from)) dests.set(m.from, []);
        dests.get(m.from).push(m.to);
    }
    return dests;
}

const ground = Chessground(boardEl, {
    fen: game.fen(),
    orientation: "white",
    movable: {
        free: false,
        color: game.turn() === "w" ? "white" : "black",
        dests: calcDests(game),
    },
    events: {
        move: (from, to) => {
            // Promotion erstmal automatisch zur Dame
            const move = game.move({ from, to, promotion: "q" });

            // Wenn illegal (sollte bei dests selten passieren), resync
            if (!move) {
                ground.set({ fen: game.fen() });
                return;
            }

            // Board + erlaubte Züge aktualisieren
            ground.set({
                fen: game.fen(),
                movable: {
                    free: false,
                    color: game.turn() === "w" ? "white" : "black",
                    dests: calcDests(game),
                },
            });
        },
    },
});

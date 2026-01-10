import { Chessground } from "https://esm.sh/chessground@9.2.1";
import { Chess } from "https://esm.sh/chess.js@1.0.0";

const STORAGE_PGN_KEY = "blunderlab.pgn";

const boardEl = document.getElementById("board");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const resetBtn = document.getElementById("resetBtn");
const flipBtn = document.getElementById("flipBtn");
const copyPgnBtn = document.getElementById("copyPgnBtn");
const lichessBtn = document.getElementById("lichessBtn");

const pgnEl = document.getElementById("pgn");

const fenLine = document.getElementById("fenLine");

const game = new Chess();
const redoStack = [];
let lastMove = null;
let orientation = localStorage.getItem("blunderlab.orientation") || "white";

// Promotion-Auswahl auf dem Brett (Lichess-Style)
let promoPick = null; // { from, to, chessColor, squares }

function autoSavePgn() {
    try {
        const pgn = game.pgn();
        localStorage.setItem(STORAGE_PGN_KEY, pgn);
    } catch (e) {
        console.warn("Auto-save PGN failed:", e);
    }
}

/** Alle legalen Ziele pro Startfeld (für Chessground movable.dests) */
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

function isPromotionMove(from, to) {
    const p = game.get(from);
    if (!p || p.type !== "p") return false;
    const rank = to[1];
    return (p.color === "w" && rank === "8") || (p.color === "b" && rank === "1");
}

function cgColor(chessColor) {
    return chessColor === "w" ? "white" : "black";
}

function lichessAnalysisUrlFromFen(fen, orientation = "white") {
    const parts = fen.trim().split(/\s+/);

    if (parts.length < 4) {
        return "https://lichess.org/analysis";
    }

    const board = parts[0];      // mit /
    const turn = parts[1];       // w | b
    const castling = parts[2];   // KQkq | -
    const ep = parts[3];         // - | e3

    // Halbzug & Zugnummer optional (Lichess ignoriert sie)
    const halfmove = parts[4] ?? "0";
    const fullmove = parts[5] ?? "1";

    const fenPath =
        `${board}_${turn}_${castling}_${ep}_${halfmove}_${fullmove}`;

    return `https://lichess.org/analysis/standard/${fenPath}?color=${orientation}`;
}


function promoSquares(to, chessColor) {
    const file = to[0];
    // Weiß: 8/7/6/5, Schwarz: 1/2/3/4
    if (chessColor === "w") return [file + "8", file + "7", file + "6", file + "5"];
    return [file + "1", file + "2", file + "3", file + "4"];
}

function ensurePromoDimmer() {
    const wrap = boardEl.querySelector(".cg-wrap");
    if (!wrap) return;

    if (!wrap.querySelector(".promo-dimmer")) {
        const dim = document.createElement("div");
        dim.className = "promo-dimmer";
        wrap.appendChild(dim);
    }
}

function showPromoChoices(from, to) {
    const chessColor = game.get(from).color; // "w" | "b"
    const squares = promoSquares(to, chessColor);
    promoPick = { from, to, chessColor, squares };

    const c = cgColor(chessColor);

    // 4 Auswahlfiguren als temporäre Pieces auf Board-Feldern
    ground.setPieces(
        new Map([
            [squares[0], { role: "queen", color: c }],
            [squares[1], { role: "knight", color: c }],
            [squares[2], { role: "rook", color: c }],
            [squares[3], { role: "bishop", color: c }],
        ])
    );

    // UI: dimmen + Felder markieren
    const wrap = boardEl.querySelector(".cg-wrap");
    if (wrap) {
        wrap.classList.add("promo-active");
        squares.forEach((sq) => wrap.querySelector(`square[data-key="${sq}"]`)?.classList.add("promo"));
    }

    // während Promotion keine normalen Züge (wir lassen select() die Wahl übernehmen)
    ground.set({
        movable: { free: false, color: undefined, dests: new Map() },
    });
}

function clearPromoChoices() {
    if (!promoPick) return;

    const [a, b, c, d] = promoPick.squares;

    // nur diese 4 Felder leeren
    ground.setPieces(
        new Map([
            [a, null],
            [b, null],
            [c, null],
            [d, null],
        ])
    );

    const wrap = boardEl.querySelector(".cg-wrap");
    if (wrap) {
        wrap.classList.remove("promo-active");
        wrap.querySelectorAll("square.promo").forEach((el) => el.classList.remove("promo"));
    }

    promoPick = null;
}

function renderPgn() {
    const moves = game.history({ verbose: true }); // aktuelle Line
    const currentPly = moves.length;

    // HTML bauen
    let html = "";

    for (let i = 0; i < moves.length; i++) {
        const mv = moves[i];

        // Move-Nummer vor jedem weißen Zug
        if (i % 2 === 0) {
            const moveNo = Math.floor(i / 2) + 1;
            html += `<span class="num">${moveNo}.</span>`;
        }

        const active = (i + 1) === currentPly ? "active" : "";
        html += `<span class="mv ${active}" data-ply="${i + 1}">${mv.san}</span>`;
    }

    pgnEl.innerHTML = html || `<span class="num">—</span>`;
}

function jumpToPly(targetPly) {
    clearPromoChoices?.(); // falls vorhanden

    const full = game.history({ verbose: true });

    // targetPly: 0..full.length
    const n = Math.max(0, Math.min(full.length, targetPly));

    game.reset();
    for (let i = 0; i < n; i++) {
        const m = full[i];
        game.move({
            from: m.from,
            to: m.to,
            promotion: m.promotion, // undefined wenn keine Promotion
        });
    }

    // Redo-Stack ist nach Jump nicht mehr sinnvoll
    redoStack.length = 0;

    // lastMove aktualisieren
    if (n > 0) {
        const last = full[n - 1];
        lastMove = [last.from, last.to];
    } else {
        lastMove = null;
    }

    sync();
}


function sync() {
    const turn = game.turn() === "w" ? "white" : "black";

    // chess.js@1.0.0
    const inCheck = game.inCheck();
    const checkColor = inCheck ? (game.turn() === "w" ? "white" : "black") : false;

    ground.set({
        fen: game.fen(),
        turnColor: turn,
        check: checkColor,
        highlight: { check: true, lastMove: true },
        lastMove: lastMove ?? undefined,
        movable: {
            free: false,
            color: game.turn() === "w" ? "white" : "black",
            dests: calcDests(game),
        },
    });

    fenLine.value = game.fen();
    fenLine.classList.remove("invalid");

    renderPgn();

    updateButtons();

    autoSavePgn();
}

const ground = Chessground(boardEl, {
    fen: game.fen(),
    orientation: orientation,
    highlight: { check: true, lastMove: true },
    movable: {
        free: false,
        color: orientation,
        dests: calcDests(game),
    },
    events: {
        move: (from, to) => {
            // Wenn Promotion-Auswahl offen: normale Züge blockieren
            if (promoPick) return;

            // Promotion? -> Auswahl zeigen
            if (isPromotionMove(from, to)) {
                showPromoChoices(from, to);
                return;
            }

            const mv = game.move({ from, to });
            if (!mv) {
                sync();
                return;
            }

            redoStack.length = 0;
            lastMove = [mv.from, mv.to];
            sync();
        },

        // Klick auf ein Feld (für Promotion-Auswahl)
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

            clearPromoChoices();

            if (!mv) {
                sync();
                return;
            }

            redoStack.length = 0;
            lastMove = [mv.from, mv.to];
            sync();
        },
    },
});

// Promo-Dimmer robust einhängen (cg-wrap existiert nach init)
requestAnimationFrame(() => ensurePromoDimmer());

function applyFenFromInput() {
    clearPromoChoices();

    const fen = fenLine.value.trim().replace(/\s+/g, " ");
    if (!fen) return;

    let ok = true;

    try {
        const r = game.load(fen);
        // manche chess.js builds geben false zurück statt zu werfen
        if (r === false) ok = false;
    } catch (e) {
        ok = false;
    }

    // optionaler Fallback (falls unterstützt)
    if (!ok) {
        try {
            const r2 = game.load(fen, { sloppy: true });
            ok = r2 === false ? false : true;
        } catch (e) {
            ok = false;
        }
    }

    if (!ok) {
        fenLine.classList.add("invalid");
        console.warn("FEN invalid:", fen);
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
        fenLine.blur();
    }
});
fenLine.addEventListener("blur", applyFenFromInput);

// Undo / Redo / Reset
undoBtn.addEventListener("click", () => {
    clearPromoChoices();

    const undone = game.undo();
    if (!undone) return;

    redoStack.push(undone);

    const hist = game.history({ verbose: true });
    const prev = hist.length ? hist[hist.length - 1] : null;
    lastMove = prev ? [prev.from, prev.to] : null;

    sync();
});

redoBtn.addEventListener("click", () => {
    clearPromoChoices();

    const m = redoStack.pop();
    if (!m) return;

    const redone = game.move({
        from: m.from,
        to: m.to,
        promotion: m.promotion ?? "q",
    });

    if (!redone) {
        redoStack.length = 0;
    } else {
        lastMove = [redone.from, redone.to];
    }

    sync();
});

resetBtn.addEventListener("click", () => {
    clearPromoChoices();
    game.reset();
    redoStack.length = 0;
    lastMove = null;
    sync();
});

lichessBtn.addEventListener("click", () => {
    const url = lichessAnalysisUrlFromFen(game.fen());
    window.open(url, "_blank", "noopener,noreferrer");
});

copyPgnBtn.addEventListener("click", async () => {
    try {
        const pgn = game.pgn(); // chess.js erzeugt PGN aus der aktuellen Partie
        await navigator.clipboard.writeText(pgn);

        // kleines visuelles Feedback
        copyPgnBtn.textContent = "✓";
        setTimeout(() => (copyPgnBtn.textContent = "⎘"), 800);
    } catch (e) {
        // Fallback (wenn Clipboard API blockiert ist)
        const pgn = game.pgn();
        window.prompt("PGN kopieren (Strg+C):", pgn);
    }
});

flipBtn.addEventListener("click", () => {
    orientation = orientation === "white" ? "black" : "white";
    localStorage.setItem("blunderlab.orientation", orientation);

    ground.set({ orientation });

    // Optional: falls du beim Drehen die Auswahl loswerden willst
    // ground.set({ selected: undefined });
});

pgnEl.addEventListener("click", (e) => {
    const mv = e.target.closest(".mv");
    if (!mv) return;
    jumpToPly(parseInt(mv.dataset.ply, 10));
});

const savedPgn = localStorage.getItem(STORAGE_PGN_KEY);
if (savedPgn) {
    try {
        game.loadPgn(savedPgn);
    } catch (e) {
        console.warn("Failed to load saved PGN:", e);
    }
}

// Initial
sync();

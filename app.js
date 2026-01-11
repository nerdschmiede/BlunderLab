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
let lastMove = null;
let orientation = localStorage.getItem("blunderlab.orientation") || "white";

let fullLine = [];      // komplette Line (verbose moves)
let viewPly = null;     // null = am Ende; sonst 0..fullLine.length
let fullPgn = "";       // gespeichertes PGN der vollen Line

// Promotion-Auswahl auf dem Brett (Lichess-Style)
let promoPick = null; // { from, to, chessColor, squares }
let promoCustom = new Map(); // Map<Key, string>

function autoSavePgn() {
    try {
        localStorage.setItem(STORAGE_PGN_KEY, fullPgn);
    } catch (e) {
        console.warn("Auto-save PGN failed:", e);
    }
}


function setPositionFromFullLine(ply) {
    game.reset();
    for (let i = 0; i < ply; i++) {
        const m = fullLine[i];
        game.move({ from: m.from, to: m.to, promotion: m.promotion });
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
    undoBtn.disabled = viewPly <= 0;
    redoBtn.disabled = viewPly >= fullLine.length;
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
    promoCustom = new Map(squares.map(sq => [sq, "promo"]));

    ground.set({
        highlight: { lastMove: true, check: true, custom: promoCustom }
    });


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

    promoCustom = new Map();

    ground.set({
        highlight: { lastMove: true, check: true, custom: promoCustom }
    });

    promoPick = null;
}

function renderPgn() {
    const moves = fullLine;
    const ply = viewPly ?? moves.length;

    let html = "";
    for (let i = 0; i < moves.length; i++) {
        const mv = moves[i];

        if (i % 2 === 0) {
            const moveNo = Math.floor(i / 2) + 1;
            html += `<span class="num">${moveNo}.</span>`;
        }

        const active = (i + 1) === ply ? "active" : "";
        html += `<span class="mv ${active}" data-ply="${i + 1}">${mv.san}</span>`;
    }

    pgnEl.innerHTML = html || `<span class="num">—</span>`;
}

function sync({ save = true } = {}) {
    const atEnd = (viewPly === fullLine.length);

    if (atEnd) {
        fullLine = game.history({ verbose: true });
        fullPgn  = game.pgn();
        viewPly  = fullLine.length;
    }

    const turn = game.turn() === "w" ? "white" : "black";
    const inCheck = game.inCheck?.() ?? false;
    const checkColor = inCheck ? turn : false;

    ground.set({
        fen: game.fen(),
        movable: {
            free: false,
            color: game.turn() === "w" ? "white" : "black",
            dests: calcDests(game),
        },
        turnColor: game.turn() === "w" ? "white" : "black",

        check: checkColor,
        highlight: { check: true, lastMove: true, custom: promoCustom },
        lastMove: lastMove ?? undefined,
    });

    fenLine.value = game.fen();
    fenLine.classList.remove("invalid");

    renderPgn();
    updateButtons();

    if (save && atEnd) autoSavePgn();
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
            // 0) Wenn wir in der Vergangenheit sind: Edit-Commit vorbereiten
            if (viewPly < fullLine.length) {
                fullLine = fullLine.slice(0, viewPly);

                game.reset();
                for (const m of fullLine) game.move({ from: m.from, to: m.to, promotion: m.promotion });

                // jetzt bist du wieder "live" am Ende der gekürzten Line
                viewPly = fullLine.length;
            }


            // 1) Promotion?
            if (promoPick) return;
            if (isPromotionMove(from, to)) {
                showPromoChoices(from, to);
                return;
            }

            // 2) Zug ausführen
            const mv = game.move({ from, to });
            if (!mv) { sync({ save: false }); return; }

            // 3) Jetzt ist das die neue Master-Line
            fullLine = game.history({ verbose: true });
            fullPgn  = game.pgn();
            viewPly  = fullLine.length;

            lastMove = [mv.from, mv.to];

            // 4) Speichern + UI updaten
            sync({ save: true });
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
                sync({ save: false });
                return;
            }

            // ✅ Commit wie bei normalen Zügen
            fullLine = game.history({ verbose: true });
            fullPgn  = game.pgn();
            viewPly  = fullLine.length;

            lastMove = [mv.from, mv.to];

            sync({ save: true });
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

function goPrevPly() {
    if (!fullLine.length) return;
    viewPly = Math.max(0, viewPly - 1);
    setPositionFromFullLine(viewPly);
    lastMove = viewPly > 0 ? [fullLine[viewPly - 1].from, fullLine[viewPly - 1].to] : null;
    sync({ save: false });
}

function goNextPly() {
    if (!fullLine.length) return;
    viewPly = Math.min(fullLine.length, viewPly + 1);
    setPositionFromFullLine(viewPly);
    lastMove = viewPly > 0 ? [fullLine[viewPly - 1].from, fullLine[viewPly - 1].to] : null;
    sync({ save: false });
}

undoBtn.addEventListener("click", goPrevPly);
redoBtn.addEventListener("click", goNextPly);

resetBtn.addEventListener("click", () => {
    clearPromoChoices();
    game.reset();
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

    viewPly = parseInt(mv.dataset.ply, 10);

    setPositionFromFullLine(viewPly);
    lastMove = viewPly > 0 ? [fullLine[viewPly - 1].from, fullLine[viewPly - 1].to] : null;

    sync({ save: false });
});

document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrevPly();
    } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNextPly();
    }
});




const savedPgn = localStorage.getItem(STORAGE_PGN_KEY);
if (savedPgn) {
    try {
        game.loadPgn(savedPgn);
    } catch (e) {
        console.warn("Failed to load saved PGN:", e);
    }
}

fullLine = game.history({ verbose: true });
fullPgn = game.pgn();
viewPly = fullLine.length;
lastMove = viewPly > 0 ? [fullLine[viewPly - 1].from, fullLine[viewPly - 1].to] : null;

sync({ save: false });
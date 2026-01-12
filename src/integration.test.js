import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
    applyCommit,
    applyEditInPast,
    applyJump,
    clampPly,
    computeLastMove,
    nextViewPly,
} from "./core.js";

/**
 * Minimal “app-like” harness:
 * - master line: fullLine (verbose)
 * - cursor: viewPly
 * - game: chess.js instance, always synced to cursor position
 */
function createHarness() {
    const game = new Chess();
    let fullLine = [];
    let viewPly = 0;
    let fullPgn = "";

    function commitFromGame() {
        fullLine = game.history({ verbose: true });
        fullPgn = game.pgn();
        const c = applyCommit(fullLine);
        viewPly = c.viewPly;
    }

    function setGameToPly(ply) {
        viewPly = clampPly(ply, fullLine.length);
        game.reset();
        for (let i = 0; i < viewPly; i++) {
            const m = fullLine[i];
            game.move({ from: m.from, to: m.to, promotion: m.promotion });
        }
    }

    function goToPly(ply) {
        setGameToPly(ply);
    }

    function goPrev() {
        goToPly(nextViewPly(viewPly, -1, fullLine.length));
    }
    function goNext() {
        goToPly(nextViewPly(viewPly, +1, fullLine.length));
    }

    function jumpTo(ply) {
        const next = applyJump(viewPly, ply, fullLine.length);
        goToPly(next);
    }

    /**
     * Make a move “as in the app”.
     * If user is in past -> cut future, replay truncated, then apply move, then commit.
     */
    function makeMove(moveObj) {
        // branch if needed
        const edited = applyEditInPast(fullLine, viewPly);
        if (edited.line.length !== fullLine.length) {
            fullLine = edited.line;
            setGameToPly(edited.viewPly); // replay truncated line
        }

        let mv = null;
        try {
            mv = game.move(moveObj);
        } catch {
            return null; // chess.js throws on illegal moves
        }
        if (!mv) return null;


        commitFromGame();
        return mv;
    }

    function loadPgn(pgn) {
        game.loadPgn(pgn);
        commitFromGame();
    }

    function loadFen(fen) {
        game.load(fen);
        commitFromGame(); // history is empty after load
    }

    function state() {
        return {
            viewPly,
            fullLine: [...fullLine],
            fullPgn,
            fen: game.fen(),
            lastMove: computeLastMove(fullLine, viewPly),
        };
    }

    // init
    commitFromGame();

    return { game, makeMove, goToPly, goPrev, goNext, jumpTo, loadPgn, loadFen, state };
}

describe("Integration: core helpers + chess.js (no UI)", () => {
    it("starts empty", () => {
        const h = createHarness();
        const s = h.state();
        expect(s.fullLine.length).toBe(0);
        expect(s.viewPly).toBe(0);
        expect(s.lastMove).toBe(null);
    });

    it("commits moves and updates cursor/lastMove", () => {
        const h = createHarness();

        h.makeMove({ from: "d2", to: "d4" });
        h.makeMove({ from: "d7", to: "d5" });

        const s = h.state();
        expect(s.fullLine.length).toBe(2);
        expect(s.viewPly).toBe(2);
        expect(s.lastMove).toEqual(["d7", "d5"]);
    });

    it("timeline navigation never deletes moves", () => {
        const h = createHarness();
        h.makeMove({ from: "d2", to: "d4" });
        h.makeMove({ from: "d7", to: "d5" });
        h.makeMove({ from: "c2", to: "c4" });

        h.goPrev();
        h.goPrev();

        // still same master line length
        expect(h.state().fullLine.length).toBe(3);
        expect(h.state().viewPly).toBe(1);
        expect(h.state().lastMove).toEqual(["d2", "d4"]);

        h.goNext();
        expect(h.state().viewPly).toBe(2);
        expect(h.state().lastMove).toEqual(["d7", "d5"]);
    });

    it("jumpTo moves cursor but keeps fullLine intact", () => {
        const h = createHarness();
        h.makeMove({ from: "d2", to: "d4" });
        h.makeMove({ from: "d7", to: "d5" });
        h.makeMove({ from: "c2", to: "c4" });
        h.makeMove({ from: "e7", to: "e6" });

        h.jumpTo(2); // after black's first move

        const s = h.state();
        expect(s.fullLine.length).toBe(4);
        expect(s.viewPly).toBe(2);
        expect(s.lastMove).toEqual(["d7", "d5"]);
    });

    it("editing in the past branches: cuts future and continues", () => {
        const h = createHarness();
        // main line: 1.d4 d5 2.c4 e6
        h.makeMove({ from: "d2", to: "d4" });
        h.makeMove({ from: "d7", to: "d5" });
        h.makeMove({ from: "c2", to: "c4" });
        h.makeMove({ from: "e7", to: "e6" });

        // go back to after 1...d5 (ply 2)
        h.goToPly(2);

        // now make a different white move: 2.Nf3 (branch)
        h.makeMove({ from: "g1", to: "f3" });

        const s = h.state();
        // future cut: old moves c4,e6 are gone; new move appended
        expect(s.fullLine.map(m => m.san)).toEqual(["d4", "d5", "Nf3"]);
        expect(s.viewPly).toBe(3);
        expect(s.lastMove).toEqual(["g1", "f3"]);
    });

    it("loading PGN reproduces the same fullLine and allows navigation", () => {
        const h = createHarness();
        h.makeMove({ from: "d2", to: "d4" });
        h.makeMove({ from: "d7", to: "d5" });
        h.makeMove({ from: "c2", to: "c4" });

        const saved = h.state().fullPgn;

        const h2 = createHarness();
        h2.loadPgn(saved);

        expect(h2.state().fullLine.length).toBe(3);
        expect(h2.state().viewPly).toBe(3);

        h2.goPrev();
        expect(h2.state().viewPly).toBe(2);
        expect(h2.state().lastMove).toEqual(["d7", "d5"]);
    });

    it("loading FEN resets history (fullLine empty) but sets correct position", () => {
        const h = createHarness();
        const fen = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1";
        h.loadFen(fen);

        const s = h.state();
        expect(s.fullLine.length).toBe(0);
        expect(s.viewPly).toBe(0);
        expect(s.fen.split(" ").slice(0, 4).join(" ")).toBe(
            "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq -"
        );
    });

    it("promotion works as a committed move with chess.js (no UI)", () => {
        const h = createHarness();
        // Simple position: white pawn on a7 ready to promote
        h.loadFen("8/P7/8/8/8/8/8/k6K w - - 0 1");

        const mv = h.makeMove({ from: "a7", to: "a8", promotion: "q" });
        expect(mv).not.toBe(null);

        const s = h.state();
        expect(s.fullLine.length).toBe(1);
        expect(s.viewPly).toBe(1);
        // SAN is usually "a8=Q+" or "a8=Q" depending on check; we just ensure it contains "=Q"
        expect(s.fullLine[0].san).toMatch(/=Q/);
    });

    it("rejects illegal moves without mutating master line or cursor", () => {
        const h = createHarness();

        h.makeMove({ from: "e2", to: "e4" });
        h.makeMove({ from: "e7", to: "e5" });

        const before = h.state();
        const beforeSans = before.fullLine.map(m => m.san);
        const beforePly = before.viewPly;

        // illegal: try to move the pawn from e2 again
        const result = h.makeMove({ from: "e2", to: "e4" });

        expect(result).toBe(null);

        const after = h.state();
        expect(after.fullLine.map(m => m.san)).toEqual(beforeSans);
        expect(after.viewPly).toBe(beforePly);
    });

    it("goToPly clamps and always reproduces the same position as replay", () => {
        const h = createHarness();

        h.makeMove({ from: "e2", to: "e4" });
        h.makeMove({ from: "e7", to: "e5" });
        h.makeMove({ from: "g1", to: "f3" });
        h.makeMove({ from: "b8", to: "c6" });

        const line = h.state().fullLine.slice();
        const max = line.length;

        for (const ply of [-5, 0, 1, 2, max - 1, max, max + 10]) {
            h.goToPly(ply);
            const s = h.state();

            // Replay reference: rebuild a fresh harness and go to same ply
            const replay = createHarness();
            replay.loadPgn(s.fullPgn);
            replay.goToPly(s.viewPly);

            expect(h.state().fen).toBe(replay.state().fen);
        }
    });

    it("can branch multiple times deterministically", () => {
        const h = createHarness();

        h.makeMove({ from: "e2", to: "e4" });
        h.makeMove({ from: "e7", to: "e5" });
        h.makeMove({ from: "g1", to: "f3" });
        h.makeMove({ from: "b8", to: "c6" });

        // branch at ply 2: after 1...e5
        h.goToPly(2);
        h.makeMove({ from: "f1", to: "c4" }); // Bc4

        const firstBranchSans = h.state().fullLine.map(m => m.san);

        // branch again at start
        h.goToPly(0);
        h.makeMove({ from: "d2", to: "d4" });

        const secondBranchSans = h.state().fullLine.map(m => m.san);

        expect(firstBranchSans).not.toEqual(secondBranchSans);
        expect(secondBranchSans).toEqual(["d4"]);
    });

    it("loading FEN then playing moves commits a new master line", () => {
        const h = createHarness();

        // initial position
        h.loadFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");

        h.makeMove({ from: "d2", to: "d4" });
        h.makeMove({ from: "d7", to: "d5" });

        const s = h.state();
        expect(s.fullLine.map(m => m.san)).toEqual(["d4", "d5"]);
        expect(s.viewPly).toBe(2);
    });

});

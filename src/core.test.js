// src/core.test.js
import { describe, it, expect } from "vitest";
import {
    lichessAnalysisUrlFromFen,
    promoSquares,
    buildPgnHtml,
    nextViewPly,
    branchLineIfNeeded,
    pgnHasFenHeader
} from "./core.js";

describe("lichessAnalysisUrlFromFen", () => {
    it("builds lichess analysis URL with orientation", () => {
        const fen = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1";
        const url = lichessAnalysisUrlFromFen(fen, "white");
        expect(url).toContain("https://lichess.org/analysis/standard/");
        expect(url).toContain("?color=white");
        expect(url).toContain("rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR_b_KQkq_-_0_1");
    });

    it("falls back when fen is incomplete", () => {
        expect(lichessAnalysisUrlFromFen("invalid fen")).toBe("https://lichess.org/analysis");
    });
});

describe("promoSquares", () => {
    it("white: file + 8/7/6/5", () => {
        expect(promoSquares("e8", "w")).toEqual(["e8", "e7", "e6", "e5"]);
    });

    it("black: file + 1/2/3/4", () => {
        expect(promoSquares("e1", "b")).toEqual(["e1", "e2", "e3", "e4"]);
    });
});

describe("nextViewPly", () => {
    it("clamps within [0, len]", () => {
        expect(nextViewPly(0, -1, 10)).toBe(0);
        expect(nextViewPly(10, +1, 10)).toBe(10);
        expect(nextViewPly(5, -2, 10)).toBe(3);
    });
});

describe("branchLineIfNeeded", () => {
    it("does nothing if already at end", () => {
        const line = [1, 2, 3, 4];
        const r = branchLineIfNeeded(line, 4);
        expect(r.cut).toBe(false);
        expect(r.newLine).toBe(line); // same reference ok
        expect(r.basePly).toBe(4);
    });

    it("cuts future if in the past", () => {
        const line = ["a", "b", "c", "d"];
        const r = branchLineIfNeeded(line, 2);
        expect(r.cut).toBe(true);
        expect(r.newLine).toEqual(["a", "b"]);
        expect(r.basePly).toBe(2);
    });
});

describe("buildPgnHtml", () => {
    it("renders move numbers and active move", () => {
        const line = [{ san: "d4" }, { san: "d5" }, { san: "c4" }];
        const html = buildPgnHtml(line, 2);
        expect(html).toContain('class="num">1.</span>');
        expect(html).toContain('data-ply="2"');
        expect(html).toContain('mv active');
    });

    it("escapes html in SAN", () => {
        const line = [{ san: "<b>bad</b>" }];
        const html = buildPgnHtml(line, 1);
        expect(html).toContain("&lt;b&gt;bad&lt;/b&gt;");
    });

    it("shows dash when empty", () => {
        expect(buildPgnHtml([], 0)).toContain("—");
    });
});
describe("more edge cases", () => {
    describe("lichessAnalysisUrlFromFen edge cases", () => {
        it("trims and normalizes whitespace", () => {
            const fen = "  rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR   b   KQkq   -   0   1  ";
            const url = lichessAnalysisUrlFromFen(fen, "white");
            expect(url).toContain("rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR_b_KQkq_-_0_1");
        });

        it("defaults halfmove/fullmove if missing", () => {
            const fen = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq -";
            const url = lichessAnalysisUrlFromFen(fen, "white");
            expect(url).toContain("_-_0_1");
        });

        it("supports orientation black", () => {
            const fen = "8/8/8/8/8/8/8/8 w - - 0 1";
            const url = lichessAnalysisUrlFromFen(fen, "black");
            expect(url).toContain("?color=black");
        });
    });

    describe("promoSquares edge cases", () => {
        it("works for a-file and h-file", () => {
            expect(promoSquares("a8", "w")).toEqual(["a8", "a7", "a6", "a5"]);
            expect(promoSquares("h1", "b")).toEqual(["h1", "h2", "h3", "h4"]);
        });
    });

    describe("nextViewPly edge cases", () => {
        it("lineLength=0 always returns 0", () => {
            expect(nextViewPly(0, 1, 0)).toBe(0);
            expect(nextViewPly(5, -3, 0)).toBe(0);
        });

        it("clamps huge deltas", () => {
            expect(nextViewPly(3, 999, 10)).toBe(10);
            expect(nextViewPly(3, -999, 10)).toBe(0);
        });

        it("recovers from out-of-range viewPly", () => {
            expect(nextViewPly(-5, 0, 10)).toBe(0);
            expect(nextViewPly(999, 0, 10)).toBe(10);
        });
    });

    describe("branchLineIfNeeded edge cases", () => {
        it("negative viewPly clamps to 0 and cuts", () => {
            const line = [1,2,3];
            const r = branchLineIfNeeded(line, -10);
            expect(r.cut).toBe(true);
            expect(r.newLine).toEqual([]);
            expect(r.basePly).toBe(0);
        });

        it("too large viewPly clamps to len and does not cut", () => {
            const line = ["a","b","c"];
            const r = branchLineIfNeeded(line, 999);
            expect(r.cut).toBe(false);
            expect(r.newLine).toBe(line);
            expect(r.basePly).toBe(3);
        });
    });

    describe("buildPgnHtml edge cases", () => {
        it("viewPly=0 highlights nothing", () => {
            const line = [{ san: "d4" }, { san: "d5" }];
            const html = buildPgnHtml(line, 0);
            expect(html).not.toContain("mv active");
        });

        it("viewPly=len highlights last move", () => {
            const line = [{ san: "d4" }, { san: "d5" }, { san: "c4" }];
            const html = buildPgnHtml(line, 3);
            expect(html).toContain('data-ply="3"');
            expect(html).toContain("mv active");
        });

        it("adds correct move numbers", () => {
            const line = [{ san: "d4" }, { san: "d5" }, { san: "c4" }, { san: "e6" }];
            const html = buildPgnHtml(line, 4);
            expect(html).toContain('class="num">1.</span>');
            expect(html).toContain('class="num">2.</span>');
        });

        it("keeps SAN symbols and escapes html", () => {
            const line = [{ san: "exd8=Q+" }, { san: "O-O" }, { san: "a&b" }, { san: "<x>" }];
            const html = buildPgnHtml(line, 4);
            expect(html).toContain("exd8=Q+");
            expect(html).toContain("O-O");
            expect(html).toContain("a&amp;b");
            expect(html).toContain("&lt;x&gt;");
        });
    });
});

import {
    clampPly,
    computeLastMove,
    applyJump,
    applyCommit,
    applyEditInPast
} from "./core.js";

describe("state helpers (cursor/lastMove) - waterproofing", () => {
    const line = [
        { from: "e2", to: "e4", san: "e4" },
        { from: "e7", to: "e5", san: "e5" },
        { from: "g1", to: "f3", san: "Nf3" },
    ];

    it("clampPly clamps correctly", () => {
        expect(clampPly(-10, 3)).toBe(0);
        expect(clampPly(0, 3)).toBe(0);
        expect(clampPly(2, 3)).toBe(2);
        expect(clampPly(999, 3)).toBe(3);
    });

    it("computeLastMove is null at ply 0", () => {
        expect(computeLastMove(line, 0)).toBe(null);
    });

    it("computeLastMove matches cursor position", () => {
        expect(computeLastMove(line, 1)).toEqual(["e2", "e4"]);
        expect(computeLastMove(line, 2)).toEqual(["e7", "e5"]);
        expect(computeLastMove(line, 3)).toEqual(["g1", "f3"]);
    });

    it("applyJump clamps to range", () => {
        expect(applyJump(3, -1, 3)).toBe(0);
        expect(applyJump(3, 999, 3)).toBe(3);
        expect(applyJump(3, 2, 3)).toBe(2);
    });

    it("applyCommit sends cursor to end and lastMove to last", () => {
        const { viewPly, lastMove } = applyCommit(line);
        expect(viewPly).toBe(3);
        expect(lastMove).toEqual(["g1", "f3"]);
    });

    it("applyCommit handles empty line", () => {
        const { viewPly, lastMove } = applyCommit([]);
        expect(viewPly).toBe(0);
        expect(lastMove).toBe(null);
    });

    it("applyEditInPast cuts future and places cursor at new end", () => {
        const r = applyEditInPast(line, 2);
        expect(r.line.length).toBe(2);
        expect(r.viewPly).toBe(2);
        expect(r.line[1]).toMatchObject({ from: "e7", to: "e5" });
    });

    it("applyEditInPast with view at end keeps line", () => {
        const r = applyEditInPast(line, 3);
        expect(r.line).toEqual(line);
        expect(r.viewPly).toBe(3);
    });

    it("applyEditInPast with negative clamps to 0 -> empty", () => {
        const r = applyEditInPast(line, -5);
        expect(r.line).toEqual([]);
        expect(r.viewPly).toBe(0);
    });
});

describe("PGN import guards", () => {
    it("detects From-Position PGN via [FEN] header (lichess style)", () => {
        const pgn = `
[Variant "From Position"]
[FEN "r1bqkbnr/pppp1ppp/2n5/4P3/8/5N2/PPP1PPPP/RNBQKB1R b KQkq - 2 3"]

3... Qe7 4. Nc3 Nxe5 5. Nd5
    `.trim();

        expect(pgnHasFenHeader(pgn)).toBe(true);
    });

    it("does not flag normal PGN without [FEN]", () => {
        const pgn = `
1. d4 d5 2. c4 e6 3. Nc3
    `.trim();

        expect(pgnHasFenHeader(pgn)).toBe(false);
    });

    it("is case-insensitive and whitespace-tolerant", () => {
        const pgn = `[fen   "8/8/8/8/8/8/8/k6K w - - 0 1"]\n1. a4`;
        expect(pgnHasFenHeader(pgn)).toBe(true);
    });
});
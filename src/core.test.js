// src/core.test.js
import { describe, it, expect } from "vitest";
import {
    lichessAnalysisUrlFromFen,
    promoSquares,
    buildPgnHtml,
    nextViewPly,
    branchLineIfNeeded,
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

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

        expect(url).toContain("https://lichess.org/analysis/");
        expect(url).toContain("color=white");

        // board part is not encoded (slashes stay)
        expect(url).toContain("/analysis/rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR");

        // rest is encoded: "b KQkq - 0 1" -> "b%20KQkq%20-%200%201"
        expect(url).toContain("b%20KQkq%20-%200%201");
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

            // board part must appear literally (slashes not encoded)
            expect(url).toContain("/analysis/rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR");

            // the rest is URL-encoded: "b KQkq - 0 1" -> "b%20KQkq%20-%200%201"
            expect(url).toContain("b%20KQkq%20-%200%201");

            // color param
            expect(url).toContain("color=white");
        });

        it("defaults halfmove/fullmove if missing", () => {
            const fen = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq -";
            const url = lichessAnalysisUrlFromFen(fen, "white");

            // expects defaulted "0 1"
            expect(url).toContain("b%20KQkq%20-%200%201");
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

import { describe, it, expect } from "vitest";
import { createStudy, upsertStudy, pickStudy, migrateLegacyPgn } from "./core.js";

describe("studies (overlay MVP) - persistence helpers", () => {
    it("createStudy creates a valid study object", () => {
        const s = createStudy({ name: "Jobava", color: "white" });
        expect(s.id).toBeTruthy();
        expect(s.name).toBe("Jobava");
        expect(s.color).toBe("white");
        expect(s.pgn).toBe("");
        expect(typeof s.createdAt).toBe("number");
        expect(typeof s.updatedAt).toBe("number");
    });

    it("upsertStudy inserts and updates by id", () => {
        const a = createStudy({ name: "A", color: "white" });
        const b = createStudy({ name: "B", color: "black" });

        let list = upsertStudy([], a);
        list = upsertStudy(list, b);
        expect(list.length).toBe(2);

        const a2 = { ...a, name: "A2" };
        list = upsertStudy(list, a2);
        expect(list.length).toBe(2);
        expect(list.find(x => x.id === a.id).name).toBe("A2");
    });

    it("pickStudy returns null if missing", () => {
        const a = createStudy({ name: "A", color: "white" });
        expect(pickStudy([a], "nope")).toBe(null);
    });

    it("migrateLegacyPgn creates default study if legacy pgn exists", () => {
        const legacyPgn = "1. d4 d5 *";
        const { studies, activeStudyId } = migrateLegacyPgn({ legacyPgn, existingStudies: [] });

        expect(studies.length).toBe(1);
        expect(activeStudyId).toBe(studies[0].id);
        expect(studies[0].pgn).toContain("d4");
    });
});

import { describe, it, expect } from "vitest";
import { lichessAnalysisUrlFromPgn } from "./core.js";

describe("lichessAnalysisUrlFromPgn", () => {
    it("converts movetext into lichess move-string url", () => {
        const pgn = `[Event "?"]

1. d4 d5 2. Bf4 *`;

        const url = lichessAnalysisUrlFromPgn(pgn);
        expect(url).toBe("https://lichess.org/analysis/pgn/1.d4+d5+2.Bf4");
    });

    it("strips comments, variations and termination markers", () => {
        const pgn = `1. e4 {hi} (1. d4) e5 2. Nf3 *`;
        const url = lichessAnalysisUrlFromPgn(pgn);
        expect(url).toBe("https://lichess.org/analysis/pgn/1.e4+e5+2.Nf3");
    });
});

// Training helper unit tests (TDD)
import { isUsersTurn, sameMove, expectedMove } from "./core.js";

describe("training helpers (pure)", () => {
    describe("isUsersTurn", () => {
        it("returns true when it's the user's turn based on study color and ply", () => {
            expect(isUsersTurn("white", 0)).toBe(true); // white to move at ply 0
            expect(isUsersTurn("white", 1)).toBe(false);
            expect(isUsersTurn("black", 0)).toBe(false);
            expect(isUsersTurn("black", 1)).toBe(true);
        });
    });

    describe("sameMove", () => {
        it("compares from/to and promotion (if present)", () => {
            const a = { from: "e2", to: "e4" };
            const b = { from: "e2", to: "e4" };
            expect(sameMove(a, b)).toBe(true);

            const c = { from: "a7", to: "a8", promotion: "q" };
            const d = { from: "a7", to: "a8", promotion: "q" };
            expect(sameMove(c, d)).toBe(true);

            const e = { from: "a7", to: "a8" };
            expect(sameMove(c, e)).toBe(false);
        });
    });

    describe("expectedMove", () => {
        it("returns the next move at viewPly or null when out of range", () => {
            const line = [{ from: "e2", to: "e4" }, { from: "e7", to: "e5" }];
            expect(expectedMove(line, 0)).toMatchObject({ from: "e2", to: "e4" });
            expect(expectedMove(line, 1)).toMatchObject({ from: "e7", to: "e5" });
            expect(expectedMove(line, 2)).toBeNull();
        });
    });
});

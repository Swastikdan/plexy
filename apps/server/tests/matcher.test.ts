import { describe, expect, test } from "bun:test";
import { jaroWinkler, scoreCandidate } from "../src/matcher";

describe("Matching Engine (PRD 5.4)", () => {
  test("jaroWinkler computes high similarity for identical and close titles", () => {
    expect(jaroWinkler("Avatar", "Avatar")).toBe(1.0);
    expect(jaroWinkler("The Dark Knight", "Dark Knight")).toBe(1.0);

    const sim = jaroWinkler("Interstellar", "Interstelar");
    expect(sim).toBeGreaterThan(0.9);

    const diff = jaroWinkler("Inception", "Godfather");
    expect(diff).toBeLessThan(0.5);
  });

  test("scoreCandidate gives higher score for exact title and year match", () => {
    const perfect = scoreCandidate({
      parsedTitle: "Avatar",
      parsedYear: 2009,
      kind: "movie",
      candidate: {
        id: 19995,
        title: "Avatar",
        release_date: "2009-12-18",
        popularity: 100,
      },
    });

    expect(perfect.exactTitle).toBe(true);
    expect(perfect.score).toBeGreaterThanOrEqual(0.75); // Title (0.5) + Exact Year (0.2) + Pop (~0.08)

    const offYear = scoreCandidate({
      parsedTitle: "Avatar",
      parsedYear: 2015,
      kind: "movie",
      candidate: {
        id: 19995,
        title: "Avatar",
        release_date: "2009-12-18",
        popularity: 100,
      },
    });

    expect(offYear.score).toBeLessThan(perfect.score);
  });
});

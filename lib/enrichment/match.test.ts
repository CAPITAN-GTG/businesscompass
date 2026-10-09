import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearEnrichmentCache,
  readEnrichmentCache,
  writeEnrichmentCache,
} from "./cache.ts";
import { decideMatch, type MatchSubject, type OsmCandidate } from "./match.ts";
import {
  distanceMeters,
  nameSimilarity,
  normalizeBusinessName,
  normalizePhone,
  parseStreetAddress,
} from "./normalize.ts";
import { candidateFromElement, fetchNearbyOsm } from "./overpass.ts";

const HERE = { latitude: 34.0593, longitude: -118.2361 };

function subject(overrides: Partial<MatchSubject> = {}): MatchSubject {
  return {
    names: ["Shawa"],
    streetAddress: "1000 N ALAMEDA STREET",
    zipCode: "90012-1804",
    latitude: HERE.latitude,
    longitude: HERE.longitude,
    ...overrides,
  };
}

function place(overrides: Partial<OsmCandidate> = {}): OsmCandidate {
  return {
    id: "node/1",
    names: ["Shawa"],
    phones: ["(213) 555-0100"],
    websites: [],
    houseNumber: "1000",
    street: "North Alameda Street",
    unit: null,
    postcode: "90012",
    lat: HERE.latitude,
    lng: HERE.longitude,
    ...overrides,
  };
}

describe("normalizeBusinessName", () => {
  it("drops legal suffixes, punctuation, and a leading the", () => {
    assert.equal(normalizeBusinessName("The Joe's Pizza, LLC"), "JOES PIZZA");
    assert.equal(normalizeBusinessName("Acme Corp."), "ACME");
    assert.equal(normalizeBusinessName("  "), "");
  });

  it("treats a DBA-style match as the same name", () => {
    assert.equal(nameSimilarity("OBLAKO LLC", "Oblako"), 1);
    assert.equal(nameSimilarity("STARBUCKS COFFEE COMPANY", "Starbucks"), 0.94);
    assert.equal(nameSimilarity("Joe's Pizza", "Jill's Pizza"), 0);
  });
});

describe("normalizePhone", () => {
  it("normalizes US formatting to E.164", () => {
    const phone = normalizePhone("(213) 555-0100");
    assert.deepEqual(phone, { e164: "+12135550100", display: "(213) 555-0100" });
    assert.equal(normalizePhone("+1 213.555.0100")?.e164, "+12135550100");
    assert.equal(normalizePhone("2135550100")?.e164, "+12135550100");
  });

  it("keeps an international number and skips junk", () => {
    assert.equal(normalizePhone("+44 20 7946 0958")?.e164, "+442079460958");
    assert.equal(normalizePhone("call us") , null);
    assert.equal(normalizePhone("555") , null);
    assert.equal(normalizePhone("123") , null);
  });

  it("uses the first valid number and drops an extension", () => {
    assert.equal(
      normalizePhone("not a phone; (213) 555-0199 ext. 12")?.e164,
      "+12135550199",
    );
  });
});

describe("distanceMeters", () => {
  it("is zero at the same point and about 111m per 0.001 degree of latitude", () => {
    assert.equal(distanceMeters(34, -118, 34, -118), 0);
    const meters = distanceMeters(34, -118, 34.001, -118);
    assert.ok(meters > 110 && meters < 112);
  });
});

describe("parseStreetAddress", () => {
  it("splits house, street, and suite from an LA address", () => {
    assert.deepEqual(parseStreetAddress("1000 N ALAMEDA STREET SUITE #230"), {
      house: "1000",
      street: "N ALAMEDA ST",
      unit: "230",
    });
  });
});

describe("decideMatch", () => {
  it("accepts an exact OSM match with a phone", () => {
    const decision = decideMatch(subject(), [place()]);
    assert.equal(decision.confidence, "high");
    assert.equal(decision.phone, "+12135550100");
    assert.equal(decision.phoneDisplay, "(213) 555-0100");
  });

  it("accepts contact:phone via the OSM tag parser", () => {
    const candidate = candidateFromElement({
      type: "node",
      id: 9,
      lat: HERE.latitude,
      lon: HERE.longitude,
      tags: {
        name: "Shawa",
        "contact:phone": "+1-213-555-0100",
        "addr:housenumber": "1000",
        "addr:street": "Alameda Street",
        "addr:postcode": "90012",
      },
    });
    assert.ok(candidate);
    const decision = decideMatch(subject(), [candidate]);
    assert.equal(decision.confidence, "high");
    assert.equal(decision.phone, "+12135550100");
  });

  it("does not use a same-name business at a different street number", () => {
    const decision = decideMatch(subject(), [
      place({
        id: "node/2",
        houseNumber: "1002",
        phones: ["(213) 555-0199"],
        lat: HERE.latitude + 0.0001,
      }),
    ]);
    assert.equal(decision.phone, null);
    assert.notEqual(decision.confidence, "high");
  });

  it("does not guess when two nearby same-name places have no address", () => {
    const decision = decideMatch(
      subject({ streetAddress: "1000 N ALAMEDA STREET" }),
      [
        place({
          id: "a",
          houseNumber: null,
          street: null,
          postcode: null,
          phones: ["(213) 555-0100"],
        }),
        place({
          id: "b",
          houseNumber: null,
          street: null,
          postcode: null,
          phones: ["(818) 555-0144"],
          lat: HERE.latitude + 0.00005,
        }),
      ],
    );
    assert.equal(decision.phone, null);
  });

  it("does not attach a phone when the address matches and the name does not", () => {
    const decision = decideMatch(subject({ names: ["Pizza Hut"] }), [
      place({ names: ["Starbucks"] }),
    ]);
    assert.equal(decision.phone, null);
    assert.equal(decision.confidence, "none");
  });

  it("does not attach a phone when the name matches and the address does not", () => {
    const decision = decideMatch(
      subject({ streetAddress: "200 MAIN STREET", zipCode: "90012" }),
      [place({ street: "Main Street", houseNumber: "200", names: ["Shawa"] })],
    );
    assert.equal(decision.phone, "+12135550100");

    const mismatch = decideMatch(subject(), [
      place({ houseNumber: "50", street: "Spring Street" }),
    ]);
    assert.equal(mismatch.phone, null);
  });

  it("returns no phone when nothing is nearby", () => {
    const decision = decideMatch(subject(), []);
    assert.equal(decision.confidence, "none");
    assert.equal(decision.phone, null);
    assert.equal(decision.website, null);
  });

  it("keeps a website when the match has no phone", () => {
    const decision = decideMatch(subject(), [
      place({ phones: [], websites: ["https://shawa.example"] }),
    ]);
    assert.equal(decision.confidence, "high");
    assert.equal(decision.phone, null);
    assert.equal(decision.website, "https://shawa.example/");
  });

  it("refuses a building phone when the LA suite is missing from OSM", () => {
    const decision = decideMatch(
      subject({ streetAddress: "1000 N ALAMEDA STREET SUITE #230" }),
      [place({ unit: null })],
    );
    assert.equal(decision.phone, null);
    assert.equal(decision.confidence, "medium");
  });

  it("accepts the suite when both sides name the same unit", () => {
    const decision = decideMatch(
      subject({ streetAddress: "1000 N ALAMEDA STREET SUITE #230" }),
      [place({ unit: "230" })],
    );
    assert.equal(decision.confidence, "high");
    assert.equal(decision.phone, "+12135550100");
  });

  it("rejects a ZIP disagreement", () => {
    const decision = decideMatch(subject(), [place({ postcode: "91324" })]);
    assert.equal(decision.phone, null);
  });

  it("matches a pipe-separated DBA", () => {
    const decision = decideMatch(
      subject({ names: ["OBLAKO LLC", "SHAWA"] }),
      [place({ names: ["Shawa"] })],
    );
    assert.equal(decision.confidence, "high");
  });

  it("does not pick between two high-confidence phones that disagree", () => {
    const decision = decideMatch(subject(), [
      place({ id: "a", phones: ["(213) 555-0100"] }),
      place({
        id: "b",
        phones: ["(213) 555-0199"],
        lat: HERE.latitude + 0.00001,
      }),
    ]);
    assert.equal(decision.phone, null);
    assert.equal(decision.confidence, "none");
  });

  it("allows one very close name-only match and blocks it when truncated", () => {
    const only = place({
      houseNumber: null,
      street: null,
      postcode: null,
    });
    assert.equal(decideMatch(subject(), [only]).phone, "+12135550100");
    assert.equal(
      decideMatch(subject(), [only], { truncated: true }).phone,
      null,
    );
  });
});

describe("fetchNearbyOsm", () => {
  it("returns rate_limit on HTTP 429", async () => {
    const result = await fetchNearbyOsm(34, -118, {
      fetchImpl: async () => new Response("slow down", { status: 429 }),
    });
    assert.deepEqual(result, { ok: false, reason: "rate_limit" });
  });

  it("returns timeout when the request is aborted", async () => {
    const result = await fetchNearbyOsm(34, -118, {
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    });
    assert.deepEqual(result, { ok: false, reason: "timeout" });
  });

  it("returns http on a 5xx response", async () => {
    const result = await fetchNearbyOsm(34, -118, {
      fetchImpl: async () => new Response("nope", { status: 503 }),
    });
    assert.deepEqual(result, { ok: false, reason: "http" });
  });
});

describe("enrichment cache", () => {
  it("stores misses and expires them", () => {
    clearEnrichmentCache();
    const value = {
      phone: null,
      phoneDisplay: null,
      website: null,
      source: null,
      confidence: "none" as const,
      status: "no_match" as const,
    };
    writeEnrichmentCache("0000111620-0001-4", value, 1_000, 1_000);
    assert.equal(readEnrichmentCache("0000111620-0001-4", 1_500)?.status, "no_match");
    assert.equal(readEnrichmentCache("0000111620-0001-4", 2_001), null);
    clearEnrichmentCache();
  });
});

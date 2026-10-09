import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addressCacheKey, buildingAddressLine } from "./address.ts";
import {
  decidePlacement,
  decideSharedPlacement,
  type CamsCandidate,
} from "./decide.ts";

const hollywood = {
  streetAddress: "1234 N VINE STREET",
  city: "LOS ANGELES",
  zipCode: "90028",
};

function point(
  overrides: Partial<CamsCandidate> = {},
): CamsCandidate {
  return {
    status: "M",
    score: 98,
    addrType: "PointAddress",
    matchAddress: "1234 N VINE ST, LOS ANGELES, CA, 90028",
    latitude: 34.10018,
    longitude: -118.3267,
    ...overrides,
  };
}

describe("address cache keys", () => {
  it("treats suffix, direction, punctuation, and ZIP variants as one building", () => {
    const a = addressCacheKey({
      streetAddress: "1234 North Vine Street, ",
      city: "Los Angeles",
      zipCode: "90028-1234",
    });
    const b = addressCacheKey({
      streetAddress: "1234 N. VINE ST",
      city: "LOS  ANGELES",
      zipCode: "90028",
    });
    assert.equal(a, b);
    assert.ok(a?.includes("1234"));
  });

  it("collapses avenue and boulevard wording", () => {
    assert.equal(
      addressCacheKey({
        streetAddress: "50 SUNSET BOULEVARD",
        city: "LOS ANGELES",
        zipCode: "90028",
      }),
      addressCacheKey({
        streetAddress: "50 SUNSET BLVD",
        city: "LOS ANGELES",
        zipCode: "90028",
      }),
    );
    assert.equal(
      addressCacheKey({
        streetAddress: "100 WESTERN AVENUE",
        city: "LOS ANGELES",
        zipCode: "90004",
      }),
      addressCacheKey({
        streetAddress: "100 WESTERN AVE",
        city: "LOS ANGELES",
        zipCode: "90004",
      }),
    );
  });

  it("keeps the suite on the display address and out of the cache key", () => {
    const displayed = "100 MAIN STREET SUITE 200";
    assert.equal(buildingAddressLine(displayed), "100 MAIN STREET");
    assert.equal(
      addressCacheKey({
        streetAddress: displayed,
        city: "LOS ANGELES",
        zipCode: "90012",
      }),
      addressCacheKey({
        streetAddress: "100 MAIN ST STE 100",
        city: "LOS ANGELES",
        zipCode: "90012",
      }),
    );
    assert.equal(displayed, "100 MAIN STREET SUITE 200");
  });
});

describe("CAMS acceptance", () => {
  const origin = { latitude: 34.1001, longitude: -118.3266 };

  it("accepts a confident building point near the Finance coordinate", () => {
    const placed = decidePlacement(origin, hollywood, point());
    assert.equal(placed.coordinateSource, "la_county_cams");
    assert.equal(placed.coordinateConfidence, "high");
    assert.equal(placed.usable, true);
    assert.equal(placed.rejection, null);
  });

  it("rejects a low score and keeps the Finance coordinate", () => {
    const placed = decidePlacement(origin, hollywood, point({ score: 80 }));
    assert.equal(placed.rejection, "low_score");
    assert.equal(placed.coordinateSource, "la_office_finance");
    assert.equal(placed.latitude, origin.latitude);
    assert.equal(placed.longitude, origin.longitude);
  });

  it("rejects an interpolated street match", () => {
    const placed = decidePlacement(
      origin,
      hollywood,
      point({ addrType: "StreetAddress" }),
    );
    assert.equal(placed.rejection, "not_point");
    assert.equal(placed.coordinateSource, "la_office_finance");
  });

  it("rejects a match on a different street in the same ZIP", () => {
    const placed = decidePlacement(
      origin,
      hollywood,
      point({ matchAddress: "1234 N ORANGE ST, LOS ANGELES, CA, 90028" }),
    );
    assert.equal(placed.rejection, "street_mismatch");
    assert.equal(placed.latitude, origin.latitude);
  });

  it("rejects a house or ZIP that does not match the registration", () => {
    assert.equal(
      decidePlacement(
        origin,
        hollywood,
        point({ matchAddress: "999 N VINE ST, LOS ANGELES, CA, 90028" }),
      ).rejection,
      "house_mismatch",
    );
    assert.equal(
      decidePlacement(
        origin,
        hollywood,
        point({ matchAddress: "1234 N VINE ST, LOS ANGELES, CA, 90210" }),
      ).rejection,
      "zip_mismatch",
    );
  });

  it("rejects a confident point that jumps far from a usable Finance coordinate", () => {
    const placed = decidePlacement(
      origin,
      hollywood,
      point({ latitude: 34.2, longitude: -118.6 }),
    );
    assert.equal(placed.rejection, "too_far");
    assert.equal(placed.latitude, origin.latitude);
    assert.equal(placed.coordinateConfidence, "original");
  });

  it("keeps the Finance coordinate when CAMS is unavailable", () => {
    const placed = decidePlacement(origin, hollywood, null);
    assert.equal(placed.rejection, "unavailable");
    assert.equal(placed.coordinateSource, "la_office_finance");
    assert.equal(placed.usable, true);
  });

  it("uses a confident point when the Finance coordinate is null island", () => {
    const placed = decidePlacement(
      { latitude: 0, longitude: 0 },
      hollywood,
      point(),
    );
    assert.equal(placed.coordinateSource, "la_county_cams");
    assert.equal(placed.latitude, 34.10018);
    assert.equal(placed.usable, true);
  });

  it("places every suite at the same accepted building point", () => {
    const placed = decideSharedPlacement(
      [
        { latitude: 0, longitude: 0 },
        { latitude: 34.1001, longitude: -118.3266 },
      ],
      { ...hollywood, streetAddress: "1234 N VINE STREET SUITE 300" },
      point(),
    );
    assert.equal(placed.coordinateSource, "la_county_cams");
    assert.equal(placed.latitude, 34.10018);

    const rejected = decideSharedPlacement(
      [
        { latitude: 0, longitude: 0 },
        { latitude: origin.latitude, longitude: origin.longitude },
      ],
      hollywood,
      point({ latitude: 34.5, longitude: -118.1 }),
    );
    assert.equal(rejected.coordinateSource, "la_office_finance");
    assert.equal(rejected.latitude, origin.latitude);
    assert.notEqual(rejected.latitude, 0);
  });
});

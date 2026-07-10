import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyOsmTags } from "./classify";

test("admin_level maps to the spec's ladder", () => {
  const admin = (level: string) =>
    classifyOsmTags({ boundary: "administrative", admin_level: level, name: "X" });
  assert.equal(admin("2"), "country");
  assert.equal(admin("4"), "state");
  assert.equal(admin("6"), "county");
  assert.equal(admin("8"), "city");
  assert.equal(admin("9"), "neighborhood");
  assert.equal(admin("10"), "neighborhood");
});

test("odd admin levels fall into the surrounding band", () => {
  const admin = (level: string) =>
    classifyOsmTags({ boundary: "administrative", admin_level: level });
  assert.equal(admin("3"), "state");
  assert.equal(admin("5"), "county");
  assert.equal(admin("7"), "city");
  assert.equal(admin("11"), "neighborhood");
  assert.equal(admin("1"), "country");
});

test("administrative boundary with no admin_level falls back to locality", () => {
  assert.equal(classifyOsmTags({ boundary: "administrative", name: "Somewhere" }), "locality");
});

test("place=suburb/neighbourhood classify as neighborhood", () => {
  assert.equal(classifyOsmTags({ place: "suburb", name: "Brentwood" }), "neighborhood");
  assert.equal(classifyOsmTags({ place: "neighbourhood", name: "SoMa" }), "neighborhood");
  assert.equal(classifyOsmTags({ place: "quarter", name: "Q" }), "neighborhood");
});

test("populated places via place=*", () => {
  assert.equal(classifyOsmTags({ place: "country", name: "France" }), "country");
  assert.equal(classifyOsmTags({ place: "state", name: "California" }), "state");
  assert.equal(classifyOsmTags({ place: "city", name: "Los Angeles" }), "city");
  assert.equal(classifyOsmTags({ place: "town", name: "Ojai" }), "city");
  assert.equal(classifyOsmTags({ place: "village", name: "V" }), "locality");
  assert.equal(classifyOsmTags({ place: "hamlet", name: "H" }), "locality");
});

test("named POIs with no admin role are poi", () => {
  assert.equal(classifyOsmTags({ name: "Blue Bottle", amenity: "cafe" }), "poi");
  assert.equal(classifyOsmTags({ name: "Some Shop", shop: "convenience" }), "poi");
  assert.equal(classifyOsmTags({ name: "Griffith Observatory", tourism: "attraction" }), "poi");
  assert.equal(classifyOsmTags({ name: "Union Station", railway: "station" }), "poi");
});

test("a POI inside a building is still a poi, not a building", () => {
  assert.equal(
    classifyOsmTags({ name: "Corner Cafe", amenity: "cafe", building: "yes" }),
    "poi"
  );
});

test("a plain building with no POI role is a building", () => {
  assert.equal(classifyOsmTags({ building: "yes" }), "building");
  assert.equal(classifyOsmTags({ building: "residential", name: "Tower" }), "building");
});

test("admin classification wins over a stray place tag", () => {
  assert.equal(
    classifyOsmTags({ boundary: "administrative", admin_level: "8", place: "city", name: "LA" }),
    "city"
  );
});

test("island (place with no container meaning) resolves to poi", () => {
  assert.equal(classifyOsmTags({ place: "island", name: "Bull Island" }), "poi");
});

test("amenity=no is not treated as a POI", () => {
  assert.equal(classifyOsmTags({ building: "yes", amenity: "no" }), "building");
});

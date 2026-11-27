import { distanceOf, heightOf, areaOf, measureLines, snapNote, copyText, pixelWidth, leastPoints, volumeErrorText } from '../measure';

// WebODM's metric system, as far as these tests need it: a value's text with its unit
const unit = abbr => value => ({toString: () => (Math.round(value * 1000) / 1000) + " " + abbr});
const units = {length: unit("m"), elevation: unit("m"), area: unit("m²"), volume: unit("m³")};

describe("distanceOf", () => {
    test("adds the lengths along the points, in 3D and from above, and gives the height change end to end", () => {
        const d = distanceOf([[0, 0, 0], [3, 4, 0], [3, 4, 12]]);
        expect(d.length).toBeCloseTo(17);
        expect(d.horizontal).toBeCloseTo(5);
        expect(d.vertical).toBeCloseTo(12);
    });

    test("gives a fall as a negative height change", () => {
        expect(distanceOf([[0, 0, 10], [1, 0, 7]]).vertical).toBeCloseTo(-3);
    });
});

describe("heightOf", () => {
    test("measures the higher point's height above the lower, and both elevations", () => {
        expect(heightOf([[1, 1, 200.5], [4, 5, 212]])).toEqual({height: 11.5, from: 200.5, to: 212, horizontal: 5});
    });

    test("gives the same height when the top is clicked first", () => {
        expect(heightOf([[4, 5, 212], [1, 1, 200.5]])).toEqual({height: 11.5, from: 200.5, to: 212, horizontal: 5});
    });
});

describe("areaOf", () => {
    test("measures a level square the same on its surface and from above", () => {
        const a = areaOf([[0, 0, 5], [2, 0, 5], [2, 2, 5], [0, 2, 5]]);
        expect(a.surface).toBeCloseTo(4);
        expect(a.horizontal).toBeCloseTo(4);
        expect(a.perimeter).toBeCloseTo(8);
    });

    test("measures a roof sloped at 60 degrees as twice its area from above", () => {
        // 2 m across from above, rising 2·tan(60°) over it: 4 m along the slope
        const rise = 2 * Math.tan(Math.PI / 3);
        const a = areaOf([[0, 0, 0], [2, 0, rise], [2, 3, rise], [0, 3, 0]]);
        expect(a.surface).toBeCloseTo(12);
        expect(a.horizontal).toBeCloseTo(6);
    });

    test("measures a wall, which has no area from above", () => {
        const a = areaOf([[0, 0, 0], [3, 0, 0], [3, 0, 2], [0, 0, 2]]);
        expect(a.surface).toBeCloseTo(6);
        expect(a.horizontal).toBeCloseTo(0);
    });

    test("gives the same area whichever way round the corners are clicked", () => {
        const ring = [[0, 0, 0], [4, 0, 1], [4, 3, 1], [0, 3, 0]];
        expect(areaOf([...ring].reverse()).surface).toBeCloseTo(areaOf(ring).surface);
    });
});

describe("measureLines", () => {
    test("words a distance in the units given", () => {
        expect(measureLines({kind: "distance", points: [[0, 0, 10], [3, 4, 8]]}, units)).toEqual([
            ["Length", "5.385 m"], ["Horizontal", "5 m"], ["Height Change", "-2 m"]]);
    });

    test("takes the points as the view gives them, each with whether it is on the point cloud", () => {
        const points = [{point: [0, 0, 10], snapped: true}, {point: [3, 4, 8], snapped: false}];
        expect(measureLines({kind: "distance", points}, units)[0]).toEqual(["Length", "5.385 m"]);
    });

    test("words a height with both elevations", () => {
        expect(measureLines({kind: "height", points: [[0, 0, 190], [0, 0, 203.25]]}, units)).toEqual([
            ["Height", "13.25 m"], ["Bottom Elevation", "190 m"], ["Top Elevation", "203.25 m"], ["Horizontal", "0 m"]]);
    });

    test("words an area on its surface and from above", () => {
        expect(measureLines({kind: "area", points: [[0, 0, 0], [2, 0, 0], [2, 2, 0]]}, units)).toEqual([
            ["Surface Area", "2 m²"], ["Area From Above", "2 m²"], ["Perimeter", "6.828 m"]]);
    });

    test("words a volume while it is worked out, once it is, and when it failed", () => {
        const points = [[0, 0, 0], [2, 0, 0], [2, 2, 0]];
        expect(measureLines({kind: "volume", points}, units)[0]).toEqual(["Volume", "Calculating…"]);
        expect(measureLines({kind: "volume", points, volume: 12.5}, units)[0]).toEqual(["Volume", "12.5 m³"]);
        expect(measureLines({kind: "volume", points, volumeError: "No DSM."}, units)[0]).toEqual(["Volume", "No DSM."]);
    });
});

describe("volumeErrorText", () => {
    test("says what to do when a corner is off the DSM, and passes other reasons on", () => {
        expect(volumeErrorText("Points are out of bounds")).toMatch(/^A corner is outside the task's surface model/);
        expect(volumeErrorText("No DSM.")).toBe("No DSM.");
    });
});

describe("snapNote", () => {
    test("says nothing when every point is on the point cloud", () => {
        expect(snapNote([{snapped: true}, {snapped: true}])).toBe("");
    });

    test("says how many points are from the splats only", () => {
        expect(snapNote([{snapped: true}, {snapped: false}, {snapped: true}])).toBe(
            "1 of 3 points are not on the point cloud: those are from the splats only, less precise.");
        expect(snapNote([{snapped: false}, {snapped: false}])).toMatch(/^No point is on the point cloud/);
    });
});

describe("copyText", () => {
    test("puts a measurement's numbers on one line after its name", () => {
        expect(copyText({kind: "height", points: [[0, 0, 1], [0, 0, 3]]}, "Height", units)).toBe(
            "Height: Height 2 m, Bottom Elevation 1 m, Top Elevation 3 m, Horizontal 0 m");
    });
});

describe("pixelWidth", () => {
    test("is the width of pixels on screen at a distance", () => {
        // A 90 degree view 1000 pixels high sees 20 m across at 10 m: 4 pixels are 8 cm
        expect(pixelWidth(10, 90, 1000, 4)).toBeCloseTo(0.08);
    });
});

describe("leastPoints", () => {
    test("needs two points for a distance or a height and three for an area or a volume", () => {
        expect(["distance", "height", "area", "volume"].map(leastPoints)).toEqual([2, 2, 3, 3]);
    });
});

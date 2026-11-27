// Edit Splats' Measure: the numbers of a measurement from its points ([x, y, z] in metres, in the model's frame:
// the task's projection less an offset in x and y, heights as the task's), and their text. Plain functions, for
// Editor.jsx and Jest. The units come from WebODM's own unit system (webodm/classes/Units), given as units.

export const MEASURES = [
    // [kind, label, icon, the least points, what to do]
    ["distance", "Distance", "fa-ruler", 2, "Click points along the way to measure; double-click the last, or Finish."],
    ["height", "Height", "fa-arrows-alt-v", 2, "Click two points, such as the foot and the top of a wall: the height between them."],
    ["area", "Area", "fa-vector-square", 3, "Click the corners of the area; double-click the last, or Finish."],
    ["volume", "Volume", "fa-cubes", 3, "Click the corners round what to measure, on the ground about it; double-click the last, or Finish."],
];
export const VOLUME_BASES = [
    // WebODM's own base methods (its map's Volume), with its words
    ["triangulate", "Triangulate"], ["plane", "Plane"], ["average", "Average"], ["highest", "Highest"], ["lowest", "Lowest"],
];
export const SNAP_PIXELS = 4;  // the width about the pointer, on screen, a pick may move onto the point cloud within

export const leastPoints = kind => MEASURES.find(([k]) => k === kind)[3];

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
const flat = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// Along the points, in order: {length (in 3D), horizontal, vertical (the last's height less the first's)}
export function distanceOf(points){
    let length = 0, horizontal = 0;
    for (let i = 1; i < points.length; i++){
        length += dist(points[i - 1], points[i]);
        horizontal += flat(points[i - 1], points[i]);
    }
    const vertical = points.length ? points[points.length - 1][2] - points[0][2] : 0;
    return {length, horizontal, vertical};
}

// Between the first two points, whichever was clicked first: {height, from and to (the lower's and the higher's
// heights), horizontal}
export function heightOf(points){
    const [a, b] = points;
    const from = Math.min(a[2], b[2]), to = Math.max(a[2], b[2]);
    return {height: to - from, from, to, horizontal: flat(a, b)};
}

// A polygon through the points (closed): {surface (its area on its own plane: Newell's method, which for corners
// that are not on one plane gives the area seen along their mean normal), horizontal (seen from above), perimeter}
export function areaOf(points){
    let nx = 0, ny = 0, nz = 0, perimeter = 0;
    for (let i = 0; i < points.length; i++){
        const a = points[i], b = points[(i + 1) % points.length];
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
        perimeter += dist(a, b);
    }
    return {surface: Math.hypot(nx, ny, nz) / 2, horizontal: Math.abs(nz) / 2, perimeter};
}

// A measurement's numbers: [label, text] for each, in the units given. Its points are [x, y, z] or, as the view gives
// them, {point, snapped}. A Volume's own number comes from the server (measurement.volume, cubic metres; volumeError
// when it failed; neither while it is worked out).
export function measureLines(measurement, units){
    const kind = measurement.kind, points = measurement.points.map(p => p.point || p);
    const length = m => units.length(m).toString();
    const signed = m => (m < 0 ? "-" : "") + length(Math.abs(m));
    if (kind === "distance"){
        const d = distanceOf(points);
        return [["Length", length(d.length)], ["Horizontal", length(d.horizontal)], ["Height Change", signed(d.vertical)]];
    }
    if (kind === "height"){
        const h = heightOf(points);
        return [["Height", length(h.height)], ["Bottom Elevation", units.elevation(h.from).toString()],
            ["Top Elevation", units.elevation(h.to).toString()], ["Horizontal", length(h.horizontal)]];
    }
    const a = areaOf(points);
    if (kind === "area"){
        return [["Surface Area", units.area(a.surface).toString()], ["Area From Above", units.area(a.horizontal).toString()],
            ["Perimeter", length(a.perimeter)]];
    }
    const volume = measurement.volumeError ? measurement.volumeError :
        measurement.volume == null ? "Calculating…" : units.volume(measurement.volume).toString();
    return [["Volume", volume], ["Area From Above", units.area(a.horizontal).toString()]];
}

// How many of its points are on the point cloud, as a sentence's end: "" when all are
export function snapNote(points){
    const off = points.filter(p => !p.snapped).length;
    if (!off) return "";
    return off === points.length ? "No point is on the point cloud: the numbers are from the splats only, less precise." :
        off + " of " + points.length + " points are not on the point cloud: those are from the splats only, less precise.";
}

// WebODM's volume's own words for a corner off its DSM, said with what to do
export function volumeErrorText(message){
    return message === "Points are out of bounds" ?
        "A corner is outside the task's surface model (DSM), which a volume is calculated on: keep the corners within it." : message;
}

// The text Copy puts on the clipboard: "Distance: Length 12.3 m, Horizontal 12 m, Height Change 1.2 m"
export function copyText(measurement, label, units){
    return label + ": " + measureLines(measurement, units).map(([name, text]) => name + " " + text).join(", ");
}

// The width of pixels on screen at distance from the camera, in metres (fov: the camera's vertical field of view in
// degrees, height: the view's in pixels)
export function pixelWidth(distance, fov, height, pixels){
    return distance * 2 * Math.tan(fov * Math.PI / 360) / Math.max(height, 1) * pixels;
}

import { captureSheet } from "./sheet-texture.js";

const vertexSource = `
    attribute vec3 home, position, normal;
    uniform float camera, radius;
    uniform vec4 framing;
    uniform bool suppliedTexture;
    varying vec2 uv;
    varying float depth;
    varying vec3 surfaceNormal;
    void main() {
        vec2 rest = home.xz / radius;
        uv = (suppliedTexture ? rest : rest * framing.xy + framing.zw) * 0.5 + 0.5;
        surfaceNormal = normalize(normal);
        depth = -position.y;
        // Perspective centred on the puncture. At rest the projection is 1:1.
        float w = 1.0 + depth / camera;
        vec2 screen = position.xz / radius * framing.xy + framing.zw * w;
        gl_Position = vec4(screen.x, -screen.y, depth * 0.1, w);
    }
`;

const fragmentSource = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform sampler2D paper;
    uniform vec3 upperPaper, lowerPaper;
    uniform float paperLevel;
    varying vec2 uv;
    varying float depth;
    varying vec3 surfaceNormal;
    void main() {
        vec3 n = normalize(gl_FrontFacing ? surfaceNormal : -surfaceNormal);
        vec3 light = normalize(vec3(-0.45, 0.88, -0.18));
        float diffuse = clamp(dot(n, light) / light.y, 0.0, 1.0);
        // As seen down a cavity, the projected sky aperture decreases like
        // 1 / (1 + depth^2). Tiny displacements of a flat sheet stay white.
        float d = max(depth, 0.0);
        float sky = 1.0 / (1.0 + 0.85 * d * d);
        float shade = sky * (0.57 + 0.43 * diffuse);
        // The front carries the ink. The matte back keeps the colour of the
        // stock at its original position, including material pulled in from offscreen.
        vec3 stock = uv.y < paperLevel ? upperPaper : lowerPaper;
        vec3 material = stock * 0.91;
        if (gl_FrontFacing) {
            bool onTexture = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
            material = onTexture ? texture2D(paper, uv).rgb : stock;
        }
        gl_FragColor = vec4(material * shade, 1.0);
    }
`;

function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
}

function makeProgram(gl) {
    const program = gl.createProgram();
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || "Cannot draw membrane");
    }
    return program;
}

function vertexBuffer(gl, program, name, data, usage) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    const attribute = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, 3, gl.FLOAT, false, 0, 0);
    return buffer;
}

// The area-weighted sum joins the lighting across intact triangles without
// smoothing the silhouettes of the overlapping, torn parts.
function updateNormals(out, pos, indices) {
    out.fill(0);
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
        out[a] += x; out[a + 1] += y; out[a + 2] += z;
        out[b] += x; out[b + 1] += y; out[b + 2] += z;
        out[c] += x; out[c + 1] += y; out[c + 2] += z;
    }
}

// Both banks of an intact seam describe one surface. Once it splits, each
// bank retains the normal of its own material faces and can turn independently.
function weldNormals(out, solver) {
    for (const { ja, jb, ring, broken } of solver.seams) {
        if (broken || ring === 0) continue;
        for (let k = 0; k < 3; k++) {
            const sum = out[ja + k] + out[jb + k];
            out[ja + k] = out[jb + k] = sum;
        }
    }
    // Individual points can belong to many sectors at the puncture.
    for (const group of solver.tipGroups) {
        let x = 0, y = 0, z = 0;
        for (const { j } of group.nodes) {
            x += out[j]; y += out[j + 1]; z += out[j + 2];
        }
        for (const { j } of group.nodes) {
            out[j] = x; out[j + 1] = y; out[j + 2] = z;
        }
    }
}

// The hit test uses precisely the camera and the surviving faces of the last
// rendered mesh. Project lazily since most frames have no pointer activity.
function meshHitTest(pos, indices, camera, radius, cx, cy, size) {
    const projected = new Float32Array(pos.length / 3 * 2);
    let stale = true;
    return {
        invalidate() { stale = true; },
        covers(clientX, clientY) {
            const x = (clientX - cx) * 2 * radius / size;
            const y = (clientY - cy) * 2 * radius / size;
            if (Math.abs(x) > radius || Math.abs(y) > radius) return true;
            if (stale) {
                for (let i = 0, p = 0; i < pos.length; i += 3, p += 2) {
                    const scale = camera / (camera - pos[i + 1]);
                    projected[p] = pos[i] * scale;
                    projected[p + 1] = pos[i + 2] * scale;
                }
                stale = false;
            }
            for (let i = 0; i < indices.length; i += 3) {
                const a = indices[i] * 2;
                const b = indices[i + 1] * 2;
                const c = indices[i + 2] * 2;
                const ax = projected[a], ay = projected[a + 1];
                const bx = projected[b], by = projected[b + 1];
                const cx = projected[c], cy = projected[c + 1];
                const ab = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
                const bc = (cx - bx) * (y - by) - (cy - by) * (x - bx);
                const ca = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
                if (ab + bc + ca === 0) continue;
                if ((ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0)) return true;
            }
            return false;
        },
    };
}

// Beyond the last simulated ring the page continues as stationary paper.
// Join the moving boundary to that plane so folds which travel underneath
// it are occluded by real geometry, just as they are inside the patch.
function extendSheet(solver) {
    const segments = solver.rim.length;
    const count = solver.home.length / 3;
    const home = new Float32Array((count + segments) * 3);
    home.set(solver.home);
    const borderCount = segments * 6;
    const indices = new Uint16Array(borderCount + solver.triangles.length);
    indices.set(solver.triangles, borderCount);
    for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        const a = solver.rim[i], b = solver.rim[next];
        const c = count + i, d = count + next;
        home[c * 3] = 2 * home[a * 3];
        home[c * 3 + 2] = 2 * home[a * 3 + 2];
        indices.set([a, d, c, a, b, d], i * 6);
    }
    return { home, pos: home.slice(), indices, borderCount };
}

export function createTearRenderer(canvas, solver, { sheet, texture, paperStock, cx, cy, size, cameraDistance = 4 }) {
    // Allocate pixels only for the part of the physical patch on screen.
    // The full camera framing below keeps the optical axis at the click.
    const viewport = document.documentElement;
    const left = Math.max(0, Math.floor(cx - size / 2));
    const top = Math.max(0, Math.floor(cy - size / 2));
    Object.assign(canvas.style, {
        position: "fixed", left: left + "px", top: top + "px", right: "auto", bottom: "auto",
        width: Math.min(viewport.clientWidth, Math.ceil(cx + size / 2)) - left + "px",
        height: Math.min(viewport.clientHeight, Math.ceil(cy + size / 2)) - top + "px",
    });
    const gl = canvas.getContext("webgl", { alpha: true, depth: true, antialias: true });
    if (!gl) throw new Error("WebGL unavailable");
    const release = gl.getExtension("WEBGL_lose_context");
    try {
        const rect = canvas.getBoundingClientRect();
        const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        const density = Math.min(devicePixelRatio, limit / Math.max(rect.width, rect.height));
        canvas.width = Math.max(1, Math.round(rect.width * density));
        canvas.height = Math.max(1, Math.round(rect.height * density));
        const program = makeProgram(gl);
        gl.useProgram(program);
        const radius = solver.radiusUnits;
        gl.uniform1f(gl.getUniformLocation(program, "radius"), radius);
        gl.uniform1f(gl.getUniformLocation(program, "camera"), cameraDistance);
        gl.uniform4f(gl.getUniformLocation(program, "framing"), size / rect.width, size / rect.height,
            2 * (cx - rect.left) / rect.width - 1, 2 * (cy - rect.top) / rect.height - 1);
        gl.uniform1i(gl.getUniformLocation(program, "suppliedTexture"), texture ? 1 : 0);
        const { home, pos, indices, borderCount } = extendSheet(solver);
        vertexBuffer(gl, program, "home", home, gl.STATIC_DRAW);
        const positions = vertexBuffer(gl, program, "position", pos, gl.DYNAMIC_DRAW);
        const normals = new Float32Array(home.length);
        const normalBuffer = vertexBuffer(gl, program, "normal", normals, gl.DYNAMIC_DRAW);
        const elements = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elements);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        function refreshTexture() {
            const stock = paperStock?.();
            gl.uniform3fv(gl.getUniformLocation(program, "upperPaper"), stock?.above ?? [1, 1, 1]);
            gl.uniform3fv(gl.getUniformLocation(program, "lowerPaper"), stock?.below ?? [1, 1, 1]);
            gl.uniform1f(gl.getUniformLocation(program, "paperLevel"), stock ? (stock.level - rect.top) / rect.height : 0);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE,
                texture || captureSheet(sheet, rect, canvas.width, canvas.height));
        }
        refreshTexture();
        gl.enable(gl.DEPTH_TEST);
        gl.frontFace(gl.CCW);
        gl.viewport(0, 0, canvas.width, canvas.height);
        const hitTest = meshHitTest(pos, indices, cameraDistance, radius, cx, cy, size);
        function draw() {
            pos.set(solver.pos);
            gl.bindBuffer(gl.ARRAY_BUFFER, positions);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
            updateNormals(normals, pos, indices);
            weldNormals(normals, solver);
            gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, normals);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            // The real DOM is already visible outside the simulated sheet.
            // The static continuation only needs to write its surface depth.
            gl.colorMask(false, false, false, false);
            gl.drawElements(gl.TRIANGLES, borderCount, gl.UNSIGNED_SHORT, 0);
            gl.colorMask(true, true, true, true);
            gl.drawElements(gl.TRIANGLES, indices.length - borderCount, gl.UNSIGNED_SHORT, borderCount * 2);
            hitTest.invalidate();
        }
        draw();
        // Each patch owns its canvas and GL context, including all its buffers.
        return { draw, refreshTexture, covers: hitTest.covers, dispose: () => release?.loseContext() };
    } catch (error) {
        release?.loseContext();
        throw error;
    }
}

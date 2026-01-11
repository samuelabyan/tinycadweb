const canvas = document.getElementById('cadCanvas');
const ctx = canvas.getContext('2d');
const inspector = document.getElementById('inspector-content');

let lines = [],
    tool = 'line',
    isDrawing = false;
let baseCmPerPixel = null,
    activeUnit = 'cm';
let activeLine = null,
    selectedPoint = null;
let camera = {
        x: 0,
        y: 0,
        zoom: 1
    },
    isPanning = false,
    lastMouse = {
        x: 0,
        y: 0
    };
let isShiftDown = false,
    isDraggingNode = false;
let undoStack = [],
    redoStack = [];
const MAX_HISTORY = 30;
const SNAP_DIST = 15;

let isMovingLine = false,
    moveStartPos = {
        x: 0,
        y: 0
    },
    originalLinePos = {
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 0
    };
const unitTable = {
    mm: 10,
    cm: 1,
    m: 0.01,
    in: 0.393701
};

function init() {
    window.addEventListener('resize', resize);
    resize();
    loadFromStorage();
    canvas.focus();
    draw();
}




function resize() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    draw();
}

// --- SNAPPING LOGIC ---
function getSnapPoint(worldX, worldY, excludeLine) {
    let best = {
        x: worldX,
        y: worldY,
        snapped: false
    };
    let minD = SNAP_DIST / camera.zoom;

    lines.forEach(l => {
        if (l === excludeLine) return;
        const d1 = dist(worldX, worldY, l.x1, l.y1);
        const d2 = dist(worldX, worldY, l.x2, l.y2);
        if (d1 < minD) {
            minD = d1;
            best = {
                x: l.x1,
                y: l.y1,
                snapped: true
            };
        }
        if (d2 < minD) {
            minD = d2;
            best = {
                x: l.x2,
                y: l.y2,
                snapped: true
            };
        }
    });
    return best;
}

function changeUnit(u) {
    activeUnit = u;
    document.getElementById('scale-status').innerText = `Unit: ${u.toUpperCase()}`;
    updateInspector();
    draw();
}

function getDisplayLength(px) {
    if (!baseCmPerPixel) return 0;
    return px * baseCmPerPixel * unitTable[activeUnit];
}

function saveState() {
    undoStack.push(JSON.stringify(lines));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
}

function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(JSON.stringify(lines));
    lines = JSON.parse(undoStack.pop());
    activeLine = null;
    selectedPoint = null;
    updateInspector();
    draw();
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(JSON.stringify(lines));
    lines = JSON.parse(redoStack.pop());
    activeLine = null;
    selectedPoint = null;
    updateInspector();
    draw();
}

function dist(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function screenToWorld(sx, sy) {
    return {
        x: sx / camera.zoom + camera.x,
        y: sy / camera.zoom + camera.y
    };
}

function updateInspector() {
    if (!activeLine) {
        inspector.innerHTML = '<div class="empty-state">Select a line to view<br>and edit properties</div>';
        return;
    }
    const len = baseCmPerPixel ? getDisplayLength(dist(activeLine.x1, activeLine.y1, activeLine.x2, activeLine.y2)).toFixed(2) : "Uncalibrated";
    const isP1 = (selectedPoint && selectedPoint.pt === 'p1');
    const isP2 = (selectedPoint && selectedPoint.pt === 'p2');

    let doorControls = '';
    if (activeLine.type === 'door') {
        doorControls = `
            <div class="inspector-section">
                <h4>Door Settings</h4>
                <div class="prop-group" style="display:flex; align-items:center; justify-content:space-between;">
                    <label>Mirror Swing</label>
                    <label class="switch">
                        <input type="checkbox" ${activeLine.mirrored ? 'checked' : ''} 
                               onchange="activeLine.mirrored = this.checked; draw();">
                        <span class="slider"></span>
                    </label>
                </div>
            </div>`;
    }

    inspector.innerHTML = `
        <div class="inspector-section">
            <h4>Constraints</h4>
            <div class="prop-group" style="display:flex; align-items:center; justify-content:space-between;">
                <label>Lock Length</label>
                <label class="switch">
                    <input type="checkbox" id="lenLock" ${activeLine.locked ? 'checked' : ''} 
                           onchange="activeLine.locked = this.checked; if(this.checked) activeLine.fixedLen = dist(activeLine.x1, activeLine.y1, activeLine.x2, activeLine.y2);">
                    <span class="slider"></span>
                </label>
            </div>
        </div>
        ${doorControls}
        <div class="inspector-section">
            <h4>Line Stats (${activeUnit})</h4>
            <div class="prop-group"><label>Length</label><input type="number" step="0.01" value="${len}" onchange="manualLengthUpdate(this.value)"></div>
        </div>
        <div class="inspector-section ${isP1 ? 'active-pt' : ''}">
            <h4>Start Point (P1)</h4>
            <div class="prop-group"><label>X</label><input type="number" value="${Math.round(activeLine.x1)}" oninput="activeLine.x1=parseFloat(this.value); draw();"></div>
            <div class="prop-group"><label>Y</label><input type="number" value="${Math.round(activeLine.y1)}" oninput="activeLine.y1=parseFloat(this.value); draw();"></div>
        </div>
        <div class="inspector-section ${isP2 ? 'active-pt' : ''}">
            <h4>End Point (P2)</h4>
            <div class="prop-group"><label>X</label><input type="number" value="${Math.round(activeLine.x2)}" oninput="activeLine.x2=parseFloat(this.value); draw();"></div>
            <div class="prop-group"><label>Y</label><input type="number" value="${Math.round(activeLine.y2)}" oninput="activeLine.y2=parseFloat(this.value); draw();"></div>
        </div>
    `;
}

function manualLengthUpdate(val) {
    if (!baseCmPerPixel) return;
    saveState();
    const targetPx = (val / unitTable[activeUnit]) / baseCmPerPixel;
    const ang = Math.atan2(activeLine.y2 - activeLine.y1, activeLine.x2 - activeLine.x1);
    activeLine.x2 = activeLine.x1 + Math.cos(ang) * targetPx;
    activeLine.y2 = activeLine.y1 + Math.sin(ang) * targetPx;
    draw();
}

canvas.addEventListener('mousedown', e => {
    canvas.focus();
    if (e.button === 1) {
        isPanning = true;
        lastMouse = {
            x: e.clientX,
            y: e.clientY
        };
        return;
    }
    const pos = screenToWorld(e.offsetX, e.offsetY);

    if (tool === 'select') {
        let hitPoint = null,
            hitLine = null;
        lines.forEach(l => {
            if (dist(pos.x, pos.y, l.x1, l.y1) < 15 / camera.zoom) hitPoint = {
                line: l,
                pt: 'p1'
            };
            else if (dist(pos.x, pos.y, l.x2, l.y2) < 15 / camera.zoom) hitPoint = {
                line: l,
                pt: 'p2'
            };
            else if (Math.abs(dist(pos.x, pos.y, l.x1, l.y1) + dist(pos.x, pos.y, l.x2, l.y2) - dist(l.x1, l.y1, l.x2, l.y2)) < 0.5 / camera.zoom) hitLine = l;
        });
        if (hitPoint) {
            saveState();
            selectedPoint = hitPoint;
            activeLine = hitPoint.line;
            isDraggingNode = true;
        } else if (hitLine) {
            saveState();
            activeLine = hitLine;
            isMovingLine = true;
            moveStartPos = {
                ...pos
            };
            originalLinePos = {
                x1: activeLine.x1,
                y1: activeLine.y1,
                x2: activeLine.x2,
                y2: activeLine.y2
            };
        } else {
            activeLine = null;
            selectedPoint = null;
        }
    } else {
        isDrawing = true;
        const snap = getSnapPoint(pos.x, pos.y, null);
        const startX = snap.snapped ? snap.x : pos.x;
        const startY = snap.snapped ? snap.y : pos.y;

        // Assign the current tool as the line type
        activeLine = {
            x1: startX,
            y1: startY,
            x2: startX,
            y2: startY,
            type: tool, // 'line', 'window', or 'door'
            locked: false
        };
    }
    updateInspector();
    draw();
});

window.addEventListener('mousemove', e => {
    if (isPanning) {
        camera.x -= (e.clientX - lastMouse.x) / camera.zoom;
        camera.y -= (e.clientY - lastMouse.y) / camera.zoom;
        lastMouse = {
            x: e.clientX,
            y: e.clientY
        };
        draw();
        return;
    }
    const rect = canvas.getBoundingClientRect();
    const pos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    if (isMovingLine) {
        activeLine.x1 = originalLinePos.x1 + (pos.x - moveStartPos.x);
        activeLine.y1 = originalLinePos.y1 + (pos.y - moveStartPos.y);
        activeLine.x2 = originalLinePos.x2 + (pos.x - moveStartPos.x);
        activeLine.y2 = originalLinePos.y2 + (pos.y - moveStartPos.y);
        updateInspector();
        draw();
        return;
    }

    // ... inside mousemove listener ...
    if (isDrawing || isDraggingNode) {
        let line = isDrawing ? activeLine : selectedPoint.line;
        let snap = getSnapPoint(pos.x, pos.y, line);
        let final = snap.snapped ? {
            x: snap.x,
            y: snap.y
        } : pos;

        let isMovingP2 = (isDrawing || (selectedPoint && selectedPoint.pt === 'p2'));
        let anchor = isMovingP2 ? {
            x: line.x1,
            y: line.y1
        } : {
            x: line.x2,
            y: line.y2
        };

        // 1. Apply Ortho Lock (Shift Key)
        if (isShiftDown) {
            if (Math.abs(final.x - anchor.x) > Math.abs(final.y - anchor.y)) final.y = anchor.y;
            else final.x = anchor.x;
        }

        // 2. Apply Length Lock (Restored Math)
        if (line.locked && line.fixedLen) {
            let angle = Math.atan2(final.y - anchor.y, final.x - anchor.x);
            final.x = anchor.x + Math.cos(angle) * line.fixedLen;
            final.y = anchor.y + Math.sin(angle) * line.fixedLen;
        }

        // 3. Update Coordinates
        if (isMovingP2) {
            line.x2 = final.x;
            line.y2 = final.y;
        } else {
            line.x1 = final.x;
            line.y1 = final.y;
        }

        updateInspector();
        draw();
    }
});

window.addEventListener('mouseup', () => {
    if (isDrawing && dist(activeLine.x1, activeLine.y1, activeLine.x2, activeLine.y2) > 5) {
        saveState();
        lines.push(activeLine);
        if (!baseCmPerPixel) document.getElementById('calibModal').style.display = 'flex';
    }
    isDrawing = false;
    isPanning = false;
    isMovingLine = false;
    isDraggingNode = false;
    saveToStorage();
    draw();
});

function draw() {
    // 1. RESET TRANSFORM for UI & Grid (Screen Space)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // --- DRAW CONSISTENT GRID ---
    // By drawing before ctx.scale, the grid lines stay exactly 1px thick
    const gSize = 50 * camera.zoom;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#2a2a2a';
    ctx.beginPath();

    // Calculate offsets based on camera position
    for (let x = (-camera.x * camera.zoom) % gSize; x < canvas.width; x += gSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
    }
    for (let y = (-camera.y * camera.zoom) % gSize; y < canvas.height; y += gSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();

    // --- DRAW AXIS INDICATOR (Custom Margins) ---
    const axisSize = 40;

    // Define your 4 margins here
    const margin = {
        top: 20,
        right: 60, // Distance from right edge
        bottom: 20, // Distance from bottom edge
        left: 20
    };

    // Calculate position based on the specific side margins
    const ax = canvas.width - margin.right;
    const ay = canvas.height - margin.bottom;

    ctx.font = "bold 12px Arial";
    ctx.lineWidth = 2;

    // X-Axis (Red)
    ctx.strokeStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + axisSize, ay);
    ctx.stroke();
    ctx.fillStyle = '#ff4d4d';
    ctx.fillText('X', ax + axisSize + 5, ay + 5);

    // Y-Axis (Green)
    ctx.strokeStyle = '#2ecc71';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax, ay - axisSize);
    ctx.stroke();
    ctx.fillStyle = '#2ecc71';
    ctx.fillText('Y', ax - 4, ay - axisSize - 8);

    // 2. APPLY ZOOM/PAN TRANSFORM for World Objects
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    lines.concat(isDrawing ? [activeLine] : []).forEach(line => {
        if (!line) return;

        const isSelected = (activeLine === line);
        ctx.lineWidth = 2 / camera.zoom;
        ctx.strokeStyle = isSelected ? '#0078d4' : '#fff';

        if (line.type === 'window') {
            const ang = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
            const gap = 3 / camera.zoom;
            const offsetX = Math.sin(ang) * gap;
            const offsetY = Math.cos(ang) * gap;

            ctx.beginPath();
            ctx.moveTo(line.x1 + offsetX, line.y1 - offsetY);
            ctx.lineTo(line.x2 + offsetX, line.y2 - offsetY);
            ctx.moveTo(line.x1 - offsetX, line.y1 + offsetY);
            ctx.lineTo(line.x2 - offsetX, line.y2 + offsetY);
            ctx.strokeStyle = isSelected ? '#0078d4' : '#3498db';
            ctx.stroke();

        } else if (line.type === 'door') {
            const ang = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
            const d = dist(line.x1, line.y1, line.x2, line.y2);
            const mirror = line.mirrored ? 1 : -1; // Flip logic

            ctx.beginPath();
            ctx.moveTo(line.x1, line.y1);
            ctx.lineTo(line.x2, line.y2);
            ctx.globalAlpha = 0.3;
            ctx.stroke();
            ctx.globalAlpha = 1.0;

            // Door Leaf (Calculated with mirror factor)
            ctx.beginPath();
            ctx.moveTo(line.x1, line.y1);
            const leafX = line.x1 + Math.cos(ang + (mirror * Math.PI / 2)) * d;
            const leafY = line.y1 + Math.sin(ang + (mirror * Math.PI / 2)) * d;
            ctx.lineTo(leafX, leafY);
            ctx.strokeStyle = isSelected ? '#0078d4' : '#e67e22';
            ctx.stroke();

            // Door Arc
            ctx.beginPath();
            ctx.setLineDash([5 / camera.zoom, 5 / camera.zoom]);
            if (line.mirrored) {
                ctx.arc(line.x1, line.y1, d, ang, ang + Math.PI / 2);
            } else {
                ctx.arc(line.x1, line.y1, d, ang - Math.PI / 2, ang);
            }
            ctx.stroke();
            ctx.setLineDash([]);

        } else {
            ctx.beginPath();
            ctx.moveTo(line.x1, line.y1);
            ctx.lineTo(line.x2, line.y2);
            ctx.stroke();
        }

        const s = 7 / camera.zoom;
        ctx.fillStyle = (selectedPoint && selectedPoint.line === line && selectedPoint.pt === 'p1') ? '#f1c40f' : '#e74c3c';
        ctx.fillRect(line.x1 - s / 2, line.y1 - s / 2, s, s);
        ctx.fillStyle = (selectedPoint && selectedPoint.line === line && selectedPoint.pt === 'p2') ? '#f1c40f' : '#e74c3c';
        ctx.fillRect(line.x2 - s / 2, line.y2 - s / 2, s, s);

        // DRAW TEXT LABEL
        if (baseCmPerPixel) {
            let d = getDisplayLength(dist(line.x1, line.y1, line.x2, line.y2));
            ctx.fillStyle = "#0f0";
            ctx.font = (12 / camera.zoom) + "px monospace";
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // 1. Calculate Midpoint
            const midX = (line.x1 + line.x2) / 2;
            const midY = (line.y1 + line.y2) / 2;

            // 2. Calculate Angle and Perpendicular Offset
            const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);

            // The "push" distance (10 pixels away from the line)
            const offsetDist = 10 / camera.zoom;

            // 3. Calculate the "Normal" (perpendicular) position
            // We subtract the sine/cosine to push it "Up" or "Side"
            const textX = midX + Math.sin(angle) * offsetDist;
            const textY = midY - Math.cos(angle) * offsetDist;

            let prefix = line.type === 'window' ? "W: " : (line.type === 'door' ? "D: " : "");

            // 4. Draw the text
            ctx.fillText(prefix + d.toFixed(2) + activeUnit, textX, textY);

            // Reset alignment for other UI
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }
    });
}

// --- COMPLETED EXPORT ENGINE ---

function getDrawingBoundaries() {
    if (lines.length === 0) return null;
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

    lines.forEach(l => {
        // We check all points including door swing paths to ensure nothing is clipped
        minX = Math.min(minX, l.x1, l.x2);
        minY = Math.min(minY, l.y1, l.y2);
        maxX = Math.max(maxX, l.x1, l.x2);
        maxY = Math.max(maxY, l.y1, l.y2);

        if (l.type === 'door') {
            const d = dist(l.x1, l.y1, l.x2, l.y2);
            minX = Math.min(minX, l.x1 - d);
            minY = Math.min(minY, l.y1 - d);
            maxX = Math.max(maxX, l.x1 + d);
            maxY = Math.max(maxY, l.y1 + d);
        }
    });

    const padding = 60;
    return {
        x: minX - padding,
        y: minY - padding,
        width: (maxX - minX) + (padding * 2),
        height: (maxY - minY) + (padding * 2)
    };
}

function toggleExportOptions() {
    const fmt = document.getElementById('expFormat').value;
    const visualOptions = document.getElementById('visualExportOptions');
    if (visualOptions) {
        visualOptions.style.display = (fmt === 'json' || fmt === 'dxf') ? 'none' : 'block';
    }
}

function processExport() {
    const fmt = document.getElementById('expFormat').value;
    const bg = document.getElementById('expBG').value;
    const fontSize = parseInt(document.getElementById('expFontSize').value);
    const filename = 'gemini_cad_export';
    const bounds = getDrawingBoundaries();

    if (!bounds && fmt !== 'json') {
        alert("The canvas is empty!");
        return;
    }

    if (fmt === 'png') {
        const temp = document.createElement('canvas');
        temp.width = bounds.width;
        temp.height = bounds.height;
        const tctx = temp.getContext('2d');

        if (bg !== 'transparent') {
            tctx.fillStyle = bg;
            tctx.fillRect(0, 0, temp.width, temp.height);
        }

        tctx.translate(-bounds.x, -bounds.y);

        lines.forEach(l => {
            tctx.lineWidth = 2;
            tctx.strokeStyle = (bg === '#ffffff') ? '#000' : (l.type === 'window' ? '#3498db' : (l.type === 'door' ? '#e67e22' : '#fff'));

            if (l.type === 'window') {
                const ang = Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
                const gap = 3;
                const ox = Math.sin(ang) * gap;
                const oy = Math.cos(ang) * gap;
                tctx.beginPath();
                tctx.moveTo(l.x1 + ox, l.y1 - oy);
                tctx.lineTo(l.x2 + ox, l.y2 - oy);
                tctx.moveTo(l.x1 - ox, l.y1 + oy);
                tctx.lineTo(l.x2 - ox, l.y2 + oy);
                tctx.stroke();
            } else if (l.type === 'door') {
                const ang = Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
                const d = dist(l.x1, l.y1, l.x2, l.y2);
                const mirror = l.mirrored ? 1 : -1;
                tctx.beginPath();
                tctx.moveTo(l.x1, l.y1);
                tctx.lineTo(l.x1 + Math.cos(ang + (mirror * Math.PI / 2)) * d, l.y1 + Math.sin(ang + (mirror * Math.PI / 2)) * d);
                tctx.stroke();
                tctx.beginPath();
                tctx.setLineDash([5, 5]);
                if (l.mirrored) tctx.arc(l.x1, l.y1, d, ang, ang + Math.PI / 2);
                else tctx.arc(l.x1, l.y1, d, ang - Math.PI / 2, ang);
                tctx.stroke();
                tctx.setLineDash([]);
            } else {
                tctx.beginPath();
                tctx.moveTo(l.x1, l.y1);
                tctx.lineTo(l.x2, l.y2);
                tctx.stroke();
            }

            if (baseCmPerPixel) {
                let dVal = getDisplayLength(dist(l.x1, l.y1, l.x2, l.y2)).toFixed(2);
                tctx.fillStyle = (bg === '#ffffff') ? '#000' : '#0f0';
                tctx.font = `${fontSize}px Arial`;
                tctx.fillText(`${dVal}${activeUnit}`, (l.x1 + l.x2) / 2 + 5, (l.y1 + l.y2) / 2);
            }
        });

        const a = document.createElement('a');
        a.download = filename + '.png';
        a.href = temp.toDataURL();
        a.click();

    } else if (fmt === 'svg') {
        let svgLines = '';
        const textColor = (bg === '#ffffff') ? 'black' : 'lime';

        lines.forEach(l => {
            const len = getDisplayLength(dist(l.x1, l.y1, l.x2, l.y2)).toFixed(2);
            const color = (bg === '#ffffff') ? 'black' : (l.type === 'window' ? '#3498db' : (l.type === 'door' ? '#e67e22' : 'white'));

            if (l.type === 'window') {
                const ang = Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
                const gap = 3;
                const ox = Math.sin(ang) * gap;
                const oy = Math.cos(ang) * gap;
                svgLines += `<line x1="${l.x1+ox-bounds.x}" y1="${l.y1-oy-bounds.y}" x2="${l.x2+ox-bounds.x}" y2="${l.y2-oy-bounds.y}" stroke="${color}" stroke-width="2"/>`;
                svgLines += `<line x1="${l.x1-ox-bounds.x}" y1="${l.y1+oy-bounds.y}" x2="${l.x2-ox-bounds.x}" y2="${l.y2+oy-bounds.y}" stroke="${color}" stroke-width="2"/>`;
            } else if (l.type === 'door') {
                const ang = Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
                const d = dist(l.x1, l.y1, l.x2, l.y2);
                const mirror = l.mirrored ? 1 : -1;
                const lx = l.x1 + Math.cos(ang + (mirror * Math.PI / 2)) * d;
                const ly = l.y1 + Math.sin(ang + (mirror * Math.PI / 2)) * d;
                const sweep = l.mirrored ? 1 : 0; // SVG arc sweep flag
                const endX = l.x2;
                const endY = l.y2;

                svgLines += `<line x1="${l.x1-bounds.x}" y1="${l.y1-bounds.y}" x2="${lx-bounds.x}" y2="${ly-bounds.y}" stroke="${color}" stroke-width="2"/>`;
                svgLines += `<path d="M ${lx-bounds.x} ${ly-bounds.y} A ${d} ${d} 0 0 ${sweep} ${endX-bounds.x} ${endY-bounds.y}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="5,5"/>`;
            } else {
                svgLines += `<line x1="${l.x1-bounds.x}" y1="${l.y1-bounds.y}" x2="${l.x2-bounds.x}" y2="${l.y2-bounds.y}" stroke="${color}" stroke-width="2"/>`;
            }
            svgLines += `<text x="${((l.x1+l.x2)/2)-bounds.x}" y="${((l.y1+l.y2)/2)-bounds.y}" fill="${textColor}" font-size="${fontSize}">${len}${activeUnit}</text>`;
        });

        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" style="background:${bg}">${svgLines}</svg>`;
        const blob = new Blob([svgContent], {
            type: 'image/svg+xml'
        });
        const a = document.createElement('a');
        a.download = filename + '.svg';
        a.href = URL.createObjectURL(blob);
        a.click();

    } else if (fmt === 'json') {
        const projectData = {
            lines,
            baseCmPerPixel,
            activeUnit
        };
        const a = document.createElement('a');
        a.download = filename + '.json';
        a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(projectData));
        a.click();
    } else if (fmt === 'dxf') {
        const dxfContent = generateDXF();
        const blob = new Blob([dxfContent], {
            type: 'application/dxf'
        });
        const a = document.createElement('a');
        a.download = filename + '.dxf';
        a.href = URL.createObjectURL(blob);
        a.click();
    }
    closeModal('exportModal');
}

function generateDXF() {
    let dxf = "0\nSECTION\n2\nENTITIES\n"; // Start Entities section

    lines.forEach(l => {
        dxf += "0\nLINE\n"; // Define a Line entity
        dxf += "8\n0\n"; // Layer 0
        dxf += `10\n${l.x1}\n`; // Start X
        dxf += `20\n${-l.y1}\n`; // Start Y (Inverted for CAD standard)
        dxf += `30\n0.0\n`; // Start Z
        dxf += `11\n${l.x2}\n`; // End X
        dxf += `21\n${-l.y2}\n`; // End Y (Inverted for CAD standard)
        dxf += `31\n0.0\n`; // End Z
    });

    dxf += "0\nENDSEC\n0\nEOF"; // Close Section and End of File
    return dxf;
}

// --- FIXED: IMPORT ENGINE ---
function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            // Validation and loading
            if (data.lines) {
                saveState(); // Save current to undo stack before replacing
                lines = data.lines;
                baseCmPerPixel = data.baseCmPerPixel;
                activeUnit = data.activeUnit || 'cm';

                // Sync UI
                changeUnit(activeUnit);
                activeLine = null;
                selectedPoint = null;
                updateInspector();
                draw();

                console.log("JSON Project Imported Successfully");
            }
        } catch (err) {
            alert("Error: Invalid JSON project file.");
            console.error(err);
        }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input to allow re-importing same file
}

function processParametricToJSON() {
    const text = document.getElementById('para-input').value;
    const linesInput = text.split('\n');

    // Check if calibration exists. If not, 1 unit = 1 pixel as a fallback.
    const scaleFactor = baseCmPerPixel ? (1 / (baseCmPerPixel * unitTable[activeUnit])) : 1;

    let currentX = 0;
    let currentY = 0;

    // If there are existing lines, start the parametric drawing from the END of the last line
    if (lines.length > 0) {
        currentX = lines[lines.length - 1].x2;
        currentY = lines[lines.length - 1].y2;
    }

    let newLines = [];

    linesInput.forEach(line => {
        let cmd = line.trim().toUpperCase();
        if (!cmd) return;

        let dir = cmd[0];
        let rawVal = parseFloat(cmd.substring(1));
        if (isNaN(rawVal)) return;

        // CONVERT REAL WORLD UNIT TO PIXELS
        let pixelVal = rawVal * scaleFactor;

        let startX = currentX;
        let startY = currentY;
        let endX = currentX;
        let endY = currentY;

        // Support N/S/E/W and your requested L/R/U/D (Left, Right, Up, Down)
        if (dir === 'N' || dir === 'U') endY -= pixelVal;
        else if (dir === 'S' || dir === 'D') endY += pixelVal;
        else if (dir === 'E' || dir === 'R') endX += pixelVal;
        else if (dir === 'W' || dir === 'L') endX -= pixelVal;

        newLines.push({
            x1: startX,
            y1: startY,
            x2: endX,
            y2: endY,
            locked: false // New lines start unlocked
        });

        currentX = endX;
        currentY = endY;
    });

    if (newLines.length > 0) {
        saveState();
        lines = lines.concat(newLines);
        document.getElementById('para-input').value = "";
        draw();
        saveToStorage();
        console.log("Parametric drawing generated using calibrated scale.");
    } else {
        alert("Please enter valid commands (e.g., R1000, U800)");
    }
}

function toggleParametric() {
    const content = document.getElementById('para-content');
    const chevron = document.getElementById('para-chevron');

    if (content.style.display === "none") {
        content.style.display = "block";
        chevron.innerText = "▼";
        chevron.style.color = "#27ae60";
    } else {
        content.style.display = "none";
        chevron.innerText = "▶";
        chevron.style.color = "#888";
    }
}

const contextMenu = document.getElementById('contextMenu');

// Listen for right-click on the canvas
canvas.addEventListener('contextmenu', function(e) {
    e.preventDefault(); // Stop browser menu

    // Position the menu at the mouse coordinates
    contextMenu.style.display = 'block';
    contextMenu.style.left = e.pageX + 'px';
    contextMenu.style.top = e.pageY + 'px';
});

// Helper function to set tool and hide menu
function setTool(toolName) {
    // This assumes you have a function or logic that switches tools
    // Adjust variable names (e.g., activeTool) based on your specific code
    currentTool = toolName;

    // Update UI highlights if necessary
    updateToolbarUI();

    hideContextMenu();
}

function hideContextMenu() {
    contextMenu.style.display = 'none';
}

// Hide menu when clicking anywhere else
window.addEventListener('click', function(e) {
    if (!contextMenu.contains(e.target)) {
        hideContextMenu();
    }
});

// Update the delete function call for the menu
function deleteSelected() {
    if (activeLine) {
        lines = lines.filter(l => l !== activeLine);
        activeLine = null;
        draw();
    }
    hideContextMenu();
}


function deleteLine() {
    if (activeLine) {
        saveState();
        lines = lines.filter(l => l !== activeLine);
        activeLine = null;
        selectedPoint = null;
        updateInspector();
        draw();
        saveToStorage();
    }
}

function deleteProject() {
    if (confirm("Clear workspace?")) {
        saveState();
        lines = [];
        baseCmPerPixel = null;
        saveToStorage();
        draw();
        updateInspector();
    }
}

function showExportModal() {
    document.getElementById('exportModal').style.display = 'flex';
    toggleExportOptions();
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

function setTool(t) {
    tool = t;
    document.querySelectorAll('.tool-icon').forEach(el => el.classList.remove('active'));
    document.getElementById(t + '-tool').classList.add('active');
}

function zoomIn() {
    camera.zoom *= 1.2;
    document.getElementById('zoom-text').innerText = Math.round(camera.zoom * 100) + '%';
    draw();
}

function zoomOut() {
    camera.zoom *= 0.8;
    document.getElementById('zoom-text').innerText = Math.round(camera.zoom * 100) + '%';
    draw();
}

function applyCalibration() {
    const v = document.getElementById('calib-val').value;
    const last = lines[lines.length - 1];
    if (v && last) {
        baseCmPerPixel = (v / unitTable[activeUnit]) / dist(last.x1, last.y1, last.x2, last.y2);
        closeModal('calibModal');
        draw();
    }
}

function saveToStorage() {
    localStorage.setItem('cad_v11_stable', JSON.stringify({
        lines,
        baseCmPerPixel,
        activeUnit
    }));
}

function loadFromStorage() {
    const s = localStorage.getItem('cad_v11_stable');
    if (s) {
        const d = JSON.parse(s);
        lines = d.lines;
        baseCmPerPixel = d.baseCmPerPixel;
        activeUnit = d.activeUnit || 'cm';
        changeUnit(activeUnit);
    }
}

function showGuide() {
    document.getElementById('guideModal').style.display = 'flex';
}

window.addEventListener('keydown', e => {
    if (e.key === 'Shift') isShiftDown = true;
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Delete' || e.key === 'Backspace') deleteLine();
    if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undo();
    }
    if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        redo();
    }
    if (e.key === 'l') setTool('line');
    if (e.key === 'v') setTool('select');
    if (e.key === 'd') setTool('door');
    if (e.key === 'w') setTool('window');
});
window.addEventListener('keyup', e => {
    if (e.key === 'Shift') isShiftDown = false;
});
canvas.addEventListener('wheel', e => {
    e.preventDefault();

    // 1. Get the mouse position in "world" coordinates before zooming
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldPosBefore = screenToWorld(mouseX, mouseY);

    // 2. Calculate the new zoom level
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const nextZoom = camera.zoom * zoomFactor;

    // Optional: Limit zoom range to prevent getting lost
    if (nextZoom > 0.05 && nextZoom < 50) {
        camera.zoom = nextZoom;

        // 3. Get the mouse position in "world" coordinates after zooming
        // We calculate what the new world position WOULD be at the new zoom
        const worldPosAfter = screenToWorld(mouseX, mouseY);

        // 4. Adjust the camera (pan) so the mouse stays over the same world point
        camera.x += (worldPosBefore.x - worldPosAfter.x);
        camera.y += (worldPosBefore.y - worldPosAfter.y);
    }

    document.getElementById('zoom-text').innerText = Math.round(camera.zoom * 100) + '%';
    draw();
}, {
    passive: false
});
init();
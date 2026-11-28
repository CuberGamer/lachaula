/**
 * fisica-hbs.js
 *
 * Parser, normalizador y motor de físicas compatible con archivos .hbs de HaxBall
 * (vertexes, segments rectos y curvos, planes, discs estáticos y dinámicos,
 * joints, goals, traits, cGroup/cMask, redKO/blueKO, playerPhysics y ballPhysics).
 * Funciona tanto en Node.js (servidor) como en navegador (predicción y dibujo).
 */
(function (global) {
    const MASK = {
        ball: 1,
        red: 2,
        blue: 4,
        wall: 8,
        redKO: 16,
        blueKO: 32,
        kick: 64,
        score: 128,
        c0: 256,
        c1: 512,
        c2: 1024,
        c3: 2048
    };
    const ALL_MASK = 4095;

    const DEFAULT_PLAYER_PHYSICS = {
        radio: 15,
        bCoef: 0.5,
        invMass: 0.5,
        damping: 0.96,
        acceleration: 0.1,
        kickingAcceleration: 0.07,
        kickingDamping: 0.96,
        kickStrength: 5,
        gravity: [0, 0]
    };

    const DEFAULT_BALL_PHYSICS = {
        radius: 10,
        bCoef: 0.5,
        invMass: 1,
        damping: 0.99,
        color: '#ffffff',
        cMask: ALL_MASK,
        cGroup: MASK.ball,
        gravity: [0, 0]
    };

    const COLORES_PELOTA_PRACTICA = [
        '#38bdf8',
        '#fb7185',
        '#a78bfa',
        '#34d399',
        '#fbbf24',
        '#f97316',
        '#f472b6',
        '#2dd4bf'
    ];

    function parseRgbColor(color) {
        if (!color || typeof color !== 'string') return null;
        const c = color.trim().toLowerCase();
        const hex3 = c.match(/^#([0-9a-f]{3})$/);
        if (hex3) {
            return hex3[1].split('').map(ch => parseInt(ch + ch, 16));
        }
        const hex6 = c.match(/^#([0-9a-f]{6})$/);
        if (hex6) {
            const h = hex6[1];
            return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
        }
        const rgb = c.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
        if (rgb) {
            return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
        }
        return null;
    }

    function coloresMuyParecidos(a, b) {
        const ra = parseRgbColor(a);
        const rb = parseRgbColor(b);
        if (!ra || !rb) return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
        return (Math.abs(ra[0] - rb[0]) + Math.abs(ra[1] - rb[1]) + Math.abs(ra[2] - rb[2])) < 90;
    }

    function elegirColorPelotaPractica(estado, ownerId) {
        const colorOriginal = (estado && estado.mapa && estado.mapa.ballPhysics && estado.mapa.ballPhysics.color) || '#ffffff';
        const usados = new Set(
            (estado && Array.isArray(estado.extraBalls) ? estado.extraBalls : [])
                .filter(b => b.ownerId !== ownerId && b.color)
                .map(b => b.color.toLowerCase())
        );
        const disponibles = COLORES_PELOTA_PRACTICA.filter(c =>
            !coloresMuyParecidos(c, colorOriginal) && !coloresMuyParecidos(c, '#ffffff')
        );
        const pool = disponibles.length ? disponibles : COLORES_PELOTA_PRACTICA;
        const libre = pool.find(c => !usados.has(c.toLowerCase()));
        if (libre) return libre;
        let hash = 0;
        const str = String(ownerId || '');
        for (let i = 0; i < str.length; i += 1) {
            hash = ((hash * 31) + str.charCodeAt(i)) >>> 0;
        }
        return pool[hash % pool.length];
    }

    function stripJsonComments(str) {
        let out = '';
        let inStr = false;
        let esc = false;
        for (let i = 0; i < str.length; i += 1) {
            const c = str[i];
            const n = str[i + 1];
            if (inStr) {
                out += c;
                if (esc) esc = false;
                else if (c === '\\') esc = true;
                else if (c === '"') inStr = false;
            } else if (c === '"') {
                inStr = true;
                out += c;
            } else if (c === '/' && n === '/') {
                while (i < str.length && str[i] !== '\n') i += 1;
                out += '\n';
            } else if (c === '/' && n === '*') {
                i += 2;
                while (i < str.length && !(str[i] === '*' && str[i + 1] === '/')) i += 1;
                i += 1;
            } else {
                out += c;
            }
        }
        return out.replace(/,\s*([}\]])/g, '$1');
    }

    function parseHbsTexto(texto) {
        if (typeof texto !== 'string' || !texto.trim()) {
            throw new Error('El archivo .hbs está vacío.');
        }
        if (texto.length > 1024 * 1024) {
            throw new Error('El archivo .hbs es demasiado grande (máx. 1 MB).');
        }
        let data;
        try {
            data = JSON.parse(stripJsonComments(texto));
        } catch (err) {
            throw new Error('JSON inválido en el archivo .hbs.');
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('El archivo .hbs debe contener un objeto de estadio.');
        }
        const hasGeometry = Array.isArray(data.vertexes) || Array.isArray(data.segments) || Array.isArray(data.planes) || Array.isArray(data.discs);
        if (!hasGeometry) {
            throw new Error('El archivo .hbs no contiene geometría válida.');
        }
        return data;
    }

    function parseFlags(val, defaultBits) {
        if (val === undefined || val === null) return defaultBits;
        if (typeof val === 'number' && Number.isFinite(val)) return val | 0;
        const list = Array.isArray(val) ? val : [val];
        let bits = 0;
        for (let i = 0; i < list.length; i += 1) {
            const name = String(list[i] || '').trim();
            if (!name || name === 'none' || name === 'n/d') continue;
            if (name === 'all') {
                bits |= ALL_MASK;
            } else if (MASK[name]) {
                bits |= MASK[name];
            }
        }
        return bits;
    }

    function parseHbsColor(color, fallback = null) {
        if (color === undefined || color === null || color === '') return fallback;
        if (color === 'transparent') return null;
        if (Array.isArray(color) && color.length >= 3) {
            const r = Math.max(0, Math.min(255, Number(color[0]) || 0)) | 0;
            const g = Math.max(0, Math.min(255, Number(color[1]) || 0)) | 0;
            const b = Math.max(0, Math.min(255, Number(color[2]) || 0)) | 0;
            return `rgb(${r},${g},${b})`;
        }
        if (typeof color === 'string') {
            const trimmed = color.trim();
            if (!trimmed || trimmed.toLowerCase() === 'transparent') return null;
            if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed}`;
            if (/^[0-9a-fA-F]{3}$/.test(trimmed)) return `#${trimmed}`;
            if (/^#[0-9a-fA-F]{3,6}$/.test(trimmed)) return trimmed;
            if (/^\d+\s*,\s*\d+\s*,\s*\d+$/.test(trimmed)) {
                const parts = trimmed.split(',').map(v => Math.max(0, Math.min(255, Number(v) || 0)) | 0);
                return `rgb(${parts[0]},${parts[1]},${parts[2]})`;
            }
            // En HaxBall strings de 8+ hex como "FFFFFFFF" se comportan como transparentes
            if (/^[0-9a-fA-F]{8,}$/.test(trimmed)) return null;
        }
        return fallback;
    }

    function mergeTrait(traits, item) {
        if (!item || typeof item !== 'object') return {};
        if (item.trait && traits && traits[item.trait] && typeof traits[item.trait] === 'object') {
            return { ...traits[item.trait], ...item };
        }
        return { ...item };
    }

    function numero(val, def) {
        const n = Number(val);
        return Number.isFinite(n) ? n : def;
    }

    function resolverArco(x0, y0, x1, y1, curveDeg, curveFInput) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const dist = Math.hypot(dx, dy);
        if (dist < 1e-6) return null;

        let angleRad = 0;
        let curveF = 0;
        if (Number.isFinite(curveFInput) && Math.abs(curveFInput) > 1e-6) {
            curveF = curveFInput;
            angleRad = 2 * Math.atan(1 / curveF);
        } else {
            const clamped = Math.max(-340, Math.min(340, Number(curveDeg) || 0));
            if (Math.abs(clamped) < 1e-4) return null;
            angleRad = (clamped * Math.PI) / 180;
            const halfTan = Math.tan(angleRad / 2);
            curveF = Math.abs(halfTan) < 1e-7 ? 0 : 1 / halfTan;
        }

        const midX = (x0 + x1) / 2;
        const midY = (y0 + y1) / 2;
        const h = dist / 2;
        const perpX = -dy / dist;
        const perpY = dx / dist;
        const cx = midX + perpX * h * curveF;
        const cy = midY + perpY * h * curveF;
        const radius = Math.hypot(x0 - cx, y0 - cy);
        const a0 = Math.atan2(y0 - cy, x0 - cx);
        const a1 = Math.atan2(y1 - cy, x1 - cx);

        return {
            cx,
            cy,
            radius,
            a0,
            a1,
            angleRad,
            anticlockwise: angleRad < 0
        };
    }

    function normalizarHbs(rawHbs, meta = {}) {
        const traits = (rawHbs && typeof rawHbs.traits === 'object' && rawHbs.traits) || {};
        const halfW = Math.max(120, Math.min(3200, numero(rawHbs.width, 420)));
        const halfH = Math.max(80, Math.min(2000, numero(rawHbs.height, 200)));
        const width = Math.round(halfW * 2);
        const height = Math.round(halfH * 2);
        const ox = halfW;
        const oy = halfH;

        const rawBg = (rawHbs && typeof rawHbs.bg === 'object' && rawHbs.bg) || {};
        const bgType = String(rawBg.type || 'none').toLowerCase();
        const bg = {
            type: bgType,
            width: Math.max(0, numero(rawBg.width, 0)) * 2,
            height: Math.max(0, numero(rawBg.height, 0)) * 2,
            kickOffRadius: Math.max(0, numero(rawBg.kickOffRadius, 75)),
            cornerRadius: Math.max(0, numero(rawBg.cornerRadius, 0)),
            goalLine: numero(rawBg.goalLine, null),
            color: parseHbsColor(rawBg.color, null)
        };

        const rawVertexes = Array.isArray(rawHbs.vertexes) ? rawHbs.vertexes : [];
        const vertexes = rawVertexes.map(raw => {
            const v = mergeTrait(traits, raw);
            const x = numero(v.x, Array.isArray(v.pos) ? numero(v.pos[0], 0) : 0) + ox;
            const y = numero(v.y, Array.isArray(v.pos) ? numero(v.pos[1], 0) : 0) + oy;
            return {
                x,
                y,
                bCoef: numero(v.bCoef, 1),
                cMask: parseFlags(v.cMask, ALL_MASK),
                cGroup: parseFlags(v.cGroup, MASK.wall)
            };
        });

        const rawSegments = Array.isArray(rawHbs.segments) ? rawHbs.segments : [];
        const segments = [];
        for (let i = 0; i < rawSegments.length; i += 1) {
            const s = mergeTrait(traits, rawSegments[i]);
            const v0 = vertexes[s.v0];
            const v1 = vertexes[s.v1];
            if (!v0 || !v1) continue;
            const vis = s.vis !== false;
            const color = vis ? parseHbsColor(s.color, '#000000') : null;
            const curveDeg = numero(s.curve, 0);
            const curveF = Number.isFinite(Number(s.curveF)) ? Number(s.curveF) : null;
            const arc = (Math.abs(curveDeg) > 1e-4 || (curveF !== null && Math.abs(curveF) > 1e-6))
                ? resolverArco(v0.x, v0.y, v1.x, v1.y, curveDeg, curveF)
                : null;
            segments.push({
                x0: v0.x,
                y0: v0.y,
                x1: v1.x,
                y1: v1.y,
                bCoef: numero(s.bCoef, 1),
                cMask: parseFlags(s.cMask, ALL_MASK),
                cGroup: parseFlags(s.cGroup, MASK.wall),
                vis,
                color,
                bias: numero(s.bias, 0),
                curve: curveDeg,
                arc
            });
        }

        const rawPlanes = Array.isArray(rawHbs.planes) ? rawHbs.planes : [];
        const planes = [];
        for (let i = 0; i < rawPlanes.length; i += 1) {
            const p = mergeTrait(traits, rawPlanes[i]);
            if (!Array.isArray(p.normal) || p.normal.length < 2) continue;
            let nx = numero(p.normal[0], 0);
            let ny = numero(p.normal[1], 0);
            const len = Math.hypot(nx, ny);
            if (len < 1e-6) continue;
            nx /= len;
            ny /= len;
            const distOrig = numero(p.dist, 0);
            // Plano en coords originales: nx * x + ny * y >= distOrig
            // En coords desplazadas (x' = x + ox, y' = y + oy): nx * x' + ny * y' >= distOrig + nx * ox + ny * oy
            planes.push({
                nx,
                ny,
                dist: distOrig + nx * ox + ny * oy,
                bCoef: numero(p.bCoef, 1),
                cMask: parseFlags(p.cMask, ALL_MASK),
                cGroup: parseFlags(p.cGroup, MASK.wall)
            });
        }

        const rawDiscs = Array.isArray(rawHbs.discs) ? rawHbs.discs : [];
        let ballFromDisc0 = rawHbs.ballPhysics === 'disc0' && rawDiscs[0] ? mergeTrait(traits, rawDiscs[0]) : null;
        const startIdx = ballFromDisc0 ? 1 : 0;
        const discs = [];
        for (let i = startIdx; i < rawDiscs.length; i += 1) {
            const d = mergeTrait(traits, rawDiscs[i]);
            const px = Array.isArray(d.pos) ? numero(d.pos[0], 0) : numero(d.x, 0);
            const py = Array.isArray(d.pos) ? numero(d.pos[1], 0) : numero(d.y, 0);
            const sx = Array.isArray(d.speed) ? numero(d.speed[0], 0) : 0;
            const sy = Array.isArray(d.speed) ? numero(d.speed[1], 0) : 0;
            const radius = Math.max(0.5, numero(d.radius, 10));
            const vis = d.vis !== false && radius < 2500;
            const color = vis ? parseHbsColor(d.color, '#ffffff') : null;
            discs.push({
                x: px + ox,
                y: py + oy,
                vx: sx,
                vy: sy,
                radius,
                bCoef: numero(d.bCoef, 0.5),
                invMass: numero(d.invMass, 0),
                damping: numero(d.damping, 0.99),
                cMask: parseFlags(d.cMask, ALL_MASK),
                cGroup: parseFlags(d.cGroup, MASK.wall),
                color
            });
        }

        const rawJoints = Array.isArray(rawHbs.joints) ? rawHbs.joints : [];
        const joints = [];
        for (let i = 0; i < rawJoints.length; i += 1) {
            const j = mergeTrait(traits, rawJoints[i]);
            let d0 = Number(j.d0);
            let d1 = Number(j.d1);
            if (!Number.isInteger(d0) || !Number.isInteger(d1)) continue;
            if (ballFromDisc0) {
                d0 -= 1;
                d1 -= 1;
            }
            if (!discs[d0] || !discs[d1]) continue;
            let minLen = 100;
            let maxLen = 100;
            if (Array.isArray(j.length)) {
                minLen = numero(j.length[0], 0);
                maxLen = numero(j.length[1], minLen);
            } else if (Number.isFinite(Number(j.length))) {
                minLen = Number(j.length);
                maxLen = minLen;
            } else {
                const distInit = Math.hypot(discs[d1].x - discs[d0].x, discs[d1].y - discs[d0].y);
                minLen = distInit;
                maxLen = distInit;
            }
            const strength = j.strength === 'inf' || j.strength === Infinity
                ? Infinity
                : Math.max(0, numero(j.strength, Infinity));
            joints.push({
                d0,
                d1,
                minLen,
                maxLen,
                strength,
                color: parseHbsColor(j.color, null)
            });
        }

        const rawGoals = Array.isArray(rawHbs.goals) ? rawHbs.goals : [];
        const goals = [];
        for (let i = 0; i < rawGoals.length; i += 1) {
            const g = rawGoals[i];
            if (!g || !Array.isArray(g.p0) || !Array.isArray(g.p1)) continue;
            goals.push({
                x0: numero(g.p0[0], 0) + ox,
                y0: numero(g.p0[1], 0) + oy,
                x1: numero(g.p1[0], 0) + ox,
                y1: numero(g.p1[1], 0) + oy,
                team: String(g.team || '').toLowerCase() === 'blue' ? 'blue' : 'red'
            });
        }

        const rawPP = (rawHbs && typeof rawHbs.playerPhysics === 'object' && rawHbs.playerPhysics) || {};
        const playerPhysics = {
            radio: DEFAULT_PLAYER_PHYSICS.radio,
            bCoef: numero(rawPP.bCoef, DEFAULT_PLAYER_PHYSICS.bCoef),
            invMass: numero(rawPP.invMass, DEFAULT_PLAYER_PHYSICS.invMass),
            damping: numero(rawPP.damping, DEFAULT_PLAYER_PHYSICS.damping),
            acceleration: numero(rawPP.acceleration, DEFAULT_PLAYER_PHYSICS.acceleration),
            kickingAcceleration: numero(rawPP.kickingAcceleration, DEFAULT_PLAYER_PHYSICS.kickingAcceleration),
            kickingDamping: numero(rawPP.kickingDamping, DEFAULT_PLAYER_PHYSICS.kickingDamping),
            kickStrength: numero(rawPP.kickStrength, DEFAULT_PLAYER_PHYSICS.kickStrength),
            gravity: Array.isArray(rawPP.gravity)
                ? [numero(rawPP.gravity[0], 0), numero(rawPP.gravity[1], 0)]
                : [0, 0]
        };

        const rawBP = ballFromDisc0 || ((rawHbs && typeof rawHbs.ballPhysics === 'object' && rawHbs.ballPhysics) || {});
        const ballPhysics = {
            x: Array.isArray(rawBP.pos) ? numero(rawBP.pos[0], 0) + ox : ox,
            y: Array.isArray(rawBP.pos) ? numero(rawBP.pos[1], 0) + oy : oy,
            vx: Array.isArray(rawBP.speed) ? numero(rawBP.speed[0], 0) : 0,
            vy: Array.isArray(rawBP.speed) ? numero(rawBP.speed[1], 0) : 0,
            radius: Math.max(2, numero(rawBP.radius, DEFAULT_BALL_PHYSICS.radius)),
            bCoef: numero(rawBP.bCoef, DEFAULT_BALL_PHYSICS.bCoef),
            invMass: numero(rawBP.invMass, DEFAULT_BALL_PHYSICS.invMass),
            damping: numero(rawBP.damping, DEFAULT_BALL_PHYSICS.damping),
            color: parseHbsColor(rawBP.color, DEFAULT_BALL_PHYSICS.color) || '#ffffff',
            cMask: parseFlags(rawBP.cMask, DEFAULT_BALL_PHYSICS.cMask),
            cGroup: parseFlags(rawBP.cGroup, DEFAULT_BALL_PHYSICS.cGroup),
            gravity: Array.isArray(rawBP.gravity)
                ? [numero(rawBP.gravity[0], 0), numero(rawBP.gravity[1], 0)]
                : [0, 0]
        };

        const redSpawnPoints = Array.isArray(rawHbs.redSpawnPoints)
            ? rawHbs.redSpawnPoints.filter(p => Array.isArray(p) && p.length >= 2).map(p => ({ x: numero(p[0], 0) + ox, y: numero(p[1], 0) + oy }))
            : [];
        const blueSpawnPoints = Array.isArray(rawHbs.blueSpawnPoints)
            ? rawHbs.blueSpawnPoints.filter(p => Array.isArray(p) && p.length >= 2).map(p => ({ x: numero(p[0], 0) + ox, y: numero(p[1], 0) + oy }))
            : [];

        const spawnDistance = Math.max(40, Math.min(halfW - 20, numero(rawHbs.spawnDistance, Math.min(200, halfW * 0.45))));
        const fieldW = bg.width > 0 ? bg.width : width * 0.85;
        const fieldH = bg.height > 0 ? bg.height : height * 0.85;
        const field = {
            left: ox - fieldW / 2,
            right: ox + fieldW / 2,
            top: oy - fieldH / 2,
            bottom: oy + fieldH / 2
        };

        const nombre = String(meta.name || rawHbs.name || 'Mapa HaxBall')
            .replace(/\s+from HaxMaps$/i, '')
            .trim()
            .slice(0, 48);

        return {
            id: meta.id || `hbs_${Date.now()}`,
            name: nombre,
            hbs: true,
            category: meta.category || 'HaxBall',
            haxmapsId: meta.haxmapsId || null,
            imported: !!meta.imported,
            theme: bg.type === 'hockey' ? 'hbs-hockey' : 'hbs-grass',
            width,
            height,
            escala: 1,
            goalHeight: Math.round(height * 0.35),
            margenX: Math.round((width - fieldW) / 2),
            margenY: Math.round((height - fieldH) / 2),
            profundidadArco: 35,
            radioSaque: bg.kickOffRadius || 75,
            radioPoste: 5,
            field,
            goalTop: oy - height * 0.175,
            goalBottom: oy + height * 0.175,
            spawnDistance,
            redSpawnPoints,
            blueSpawnPoints,
            bg,
            vertexes,
            segments,
            planes,
            discs,
            joints,
            goals,
            playerPhysics,
            ballPhysics
        };
    }

    function posicionJugadorHbs(mapa, equipo, orden) {
        const spawns = equipo === 'blue' ? mapa.blueSpawnPoints : mapa.redSpawnPoints;
        if (spawns && spawns.length) {
            const p = spawns[orden % spawns.length];
            return { x: p.x, y: p.y };
        }
        const ox = mapa.width / 2;
        const oy = mapa.height / 2;
        const isRed = equipo !== 'blue';
        const dist = Math.min(mapa.spawnDistance || 180, ox - 30);
        const row = orden === 0 ? 0 : (orden % 2 ? -1 : 1) * Math.ceil(orden / 2) * 48;
        return {
            x: ox + (isRed ? -dist : dist),
            y: Math.max(30, Math.min(mapa.height - 30, oy + row))
        };
    }

    function crearEstado({ mapa, ladoIzquierdo = 'red', kickoffTeam = 'red', jugadores = [], sinSaques = false } = {}) {
        const players = jugadores.map((j, idx) => {
            const id = j.id == null ? `j${idx + 1}` : String(j.id);
            const equipo = j.equipo === 'blue' ? 'blue' : 'red';
            const sameTeam = jugadores.slice(0, idx).filter(item => (item.equipo === 'blue' ? 'blue' : 'red') === equipo).length;
            const pos = posicionJugadorHbs(mapa, equipo, sameTeam);
            const r = mapa.playerPhysics.radio;
            return {
                id,
                equipo,
                x: pos.x,
                y: pos.y,
                vx: 0,
                vy: 0,
                r,
                rBase: r,
                invMass: mapa.playerPhysics.invMass,
                bCoef: mapa.playerPhysics.bCoef,
                cGroup: equipo === 'blue' ? MASK.blue : MASK.red,
                cMask: ALL_MASK,
                pateando: false,
                patadaUsada: false,
                activePower: null,
                powerTimer: 0,
                poderes: {},
                niveles: {}
            };
        });

        const bp = mapa.ballPhysics;
        const ball = {
            x: bp.x,
            y: bp.y,
            vx: bp.vx,
            vy: bp.vy,
            r: bp.radius,
            invMass: bp.invMass,
            bCoef: bp.bCoef,
            damping: bp.damping,
            cMask: bp.cMask,
            cGroup: bp.cGroup,
            color: bp.color
        };

        const dynamicDiscs = [];
        const staticDiscs = [];
        (mapa.discs || []).forEach(d => {
            const copy = {
                x: d.x,
                y: d.y,
                vx: d.vx || 0,
                vy: d.vy || 0,
                r: d.radius,
                bCoef: d.bCoef,
                invMass: d.invMass,
                damping: d.damping,
                cMask: d.cMask,
                cGroup: d.cGroup,
                color: d.color
            };
            if (copy.invMass > 0) dynamicDiscs.push(copy);
            else staticDiscs.push(copy);
        });

        return {
            motor: 'hbs',
            mapa,
            ladoIzquierdo,
            field: mapa.field,
            goalTop: mapa.goalTop,
            goalBottom: mapa.goalBottom,
            postes: [],
            players,
            ball,
            extraBalls: [],
            dynamicDiscs,
            staticDiscs,
            activePowerUps: [],
            waitingForKickOff: !sinSaques,
            kickoffPlayerId: players[0] ? players[0].id : 'j1',
            kickoffTeam: kickoffTeam === 'blue' ? 'blue' : 'red',
            golEnCurso: false,
            clockMs: 0,
            restoMs: 0,
            kickEvents: [],
            kickImpactEvents: [],
            touchEvents: [],
            timerStarted: !!sinSaques,
            goalResetPending: false,
            lastTouch: null,
            secondLastTouch: null,
            lastTouchSuperKick: false,
            lastGoalTeam: null,
            goalDetected: false,
            powerImpactId: 0,
            lastPowerImpact: null
        };
    }

    function puedenChocar(aMask, aGroup, bMask, bGroup, activeKOBits) {
        const effAGroup = (aGroup & ~(MASK.redKO | MASK.blueKO)) | (aGroup & activeKOBits);
        const effBGroup = (bGroup & ~(MASK.redKO | MASK.blueKO)) | (bGroup & activeKOBits);
        return (aMask & effBGroup) !== 0 && (bMask & effAGroup) !== 0;
    }

    function chocarDiscos(a, b, activeKOBits) {
        if (!puedenChocar(a.cMask, a.cGroup, b.cMask, b.cGroup, activeKOBits)) return false;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        const minDist = a.r + b.r;
        if (dist >= minDist || dist === 0) return false;
        const nx = dx / dist;
        const ny = dy / dist;
        const sumInv = a.invMass + b.invMass;
        if (!(sumInv > 0)) return false;
        const factor = a.invMass / sumInv;
        const overlap = minDist - dist;
        a.x += nx * overlap * factor;
        a.y += ny * overlap * factor;
        b.x -= nx * overlap * (1 - factor);
        b.y -= ny * overlap * (1 - factor);
        const relVel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (relVel < 0) {
            const imp = relVel * (1 + a.bCoef * b.bCoef);
            a.vx -= nx * imp * factor;
            a.vy -= ny * imp * factor;
            b.vx += nx * imp * (1 - factor);
            b.vy += ny * imp * (1 - factor);
        }
        return true;
    }

    function chocarDiscoFijo(disco, fijo, activeKOBits) {
        if (!puedenChocar(disco.cMask, disco.cGroup, fijo.cMask, fijo.cGroup, activeKOBits)) return;
        const dx = disco.x - fijo.x;
        const dy = disco.y - fijo.y;
        const dist = Math.hypot(dx, dy);
        const minDist = disco.r + fijo.r;
        if (dist >= minDist || dist === 0) return;
        const nx = dx / dist;
        const ny = dy / dist;
        disco.x += nx * (minDist - dist);
        disco.y += ny * (minDist - dist);
        const vn = disco.vx * nx + disco.vy * ny;
        if (vn < 0) {
            const bounce = 1 + disco.bCoef * fijo.bCoef;
            disco.vx -= nx * vn * bounce;
            disco.vy -= ny * vn * bounce;
        }
    }

    function chocarPlano(disco, plano, activeKOBits) {
        if (!puedenChocar(disco.cMask, disco.cGroup, plano.cMask, plano.cGroup, activeKOBits)) return;
        const d = plano.nx * disco.x + plano.ny * disco.y - plano.dist;
        const pen = disco.r - d;
        if (pen <= 0) return;
        disco.x += plano.nx * pen;
        disco.y += plano.ny * pen;
        const vn = disco.vx * plano.nx + disco.vy * plano.ny;
        if (vn < 0) {
            const bounce = 1 + disco.bCoef * plano.bCoef;
            disco.vx -= plano.nx * vn * bounce;
            disco.vy -= plano.ny * vn * bounce;
        }
    }

    function enSectorArco(qx, qy, arc) {
        const ang = Math.atan2(qy, qx);
        const twoPi = Math.PI * 2;
        if (arc.angleRad > 0) {
            const d = (((ang - arc.a0) % twoPi) + twoPi) % twoPi;
            return d <= arc.angleRad + 1e-4;
        }
        const d = (((arc.a0 - ang) % twoPi) + twoPi) % twoPi;
        return d <= -arc.angleRad + 1e-4;
    }

    function chocarSegmento(disco, seg, activeKOBits) {
        if (!puedenChocar(disco.cMask, disco.cGroup, seg.cMask, seg.cGroup, activeKOBits)) return;
        if (seg.arc) {
            const qx = disco.x - seg.arc.cx;
            const qy = disco.y - seg.arc.cy;
            const distC = Math.hypot(qx, qy);
            if (distC > 1e-6 && enSectorArco(qx, qy, seg.arc)) {
                const diff = distC - seg.arc.radius;
                if (Math.abs(diff) < disco.r) {
                    const sign = diff >= 0 ? 1 : -1;
                    const nx = (qx / distC) * sign;
                    const ny = (qy / distC) * sign;
                    const pen = disco.r - Math.abs(diff);
                    disco.x += nx * pen;
                    disco.y += ny * pen;
                    const vn = disco.vx * nx + disco.vy * ny;
                    if (vn < 0) {
                        const bounce = 1 + disco.bCoef * seg.bCoef;
                        disco.vx -= nx * vn * bounce;
                        disco.vy -= ny * vn * bounce;
                    }
                    return;
                }
            }
            // Extremos del arco
            const ends = [[seg.x0, seg.y0], [seg.x1, seg.y1]];
            for (let i = 0; i < 2; i += 1) {
                const dx = disco.x - ends[i][0];
                const dy = disco.y - ends[i][1];
                const dist = Math.hypot(dx, dy);
                if (dist > 0 && dist < disco.r) {
                    const nx = dx / dist;
                    const ny = dy / dist;
                    disco.x += nx * (disco.r - dist);
                    disco.y += ny * (disco.r - dist);
                    const vn = disco.vx * nx + disco.vy * ny;
                    if (vn < 0) {
                        const bounce = 1 + disco.bCoef * seg.bCoef;
                        disco.vx -= nx * vn * bounce;
                        disco.vy -= ny * vn * bounce;
                    }
                }
            }
            return;
        }

        const abx = seg.x1 - seg.x0;
        const aby = seg.y1 - seg.y0;
        const len2 = abx * abx + aby * aby;
        if (len2 < 1e-8) return;
        const t = Math.max(0, Math.min(1, ((disco.x - seg.x0) * abx + (disco.y - seg.y0) * aby) / len2));
        const cx = seg.x0 + t * abx;
        const cy = seg.y0 + t * aby;
        const dx = disco.x - cx;
        const dy = disco.y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist >= disco.r || dist === 0) return;
        const nx = dx / dist;
        const ny = dy / dist;
        disco.x += nx * (disco.r - dist);
        disco.y += ny * (disco.r - dist);
        const vn = disco.vx * nx + disco.vy * ny;
        if (vn < 0) {
            const bounce = 1 + disco.bCoef * seg.bCoef;
            disco.vx -= nx * vn * bounce;
            disco.vy -= ny * vn * bounce;
        }
    }

    function limitarEstadioHbs(disco, mapa) {
        if (!Number.isFinite(disco.x) || !Number.isFinite(disco.y)) {
            disco.x = mapa.width / 2;
            disco.y = mapa.height / 2;
            disco.vx = 0;
            disco.vy = 0;
            return;
        }
        disco.vx = Math.max(-80, Math.min(80, disco.vx));
        disco.vy = Math.max(-80, Math.min(80, disco.vy));
    }

    function segmentosCruzan(ax, ay, bx, by, cx, cy, dx, dy) {
        const cross = (ux, uy, vx, vy) => ux * vy - uy * vx;
        const abx = bx - ax;
        const aby = by - ay;
        const cdx = dx - cx;
        const cdy = dy - cy;
        const denom = cross(abx, aby, cdx, cdy);
        if (Math.abs(denom) < 1e-8) return false;
        const acx = cx - ax;
        const acy = cy - ay;
        const t = cross(acx, acy, cdx, cdy) / denom;
        const u = cross(acx, acy, abx, aby) / denom;
        return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    }

    function esEquipoQueSaca(jugador, estado) {
        if (estado.kickoffTeam === 'red' || estado.kickoffTeam === 'blue') return jugador.equipo === estado.kickoffTeam;
        return true;
    }

    function registrarToque(jugador, estado, { fuePatada = false, pelotaAntes = null } = {}) {
        if (estado.lastTouch !== jugador.id) estado.secondLastTouch = estado.lastTouch;
        estado.lastTouch = jugador.id;
        estado.lastTouchSuperKick = false;
        let esPrimerToque = false;
        if (estado.waitingForKickOff && !estado.golEnCurso && esEquipoQueSaca(jugador, estado)) {
            estado.waitingForKickOff = false;
            estado.timerStarted = true;
            esPrimerToque = true;
            if (estado.eventosTick) estado.eventosTick.push('primerToque');
        }
        if (estado.touchEvents) {
            estado.touchEvents.push({
                player: jugador,
                fuePatada: !!fuePatada,
                superTiro: false,
                esPrimerToque,
                pelotaAntes: pelotaAntes || (estado.ball ? { x: estado.ball.x, y: estado.ball.y, vx: estado.ball.vx, vy: estado.ball.vy } : null),
                pelotaDespues: estado.ball ? { x: estado.ball.x, y: estado.ball.y, vx: estado.ball.vx, vy: estado.ball.vy } : null
            });
        }
    }

    function patearPelotaHbs(jugador, pelota, estado, pp, esPrincipal) {
        const dx = pelota.x - jugador.x;
        const dy = pelota.y - jugador.y;
        const dist = Math.hypot(dx, dy);
        if (dist - jugador.r - pelota.r >= 4) return false;
        const pelotaAntes = { x: pelota.x, y: pelota.y, vx: pelota.vx, vy: pelota.vy };
        const nx = dist > 0 ? dx / dist : 1;
        const ny = dist > 0 ? dy / dist : 0;
        const kickImpulse = pp.kickStrength * pelota.invMass;
        if (Number.isFinite(kickImpulse)) {
            pelota.vx += nx * kickImpulse;
            pelota.vy += ny * kickImpulse;
        }
        jugador.patadaUsada = true;
        jugador.pateando = false;
        estado.kickImpactEvents.push({ player: jugador, extraBall: !esPrincipal });
        if (esPrincipal) {
            registrarToque(jugador, estado, { fuePatada: true, pelotaAntes });
        }
        return true;
    }

    function aplicarInput(jugador, input, estado) {
        const pp = estado.mapa.playerPhysics;
        const mantiene = !!(input.kick || input.kickPressed);
        if (!mantiene) jugador.patadaUsada = false;
        const armado = mantiene && !jugador.patadaUsada;
        if (armado && !jugador.pateando) estado.kickEvents.push({ player: jugador });
        jugador.pateando = armado;

        if (armado) {
            if (!patearPelotaHbs(jugador, estado.ball, estado, pp, true)) {
                const extras = estado.extraBalls || [];
                let masCercana = null;
                let mejorDist = Infinity;
                for (let i = 0; i < extras.length; i += 1) {
                    const eb = extras[i];
                    const distBorde = Math.hypot(eb.x - jugador.x, eb.y - jugador.y) - jugador.r - eb.r;
                    if (distBorde < 4 && distBorde < mejorDist) {
                        mejorDist = distBorde;
                        masCercana = eb;
                    }
                }
                if (masCercana) patearPelotaHbs(jugador, masCercana, estado, pp, false);
            }
        }

        let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
        if (dx && dy) {
            dx *= Math.SQRT1_2;
            dy *= Math.SQRT1_2;
        }
        const accel = jugador.pateando ? pp.kickingAcceleration : pp.acceleration;
        jugador.vx += dx * accel + pp.gravity[0];
        jugador.vy += dy * accel + pp.gravity[1];
    }

    function tick(estado, inputs) {
        const mapa = estado.mapa;
        const pp = mapa.playerPhysics;
        const bp = mapa.ballPhysics;

        estado.players.forEach(j => aplicarInput(j, (inputs && inputs[j.id]) || {}, estado));

        const pelotaAnterior = { x: estado.ball.x, y: estado.ball.y };

        estado.players.forEach(j => {
            j.x += j.vx;
            j.y += j.vy;
            const damp = j.pateando ? pp.kickingDamping : pp.damping;
            j.vx *= damp;
            j.vy *= damp;
            limitarEstadioHbs(j, mapa);
        });

        const ball = estado.ball;
        ball.vx += bp.gravity[0];
        ball.vy += bp.gravity[1];
        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.vx *= ball.damping;
        ball.vy *= ball.damping;
        limitarEstadioHbs(ball, mapa);

        const extras = estado.extraBalls || [];
        extras.forEach(eb => {
            eb.vx += bp.gravity[0];
            eb.vy += bp.gravity[1];
            eb.x += eb.vx;
            eb.y += eb.vy;
            eb.vx *= eb.damping;
            eb.vy *= eb.damping;
            limitarEstadioHbs(eb, mapa);
        });

        (estado.dynamicDiscs || []).forEach(d => {
            d.x += d.vx;
            d.y += d.vy;
            d.vx *= d.damping;
            d.vy *= d.damping;
        });

        const activeKOBits = estado.waitingForKickOff && !estado.golEnCurso
            ? (estado.kickoffTeam === 'blue' ? MASK.blueKO : MASK.redKO)
            : 0;

        // Colisiones entre jugadores
        for (let i = 0; i < estado.players.length; i += 1) {
            for (let j = i + 1; j < estado.players.length; j += 1) {
                chocarDiscos(estado.players[i], estado.players[j], activeKOBits);
            }
        }

        // Jugadores vs pelota
        estado.players.forEach(j => {
            const pelotaAntes = { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy };
            if (chocarDiscos(j, ball, activeKOBits)) {
                registrarToque(j, estado, { fuePatada: false, pelotaAntes });
            }
        });

        // Jugadores, pelota principal y pelotas extra de práctica
        for (let i = 0; i < extras.length; i += 1) {
            const eb = extras[i];
            estado.players.forEach(j => chocarDiscos(j, eb, activeKOBits));
            chocarDiscos(ball, eb, activeKOBits);
            for (let k = i + 1; k < extras.length; k += 1) {
                chocarDiscos(eb, extras[k], activeKOBits);
            }
        }

        // Jugadores y pelotas vs geometría del estadio
        const moviles = [...estado.players, ball, ...extras, ...(estado.dynamicDiscs || [])];
        for (let m = 0; m < moviles.length; m += 1) {
            const d = moviles[m];
            for (let i = 0; i < mapa.segments.length; i += 1) {
                chocarSegmento(d, mapa.segments[i], activeKOBits);
            }
            for (let i = 0; i < mapa.planes.length; i += 1) {
                chocarPlano(d, mapa.planes[i], activeKOBits);
            }
            for (let i = 0; i < (estado.staticDiscs || []).length; i += 1) {
                chocarDiscoFijo(d, estado.staticDiscs[i], activeKOBits);
            }
            for (let i = 0; i < (mapa.vertexes || []).length; i += 1) {
                const v = mapa.vertexes[i];
                if (v.cMask && v.cGroup && v.bCoef !== undefined) {
                    // Los vertexes tienen radio 0 en HaxBall: sólo actúan si hay contacto exacto
                }
            }
        }

        // Discos dinámicos vs pelotas y jugadores
        (estado.dynamicDiscs || []).forEach(dd => {
            chocarDiscos(dd, ball, activeKOBits);
            extras.forEach(eb => chocarDiscos(dd, eb, activeKOBits));
            estado.players.forEach(j => chocarDiscos(dd, j, activeKOBits));
        });

        // Limitar jugadores al viewport cuando no hay planes de contención
        if (!mapa.planes.length) {
            estado.players.forEach(j => {
                j.x = Math.max(j.r, Math.min(mapa.width - j.r, j.x));
                j.y = Math.max(j.r, Math.min(mapa.height - j.r, j.y));
            });
        }

        // Detectar gol en goles definidos del .hbs
        if (!estado.golEnCurso && mapa.goals && mapa.goals.length) {
            for (let i = 0; i < mapa.goals.length; i += 1) {
                const g = mapa.goals[i];
                if (segmentosCruzan(pelotaAnterior.x, pelotaAnterior.y, ball.x, ball.y, g.x0, g.y0, g.x1, g.y1)) {
                    // team en .hbs indica el equipo dueño del arco; anota el rival
                    estado.lastGoalTeam = g.team === 'red' ? 'blue' : 'red';
                    estado.goalDetected = true;
                    estado.golEnCurso = true;
                    estado.timerStarted = false;
                    if (estado.eventosTick) estado.eventosTick.push('gol');
                    break;
                }
            }
        }
    }

    function reiniciarSaque(estado) {
        const mapa = estado.mapa;
        const conteos = { red: 0, blue: 0 };
        estado.players.forEach(j => {
            const ord = conteos[j.equipo] || 0;
            conteos[j.equipo] = ord + 1;
            const pos = posicionJugadorHbs(mapa, j.equipo, ord);
            j.x = pos.x;
            j.y = pos.y;
            j.vx = 0;
            j.vy = 0;
            j.pateando = false;
            j.patadaUsada = false;
        });
        const bp = mapa.ballPhysics;
        estado.ball.x = bp.x;
        estado.ball.y = bp.y;
        estado.ball.vx = bp.vx;
        estado.ball.vy = bp.vy;

        // Reiniciar discos dinámicos a posición original
        let dynIdx = 0;
        (mapa.discs || []).forEach(d => {
            if (d.invMass > 0 && estado.dynamicDiscs[dynIdx]) {
                estado.dynamicDiscs[dynIdx].x = d.x;
                estado.dynamicDiscs[dynIdx].y = d.y;
                estado.dynamicDiscs[dynIdx].vx = d.vx || 0;
                estado.dynamicDiscs[dynIdx].vy = d.vy || 0;
                dynIdx += 1;
            }
        });

        estado.waitingForKickOff = true;
        estado.timerStarted = false;
        estado.golEnCurso = false;
        estado.goalResetPending = false;
        estado.lastTouch = null;
        estado.secondLastTouch = null;
    }

    const MS_POR_TICK = 1000 / 60;
    const MAX_TICKS = 8;

    function avanzar(estado, deltaMs, inputs = {}) {
        if (!estado || !estado.ball) return { pasos: 0, eventos: [] };
        if (estado.goalResetPending) reiniciarSaque(estado);
        const eventos = [];
        estado.eventosTick = eventos;
        estado.restoMs += Math.max(Number(deltaMs) || 0, 0);
        estado.clockMs += Math.max(Number(deltaMs) || 0, 0);
        let pasos = 0;
        while (estado.restoMs >= MS_POR_TICK - 0.001 && pasos < MAX_TICKS) {
            tick(estado, inputs);
            estado.restoMs -= MS_POR_TICK;
            pasos += 1;
        }
        if (pasos === MAX_TICKS) estado.restoMs = Math.min(estado.restoMs, MS_POR_TICK);
        estado.restoMs = Math.max(0, estado.restoMs);
        return { pasos, eventos };
    }

    function invocarPelotaPractica(estado, jugadorId) {
        if (!estado || !estado.ball) return null;
        const id = String(jugadorId);
        const jugador = estado.players.find(j => j.id === id);
        if (!jugador) return null;
        if (!Array.isArray(estado.extraBalls)) estado.extraBalls = [];

        const mapa = estado.mapa;
        const bp = mapa.ballPhysics || estado.ball;
        let eb = estado.extraBalls.find(b => b.ownerId === id);
        const creado = !eb;
        const r = eb ? eb.r : (bp.radius || estado.ball.r);

        const spd = Math.hypot(jugador.vx || 0, jugador.vy || 0);
        const dirDef = jugador.equipo === estado.ladoIzquierdo ? 1 : -1;
        const nx = spd > 0.08 ? jugador.vx / spd : dirDef;
        const ny = spd > 0.08 ? jugador.vy / spd : 0;
        const dist = jugador.r + r + 2;

        const minX = r + 2;
        const maxX = Math.max(minX, (mapa.width || 840) - r - 2);
        const minY = r + 2;
        const maxY = Math.max(minY, (mapa.height || 400) - r - 2);
        const tx = Math.max(minX, Math.min(maxX, jugador.x + nx * dist));
        const ty = Math.max(minY, Math.min(maxY, jugador.y + ny * dist));

        if (!eb) {
            eb = {
                ownerId: id,
                x: tx,
                y: ty,
                vx: 0,
                vy: 0,
                r,
                invMass: bp.invMass !== undefined ? bp.invMass : estado.ball.invMass,
                bCoef: bp.bCoef !== undefined ? bp.bCoef : estado.ball.bCoef,
                damping: bp.damping !== undefined ? bp.damping : estado.ball.damping,
                cMask: bp.cMask !== undefined ? bp.cMask : estado.ball.cMask,
                cGroup: bp.cGroup !== undefined ? bp.cGroup : estado.ball.cGroup,
                color: elegirColorPelotaPractica(estado, id)
            };
            estado.extraBalls.push(eb);
        } else {
            eb.x = tx;
            eb.y = ty;
            eb.vx = 0;
            eb.vy = 0;
        }
        return { creado, teletransportada: !creado, pelota: eb };
    }

    function quitarPelotaPractica(estado, jugadorId) {
        if (!estado || !Array.isArray(estado.extraBalls)) return;
        const id = String(jugadorId);
        estado.extraBalls = estado.extraBalls.filter(b => b.ownerId !== id);
    }

    const FisicaHbs = {
        MASK,
        ALL_MASK,
        COLORES_PELOTA_PRACTICA,
        stripJsonComments,
        parseHbsTexto,
        parseHbsColor,
        normalizarHbs,
        crearEstado,
        avanzar,
        reiniciarSaque,
        posicionJugadorHbs,
        invocarPelotaPractica,
        quitarPelotaPractica
    };

    global.FisicaHbs = FisicaHbs;
    if (typeof module !== 'undefined' && module.exports) module.exports = FisicaHbs;
})(typeof globalThis !== 'undefined' ? globalThis : this);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FisicaHbs = require('../js/local/fisica-hbs.js');
const FisicaHaxball = require('../js/local/fisica-haxball.js');

test('parseHbsTexto limpia comentarios JS y comas finales', () => {
    const raw = `{
        // Comentario de linea
        "name": "Estadio Prueba",
        /* Comentario
           multilinea */
        "width": 420,
        "height": 200,
        "vertexes": [{"x": -100, "y": -50}, {"x": 100, "y": 50},],
        "segments": [{"v0": 0, "v1": 1},],
    }`;
    const parsed = FisicaHbs.parseHbsTexto(raw);
    assert.equal(parsed.name, 'Estadio Prueba');
    assert.equal(parsed.vertexes.length, 2);
    assert.equal(parsed.segments.length, 1);
});

test('parseHbsTexto rechaza entradas vacias o invalidas', () => {
    assert.throws(() => FisicaHbs.parseHbsTexto(''), /vacío/i);
    assert.throws(() => FisicaHbs.parseHbsTexto('{mal json'), /inválido/i);
    assert.throws(() => FisicaHbs.parseHbsTexto('{"name":"Sin geometria"}'), /geometría válida/i);
});

test('parseHbsColor soporta todos los formatos de HaxBall', () => {
    assert.equal(FisicaHbs.parseHbsColor('EAFF00'), '#EAFF00');
    assert.equal(FisicaHbs.parseHbsColor('1,60,255'), 'rgb(1,60,255)');
    assert.equal(FisicaHbs.parseHbsColor([255, 128, 0]), 'rgb(255,128,0)');
    assert.equal(FisicaHbs.parseHbsColor('transparent'), null);
    assert.equal(FisicaHbs.parseHbsColor('FFFFFFFF'), null);
    assert.equal(FisicaHbs.parseHbsColor('FFFFFFFFF'), null);
});

test('el catalogo de HaxMaps contiene 30 mapas unicos y simula 120 ticks sin NaN', () => {
    const ruta = path.join(__dirname, '..', 'maps', 'haxmaps-catalog.json');
    const catalog = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    assert.equal(catalog.length, 30);

    const ids = new Set(catalog.map(m => m.id));
    assert.equal(ids.size, 30);

    for (const item of catalog) {
        const mapa = FisicaHbs.normalizarHbs(item.hbs, {
            id: item.id,
            name: item.name,
            category: item.category,
            haxmapsId: item.haxmapsId
        });
        assert.equal(mapa.hbs, true);
        assert.ok(mapa.width > 0 && mapa.height > 0, `${item.name} dimensiones validas`);

        const estado = FisicaHaxball.crearEstado({
            mapa,
            ladoIzquierdo: 'red',
            kickoffTeam: 'red',
            jugadores: [
                { id: 'r1', equipo: 'red' },
                { id: 'r2', equipo: 'red' },
                { id: 'b1', equipo: 'blue' },
                { id: 'b2', equipo: 'blue' }
            ],
            powerUps: false
        });

        assert.equal(estado.motor, 'hbs');
        const inputs = {
            r1: { right: true, kick: true },
            r2: { up: true, right: true },
            b1: { left: true },
            b2: { down: true, left: true }
        };

        for (let t = 0; t < 120; t += 1) {
            FisicaHaxball.avanzar(estado, 1000 / 60, inputs);
        }

        assert.ok(Number.isFinite(estado.ball.x) && Number.isFinite(estado.ball.y), `${item.name} pelota finita`);
        for (const p of estado.players) {
            assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${item.name} jugador finito`);
        }

        FisicaHaxball.reiniciarSaque(estado);
        assert.equal(estado.waitingForKickOff, true);
    }
});

test('deteccion de gol y arcos curvos en mapa HBS', () => {
    const mapa = FisicaHbs.normalizarHbs({
        name: 'Mini Gol',
        width: 300,
        height: 150,
        vertexes: [
            { x: -200, y: -60 },
            { x: -200, y: 60 },
            { x: 200, y: -60 },
            { x: 200, y: 60 }
        ],
        segments: [
            { v0: 0, v1: 1, curve: 90, color: 'FFFFFF' }
        ],
        goals: [
            { p0: [120, -60], p1: [120, 60], team: 'blue' }
        ],
        ballPhysics: { pos: [115, 0], speed: [12, 0], radius: 10 }
    });

    assert.ok(mapa.segments[0].arc !== null);
    const estado = FisicaHaxball.crearEstado({
        mapa,
        jugadores: [{ id: 'r1', equipo: 'red' }]
    });

    const { eventos } = FisicaHaxball.avanzar(estado, 1000 / 60, {});
    assert.ok(eventos.includes('gol'));
    assert.equal(estado.lastGoalTeam, 'red');
});

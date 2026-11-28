const test = require('node:test');
const assert = require('node:assert/strict');

const FisicaHaxball = require('../js/local/fisica-haxball.js');
const FisicaHbs = require('../js/local/fisica-hbs.js');

const MAPA_STANDARD = {
    id: 'classic',
    name: 'Classic',
    width: 840,
    height: 400,
    goalHeight: 120
};

test('sinSaques arranca sin barreras ni estado de saque en HaxBall y HBS', () => {
    const estadoStd = FisicaHaxball.crearEstado({
        mapa: MAPA_STANDARD,
        jugadores: [
            { id: 'r1', equipo: 'red' },
            { id: 'b1', equipo: 'blue' }
        ],
        sinSaques: true
    });
    assert.equal(estadoStd.waitingForKickOff, false);
    assert.equal(estadoStd.timerStarted, true);

    // El jugador azul puede cruzar la mitad de cancha libremente sin barreras de saque
    const azul = estadoStd.players.find(p => p.id === 'b1');
    azul.x = 300;
    FisicaHaxball.avanzar(estadoStd, 1000 / 60, { b1: { left: true } });
    assert.ok(azul.x < 400);

    const mapaHbs = FisicaHbs.normalizarHbs({
        name: 'HBS Practica',
        width: 420,
        height: 200,
        vertexes: [{ x: -300, y: -150 }, { x: 300, y: 150 }],
        segments: [{ v0: 0, v1: 1, cMask: ['none'] }]
    });
    const estadoHbs = FisicaHaxball.crearEstado({
        mapa: mapaHbs,
        jugadores: [{ id: 'r1', equipo: 'red' }],
        sinSaques: true
    });
    assert.equal(estadoHbs.waitingForKickOff, false);
    assert.equal(estadoHbs.timerStarted, true);
});

test('cada jugador invoca como maximo 1 pelota y el mismo llamado la teletransporta a sus pies', () => {
    const estado = FisicaHaxball.crearEstado({
        mapa: MAPA_STANDARD,
        jugadores: [
            { id: 'p1', equipo: 'red' },
            { id: 'p2', equipo: 'blue' }
        ],
        sinSaques: true
    });

    const j1 = estado.players.find(p => p.id === 'p1');
    const j2 = estado.players.find(p => p.id === 'p2');

    // Primera invocación de p1
    const res1 = FisicaHaxball.invocarPelotaPractica(estado, 'p1');
    assert.equal(res1.creado, true);
    assert.equal(res1.teletransportada, false);
    assert.equal(estado.extraBalls.length, 1);

    const b1 = res1.pelota;
    const distPies1 = Math.hypot(b1.x - j1.x, b1.y - j1.y);
    assert.ok(distPies1 <= j1.r + b1.r + 4, 'la pelota debe aparecer en los pies del jugador');

    // Patear la pelota personal de p1 lejos
    for (let t = 0; t < 15; t += 1) {
        FisicaHaxball.avanzar(estado, 1000 / 60, { p1: { kick: true } });
    }
    assert.ok(Math.hypot(b1.x - j1.x, b1.y - j1.y) > j1.r + b1.r + 20, 'la pelota personal debe poder patearse lejos');

    // Mover a p1 y volver a invocar -> NO crea una 2da pelota, teletransporta la misma
    j1.x = 220;
    j1.y = 140;
    const res2 = FisicaHaxball.invocarPelotaPractica(estado, 'p1');
    assert.equal(res2.creado, false);
    assert.equal(res2.teletransportada, true);
    assert.equal(estado.extraBalls.length, 1);
    assert.equal(res2.pelota, b1);
    assert.equal(b1.vx, 0);
    assert.equal(b1.vy, 0);
    assert.ok(Math.hypot(b1.x - j1.x, b1.y - j1.y) <= j1.r + b1.r + 4);

    // Invocación de p2: crea pelota propia (2 total) con color distinto a original y a p1
    const resP2 = FisicaHaxball.invocarPelotaPractica(estado, 'p2');
    assert.equal(resP2.creado, true);
    assert.equal(estado.extraBalls.length, 2);
    assert.notEqual(resP2.pelota.color.toLowerCase(), '#ffffff');
    assert.notEqual(resP2.pelota.color.toLowerCase(), b1.color.toLowerCase());
    assert.ok(Math.hypot(resP2.pelota.x - j2.x, resP2.pelota.y - j2.y) <= j2.r + resP2.pelota.r + 4);

    // Quitar pelota de p1 no afecta la de p2
    FisicaHaxball.quitarPelotaPractica(estado, 'p1');
    assert.equal(estado.extraBalls.length, 1);
    assert.equal(estado.extraBalls[0].ownerId, 'p2');
});

test('el color de pelota de practica evita el color de la pelota original incluso en HBS personalizado', () => {
    const mapaHbsColor = FisicaHbs.normalizarHbs({
        name: 'Custom Ball Color',
        width: 420,
        height: 200,
        vertexes: [{ x: -300, y: -150 }, { x: 300, y: 150 }],
        segments: [{ v0: 0, v1: 1, cMask: ['none'] }],
        ballPhysics: { color: '38BDF8', radius: 10 }
    });
    const estado = FisicaHaxball.crearEstado({
        mapa: mapaHbsColor,
        jugadores: [
            { id: 'p1', equipo: 'red' },
            { id: 'p2', equipo: 'blue' }
        ],
        sinSaques: true
    });

    const r1 = FisicaHaxball.invocarPelotaPractica(estado, 'p1');
    assert.ok(r1 && r1.pelota);
    assert.notEqual(r1.pelota.color.toLowerCase(), '#38bdf8');
    assert.notEqual(r1.pelota.color.toLowerCase(), '#ffffff');

    const j1 = estado.players.find(p => p.id === 'p1');
    // Simular varios ticks con patada sobre pelota HBS extra sin NaN
    for (let t = 0; t < 10; t += 1) {
        FisicaHaxball.avanzar(estado, 1000 / 60, { p1: { kick: true, right: true } });
    }
    assert.ok(Number.isFinite(r1.pelota.x) && Number.isFinite(r1.pelota.y));
    assert.ok(Number.isFinite(j1.x) && Number.isFinite(j1.y));
});

const test = require('node:test');
const assert = require('node:assert/strict');

const Camara = require('../js/online/camara.js');
const Clubes = require('../js/online/clubes.js');
const FisicaHaxball = require('../js/local/fisica-haxball.js');

function mapaClubEscalado(base, tamanoId) {
    const tam = Clubes.obtenerTamanoJugadores(tamanoId);
    const factor = tam.factor;
    const baseEscala = Math.min(1.65, Math.max(1, Math.sqrt((base.width * base.height) / (840 * 400))));
    const escala = Number((baseEscala * Math.min(1.32, Math.max(0.92, 0.86 + factor * 0.14))).toFixed(3));
    return FisicaHaxball.normalizarMapa({
        ...base,
        width: Math.round(base.width * factor),
        height: Math.round(base.height * factor),
        goalHeight: Math.round(base.goalHeight * factor),
        escala
    });
}

test('tamanos de cancha escalan significativamente de 1v1 a 11v11 y mantienen camiseta practica default', () => {
    const factors = Clubes.TAMANOS_JUGADORES.map(t => t.factor);
    for (let i = 1; i < factors.length; i += 1) {
        assert.ok(factors[i] > factors[i - 1], `Factor ${i} debe ser mayor al anterior`);
    }
    assert.ok(factors[0] <= 0.75);
    assert.ok(factors[factors.length - 1] >= 2.8);

    assert.ok(Clubes.CAMISETA_PRACTICA);
    assert.equal(Clubes.CAMISETA_PRACTICA.id, 'practica');
    assert.equal(Clubes.CAMISETA_PRACTICA.primario, '#ffffff');
    assert.notEqual(Clubes.CAMISETA_PRACTICA.primario, Clubes.obtenerClub('boca').primario);
});

test('camara muestra cancha entera en 1v1..3v3 y hace zoom + minimapa en 5v5..11v11', () => {
    const bombonera = Clubes.ESTADIOS_CLUBES.find(e => e.id === 'estadio_bombonera');

    const m1 = mapaClubEscalado(bombonera, '1v1');
    const m3 = mapaClubEscalado(bombonera, '3v3');
    const m5 = mapaClubEscalado(bombonera, '5v5');
    const m11 = mapaClubEscalado(bombonera, '11v11');

    assert.ok(m11.width >= m3.width * 2.8, '11v11 debe aumentar mucho respecto a 3v3');

    const z1 = Camara.zoomDe(m1, 0);
    const z3 = Camara.zoomDe(m3, 0);
    const z5 = Camara.zoomDe(m5, 0);
    const z11 = Camara.zoomDe(m11, 0);

    assert.equal(z1, 1);
    assert.equal(z3, 1);
    assert.ok(z5 > 1.25, `5v5 debe activar zoom (${z5})`);
    assert.ok(z11 > 1.8, `11v11 debe activar zoom fuerte (${z11})`);

    const cam3 = Camara.actualizarCamara(null, m3, { x: 100, y: 100 }, 0, 16);
    assert.equal(Camara.debeMostrarMinimapa(cam3), false);

    const cam11 = Camara.actualizarCamara(null, m11, { x: 20, y: 20 }, 0, 16);
    assert.equal(Camara.debeMostrarMinimapa(cam11), true);

    const rect = Camara.viewportMinimapa(m11, cam11);
    assert.ok(rect);
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.w < m11.width && rect.h < m11.height);
    assert.ok(rect.x + rect.w <= m11.width + 0.01);
    assert.ok(rect.y + rect.h <= m11.height + 0.01);
});

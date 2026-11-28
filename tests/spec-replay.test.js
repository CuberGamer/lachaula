const test = require('node:test');
const assert = require('node:assert/strict');
const Repeticion = require('../js/online/repeticion.js');

test('filtrarGolesConReplay conserva el indice original y filtra goles sin clip', () => {
    const goles = [
        { equipo: 'red', autor: 'Facu', minuto: 1, tieneReplay: true },
        { equipo: 'blue', autor: 'Leo', minuto: 2, tieneReplay: false },
        { equipo: 'blue', autor: 'Mati', minuto: 4, extra: true, enContra: true, golazo: false, tieneReplay: true }
    ];

    const filtrados = Repeticion.filtrarGolesConReplay(goles);
    assert.equal(filtrados.length, 2);
    assert.equal(filtrados[0].indiceOriginal, 0);
    assert.equal(filtrados[0].numeroGol, 1);
    assert.equal(filtrados[0].autor, 'Facu');
    assert.equal(filtrados[1].indiceOriginal, 2);
    assert.equal(filtrados[1].numeroGol, 2);
    assert.equal(filtrados[1].enContra, true);
    assert.equal(filtrados[1].extra, true);
});

test('formatearEtiquetaGol muestra numero de gol, autor, minuto, en contra y golazo', () => {
    const et1 = Repeticion.formatearEtiquetaGol({
        equipo: 'red',
        autor: 'Facu',
        minuto: 3,
        extra: false,
        enContra: false,
        golazo: true
    }, 0, 3);
    assert.equal(et1.titulo, 'Gol 1/3');
    assert.equal(et1.detalle, 'Gol de Facu ★');
    assert.equal(et1.minuto, "3'");

    const et2 = Repeticion.formatearEtiquetaGol({
        equipo: 'blue',
        autor: 'Nico',
        minuto: 5,
        extra: true,
        enContra: true,
        golazo: false
    }, 2, 3);
    assert.equal(et2.titulo, 'Gol 3/3');
    assert.equal(et2.detalle, 'Gol de Nico (En contra)');
    assert.equal(et2.minuto, "5'+");

    const et3 = Repeticion.formatearEtiquetaGol({
        equipo: 'blue',
        autor: null,
        minuto: 2
    }, 0, 1);
    assert.equal(et3.titulo, 'Gol 1/1');
    assert.equal(et3.detalle, 'Gol Equipo Azul');
});

test('navegarIndiceGol avanza entre goles respetando limites', () => {
    assert.deepEqual(Repeticion.navegarIndiceGol(0, -1, 3), {
        indice: 0,
        puedeAnterior: false,
        puedeSiguiente: true
    });
    assert.deepEqual(Repeticion.navegarIndiceGol(0, 1, 3), {
        indice: 1,
        puedeAnterior: true,
        puedeSiguiente: true
    });
    assert.deepEqual(Repeticion.navegarIndiceGol(1, 1, 3), {
        indice: 2,
        puedeAnterior: true,
        puedeSiguiente: false
    });
    assert.deepEqual(Repeticion.navegarIndiceGol(0, 1, 1), {
        indice: 0,
        puedeAnterior: false,
        puedeSiguiente: false
    });
});

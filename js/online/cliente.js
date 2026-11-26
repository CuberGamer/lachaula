/**
 * cliente.js (online)
 *
 * Toda la experiencia online en una sola página (como HaxBall), así la
 * conexión con el servidor no se corta al pasar de la lista de salas al
 * partido:
 *   1. Lista de salas: elegir nombre, crear sala o entrar a una.
 *   2. Sala: panel con Rojo / Espectadores / Azul. El admin arrastra (o usa
 *      las flechas) para elegir de qué lado juega cada uno, cambia la cancha
 *      y las reglas, y arranca el partido.
 *   3. Partido: el navegador manda las teclas y dibuja lo que manda el
 *      servidor, interpolando entre fotos para que se vea fluido.
 */
(function () {
    // Primero WebSocket (lo más rápido). Si un proxy en el medio no lo deja pasar
    // (pasa entrando por chaula.et20.edu.ar), tryAllTransports pasa a polling
    // en vez de reintentar WebSocket para siempre sin conectar nunca.
    const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
    const $ = id => document.getElementById(id);

    const CLAVE_NOMBRE = 'lachaula_nombre';
    const CLAVE_AVATAR = 'lachaula_avatar';
    const CLAVE_ZOOM = 'lachaula_zoom';
    const CLAVE_EXTRAPOLACION = 'lachaula_extrapolacion';
    const MS_TICK = 1000 / 60;

    /*
     * Zoom como en HaxBall (teclas 0 a 7). Cada nivel dice cuánto se ve a lo
     * ancho (en px de la cancha de referencia, se multiplica por la escala del
     * mapa): 1 = la cancha entera; del 2 al 7 cada vez más cerca, con la cámara
     * siguiendo a tu jugador. 0 = automático: las canchas normales se ven
     * enteras y las muy grandes siguen a tu jugador para que no se vea todo chiquito.
     */
    const ANCHO_VISIBLE_ZOOM = { 0: 1100, 1: Infinity, 2: 1400, 3: 1200, 4: 1000, 5: 840, 6: 700, 7: 560 };
    const NOMBRE_ZOOM = {
        0: 'Automático', 1: 'Cancha entera', 2: 'Zoom 2', 3: 'Zoom 3',
        4: 'Zoom 4', 5: 'Zoom 5', 6: 'Zoom 6', 7: 'Zoom 7 (máximo)'
    };
    // Extrapolación como en HaxBall: de 0 a 200 ms.
    const MAX_EXTRAPOLACION = 200;

    function leerNumeroGuardado(clave, porDefecto, minimo, maximo) {
        const valor = Number(localStorage.getItem(clave));
        if (localStorage.getItem(clave) === null || !Number.isFinite(valor)) return porDefecto;
        return Math.min(maximo, Math.max(minimo, Math.round(valor)));
    }
    const BITS_TECLA = {
        ArrowUp: 1, KeyW: 1,
        ArrowDown: 2, KeyS: 2,
        ArrowLeft: 4, KeyA: 4,
        ArrowRight: 8, KeyD: 8,
        Space: 16, KeyX: 16
    };
    const NOMBRE_EQUIPO = { red: 'Rojo', blue: 'Azul' };

    const estado = {
        salaId: null,
        tuId: null,
        token: null,
        sala: null,
        teclas: new Set(),
        bits: 0,
        panelVisible: true,
        cartelTimeout: null,
        mapasBase: [],
        mapasHbs: [],
        mapasCustom: [],
        mapas: [],
        categoriaFiltro: 'Todos',
        busquedaMapa: '',
        archivoHbsNombre: '',
        ultimoDibujo: null,
        ultimoPreviewClave: '',
        ultimoCanchaIdleClave: '',
        zoomNivel: 0,
        extrapolacion: 0,
        camara: null,
        avisoAjuste: null
    };
    estado.zoomNivel = leerNumeroGuardado(CLAVE_ZOOM, 0, 0, 7);
    estado.extrapolacion = leerNumeroGuardado(CLAVE_EXTRAPOLACION, 0, 0, MAX_EXTRAPOLACION);

    // Fotos del servidor ordenadas por tick y predicción de tu jugador (ver red.js).
    const linea = RedOnline.crearLinea();
    const prediccion = RedOnline.crearPrediccion(FisicaHaxball);

    const canvas = $('cancha');
    const dibujante = DibujoOnline.crearDibujante(canvas);
    const preview = $('previewMapa');
    const dibujantePreview = DibujoOnline.crearDibujante(preview);

    /* ========================= */
    /* UTILIDADES                */
    /* ========================= */

    function mostrarAviso(elemento, texto, duracionMs = 4000) {
        elemento.textContent = texto || '';
        clearTimeout(elemento._timeout);
        if (texto && duracionMs) elemento._timeout = setTimeout(() => { elemento.textContent = ''; }, duracionMs);
    }

    function avisoActual(texto) {
        mostrarAviso(estado.salaId ? $('avisoSala') : $('avisoSalas'), texto);
    }

    function pedir(evento, datos = {}) {
        return new Promise(resolve => socket.emit(evento, datos, respuesta => resolve(respuesta || {})));
    }

    async function accion(evento, datos) {
        const respuesta = await pedir(evento, datos);
        if (respuesta.error) avisoActual(respuesta.error);
        return respuesta;
    }

    /* ========================= */
    /* AVATAR (como en HaxBall)  */
    /* ========================= */

    // Hasta 2 caracteres; un emoji compuesto cuenta como uno. El servidor vuelve a validar.
    function recortarAvatar(valor) {
        const texto = String(valor || '').replace(/\s/g, '');
        const partes = window.Intl && Intl.Segmenter
            ? Array.from(new Intl.Segmenter('es', { granularity: 'grapheme' }).segment(texto), parte => parte.segment)
            : Array.from(texto);
        return partes.slice(0, 2).join('');
    }

    function avatarGuardado() {
        return recortarAvatar(localStorage.getItem(CLAVE_AVATAR) || '');
    }

    function guardarAvatar(valor) {
        const avatar = recortarAvatar(valor);
        localStorage.setItem(CLAVE_AVATAR, avatar);
        $('avatarJugador').value = avatar;
        $('avatarSala').value = avatar;
        return avatar;
    }

    async function cambiarAvatar(valor) {
        const avatar = guardarAvatar(valor);
        if (!estado.salaId) return;
        const respuesta = await accion('sala:avatar', { avatar });
        if (respuesta && respuesta.ok) {
            mostrarAviso($('avisoSala'), avatar ? `Tu avatar ahora es "${avatar}".` : 'Sacaste tu avatar: se ve tu número.', 2500);
        }
    }

    function nombreGuardado() {
        return (localStorage.getItem(CLAVE_NOMBRE) || '').trim();
    }

    function leerNombre() {
        const nombre = $('nombreJugador').value.trim();
        if (!nombre) {
            mostrarAviso($('avisoSalas'), 'Primero escribí tu nombre de jugador.');
            $('nombreJugador').focus();
            return null;
        }
        localStorage.setItem(CLAVE_NOMBRE, nombre);
        return nombre;
    }

    function claveToken(salaId) {
        return `lachaula_token_${salaId}`;
    }

    function formatearTiempo(ms) {
        const total = Math.max(0, Math.ceil(ms / 1000));
        return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    }

    function crearElemento(tag, clase, texto) {
        const elemento = document.createElement(tag);
        if (clase) elemento.className = clase;
        if (texto !== undefined) elemento.textContent = texto;
        return elemento;
    }

    function soyAdmin() {
        const yo = estado.sala && estado.sala.jugadores.find(jugador => jugador.id === estado.tuId);
        return !!(yo && yo.admin);
    }

    /* ========================= */
    /* CONEXIÓN                  */
    /* ========================= */

    function actualizarConexion(texto, clase) {
        const etiqueta = $('estadoConexion');
        etiqueta.textContent = texto;
        etiqueta.className = `online-conexion ${clase || ''}`;
    }

    socket.on('connect', async () => {
        actualizarConexion('● Conectado', 'online-conexion--ok');
        if (estado.salaId && estado.token) {
            // Se cortó y volvió: recupera su lugar en la sala.
            const respuesta = await pedir('sala:unirse', { salaId: estado.salaId, token: estado.token });
            if (respuesta.ok) entrarASala(respuesta);
            else volverALista(respuesta.error || 'Se perdió la conexión con la sala.');
            return;
        }
        pedirSalas();
        intentarEntrarPorLink();
    });

    socket.on('disconnect', () => actualizarConexion('● Sin conexión, reintentando…', 'online-conexion--mal'));

    setInterval(() => {
        if (!socket.connected) return;
        const inicio = performance.now();
        socket.emit('ping', {}, () => {
            actualizarConexion(`● ${Math.round(performance.now() - inicio)} ms`, 'online-conexion--ok');
        });
    }, 2000);

    /* ========================= */
    /* LISTA DE SALAS            */
    /* ========================= */

    async function pedirSalas() {
        const respuesta = await pedir('salas:pedir');
        if (respuesta.salas) dibujarSalas(respuesta.salas);
    }

    function dibujarSalas(salas) {
        const cuerpo = $('listaSalas');
        cuerpo.textContent = '';
        if (!salas.length) {
            const fila = crearElemento('tr');
            const celda = crearElemento('td', 'online-vacio', 'No hay salas abiertas. ¡Creá una!');
            celda.colSpan = 5;
            fila.appendChild(celda);
            cuerpo.appendChild(fila);
            return;
        }
        salas.forEach(sala => {
            const fila = crearElemento('tr', 'online-fila-sala');
            fila.append(
                crearElemento('td', '', `${sala.conClave ? '🔒 ' : ''}${sala.nombre}`),
                crearElemento('td', '', sala.sinLimite ? `${sala.jugadores}/∞` : `${sala.jugadores}/${sala.maxJugadores}`),
                crearElemento('td', '', sala.mapa),
                crearElemento('td', sala.enJuego ? 'online-estado--juego' : '', sala.enJuego ? 'Jugando' : 'Esperando')
            );
            const celdaBoton = crearElemento('td');
            const boton = crearElemento('button', 'ssf-button online-mini', 'Entrar');
            boton.type = 'button';
            boton.disabled = sala.jugadores >= sala.maxJugadores;
            boton.addEventListener('click', () => unirse(sala.id, sala.conClave));
            celdaBoton.appendChild(boton);
            fila.appendChild(celdaBoton);
            cuerpo.appendChild(fila);
        });
    }

    socket.on('salas:lista', dibujarSalas);

    function pedirClave() {
        const dialogo = $('dialogoClave');
        $('claveIngreso').value = '';
        dialogo.returnValue = '';
        dialogo.showModal();
        $('claveIngreso').focus();
        return new Promise(resolve => {
            dialogo.addEventListener('close', () => resolve(dialogo.returnValue === 'entrar' ? $('claveIngreso').value : null), { once: true });
        });
    }

    async function unirse(salaId, conClave = false) {
        const nombreJugador = leerNombre();
        if (!nombreJugador) return;
        let clave = '';
        if (conClave) {
            clave = await pedirClave();
            if (clave === null) return;
        }
        const token = sessionStorage.getItem(claveToken(salaId)) || undefined;
        let respuesta = await pedir('sala:unirse', { salaId, nombreJugador, clave, token, avatar: avatarGuardado() });
        if (respuesta.pideClave && !conClave) {
            clave = await pedirClave();
            if (clave === null) return;
            respuesta = await pedir('sala:unirse', { salaId, nombreJugador, clave, avatar: avatarGuardado() });
        }
        if (respuesta.error) {
            mostrarAviso($('avisoSalas'), respuesta.error);
            return;
        }
        entrarASala(respuesta);
    }

    async function intentarEntrarPorLink() {
        const salaId = new URLSearchParams(window.location.search).get('sala');
        if (!salaId || estado.salaId) return;
        const token = sessionStorage.getItem(claveToken(salaId.toUpperCase()));
        if (token) {
            const respuesta = await pedir('sala:unirse', { salaId, token });
            if (respuesta.ok) {
                entrarASala(respuesta);
                return;
            }
        }
        if (!nombreGuardado()) {
            mostrarAviso($('avisoSalas'), `Te invitaron a la sala ${salaId}: escribí tu nombre y tocá "Entrar".`, 0);
            $('codigoSala').value = salaId;
            $('nombreJugador').focus();
            return;
        }
        unirse(salaId);
    }

    $('formCrear').addEventListener('submit', async evento => {
        evento.preventDefault();
        const nombreJugador = leerNombre();
        if (!nombreJugador) return;
        const respuesta = await accion('sala:crear', {
            nombreJugador,
            avatar: avatarGuardado(),
            nombre: $('nombreSala').value,
            clave: $('claveSala').value,
            maxJugadores: Number($('maxJugadores').value)
        });
        if (respuesta.ok) entrarASala(respuesta);
    });

    $('formCodigo').addEventListener('submit', evento => {
        evento.preventDefault();
        const codigo = $('codigoSala').value.trim();
        if (codigo) unirse(codigo.toUpperCase());
    });

    $('actualizarSalas').addEventListener('click', pedirSalas);
    $('volverMenu').addEventListener('click', () => { window.location.href = 'menu.html'; });

    /* ========================= */
    /* ENTRAR / SALIR DE LA SALA */
    /* ========================= */

    function entrarASala(respuesta) {
        estado.salaId = respuesta.salaId;
        estado.tuId = respuesta.tuId;
        estado.token = respuesta.token;
        $('avatarSala').value = avatarGuardado();
        reiniciarRed();
        if (respuesta.mapas) estado.mapasBase = respuesta.mapas;
        if (Array.isArray(respuesta.mapasCustom)) estado.mapasCustom = respuesta.mapasCustom;
        reconstruirMapas();
        sessionStorage.setItem(claveToken(respuesta.salaId), respuesta.token);
        history.replaceState(null, '', `?sala=${respuesta.salaId}`);
        $('vistaSalas').hidden = true;
        $('vistaSala').hidden = false;
        document.body.classList.add('online--en-sala');
        if (!respuesta.reconectado) $('chatMensajes').textContent = '';
        actualizarSala(respuesta.sala);
        mostrarPanel(!respuesta.sala.partido);
    }

    function volverALista(motivo) {
        if (estado.salaId) sessionStorage.removeItem(claveToken(estado.salaId));
        estado.salaId = null;
        estado.tuId = null;
        estado.token = null;
        estado.sala = null;
        reiniciarRed();
        soltarTeclas();
        history.replaceState(null, '', window.location.pathname);
        $('vistaSala').hidden = true;
        $('vistaSalas').hidden = false;
        document.body.classList.remove('online--en-sala');
        if (motivo) mostrarAviso($('avisoSalas'), motivo, 6000);
        pedirSalas();
    }

    $('salirSala').addEventListener('click', async () => {
        await pedir('sala:salir');
        volverALista();
    });

    window.addEventListener('pagehide', () => {
        if (estado.salaId) socket.emit('sala:salir', {});
    });

    socket.on('sala:expulsado', ({ motivo }) => volverALista(motivo || 'Saliste de la sala.'));

    $('copiarLink').addEventListener('click', async () => {
        const link = `${window.location.origin}${window.location.pathname}?sala=${estado.salaId}`;
        try {
            await navigator.clipboard.writeText(link);
            mostrarAviso($('avisoSala'), '¡Link copiado! Pasáselo a tus amigos.');
        } catch (error) {
            mostrarAviso($('avisoSala'), `Link de la sala: ${link}`, 10000);
        }
    });

    /* ========================= */
    /* PANEL DE LA SALA          */
    /* ========================= */

    socket.on('sala:estado', sala => {
        if (sala.id === estado.salaId) actualizarSala(sala);
    });

    socket.on('sala:mapasCustom', mapas => {
        estado.mapasCustom = Array.isArray(mapas) ? mapas : [];
        reconstruirMapas();
        if (estado.sala) dibujarControlesAdmin(estado.sala);
    });

    function actualizarSala(sala) {
        const mapaAnterior = estado.sala && estado.sala.mapa.id;
        estado.sala = sala;
        if (mapaAnterior !== sala.mapa.id || canvas.width !== sala.mapa.width) {
            ajustarCanvas(sala.mapa);
            dibujante.reiniciarEfectos();
        }
        $('tituloSala').textContent = sala.nombre;
        $('codigoActual').textContent = sala.id;
        $('candado').hidden = !sala.conClave;
        dibujarEquipos(sala);
        dibujarControlesAdmin(sala);
        dibujarUltimoResultado(sala);
        if (!sala.partido) reiniciarRed();
    }

    function ajustarCanvas(mapa) {
        canvas.width = mapa.width;
        canvas.height = mapa.height;
        canvas.style.aspectRatio = `${mapa.width} / ${mapa.height}`;
    }

    function moverJugador(jugadorId, equipo) {
        accion('sala:mover', { jugadorId, equipo: equipo || null });
    }

    function dibujarEquipos(sala) {
        const admin = soyAdmin();
        const yo = sala.jugadores.find(jugador => jugador.id === estado.tuId);
        const columnas = ['red', '', 'blue'];
        document.querySelectorAll('.online-equipo').forEach(seccion => {
            const equipo = seccion.dataset.equipo;
            const indice = columnas.indexOf(equipo);
            const lista = seccion.querySelector('[data-lista]');
            const miembros = sala.jugadores.filter(jugador => (jugador.equipo || '') === equipo);
            lista.textContent = '';
            seccion.querySelector('[data-cuenta]').textContent = equipo && sala.maxPorEquipo ? `${miembros.length}/${sala.maxPorEquipo}` : String(miembros.length);

            miembros.forEach((jugador, posicion) => {
                const item = crearElemento('li', 'online-jugador');
                if (jugador.id === estado.tuId) item.classList.add('online-jugador--vos');
                if (jugador.desconectado) item.classList.add('online-jugador--desconectado');
                item.dataset.id = jugador.id;
                item.draggable = admin;
                const nombre = crearElemento('span', 'online-jugador__nombre');
                nombre.textContent = `${equipo ? `${posicion + 1}. ` : ''}${jugador.nombre}${jugador.id === estado.tuId ? ' (vos)' : ''}`;
                item.appendChild(nombre);
                if (jugador.admin) item.appendChild(crearElemento('span', 'online-jugador__admin', '★'));
                if (jugador.escribiendo) item.appendChild(crearElemento('span', 'online-jugador__escribiendo', '💬'));
                if (jugador.desconectado) item.appendChild(crearElemento('span', 'online-jugador__estado', 'reconectando…'));

                if (admin) {
                    const acciones = crearElemento('span', 'online-jugador__acciones');
                    if (indice > 0) acciones.appendChild(botonMini('◀', `Mover a ${columnas[indice - 1] ? NOMBRE_EQUIPO[columnas[indice - 1]] : 'Espectadores'}`, () => moverJugador(jugador.id, columnas[indice - 1])));
                    if (indice < 2) acciones.appendChild(botonMini('▶', `Mover a ${columnas[indice + 1] ? NOMBRE_EQUIPO[columnas[indice + 1]] : 'Espectadores'}`, () => moverJugador(jugador.id, columnas[indice + 1])));
                    if (jugador.id !== estado.tuId) {
                        acciones.appendChild(botonMini('★', jugador.admin ? 'Sacar admin' : 'Dar admin', () => accion('sala:admin', { jugadorId: jugador.id })));
                        acciones.appendChild(botonMini('✕', 'Echar de la sala', () => {
                            if (window.confirm(`¿Echar a ${jugador.nombre} de la sala?`)) accion('sala:echar', { jugadorId: jugador.id });
                        }));
                    }
                    item.appendChild(acciones);
                }
                lista.appendChild(item);
            });

            const puedeUnirse = yo && (yo.equipo || '') !== equipo && (admin || !sala.config.equiposBloqueados);
            seccion.querySelector('[data-unirme]').hidden = !puedeUnirse;
        });
    }

    function botonMini(texto, titulo, alClick) {
        const boton = crearElemento('button', 'online-mini', texto);
        boton.type = 'button';
        boton.title = titulo;
        boton.setAttribute('aria-label', titulo);
        boton.addEventListener('click', alClick);
        return boton;
    }

    // Arrastrar y soltar jugadores entre columnas (solo el admin).
    document.querySelectorAll('.online-equipo').forEach(seccion => {
        seccion.addEventListener('dragover', evento => {
            if (!soyAdmin()) return;
            evento.preventDefault();
            seccion.classList.add('online-equipo--destino');
        });
        seccion.addEventListener('dragleave', () => seccion.classList.remove('online-equipo--destino'));
        seccion.addEventListener('drop', evento => {
            evento.preventDefault();
            seccion.classList.remove('online-equipo--destino');
            const jugadorId = evento.dataTransfer.getData('text/plain');
            if (jugadorId) moverJugador(jugadorId, seccion.dataset.equipo);
        });
        seccion.querySelector('[data-unirme]').addEventListener('click', () => moverJugador(estado.tuId, seccion.dataset.equipo));
    });

    document.addEventListener('dragstart', evento => {
        const item = evento.target.closest && evento.target.closest('.online-jugador');
        if (item) evento.dataTransfer.setData('text/plain', item.dataset.id);
    });

    function llenarSelect(select, opciones) {
        if (select.options.length === opciones.length) return;
        select.textContent = '';
        opciones.forEach(([valor, texto]) => {
            const opcion = crearElemento('option', '', texto);
            opcion.value = String(valor);
            select.appendChild(opcion);
        });
    }

    function dibujarControlesAdmin(sala) {
        const admin = soyAdmin();
        const enPartido = !!sala.partido;
        const esHbs = !!(sala.mapa && sala.mapa.hbs);
        $('infoNoAdmin').hidden = admin;
        llenarSelect($('cfgTiempo'), sala.tiempos.map(minutos => [minutos, `${minutos} min`]));
        llenarSelect($('cfgGoles'), sala.golesValidos.map(goles => [goles, goles ? `${goles}` : 'Sin límite']));
        llenarSelect($('cfgModo'), (sala.modos || []).map(modo => [modo.id, modo.nombre]));
        $('cfgModo').value = String(sala.config.modo || 'normal');
        llenarSelect($('cfgTamano'), (sala.tamanos || []).map(tamano => [tamano.id, tamano.nombre]));
        $('cfgTamano').value = String(sala.config.tamano || 'normal');
        $('cfgTiempo').value = String(sala.config.tiempoMin);
        $('cfgGoles').value = String(sala.config.goles);
        $('cfgPowerUps').checked = esHbs ? false : sala.config.powerUps;
        $('cfgCombinar').checked = esHbs ? false : !!sala.config.combinarPoderes;
        $('cfgBloqueo').checked = sala.config.equiposBloqueados;
        // Los que no son admin ven la configuración pero no la pueden tocar.
        ['cfgModo', 'cfgTamano', 'cfgPowerUps'].forEach(id => { $(id).disabled = !admin || enPartido || esHbs; });
        ['cfgTiempo', 'cfgGoles'].forEach(id => { $(id).disabled = !admin || enPartido; });
        $('cfgCombinar').disabled = !admin || enPartido || esHbs || !sala.config.powerUps;
        $('cfgBloqueo').disabled = !admin;
        $('btnImportarHbs').hidden = !admin;
        $('btnImportarHbs').disabled = enPartido;
        ['mapaAnterior', 'mapaSiguiente'].forEach(id => { $(id).hidden = !admin; $(id).disabled = enPartido; });
        document.querySelectorAll('.online-miniatura').forEach(boton => {
            const elegida = boton.dataset.mapa === sala.config.mapaId;
            boton.classList.toggle('online-miniatura--elegida', elegida);
            boton.setAttribute('aria-selected', String(elegida));
            boton.disabled = !admin || enPartido;
        });
        const mapa = mapaPorId(sala.config.mapaId) || sala.mapa;
        $('nombreMapa').textContent = mapa ? mapa.name : '—';
        $('categoriaMapa').textContent = mapa
            ? (mapa.hbs ? `${mapa.category || 'HaxBall'} · HaxBall .hbs` : 'Original La Chaula')
            : '';
        document.querySelector('.online-admin__botones').hidden = !admin;
        $('mezclar').disabled = enPartido;
        $('pausa').disabled = !enPartido;
        $('pausa').textContent = enPartido && sala.partido.pausado ? 'Seguir (P)' : 'Pausa (P)';
        $('iniciarDetener').textContent = enPartido ? 'Detener partido' : 'Iniciar partido';
        $('iniciarDetener').classList.toggle('ssf-button-danger', enPartido);
    }

    function mapaPorId(id) {
        return estado.mapas.find(mapa => mapa.id === id) || null;
    }

    const ORDEN_CATEGORIAS = [
        'Todos',
        'Originales',
        'Futsal',
        'Classic / Big',
        'Real Soccer',
        'Hockey',
        'Basketball',
        'Volleyball',
        'Tennis / Ping',
        'Otros',
        'Importados'
    ];

    function grupoCategoria(mapa) {
        if (!mapa || !mapa.hbs) return 'Originales';
        if (mapa.imported || mapa.category === 'Importados') return 'Importados';
        const cat = mapa.category || '';
        if (cat === 'Futsal') return 'Futsal';
        if (cat === 'Classic' || cat === 'Big') return 'Classic / Big';
        if (cat === 'Real Soccer') return 'Real Soccer';
        if (cat === 'Hockey') return 'Hockey';
        if (cat === 'Basketball') return 'Basketball';
        if (cat === 'Volleyball') return 'Volleyball';
        if (cat === 'Tennis' || cat === 'Ping Pong') return 'Tennis / Ping';
        return 'Otros';
    }

    function reconstruirMapas() {
        estado.mapas = [...estado.mapasBase, ...estado.mapasHbs, ...estado.mapasCustom];
        if (estado.salaId) {
            dibujarFiltrosMapa();
            dibujarMiniaturas();
        }
        if (estado.sala) dibujarControlesAdmin(estado.sala);
    }

    function mapasFiltrados() {
        const q = estado.busquedaMapa.trim().toLowerCase();
        return estado.mapas.filter(mapa => {
            if (estado.categoriaFiltro !== 'Todos' && grupoCategoria(mapa) !== estado.categoriaFiltro) return false;
            if (q && !`${mapa.name} ${mapa.category || ''}`.toLowerCase().includes(q)) return false;
            return true;
        });
    }

    function dibujarFiltrosMapa() {
        const cont = $('filtrosMapa');
        if (!cont) return;
        const disponibles = new Set(['Todos']);
        estado.mapas.forEach(m => disponibles.add(grupoCategoria(m)));
        if (!disponibles.has(estado.categoriaFiltro)) estado.categoriaFiltro = 'Todos';

        cont.textContent = '';
        ORDEN_CATEGORIAS.filter(cat => disponibles.has(cat)).forEach(cat => {
            const btn = crearElemento('button', 'online-filtro', cat);
            btn.type = 'button';
            btn.setAttribute('role', 'tab');
            const activo = estado.categoriaFiltro === cat;
            btn.classList.toggle('online-filtro--activo', activo);
            btn.setAttribute('aria-selected', String(activo));
            btn.addEventListener('click', () => {
                estado.categoriaFiltro = cat;
                dibujarFiltrosMapa();
                aplicarFiltrosMapa();
            });
            cont.appendChild(btn);
        });
    }

    function aplicarFiltrosMapa() {
        const contenedor = $('miniaturas');
        const q = estado.busquedaMapa.trim().toLowerCase();
        let visibles = 0;
        contenedor.querySelectorAll('.online-miniatura').forEach(boton => {
            const cat = boton.dataset.categoria;
            const nombre = boton.dataset.nombre || '';
            const coincideCat = estado.categoriaFiltro === 'Todos' || cat === estado.categoriaFiltro;
            const coincideTexto = !q || nombre.includes(q);
            const mostrar = coincideCat && coincideTexto;
            boton.hidden = !mostrar;
            if (mostrar) visibles += 1;
        });
        let aviso = contenedor.querySelector('.online-miniaturas__vacio');
        if (!visibles) {
            if (!aviso) {
                aviso = crearElemento('p', 'online-miniaturas__vacio', 'No hay mapas que coincidan con el filtro.');
                contenedor.appendChild(aviso);
            }
            aviso.hidden = false;
        } else if (aviso) {
            aviso.hidden = true;
        }
    }

    async function cargarCatalogoHbs() {
        try {
            const res = await fetch('/api/mapas-hbs');
            if (!res.ok) return;
            const data = await res.json();
            if (Array.isArray(data.mapas)) {
                estado.mapasHbs = data.mapas;
                reconstruirMapas();
            }
        } catch (err) {
            // Si falla la carga opcional de catálogo, siguen disponibles los mapas base
        }
    }

    const cacheMiniaturas = new Map();

    // Miniaturas de todas las canchas: se dibujan una vez en escala liviana y se cachean.
    function dibujarMiniaturas() {
        const contenedor = $('miniaturas');
        contenedor.textContent = '';
        const thumbCanvas = document.createElement('canvas');
        const dibThumb = DibujoOnline.crearDibujante(thumbCanvas);
        estado.mapas.forEach(mapa => {
            const cat = grupoCategoria(mapa);
            const boton = crearElemento('button', 'online-miniatura');
            boton.type = 'button';
            boton.dataset.mapa = mapa.id;
            boton.dataset.categoria = cat;
            boton.dataset.nombre = `${mapa.name} ${mapa.category || ''}`.toLowerCase();
            boton.setAttribute('role', 'option');
            boton.title = mapa.hbs ? `${mapa.name} (${mapa.category || 'HaxBall'})` : mapa.name;
            let src = cacheMiniaturas.get(mapa.id);
            if (!src) {
                const tw = 160;
                const th = Math.max(54, Math.round((tw * mapa.height) / Math.max(1, mapa.width)));
                thumbCanvas.width = tw;
                thumbCanvas.height = th;
                dibThumb.dibujarMiniatura(mapa);
                src = thumbCanvas.toDataURL('image/png');
                cacheMiniaturas.set(mapa.id, src);
            }
            const img = crearElemento('img');
            img.alt = '';
            img.src = src;
            boton.append(img, crearElemento('span', '', mapa.name));
            boton.addEventListener('click', () => elegirMapa(mapa.id));
            contenedor.appendChild(boton);
        });
        aplicarFiltrosMapa();
    }

    function elegirMapa(mapaId) {
        if (!soyAdmin() || !estado.sala || estado.sala.config.mapaId === mapaId) return;
        accion('sala:config', { mapaId });
    }

    function moverCarrusel(paso) {
        if (!estado.sala || !estado.mapas.length) return;
        const lista = mapasFiltrados();
        const pool = lista.length ? lista : estado.mapas;
        const indice = pool.findIndex(mapa => mapa.id === estado.sala.config.mapaId);
        const base = indice === -1 ? (paso > 0 ? -1 : 0) : indice;
        const siguiente = pool[(base + paso + pool.length) % pool.length];
        elegirMapa(siguiente.id);
    }

    $('mapaAnterior').addEventListener('click', () => moverCarrusel(-1));
    $('mapaSiguiente').addEventListener('click', () => moverCarrusel(1));
    $('buscarMapa').addEventListener('input', evento => {
        estado.busquedaMapa = evento.target.value || '';
        aplicarFiltrosMapa();
    });

    function abrirDialogoImportarHbs() {
        if (!soyAdmin() || (estado.sala && estado.sala.partido)) return;
        $('errorImportarHbs').textContent = '';
        $('archivoHbs').value = '';
        $('nombreArchivoHbs').textContent = 'Ningún archivo elegido';
        estado.archivoHbsNombre = '';
        $('dialogoImportarHbs').showModal();
        $('textoHbs').focus();
    }

    $('btnImportarHbs').addEventListener('click', abrirDialogoImportarHbs);
    $('btnElegirArchivoHbs').addEventListener('click', () => $('archivoHbs').click());
    $('cancelarImportarHbs').addEventListener('click', () => $('dialogoImportarHbs').close());

    $('archivoHbs').addEventListener('change', async evento => {
        const archivo = evento.target.files && evento.target.files[0];
        if (!archivo) return;
        estado.archivoHbsNombre = archivo.name || '';
        $('nombreArchivoHbs').textContent = archivo.name;
        $('errorImportarHbs').textContent = '';
        try {
            $('textoHbs').value = await archivo.text();
        } catch {
            $('errorImportarHbs').textContent = 'No se pudo leer el archivo seleccionado.';
        }
    });

    $('formImportarHbs').addEventListener('submit', async evento => {
        evento.preventDefault();
        const texto = $('textoHbs').value;
        $('errorImportarHbs').textContent = '';
        try {
            if (window.FisicaHbs) window.FisicaHbs.parseHbsTexto(texto);
        } catch (err) {
            $('errorImportarHbs').textContent = err.message || 'Archivo .hbs inválido.';
            return;
        }
        const btn = $('confirmarImportarHbs');
        btn.disabled = true;
        const respuesta = await pedir('sala:importarHbs', {
            texto,
            nombreArchivo: estado.archivoHbsNombre
        });
        btn.disabled = false;
        if (respuesta.error) {
            $('errorImportarHbs').textContent = respuesta.error;
            return;
        }
        estado.categoriaFiltro = 'Importados';
        $('textoHbs').value = '';
        $('dialogoImportarHbs').close();
        dibujarFiltrosMapa();
        aplicarFiltrosMapa();
    });

    // Vista previa grande de la cancha elegida.
    function dibujarPreview() {
        if (!estado.panelVisible || !estado.sala) return;
        const mapa = estado.sala.mapa && estado.sala.mapa.id === estado.sala.config.mapaId
            ? estado.sala.mapa
            : (mapaPorId(estado.sala.config.mapaId) || estado.sala.mapa);
        const clave = `${mapa.id}|${mapa.width}|${mapa.height}|${mapa.theme || ''}`;
        const estatica = !!(mapa.hbs || mapa.theme === 'haxball');
        if (estatica && estado.ultimoPreviewClave === clave) return;
        estado.ultimoPreviewClave = clave;
        if (preview.width !== mapa.width || preview.height !== mapa.height) {
            preview.width = mapa.width;
            preview.height = mapa.height;
        }
        dibujantePreview.dibujar(DibujoOnline.estadoVacio(mapa), 0, null);
    }

    function dibujarUltimoResultado(sala) {
        const elemento = $('ultimoResultado');
        const resultado = sala.ultimoResultado;
        elemento.hidden = !resultado;
        if (!resultado) return;
        const goleadores = {};
        resultado.goles.filter(gol => gol.autor && !gol.enContra).forEach(gol => {
            goleadores[gol.autor] = (goleadores[gol.autor] || 0) + 1;
        });
        const lista = Object.entries(goleadores).map(([nombre, goles]) => (goles > 1 ? `${nombre} (${goles})` : nombre)).join(', ');
        const ganador = resultado.ganador ? `Ganó ${NOMBRE_EQUIPO[resultado.ganador]}` : 'Empate';
        elemento.textContent = `Último partido: ${ganador} · Rojo ${resultado.marcador.red} - ${resultado.marcador.blue} Azul${lista ? ` · Goles: ${lista}` : ''}`;
    }

    ['cfgTiempo', 'cfgGoles'].forEach(id => {
        $(id).addEventListener('change', evento => {
            const clave = { cfgTiempo: 'tiempoMin', cfgGoles: 'goles' }[id];
            accion('sala:config', { [clave]: Number(evento.target.value) });
            evento.target.blur();
        });
    });
    $('cfgModo').addEventListener('change', evento => {
        accion('sala:config', { modo: evento.target.value });
        evento.target.blur();
    });
    $('cfgTamano').addEventListener('change', evento => {
        accion('sala:config', { tamano: evento.target.value });
        evento.target.blur();
    });
    $('cfgPowerUps').addEventListener('change', evento => accion('sala:config', { powerUps: evento.target.checked }));
    $('cfgCombinar').addEventListener('change', evento => accion('sala:config', { combinarPoderes: evento.target.checked }));
    $('cfgBloqueo').addEventListener('change', evento => accion('sala:config', { equiposBloqueados: evento.target.checked }));
    $('mezclar').addEventListener('click', () => accion('sala:mezclar'));
    $('pausa').addEventListener('click', () => accion('partido:pausa'));
    $('iniciarDetener').addEventListener('click', () => accion(estado.sala && estado.sala.partido ? 'partido:detener' : 'partido:iniciar'));

    function mostrarPanel(visible) {
        estado.panelVisible = visible;
        $('panelSala').hidden = !visible;
    }

    $('botonPanel').addEventListener('click', () => mostrarPanel(!estado.panelVisible));

    /* ========================= */
    /* CHAT                      */
    /* ========================= */

    socket.on('sala:chat', mensaje => {
        const contenedor = $('chatMensajes');
        const linea = crearElemento('p', mensaje.sistema ? 'online-chat__sistema' : 'online-chat__mensaje');
        if (!mensaje.sistema) {
            const autor = crearElemento('strong', `online-chat__autor online-chat__autor--${mensaje.equipo || 'spec'}`, `${mensaje.admin ? '★ ' : ''}${mensaje.de}: `);
            linea.appendChild(autor);
        }
        linea.appendChild(document.createTextNode(mensaje.texto));
        contenedor.appendChild(linea);
        while (contenedor.children.length > 150) contenedor.removeChild(contenedor.firstChild);
        contenedor.scrollTop = contenedor.scrollHeight;
    });

    $('formChat').addEventListener('submit', evento => {
        evento.preventDefault();
        const texto = $('chatTexto').value.trim();
        $('chatTexto').value = '';
        $('chatTexto').blur();
        // Como en HaxBall: "/avatar XX" cambia lo que se ve en tu círculo ("/avatar" solo lo saca).
        const comando = texto.match(/^\/avatar(?:\s+(.*))?$/i);
        if (comando) {
            cambiarAvatar(comando[1] || '');
            return;
        }
        // "/extrapolation 50" (como HaxBall) o "/extrapolacion 50"; "/zoom 3".
        const extrapolacion = texto.match(/^\/extrapola(?:tion|cion|ción)(?:\s+(-?\d+))?$/i);
        if (extrapolacion) {
            if (extrapolacion[1] === undefined) avisarAjuste(`Extrapolación: ${estado.extrapolacion} ms (de 0 a ${MAX_EXTRAPOLACION})`);
            else cambiarExtrapolacion(Number(extrapolacion[1]));
            return;
        }
        const zoom = texto.match(/^\/zoom(?:\s+(\d))?$/i);
        if (zoom) {
            if (zoom[1] === undefined) avisarAjuste(`${NOMBRE_ZOOM[estado.zoomNivel]} (teclas 0 a 7)`);
            else cambiarZoom(Number(zoom[1]));
            return;
        }
        if (texto) accion('sala:chat', { texto });
    });

    $('chatTexto').addEventListener('focus', () => {
        soltarTeclas();
        avisarEscribiendo(true);
    });
    $('chatTexto').addEventListener('blur', () => avisarEscribiendo(false));

    // Globito de "escribiendo" arriba de tu jugador (solo se manda cuando cambia).
    let escribiendoAvisado = false;
    function avisarEscribiendo(si) {
        if (!estado.salaId || escribiendoAvisado === si) return;
        escribiendoAvisado = si;
        socket.emit('sala:escribiendo', { si });
    }

    /* ========================= */
    /* PARTIDO                   */
    /* ========================= */

    socket.on('partido:inicio', ({ mapa }) => {
        if (estado.sala) estado.sala.mapa = mapa;
        ajustarCanvas(mapa);
        dibujante.reiniciarEfectos();
        reiniciarRed();
        sonar('silbato');
        mostrarPanel(false);
        if (document.activeElement) document.activeElement.blur();
    });

    function reiniciarRed() {
        linea.reiniciar();
        prediccion.reiniciar();
    }

    socket.on('partido:estado', foto => {
        linea.agregar(foto);
        // Si jugás, la cancha entera se adelanta al presente desde lo que dice el
        // servidor (ver red.js). Los espectadores miran la foto interpolada.
        const sala = estado.sala;
        const yo = sala && sala.jugadores.find(jugador => jugador.id === estado.tuId);
        if (yo && yo.equipo) {
            const equipos = new Map(sala.jugadores.map(jugador => [jugador.id, jugador.equipo]));
            prediccion.reconciliar(foto, sala.mapa, equipos, estado.tuId, estado.bits);
        } else {
            prediccion.reiniciar();
        }
    });

    socket.on('partido:detenido', () => {
        reiniciarRed();
        mostrarPanel(true);
    });

    // Mismos efectos 8-bit que el arcade (js/arcade/sonidos.js de develop).
    function sonar(nombre) {
        if (window.Sonidos) window.Sonidos.reproducir(nombre);
    }

    function mostrarCartel(texto, equipo, duracionMs) {
        const cartel = $('cartelGol');
        cartel.textContent = texto;
        cartel.className = `online-cartel online-cartel--${equipo || 'neutro'}`;
        cartel.hidden = false;
        clearTimeout(estado.cartelTimeout);
        estado.cartelTimeout = setTimeout(() => { cartel.hidden = true; }, duracionMs);
    }

    socket.on('partido:evento', evento => {
        // El gol se festeja dentro de la cancha (mismo dibujo que el arcade).
        if (evento.tipo === 'patada') sonar('patada');
        else if (evento.tipo === 'gol') sonar('gol');
        else if (evento.tipo === 'saque') sonar('silbato');
        if (evento.tipo === 'tiempoExtra') {
            mostrarCartel('¡TIEMPO EXTRA!', null, 2000);
        }
    });

    socket.on('partido:fin', evento => {
        const texto = evento.ganador ? `¡GANÓ ${NOMBRE_EQUIPO[evento.ganador].toUpperCase()}!` : '¡EMPATE!';
        mostrarCartel(`${texto} ${evento.marcador.red} - ${evento.marcador.blue}`, evento.ganador, 4000);
        sonar('silbato');
        reiniciarRed();
        setTimeout(() => mostrarPanel(true), 1500);
    });

    function textoFase(foto) {
        if (foto.p) return 'PAUSA';
        if (foto.f === 'SAQUE') return `SAQUE ${foto.s === 'red' ? 'ROJO' : 'AZUL'}`;
        if (foto.f === 'GOL') return '¡GOL!';
        if (foto.f === 'TIEMPO_EXTRA' || foto.x) return 'TIEMPO EXTRA';
        return '';
    }

    // El marcador se toca solo cuando cambia: escribirlo en cada cuadro obligaba
    // al navegador a recalcular la página 60 veces por segundo.
    const textosHud = {};
    function ponerTextoHud(id, valor) {
        const texto = String(valor);
        if (textosHud[id] === texto) return;
        textosHud[id] = texto;
        $(id).textContent = texto;
    }

    function actualizarHud(foto) {
        ponerTextoHud('golesRojo', foto ? foto.m[0] : (estado.sala && estado.sala.partido ? estado.sala.partido.marcador.red : 0));
        ponerTextoHud('golesAzul', foto ? foto.m[1] : (estado.sala && estado.sala.partido ? estado.sala.partido.marcador.blue : 0));
        ponerTextoHud('reloj', foto ? formatearTiempo(foto.t) : '--:--');
        ponerTextoHud('faseTexto', foto ? textoFase(foto) : (estado.sala && estado.sala.partido ? '' : 'ESPERANDO'));
    }

    // Arma el "estado" que esperan las funciones de dibujo de develop a partir de la foto del servidor.
    function estadoParaDibujar(foto, prediccionActual) {
        const sala = estado.sala;
        const base = DibujoOnline.estadoVacio(sala.mapa);
        if (!foto) return base;
        const datos = new Map(sala.jugadores.map(jugador => [jugador.id, jugador]));
        const numeros = new Map();
        ['red', 'blue'].forEach(equipo => sala.jugadores
            .filter(jugador => jugador.equipo === equipo)
            .forEach((jugador, indice) => numeros.set(jugador.id, indice + 1)));
        const pelotaPredicha = prediccionActual && prediccionActual.pelota;
        const colorPelota = (sala.mapa && sala.mapa.ballPhysics && sala.mapa.ballPhysics.color) || null;
        base.ball = pelotaPredicha
            ? { x: pelotaPredicha.x, y: pelotaPredicha.y, r: foto.b[2], color: colorPelota }
            : { x: foto.b[0], y: foto.b[1], r: foto.b[2], color: colorPelota };
        base.activePowerUps = (foto.u || []).map(([x, y, type, r]) => ({ x, y, type, r }));
        base.lastPowerImpact = foto.i ? { id: foto.i[0], x: foto.i[1], y: foto.i[2] } : null;
        base.players = foto.j.map(([id, x, y, r, pateando, power]) => {
            const jugador = datos.get(id) || {};
            const predicho = prediccionActual && prediccionActual.jugadores.get(id);
            if (predicho) {
                x = predicho.x;
                y = predicho.y;
                if (id === estado.tuId) pateando = predicho.pateando;
            }
            return {
                id, x, y, r,
                equipo: jugador.equipo,
                pateando: !!pateando,
                activePower: power ? String(power).split('+')[0] : null,
                poderes: power ? Array.from(new Set(String(power).split('+'))) : [],
                niveles: power ? String(power).split('+').reduce((cuenta, tipo) => {
                    cuenta[tipo] = (cuenta[tipo] || 0) + 1;
                    return cuenta;
                }, {}) : {},
                escribiendo: !!jugador.escribiendo,
                nombre: jugador.nombre || '',
                numero: jugador.avatar || numeros.get(id) || '',
                esVos: id === estado.tuId
            };
        });
        return base;
    }

    function celebracionDe(foto) {
        if (!foto || foto.f !== 'GOL' || !foto.ug) return null;
        const [equipo, autor, enContra] = foto.ug;
        return {
            fase: 'GOL',
            golTranscurridoMs: foto.g || 0,
            duracionGolMs: 2500,
            ultimoGol: { equipo, jugadorId: autor || null, enContra: !!enContra }
        };
    }

    function bucle(ahora) {
        const delta = estado.ultimoDibujo === null ? 0 : ahora - estado.ultimoDibujo;
        estado.ultimoDibujo = ahora;
        if (estado.sala) {
            const ultima = linea.ultima();
            linea.avanzar(delta);
            // Tu jugador avanza acá mismo, al instante; cada medio segundo se manda un "ancla".
            if (prediccion.avanzar(delta, estado.bits, !ultima || !!ultima.p) && ultima) mandarTeclas();
            // Jugando se dibuja la cancha predicha (todo en el presente) con los datos de la
            // última foto; mirando, la foto interpolada.
            const prediccionActual = ultima ? prediccion.estadoActual(delta, estado.extrapolacion) : null;
            const foto = prediccionActual ? linea.ultima() : linea.fotoParaDibujar(Math.round(estado.extrapolacion / MS_TICK));
            if (ultima || !estado.panelVisible) {
                const dibujo = estadoParaDibujar(foto, prediccionActual);
                const camara = actualizarCamara(dibujo, delta);
                dibujante.dibujar(dibujo, foto && !foto.p ? delta : 0, celebracionDe(ultima), camara);
                dibujarAvisoAjuste(delta);
                estado.ultimoCanchaIdleClave = '';
            } else {
                const mapa = estado.sala.mapa;
                const claveIdle = `${mapa.id}|${mapa.width}|${mapa.height}`;
                if (estado.ultimoCanchaIdleClave !== claveIdle) {
                    estado.ultimoCanchaIdleClave = claveIdle;
                    dibujante.dibujar(DibujoOnline.estadoVacio(mapa), 0, null, null);
                }
            }
            actualizarHud(ultima);
            dibujarPreview();
        }
        requestAnimationFrame(bucle);
    }

    /* ========================= */
    /* ZOOM Y EXTRAPOLACIÓN      */
    /* ========================= */

    function zoomDe(mapa) {
        const ancho = ANCHO_VISIBLE_ZOOM[estado.zoomNivel] * (mapa.escala || 1);
        return Math.max(1, mapa.width / ancho);
    }

    /**
     * La cámara sigue a tu jugador (o a la pelota si mirás) y nunca muestra
     * afuera de la cancha. Se mueve suave, igual que el zoom al cambiarlo.
     */
    function actualizarCamara(dibujo, delta) {
        const mapa = dibujo.mapa;
        const objetivoZoom = zoomDe(mapa);
        const propio = dibujo.players.find(jugador => jugador.esVos);
        const foco = propio || dibujo.ball || { x: mapa.width / 2, y: mapa.height / 2 };
        let camara = estado.camara;
        if (!camara || camara.mapa !== mapa.id || camara.ancho !== mapa.width) {
            camara = { x: foco.x, y: foco.y, zoom: objetivoZoom, mapa: mapa.id, ancho: mapa.width };
        }
        const suave = 1 - Math.exp(-Math.max(0, delta) / 90);
        camara.zoom += (objetivoZoom - camara.zoom) * (1 - Math.exp(-Math.max(0, delta) / 120));
        camara.x += (foco.x - camara.x) * suave;
        camara.y += (foco.y - camara.y) * suave;
        // Que la vista no se salga de la cancha.
        const mitadAncho = mapa.width / (2 * camara.zoom);
        const mitadAlto = mapa.height / (2 * camara.zoom);
        camara.x = Math.min(mapa.width - mitadAncho, Math.max(mitadAncho, camara.x));
        camara.y = Math.min(mapa.height - mitadAlto, Math.max(mitadAlto, camara.y));
        estado.camara = camara;
        return camara;
    }

    function cambiarZoom(nivel) {
        estado.zoomNivel = Math.min(7, Math.max(0, nivel | 0));
        localStorage.setItem(CLAVE_ZOOM, String(estado.zoomNivel));
        $('cfgZoom').value = String(estado.zoomNivel);
        avisarAjuste(NOMBRE_ZOOM[estado.zoomNivel]);
    }

    function cambiarExtrapolacion(ms) {
        estado.extrapolacion = Math.min(MAX_EXTRAPOLACION, Math.max(0, Math.round(Number(ms) || 0)));
        localStorage.setItem(CLAVE_EXTRAPOLACION, String(estado.extrapolacion));
        $('cfgExtrapolacion').value = String(estado.extrapolacion);
        avisarAjuste(`Extrapolación: ${estado.extrapolacion} ms`);
    }

    function avisarAjuste(texto) {
        estado.avisoAjuste = { texto, restanteMs: 1500 };
    }

    // Cartelito arriba a la izquierda de la cancha cuando cambiás zoom o extrapolación.
    function dibujarAvisoAjuste(delta) {
        const aviso = estado.avisoAjuste;
        if (!aviso) return;
        aviso.restanteMs -= delta;
        if (aviso.restanteMs <= 0) {
            estado.avisoAjuste = null;
            return;
        }
        const contexto = canvas.getContext('2d');
        const tamano = Math.max(12, Math.round(canvas.width / 60));
        contexto.save();
        contexto.globalAlpha = Math.min(1, aviso.restanteMs / 300);
        contexto.font = `700 ${tamano}px "Press Start 2P", Arial, sans-serif`;
        contexto.textAlign = 'left';
        contexto.textBaseline = 'top';
        const ancho = contexto.measureText(aviso.texto).width;
        contexto.fillStyle = 'rgba(0, 0, 0, .65)';
        contexto.fillRect(tamano * 0.6, tamano * 0.6, ancho + tamano, tamano * 2);
        contexto.fillStyle = '#fff';
        contexto.fillText(aviso.texto, tamano * 1.1, tamano * 1.1);
        contexto.restore();
    }

    /* ========================= */
    /* TECLADO                   */
    /* ========================= */

    function enviarTeclas() {
        let bits = 0;
        estado.teclas.forEach(codigo => { bits |= BITS_TECLA[codigo] || 0; });
        if (bits !== estado.bits) {
            estado.bits = bits;
            mandarTeclas();
        }
    }

    // Manda las teclas con el tick del navegador en que empiezan a valer (para la predicción).
    function mandarTeclas() {
        socket.emit('entrada', { b: estado.bits, k: prediccion.proximoTick() });
    }

    function soltarTeclas() {
        estado.teclas.clear();
        enviarTeclas();
    }

    function escribiendo(elemento) {
        if (!elemento) return false;
        const tag = elemento.tagName;
        return tag === 'TEXTAREA' || (tag === 'INPUT' && !['checkbox', 'button', 'submit'].includes(elemento.type));
    }

    window.addEventListener('keydown', evento => {
        if (!estado.salaId || $('dialogoClave').open || $('dialogoImportarHbs').open) return;
        const enTexto = escribiendo(evento.target);
        if (evento.code === 'Escape') {
            if (enTexto) evento.target.blur();
            else mostrarPanel(!estado.panelVisible);
            return;
        }
        if (enTexto) return;
        if (evento.code === 'Enter') {
            evento.preventDefault();
            $('chatTexto').focus();
            return;
        }
        const numero = evento.code.match(/^(?:Digit|Numpad)([0-7])$/);
        if (numero && !evento.repeat) {
            cambiarZoom(Number(numero[1]));
            return;
        }
        if (evento.code === 'KeyP' && !evento.repeat && soyAdmin() && estado.sala.partido) {
            accion('partido:pausa');
            return;
        }
        if (BITS_TECLA[evento.code]) {
            // Que Espacio o las flechas no aprieten botones ni cambien selects.
            evento.preventDefault();
            if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
            estado.teclas.add(evento.code);
            enviarTeclas();
        }
    });

    window.addEventListener('keyup', evento => {
        if (!BITS_TECLA[evento.code]) return;
        estado.teclas.delete(evento.code);
        enviarTeclas();
    });

    window.addEventListener('blur', soltarTeclas);

    /* ========================= */
    /* INICIO                    */
    /* ========================= */

    $('nombreJugador').value = nombreGuardado();
    guardarAvatar(avatarGuardado());
    Object.keys(NOMBRE_ZOOM).forEach(nivel => {
        const opcion = crearElemento('option', '', `${nivel} · ${NOMBRE_ZOOM[nivel]}`);
        opcion.value = nivel;
        $('cfgZoom').appendChild(opcion);
    });
    $('cfgZoom').value = String(estado.zoomNivel);
    $('cfgExtrapolacion').value = String(estado.extrapolacion);
    $('cfgZoom').addEventListener('change', evento => {
        cambiarZoom(Number(evento.target.value));
        evento.target.blur();
    });
    $('cfgExtrapolacion').addEventListener('change', evento => {
        cambiarExtrapolacion(evento.target.value);
        evento.target.blur();
    });
    $('avatarJugador').addEventListener('change', evento => guardarAvatar(evento.target.value));
    $('avatarSala').addEventListener('change', evento => {
        cambiarAvatar(evento.target.value);
        evento.target.blur();
    });
    $('avatarSala').addEventListener('focus', soltarTeclas);
    $('nombreJugador').addEventListener('change', () => {
        const nombre = $('nombreJugador').value.trim();
        if (nombre) localStorage.setItem(CLAVE_NOMBRE, nombre);
    });
    cargarCatalogoHbs();
    requestAnimationFrame(bucle);
})();

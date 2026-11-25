// Servidor estatico minimo para probar la copia local del sitio.
// Uso: node servir.js   ->   http://localhost:8000
// No requiere dependencias: solo modulos incluidos en Node.

const http = require("http");
const fs = require("fs");
const path = require("path");

const RAIZ = __dirname;
const PUERTO = Number(process.env.PORT) || 8000;

const TIPOS = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".webm": "video/webm"
};

const servidor = http.createServer((req, res) => {
    let ruta = decodeURIComponent(req.url.split("?")[0]);
    if (ruta === "/") ruta = "/index.html";

    const destino = path.join(RAIZ, path.normalize(ruta).replace(/^([\\/])+/, ""));
    if (!destino.startsWith(RAIZ)) {
        res.writeHead(403).end("Prohibido");
        return;
    }

    fs.stat(destino, (error, info) => {
        if (error || !info.isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("No encontrado: " + ruta);
            return;
        }
        const tipo = TIPOS[path.extname(destino).toLowerCase()] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": tipo, "Content-Length": info.size });
        fs.createReadStream(destino).pipe(res);
    });
});

servidor.listen(PUERTO, () => {
    console.log(`\n  La Chaula (copia local)\n  http://localhost:${PUERTO}\n\n  Ctrl+C para detener.\n`);
});

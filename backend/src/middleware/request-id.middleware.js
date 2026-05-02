/**
 * @module middleware/request-id
 * @description Asigna un request ID (UUID v4) por cada petición HTTP.
 *
 * Comportamiento:
 *   * Si el cliente envió `X-Request-ID`, se conserva (útil para correlación
 *     nginx → backend y para distributed tracing en el futuro). Se valida
 *     que sea plausible (alfanum + guiones, ≤128 chars) para no aceptar
 *     payloads arbitrarios en un header que acaba en logs.
 *   * Si no, se genera uno nuevo.
 *   * Se expone a downstream via `req.requestId` y se devuelve al cliente
 *     como `X-Request-ID` para que pueda incluirse en reportes de bugs.
 *
 * Uso aguas abajo:
 *   El logger puede leer `req.requestId` cuando está disponible. Para el
 *   formato JSON en prod es trivial añadirlo al `meta` de cada `logger.info`.
 *   Middlewares/handlers no tienen acceso directo al logger con contexto —
 *   por ahora anotan `{ requestId: req.requestId }` manualmente donde
 *   importa (errores, auditoría). Una solución más elegante (AsyncLocalStorage)
 *   queda como deuda documental para cuando Node 20 sea el mínimo.
 */

const { randomUUID } = require('crypto');

const VALID_ID = /^[A-Za-z0-9_.-]{1,128}$/;

function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  const id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
}

module.exports = { requestId };

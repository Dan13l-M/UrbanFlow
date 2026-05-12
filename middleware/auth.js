const jwt = require('jsonwebtoken');

/**
 * Middleware de autenticación JWT.
 * Todas las rutas protegidas lo pasan antes de ejecutar su lógica.
 *
 * Flujo:
 *  1. Lee el header Authorization de la petición.
 *  2. Verifica que tenga el formato "Bearer <token>".
 *  3. Valida la firma del token con JWT_SECRET del .env.
 *  4. Si es válido, adjunta el payload a req.user y cede el control al siguiente middleware.
 *  5. Si falta o está expirado, responde 401 y corta la cadena.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;

  // El header debe existir y empezar con "Bearer "
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  // Extrae el token descartando el prefijo "Bearer "
  const token = header.slice(7);

  try {
    // Verifica firma y expiración; lanza excepción si falla
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = authenticate;

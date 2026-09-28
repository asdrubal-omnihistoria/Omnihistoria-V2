import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

/**
 * Aduana de Datos Canónicos de la Omnihistoria (V2)
 * Maneja la lectura de contingencia y la persistencia inmutable vía GitOps en GitHub/Vercel.
 */
export default async function handler(req, res) {
  // 1. Aislamiento CORS: Solo responder pre-flight y restringir métodos
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    // ---- OPERACIÓN DE LECTURA (GET) ----
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      const host = req.headers.host;
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const response = await fetch(`${protocol}://${host}/json/contenido.json`);
      
      if (!response.ok) {
        throw new Error('Fallo al obtener la fuente estática canónica');
      }
      const data = await response.json();
      return res.status(200).json(data);
    }

    // ---- OPERACIÓN DE MUTACIÓN Y GITOPS (POST) ----
    if (req.method === 'POST') {
      // 1. Blindaje Criptográfico contra Timing Attacks
      const authHeader = req.headers.authorization || '';
      const secretToken = process.env.ADMIN_SECRET_TOKEN;

      if (!secretToken) {
        console.error('ALERTA: ADMIN_SECRET_TOKEN no está configurado en Vercel.');
        return res.status(500).json({ error: 'Configuración interna de aduana incompleta.' });
      }

      const expectedHeader = `Bearer ${secretToken}`;
      const authBuffer = Buffer.from(authHeader);
      const expectedBuffer = Buffer.from(expectedHeader);

      const isValidToken = 
        authBuffer.length === expectedBuffer.length && 
        timingSafeEqual(authBuffer, expectedBuffer);

      if (!isValidToken) {
        return res.status(401).json({ 
          error: 'Acceso denegado: Firma de administración inválida o no autorizada.' 
        });
      }

      // 2. Validación de Carga Útil (Payload)
      const nuevoContenido = req.body;
      if (!nuevoContenido || typeof nuevoContenido !== 'object' || Array.isArray(nuevoContenido)) {
        return res.status(400).json({ error: 'Estructura ontológica JSON no válida.' });
      }

      // 3. Persistencia Inmutable vía GitHub Contents API
      const githubToken = process.env.GITHUB_TOKEN;
      const githubRepo = process.env.GITHUB_REPO;
      const branch = process.env.GITHUB_BRANCH || 'main';
      const filePath = 'json/contenido.json';

      if (!githubToken || !githubRepo) {
        console.error('ALERTA: Credenciales de GitHub no configuradas en el entorno.');
        return res.status(500).json({ 
          error: 'Persistencia inmutable no conectada al repositorio central.' 
        });
      }

      // Obtener el SHA actual del archivo para permitir la actualización atómica
      const getFileUrl = `https://api.github.com/repos/${githubRepo}/contents/${filePath}?ref=${branch}`;
      const fileRes = await fetch(getFileUrl, {
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Omnihistoria-V2-Engine'
        }
      });

      if (!fileRes.ok) {
        throw new Error(`Error localizando el archivo canónico en GitHub: ${fileRes.statusText}`);
      }

      const fileData = await fileRes.json();
      const currentSha = fileData.sha;

      // Codificar el nuevo contenido a Base64 requerido por la API de GitHub
      const contentString = JSON.stringify(nuevoContenido, null, 2);
      const contentEncoded = Buffer.from(contentString, 'utf-8').toString('base64');

      // Ejecutar commit atómico directo en el repositorio
      const updateUrl = `https://api.github.com/repos/${githubRepo}/contents/${filePath}`;
      const commitRes = await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Omnihistoria-V2-Engine'
        },
        body: JSON.stringify({
          message: 'chore(legado): actualización canónica de contenido.json vía cPanel Admin',
          content: contentEncoded,
          sha: currentSha,
          branch: branch
        })
      });

      if (!commitRes.ok) {
        const errorDetail = await commitRes.text();
        throw new Error(`Fallo en el commit a GitHub: ${errorDetail}`);
      }

      return res.status(200).json({ 
        success: true, 
        message: 'Persistencia inmutable lograda. Despliegue automático de Vercel en progreso.' 
      });
    }

    return res.status(405).json({ error: 'Método no permitido.' });

  } catch (error) {
    console.error('Fallo en la aduana de datos api/contenido.js:', error.message);
    return res.status(500).json({ 
      error: 'Error interno en la infraestructura de datos de la Omnihistoria.' 
    });
  }
      }

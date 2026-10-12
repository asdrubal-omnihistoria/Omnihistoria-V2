import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

/**
 * Aduana de Inteligencia Artificial para el cPanel de Omnihistoria V2.
 * Recibe instrucciones en lenguaje natural, consulta el modelo de lenguaje de forma segura
 * y devuelve el JSON canónico mutado bajo validación de esquema.
 */
export default async function handler(req, res) {
  // 1. Manejo seguro de métodos HTTP y Pre-flight
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Aduana exclusiva para POST.' });
  }

  try {
    // 2. Blindaje Criptográfico de Acceso (ADMIN_SECRET_TOKEN)
    const authHeader = req.headers.authorization || '';
    const secretToken = process.env.ADMIN_SECRET_TOKEN;

    if (!secretToken) {
      console.error('ALERTA: ADMIN_SECRET_TOKEN no definido en variables de Vercel.');
      return res.status(500).json({ error: 'Aduana de seguridad no configurada en el servidor.' });
    }

    const expectedHeader = `Bearer ${secretToken}`;
    const authBuffer = Buffer.from(authHeader);
    const expectedBuffer = Buffer.from(expectedHeader);

    const isAuthorized = 
      authBuffer.length === expectedBuffer.length && 
      timingSafeEqual(authBuffer, expectedBuffer);

    if (!isAuthorized) {
      return res.status(401).json({ error: 'Firma de administración inválida o rechazada.' });
    }

    // 3. Validación de Carga Útil (Payload)
    const { prompt, currentData } = req.body || {};

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Instrucción para la IA ausente o vacía.' });
    }

    if (!currentData || typeof currentData !== 'object') {
      return res.status(400).json({ error: 'Estructura JSON canónica actual no suministrada.' });
    }

    // 4. Invocación del Motor Gemini AI mediante API REST Nativa
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

    if (!apiKey) {
      console.error('ALERTA: GEMINI_API_KEY no encontrada en las Variables de Entorno.');
      return res.status(500).json({ 
        error: 'Conexión con el motor de IA no configurada (GEMINI_API_KEY faltante en Vercel).' 
      });
    }

    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // Prompt de sistema estricto para garantizar integridad ontológica y estructural
    const systemPrompt = `Eres el Arquitecto de Datos y Ontólogo en Jefe de la WebApp OMNIHISTORIA (V2).
Tu misión es recibir el estado actual del archivo canónico "contenido.json" y una instrucción administrativa para mutarlo.

REGLAS INQUEBRANTABLES:
1. Debes preservar obligatoriamente todas las claves existentes del esquema JSON original ($schema_version, index_page, registro_page, central_page, capsula_page, carga_page, admin_page, footer_global).
2. Si la orden es agregar un artículo de blog en "index_page.blog_informativo.articulos", créalo con la estructura: id, categoria, fecha_iso (AAAA-MM-DD), fecha_legible, titulo, resumen, cuerpo. Mantén el tono reflexivo, filosófico, solemne e histórico.
3. Si la orden es modificar leyendas, fichas o textos, hazlo con precisión quirúrgica sin alterar los demás campos.
4. Devuelve ÚNICAMENTE el objeto JSON resultante. Cero explicaciones, cero texto introductorio, cero bloques markdown de código.`;

    const requestBody = {
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `ESTADO CANÓNICO ACTUAL (JSON):\n${JSON.stringify(currentData)}\n\nORDEN ADMINISTRATIVA:\n"${prompt.trim()}"\n\nGenera el JSON completo resultante respetando estrictamente el formato.`
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    };

    const aiResponse = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Error reportado por el motor Gemini:', errorText);
      return res.status(502).json({ error: 'El motor de IA rechazó la solicitud o agotó su cuota.' });
    }

    const aiData = await aiResponse.json();
    const candidateText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      throw new Error('Respuesta vacía o formato ilegible devuelto por el modelo.');
    }

    // 5. Validación de Integridad Sintáctica antes de responder
    let mutatedJson;
    try {
      mutatedJson = JSON.parse(candidateText);
    } catch (parseError) {
      console.error('JSON malformado recibido de la IA:', candidateText);
      return res.status(500).json({ error: 'La IA generó una respuesta que no cumple con el estándar sintáctico JSON.' });
    }

    // Retornar el nuevo JSON estructurado a admin.html para su revisión y aprobación en staging
    return res.status(200).json(mutatedJson);

  } catch (err) {
    console.error('Fallo interno en api/ia.js:', err.message);
    return res.status(500).json({ error: 'Error interno en la aduana de inferencia algorítmica.' });
  }
      }

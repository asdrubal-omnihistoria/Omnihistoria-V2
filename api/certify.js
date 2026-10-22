// api/certify.js — Certificación OMNIH v2
// Flujo: archivo real → hash recalculado por el servidor → sello OTS (Bitcoin)
//        → acta firmada Ed25519 (JWS)
// Variables de entorno (Vercel):
//   OMNIH_PRIVATE_KEY   (PEM Ed25519 PKCS8 — OBLIGATORIA)
//   OMNIH_PUBLIC_KEY    (PEM SPKI — opcional, se deriva de la privada)
import crypto from 'node:crypto';

export const config = { api: { bodyParser: false } };

const MAX_FILE_MB = 25;

// Cabecera de un archivo .ots: magic + versión 1 + operación SHA-256
const OTS_HEADER = Buffer.from(
  '004f70656e54696d657374616d7073' + '0000' + '50726f6f66' + '00' +
  'bf89e2e884e89294' + '01' + '08', 'hex'
);

/* ---------------- Clave soberana Ed25519 ---------------- */
// Reconstruye un PEM válido aunque Vercel/el teléfono hayan cambiado
// los saltos de línea por espacios, o haya comillas, o falte la cabecera.
function normalizePem(raw, defaultLabel) {
  let s = String(raw).trim().replace(/^["']+|["']+$/g, '');
  s = s.replace(/\\r/g, '').replace(/\\n/g, '\n');
  const m = /-----BEGIN ([A-Z ]+)-----/.exec(s);
  const label = m ? m[1].trim() : defaultLabel;
  const body = s
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  if (!body) throw new Error('la variable está vacía o no contiene una clave');
  return `-----BEGIN ${label}-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
}

let keyPair = null;
function getKeyPair() {
  if (keyPair) return keyPair;
  const raw = process.env.OMNIH_PRIVATE_KEY;
  if (!raw) {
    throw new Error('OMNIH_PRIVATE_KEY no configurada. Defínala en las variables de entorno de Vercel.');
  }

  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(normalizePem(raw, 'PRIVATE KEY'));
  } catch (e) {
    throw new Error(
      'OMNIH_PRIVATE_KEY no se pudo leer (' + e.message +
      '). Debe ser una clave privada Ed25519 en formato PEM PKCS8 ("BEGIN PRIVATE KEY").'
    );
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(
      'OMNIH_PRIVATE_KEY es de tipo "' + privateKey.asymmetricKeyType + '"; se requiere Ed25519.'
    );
  }

  let publicKey;
  try {
    publicKey = process.env.OMNIH_PUBLIC_KEY
      ? crypto.createPublicKey(normalizePem(process.env.OMNIH_PUBLIC_KEY, 'PUBLIC KEY'))
      : crypto.createPublicKey(privateKey);
  } catch (e) {
    publicKey = crypto.createPublicKey(privateKey);
  }

  keyPair = { privateKey, publicKey };
  return keyPair;
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function sanitizeText(value, max = 200) {
  return String(value || '').replace(/[\r\n\0]/g, '').trim().slice(0, max);
}
function sanitizeFileName(name) {
  return sanitizeText(name).replace(/[\\/:"*?<>|]/g, '_') || 'documento';
}

/* ---------------- Parse de multipart/form-data ---------------- */
async function parseMultipart(req) {
  const contentType = req.headers['content-type'] || '';
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) throw new Error('Content-Type multipart/form-data requerido.');
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);

  const fields = {};
  let file = null;
  let pos = raw.indexOf(boundary);
  while (pos !== -1) {
    const next = raw.indexOf(boundary, pos + boundary.length);
    if (next === -1) break;
    const start = pos + boundary.length + 2;
    const part = raw.slice(start, next - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerBlock = part.slice(0, headerEnd).toString('utf8');
      const body = part.slice(headerEnd + 4);
      const nameMatch = /name="([^"]*)"/.exec(headerBlock);
      if (nameMatch) {
        const fileNameMatch = /filename="([^"]*)"/.exec(headerBlock);
        if (fileNameMatch) {
          file = { name: sanitizeFileName(fileNameMatch[1]), bytes: body };
        } else {
          fields[nameMatch[1]] = body.toString('utf8').trim();
        }
      }
    }
    pos = next;
  }
  return { fields, file };
}

/* ---------------- Handler ---------------- */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Use POST.' });
  }

  try {
    // 0) Verificar la clave ANTES de hacer trabajo
    const { privateKey, publicKey } = getKeyPair();

    // 1) Recibir el archivo REAL
    const { fields, file } = await parseMultipart(req);
    if (!file) {
      return res.status(400).json({ error: 'Campo "file" (archivo original) obligatorio.' });
    }
    if (file.bytes.length > MAX_FILE_MB * 1024 * 1024) {
      return res.status(413).json({ error: `Archivo excede el límite de ${MAX_FILE_MB} MB.` });
    }

    // 2) EL SERVIDOR RECALCULA EL SHA-256
    const hashBuffer = crypto.createHash('sha256').update(file.bytes).digest();
    const cleanHex = hashBuffer.toString('hex');

    // 3) SELLO OTS — calendario Bitcoin (queda pendiente hasta confirmarse)
    let otsBase64 = null;
    let otsStatus = 'FALLA_OTS_SIN_RECIBO';
    try {
      const otsResponse = await fetch('https://a.pool.opentimestamps.org/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'Accept': 'application/octet-stream' },
        body: hashBuffer
      });
      if (otsResponse.ok) {
        const calendarBytes = Buffer.from(await otsResponse.arrayBuffer());
        otsBase64 = Buffer.concat([OTS_HEADER, hashBuffer, calendarBytes]).toString('base64');
        otsStatus = 'CONFIRMADO_EN_CALENDARIO_BITCOIN';
      } else {
        otsStatus = `ERROR_OTS_HTTP_${otsResponse.status}`;
      }
    } catch (errOTS) {
      otsStatus = `FALLA_CONEXION_OTS: ${errOTS.message}`.slice(0, 150);
    }

    // 4) FIRMA SOBERANA Ed25519 (JWS compacto)
    const signedAt = new Date().toISOString();
    const signer = 'OMNIH-CA v2';

    const payloadData = {
      hash: `0x${cleanHex}`,
      algorithm: 'SHA-256',
      filename: file.name,
      size: file.bytes.length,
      entidad: sanitizeText(fields.entidad) || 'INSTITUCIÓN VINCULADA',
      convenio: sanitizeText(fields.convenio) || 'N/A',
      signer,
      signed_at: signedAt,
      ots_status: otsStatus
    };

    const encodedHeader = base64url(JSON.stringify({ alg: 'EdDSA', typ: 'OMNIH-PROOF' }));
    const encodedPayload = base64url(JSON.stringify(payloadData));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signatureBuffer = crypto.sign(null, Buffer.from(signingInput), privateKey);
    const jwsCompact = `${signingInput}.${base64url(signatureBuffer)}`;
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

    // 5) ACTA OFICIAL FORENSE
    const certProof = {
      seal: 'OMNIH',
      hash: `0x${cleanHex}`,
      filename: file.name,
      size: file.bytes.length,
      signer,
      signed_at: signedAt,
      signature: jwsCompact,
      signature_algo: 'Ed25519',
      public_key: publicKeyPem,
      verify_signature_hint: 'crypto.verify(null, Buffer.from(jws.split(".")[0] + "." + jws.split(".")[1]), crypto.createPublicKey(pubKeyPem), Buffer.from(jws.split(".")[2], "base64url"))'
    };

    return res.status(200).json({
      success: true,
      hash: `0x${cleanHex}`,
      filename: file.name,
      size: file.bytes.length,
      ots_status: otsStatus,
      ots_receipt_base64: otsBase64,
      ipfs_status: 'NO_USADO',
      ipfs_url: null,
      proof: certProof
    });

  } catch (error) {
    console.error('Fatal certify:', error);
    return res.status(500).json({ error: `Fallo crítico de backend: ${error.message}` });
  }
    }

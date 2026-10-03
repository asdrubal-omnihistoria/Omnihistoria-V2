// api/certify.js — Certificación OMNIH v2
// Flujo: archivo real → hash recalculado por el servidor → sello OTS (Bitcoin)
//        → archivo original a IPFS (opcional) → acta firmada Ed25519 (JWS)
// Dependencias (package.json):
//   "@web3-storage/w3up-client": "^10.0.0",
//   "@ucanto/principal": "^9.0.0"
// Variables de entorno (Vercel):
//   OMNIH_PRIVATE_KEY   (PEM Ed25519 — OBLIGATORIA, ver instrucciones abajo)
//   OMNIH_PUBLIC_KEY    (PEM SPKI — opcional, se deriva de la privada)
//   W3UP_KEY            (secret de `w3 key create` — opcional)
//   W3UP_DELEGATION     (.car en base64 — opcional)
//   W3UP_SPACE          (DID del espacio — opcional)
import crypto from 'node:crypto';
import { create as w3create } from '@web3-storage/w3up-client';
import { Signer } from '@ucanto/principal/ed25519';
import * as Delegation from '@ucanto/core/delegation';

export const config = { api: { bodyParser: false } }; // recibir multipart crudo

const MAX_FILE_MB = 25;

/* ---------------- Clave soberana Ed25519 ---------------- */
// CRÍTICO: sin OMNIH_PRIVATE_KEY cada instancia serverless generaría una clave
// efímera imposible de verificar entre despliegues → se rechaza emitir.
let keyPair = null;
function getKeyPair() {
  if (keyPair) return keyPair;
  if (!process.env.OMNIH_PRIVATE_KEY) {
    throw new Error('OMNIH_PRIVATE_KEY no configurada. Genere una clave soberana y defínala en las variables de entorno.');
  }
  const privateKey = crypto.createPrivateKey(process.env.OMNIH_PRIVATE_KEY);
  const publicKey = process.env.OMNIH_PUBLIC_KEY
    ? crypto.createPublicKey(process.env.OMNIH_PUBLIC_KEY)
    : privateKey.export({ type: 'spki', format: 'pem' }) ? crypto.createPublicKey(privateKey)
    : crypto.createPublicKey(privateKey);
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
    if (next === -1) break; // boundary final
    const start = pos + boundary.length + 2; // salta \r\n tras el boundary
    let part = raw.slice(start, next - 2);   // recorta \r\n previo al boundary
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerBlock = part.slice(0, headerEnd).toString('utf8');
      const body = part.slice(headerEnd + 4);
      const nameMatch = /name="([^"]*)"/.exec(headerBlock);
      if (nameMatch) {
        const fileNameMatch = /filename="([^"]*)"/.exec(headerBlock);
        if (fileNameMatch) {
          const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerBlock);
          file = {
            name: sanitizeFileName(fileNameMatch[1]),
            type: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
            bytes: body
          };
        } else {
          fields[nameMatch[1]] = body.toString('utf8').trim();
        }
      }
    }
    pos = next;
  }
  return { fields, file };
}

/* ---------------- Anclaje IPFS (w3up/Storacha) ---------------- */
// Devuelve {cid, url} o null si no hay credenciales o si falla.
// NUNCA rompe la certificación: el acta local sigue siendo válida.
async function uploadToIpfs(fileBytes, fileName, fileType) {
  const key = process.env.W3UP_KEY;
  const delegationB64 = process.env.W3UP_DELEGATION;
  const spaceDid = process.env.W3UP_SPACE;
  if (!key || !delegationB64 || !spaceDid) return null;

  const principal = Signer.parse(key);
  const client = w3create({ principal });
  const carBytes = Uint8Array.from(Buffer.from(delegationB64, 'base64'));
  const delegation = await Delegation.import(carBytes);
  client.addProof(delegation);
  await client.setCurrentSpace(spaceDid);
  const webFile = new File([fileBytes], fileName, { type: fileType });
  const cid = await client.uploadFile(webFile);
  return { cid: String(cid), url: `https://w3s.link/ipfs/${cid}` };
}

/* ---------------- Handler ---------------- */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Use POST.' });
  }

  try {
    // 1) Recibir el archivo REAL (el navegador ya no declara el hash)
    const { fields, file } = await parseMultipart(req);
    if (!file) {
      return res.status(400).json({ error: 'Campo "file" (archivo original) obligatorio.' });
    }
    if (file.bytes.length > MAX_FILE_MB * 1024 * 1024) {
      return res.status(413).json({ error: `Archivo excede el límite de ${MAX_FILE_MB} MB.` });
    }

    // 2) EL SERVIDOR RECALCULA EL SHA-256 — fuente de verdad criptográfica
    const hashBuffer = crypto.createHash('sha256').update(file.bytes).digest();
    const cleanHex = hashBuffer.toString('hex');

    // 3) SELLO OTS REAL — estampado en calendario Bitcoin (pool público)
    let otsBase64 = null;
    let otsStatus = 'FALLA_OTS_SIN_RECIBO';
    try {
      const otsResponse = await fetch('https://a.pool.opentimestamps.org/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'Accept': 'application/octet-stream' },
        body: hashBuffer
      });
      if (otsResponse.ok) {
        otsBase64 = Buffer.from(await otsResponse.arrayBuffer()).toString('base64');
        otsStatus = 'CONFIRMADO_EN_CALENDARIO_BITCOIN';
      } else {
        otsStatus = `ERROR_OTS_HTTP_${otsResponse.status}`;
      }
    } catch (errOTS) {
      otsStatus = `FALLA_CONEXION_OTS: ${errOTS.message}`.slice(0, 150);
    }

    // 4) ARCHIVO ORIGINAL → IPFS (opcional según variables de entorno)
    let ipfs = null;
    let ipfsStatus = 'SIN_CONFIGURAR (modo local)';
    try {
      ipfs = await uploadToIpfs(file.bytes, file.name, file.type);
      if (ipfs) ipfsStatus = 'ANCLADO_EN_IPFS';
    } catch (errIpfs) {
      ipfs = null;
      ipfsStatus = `FALLA_IPFS: ${errIpfs.message}`.slice(0, 150);
    }

    // 5) FIRMA SOBERANA Ed25519 (JWS compacto)
    const { privateKey, publicKey } = getKeyPair();
    const signedAt = new Date().toISOString();
    const signer = 'OMNIH-CA v2';

    const payloadData = {
      hash: `0x${cleanHex}`,           // hash calculado POR EL SERVIDOR
      algorithm: 'SHA-256',
      filename: file.name,
      size: file.bytes.length,
      entidad: sanitizeText(fields.entidad) || 'INSTITUCIÓN VINCULADA',
      convenio: sanitizeText(fields.convenio) || 'N/A',
      signer,
      signed_at: signedAt,
      ots_status: otsStatus,
      ipfs_cid: ipfs ? ipfs.cid : null
    };

    const encodedHeader = base64url(JSON.stringify({ alg: 'EdDSA', typ: 'OMNIH-PROOF' }));
    const encodedPayload = base64url(JSON.stringify(payloadData));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signatureBuffer = crypto.sign(null, Buffer.from(signingInput), privateKey);
    const jwsCompact = `${signingInput}.${base64url(signatureBuffer)}`;
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

    // 6) ACTA OFICIAL FORENSE
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
      verify_signature_hint: 'crypto.verify(null, Buffer.from(jws.split(".")[0]+"."+jws.split(".")[1]), createPublicKey(public_key), Buffer.from(jws.split(".")[2],"base64url"))',
      file_url: ipfs ? ipfs.url : null,
      anchors: [
        {
          type: 'OpenTimestamps (Bitcoin Ledger)',
          server: 'https://a.pool.opentimestamps.org',
          status: otsStatus,
          ots_receipt_base64: otsBase64
        },
        {
          type: 'IPFS (w3up/Storacha)',
          status: ipfsStatus,
          cid: ipfs ? ipfs.cid : null,
          file_url: ipfs ? ipfs.url : null
        }
      ]
    };

    return res.status(200).json(certProof);
  } catch (err) {
    return res.status(500).json({ error: `Fallo de certificación: ${err.message}`.slice(0, 300) });
  }
}

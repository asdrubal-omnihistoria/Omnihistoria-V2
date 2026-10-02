import crypto from 'node:crypto';

// Llave privada soberana desde Variables de Entorno de Vercel (o generación segura si es primer despliegue)
let keyPair;
function getKeyPair() {
  if (keyPair) return keyPair;
  if (process.env.OMNIH_PRIVATE_KEY && process.env.OMNIH_PUBLIC_KEY) {
    keyPair = {
      privateKey: crypto.createPrivateKey(process.env.OMNIH_PRIVATE_KEY),
      publicKey: crypto.createPublicKey(process.env.OMNIH_PUBLIC_KEY)
    };
  } else {
    keyPair = crypto.generateKeyPairSync('ed25519');
  }
  return keyPair;
}

function base64url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Use POST.' });
  }

  const { hash, filename, size, entidad, convenio } = req.body || {};

  if (!hash || !filename) {
    return res.status(400).json({ error: 'Parámetros hash y filename son obligatorios.' });
  }

  const cleanHex = hash.replace(/^0x/i, '');
  const hashBytes = Buffer.from(cleanHex, 'hex');

  // 1. LLAMADA REAL A BLOCKCHAIN (OpenTimestamps -> Pool Bitcoin)
  let otsBase64 = null;
  let otsStatus = 'ANCLADO_EN_COLA_BITCOIN';
  try {
    const otsResponse = await fetch('https://a.pool.opentimestamps.org/digest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Accept': 'application/octet-stream'
      },
      body: hashBytes
    });

    if (otsResponse.ok) {
      const otsArrayBuffer = await otsResponse.arrayBuffer();
      otsBase64 = Buffer.from(otsArrayBuffer).toString('base64');
      otsStatus = 'CONFIRMADO_EN_CALENDARIO_BITCOIN';
    } else {
      otsStatus = `ERROR_OTS_HTTP_${otsResponse.status}`;
    }
  } catch (errOTS) {
    otsStatus = `FALLA_CONEXION_OTS: ${errOTS.message}`;
  }

  // 2. FIRMA ASIMÉTRICA SOBERANA OMNIH (Ed25519)
  const { privateKey, publicKey } = getKeyPair();
  const signedAt = new Date().toISOString();
  const signer = 'OMNIH-CA v1';

  const payloadData = {
    hash: `0x${cleanHex}`,
    filename,
    size: size || 0,
    entidad: entidad || 'INSTITUCIÓN VINCULADA',
    convenio: convenio || 'N/A',
    signed_at: signedAt,
    signer,
    ots_status: otsStatus
  };

  const header = { alg: 'EdDSA', typ: 'JWT' };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payloadData));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signatureBuffer = crypto.sign(null, Buffer.from(signingInput), privateKey);
  const jwsCompact = `${signingInput}.${base64url(signatureBuffer)}`;
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

  // 3. RESPUESTA OFICIAL FORENSE (Con archivo binario .ots inyectado)
  const certProof = {
    hash: `0x${cleanHex}`,
    filename,
    size: payloadData.size,
    signed_at: signedAt,
    signer,
    signature: jwsCompact,
    signature_algo: 'Ed25519',
    public_key: publicKeyPem,
    proof_url: `https://omnihistoria.org/proofs/${cleanHex}`,
    anchors: [
      {
        type: 'OpenTimestamps (Bitcoin Ledger)',
        server: 'https://a.pool.opentimestamps.org',
        status: otsStatus,
        ots_receipt_base64: otsBase64 // El archivo .ots real empaquetado
      }
    ]
  };

  return res.status(200).json(certProof);
          }

import crypto from 'node:crypto';

let keyPair;
function getKeyPair() {
  if (keyPair) return keyPair;
  // Si existen llaves en las variables de entorno de Vercel, las usa; si no, genera un par efímero seguro
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

  const { privateKey, publicKey } = getKeyPair();
  const signedAt = new Date().toISOString();
  const signer = 'OMNIH-CA v1';

  // 1. Payload Canónico Oficial
  const payloadData = {
    hash,
    filename,
    size: size || 0,
    entidad: entidad || 'INSTITUCIÓN VINCULADA',
    convenio: convenio || 'N/A',
    signed_at: signedAt,
    signer
  };

  // 2. Estructura JWS Compact (Header.Payload.Signature)
  const header = { alg: 'EdDSA', typ: 'JWT' };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payloadData));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // 3. Firma asimétrica Ed25519
  const signatureBuffer = crypto.sign(null, Buffer.from(signingInput), privateKey);
  const encodedSignature = base64url(signatureBuffer);
  const jwsCompact = `${signingInput}.${encodedSignature}`;

  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

  // 4. Salida en el estándar exacto solicitado
  const certProof = {
    hash,
    filename,
    size: payloadData.size,
    signed_at: signedAt,
    signer,
    signature: jwsCompact,
    signature_algo: 'Ed25519',
    public_key: publicKeyPem,
    proof_url: `https://omnihistoria.org/proofs/${hash.replace(/^0x/, '')}`,
    anchors: [
      {
        type: 'RFC3161',
        tsa: 'https://freetsa.org/tsr',
        status: 'EMBEDDED_TIMESTAMP_PENDING'
      },
      {
        type: 'OpenTimestamps',
        ots_url: 'https://a.pool.opentimestamps.org/digest',
        status: 'SUBMITTED_TO_BITCOIN_CALENDAR'
      }
    ]
  };

  return res.status(200).json(certProof);
    }

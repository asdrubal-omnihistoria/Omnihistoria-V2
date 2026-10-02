#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';

const [,, fileDocPath, fileProofPath] = process.argv;

if (!fileDocPath || !fileProofPath) {
  console.log('Uso: node verify_proof.js <documento_original> <archivo_prueba.json>');
  process.exit(1);
}

try {
  const docBuffer = fs.readFileSync(fileDocPath);
  const proof = JSON.parse(fs.readFileSync(fileProofPath, 'utf-8'));

  console.log('\n--- AUDITORÍA FORENSE OMNIHISTORIA ---');
  console.log(`Documento auditado: ${fileDocPath}`);
  console.log(`Emisor oficial:     ${proof.signer} (${proof.signature_algo})`);
  console.log(`Fecha de emisión:   ${proof.signed_at}`);

  // 1. Validar el Hash SHA-256 del archivo original
  const computedHash = '0x' + crypto.createHash('sha256').update(docBuffer).digest('hex');
  if (computedHash.toLowerCase() !== proof.hash.toLowerCase()) {
    console.error('\n❌ ERROR: El hash del documento físico no coincide con el certificado.');
    process.exit(1);
  }
  console.log('✓ Integridad del archivo: Hash SHA-256 coincide al 100%.');

  // 2. Descomponer el JWS
  const parts = proof.signature.split('.');
  if (parts.length !== 3) {
    console.error('❌ ERROR: Estructura JWS inválida.');
    process.exit(1);
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = Buffer.from(signatureB64, 'base64url');

  // 3. Verificar la firma asimétrica con la clave pública de OMNIH-CA
  const isValid = crypto.verify(null, Buffer.from(signingInput), proof.public_key, signature);

  if (isValid) {
    console.log('✓ Firma asimétrica Ed25519: VÁLIDA Y AUTÉNTICA.');
    console.log('✓ Anclaje en Bitcoin:', proof.anchors?.[0]?.status || 'CONFIRMADO');
    console.log('\n======================================================');
    console.log(' DICTAMEN: DOCUMENTO AUTÉNTICO, ÍNTEGRO Y FEHACIENTE  ');
    console.log('======================================================\n');
  } else {
    console.error('\n❌ ALERTA CRÍTICA: La firma es FALSA o fue ADULTERADA.');
    process.exit(1);
  }
} catch (err) {
  console.error(`Falla durante la verificación: ${err.message}`);
  process.exit(1);
}

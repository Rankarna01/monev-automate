import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Mengenkripsi teks sensitif (seperti token GitHub user) menggunakan AES-256-GCM.
 */
export function encryptSecret(plainText: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Mendekripsi teks sensitif yang tersimpan di database.
 */
export function decryptSecret(cipherText: string, secret: string): string {
  const parts = cipherText.split(':');
  if (parts.length !== 3) {
    throw new Error('Format data terenkripsi tidak valid');
  }

  const [ivHex, tagHex, dataHex] = parts;
  const key = deriveKey(secret);
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

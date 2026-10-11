const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 10;

function isBcryptHash(stored) {
  return typeof stored === 'string' && /^\$2[aby]\$/.test(stored);
}

function verifyPassword(input, stored) {
  if (isBcryptHash(stored)) {
    return { valid: bcrypt.compareSync(input, stored), needsUpgrade: false };
  }
  return { valid: input === stored, needsUpgrade: input === stored };
}

function hashPassword(plain) {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

module.exports = { BCRYPT_ROUNDS, isBcryptHash, verifyPassword, hashPassword };

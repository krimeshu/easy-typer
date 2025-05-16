// 参考：https://stackoverflow.com/questions/69692842/error-message-error0308010cdigital-envelope-routinesunsupported

const crypto = require('crypto');

/**
 * The MD4 algorithm is not available anymore in Node.js 17+ (because of library SSL 3).
 * In that case, silently replace MD4 by the MD5 algorithm.
 */
try {
  console.log('Checking if crypto "MD4" is supported...')
  crypto.createHash('md4');
} catch (e) {
  console.warn('Crypto "MD4" is not supported anymore by this Node.js version');
  const origCreateHash = crypto.createHash;
  crypto.createHash = (alg, opts) => origCreateHash(alg === 'md4' ? 'md5' : alg, opts);
}

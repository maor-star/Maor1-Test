/**
 * Prints the OWNER_PASSWORD_HASH value for a password.
 *
 *   npx tsx scripts/hash-password.ts 'the password'
 *
 * The password is passed as an argument and never written anywhere.
 */
import { hashPassword } from '../lib/auth/password';

const password = process.argv[2];
if (!password) {
  console.error("usage: tsx scripts/hash-password.ts '<password>'");
  process.exit(1);
}
hashPassword(password).then((h) => {
  console.log(h);
  process.exit(0);
});

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
// Read from stdin, never command line arguments or shell history.
const prompt = createInterface({ input: process.stdin, output: process.stdout });
const password = await prompt.question('Choose an owner password (16+ characters; input is visible): ');
prompt.close();
if (password.length < 16) throw new Error('Use at least 16 characters.');
const salt = randomBytes(16).toString('hex');
console.log(`OWNER_PASSWORD_HASH=${salt}:${pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex')}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString('hex')}`);

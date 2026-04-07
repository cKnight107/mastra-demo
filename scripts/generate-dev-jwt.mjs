import { createHmac } from 'node:crypto';

const secret = process.env.MASTRA_JWT_SECRET;

if (!secret) {
  console.error('MASTRA_JWT_SECRET is missing in .env');
  process.exit(1);
}

const subject = process.argv[2] || 'user-123';
const email = process.argv[3] || `${subject}@example.com`;
const name = process.argv[4] || 'Demo User';
const now = Math.floor(Date.now() / 1000);

const header = {
  alg: 'HS256',
  typ: 'JWT',
};

const payload = {
  sub: subject,
  email,
  name,
  iat: now,
  exp: now + 7 * 24 * 60 * 60,
};

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const unsignedToken = `${encode(header)}.${encode(payload)}`;
const signature = createHmac('sha256', secret).update(unsignedToken).digest('base64url');
const token = `${unsignedToken}.${signature}`;

console.log(token);
console.log('');
console.log(`Authorization: Bearer ${token}`);

import { hash, verify } from '@node-rs/argon2';
import type { Algorithm } from '@node-rs/argon2';
import type { AppConfig } from '../config';

/** Hashing only depends on the argon2 params, so operator CLIs can pass AdminCliConfig-shaped input. */
type HashConfig = Pick<AppConfig, 'argon2'>;

function options(config: HashConfig) {
  return {
    type: 2 as Algorithm, // 2 = Argon2id; ambient const enum can't be used as a value under verbatimModuleSyntax
    memoryCost: config.argon2.memoryCost,
    timeCost: config.argon2.timeCost,
    parallelism: config.argon2.parallelism,
  };
}

export async function hashPassword(config: HashConfig, password: string): Promise<string> {
  return hash(password, options(config));
}

export async function verifyPassword(config: HashConfig, hashStr: string, password: string): Promise<boolean> {
  try {
    return await verify(hashStr, password);
  } catch {
    return false;
  }
}

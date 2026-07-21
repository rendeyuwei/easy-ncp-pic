import { hash, verify, Algorithm } from '@node-rs/argon2';
import type { AppConfig } from '../config';

function options(config: AppConfig) {
  return {
    type: Algorithm.Argon2id,
    memoryCost: config.argon2.memoryCost,
    timeCost: config.argon2.timeCost,
    parallelism: config.argon2.parallelism,
  };
}

export async function hashPassword(config: AppConfig, password: string): Promise<string> {
  return hash(password, options(config));
}

export async function verifyPassword(config: AppConfig, hashStr: string, password: string): Promise<boolean> {
  try {
    return await verify(hashStr, password);
  } catch {
    return false;
  }
}

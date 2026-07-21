import type { Migration } from '../migrate';
import { m0001_init } from './0001_init';

export const MIGRATIONS: Migration[] = [m0001_init];

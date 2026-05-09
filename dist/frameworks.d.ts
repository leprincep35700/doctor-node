import type { FrameworkSignal } from './types.js';
import { type PackageJson } from './utils.js';
export declare const detectFrameworks: (root: string, packageJson: PackageJson | undefined) => Promise<FrameworkSignal[]>;

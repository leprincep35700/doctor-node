export declare const fileExists: (path: string) => Promise<boolean>;
export declare const readJsonFile: <Value>(path: string) => Promise<Value | undefined>;
export declare const readTextFile: (path: string) => Promise<string | undefined>;
export declare const collectSourceFiles: (root: string, includeTests: boolean, maxFiles: number) => Promise<string[]>;
export declare const toPosix: (path: string) => string;
export declare const lineOf: (content: string, index: number) => number;
export declare const hasDependency: (packageJson: PackageJson | undefined, names: string[]) => boolean;
export declare const allDependencyNames: (packageJson: PackageJson | undefined) => string[];
export declare const compactPath: (root: string, path: string) => string;
export interface PackageJson {
    name?: string;
    version?: string;
    type?: string;
    packageManager?: string;
    engines?: Record<string, string>;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
}

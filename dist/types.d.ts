export type Severity = 'error' | 'warning' | 'info';
export type Category = 'architecture' | 'config' | 'dependencies' | 'framework' | 'maintainability' | 'observability' | 'performance' | 'security' | 'testing' | 'typescript';
export interface Diagnostic {
    id: string;
    title: string;
    severity: Severity;
    category: Category;
    message: string;
    suggestion: string;
    file?: string;
    line?: number;
    framework?: string;
}
export interface FrameworkSignal {
    name: string;
    confidence: number;
    reasons: string[];
}
export interface ScanOptions {
    root: string;
    json: boolean;
    minScore?: number;
    includeTests: boolean;
    maxFiles: number;
}
export interface ScanResult {
    root: string;
    score: number;
    grade: string;
    frameworks: FrameworkSignal[];
    diagnostics: Diagnostic[];
    counts: Record<Severity, number>;
    scannedFiles: number;
    packageManager?: string;
}

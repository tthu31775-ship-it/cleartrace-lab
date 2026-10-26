export type Role = 'admin' | 'editor' | 'reviewer' | 'viewer';
export type RiskLevel = 'high' | 'medium' | 'low' | 'unscored';
export type ReviewStatus = 'pending' | 'confirmed' | 'dismissed' | 'unreviewed';
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface User {
    id: string;
    name: string;
    email: string;
    role: Role;
    local?: boolean;
}
export interface Dataset {
    id: string;
    name: string;
    source: string;
    format: string;
    version: string;
    status: 'ready';
    recordCount: number;
    createdAt: string;
    description: string;
    demo: boolean;
}
export interface Account {
    id: string;
    accountId: string;
    displayName: string;
    platform: string;
    datasetId: string;
    postsCount: number;
    followersCount: number;
    followingCount: number;
    accountAgeDays: number;
    duplicateRatio: number;
    burstRatio: number;
    nightRatio: number;
    avgIntervalSeconds: number;
    relatedIds: string[];
    textSamples?: string[];
    riskScore: number | null;
    riskLevel: RiskLevel;
    reviewStatus: ReviewStatus;
    reasons: string[];
    modelVersion?: string | null;
    createdAt: string;
    demo: boolean;
}
export interface Task {
    id: string;
    name: string;
    datasetId: string;
    datasetName: string;
    modelId: string;
    modelName: string;
    threshold: number;
    status: TaskStatus;
    progress: number;
    total: number;
    processed: number;
    suspectedCount: number;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
    attempt: number;
    demo: boolean;
}
export interface Log {
    id: string;
    actor: string;
    action: string;
    target: string;
    status: 'success' | 'error';
    detail: string;
    createdAt: string;
}
export interface Member {
    id: string;
    email: string;
    name: string;
    role: Role;
    status: 'active' | 'invited';
    createdAt: string;
}
export interface Integration {
    id: string;
    name: string;
    type: 'data' | 'model' | 'api';
    status: 'ready' | 'pending';
    description: string;
    endpoint: string;
    version: string;
}
export interface GraphNode {
    id: string;
    label: string;
    riskLevel: RiskLevel;
    riskScore: number | null;
    accountId: string;
}
export interface GraphEdge {
    source: string;
    target: string;
    weight: number;
    type: string;
}
export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
    truncated: boolean;
    totalNodes: number;
}
export interface Stats {
    totalAccounts: number;
    completedTasks: number;
    pendingReviews: number;
    totalDatasets: number;
    highRiskAccounts: number;
    runningTasks: number;
    reviewedAccounts: number;
    totalTasks: number;
}
export interface TrendPoint {
    date: string;
    scanned: number;
    suspected: number;
    tasks: number;
}
export interface Distribution {
    name: string;
    key: RiskLevel;
    value: number;
    color: string;
}
export interface Bootstrap {
    user: User;
    workspace: {
        name: string;
        version: string;
        demo: boolean;
    };
    stats: Stats;
    trend: TrendPoint[];
    distribution: Distribution[];
    datasets: Dataset[];
    tasks: Task[];
    accounts: Account[];
    logs: Log[];
    integrations: Integration[];
    members: Member[];
    graph: GraphData;
}
export interface ImportResult {
    valid: boolean;
    rows: number;
    accepted: number;
    duplicateCount: number;
    errors: {
        row: number;
        message: string;
    }[];
    preview: Partial<Account>[];
    dataset?: Dataset;
}
export interface ApiResponse<T> {
    data: T;
}
export interface ApiError {
    error: {
        code: string;
        message: string;
        details?: unknown;
    };
}

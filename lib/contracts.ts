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

// ---- 协同线索 / 事件图谱(预计算批次) ----
export type LeadReviewStatus = 'pending' | 'following' | 'confirmed' | 'dismissed';
export interface CoordinationLead {
    id: string;
    runId: string;
    eventId: string;
    eventRef: string;
    sourceFile: string;
    sourceNamespace: string;
    leadNumber: number;
    representative: string;
    accountCount: number;
    commentCount: number;
    startTime: number | null;
    endTime: number | null;
    minSimilarity: number | null;
    score: number | null;
    scoreType: string;
    calibrated: boolean;
    reviewStatus: LeadReviewStatus;
    reviewNote: string;
    reviewerName: string | null;
    reviewedAt: string | null;
    createdAt: string;
}
export interface LeadMember {
    memberKey: string;
    nodeKey: string | null;
    commentCount: number;
    firstTime: number | null;
    lastTime: number | null;
    similarity: number | null;
    isRepresentative: boolean;
}
export interface LeadComment {
    uid: string;
    text: string;
    time: number | null;
    likes: number;
    node: string | null;
    rep?: boolean;
    replyTo: string | null;
}
export interface LeadDetail extends CoordinationLead {
    sourceLeadId: number;
    eventNodeCount: number;
    eventTimeMin: number | null;
    eventTimeMax: number | null;
    graphPath: string;
    members: LeadMember[];
    comments: LeadComment[];
    similarityEdges: [string, string, number | null][];
}
export interface LeadStats {
    leads: number;
    events: number;
    accounts: number;
    comments: number;
    precomputedLeads: number;
    precomputedEvents: number;
    precomputedAccounts: number;
    precomputedComments: number;
    scannedLeads: number;
    scannedRuns: number;
    pending: number;
    following: number;
    confirmed: number;
    dismissed: number;
    maxAccounts: number;
    runId: string;
    datasetVersion: string;
}
export interface LeadPage {
    items: CoordinationLead[];
    total: number;
    page: number;
    pageSize: number;
    stats: LeadStats;
}
export interface CoordinationEvent {
    id: string;
    sourceFile: string;
    sourceNamespace: string;
    eventRef: string;
    eventLine: number;
    leadCount: number;
    nodeCount: number;
    replyCount: number;
    maxAccounts: number;
    leadNodeCount: number;
    timeMin: number | null;
    timeMax: number | null;
    graphPath: string;
}
export interface GraphEdgeRecord {
    sourceKey: string;
    targetKey: string;
    edgeType: 'reply' | 'similarity';
    origin: 'observed' | 'derived';
    weight: number | null;
    leadId: string | null;
}
export interface EventDetail {
    event: CoordinationEvent;
    leads: CoordinationLead[];
    edges: GraphEdgeRecord[];
}

// ---- 评论与文本筛查(WB01) ----
export interface CommentRecord {
    id: string;
    datasetId: string | null;
    eventId: string | null;
    platform: string;
    sourceNamespace: string;
    sourceCommentKey: string;
    sourceAccountKey: string;
    authorName: string;
    content: string;
    publishTime: number | null;
    publishTimeIso: string | null;
    timePrecision: string;
    likeCount: number | null;
    likeKnown: boolean;
    ipRegion: string | null;
    sourceLocator: string;
    createdAt: string;
}
export interface CommentPrediction {
    id: string;
    commentId: string;
    runId: string;
    modelVersion: string;
    rawScore: number | null;
    threshold: number;
    label: string;
    riskLevel: string;
    confidence: string;
    evidence: Record<string, number>;
    status: string;
    error: string | null;
    createdAt: string;
    content?: string;
    sourceNamespace?: string;
    sourceCommentKey?: string;
}
export interface ScreeningItem {
    commentId: string;
    sourceCommentKey: string;
    content: string;
    status: 'ok' | 'error';
    error?: string;
    prediction?: {
        id: string;
        rawScore: number;
        threshold: number;
        label: string;
        riskLevel: string;
        confidence: string;
        evidence: Record<string, number>;
        modelVersion: string;
        runId: string;
    };
}
export interface ScreeningResult {
    runId: string;
    modelVersion: string;
    threshold: number;
    capability: 'comment_classification';
    persisted: number;
    failed: number;
    items: ScreeningItem[];
    note: string;
}
export interface ModelCapability {
    key: string;
    name: string;
    status: 'ready' | 'degraded' | 'not_ready' | 'planned';
    version: string;
    detail: string;
    contract?: string;
}
export interface ModelStatus {
    capabilities: ModelCapability[];
    wb01: {
        modelVersion: string;
        threshold: number;
        dimension: number;
        features: string;
        maxBatch: number;
        maxLength: number;
        trainSize: number | null;
        note: string;
    };
    coordination: {
        runId: string;
        leads: number;
        events: number;
        version: string;
        note: string;
    };
    dataset: {
        batch: string;
        works: number;
        comments: number;
        accounts: number;
        imported: boolean;
        timePrecision: string;
        note: string;
    };
    disclaimers: string[];
}

// ---- 协同在线扫描(coordination_scan) ----
export interface ScanParameters {
    minAccounts: number;
    windowMinutes: number;
    similarityThreshold: number;
}
export interface ScanCommentInput {
    accountId: string;
    text: string;
    publishTime: number;
    replyTo?: string | null;
    likeCount?: number | null;
    metadata?: Record<string, unknown>;
}
export interface ScanLeadAccount {
    accountId: string;
    commentCount: number;
    meanSimilarity: number;
    suspectedWaterArmyProbability: number;
    calibrated: false;
    scoreType: 'heuristic';
    scoreBreakdown: {
        textSimilarity: number;
        participation: number;
        timeConcentration: number;
        weights: Record<string, number>;
    };
    evidenceComments: string[];
}
export interface ScanLead {
    id: string;
    leadNumber: number;
    representative: string;
    accountCount: number;
    commentCount: number;
    startTime: number;
    endTime: number;
    minSimilarity: number;
    probability: number;
    calibrated: false;
    scoreType: 'heuristic';
    scoreBreakdown: Record<string, number | Record<string, number>>;
    accounts: ScanLeadAccount[];
    graphPath: string;
}
export interface ScanResult {
    runId: string;
    eventId: string;
    internalEventId: string;
    modelVersion: string;
    preprocessingVersion: string;
    parameters: ScanParameters;
    inputCommentCount: number;
    retainedCommentCount: number;
    skipped: Record<string, number>;
    leadCount: number;
    accounts: number;
    leads: ScanLead[];
    persisted: boolean;
    note: string;
}

// ---- 数据导出 ----
export interface ExportTable {
    key: string;
    label: string;
    rows: number;
    description: string;
    sensitive: boolean;
}
export interface ExportSummary {
    tables: ExportTable[];
    databaseBytes: number;
    generatedAt: string;
    notes: string[];
}

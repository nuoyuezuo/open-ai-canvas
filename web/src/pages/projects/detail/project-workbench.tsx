import { lazy, Suspense, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App } from "antd";
import { ArrowLeft, Plus } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { ProjectRouteBaseContext, projectRoute } from "@/lib/project-route-base";
import { ProjectWorkflowProfileContext, type ProjectWorkflowProfile } from "@/lib/project-workflow-profile";
import { getProjectCore, getProjectOverview, getProjectUnitWorkspace, linkCanvasUnit, listProjectUnits, type ProjectDetail } from "@/services/api/projects";

import { WorkflowChapterNavigator } from "./workflow-chapter-navigator";

const ProjectAssetsView = lazy(() => import("./assets"));
const ProjectCanvasesView = lazy(() => import("./canvases"));
const ProjectChaptersView = lazy(() => import("./chapters"));
const ProjectOverviewView = lazy(() => import("./overview"));
const ProjectSettingsView = lazy(() => import("./settings"));
const ProjectWorkflowView = lazy(() => import("./workflow"));
const ProjectEditorView = lazy(() => import("./editor"));

/** 视图默认走工作台内置实现；提供 render 时由模块自行渲染。 */
export type ProjectWorkbenchView = {
    key: string;
    label: string;
    render?: ProjectWorkbenchRenderView;
};

export type ProjectWorkbenchContext = {
    projectId: string;
    view: string;
    chapterId?: string;
    unitId?: string;
    stage?: string;
    detail: ProjectDetail;
    refreshProject: () => void;
    onCreateCanvas: () => void;
};

/** 复用同一套项目数据与外壳，由调用方决定每个视图渲染什么。 */
export type ProjectWorkbenchRenderView = (context: ProjectWorkbenchContext) => ReactNode;

export type ProjectWorkflowStageContext = {
    stage: string;
    unitId: string;
    projectId: string;
    detail: ProjectDetail;
};

/** 模块自有的非生产阶段渲染；未提供时由工作台内置阶段接管。 */
export type ProjectWorkflowStageRender = (context: ProjectWorkflowStageContext) => ReactNode;

type Props = {
    profile: ProjectWorkflowProfile;
    routeBase: string;
    views: ProjectWorkbenchView[];
    /** 返回列表的入口，漫画模块回到 /comic。 */
    listHref: string;
    listLabel: string;
    /** 模块自有的非生产阶段渲染；未提供时由工作台内置阶段接管。 */
    renderWorkflowStage?: ProjectWorkflowStageRender;
};

const sharedViewKeys = new Set(["overview", "chapters", "workflow", "canvases", "editor", "assets", "settings"]);

export default function ProjectWorkbench({ profile, routeBase, views, listHref, listLabel, renderWorkflowStage }: Props) {
    const { projectId = "", view, chapterId, unitId, stage } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const activeView = unitId || view === "workflow" ? "workflow" : chapterId ? "chapters" : views.some((item) => item.key === view) ? view as string : views[0]?.key || "overview";
    const coreQuery = useQuery({
        queryKey: ["project", projectId, "core"],
        queryFn: () => getProjectCore(projectId),
        enabled: Boolean(projectId),
        refetchOnMount: "always",
    });
    const unitsQuery = useQuery({ queryKey: ["project", projectId, "units"], queryFn: () => listProjectUnits(projectId), enabled: Boolean(projectId) });
    const units = unitsQuery.data?.units || [];
    const firstUnitId = units.slice().sort((left, right) => left.position - right.position)[0]?.id || "";
    const requestedUnitId = chapterId || unitId || "";
    const activeUnitId = units.some((unit) => unit.id === requestedUnitId) ? requestedUnitId : firstUnitId;
    const overviewQuery = useQuery({ queryKey: ["project", projectId, "overview"], queryFn: () => getProjectOverview(projectId), enabled: Boolean(projectId) && activeView === "overview" });
    const workspaceQuery = useQuery({
        queryKey: ["project", projectId, "unit-workspace", activeUnitId],
        queryFn: () => getProjectUnitWorkspace(projectId, activeUnitId),
        enabled: Boolean(projectId && activeUnitId) && (activeView === "chapters" || activeView === "workflow"),
        refetchInterval: (query) => (query.state.data?.tasks || []).some((task) => task.clientContext?.shotId && (task.status === "queued" || task.status === "running")) ? 2_000 : false,
    });
    const project = coreQuery.data?.project;
    const workspace = workspaceQuery.data;
    const detail: ProjectDetail | undefined = project ? {
        project,
        units: workspace?.unit ? units.map((unit) => unit.id === workspace.unit.id ? workspace.unit : unit) : units,
        canvases: [],
        canvasUnitLinks: [],
        unitCanvasCounts: unitsQuery.data?.canvasCounts || {},
        assets: workspace?.assets || [],
        assetFolders: [],
        workflows: workspace?.workflows || [],
        shots: workspace?.shots || [],
        shotRevisions: workspace?.shotRevisions || [],
        shotArtifacts: workspace?.shotArtifacts || [],
        shotReferences: workspace?.shotReferences || [],
        assetCandidates: workspace?.assetCandidates || [],
        tasks: workspace?.tasks || [],
    } : undefined;
    const refreshProject = () => { void queryClient.invalidateQueries({ queryKey: ["project", projectId] }); void queryClient.invalidateQueries({ queryKey: ["projects"] }); };
    const createCanvas = async () => {
        if (detail?.project.status === "archived") { message.warning("项目已归档，请先在项目设置中恢复"); return; }
        const activeChapterId = chapterId || sessionStorage.getItem(`project-active-chapter:${projectId}`) || "";
        const unit = activeView === "chapters"
            ? detail?.units.find((item) => item.id === activeChapterId) || detail?.units.slice().sort((left, right) => left.position - right.position)[0]
            : undefined;
        const shots = unit ? detail?.shots.filter((shot) => shot.unitId === unit.id) || [] : [];
        try {
            const [{ createCanvasProjectWithRemoteSync }, storyboard] = await Promise.all([
                import("@/services/user-data-sync"),
                unit && shots.length ? import("@/lib/canvas/project-chapter-storyboard") : Promise.resolve(null),
            ]);
            const seed = unit && shots.length ? storyboard?.upsertProjectChapterStoryboard([], [], { unit, shots }) : undefined;
            const initialContent = seed ? { nodes: seed.nodes, connections: seed.connections } : undefined;
            const boardLabel = profile.id === "comic" ? "分格画布" : "分镜画布";
            const title = unit ? `${unit.title} · ${shots.length ? boardLabel : "画布"}` : `${detail?.project.name || "项目"} · 新画布`;
            const { id, syncError } = await createCanvasProjectWithRemoteSync(title, projectId, initialContent);
            if (syncError) {
                message.warning(syncError instanceof Error ? `画布已保存在本地，项目关联稍后重试：${syncError.message}` : "画布已保存在本地，项目关联稍后重试");
                navigate(`/canvas/${id}`);
                return;
            }
            if (unit) {
                try {
                    await linkCanvasUnit(projectId, { canvasId: id, unitId: unit.id, role: "storyboard" });
                } catch (error) {
                    refreshProject();
                    message.error(error instanceof Error ? `画布已创建，但章节关联失败：${error.message}` : "画布已创建，但章节关联失败");
                    return;
                }
            }
            refreshProject();
            message.success(unit && shots.length ? `已创建章节画布并导入 ${shots.length} 个${profile.unitItemLabel}` : unit ? "章节画布已创建并关联" : "项目画布已创建");
            navigate(`/canvas/${id}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "画布创建失败");
        }
    };
    const chapterHref = detail ? projectChapterHref(routeBase, detail.units, projectId, chapterId) : projectRoute(routeBase, projectId, "chapters");
    const workflowHref = detail ? projectWorkflowHref(routeBase, detail.units, projectId, unitId, stage, profile.defaultStage) : projectRoute(routeBase, projectId, "workflow");
    if (coreQuery.isLoading || unitsQuery.isLoading) return <WorkspacePage><WorkspaceLoadingState label="正在打开项目工作台" detail="读取项目与章节索引" /></WorkspacePage>;
    if (coreQuery.isError || unitsQuery.isError || !detail) return <WorkspacePage><WorkspaceErrorState title="项目不可用" description="项目不存在、已被删除，或当前账号没有访问权限。" actionLabel="返回项目中心" onRetry={() => navigate(listHref)} /></WorkspacePage>;
    const defaultViewKey = views[0]?.key || "overview";
    if (!chapterId && !unitId && (!view || !views.some((item) => item.key === view))) return <Navigate to={projectRoute(routeBase, projectId, defaultViewKey)} replace />;
    if (chapterId && !units.some((unit) => unit.id === chapterId)) return <Navigate to={firstUnitId ? projectRoute(routeBase, projectId, "chapters", firstUnitId) : projectRoute(routeBase, projectId, "chapters")} replace />;
    if (unitId && !units.some((unit) => unit.id === unitId)) return <Navigate to={firstUnitId ? projectRoute(routeBase, projectId, "workflow", firstUnitId, stage || profile.defaultStage) : projectRoute(routeBase, projectId, "workflow")} replace />;
    if (activeView === "workflow" && !unitId && detail.units.length) return <Navigate to={projectRoute(routeBase, projectId, "workflow", detail.units.slice().sort((left, right) => left.position - right.position)[0].id, stage || profile.defaultStage)} replace />;
    const context: ProjectWorkbenchContext = { projectId, view: activeView, chapterId, unitId, stage, detail, refreshProject, onCreateCanvas: createCanvas };
    const customRender = views.find((item) => item.key === activeView)?.render;
    const fullHeight = activeView === "chapters" || activeView === "workflow" || activeView === "editor";
    return (
        <ProjectWorkbenchProviders profile={profile} routeBase={routeBase}>
            <WorkspacePage className="project-workbench-page !overflow-hidden" fluid>
                <div className="flex h-full min-h-0 flex-col">
                    <ProjectWorkspaceHeader
                        detail={detail}
                        projectId={projectId}
                        activeView={activeView}
                        views={views}
                        routeBase={routeBase}
                        listHref={listHref}
                        listLabel={listLabel}
                        unitId={unitId}
                        stage={stage}
                        defaultStage={profile.defaultStage}
                        chapterHref={chapterHref}
                        workflowHref={workflowHref}
                        onCreateCanvas={createCanvas}
                    />
                    {detail.project.status === "archived" ? <Alert type="warning" showIcon banner message="项目已归档，恢复后才能创建画布和生成任务" className="!border-x-0 !border-t-0" /> : null}
                    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                        <div className={fullHeight ? "min-h-0 flex-1" : "thin-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-5 lg:px-8 lg:py-7"}>
                            <Suspense fallback={<WorkspaceLoadingState label="正在准备当前项目视图" detail="只加载当前使用的工作区模块" />}>
                                <div className={activeView === "overview" ? "w-full" : fullHeight ? "h-full w-full" : "w-full"}>
                                    {!customRender && sharedViewKeys.has(activeView) ? (
                                        <>
                                            {activeView === "overview" ? overviewQuery.isLoading ? <WorkspaceLoadingState label="正在统计制作进度" detail="只读取聚合数据，不加载全部镜头历史" /> : overviewQuery.data ? <ProjectOverviewView detail={detail} overview={overviewQuery.data} refreshProject={refreshProject} onCreateCanvas={createCanvas} /> : <WorkspaceErrorState title="制作概览读取失败" description="请稍后重试。" onRetry={() => void overviewQuery.refetch()} /> : null}
                                            {activeView === "chapters" ? workspaceQuery.isLoading ? <WorkspaceLoadingState label="正在读取当前章节" detail="正文与制作数据按章节加载" /> : workspaceQuery.isError ? <WorkspaceErrorState title="章节读取失败" description="当前章节可能已被删除，或服务暂时不可用。" onRetry={() => void workspaceQuery.refetch()} /> : <ProjectChaptersView detail={detail} refreshProject={refreshProject} onCreateCanvas={createCanvas} /> : null}
                                            {activeView === "workflow" ? workspaceQuery.isLoading ? <WorkspaceLoadingState label={`正在读取当前章节${profile.unitItemLabel}`} detail={`仅加载本章${profile.unitItemLabel}、版本和产物`} /> : workspaceQuery.isError ? <WorkspaceErrorState title="制作工作区读取失败" description="当前章节制作数据暂时不可用。" onRetry={() => void workspaceQuery.refetch()} /> : <ProjectWorkflowView detail={detail} projectId={projectId} unitId={unitId || ""} stage={stage || profile.defaultStage} profile={profile} routeBase={routeBase} renderStage={renderWorkflowStage ? (stageKey, unitKey) => renderWorkflowStage({ stage: stageKey, unitId: unitKey, projectId, detail }) : undefined} /> : null}
                                            {activeView === "canvases" ? <ProjectCanvasesView detail={detail} refreshProject={refreshProject} onCreateCanvas={createCanvas} /> : null}
                                            {activeView === "assets" ? <ProjectAssetsView detail={detail} refreshProject={refreshProject} onCreateCanvas={createCanvas} /> : null}
                                            {activeView === "settings" ? <ProjectSettingsView detail={detail} refreshProject={refreshProject} onCreateCanvas={createCanvas} /> : null}
                                            {activeView === "editor" ? <ProjectEditorView detail={detail} /> : null}
                                        </>
                                    ) : customRender ? customRender(context) : null}
                                </div>
                            </Suspense>
                        </div>
                    </main>
                </div>
            </WorkspacePage>
        </ProjectWorkbenchProviders>
    );
}

/** 工作台内的阶段语义与路由前缀都按入口不同，统一在这里注入，避免各视图硬编码。 */
function ProjectWorkbenchProviders({ profile, routeBase, children }: { profile: ProjectWorkflowProfile; routeBase: string; children: ReactNode }) {
    return (
        <ProjectWorkflowProfileContext.Provider value={profile}>
            <ProjectRouteBaseContext.Provider value={routeBase}>{children}</ProjectRouteBaseContext.Provider>
        </ProjectWorkflowProfileContext.Provider>
    );
}

function ProjectWorkspaceHeader({ detail, projectId, activeView, views, routeBase, listHref, listLabel, unitId, stage, defaultStage, chapterHref, workflowHref, onCreateCanvas }: { detail: ProjectDetail; projectId: string; activeView: string; views: ProjectWorkbenchView[]; routeBase: string; listHref: string; listLabel: string; unitId?: string; stage?: string; defaultStage: string; chapterHref: string; workflowHref: string; onCreateCanvas: () => void }) {
    const archived = detail.project.status === "archived";
    const createCanvasLabel = activeView === "chapters" && detail.units.length ? "新建当前章节画布" : "新建项目画布";
    return (
        <header className="project-workspace-header">
            <div className="project-workspace-identity">
                <Link to={listHref} className="project-workspace-back" aria-label={listLabel}>
                    <ArrowLeft />
                    <span className="sr-only">返回</span>
                </Link>
                <div className="project-workspace-title">
                    <h1 title={detail.project.name}>{detail.project.name}</h1>
                    <span className={`project-workspace-status ${archived ? "is-archived" : "is-active"}`}>{archived ? "已归档" : "进行中"}</span>
                </div>
            </div>
            <nav className="project-workspace-tabs" aria-label="项目导航">
                {views.map((item) => {
                    const active = item.key === activeView;
                    const href = item.key === "chapters" ? chapterHref : item.key === "workflow" ? workflowHref : projectRoute(routeBase, projectId, item.key);
                    return (
                        <Link
                            key={item.key}
                            to={href}
                            aria-current={active ? "page" : undefined}
                            className={`project-workspace-tab ${active ? "is-active" : ""}`}
                        >
                            {item.label}
                        </Link>
                    );
                })}
            </nav>
            <div className="project-workspace-actions">
                {activeView === "workflow" ? (
                    <WorkflowChapterNavigator projectId={projectId} units={detail.units} unitId={unitId} stage={stage} defaultStage={defaultStage} />
                ) : (
                    <button type="button" onClick={onCreateCanvas} className="project-workspace-create" aria-label={createCanvasLabel} title={createCanvasLabel}>
                        <Plus />
                        <span>新建画布</span>
                    </button>
                )}
            </div>
        </header>
    );
}

function projectWorkflowHref(routeBase: string, units: Array<{ id: string; position: number }>, projectId: string, routeUnitId?: string, routeStage?: string, defaultStage = "storyboard") {
    const targetId = [routeUnitId, sessionStorage.getItem(`project-active-chapter:${projectId}`) || ""].find((id) => id && units.some((unit) => unit.id === id)) || units.slice().sort((left, right) => left.position - right.position)[0]?.id;
    return targetId ? projectRoute(routeBase, projectId, "workflow", targetId, routeStage || defaultStage) : projectRoute(routeBase, projectId, "workflow");
}

function projectChapterHref(routeBase: string, units: Array<{ id: string; position: number }>, projectId: string, routeChapterId?: string) {
    const rememberedId = sessionStorage.getItem(`project-active-chapter:${projectId}`) || "";
    const targetId = [routeChapterId, rememberedId].find((id) => id && units.some((unit) => unit.id === id)) || units.slice().sort((left, right) => left.position - right.position)[0]?.id;
    return targetId ? projectRoute(routeBase, projectId, "chapters", targetId) : projectRoute(routeBase, projectId, "chapters");
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, Modal, Select } from "antd";
import { ArrowRight, BookImage, BookOpenText, FileText, FolderKanban, Images, LayoutGrid, Palette, Plus, Search, Sparkles } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { CanvasStylePickerModal, resolveCanvasStylePreset, resolveProjectCanvasStyle, type CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { CollectionToolbar } from "@/components/layout/collection-toolbar";
import { CollectionGrid, PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { DeleteButton } from "@/components/ui/base/buttons/delete-button";
import { MediaPlaceholder } from "@/components/ui/product/media-placeholder";
import { createStyleProfileSnapshot, parseStyleProfile, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { projectSummaryCompletion, projectSummaryStage } from "@/lib/project-workbench";
import { createProject, deleteProject, listProjects, type ProjectSummary } from "@/services/api/projects";
import { resourceFileUrl } from "@/services/api/resources";

import { sourceTypeLabel } from "@/pages/projects/detail/shared";

import { NovelAdaptationModal } from "./novel-adaptation-modal";

type ComicProjectForm = { name: string; aspectRatio: string; sourceType: string };

export default function ComicProjectsPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const [createForm] = Form.useForm<ComicProjectForm>();
    const [searchParams, setSearchParams] = useSearchParams();
    const [keyword, setKeyword] = useState("");
    const [status, setStatus] = useState<"all" | "active" | "archived">("all");
    const [sort, setSort] = useState<"updated" | "progress" | "name">("updated");
    const [createSource, setCreateSource] = useState<"blank" | "novel" | "text">("blank");
    const [selectedStyle, setSelectedStyle] = useState<CanvasStylePreset | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const [adaptationOpen, setAdaptationOpen] = useState(false);
    const createOpen = searchParams.get("create") === "1";
    const setCreateOpen = (open: boolean) => {
        const next = new URLSearchParams(searchParams);
        if (open) next.set("create", "1");
        else next.delete("create");
        setSearchParams(next, { replace: true });
    };
    const openCreate = (source: "blank" | "novel" | "text") => {
        setCreateSource(source);
        setCreateOpen(true);
    };
    useEffect(() => {
        if (!createOpen) return;
        createForm.setFieldsValue({ name: "", sourceType: createSource, aspectRatio: "3:4" });
    }, [createForm, createOpen, createSource]);

    const loadMoreRef = useRef<HTMLDivElement>(null);
    const query = useInfiniteQuery({
        // 漫画入口只列漫画项目，缓存键必须带上类型，否则会和短剧列表互相覆盖。
        queryKey: ["projects", "paged", "comic"],
        queryFn: ({ pageParam }) => listProjects({ page: pageParam, pageSize: 50, type: "comic" }),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    });
    const mutation = useMutation({
        mutationFn: createProject,
        onSuccess: ({ project }) => {
            setCreateOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            navigate(`/comic/${project.id}/overview`);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "项目创建失败"),
    });
    const deleteMutation = useMutation({
        mutationFn: deleteProject,
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            message.success("项目已删除");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "项目删除失败"),
    });
    const allProjects = useMemo(() => query.data?.pages.flatMap((page) => page.projects) || [], [query.data]);
    const rows = useMemo(() => {
        const normalizedKeyword = keyword.trim().toLowerCase();
        return [...allProjects]
            .filter(({ project }) => status === "all" || project.status === status)
            .filter(({ project }) => !normalizedKeyword || `${project.name} ${project.description} ${parseStyleProfile(project.styleProfileJson)?.title || resolveCanvasStylePreset(project.stylePresetId)?.title || ""}`.toLowerCase().includes(normalizedKeyword))
            .sort((left, right) => {
                if (sort === "name") return left.project.name.localeCompare(right.project.name, "zh-CN");
                if (sort === "progress") return projectSummaryCompletion(right) - projectSummaryCompletion(left);
                return right.project.updatedAt.localeCompare(left.project.updatedAt);
            });
    }, [allProjects, keyword, sort, status]);
    const totalProjectCount = query.data?.pages[0]?.total ?? allProjects.length;
    useEffect(() => {
        const node = loadMoreRef.current;
        if (!node || !query.hasNextPage || query.isError) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry?.isIntersecting && !query.isFetchingNextPage) void query.fetchNextPage();
            },
            { rootMargin: "600px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [query.fetchNextPage, query.hasNextPage, query.isError, query.isFetchingNextPage]);
    const hasInitialError = query.isError && !query.data;
    return (
        <WorkspacePage className="library-page project-library-page" grid>
            <PageHeader title="漫画创作" description="原著改编、分格脚本与成稿画面，都在这里。" meta={<span className="app-projects-header-meta">{totalProjectCount} 个项目</span>} />
            <details className="story-launcher-panel" aria-label="开始一部新漫画">
                <summary className="story-launcher-head">
                    <div className="story-launcher-title">
                        <span className="story-launcher-mark"><BookImage className="size-4" /></span>
                        <div>
                            <h2>开始一部新漫画</h2>
                            <p>检索并改编现有小说，也可以上传自备文本或从空白开始</p>
                        </div>
                    </div>
                    <span className="story-launcher-expand"><Plus className="size-4" /><span>展开创作</span></span>
                </summary>
                <div className="story-launcher-actions">
                    <Button icon={<FolderKanban />} onClick={() => openCreate("blank")}>空白项目</Button>
                    <Button icon={<FileText />} onClick={() => openCreate("novel")}>上传自备文本</Button>
                    <Button icon={<Palette />} onClick={() => setStylePickerOpen(true)}>{selectedStyle ? "更换画风" : "选画风"}</Button>
                    <Button type="default" icon={<Sparkles className="size-3.5" />} onClick={() => setAdaptationOpen(true)}>小说改编</Button>
                    <Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => openCreate(createSource)}>开始创作</Button>
                </div>
            </details>
            <CollectionToolbar active={Boolean(keyword || status !== "all" || sort !== "updated")} onReset={() => { setKeyword(""); setStatus("all"); setSort("updated"); }}>
                <Input allowClear className="app-list-search" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="搜索项目、简介或画风" onChange={(event) => setKeyword(event.target.value)} />
                <Select className="w-32" value={status} onChange={setStatus} options={[{ label: "全部状态", value: "all" }, { label: "进行中", value: "active" }, { label: "已归档", value: "archived" }]} />
                <Select className="w-32" value={sort} onChange={setSort} options={[{ label: "最近更新", value: "updated" }, { label: "章节进度", value: "progress" }, { label: "项目名称", value: "name" }]} />
            </CollectionToolbar>

            {hasInitialError ? <WorkspaceErrorState description={query.error instanceof Error ? query.error.message : "漫画项目加载失败"} onRetry={() => void query.refetch()} /> : null}
            {query.isLoading ? <WorkspaceLoadingState label="正在整理漫画项目" detail="读取章节、画布与资产进度" /> : null}
            {!query.isLoading && !hasInitialError && rows.length ? (
                <CollectionGrid className="library-grid project-library-grid">
                    {rows.map((row) => <ComicProjectRow key={row.project.id} row={row} onDelete={() => deleteMutation.mutateAsync(row.project.id)} />)}
                </CollectionGrid>
            ) : null}
            {!query.isLoading && !hasInitialError ? <div ref={loadMoreRef} className="library-load-more" aria-live="polite">
                {query.isFetchingNextPage ? "正在加载更多项目…" : query.isError ? <button type="button" onClick={() => void query.fetchNextPage()}>加载更多失败，点击重试</button> : query.hasNextPage ? "继续下滑加载更多（每页 50 条）" : allProjects.length ? `已加载全部 ${totalProjectCount} 个项目` : null}
            </div> : null}
            {!query.isLoading && !rows.length && !hasInitialError ? (
                <WorkspaceState
                    icon="projects"
                    title={keyword || status !== "all" ? "没有匹配的项目" : "创建第一部漫画项目"}
                    description={keyword || status !== "all" ? "调整搜索词或状态筛选后再试。" : "漫画项目按章节保存原著正文、分格脚本、画格成稿与角色资产。"}
                    action={!keyword && status === "all" ? <Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => openCreate("blank")}>创建项目</Button> : undefined}
                />
            ) : null}

            <Modal className="library-modal" title="创建漫画项目" open={createOpen} footer={null} destroyOnHidden onCancel={() => setCreateOpen(false)} width={560} styles={{ body: { paddingTop: 12 } }}>
                <Form<ComicProjectForm> form={createForm} layout="vertical" initialValues={{ aspectRatio: "3:4", sourceType: "blank" }} onFinish={(values) => mutation.mutate({ ...values, type: "comic", ...(selectedStyle ? { stylePresetId: selectedStyle.id, styleProfileJson: serializeStyleProfile(selectedStyle.profile || createStyleProfileSnapshot(selectedStyle)) } : {}) })}>
                    <div className="mb-4 grid grid-cols-3 gap-2">
                        <button type="button" className={createSource === "blank" ? "app-story-source is-active" : "app-story-source"} onClick={() => { setCreateSource("blank"); createForm.setFieldValue("sourceType", "blank"); }}><FolderKanban className="size-4" /><span>空白开始</span></button>
                        <button type="button" className={createSource === "novel" ? "app-story-source is-active" : "app-story-source"} onClick={() => { setCreateSource("novel"); createForm.setFieldValue("sourceType", "novel"); }}><FileText className="size-4" /><span>自备文本</span></button>
                        <button type="button" className={createSource === "text" ? "app-story-source is-active" : "app-story-source"} onClick={() => { setCreateSource("text"); createForm.setFieldValue("sourceType", "text"); }}><BookOpenText className="size-4" /><span>粘贴文本</span></button>
                    </div>
                    <Form.Item name="name" label="项目名称" rules={[{ required: true, whitespace: true, message: "请输入项目名称" }]}><Input autoFocus placeholder="例如：雾港信使" /></Form.Item>
                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="aspectRatio" label="默认画幅"><Select options={[{ label: "3:4 竖版单行本", value: "3:4" }, { label: "9:16 条漫", value: "9:16" }, { label: "1:1 方形", value: "1:1" }]} /></Form.Item>
                        <Form.Item name="sourceType" label="内容来源"><Select options={[{ label: "空白开始", value: "blank" }, { label: "自备文本", value: "novel" }, { label: "粘贴文本", value: "text" }]} /></Form.Item>
                    </div>
                    <Form.Item label="漫画画风"><button type="button" className="app-story-modal-style" onClick={() => setStylePickerOpen(true)}>{selectedStyle ? <><img src={selectedStyle.imageUrl} alt="" /><span>{selectedStyle.title}</span><em>更换</em></> : <><Palette className="size-4" /><span>选择漫画画风（可选）</span></>}</button></Form.Item>
                    <p className="-mt-1 mb-5 text-xs leading-5 text-foreground/48">创建后先进入项目概览。原著、画风和角色资产可以逐步补充。</p>
                    <div className="flex justify-end gap-2"><Button onClick={() => setCreateOpen(false)}>取消</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>创建项目</Button></div>
                </Form>
            </Modal>
            <CanvasStylePickerModal
                open={stylePickerOpen}
                value={selectedStyle?.id}
                onClose={() => setStylePickerOpen(false)}
                onSelect={(preset) => { setSelectedStyle(preset); setStylePickerOpen(false); }}
            />
            <NovelAdaptationModal
                open={adaptationOpen}
                stylePreset={selectedStyle}
                onClose={() => setAdaptationOpen(false)}
                onCreated={(projectId, firstUnitId) => {
                    setAdaptationOpen(false);
                    void queryClient.invalidateQueries({ queryKey: ["projects"] });
                    navigate(firstUnitId ? `/comic/${projectId}/chapters/${firstUnitId}` : `/comic/${projectId}/overview`);
                }}
            />
        </WorkspacePage>
    );
}

function ComicProjectRow({ row, onDelete }: { row: ProjectSummary; onDelete: () => Promise<unknown> }) {
    const completion = projectSummaryCompletion(row);
    const stage = projectSummaryStage(row);
    const projectStyle = resolveProjectCanvasStyle(row.project.stylePresetId, row.project.styleProfileJson);
    const styleTitle = projectStyle?.title || parseStyleProfile(row.project.styleProfileJson)?.title || resolveCanvasStylePreset(row.project.stylePresetId)?.title || (row.project.stylePresetId ? "自定义画风" : "未设置画风");
    const coverUrl = row.project.coverResourceId ? resourceFileUrl(row.project.coverResourceId) : projectStyle?.imageUrl;
    return (
        <Link to={`/comic/${row.project.id}/overview`} className="product-collection-card library-card project-library-card group">
            <span className="project-library-cover">
                {coverUrl ? <CachedResourceImage className="project-library-cover-art" src={coverUrl} alt="" fallback={<MediaPlaceholder failed />} /> : <MediaPlaceholder label="故事由此开始" />}
                <span className="project-library-cover-scrim" />
                <span className="project-library-cover-ratio">{row.project.aspectRatio}</span>
                <span className="project-library-cover-stage">{stage.label}</span>
                <span className="project-collection-delete"><DeleteButton label={`删除项目 ${row.project.name}`} description="项目章节、画布关联和素材归属将一并移除；独立画布与素材库原始素材会保留。此操作不可撤销。" onConfirm={onDelete} /></span>
            </span>
            <span className="project-library-body">
                <span className="project-library-heading"><strong title={row.project.name}>{row.project.name}</strong>{row.project.status === "archived" ? <em>已归档</em> : null}<ArrowRight className="project-library-arrow size-4" /></span>
                <span className="project-library-subtitle">{styleTitle} · {sourceTypeLabel(row.project.sourceType)}</span>
                <span className="project-library-progress"><span><span>{row.completedUnitCount}/{row.unitCount} 章</span><span>{completion}%</span></span><i><b style={{ width: `${completion}%` }} /></i></span>
                <span className="project-library-stats"><ProjectCount icon={<BookOpenText className="size-3.5" />} label="章节" value={row.unitCount} /><ProjectCount icon={<LayoutGrid className="size-3.5" />} label="画布" value={row.canvasCount} /><ProjectCount icon={<Images className="size-3.5" />} label="资产" value={row.assetCount} /></span>
            </span>
        </Link>
    );
}

function ProjectCount({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
    return <span className="inline-flex items-center gap-1.5" title={`${value} ${label}`}><span className="text-foreground/32">{icon}</span><strong className="font-medium tabular-nums text-foreground/65">{value}</strong><span>{label}</span></span>;
}

import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button } from "antd";
import { EmptyState } from "@/components/ui/product/empty-state";
import { Link } from "react-router";

import { formatShotOrdinal } from "@/lib/shot-label";
import { projectRoute } from "@/lib/project-route-base";
import { isProductionStage, workflowStage, type ProjectWorkflowProfile } from "@/lib/project-workflow-profile";
import { saveProjectShot, type ProjectDetail } from "@/services/api/projects";

import { AssetsStage, DeliveryStage, StoryStage } from "./workflow-stage-views";
import "./workflow.css";

const WorkflowProductionWorkbench = lazy(() => import("./workflow-production-workbench"));

type Props = {
    detail: ProjectDetail;
    projectId: string;
    unitId: string;
    stage: string;
    profile: ProjectWorkflowProfile;
    routeBase: string;
    /** 模块自有的非生产阶段（例如漫画的「分格脚本」）；返回 null 时走内置实现。 */
    renderStage?: (stage: string, unitId: string, detail: ProjectDetail) => ReactNode;
};

export default function ProjectWorkflowView({ detail, projectId, unitId, stage, profile, routeBase, renderStage }: Props) {
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const orderedUnits = useMemo(() => detail.units.slice().sort((left, right) => left.position - right.position), [detail.units]);
    const unit = orderedUnits.find((item) => item.id === unitId) || orderedUnits[0];
    const activeStage = workflowStage(profile, stage) ? stage : profile.defaultStage;
    const shots = useMemo(() => (detail.shots || []).filter((item) => item.unitId === unit?.id).slice().sort((left, right) => left.position - right.position), [detail.shots, unit?.id]);
    // 工作流实例按 profile 的阶段集合识别，避免把短剧的 previz 阶段当成漫画的判定依据。
    const workflow = useMemo(() => (detail.workflows || []).find((item) => item.instance?.unitId === unit?.id && (item.steps || []).some((step) => workflowStage(profile, step.stepKey))), [detail.workflows, profile, unit?.id]);
    const rememberedShotId = sessionStorage.getItem(`project-workflow-selected-shot:${projectId}`) || "";
    const [selectedShotId, setSelectedShotId] = useState(rememberedShotId);
    const selectedShot = shots.find((item) => item.id === selectedShotId) || shots[0];
    const activeStep = workflow?.steps?.find((item) => item.stepKey === activeStage);
    const productionStage = isProductionStage(profile, activeStage);
    const stageDefinition = workflowStage(profile, activeStage);
    const itemLabel = profile.unitItemLabel;

    useEffect(() => {
        if (!selectedShot) return;
        if (selectedShot.id !== selectedShotId) setSelectedShotId(selectedShot.id);
        sessionStorage.setItem(`project-workflow-selected-shot:${projectId}`, selectedShot.id);
    }, [projectId, selectedShot, selectedShotId]);

    const refresh = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
            queryClient.invalidateQueries({ queryKey: ["projects"] }),
        ]);
    };
    const addShot = useMutation({
        mutationFn: () => {
            if (!unit) throw new Error("请先添加章节");
            return saveProjectShot(projectId, {
                unitId: unit.id,
                title: formatShotOrdinal(shots.length),
                description: `待补充${itemLabel}画面`,
                position: shots.length,
                durationMs: 3000,
                revision: { plotDescription: `待补充${itemLabel}画面`, durationMs: 3000 },
            });
        },
        onSuccess: async ({ shot }) => {
            setSelectedShotId(shot.id);
            sessionStorage.setItem(`project-workflow-selected-shot:${projectId}`, shot.id);
            await refresh();
            message.success(`已新增${itemLabel}`);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : `新增${itemLabel}失败`),
    });
    if (!unit) {
        return <div className="grid h-full place-items-center"><EmptyState title={`先添加一个章节，再进入${profile.id === "comic" ? "漫画" : "分镜"}制作`} action={<Link to={projectRoute(routeBase, projectId, "chapters")}><Button type="primary">添加章节</Button></Link>} /></div>;
    }

    const customStage = renderStage?.(activeStage, unit.id, detail);
    return (
        <div className="workflow-page-root">
            <main className={`workflow-stage-content ${productionStage ? "is-production" : ""}`}>
                {customStage}
                {activeStage === "story" ? <div className="workflow-overview-scroll thin-scrollbar"><StoryStage detail={detail} projectId={projectId} unitId={unit.id} routeBase={routeBase} profile={profile} /></div> : null}
                {activeStage === "assets" ? <div className="workflow-overview-scroll thin-scrollbar"><AssetsStage detail={detail} projectId={projectId} unitId={unit.id} routeBase={routeBase} profile={profile} /></div> : null}
                {productionStage ? <Suspense fallback={<div className="workflow-workbench-loading">正在准备{stageDefinition?.label || "生产"}工作台…</div>}><WorkflowProductionWorkbench activeStage={activeStage} detail={detail} projectId={projectId} unitId={unit.id} profile={profile} routeBase={routeBase} workflowStep={activeStep} selectedShot={selectedShot} onSelectShot={setSelectedShotId} onRefresh={refresh} onAddShot={() => addShot.mutate()} addingShot={addShot.isPending} /></Suspense> : null}
                {activeStage === "delivery" ? <div className="workflow-overview-scroll thin-scrollbar"><DeliveryStage detail={detail} unitId={unit.id} profile={profile} /></div> : null}
            </main>
        </div>
    );
}
